// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// --- Thresholds & Variables ---
const RESTING_HR = 65; 
const ACTIVE_THRESHOLD = 80;
const RESET_THRESHOLD = 100;

let bluetoothDevice;
let isSessionRunning = false;
let currentState = 'stopped';
let sessionInterval;
let wakeLock = null;

// Timers and Buffers
let sessionSeconds = 0;
let stateSeconds = 0;
let totalActiveSeconds = 0;
let resetCount = 0;
let consecutiveHigh = 0;
let consecutiveLow = 0;

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
    
    currentState = newState;
    stateSeconds = 0;
    document.getElementById('stateTimerDisplay').innerText = '00:00';

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
    
    document.getElementById('sessionTimerDisplay').innerText = formatTime(sessionSeconds);
    document.getElementById('stateTimerDisplay').innerText = formatTime(stateSeconds);
}

function handleHeartRate(event) {
    const currentHeartRate = event.target.value.getUint8(1);
    document.getElementById('heartRateDisplay').innerText = currentHeartRate;

    if (isSessionRunning) {
        if (currentState === 'reset') {
            // Clearance: clear reset state when HR <= RESTING_HR + 5
            if (currentHeartRate <= (RESTING_HR + 5)) {
                switchState('rest');
            }
        } else if (currentHeartRate >= RESET_THRESHOLD) {
            // Immediate jump to Reset
            resetCount++;
            consecutiveHigh = 0;
            consecutiveLow = 0;
            switchState('reset');
        } else {
            // Pacing Buffer Logic
            if (currentHeartRate >= ACTIVE_THRESHOLD) {
                consecutiveHigh++;
                consecutiveLow = 0;
                
                // Need 7 consecutive high readings to switch to Active
                if (currentState === 'rest' && consecutiveHigh >= 7) {
                    switchState('active');
                }
            } else {
                consecutiveLow++;
                consecutiveHigh = 0;
                
                // Need 3 consecutive low readings to switch back to Rest
                if (currentState === 'active' && consecutiveLow >= 3) {
                    switchState('rest');
                }
            }
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
        // Confirmation Guardrail
        if (!confirm('Are you sure you want to end this session?')) {
            return; 
        }
        
        isSessionRunning = false;
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
        clearInterval(sessionInterval);
        switchState('stopped');
        document.getElementById('stateDescription').innerText = "";
    } else {
        isSessionRunning = true;
        sessionSeconds = 0;
        stateSeconds = 0;
        totalActiveSeconds = 0;
        resetCount = 0;
        consecutiveHigh = 0;
        consecutiveLow = 0;
        
        document.getElementById('sessionTimerDisplay').innerText = '00:00';
        document.getElementById('stateTimerDisplay').innerText = '00:00';
        document.getElementById('totalActiveTimerDisplay').innerText = '00:00';
        
        document.getElementById('toggleSessionBtn').innerText = 'End Session';
        document.getElementById('toggleSessionBtn').classList.add('running');
        
        switchState('rest');
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
        
