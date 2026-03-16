// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// Settings constants are declared and loaded from localStorage by settings.js

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

// --- HR History Graph ---
// Stores the last 90 seconds of {hr, state, ts} readings for the graph overlay.
const hrHistory = [];
const HR_HISTORY_MS = 90000;

function recordHrHistory(hr) {
    const now = Date.now();
    hrHistory.push({ hr, state: currentState, ts: now });
    // Discard readings older than the 90-second window
    const cutoff = now - HR_HISTORY_MS;
    while (hrHistory.length > 0 && hrHistory[0].ts < cutoff) {
        hrHistory.shift();
    }
    drawHrGraph();
}

function drawHrGraph() {
    const canvas = document.getElementById('hrGraphCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;   // 90
    const H = canvas.height;  // 120

    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.7; 
    
    if (hrHistory.length < 2) return;

    const now = Date.now();
    // Pin left edge to the first recorded point until the buffer fills 90 seconds,
    // then switch to a rolling window so the graph scrolls left.
    const windowStart = Math.max(hrHistory[0].ts, now - HR_HISTORY_MS);

    // Map a timestamp to x pixel (0 = oldest, W = now)
    function toX(ts) {
        return ((ts - windowStart) / HR_HISTORY_MS) * W;
    }
    // Map HR to y pixel (MAX_HR → top=0, 0 → bottom=H)
    function toY(hr) {
        return H - (hr / MAX_HR) * H;
    }
    if (hrHistory[0].state === 'active') {
        ctx.strokeStyle = 'black';
    } else {
        ctx.strokeStyle = 'white';
    }
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Half the gap (px) applied on each side of a state-transition point
    const GAP_HALF = 2.0;

    ctx.beginPath();
    let pathStarted = false;
    let prevState = null;

    for (let i = 0; i < hrHistory.length; i++) {
        const { hr, state, ts } = hrHistory[i];
        const x = toX(ts);
        const y = toY(hr);
        const isStateChange = prevState !== null && state !== prevState;

        if (isStateChange) {
            // Close the old segment 1.5 px before this point (already done by
            // the look-ahead below), then open a new segment 1.5 px after it.
            ctx.stroke();
            if (state === 'active') {
                ctx.strokeStyle = 'black';
            } else {
                ctx.strokeStyle = 'white';
            }
            ctx.beginPath();
            ctx.moveTo(x + GAP_HALF, y);
            pathStarted = true;
        } else if (!pathStarted) {
            ctx.moveTo(x, y);
            pathStarted = true;
        } else {
            // Look ahead: if the *next* point triggers a state change, stop
            // drawing 1.5 px short so the full 3 px gap is centred on the break.
            const nextBreaks = i < hrHistory.length - 1 &&
                               hrHistory[i + 1].state !== state;
            ctx.lineTo(nextBreaks ? x - GAP_HALF : x, y);
        }

        prevState = state;
    }
    ctx.stroke();
}


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
let isManualDisconnect = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let currentState = 'stopped';
let sessionInterval;
let wakeLock = null;
let heartbeatTimeout;

const SESSION_KEY = 'hrPacerSession';

// Display Timers
let sessionStartTime = 0;
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
    if (totalSeconds >= 3600) {
        const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(totalSeconds % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return `${m}:${s}`;
}

function setTimerDisplay(el, seconds) {
    el.innerText = formatTime(seconds);
    el.classList.toggle('long-time', seconds >= 3600);
}

// --- Session Persistence ---
function saveSession() {
    if (!isSessionRunning) return;
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            sessionStartTime,
            sessionSeconds,
            stateSeconds,
            recoverySeconds,
            totalActiveSeconds,
            resetCount,
            isRecoveryState,
            maxHrInRest,
            timeOfMaxHrInRest,
            currentState,
        }));
    } catch (e) {}
}

function clearSession() {
    localStorage.removeItem(SESSION_KEY);
}

function restoreSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        sessionStartTime  = s.sessionStartTime;
        sessionSeconds    = s.sessionSeconds;
        stateSeconds      = s.stateSeconds;
        recoverySeconds   = s.recoverySeconds;
        totalActiveSeconds = s.totalActiveSeconds;
        resetCount        = s.resetCount;
        isRecoveryState   = s.isRecoveryState;
        maxHrInRest       = s.maxHrInRest;
        timeOfMaxHrInRest = s.timeOfMaxHrInRest;
        currentState      = s.currentState;
        isSessionRunning  = true;
        return true;
    } catch (e) {
        return false;
    }
}

function restoreSessionUI() {
    // Timers
    setTimerDisplay(document.getElementById('stateTimerDisplay'),       stateSeconds);
    setTimerDisplay(document.getElementById('sessionTimerDisplay'),     sessionSeconds);
    setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), totalActiveSeconds);

    // Rest stats
    if (maxHrInRest > 0) {
        document.getElementById('maxHrDisplay').innerText = maxHrInRest;
        setTimerDisplay(document.getElementById('lagDisplay'), timeOfMaxHrInRest);
    } else {
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
    }

    // State dot and speedometer
    document.getElementById('stateIndicator').className = `state-dot ${currentState}`;
    updateSpeedometer(0);

    // Buttons and description
    const descEl        = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn     = document.getElementById('toggleSessionBtn');
    toggleBtn.classList.add('running');

    if (currentState === 'active') {
        descEl.innerText = 'Continue activity';
        descEl.style.color = '#28a745';
        manualResetBtn.innerHTML = '&#8634;';
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
    } else if (currentState === 'rest') {
        descEl.innerText = 'Rest or pull back';
        descEl.style.color = '#fd7e14';
        manualResetBtn.innerHTML = '&#8634;';
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
    } else if (currentState === 'reset') {
        manualResetBtn.innerHTML = '&#9654;';
        manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session';
        toggleBtn.classList.remove('paused');
        descEl.innerText = resetCount >= NUM_RESETS_B4_WARN
            ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
        descEl.style.color = '#dc3545';
    } else if (currentState === 'pause') {
        descEl.innerText = 'Pause activity';
        descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none';
        toggleBtn.innerText = 'Resume session';
        toggleBtn.classList.add('paused');
    }

    // Home button hidden — session is running
    document.getElementById('homeBtn').style.display = 'none';
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
function switchState(newState, isManual) {
    if (currentState === newState && newState !== 'stopped') return;

    // Preserve recovery state across pause (pause does not break a recovery window)
    if (newState !== 'pause') {
        isRecoveryState = false;
    }
    
    // Increment the reset counter if we are moving into the reset state
    if (newState === 'reset') {
        if (!isManual) resetCount++;
        if (currentState === 'rest') {
            isRecoveryState = true; 
        }
    }
    
    currentState = newState;
    stateSeconds = 0;
    setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
    if (isSessionRunning) saveSession();

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

function updateTimers(increment) {
    sessionSeconds += increment;
    stateSeconds += increment;
    if (isRecoveryState) {
        recoverySeconds += increment;
    }
    
    if (currentState === 'active') {
        totalActiveSeconds += increment;
        setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), totalActiveSeconds);
    }

    // Time-based checks for the Rest -> Reset transition
    if (currentState === 'rest') {
        if (stateSeconds > MAX_RECOVERY_PERIOD) {
            switchState('reset', false);
        } else if (timeOfMaxHrInRest > MAX_RESPONSE_LAG) {
            switchState('reset', false);
        }
    }
    
    setTimerDisplay(document.getElementById('sessionTimerDisplay'), sessionSeconds);
    setTimerDisplay(document.getElementById('stateTimerDisplay'), stateSeconds);
}

function handleTick() {
    const trueSessionSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    updateTimers(trueSessionSeconds - sessionSeconds);
    saveSession();
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
    if (currentHeartRate == 0) return;
    updateSpeedometer(currentHeartRate);
    recordHrHistory(currentHeartRate);

    if (isSessionRunning) {
        if (isRecoveryState) {
            // Track Max HR, the exact second it occurred, and update the UI live
            if (currentHeartRate >= maxHrInRest) {
                maxHrInRest = currentHeartRate;
                timeOfMaxHrInRest = recoverySeconds;
                
                document.getElementById('maxHrDisplay').innerText = maxHrInRest;
                setTimerDisplay(document.getElementById('lagDisplay'), timeOfMaxHrInRest);
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
            if (activeToRestCount >= 3) switchState('rest', false);
            else if (activeToResetCount >= 3) switchState('reset', false);
        } 
        
        else if (currentState === 'rest') {
            if (currentHeartRate < ACTIVE_THRESHOLD_LOWER) { 
                restToActiveCount++;
            } else {
                restToActiveCount = 0;
            }

            if (restToActiveCount >= 7) switchState('active', false);
        } 
        
        else if (currentState === 'reset') {
            // HR must be exactly between (Resting HR - 5) and (Resting HR + 5)
            if (currentHeartRate >= (RESTING_HR - (RESTING_HR_BANDWIDTH / 2)) && currentHeartRate <= (RESTING_HR + (RESTING_HR_BANDWIDTH / 2))) {
                resetToActiveCount++;
            } else {
                resetToActiveCount = 0;
            }

            if (resetToActiveCount >= 15) switchState('active', false);
        }
    }
}

function handleDisconnect() {
    if (isManualDisconnect) {
        isManualDisconnect = false;
        return;
    }
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
        switchState('stopped', true);
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
        switchState('active', true);
    } else if (currentState === 'active' || currentState === 'rest') {
        // If in active or rest, function as "Enter Reset" and go straight to reset
        switchState('reset', true);
    }
});

document.getElementById('toggleSessionBtn').addEventListener('click', () => {
    if (!isSessionRunning) {
        // --- Start Session ---
        isSessionRunning = true;
        sessionSeconds = 0;
        sessionStartTime = Math.floor(Date.now());
        stateSeconds = 0;
        totalActiveSeconds = 0;
        resetCount = 0;
        recoverySeconds = 0;

        document.getElementById('homeBtn').style.display = 'none';
        setTimerDisplay(document.getElementById('sessionTimerDisplay'), 0);
        setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
        setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), 0);
        
        // Blank out the rest stats until the first rest period
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
        
        document.getElementById('toggleSessionBtn').classList.add('running');
        
        switchState('active', true);
        sessionInterval = setInterval(handleTick, 1000);
        return;
    }

    if (currentState === 'pause') {
        // --- Resume from Pause ---
        switchState('active', true);
        return;
    }

    // --- Show Pause / End / Cancel dialog ---
    document.getElementById('sessionModal').classList.add('visible');
});

// --- Modal: Pause ---
document.getElementById('modalPauseBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
    switchState('pause', true);
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
    clearSession();
    document.getElementById('homeBtn').style.display = 'flex';
    switchState('stopped', true);
});

// --- Modal: Cancel ---
document.getElementById('modalCancelBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
});

// --- Home Button ---
document.getElementById('homeBtn').addEventListener('click', () => {
    isManualDisconnect = true;
    document.body.classList.remove('connected');
    document.getElementById('homeBtn').style.display = 'none';
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    } else {
        isManualDisconnect = false;
    }
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

        const restored = restoreSession();
        if (restored) {
            restoreSessionUI();
            sessionInterval = setInterval(handleTick, 1000);
        } else {
            document.getElementById('homeBtn').style.display = 'flex';
        }
        
    } catch (error) { 
        let errorMsg = '❌ Error: ' + error.message;
        errorMsg += '<br><br>💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device.';
        log(errorMsg, true); 
    }
});

        

// Initialise speedometer at page load (draws needle at HR=0 and resting arc)
// Also attempt to auto-reconnect if a session was in progress before the refresh.
document.addEventListener('DOMContentLoaded', () => {
    updateSpeedometer(0);
    tryAutoReconnect();
});

async function tryAutoReconnect() {
    const restored = restoreSession();
    if (!restored) return;

    // A session was in progress — restore UI immediately so timers keep running
    document.body.classList.add('connected');
    restoreSessionUI();
    sessionInterval = setInterval(handleTick, 1000);
    requestWakeLock();

    // getDevices() returns previously-paired devices without a user gesture
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
        // Browser doesn't support getDevices — user must tap Connect manually.
        // The existing post-connect restore path will handle it.
        document.getElementById('stateDescription').innerText = 'Tap Connect to Watch to resume';
        document.getElementById('stateDescription').style.color = '#aaaaaa';
        return;
    }

    try {
        const devices = await navigator.bluetooth.getDevices();
        if (devices.length === 0) {
            document.getElementById('stateDescription').innerText = 'Tap Connect to Watch to resume';
            document.getElementById('stateDescription').style.color = '#aaaaaa';
            return;
        }
        // Use the first available device (this is a single-device app)
        bluetoothDevice = devices[0];
        bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnect);
        startReconnect();
    } catch (e) {
        document.getElementById('stateDescription').innerText = 'Tap Connect to Watch to resume';
        document.getElementById('stateDescription').style.color = '#aaaaaa';
    }
}
