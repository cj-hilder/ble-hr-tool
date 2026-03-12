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
let currentState = 'stopped';
let sessionInterval;
let wakeLock = null;

// Display Timers
let sessionSeconds = 0;
let stateSeconds = 0;
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

// --- Logic ---
function switchState(newState) {
    if (currentState === newState && newState !== 'stopped') return;
    
    // Increment the reset counter if we are moving into the reset state
    if (newState === 'reset') resetCount++;
    
    currentState = newState;
    stateSeconds = 0;
    document.getElementById('stateTimerDisplay').innerText = '00:00';

    // Wipe all transition buffers and trackers clean when entering a new state
    activeToRestCount = 0;
    activeToResetCount = 0;
    restToActiveCount = 0;
    resetToActiveCount = 0;
    maxHrInRest = 0;
    timeOfMaxHrInRest = 0;

    const dot = document.getElementById('stateIndicator');
    dot.className = `state-dot ${newState}`;

    const descEl = document.getElementById('stateDescription');
    if (newState === 'active') {
        descEl.innerText = "Continue activity";
        descEl.style.color = "#28a745";
    } else if (newState === 'rest') {
        descEl.innerText = "Rest or pull back";
        descEl.style.color = "#fd7e14";
    } else if (newState === 'reset') {
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
    const currentHeartRate = event.target.value.getUint8(1);
    document.getElementById('heartRateDisplay').innerText = currentHeartRate;

    if (isSessionRunning) {
        
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
            // Track Max HR and the exact second it occurred
            if (currentHeartRate > maxHrInRest) {
                maxHrInRest = currentHeartRate;
                timeOfMaxHrInRest = stateSeconds;
            }

            if (currentHeartRate <= ACTIVE_THRESHOLD) { 
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
    log('❌ Disconnected from device. Refresh the page to reconnect.', true);
    document.body.classList.remove('connected');
    
    if (isSessionRunning) {
        clearInterval(sessionInterval);
        isSessionRunning = false;
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
        switchState('stopped');
    }
    
    if (wakeLock !== null) {
        wakeLock.release().then(() => wakeLock = null);
    }
}

// --- Event Listeners ---
document.getElementById('toggleSessionBtn').addEventListener('click', () => {
    if (isSessionRunning) {
        if (!confirm('Are you sure you want to end this session?')) return; 
        
        isSessionRunning = false;
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
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
        
        document.getElementById('toggleSessionBtn').innerText = 'End Session';
        document.getElementById('toggleSessionBtn').classList.add('running');
        
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
                                     
