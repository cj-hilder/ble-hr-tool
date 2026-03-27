// --- Service Worker Registration for PWA ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('Service Worker Error', err));
}

// Settings constants are declared and loaded from localStorage by settings.js

// --- Speedometer geometry ---
const SPEEDO_CX = 100, SPEEDO_CY = 100, SPEEDO_CIRCLE_R = 60;
const SPEEDO_NEEDLE_INNER_R = 61, SPEEDO_NEEDLE_OUTER_R = 68;
const SPEEDO_ARC_R = 69, SPEEDO_START_DEG = 112.5, SPEEDO_SWEEP_DEG = 315;

let latestHR = 0;

// --- HR History Graph ---
const hrHistory = [];
const HR_HISTORY_MS = 90000;

// --- Beat-to-beat RR history (from H10 or compatible sensor) ---
const rrHistory = [];   // { hr: instantaneous bpm, state, ts }
let hasRrData = false;  // true once valid RR intervals have been received

function recordRrHistory(rrValuesMs, notifTs) {
    // rrValuesMs: array of RR durations in ms, oldest first.
    // The last RR value ends at notifTs; work backwards to assign timestamps.
    let ts = notifTs;
    for (let i = rrValuesMs.length - 1; i >= 0; i--) {
        const instantHr = Math.round(60000 / rrValuesMs[i]);
        if (instantHr >= 24 && instantHr <= 240) {
            rrHistory.push({ hr: instantHr, state: currentState, ts });
        }
        ts -= rrValuesMs[i];
    }
    // Sort by ts in case of any ordering artefact, then trim to window
    rrHistory.sort((a, b) => a.ts - b.ts);
    const cutoff = notifTs - HR_HISTORY_MS;
    while (rrHistory.length > 0 && rrHistory[0].ts < cutoff) rrHistory.shift();
    hasRrData = true;
}

// Returns the best available HR history: beat-to-beat if fresh, else averaged.
function getActiveHrHistory() {
    if (hasRrData && rrHistory.length >= 2 && (Date.now() - rrHistory[rrHistory.length - 1].ts) < 5000) {
        return rrHistory;
    }
    return hrHistory;
}

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
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const now = Date.now();
    const activeHistory = getActiveHrHistory();
    const windowStart = activeHistory.length > 0
        ? Math.max(activeHistory[0].ts, now - HR_HISTORY_MS)
        : now - HR_HISTORY_MS;
    function toX(ts) { return ((ts - windowStart) / HR_HISTORY_MS) * W; }
    function toY(hr)  { return H - (hr / MAX_HR) * H; }

    // ── HR line (beat-to-beat if available, averaged as fallback) ─────────────
    if (activeHistory.length >= 2) {
        ctx.globalAlpha = 0.7;
        // Beat-to-beat data is drawn thinner since it has natural jaggedness
        ctx.lineWidth = hasRrData && activeHistory === rrHistory ? 1.5 : 3;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = activeHistory[0].state === 'active' ? 'black' : 'white';
        const GAP_HALF = 2.0;
        ctx.beginPath();
        let pathStarted = false, prevState = null;
        for (let i = 0; i < activeHistory.length; i++) {
            const { hr, state, ts } = activeHistory[i];
            const x = toX(ts), y = toY(hr);
            const isStateChange = prevState !== null && state !== prevState;
            if (isStateChange) {
                ctx.stroke();
                ctx.strokeStyle = state === 'active' ? 'black' : 'white';
                ctx.beginPath(); ctx.moveTo(x + GAP_HALF, y); pathStarted = true;
            } else if (!pathStarted) {
                ctx.moveTo(x, y); pathStarted = true;
            } else {
                const nextBreaks = i < activeHistory.length - 1 && activeHistory[i + 1].state !== state;
                ctx.lineTo(nextBreaks ? x - GAP_HALF : x, y);
            }
            prevState = state;
        }
        ctx.stroke();
    }

    // ── RFB breathing guide overlay ───────────────────────────────────────────
    const rfbResting = (typeof RESTING_HR !== 'undefined') ? RESTING_HR : 65;
    if (currentState === 'reset' && (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED && rfbWallStartTime > 0) {
        const breathPeriodMs = rfbBreathPeriodMs();
        const inhaleFrac     = rfbGetInhaleFrac();
        const amplitude = 8; // ±8 bpm visual range
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let px = 0; px <= W; px++) {
            const ts = windowStart + (px / W) * HR_HISTORY_MS;
            const elapsed = ts - rfbWallStartTime;
            const phase = ((elapsed % breathPeriodMs) + breathPeriodMs) % breathPeriodMs / breathPeriodMs;
            const sineVal = rfbAsymSine(phase, inhaleFrac);
            const y = toY(rfbResting + sineVal * amplitude);
            if (px === 0) ctx.moveTo(0, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
    }
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

// ─── RFB (Resonance Frequency Breathing) ─────────────────────────────────────
let rfbPhase = false;
let rfbSecondsRemaining = 0;
let rfbWallStartTime = 0;      // phase anchor: set once per session, never reset between RFB periods
let rfbSessionClockStart = 0;  // Date.now() of the very first RFB entry this session (0 = not yet started)
let rfbAnimFrame = null;
let rfbScheduleTimer = null;
let rfbAudioNodes = null;

// Breath timing helpers — read live globals so changes take effect immediately.
function rfbBreathPeriodMs() {
    const i = (typeof RFB_INHALE_SEC !== 'undefined' && RFB_INHALE_SEC > 0) ? RFB_INHALE_SEC : 5;
    const e = (typeof RFB_EXHALE_SEC !== 'undefined' && RFB_EXHALE_SEC > 0) ? RFB_EXHALE_SEC : 5;
    return (i + e) * 1000;
}
function rfbGetInhaleSec() {
    return (typeof RFB_INHALE_SEC !== 'undefined' && RFB_INHALE_SEC > 0) ? RFB_INHALE_SEC : 5;
}
function rfbGetExhaleSec() {
    return (typeof RFB_EXHALE_SEC !== 'undefined' && RFB_EXHALE_SEC > 0) ? RFB_EXHALE_SEC : 5;
}
function rfbGetInhaleFrac() {
    const i = rfbGetInhaleSec(), e = rfbGetExhaleSec();
    return i / (i + e);
}
// Asymmetric sine for the HR graph overlay: +1 at mid-inhale, −1 at mid-exhale, 0 at transitions.
function rfbAsymSine(phase, inhaleFrac) {
    if (inhaleFrac <= 0 || inhaleFrac >= 1) return Math.sin(phase * 2 * Math.PI);
    if (phase < inhaleFrac) return Math.sin((phase / inhaleFrac) * Math.PI);
    return -Math.sin(((phase - inhaleFrac) / (1 - inhaleFrac)) * Math.PI);
}
// Dot scale factor: 0 at inhale START (phase=0), peaks at 1 at inhale END (phase=inhaleFrac),
// falls back to 0 at exhale END (phase=1). This makes the dot minimum at every inhale start —
// exactly when sound/vibration begin — giving a clear, unambiguous sync cue.
function rfbScaleFactor(phase, inhaleFrac) {
    if (inhaleFrac <= 0 || inhaleFrac >= 1) return (Math.sin(phase * 2 * Math.PI - Math.PI / 2) + 1) / 2;
    if (phase < inhaleFrac) return Math.sin((phase / inhaleFrac) * Math.PI / 2);          // 0 → 1
    return Math.cos(((phase - inhaleFrac) / (1 - inhaleFrac)) * Math.PI / 2);             // 1 → 0
}

const SESSION_KEY       = 'hrPacerSession';
const HISTORY_KEY       = 'hrPacerHistory';
const LAST_ACTIVITY_KEY = 'hrPacerLastActivity';

let sessionStartTime = 0, sessionSeconds = 0, stateSeconds = 0;
let recoverySeconds = 0, totalActiveSeconds = 0, resetCount = 0;
let activeToRestCount = 0, activeToResetCount = 0, restToActiveCount = 0, resetToActiveCount = 0;
let maxHrInRest = 0, timeOfMaxHrInRest = 0, isRecoveryState = false;
let activityLimitTriggered = false;

// ─── Activity tracking ────────────────────────────────────────────────────────
let currentActivityId   = null;
let currentActivityName = null;

// ─── Period Tracking ──────────────────────────────────────────────────────────
let activePeriods   = [];
let recoveryPeriods = [];
let currentPeriodType  = null;  // 'active' | 'recovery' | null
const MIN_PERIOD_SEC = 5;  // periods shorter than this are excluded from all calculations
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
function closeActivePeriod(isTerminal = false) {
    if (currentPeriodType !== 'active') return;
    activePeriods.push({ startSec: currentPeriodStart, endSec: sessionSeconds,
        duration: Math.max(0, sessionSeconds - currentPeriodStart), avgHr: arrAvg(currentPeriodHrSamples),
        terminal: isTerminal });
    currentPeriodType = null; currentPeriodHrSamples = [];
}
function openRecoveryPeriod() {
    currentPeriodType = 'recovery'; currentPeriodStart = sessionSeconds; currentPeriodHrSamples = [];
}
function closeRecoveryPeriod(isTerminal = false) {
    if (currentPeriodType !== 'recovery') return;
    recoveryPeriods.push({ startSec: currentPeriodStart, endSec: sessionSeconds,
        duration: Math.max(0, sessionSeconds - currentPeriodStart), avgHr: arrAvg(currentPeriodHrSamples),
        maxHr: maxHrInRest, lagSec: timeOfMaxHrInRest, terminal: isTerminal });
    currentPeriodType = null; currentPeriodHrSamples = [];
}

// ─── Activity display ──────────────────────────────────────────────────────────
function updateActivityDisplay() {
    const el = document.getElementById('activityDisplay');
    if (!el) return;
    if (isSessionRunning && currentActivityName) {
        el.textContent = currentActivityName;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
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
            currentActivityId, currentActivityName,
            rfbPhase, rfbSecondsRemaining, rfbSessionClockStart,
            activityLimitTriggered,
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
        currentActivityId   = s.currentActivityId   || null;
        currentActivityName = s.currentActivityName || null;
        rfbPhase            = s.rfbPhase            || false;
        rfbSecondsRemaining = s.rfbSecondsRemaining || 0;
        rfbSessionClockStart = s.rfbSessionClockStart || 0;
        activityLimitTriggered = s.activityLimitTriggered || false;
        // Apply the restored activity's settings
        if (currentActivityId && window.activitiesAPI) {
            window.activitiesAPI.applySettings(currentActivityId);
        }
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
    updateActivityDisplay();
    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn = document.getElementById('toggleSessionBtn');
    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    toggleBtn.classList.add('running');
    if (currentState === 'active') {
        descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (currentState === 'rest') {
        descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (currentState === 'reset') {
        manualResetBtn.innerHTML = '&#9654;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        if (rfbOn) {
            document.getElementById('stateIndicator').className = 'state-dot reset-rfb';
            descEl.style.color = '#1a7fff';
            if (rfbPhase) {
                descEl.innerText = `RFB — ${formatTime(Math.ceil(rfbSecondsRemaining))} remaining`;
            } else {
                descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
            }
            startRfbAnimation();
        } else {
            descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
            descEl.style.color = '#dc3545';
        }
    } else if (currentState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none'; manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Resume session'; toggleBtn.classList.add('paused');
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
    const vibLevel  = (typeof ALERT_VIBRATION !== 'undefined') ? ALERT_VIBRATION : 1;
    const soundLevel = (typeof ALERT_SOUND    !== 'undefined') ? ALERT_SOUND     : 1;

    // Vibration
    if ('vibrate' in navigator) {
        if      (vibLevel === 1) navigator.vibrate([300, 100, 300]);
        else if (vibLevel === 2) navigator.vibrate([150, 60, 150, 60, 150, 60, 400]);
    }

    // Sound
    if (soundLevel === 0) return;
    try {
        if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; audioCtx = new AC(); }
        if (audioCtx.state === 'suspended') audioCtx.resume();

        if (soundLevel === 1) {
            // Subtle: single soft sine tone
            const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(500, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.5);
        } else if (soundLevel === 2) {
            // Intense: two sharp high-pitched beeps at full volume
            [0, 0.22].forEach(offset => {
                const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(1100, audioCtx.currentTime + offset);
                gain.gain.setValueAtTime(1.0, audioCtx.currentTime + offset);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + offset + 0.18);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(audioCtx.currentTime + offset);
                osc.stop(audioCtx.currentTime + offset + 0.18);
            });
        }
    } catch (e) { console.log('Audio notification failed:', e); }
}

// ─── Coherence Score ──────────────────────────────────────────────────────────
// Pearson correlation between actual beat-to-beat HR and the expected RFB sine.
// Requires RR data and an active rfbWallStartTime. Returns 0–1 or null.
function computeCoherence() {
    if (!hasRrData || rrHistory.length < 8) return null;
    if (!rfbWallStartTime || rfbWallStartTime === 0) return null;
    const breathPeriodMs = rfbBreathPeriodMs();
    const inhaleFrac     = rfbGetInhaleFrac();
    // Need at least 1.5 breath cycles of data to give a meaningful score
    const minWindowMs = breathPeriodMs * 1.5;
    const windowMs = Math.max(30000, minWindowMs);
    const cutoff = Date.now() - windowMs;
    const samples = rrHistory.filter(s => s.ts >= cutoff);
    if (samples.length < 8) return null;

    const actuals  = samples.map(s => s.hr);
    const expected = samples.map(s => {
        const elapsed = s.ts - rfbWallStartTime;
        const phase = ((elapsed % breathPeriodMs) + breathPeriodMs) % breathPeriodMs / breathPeriodMs;
        return rfbAsymSine(phase, inhaleFrac);
    });

    // Pearson r
    const meanA = actuals.reduce((a, b) => a + b, 0) / actuals.length;
    const meanE = expected.reduce((a, b) => a + b, 0) / expected.length;
    let num = 0, denomA = 0, denomE = 0;
    for (let i = 0; i < actuals.length; i++) {
        const da = actuals[i] - meanA, de = expected[i] - meanE;
        num += da * de; denomA += da * da; denomE += de * de;
    }
    if (denomA < 1e-9 || denomE < 1e-9) return null;
    const r = num / Math.sqrt(denomA * denomE);
    return Math.max(0, Math.min(1, r));
}

function updateCoherenceDisplay() {
    const el = document.getElementById('coherenceDisplay');
    const valEl = document.getElementById('coherenceValue');
    if (!el || !valEl) return;
    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    if (currentState !== 'reset' || !rfbOn || !hasRrData) {
        el.style.display = 'none'; return;
    }
    const c = computeCoherence();
    if (c === null) {
        // Not enough data yet — show a waiting state
        el.style.display = 'flex';
        valEl.textContent = '…';
        valEl.style.color = '#444';
        return;
    }
    const pct = Math.round(c * 100);
    let color;
    if      (pct >= 70) color = '#4af';          // good — blue (matching RFB theme)
    else if (pct >= 40) color = '#ffc107';        // fair — amber
    else                color = '#dc3545';        // low  — red
    el.style.display = 'flex';
    valEl.textContent = pct + '%';
    valEl.style.color = color;
}

// ─── RFB Inhale Sound & Vibration ─────────────────────────────────────────────
function buildInhaleVibration(inhaleSec) {
    // Pattern: opening pulse → accelerating buzz → closing pulse
    // Total duration fits within inhaleSec.
    const totalMs    = Math.round(inhaleSec * 1000);
    const openPulse  = 120, openGap = 40, closePulse = 120;
    const buzzMs     = totalMs - openPulse - openGap - closePulse;
    const pattern    = [openPulse, openGap];
    if (buzzMs > 0) {
        // Buzz cycles: period linearly interpolates from 200 ms → 60 ms (increasing frequency)
        const startPeriod = 200, endPeriod = 60;
        let elapsed = 0;
        while (elapsed < buzzMs - closePulse - 20) {
            const t      = Math.min(1, elapsed / buzzMs);
            const period = startPeriod + (endPeriod - startPeriod) * t;
            const on     = Math.max(15, Math.round(period * 0.55));
            const off    = Math.max(10, Math.round(period * 0.45));
            pattern.push(on, off);
            elapsed += on + off;
        }
    }
    pattern.push(closePulse);
    return pattern;
}

function startInhaleSound(inhaleSec) {
    stopInhaleSound();
    if (!(typeof RFB_SOUND !== 'undefined' && RFB_SOUND)) return;
    try {
        if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; audioCtx = new AC(); }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t  = audioCtx.currentTime;
        const dur = Math.max(0.3, inhaleSec);

        // White noise source (looped buffer)
        const bufLen = audioCtx.sampleRate * 2;
        const buf    = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data   = buf.getChannelData(0);
        // Pink-ish: apply a simple first-order filter while filling buffer
        let b0 = 0;
        for (let i = 0; i < bufLen; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + white * 0.0990460;
            data[i] = b0 * 3.5;   // crude pink approximation
        }
        const source = audioCtx.createBufferSource();
        source.buffer = buf; source.loop = true;

        // Bandpass filter — center frequency sweeps 180 Hz → 1600 Hz over inhale
        const bpf = audioCtx.createBiquadFilter();
        bpf.type = 'bandpass'; bpf.Q.value = 1.4;
        bpf.frequency.setValueAtTime(180, t);
        bpf.frequency.exponentialRampToValueAtTime(1600, t + dur);

        // High-shelf subtle brightness boost at top of inhale
        const shelf = audioCtx.createBiquadFilter();
        shelf.type = 'highshelf'; shelf.frequency.value = 1200;
        shelf.gain.setValueAtTime(0, t);
        shelf.gain.linearRampToValueAtTime(6, t + dur);

        // Gain envelope: fast attack, hold, fast release
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.001, t);
        gainNode.gain.exponentialRampToValueAtTime(0.38, t + Math.min(0.18, dur * 0.12));
        gainNode.gain.setValueAtTime(0.38, t + dur - Math.min(0.15, dur * 0.1));
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + dur);

        source.connect(bpf);
        bpf.connect(shelf);
        shelf.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(t);
        source.stop(t + dur);
        rfbAudioNodes = { source };
    } catch (e) { console.log('RFB inhale sound error:', e); }
}

function stopInhaleSound() {
    if (rfbAudioNodes) {
        try { rfbAudioNodes.source.stop(); } catch (e) {}
        rfbAudioNodes = null;
    }
}

function startInhaleVibration(inhaleSec) {
    if (!(typeof RFB_VIBRATION !== 'undefined' && RFB_VIBRATION)) return;
    if ('vibrate' in navigator) navigator.vibrate(buildInhaleVibration(inhaleSec));
}

// ─── RFB Timeout Scheduler ────────────────────────────────────────────────────
// Sound and vibration are scheduled using absolute time (rfbWallStartTime) so they
// stay locked to the same phase as the graph overlay and dot animation regardless
// of rAF jitter or tab backgrounding.
function rfbScheduleNextCycle() {
    clearTimeout(rfbScheduleTimer); rfbScheduleTimer = null;
    if (currentState !== 'reset' || !(typeof RFB_ENABLED !== 'undefined' && RFB_ENABLED)) return;

    const iSec     = rfbGetInhaleSec();
    const eSec     = rfbGetExhaleSec();
    const totalMs  = (iSec + eSec) * 1000;
    const inhaleMs = iSec * 1000;
    const elapsed  = Date.now() - rfbWallStartTime;
    const cycleIdx = Math.floor(elapsed / totalMs);
    const cyclePos = elapsed - cycleIdx * totalMs;   // ms into current cycle

    if (cyclePos < inhaleMs) {
        // Mid-inhale on first call (RFB just entered): fire sound for remaining inhale,
        // then schedule the next full inhale at the top of the next cycle.
        const remainingSec = (inhaleMs - cyclePos) / 1000;
        if (remainingSec > 0.25) {
            startInhaleSound(remainingSec);
            startInhaleVibration(iSec);   // always use full pattern — it self-terminates
        }
        const msToNextInhale = totalMs - cyclePos;
        rfbScheduleTimer = setTimeout(rfbScheduleNextCycle, msToNextInhale);
    } else {
        // In exhale: wait for next inhale start.
        const msToNextInhale = totalMs - cyclePos;
        rfbScheduleTimer = setTimeout(() => {
            if (currentState !== 'reset' || !(typeof RFB_ENABLED !== 'undefined' && RFB_ENABLED)) return;
            const dur = rfbGetInhaleSec();
            startInhaleSound(dur);
            startInhaleVibration(dur);
            // After this inhale ends, re-enter scheduler (will find us mid-exhale → schedule next)
            rfbScheduleTimer = setTimeout(rfbScheduleNextCycle, dur * 1000);
        }, msToNextInhale);
    }
}

// ─── RFB Breathing Animation ──────────────────────────────────────────────────
function startRfbAnimation() {
    stopRfbAnimation();
    // Use the session-persistent clock: set once on first RFB entry, never reset between periods.
    // This keeps the breath phase continuous across multiple RFB states in a session.
    if (rfbSessionClockStart === 0) rfbSessionClockStart = Date.now();
    rfbWallStartTime = rfbSessionClockStart;
    rfbScheduleNextCycle();

    function animate() {
        if (currentState !== 'reset' || !(typeof RFB_ENABLED !== 'undefined' && RFB_ENABLED)) {
            stopRfbAnimation(); return;
        }
        const indicator = document.getElementById('stateIndicator');
        if (!indicator) { rfbAnimFrame = requestAnimationFrame(animate); return; }

        const breathPeriodMs = rfbBreathPeriodMs();
        const inhaleFrac     = rfbGetInhaleFrac();
        const elapsed = Date.now() - rfbWallStartTime;
        const phase   = ((elapsed % breathPeriodMs) + breathPeriodMs) % breathPeriodMs / breathPeriodMs;

        // ── Dot scale: min at inhale start, max at exhale start, min at cycle end ──
        // rfbScaleFactor returns 0 at phase=0 (inhale start) and 1 at phase=inhaleFrac
        // (exhale start) — so sound/vibration, dot minimum, and graph zero-crossing
        // all coincide at phase=0.
        const sf    = rfbScaleFactor(phase, inhaleFrac);  // 0..1
        const scale = 1.0 + sf * 0.35;                   // 1.0..1.35

        // ── Flash at inhale start (dot smallest) and exhale start (dot largest) ──
        const flashZone = 0.022;
        const nearTrans = phase < flashZone || phase > (1 - flashZone) ||
                          Math.abs(phase - inhaleFrac) < flashZone;
        const brightness = nearTrans ? 1.8 : 1.0;

        indicator.style.transform = `scale(${scale.toFixed(3)})`;
        indicator.style.filter    = `brightness(${brightness})`;
        drawHrGraph();
        updateCoherenceDisplay();
        rfbAnimFrame = requestAnimationFrame(animate);
    }
    rfbAnimFrame = requestAnimationFrame(animate);
}

function stopRfbAnimation() {
    if (rfbAnimFrame) { cancelAnimationFrame(rfbAnimFrame); rfbAnimFrame = null; }
    clearTimeout(rfbScheduleTimer); rfbScheduleTimer = null;
    const indicator = document.getElementById('stateIndicator');
    if (indicator) { indicator.style.transform = ''; indicator.style.filter = ''; }
    stopInhaleSound();
    if ('vibrate' in navigator) navigator.vibrate(0);
}

// ─── Core state machine ───────────────────────────────────────────────────────
function switchState(newState, isManual) {
    if (currentState === newState && newState !== 'stopped') return;
    const prevState = currentState;

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

    // Stop RFB animation and clear RFB phase whenever leaving reset
    if (newState !== 'reset') {
        stopRfbAnimation();
        rfbPhase = false; rfbSecondsRemaining = 0;
        const cEl = document.getElementById('coherenceDisplay');
        if (cEl) cEl.style.display = 'none';
    }

    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    const indicatorClass = (newState === 'reset' && rfbOn) ? 'reset-rfb' : newState;
    document.getElementById('stateIndicator').className = `state-dot ${indicatorClass}`;
    updateSpeedometer(latestHR);
    if (newState !== 'pause') triggerNotification();

    const descEl = document.getElementById('stateDescription');
    const manualResetBtn = document.getElementById('manualResetBtn');
    const toggleBtn = document.getElementById('toggleSessionBtn');
    if (newState === 'active') {
        descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (newState === 'rest') {
        descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14';
        manualResetBtn.innerHTML = '&#8634;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
    } else if (newState === 'reset') {
        manualResetBtn.innerHTML = '&#9654;'; manualResetBtn.style.display = 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
        descEl.style.color = rfbOn ? '#1a7fff' : '#dc3545';
        if (rfbOn) startRfbAnimation();
    } else if (newState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none'; manualResetBtn.classList.remove('rfb');
        toggleBtn.innerText = 'Resume session'; toggleBtn.classList.add('paused');
    } else { descEl.innerText = ''; }
}

function updateTimers(increment) {
    sessionSeconds += increment; stateSeconds += increment;
    if (isRecoveryState) recoverySeconds += increment;
    if (currentState === 'active') {
        totalActiveSeconds += increment;
        setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), totalActiveSeconds);
        // Activity time limit check
        const limitSec = (typeof ACTIVE_TIME_LIMIT !== 'undefined') ? ACTIVE_TIME_LIMIT * 60 : 0;
        if (limitSec > 0 && !activityLimitTriggered && totalActiveSeconds >= limitSec) {
            activityLimitTriggered = true;
            switchState('reset', false);
            const descEl = document.getElementById('stateDescription');
            if (descEl) { descEl.innerText = 'Activity limit reached'; }
        }
    }
    if (currentState === 'rest') {
        if (stateSeconds > MAX_RECOVERY_PERIOD) switchState('reset', false);
        else if (timeOfMaxHrInRest > MAX_RESPONSE_LAG) switchState('reset', false);
    }
    // RFB hold-period countdown (entered after resting HR is achieved for 15 s)
    if (currentState === 'reset' && rfbPhase) {
        rfbSecondsRemaining -= increment;
        if (rfbSecondsRemaining <= 0) {
            rfbPhase = false;
            switchState('active', false);
        } else {
            const descEl = document.getElementById('stateDescription');
            if (descEl) {
                descEl.innerText = `RFB — ${formatTime(Math.ceil(rfbSecondsRemaining))} remaining`;
                descEl.style.color = '#1a7fff';
            }
        }
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
    const dv = event.target.value;
    const flags   = dv.getUint8(0);
    const is16bit = flags & 0x01;
    const currentHeartRate = is16bit ? dv.getUint16(1, true) : dv.getUint8(1);
    document.getElementById('heartRateDisplay').innerText = currentHeartRate;
    resetTimeout();
    if (currentHeartRate === 0) return;
    updateSpeedometer(currentHeartRate);

    // ── Parse RR intervals (bit 4 of flags; H10 and compatible sensors) ───────
    // Per BT Heart Rate spec: flags bit3 = Energy Expended present (skip 2 bytes),
    // flags bit4 = RR intervals present. Each RR is uint16 LE in units of 1/1024 s.
    const rrPresent      = (flags >> 4) & 0x01;
    const energyPresent  = (flags >> 3) & 0x01;
    if (rrPresent) {
        let rrOffset = is16bit ? 3 : 2;          // skip flags + HR bytes
        if (energyPresent) rrOffset += 2;        // skip Energy Expended uint16
        const rrValuesMs = [];
        while (rrOffset + 1 < dv.byteLength) {
            const raw  = dv.getUint16(rrOffset, true);  // 1/1024 s units
            const ms   = (raw / 1024) * 1000;
            if (ms > 250 && ms < 2500) rrValuesMs.push(ms); // 24–240 bpm sanity gate
            rrOffset += 2;
        }
        if (rrValuesMs.length > 0) recordRrHistory(rrValuesMs, Date.now());
    }

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
            if (resetToActiveCount >= 15) {
                const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
                const rfbDurMin = (typeof RFB_DURATION !== 'undefined') ? RFB_DURATION : 2.0;
                if (rfbOn && !rfbPhase && rfbDurMin > 0) {
                    // Enter RFB hold period — don't switch to active yet
                    rfbPhase = true;
                    rfbSecondsRemaining = rfbDurMin * 60;
                } else if (!rfbOn) {
                    switchState('active', false);
                }
                // If rfbPhase already true, updateTimers handles the countdown
            }
        }
    }
}

// ─── Session summary ──────────────────────────────────────────────────────────
function computeSessionSummary() {
    // Inclusion rules (applied separately to active and recovery):
    //   Rule 0: periods < MIN_PERIOD_SEC are excluded from everything.
    //   Rule 1: terminal period counts towards total time and towards max.
    //   Rule 2: terminal period does NOT count towards min.
    //   Rule 3: terminal period counts towards average ONLY if its duration >=
    //           the minimum duration of the non-terminal periods. If there are no
    //           non-terminal periods the terminal period is not averaged.
    //   Rule 4: count = number of periods that enter the average calculation.

    function periodStats(periods) {
        const valid       = periods.filter(p => p.duration >= MIN_PERIOD_SEC);
        const nonTerminal = valid.filter(p => !p.terminal);
        const terminal    = valid.find(p => p.terminal);  // at most one

        const total = valid.reduce((s, p) => s + p.duration, 0);

        const ntDur = nonTerminal.map(p => p.duration);
        const currentMin = ntDur.length ? Math.min(...ntDur) : Infinity;

        // Determine whether terminal joins the average pool
        const terminalInAvg = terminal && ntDur.length > 0 && terminal.duration >= currentMin;
        const avgPool = terminalInAvg ? [...nonTerminal, terminal] : nonTerminal;
        const maxPool = terminal       ? [...nonTerminal, terminal] : nonTerminal;

        const dur = avgPool.map(p => p.duration);
        const maxDur = maxPool.map(p => p.duration);

        return {
            total,
            count:   avgPool.length,
            longest: maxDur.length ? Math.max(...maxDur) : 0,
            shortest: ntDur.length ? Math.min(...ntDur)  : 0,
            avg:     dur.length   ? Math.round(arrAvg(dur)) : 0,
            avgHr:   avgPool.map(p => p.avgHr).filter(v => v > 0),
        };
    }

    function recoveryStats(periods) {
        const base    = periodStats(periods);
        const valid   = periods.filter(p => p.duration >= MIN_PERIOD_SEC);
        const nonTerm = valid.filter(p => !p.terminal);
        const terminal = valid.find(p => p.terminal);
        const ntDur = nonTerm.map(p => p.duration);
        const currentMin = ntDur.length ? Math.min(...ntDur) : Infinity;
        const termInAvg = terminal && ntDur.length > 0 && terminal.duration >= currentMin;
        const avgPool   = termInAvg ? [...nonTerm, terminal] : nonTerm;
        const validR = avgPool.filter(p => p.maxHr > 0);
        return {
            ...base,
            lags:  validR.map(p => p.lagSec),
            peaks: validR.map(p => p.maxHr),
        };
    }

    const aStats = periodStats(activePeriods);
    const rStats = recoveryStats(recoveryPeriods);

    return {
        date: new Date().toISOString(),
        activityName: currentActivityName || '',
        activityId:   currentActivityId   || '',
        activitySettings: window.activitiesAPI ? window.activitiesAPI.getSettingsSnapshot() : {},
        totalActiveSec:   aStats.total,
        pctActive: sessionSeconds > 0 ? Math.round(aStats.total / sessionSeconds * 100) : 0,
        numActivePeriods:  aStats.count,
        longestActiveSec:  aStats.longest,
        avgActiveSec:      aStats.avg,
        shortestActiveSec: aStats.shortest,
        avgHrActive: aStats.avgHr.length ? arrAvg(aStats.avgHr) : 0,
        totalRecoverySec:   rStats.total,
        pctRecovery: sessionSeconds > 0 ? Math.round(rStats.total / sessionSeconds * 100) : 0,
        numRecoveryPeriods:  rStats.count,
        longestRecoverySec:  rStats.longest,
        avgRecoverySec:      rStats.avg,
        shortestRecoverySec: rStats.shortest,
        avgHrRecovery: rStats.avgHr.length ? arrAvg(rStats.avgHr) : 0,
        longestLagSec:  rStats.lags.length  ? Math.max(...rStats.lags)  : 0,
        avgLagSec:      rStats.lags.length  ? Math.round(arrAvg(rStats.lags)) : 0,
        shortestLagSec: rStats.lags.length  ? Math.min(...rStats.lags)  : 0,
        highestPeakHr:  rStats.peaks.length ? Math.max(...rStats.peaks) : 0,
        avgPeakHr:      rStats.peaks.length ? arrAvg(rStats.peaks)      : 0,
        lowestPeakHr:   rStats.peaks.length ? Math.min(...rStats.peaks) : 0,
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
        if (summary.activityId) localStorage.setItem(LAST_ACTIVITY_KEY, summary.activityId);
    } catch (e) { console.error('Failed to save session history', e); }
}

function finishSession() {
    if (currentPeriodType === 'active') closeActivePeriod(true);
    else if (currentPeriodType === 'recovery') closeRecoveryPeriod(true);
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
    currentActivityId = null; currentActivityName = null;
    updateActivityDisplay();
    switchState('stopped', true);
    if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
}

// ─── Activity selection modal ─────────────────────────────────────────────────
function showActivitySelectModal() {
    const acts = window.activitiesAPI ? window.activitiesAPI.getAll() : [];
    const modal = document.getElementById('activitySelectModal');
    const select = document.getElementById('activitySelectDropdown');
    const desc   = document.getElementById('activitySelectDesc');

    select.innerHTML = acts.map(a =>
        `<option value="${a.id}">${a.name}</option>`
    ).join('');

    // Pre-select: prefer last-used activity (from previous session), fall back to current
    const lastActId = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (lastActId && acts.find(a => a.id === lastActId)) {
        select.value = lastActId;
    } else if (currentActivityId && acts.find(a => a.id === currentActivityId)) {
        select.value = currentActivityId;
    }

    function updateDesc() {
        const act = acts.find(a => a.id === select.value);
        desc.textContent = act && act.description ? act.description : '';
        desc.style.display = desc.textContent ? 'block' : 'none';
    }
    select.onchange = updateDesc;
    updateDesc();

    modal.classList.add('visible');
}

function startSession() {
    isSessionRunning = true; sessionSeconds = 0; sessionStartTime = Date.now();
    stateSeconds = 0; totalActiveSeconds = 0; resetCount = 0; recoverySeconds = 0;
    activePeriods = []; recoveryPeriods = []; currentPeriodType = null; sessionHrSamples = [];
    rfbSessionClockStart = 0; activityLimitTriggered = false;
    document.getElementById('homeBtn').style.display = 'none';
    setTimerDisplay(document.getElementById('sessionTimerDisplay'), 0);
    setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
    setTimerDisplay(document.getElementById('totalActiveTimerDisplay'), 0);
    document.getElementById('maxHrDisplay').innerText = '--';
    document.getElementById('lagDisplay').innerText = '--';
    document.getElementById('toggleSessionBtn').classList.add('running');
    updateActivityDisplay();
    switchState('active', true);
    sessionInterval = setInterval(handleTick, 1000);
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
    const manualResetBtn = document.getElementById('manualResetBtn');
    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    if (currentState === 'active') {
        descEl.innerText = 'Continue activity'; descEl.style.color = '#28a745';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
    } else if (currentState === 'rest') {
        descEl.innerText = 'Rest or pull back'; descEl.style.color = '#fd7e14';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
    } else if (currentState === 'reset') {
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        if (rfbOn) {
            document.getElementById('stateIndicator').className = 'state-dot reset-rfb';
            descEl.style.color = '#1a7fff';
            if (rfbPhase) {
                descEl.innerText = `RFB — ${formatTime(Math.ceil(rfbSecondsRemaining))} remaining`;
            } else {
                descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
            }
            startRfbAnimation();
        } else {
            descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
            descEl.style.color = '#dc3545';
        }
    } else if (currentState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
    }
}
document.getElementById('manualResetBtn').addEventListener('click', () => {
    if (!isSessionRunning) return;
    if (currentState === 'reset') {
        rfbPhase = false; rfbSecondsRemaining = 0;
        switchState('active', true);
    } else if (currentState === 'active' || currentState === 'rest') switchState('reset', true);
});

document.getElementById('toggleSessionBtn').addEventListener('click', () => {
    if (!isSessionRunning) {
        showActivitySelectModal();
        return;
    }
    if (currentState === 'pause') { switchState('active', true); return; }
    document.getElementById('sessionModal').classList.add('visible');
});

// Activity select modal buttons
document.getElementById('activitySelectStartBtn').addEventListener('click', () => {
    const select = document.getElementById('activitySelectDropdown');
    const actId  = select.value;
    const acts   = window.activitiesAPI ? window.activitiesAPI.getAll() : [];
    const act    = acts.find(a => a.id === actId);
    document.getElementById('activitySelectModal').classList.remove('visible');
    if (window.activitiesAPI) window.activitiesAPI.applySettings(actId);
    currentActivityId   = actId;
    currentActivityName = act ? act.name : '';
    startSession();
});

document.getElementById('activitySelectCancelBtn').addEventListener('click', () => {
    document.getElementById('activitySelectModal').classList.remove('visible');
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
