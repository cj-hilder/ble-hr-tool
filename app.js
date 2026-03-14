// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// --- Settings 
// --- Default Thresholds & Timers ---
const MAX_HR = 170;
const RESTING_HR = 65; 
const RESTING_HR_BANDWIDTH = 10; 

const TARGET_MIN_HR = 70;
const TARGET_MAX_HR = 90;

const ACTIVE_THRESHOLD_UPPER = 80;
const ACTIVE_THRESHOLD_LOWER = 77;

const BRADYCARDIA_THRESHOLD = 55;

const MAX_RECOVERY_PERIOD = 240; // 4 minutes (in seconds)
const MAX_RESPONSE_LAG = 60;     // 60 seconds
const NUM_RESETS_B4_WARN = 3;
// --- end of settings

// --- Speedometer geometry ---
// SVG is 200x200, circle centre at (100,100), circle radius = 60px.
// The coloured state-dot div is 120×120, offset 40px inside the SVG.
//
// Angle convention: SVG angles, measured clockwise from the positive X-axis.
//   HR = 0        → SSW  → 112.5°
//   HR = MAX_HR/2 → North → 270°  (i.e. straight up)
//   HR = MAX_HR   → SSE  → 427.5° ≡ 67.5°
// The sweep is 315° clockwise from SSW through West→North→East to SSE.
const SPEEDO_CX = 100;
const SPEEDO_CY = 100;
const SPEEDO_CIRCLE_R = 60;
const SPEEDO_NEEDLE_INNER_R = 61;   // just outside the edge
const SPEEDO_NEEDLE_OUTER_R = 68;   // 7px needle length
const SPEEDO_ARC_R = 69;            // ~8px gap beyond circle edge
const SPEEDO_START_DEG = 112.5;     // SSW (HR = 0)
const SPEEDO_SWEEP_DEG = 315;       // total angular range

let latestHR = 0;   // last received HR value, used for arc redraw on state change

function _hrToSvgDeg(hr) {
    const clamped = Math.max(0, Math.min(hr, MAX_HR));
    return SPEEDO_START_DEG + (clamped / MAX_HR) * SPEEDO_SWEEP_DEG;
}

function _polarXY(r, deg) {
    const rad = deg * Math.PI / 180;
    return { x: SPEEDO_CX + r * Math.cos(rad), y: SPEEDO_CY + r * Math.sin(rad) };
}

function _arcPath(startDeg, endDeg) {
    // Clockwise arc from startDeg to endDeg, both in SVG degrees
    const s = _polarXY(SPEEDO_ARC_R, startDeg);
    const e = _polarXY(SPEEDO_ARC_R, endDeg);
    const sweep = ((endDeg - startDeg) + 360) % 360; // always positive, clockwise
    const large = sweep > 180 ? 1 : 0;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${SPEEDO_ARC_R} ${SPEEDO_ARC_R} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function updateSpeedometer(hr) {
    latestHR = hr;

    // --- Needle ---
    const angleDeg = _hrToSvgDeg(hr);
    const p1 = _polarXY(SPEEDO_NEEDLE_INNER_R, angleDeg);
    const p2 = _polarXY(SPEEDO_NEEDLE_OUTER_R, angleDeg);
    const needle = document.getElementById('speedoNeedle');
    needle.setAttribute('x1', p1.x.toFixed(2));
    needle.setAttribute('y1', p1.y.toFixed(2));
    needle.setAttribute('x2', p2.x.toFixed(2));
    needle.setAttribute('y2', p2.y.toFixed(2));

    // --- Target zone arc ---
    let zoneMin, zoneMax;
    if (currentState === 'reset' || currentState === 'stopped' || currentState === 'pause') {
        // Resting-HR band
        zoneMin = RESTING_HR - RESTING_HR_BANDWIDTH / 2;
        zoneMax = RESTING_HR + RESTING_HR_BANDWIDTH / 2;
    } else {
        zoneMin = TARGET_MIN_HR;
        zoneMax = TARGET_MAX_HR;
    }

    const arcStart = _hrToSvgDeg(zoneMin);
    const arcEnd   = _hrToSvgDeg(zoneMax);

    const inZone = (hr >= zoneMin && hr <= zoneMax);
    const arc = document.getElementById('speedoArc');
    arc.setAttribute('d', _arcPath(arcStart, arcEnd));
    arc.setAttribute('stroke-width', inZone ? '1' : '4');
}


let bluetoothDevice;
let isSessionRunning = false;
let isReconnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let currentState = 'stopped';
let sessionInterval;
let wakeLock = null;
let heartbeatTimeout;

// Display Timers
let sessionSeconds = 0;
let stateSeconds = 0;
let recoverySeconds = 0;
let totalActiveSeconds = 0;
let resetCount = 0;

// State Transition Buffers
let activeToRestCount = 0;
let activeToResetCount = 0;
let restToActiveCount = 0;
let resetToActiveCount = 0;

// Rest State Tracking
let maxHrInRest = 0;
let timeOfMaxHrInRest = 0;
// Recovery state is rest state, extending into reset state
// when reset state is entered from rest.
let isRecoveryState = false;

const logElement = document.getElementById('log');

// --- Helper Functions ---
function log(message, isError = false) {
    logElement.innerHTML = message;
    if (isError) logElement.classList.add('error');
    else logElement.classList.remove('error');
}

function formatTime(totalSeconds) {
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.log('Wake Lock Error:', err);
    }
}
// --- The "Bluetooth Timer" ---
function resetTimeout() {
    clearTimeout(heartbeatTimeout);
    // If we hear nothing for 3 seconds, sever the connection
    heartbeatTimeout = setTimeout(() => {
        if (isReconnecting) return; // Already handling a reconnect
        if (bluetoothDevice && bluetoothDevice.gatt.connected) {
            bluetoothDevice.gatt.disconnect();
        } else { 
            handleDisconnect(); 
        }
    }, 3000); 
}

// --- Audio/Vibrate Notification ---
let audioCtx;

function triggerNotification() {
    // 1. Trigger the physical vibration (Android)
    if ("vibrate" in navigator) {
        navigator.vibrate([300, 100, 300]); // Two distinct pulses
    }

    // 2. Trigger the audio beep
    try {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        
        // Browser autoplay policies require resuming the context
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine'; // Smooth beep sound
        oscillator.frequency.setValueAtTime(500, audioCtx.currentTime); 
        
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.log("Audio notification failed:", e);
    }
}
        
// --- Logic ---
function switchState(newState) {
    if (currentState === newState && newState !== 'stopped') return;

    // Preserve recovery state across pause (pause does not break a recovery window)
    if (newState !== 'pause') {
        isRecoveryState = false;
    }
    
    // Increment the reset counter if we are moving into the reset state
    if (newState === 'reset') {
        resetCount++;
        if (currentState === 'rest') {
            isRecoveryState = true; 
        }
    }
    
    currentState = newState;
    stateSeconds = 0;
    document.getElementById('stateTimerDisplay').innerText = '00:00';

    // Wipe transition buffers clean when entering a new state
    activeToRestCount = 0;
    activeToResetCount = 0;
    restToActiveCount = 0;
    resetToActiveCount = 0;

    // ONLY wipe the Max HR trackers if we are starting a brand new Rest period
    if (newState === 'rest') {
        maxHrInRest = 0;
        timeOfMaxHrInRest = 0;
        isRecoveryState = true;
        recoverySeconds = 0;
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
    }

    const dot = document.getElementById('stateIndicator');
    dot.className = `state-dot ${newState}`;
    updateSpeedometer(latestHR);
    
    // Don't trigger notification for user-initiated pause/resume
    if (newState !== 'pause') {
        triggerNotification();
    }

    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn = document.getElementById('toggleSessionBtn');
    if (newState === 'active') {
        descEl.innerText = "Continue activity";
        descEl.style.color = "#28a745";
        manualResetBtn.innerHTML = "&#8634;"; // Reset Arrow
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
    } else if (newState === 'rest') {
        descEl.innerText = "Rest or pull back";
        descEl.style.color = "#fd7e14";
        manualResetBtn.innerHTML = "&#8634;"; // Reset Arrow
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
    } else if (newState === 'reset') {
        manualResetBtn.innerHTML = "&#9654;"; // Play Button
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
        if (resetCount >= NUM_RESETS_B4_WARN) {
            descEl.innerText = "⚠️ Finish this session ASAP";
            descEl.style.color = "#dc3545";
        } else {
            descEl.innerText = "Reset to resting HR";
            descEl.style.color = "#dc3545";
        }
    } else if (newState === 'pause') {
        descEl.innerText = "Pause activity";
        descEl.style.color = "#888888";
        manualResetBtn.style.display = 'none';
        toggleBtn.innerText = 'Resume session';
        toggleBtn.classList.add('paused');
    } else {
        descEl.innerText = "";
    }
}

function updateTimers() {
    sessionSeconds++;
    stateSeconds++;
    if (isRecoveryState) {
        recoverySeconds++;
    }
    
    if (currentState === 'active') {
        totalActiveSeconds++;
        document.getElementById('totalActiveTimerDisplay').innerText = formatTime(totalActiveSeconds);
    }

    // Time-based checks for the Rest -> Reset transition
    if (currentState === 'rest') {
        if (stateSeconds > MAX_RECOVERY_PERIOD) {
            switchState('reset');
        } else if (timeOfMaxHrInRest > MAX_RESPONSE_LAG) {
            switchState('reset');
        }
    }
    
    document.getElementById('sessionTimerDisplay').innerText = formatTime(sessionSeconds);
    document.getElementById('stateTimerDisplay').innerText = formatTime(stateSeconds);
}

function handleHeartRate(event) {
    if (isReconnecting) return; // Ignore stale events during reconnect
    const flags = event.target.value.getUint8(0);
    const is16bit = flags & 0x01;
    const currentHeartRate = is16bit
        ? event.target.value.getUint16(1, true)
        : event.target.value.getUint8(1);
    document.getElementById('heartRateDisplay').innerText = currentHeartRate;
    resetTimeout();
    updateSpeedometer(currentHeartRate);

    if (isSessionRunning) {
        if (isRecoveryState) {
            // Track Max HR, the exact second it occurred, and update the UI live
            if (currentHeartRate >= maxHrInRest) {
                maxHrInRest = currentHeartRate;
                timeOfMaxHrInRest = recoverySeconds;
                
                document.getElementById('maxHrDisplay').innerText = maxHrInRest;
                document.getElementById('lagDisplay').innerText = formatTime(timeOfMaxHrInRest);
            }
        }
        if (currentState === 'active') {
            if (currentHeartRate >= ACTIVE_THRESHOLD_UPPER) {
                activeToRestCount++;
                activeToResetCount = 0;
            } else if (currentHeartRate < BRADYCARDIA_THRESHOLD) {
                activeToResetCount++;
                activeToRestCount = 0;
            } else {
                activeToRestCount = 0;
                activeToResetCount = 0;
            }

            // Execute transitions
            if (activeToRestCount >= 3) switchState('rest');
            else if (activeToResetCount >= 3) switchState('reset');
        } 
        
        else if (currentState === 'rest') {
            if (currentHeartRate < ACTIVE_THRESHOLD_LOWER) { 
                restToActiveCount++;
            } else {
                restToActiveCount = 0;
            }

            if (restToActiveCount >= 7) switchState('active');
        } 
        
        else if (currentState === 'reset') {
            // HR must be exactly between (Resting HR - 5) and (Resting HR + 5)
            if (currentHeartRate >= (RESTING_HR - (RESTING_HR_BANDWIDTH / 2)) && currentHeartRate <= (RESTING_HR + (RESTING_HR_BANDWIDTH / 2))) {
                resetToActiveCount++;
            } else {
                resetToActiveCount = 0;
            }

            if (resetToActiveCount >= 15) switchState('active');
        }
    }
}

function handleDisconnect() {
    clearTimeout(heartbeatTimeout);

    if (isSessionRunning && !isReconnecting) {
        // Mid-session drop — preserve session state and attempt to reconnect
        startReconnect();
    } else if (!isSessionRunning) {
        // No session running — full teardown
        log('❌ Disconnected from device. Refresh the page to reconnect.', true);
        document.body.classList.remove('connected');
        if (wakeLock !== null) {
            wakeLock.release().then(() => wakeLock = null);
        }
    }
}

function startReconnect() {
    isReconnecting = true;
    reconnectAttempts = 0;

    // Visual feedback: pulse the state dot
    document.getElementById('stateIndicator').classList.add('reconnecting');
    document.getElementById('heartRateDisplay').innerText = '--';
    document.getElementById('stateDescription').innerText = 'Signal lost — reconnecting…';
    document.getElementById('stateDescription').style.color = '#aaaaaa';

    attemptReconnect();
}

async function attemptReconnect() {
    if (!isReconnecting) return;

    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        // Give up — full teardown
        isReconnecting = false;
        isSessionRunning = false;
        document.getElementById('stateIndicator').classList.remove('reconnecting');
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
        document.getElementById('manualResetBtn').style.display = 'none';
        document.body.classList.remove('connected');
        log('❌ Could not reconnect after 10 attempts. Session ended.', true);
        switchState('stopped');
        if (wakeLock !== null) wakeLock.release().then(() => wakeLock = null);
        return;
    }

    try {
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        onReconnectSuccess();
    } catch (err) {
        // Wait 3 seconds then try again
        setTimeout(attemptReconnect, 3000);
    }
}

function onReconnectSuccess() {
    isReconnecting = false;
    reconnectAttempts = 0;

    // Resume state dot and description
    document.getElementById('stateIndicator').classList.remove('reconnecting');

    // Restore the description text for whatever state we were in
    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    if (currentState === 'active') {
        descEl.innerText = 'Continue activity';
        descEl.style.color = '#28a745';
    } else if (currentState === 'rest') {
        descEl.innerText = 'Rest or pull back';
        descEl.style.color = '#fd7e14';
    } else if (currentState === 'reset') {
        descEl.innerText = resetCount >= 3 ? 'Finish this session ASAP' : 'Reset to resting HR';
        descEl.style.color = '#dc3545';
    } else if (currentState === 'pause') {
        descEl.innerText = 'Pause activity';
        descEl.style.color = '#888888';
    }

    // HR will resume via handleHeartRate notifications
}

// --- Event Listeners ---
document.getElementById('manualResetBtn').addEventListener('click', () => {
    if (!isSessionRunning) return;

    if (currentState === 'reset') {
        // If in reset, function as "Cancel Reset" and go straight to active
        switchState('active');
    } else if (currentState === 'active' || currentState === 'rest') {
        // If in active or rest, function as "Enter Reset" and go straight to reset
        switchState('reset');
    }
});

document.getElementById('toggleSessionBtn').addEventListener('click', () => {
    if (!isSessionRunning) {
        // --- Start Session ---
        isSessionRunning = true;
        sessionSeconds = 0;
        stateSeconds = 0;
        totalActiveSeconds = 0;
        resetCount = 0;
        recoverySeconds = 0;
        
        document.getElementById('sessionTimerDisplay').innerText = '00:00';
        document.getElementById('stateTimerDisplay').innerText = '00:00';
        document.getElementById('totalActiveTimerDisplay').innerText = '00:00';
        
        // Blank out the rest stats until the first rest period
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
        
        document.getElementById('toggleSessionBtn').classList.add('running');
        
        switchState('active');
        sessionInterval = setInterval(updateTimers, 1000);
        return;
    }

    if (currentState === 'pause') {
        // --- Resume from Pause ---
        switchState('active');
        return;
    }

    // --- Show Pause / End / Cancel dialog ---
    document.getElementById('sessionModal').classList.add('visible');
});

// --- Modal: Pause ---
document.getElementById('modalPauseBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
    switchState('pause');
});

// --- Modal: End session ---
document.getElementById('modalEndBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
    isSessionRunning = false;
    const toggleBtn = document.getElementById('toggleSessionBtn');
    toggleBtn.innerText = 'Start Session';
    toggleBtn.classList.remove('running', 'paused');
    document.getElementById('manualResetBtn').style.display = 'none';
    clearInterval(sessionInterval);
    switchState('stopped');
});

// --- Modal: Cancel ---
document.getElementById('modalCancelBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
});

document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        log('1. Waiting for you to select the watch...');
        bluetoothDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnect);

        log('2. Connecting to Bluetooth server...');
        const server = await bluetoothDevice.gatt.connect();

        log('3. Requesting Heart Rate data...');
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');

        log('4. Starting live notifications...<br><br>⚠️ TIP: If the app freezes here, the connection is stuck. Try:<br>1. Force-closing Chrome & Polar Flow.<br>2. Toggling your phone\'s Bluetooth off/on.<br>3. <b>Unpairing the phone from inside the watch\'s own settings menu.</b>');

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        
        log('✅ Success! Waiting for first heartbeat...');
        document.body.classList.add('connected');
        requestWakeLock();
        
    } catch (error) { 
        let errorMsg = '❌ Error: ' + error.message;
        errorMsg += '<br><br>💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device.';
        log(errorMsg, true); 
    }
});

        

// Initialise speedometer at page load (draws needle at HR=0 and resting arc)
document.addEventListener('DOMContentLoaded', () => updateSpeedometer(0));
