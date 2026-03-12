if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => {
        console.log('Service Worker Registered');
    });
}

const ACTIVE_THRESHOLD = 80;
const REST_THRESHOLD = 80;
const RESTING_HR = 65;
const MAX_RECOVERY_PERIOD = 240; 
const MAX_RESPONSE_LAG = 60;     

const logElement = document.getElementById('log');
let bluetoothDevice;
let heartbeatTimeout;
let wakeLock = null;

const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

let isSessionRunning = false;
let sessionSeconds = 0;
let stateSeconds = 0; 
let timerInterval = null;
let currentTrainingState = 'stopped';

let consecutiveHighActive = 0;
let consecutiveLowActive = 0;
let consecutiveLowRest = 0;
let consecutiveRangeReset = 0;

let restMaxHR = 0;
let timeOfRestMaxHR = 0;

const stateIndicator = document.getElementById('stateIndicator');
const toggleSessionBtn = document.getElementById('toggleSessionBtn');
const stateTimerDisplay = document.getElementById('stateTimerDisplay');
const sessionTimerDisplay = document.getElementById('sessionTimerDisplay');

const restInfo = document.getElementById('restInfo');
const cancelResetBtn = document.getElementById('cancelResetBtn');
const maxHrVal = document.getElementById('maxHrVal');
const maxHrTime = document.getElementById('maxHrTime');

function log(message, isError = false) {
    logElement.innerText = message;
    if (isError) logElement.classList.add('error');
    else logElement.classList.remove('error');
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } 
        catch (err) { console.error('Wake Lock error:', err); }
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); }
}

function formatTime(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const paddedMins = mins.toString().padStart(2, '0');
    const paddedSecs = secs.toString().padStart(2, '0');
    return hrs > 0 ? `${hrs}:${paddedMins}:${paddedSecs}` : `${paddedMins}:${paddedSecs}`;
}

function updateTimersDisplay() {
    sessionTimerDisplay.innerText = formatTime(sessionSeconds);
    stateTimerDisplay.innerText = formatTime(stateSeconds);
    
    if (currentTrainingState === 'rest') {
        maxHrVal.innerText = restMaxHR > 0 ? restMaxHR : '--';
        maxHrTime.innerText = formatTime(timeOfRestMaxHR);
    }
}

function playAlert() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); 
    
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime); 
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5); 
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
}

function setTrainingState(newState) {
    if (currentTrainingState !== 'stopped' && currentTrainingState !== newState) {
        playAlert();
    }
    
    currentTrainingState = newState;
    stateIndicator.className = `state-dot ${newState}`;
    
    stateSeconds = 0; 
    consecutiveHighActive = 0;
    consecutiveLowActive = 0;
    consecutiveLowRest = 0;
    consecutiveRangeReset = 0;
    restMaxHR = 0;
    timeOfRestMaxHR = 0;
    
    restInfo.style.display = 'none';
    cancelResetBtn.style.display = 'none';
    
    if (newState === 'rest') {
        restInfo.style.display = 'block';
        maxHrVal.innerText = '--';
        maxHrTime.innerText = '00:00';
    } else if (newState === 'reset') {
        cancelResetBtn.style.display = 'block';
    }
    
    updateTimersDisplay();
}

function stopSession() {
    clearInterval(timerInterval);
    isSessionRunning = false;
    toggleSessionBtn.innerText = 'Start Session';
    toggleSessionBtn.classList.remove('running');
    setTrainingState('stopped');
}

cancelResetBtn.addEventListener('click', () => {
    setTrainingState('active');
});

toggleSessionBtn.addEventListener('click', () => {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (isSessionRunning) {
        stopSession();
    } else {
        sessionSeconds = 0;
        isSessionRunning = true;
        
        toggleSessionBtn.innerText = 'Stop Session';
        toggleSessionBtn.classList.add('running');
        
        playAlert();
        setTrainingState('active'); 
        
        timerInterval = setInterval(() => {
            sessionSeconds++;
            stateSeconds++;
            updateTimersDisplay();
            
            if (currentTrainingState === 'rest' && stateSeconds > MAX_RECOVERY_PERIOD) {
                setTrainingState('reset');
            }
        }, 1000);
    }
});

function handleDisconnect() {
    clearTimeout(heartbeatTimeout);
    releaseWakeLock();
    stopSession();
    document.body.classList.remove('connected');
    document.getElementById('heartRateDisplay').innerText = '--';
    log('❌ Connection lost. Ready to reconnect.', true);
}

function resetTimeout() {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
        if (bluetoothDevice && bluetoothDevice.gatt.connected) {
            bluetoothDevice.gatt.disconnect();
        } else { handleDisconnect(); }
    }, 3000);
}

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

        // Put the warning on the screen BEFORE the browser attempts the action that causes the freeze
        log('4. Starting live notifications...\n\n⚠️ TIP: If the app freezes on this step, Android is blocking the data. Please completely close the Polar Flow app (or other paired apps), toggle your phone\'s Bluetooth off and on, and try again.');

        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        
        log('✅ Success! Waiting for first heartbeat...');
        document.body.classList.add('connected');
        requestWakeLock();
        
    } catch (error) { 
        let errorMsg = '❌ Error: ' + error.message;
        errorMsg += '\n\n💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device.';
        log(errorMsg, true); 
    }
});
            

function handleHeartRate(event) {
    resetTimeout();

    const value = event.target.value;
    const flags = value.getUint8(0);
    const is16Bit = flags & 0x01;
    let heartRate = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
    
    document.getElementById('heartRateDisplay').innerText = heartRate;

    if (!isSessionRunning) return; 

    if (currentTrainingState === 'active') {
        if (heartRate >= ACTIVE_THRESHOLD) consecutiveHighActive++;
        else consecutiveHighActive = 0;

        if (heartRate < (RESTING_HR - 10)) consecutiveLowActive++;
        else consecutiveLowActive = 0;

        if (consecutiveHighActive >= 3) setTrainingState('rest');
        else if (consecutiveLowActive >= 3) setTrainingState('reset');
    } 
    else if (currentTrainingState === 'rest') {
        if (heartRate <= REST_THRESHOLD) consecutiveLowRest++;
        else consecutiveLowRest = 0;

        if (heartRate > restMaxHR) {
            restMaxHR = heartRate;
            timeOfRestMaxHR = stateSeconds;
        }

        if (timeOfRestMaxHR > MAX_RESPONSE_LAG) {
            setTrainingState('reset');
        } else if (consecutiveLowRest >= 3) {
            setTrainingState('active'); 
        }
    } 
    else if (currentTrainingState === 'reset') {
        if (heartRate >= (RESTING_HR - 5) && heartRate <= (RESTING_HR + 10)) {
            consecutiveRangeReset++;
        } else {
            consecutiveRangeReset = 0;
        }

        if (consecutiveRangeReset >= 15) {
            setTrainingState('active');
        }
    }
          }
                           
