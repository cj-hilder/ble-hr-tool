// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// Settings constants are declared and loaded from localStorage by settings.js

// --- Speedometer geometry ---
const SPEEDO_CX = 100;
const SPEEDO_CY = 100;
const SPEEDO_CIRCLE_R = 60;
const SPEEDO_NEEDLE_INNER_R = 61;
const SPEEDO_NEEDLE_OUTER_R = 68;
const SPEEDO_ARC_R = 69;
const SPEEDO_START_DEG = 112.5;
const SPEEDO_SWEEP_DEG = 315;

let latestHR = 0;

// --- HR History Graph ---
const hrHistory = [];
const HR_HISTORY_MS = 90000;

function recordHrHistory(hr) {
    const now = Date.now();
    hrHistory.push({ hr, state: currentState, ts: now });
    const cutoff = now - HR_HISTORY_MS;
    while (hrHistory.length > 0 && hrHistory[0].ts < cutoff) hrHistory.shift();
    drawHrGraph();
}

function drawHrGraph() {
    const canvas = document.getElementById('hrGraphCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.7;
    if (hrHistory.length < 2) return;
    const now = Date.now();
    const windowStart = Math.max(hrHistory[0].ts, now - HR_HISTORY_MS);
    function toX(ts) { return ((ts - windowStart) / HR_HISTORY_MS) * W; }
    function toY(hr)  { return H - (hr / MAX_HR) * H; }
    ctx.strokeStyle = hrHistory[0].state === 'active' ? 'black' : 'white';
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const GAP_HALF = 2.0;
    ctx.beginPath();
    let pathStarted = false, prevState = null;
    for (let i = 0; i < hrHistory.length; i++) {
        const { hr, state, ts } = hrHistory[i];
        const x = toX(ts), y = toY(hr);
        const isStateChange = prevState !== null && state !== prevState;
        if (isStateChange) {
            ctx.stroke();
            ctx.strokeStyle = state === 'active' ? 'black' : 'white';
            ctx.beginPath(); ctx.moveTo(x + GAP_HALF, y); pathStarted = true;
        } else if (!pathStarted) {
            ctx.moveTo(x, y); pathStarted = true;
        } else {
            const nextBreaks = i < hrHistory.length - 1 && hrHistory[i + 1].state !== state;
            ctx.lineTo(nextBreaks ? x - GAP_HALF : x, y);
        }
        prevState = state;
    }
    ctx.stroke();
}

function _hrToSvgDeg(hr) {
    return SPEEDO_START_DEG + (Math.max(0, Math.min(hr, MAX_HR)) / MAX_HR) * SPEEDO_SWEEP_DEG;
}
function _polarXY(r, deg) {
    const rad = deg * Math.PI / 180;
    return { x: SPEEDO_CX + r * Math.cos(rad), y: SPEEDO_CY + r * Math.sin(rad) };
}
function _arcPath(startDeg, endDeg) {
    const s = _polarXY(SPEEDO_ARC_R, startDeg), e = _polarXY(SPEEDO_ARC_R, endDeg);
    const sweep = ((endDeg - startDeg) + 360) % 360;
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${SPEEDO_ARC_R} ${SPEEDO_ARC_R} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}
function updateSpeedometer(hr) {
    latestHR = hr;
    const angleDeg = _hrToSvgDeg(hr);
    const p1 = _polarXY(SPEEDO_NEEDLE_INNER_R, angleDeg), p2 = _polarXY(SPEEDO_NEEDLE_OUTER_R, angleDeg);
    const needle = document.getElementById('speedoNeedle');
    needle.setAttribute('x1', p1.x.toFixed(2)); needle.setAttribute('y1', p1.y.toFixed(2));
    needle.setAttribute('x2', p2.x.toFixed(2)); needle.setAttribute('y2', p2.y.toFixed(2));
    let zoneMin, zoneMax;
    if (currentState === 'reset' || currentState === 'stopped' || currentState === 'pause') {
        zoneMin = RESTING_HR - RESTING_HR_BANDWIDTH / 2; zoneMax = RESTING_HR + RESTING_HR_BANDWIDTH / 2;
    } else { zoneMin = TARGET_MIN_HR; zoneMax = TARGET_MAX_HR; }
    const arc = document.getElementById('speedoArc');
    arc.setAttribute('d', _arcPath(_hrToSvgDeg(zoneMin), _hrToSvgDeg(zoneMax)));
    arc.setAttribute('stroke-width', (hr >= zoneMin && hr <= zoneMax) ? '1' : '4');
}

// ─── State variables ─────────────────────────────────────────────────────────
let bluetoothDevice;
let isSessionRunning = false, isReconnecting = false, isManualDisconnect = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let currentState = 'stopped';
let sessionInterval, wakeLock = null, heartbeatTimeout;

const SESSION_KEY = 'hrPacerSession';
const HISTORY_KEY = 'hrPacerHistory';

let sessionStartTime = 0, sessionSeconds = 0, stateSeconds = 0;
let recoverySeconds = 0, totalActiveSeconds = 0, resetCount = 0;
let activeToRestCount = 0, activeToResetCount = 0, restToActiveCount = 0, resetToActiveCount = 0;
let maxHrInRest = 0, timeOfMaxHrInRest = 0, isRecoveryState = false;

// ─── Period Tracking ──────────────────────────────────────────────────────────
let activePeriods   = [];  // [{startSec,endSec,duration,avgHr}]
let recoveryPeriods = [];  // [{startSec,endSec,duration,avgHr,maxHr,lagSec}]
let currentPeriodType  = null;  // 'active' | 'recovery' | null
let currentPeriodStart = 0;
let currentPeriodHrSamples = [];
let sessionHrSamples = [];
let pendingSummary = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const logElement = document.getElementById('log');
function log(message, isError = false) {
    logElement.innerHTML = message;
    if (isError) logElement.classList.add('error'); else logElement.classList.remove('error');
}
function formatTime(s) {
    s = Math.max(0, Math.round(s));
    if (s >= 3600) {
        return String(Math.floor(s/3600)).padStart(2,'0') + ':' +
               String(Math.floor((s%3600)/60)).padStart(2,'0') + ':' +
               String(s%60).padStart(2,'0');
    }
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0');
}
function setTimerDisplay(el, seconds) {
    el.innerText = formatTime(seconds);
    el.classList.toggle('long-time', seconds >= 3600);
}
function arrAvg(arr) {
    return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

// ─── Period helpers ───────────────────────────────────────────────────────────
function openActivePeriod() {
    currentPeriodType = 'active'; currentPeriodStart = sessionSeconds; currentPeriodHrSamples = [];
}
function closeActivePeriod() {
    if (currentPeriodType !== 'active') return;
    activePeriods.push({ startSec: currentPeriodStart, endSec: sessionSeconds,
        duration: Math.max(0, sessionSeconds - currentPeriodStart), avgHr: arrAvg(currentPeriodHrSamples) });
    currentPeriodType = null; currentPeriodHrSamples = [];
}
function openRecoveryPeriod() {
    currentPeriodType = 'recovery'; currentPeriodStart = sessionSeconds; currentPeriodHrSamples = [];
}
function closeRecoveryPeriod() {
    if (currentPeriodType !== 'recovery') return;
    recoveryPeriods.push({ startSec: currentPeriodStart, endSec: sessionSeconds,
        duration: Math.max(0, sessionSeconds - currentPeriodStart), avgHr: arrAvg(currentPeriodHrSamples),
        maxHr: maxHrInRest, lagSec: timeOfMaxHrInRest });
    currentPeriodType = null; currentPeriodHrSamples = [];
}

// ─── Session persistence ──────────────────────────────────────────────────────
function saveSession() {
    if (!isSessionRunning) return;
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            sessionStartTime, sessionSeconds, stateSeconds, recoverySeconds,
            totalActiveSeconds, resetCount, isRecoveryState, maxHrInRest, timeOfMaxHrInRest, currentState,
            activePeriods, recoveryPeriods,
            currentPeriodType, currentPeriodStart,
            sessionHrMin: sessionHrSamples.length ? Math.min(...sessionHrSamples) : 0,
            sessionHrMax: sessionHrSamples.length ? Math.max(...sessionHrSamples) : 0,
            sessionHrSum: sessionHrSamples.reduce((a,b)=>a+b, 0),
            sessionHrCount: sessionHrSamples.length,
        }));
    } catch (e) {}
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function restoreSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        sessionStartTime = s.sessionStartTime; sessionSeconds = s.sessionSeconds;
        stateSeconds = s.stateSeconds; recoverySeconds = s.recoverySeconds;
        totalActiveSeconds = s.totalActiveSeconds; resetCount = s.resetCount;
        isRecoveryState = s.isRecoveryState; maxHrInRest = s.maxHrInRest;
        timeOfMaxHrInRest = s.timeOfMaxHrInRest; currentState = s.currentState;
        activePeriods = s.activePeriods || []; recoveryPeriods = s.recoveryPeriods || [];
        currentPeriodType = s.currentPeriodType || null; currentPeriodStart = s.currentPeriodStart || 0;
        currentPeriodHrSamples = [];
        const cnt = s.sessionHrCount || 0;
        if (cnt > 0) {
            const avg = Math.round(s.sessionHrSum / cnt);
            sessionHrSamples = [s.sessionHrMin, s.sessionHrMax];
            for (let i = 0; i < cnt - 2; i++) sessionHrSamples.push(avg);
        } else { sessionHrSamples = []; }
        isSessionRunning = true; return true;
    } catch (e) { return false; }
}
function restoreSessionUI() {
    setTimerDisplay(document.getElementById('stateTimerDisplay'),       stateSeconds);
    setTimerDisplay(document.getElementById('sessionTimerDisplay'),     sessionSeconds);
    setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), totalActiveSeconds);
    if (maxHrInRest > 0) {
        document.getElementById('maxHrDisplay').innerText = maxHrInRest;
        setTimerDisplay(document.getElementById('lagDisplay'), timeOfMaxHrInRest);
    } else {
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
    }
    document.getElementById('stateIndicator').className = `state-dot ${currentState}`;
    updateSpeedometer(0);
    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn = document.getElementById('toggleSessionBtn');
    toggleBtn.classList.add('running');
    if (currentState === 'active') {
        descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (currentState === 'rest') {
        descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (currentState === 'reset') {
        manualResetBtn.innerHTML = '&#9654;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
        descEl.style.color = '#dc3545';
    } else if (currentState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none'; toggleBtn.innerText = 'Resume session'; toggleBtn.classList.add('paused');
    }
    document.getElementById('homeBtn').style.display = 'none';
}

async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }
    catch (err) { console.log('Wake Lock Error:', err); }
}

function resetTimeout() {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = setTimeout(() => {
        if (isReconnecting) return;
        if (bluetoothDevice && bluetoothDevice.gatt.connected) bluetoothDevice.gatt.disconnect();
        else handleDisconnect();
    }, 3000);
}

let audioCtx;
function triggerNotification() {
    if ('vibrate' in navigator) navigator.vibrate([300, 100, 300]);
    try {
        if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; audioCtx = new AC(); }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(500, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) { console.log('Audio notification failed:', e); }
}

// ─── Core state machine ───────────────────────────────────────────────────────
function switchState(newState, isManual) {
    if (currentState === newState && newState !== 'stopped') return;
    const prevState = currentState;

    // Period tracking
    if (newState === 'active') {
        if (currentPeriodType === 'recovery') closeRecoveryPeriod();
        else if (currentPeriodType === 'active') closeActivePeriod();
        openActivePeriod();
    } else if (newState === 'rest') {
        if (currentPeriodType === 'active') closeActivePeriod();
        else if (currentPeriodType === 'recovery') closeRecoveryPeriod();
        openRecoveryPeriod();
    } else if (newState === 'reset') {
        if (prevState === 'active') {
            if (currentPeriodType === 'active') closeActivePeriod();
            openRecoveryPeriod();
        }
        // prevState === 'rest': recovery period continues uninterrupted
    } else if (newState === 'pause' || newState === 'stopped') {
        if (currentPeriodType === 'active') closeActivePeriod();
        else if (currentPeriodType === 'recovery') closeRecoveryPeriod();
    }

    if (newState !== 'pause') isRecoveryState = false;
    if (newState === 'reset') {
        if (!isManual) resetCount++;
        if (prevState === 'rest') isRecoveryState = true;
    }

    currentState = newState;
    stateSeconds = 0;
    setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
    if (isSessionRunning) saveSession();

    activeToRestCount = 0; activeToResetCount = 0; restToActiveCount = 0; resetToActiveCount = 0;

    if (newState === 'rest') {
        maxHrInRest = 0; timeOfMaxHrInRest = 0; isRecoveryState = true; recoverySeconds = 0;
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
    }

    document.getElementById('stateIndicator').className = `state-dot ${newState}`;
    updateSpeedometer(latestHR);
    if (newState !== 'pause') triggerNotification();

    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn = document.getElementById('toggleSessionBtn');
    if (newState === 'active') {
        descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (newState === 'rest') {
        descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (newState === 'reset') {
        manualResetBtn.innerHTML = '&#9654;'; manualResetBtn.style.display = 'flex';
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
        descEl.style.color = '#dc3545';
    } else if (newState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none'; toggleBtn.innerText = 'Resume session'; toggleBtn.classList.add('paused');
    } else { descEl.innerText = ''; }
}

function updateTimers(increment) {
    sessionSeconds += increment; stateSeconds += increment;
    if (isRecoveryState) recoverySeconds += increment;
    if (currentState === 'active') {
        totalActiveSeconds += increment;
        setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), totalActiveSeconds);
    }
    if (currentState === 'rest') {
        if (stateSeconds > MAX_RECOVERY_PERIOD) switchState('reset', false);
        else if (timeOfMaxHrInRest > MAX_RESPONSE_LAG) switchState('reset', false);
    }
    setTimerDisplay(document.getElementById('sessionTimerDisplay'), sessionSeconds);
    setTimerDisplay(document.getElementById('stateTimerDisplay'),   stateSeconds);
}

function handleTick() {
    const trueSessionSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    updateTimers(trueSessionSeconds - sessionSeconds);
    saveSession();
}

function handleHeartRate(event) {
    if (isReconnecting) return;
    const flags = event.target.value.getUint8(0);
    const is16bit = flags & 0x01;
    const currentHeartRate = is16bit ? event.target.value.getUint16(1, true) : event.target.value.getUint8(1);
    document.getElementById('heartRateDisplay').innerText = currentHeartRate;
    resetTimeout();
    if (currentHeartRate === 0) return;
    updateSpeedometer(currentHeartRate);
    recordHrHistory(currentHeartRate);

    if (isSessionRunning) {
        if (currentPeriodType !== null) currentPeriodHrSamples.push(currentHeartRate);
        sessionHrSamples.push(currentHeartRate);

        if (isRecoveryState) {
            if (currentHeartRate >= maxHrInRest) {
                maxHrInRest = currentHeartRate; timeOfMaxHrInRest = recoverySeconds;
                document.getElementById('maxHrDisplay').innerText = maxHrInRest;
                setTimerDisplay(document.getElementById('lagDisplay'), timeOfMaxHrInRest);
            }
        }

        if (currentState === 'active') {
            if (currentHeartRate >= ACTIVE_THRESHOLD_UPPER) { activeToRestCount++; activeToResetCount = 0; }
            else if (currentHeartRate < BRADYCARDIA_THRESHOLD) { activeToResetCount++; activeToRestCount = 0; }
            else { activeToRestCount = 0; activeToResetCount = 0; }
            if (activeToRestCount >= 3) switchState('rest', false);
            else if (activeToResetCount >= 3) switchState('reset', false);
        } else if (currentState === 'rest') {
            if (currentHeartRate < ACTIVE_THRESHOLD_LOWER) restToActiveCount++; else restToActiveCount = 0;
            if (restToActiveCount >= 7) switchState('active', false);
        } else if (currentState === 'reset') {
            const lo = RESTING_HR - RESTING_HR_BANDWIDTH / 2, hi = RESTING_HR + RESTING_HR_BANDWIDTH / 2;
            if (currentHeartRate >= lo && currentHeartRate <= hi) resetToActiveCount++; else resetToActiveCount = 0;
            if (resetToActiveCount >= 15) switchState('active', false);
        }
    }
}

// ─── Session summary ──────────────────────────────────────────────────────────
function computeSessionSummary() {
    const aDur = activePeriods.map(p => p.duration);
    const aHr  = activePeriods.map(p => p.avgHr).filter(v => v > 0);
    const rDur = recoveryPeriods.map(p => p.duration);
    const rHr  = recoveryPeriods.map(p => p.avgHr).filter(v => v > 0);
    const valid = recoveryPeriods.filter(p => p.maxHr > 0);
    const lags  = valid.map(p => p.lagSec);
    const peaks = valid.map(p => p.maxHr);
    const totalRecoverySec = rDur.reduce((a, b) => a + b, 0);
    return {
        date: new Date().toISOString(),
        // Active
        totalActiveSec: totalActiveSeconds,
        pctActive: sessionSeconds > 0 ? Math.round(totalActiveSeconds / sessionSeconds * 100) : 0,
        numActivePeriods: activePeriods.length,
        longestActiveSec:  aDur.length ? Math.max(...aDur) : 0,
        avgActiveSec:      aDur.length ? Math.round(arrAvg(aDur)) : 0,
        shortestActiveSec: aDur.length ? Math.min(...aDur) : 0,
        avgHrActive: aHr.length ? arrAvg(aHr) : 0,
        // Recovery
        totalRecoverySec,
        pctRecovery: sessionSeconds > 0 ? Math.round(totalRecoverySec / sessionSeconds * 100) : 0,
        numRecoveryPeriods: recoveryPeriods.length,
        longestRecoverySec:  rDur.length ? Math.max(...rDur) : 0,
        avgRecoverySec:      rDur.length ? Math.round(arrAvg(rDur)) : 0,
        shortestRecoverySec: rDur.length ? Math.min(...rDur) : 0,
        avgHrRecovery: rHr.length ? arrAvg(rHr) : 0,
        // Lag & peak
        longestLagSec:  lags.length ? Math.max(...lags)  : 0,
        avgLagSec:      lags.length ? Math.round(arrAvg(lags)) : 0,
        shortestLagSec: lags.length ? Math.min(...lags)  : 0,
        highestPeakHr:  peaks.length ? Math.max(...peaks) : 0,
        avgPeakHr:      peaks.length ? arrAvg(peaks)      : 0,
        lowestPeakHr:   peaks.length ? Math.min(...peaks) : 0,
        // Session
        sessionLengthSec: sessionSeconds,
        highestHr: sessionHrSamples.length ? Math.max(...sessionHrSamples) : 0,
        avgHr:     sessionHrSamples.length ? arrAvg(sessionHrSamples)      : 0,
        lowestHr:  sessionHrSamples.length ? Math.min(...sessionHrSamples) : 0,
    };
}

function showSummaryModal(summary) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    const fmtT = s => s > 0 ? formatTime(s) : '--';
    const fmtN = n => n > 0 ? n : '--';
    set('s-totalActive',    fmtT(summary.totalActiveSec));
    set('s-pctActive',      summary.numActivePeriods > 0 ? summary.pctActive + '%' : '--');
    set('s-numActive',      fmtN(summary.numActivePeriods));
    set('s-longestActive',  fmtT(summary.longestActiveSec));
    set('s-avgActive',      fmtT(summary.avgActiveSec));
    set('s-shortestActive', fmtT(summary.shortestActiveSec));
    set('s-avgHrActive',    fmtN(summary.avgHrActive));
    set('s-totalRecovery',    fmtT(summary.totalRecoverySec));
    set('s-pctRecovery',      summary.numRecoveryPeriods > 0 ? summary.pctRecovery + '%' : '--');
    set('s-numRecovery',      fmtN(summary.numRecoveryPeriods));
    set('s-longestRecovery',  fmtT(summary.longestRecoverySec));
    set('s-avgRecovery',      fmtT(summary.avgRecoverySec));
    set('s-shortestRecovery', fmtT(summary.shortestRecoverySec));
    set('s-avgHrRecovery',    fmtN(summary.avgHrRecovery));
    set('s-longestLag',  fmtT(summary.longestLagSec));
    set('s-avgLag',      fmtT(summary.avgLagSec));
    set('s-shortestLag', fmtT(summary.shortestLagSec));
    set('s-highestPeak', fmtN(summary.highestPeakHr));
    set('s-avgPeak',     fmtN(summary.avgPeakHr));
    set('s-lowestPeak',  fmtN(summary.lowestPeakHr));
    set('s-sessionLength', fmtT(summary.sessionLengthSec));
    set('s-highestHr',     fmtN(summary.highestHr));
    set('s-avgHr',         fmtN(summary.avgHr));
    set('s-lowestHr',      fmtN(summary.lowestHr));
    document.getElementById('summaryNotes').value = '';
    document.getElementById('summaryModal').classList.add('visible');
}

function saveSessionToHistory(summary, notes) {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const history = raw ? JSON.parse(raw) : [];
        history.push({ ...summary, notes });
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { console.error('Failed to save session history', e); }
}

function finishSession() {
    if (currentPeriodType === 'active') closeActivePeriod();
    else if (currentPeriodType === 'recovery') closeRecoveryPeriod();
    clearInterval(sessionInterval);
    isSessionRunning = false;
    pendingSummary = computeSessionSummary();
    showSummaryModal(pendingSummary);
}

function teardownSession() {
    const toggleBtn = document.getElementById('toggleSessionBtn');
    toggleBtn.innerText = 'Start Session'; toggleBtn.classList.remove('running', 'paused');
    document.getElementById('manualResetBtn').style.display = 'none';
    clearSession();
    document.getElementById('homeBtn').style.display = 'flex';
    switchState('stopped', true);
    if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
}

// ─── Disconnect / Reconnect ───────────────────────────────────────────────────
function handleDisconnect() {
    if (isManualDisconnect) { isManualDisconnect = false; return; }
    clearTimeout(heartbeatTimeout);
    if (isSessionRunning && !isReconnecting) startReconnect();
    else if (!isSessionRunning) {
        log('❌ Disconnected from device. Refresh the page to reconnect.', true);
        document.body.classList.remove('connected');
        if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
    }
}

function startReconnect() {
    isReconnecting = true; reconnectAttempts = 0;
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
        isReconnecting = false; isSessionRunning = false;
        document.getElementById('stateIndicator').classList.remove('reconnecting');
        document.getElementById('toggleSessionBtn').innerText = 'Start Session';
        document.getElementById('toggleSessionBtn').classList.remove('running');
        document.getElementById('manualResetBtn').style.display = 'none';
        document.body.classList.remove('connected');
        log('❌ Could not reconnect after 10 attempts. Session ended.', true);
        switchState('stopped', true);
        if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
        return;
    }
    try {
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        onReconnectSuccess();
    } catch (err) { setTimeout(attemptReconnect, 3000); }
}

function onReconnectSuccess() {
    isReconnecting = false; reconnectAttempts = 0;
    document.getElementById('stateIndicator').classList.remove('reconnecting');
    const descEl = document.getElementById('stateDescription');
    if (currentState === 'active')      { descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745'; }
    else if (currentState === 'rest')   { descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14'; }
    else if (currentState === 'reset')  { descEl.innerText = resetCount >= 3 ? 'Finish this session ASAP' : 'Reset to resting HR'; descEl.style.color = '#dc3545'; }
    else if (currentState === 'pause')  { descEl.innerText = 'Pause activity'; descEl.style.color = '#888888'; }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('manualResetBtn').addEventListener('click', () => {
    if (!isSessionRunning) return;
    if (currentState === 'reset') switchState('active', true);
    else if (currentState === 'active' || currentState === 'rest') switchState('reset', true);
});

document.getElementById('toggleSessionBtn').addEventListener('click', () => {
    if (!isSessionRunning) {
        isSessionRunning = true; sessionSeconds = 0; sessionStartTime = Date.now();
        stateSeconds = 0; totalActiveSeconds = 0; resetCount = 0; recoverySeconds = 0;
        activePeriods = []; recoveryPeriods = []; currentPeriodType = null; sessionHrSamples = [];
        document.getElementById('homeBtn').style.display = 'none';
        setTimerDisplay(document.getElementById('sessionTimerDisplay'), 0);
        setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
        setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), 0);
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
        document.getElementById('toggleSessionBtn').classList.add('running');
        switchState('active', true);
        sessionInterval = setInterval(handleTick, 1000);
        return;
    }
    if (currentState === 'pause') { switchState('active', true); return; }
    document.getElementById('sessionModal').classList.add('visible');
});

document.getElementById('modalPauseBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
    switchState('pause', true);
});

document.getElementById('modalEndBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
    finishSession();
});

document.getElementById('modalCancelBtn').addEventListener('click', () => {
    document.getElementById('sessionModal').classList.remove('visible');
});

document.getElementById('summarySaveBtn').addEventListener('click', () => {
    const notes = document.getElementById('summaryNotes').value.trim();
    if (pendingSummary) saveSessionToHistory(pendingSummary, notes);
    pendingSummary = null;
    document.getElementById('summaryModal').classList.remove('visible');
    teardownSession();
});

document.getElementById('summaryDiscardBtn').addEventListener('click', () => {
    pendingSummary = null;
    document.getElementById('summaryModal').classList.remove('visible');
    teardownSession();
});

document.getElementById('homeBtn').addEventListener('click', () => {
    isManualDisconnect = true;
    document.body.classList.remove('connected');
    document.getElementById('homeBtn').style.display = 'none';
    if (bluetoothDevice && bluetoothDevice.gatt.connected) bluetoothDevice.gatt.disconnect();
    else isManualDisconnect = false;
});

document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        log('1. Waiting for you to select a device...');
        bluetoothDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnect);
        log('2. Connecting to Bluetooth server...');
        const server = await bluetoothDevice.gatt.connect();
        log('3. Requesting Heart Rate data...');
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');
        log('4. Starting live notifications...<br><br>⚠️ TIP: If the app freezes here, the connection is stuck. Try:<br>1. Closing the watch app on your phone (e.g. Polar Flow).<br>2. Unpairing the phone from inside the watch settings menu.');
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        log('✅ Success! Waiting for first heartbeat...');
        document.body.classList.add('connected');
        requestWakeLock();
        const restored = restoreSession();
        if (restored) { restoreSessionUI(); sessionInterval = setInterval(handleTick, 1000); }
        else document.getElementById('homeBtn').style.display = 'flex';
    } catch (error) {
        log('❌ Error: ' + error.message + '<br><br>💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device.', true);
    }
});

document.addEventListener('DOMContentLoaded', () => { updateSpeedometer(0); tryAutoReconnect(); });

async function tryAutoReconnect() {
    const restored = restoreSession();
    if (!restored) return;
    document.body.classList.add('connected');
    restoreSessionUI();
    sessionInterval = setInterval(handleTick, 1000);
    requestWakeLock();
    function fallbackToHome() { clearInterval(sessionInterval); document.body.classList.remove('connected'); }
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) { fallbackToHome(); return; }
    try {
        const devices = await navigator.bluetooth.getDevices();
        if (devices.length === 0) { fallbackToHome(); return; }
        bluetoothDevice = devices[0];
        bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnect);
        startReconnect();
    } catch (e) { fallbackToHome(); }
}
