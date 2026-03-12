// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// --- Hardcoded Thresholds & Timers ---
const RESTING_HR = 65; 
const ACTIVE_THRESHOLD = 80;
const MAX_RECOVERY_PERIOD = 240; // 4 minutes (in seconds)
const MAX_RESPONSE_LAG = 60;     // 60 seconds

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
    isRecoveryState = false;
    
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
    
    triggerNotification();
    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    if (newState === 'active') {
        descEl.innerText = "Continue activity";
        descEl.style.color = "#28a745";
        manualResetBtn.innerHTML = "&#8634;"; // Reset Arrow
    } else if (newState === 'rest') {
        descEl.innerText = "Rest or pull back";
        descEl.style.color = "#fd7e14";
        manualResetBtn.innerHTML = "&#8634;"; // Reset Arrow
    } else if (newState === 'reset') {
        manualResetBtn.innerHTML = "&#9654;"; // Play Button
        if (resetCount >= 3) {
            descEl.innerText = "Finish this session ASAP";
            descEl.style.color = "#dc3545";
        } else {
            descEl.innerText = "Reset to resting HR";
            descEl.style.color = "#dc3545";
        }
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
            if (currentHeartRate >= ACTIVE_THRESHOLD) {
                activeToRestCount++;
                activeToResetCount = 0;
            } else if (currentHeartRate < (RESTING_HR - 10)) {
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
            if (currentHeartRate < ACTIVE_THRESHOLD) { 
                restToActiveCount++;
            } else {
                restToActiveCount = 0;
            }

            if (restToActiveCount >= 7) switchState('active');
        } 
        
        else if (currentState === 'reset') {
            // HR must be exactly between (Resting HR - 5) and (Resting HR + 5)
            if (currentHeartRate >= (RESTING_HR - 5) && currentHeartRate <= (RESTING_HR + 5)) {
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
    if (isSessionRunning) {
        if (!confirm('Are you sure you want to end this session?')) return; 
        
        isSessionRunning = false;
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
        document.getElementById('manualResetBtn').style.display = 'none'; // Hide manual button
        
        clearInterval(sessionInterval);
        switchState('stopped');
    } else {
        isSessionRunning = true;
        sessionSeconds = 0;
        stateSeconds = 0;
        totalActiveSeconds = 0;
        resetCount = 0;
        
        document.getElementById('sessionTimerDisplay').innerText = '00:00';
        document.getElementById('stateTimerDisplay').innerText = '00:00';
        document.getElementById('totalActiveTimerDisplay').innerText = '00:00';
        
        // Blank out the rest stats until the first rest period
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
        
        document.getElementById('toggleSessionBtn').innerText = 'End Session';
        document.getElementById('toggleSessionBtn').classList.add('running');
        document.getElementById('manualResetBtn').style.display = 'flex'; // Show manual button
        
        switchState('active');
        sessionInterval = setInterval(updateTimers, 1000);
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
        
    } catch (error) { 
        let errorMsg = '❌ Error: ' + error.message;
        errorMsg += '<br><br>💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device.';
        log(errorMsg, true); 
    }
});

        
