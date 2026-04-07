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
let lastBlePacket = { time: 0, hex: '' };

// --- HR History Graph ---
const hrHistory = [];
const HR_HISTORY_MS = 90000;

// --- Beat-to-beat RR history (from H10 or compatible sensor) ---
const rrHistory = [];   // { hr: instantaneous bpm, state, ts } — used for graph display
let hasRrData = false;  // true once valid RR intervals have been received

// ─── HRV Pipeline (HRVProcessor) ─────────────────────────────────────────────
// Spectral coherence: interpolates RR to 4 Hz, Hanning-windowed FFT,
// peak power ratio in the 0.04–0.15 Hz LF band (covers 4.5–7 bpm breathing).
class HRVProcessor {
    constructor(options = {}) {
        this.sampleRate    = options.sampleRate    || 4;    // Hz after interpolation
        this.windowSeconds = options.windowSeconds || 120;  // rolling window
        this.buffer            = [];   // raw RR intervals ms
        this.timestamps        = [];
        this.lastCoherence     = 0;
        this.emaTau            = 8;    // seconds — time constant for coherence smoothing
        this.lastCoherenceTime = 0;    // ms epoch of last _ema call
        // Time-domain peak offset tracking (replaces FFT phase)
        this._currentCycleMaxHr = 0;        // highest HR seen in current exhale phase
        this._lastHrMaxTs       = 0;        // wall-clock timestamp of that peak
        this._lastInhaleEndTs   = 0;        // wall-clock timestamp of last inhale→exhale turn
        this._lagHistory        = []; // ring buffer of finalised per-cycle lag values (seconds)
        this._LAG_HISTORY_SIZE  = 5;  // number of cycles to average (~50 s at 10 bpm)
    }
    addRR(rrInterval, timestamp) {
        if (!this._isValidRR(rrInterval)) return;
        this.buffer.push(rrInterval);
        this.timestamps.push(timestamp);
        this._trimBuffer();
    }
    computeCoherence() {
        if (this.buffer.length < 10) return null;
        const { rrs: cleaned, timestamps: cleanedTs } = this._removeArtifacts(this.buffer, this.timestamps);
        const interpolated = this._interpolate(cleaned, cleanedTs);
        if (!interpolated) return null;
        // Subtract mean before windowing — eliminates DC component that would
        // otherwise dominate totalPower and suppress the coherence ratio.
        const mean     = interpolated.reduce((s, x) => s + x, 0) / interpolated.length;
        const detrended = interpolated.map(x => x - mean);
        const windowed  = this._applyHanning(detrended);
        const fftResult = this._fft(windowed);
        const freqs     = this._frequencyAxis(fftResult.magnitude.length);
        const { peakFreq, peakBin, peakBandPower, totalPower } = this._computeBandMetrics(freqs, fftResult.magnitude);
        if (totalPower === 0) return null;
        // HeartMath standard formula: peak band power as a fraction of total power (0–1).
        const coherenceRaw = peakBandPower / totalPower;
        // Validate that the spectral peak lies within the physiological RFB range
        // (0.07–0.12 Hz = 4.2–7.2 bpm). A peak outside this range means the algorithm
        // has latched onto LF noise or slow HR drift, not a real breathing oscillation.
        const validBreathingRate = peakFreq >= 0.07 && peakFreq <= 0.12;
        const now      = this.timestamps.length ? this.timestamps[this.timestamps.length - 1] : Date.now();
        const coherence = this._ema(coherenceRaw, now);
        // Phase of the dominant RR oscillation at the START of the analysis window (n=0).
        // atan2(im, re) of the peak FFT bin: phase=0 means oscillation at maximum at t=0.
        // The Hanning window emphasises the window centre, so we also expose the centre
        // timestamp — that is the correct reference point for the phase comparison.
        const peakPhaseRad      = Math.atan2(fftResult.im[peakBin], fftResult.re[peakBin]);
        const windowCenterTime  = cleanedTs.length > 1
            ? (cleanedTs[0] + cleanedTs[cleanedTs.length - 1]) / 2
            : cleanedTs[0] || 0;
        return { coherence, peakFreq, breathingRate: peakFreq * 60, validBreathingRate, peakPhaseRad, windowCenterTime };
    }
    _isValidRR(rr)    { return rr > 300 && rr < 2000; }
    _trimBuffer() {
        const cutoff = Date.now() - this.windowSeconds * 1000;
        while (this.timestamps.length && this.timestamps[0] < cutoff) {
            this.timestamps.shift(); this.buffer.shift();
        }
    }
    _removeArtifacts(rrs, timestamps) {
        // Compare each interval against the last CLEAN beat, not the immediate predecessor.
        // This is critical for correct ectopic detection:
        //   PVC: short beat (~-25%) followed by compensatory pause (~+25%). Comparing
        //        the pause to the short beat gives ~+67% deviation (sensor-artifact range),
        //        but comparing it to the clean baseline correctly identifies it as physio.
        //   PAC: short beat (~-25%) followed by a normal beat. The normal beat compares
        //        cleanly to the baseline and is correctly passed through.
        const outRrs = [], outTs = [];
        let lastClean = 0;
        for (let i = 0; i < rrs.length; i++) {
            const ref = lastClean || rrs[i];
            if (Math.abs(rrs[i] - ref) / ref < 0.2) {
                outRrs.push(rrs[i]);
                outTs.push(timestamps[i]);
                lastClean = rrs[i];
            }
        }
        return { rrs: outRrs, timestamps: outTs };
    }
    _interpolate(rrs, timestamps) {
        if (rrs.length < 4) return null;
        const start = timestamps[0], end = timestamps[timestamps.length - 1];
        const step = 1000 / this.sampleRate;
        const result = []; let j = 0;
        for (let t = start; t <= end; t += step) {
            while (j < timestamps.length - 1 && timestamps[j + 1] < t) j++;
            const t1 = timestamps[j], t2 = timestamps[j + 1];
            const r1 = rrs[j],       r2 = rrs[j + 1];
            if (!t2) break;
            result.push(r1 + ((t - t1) / (t2 - t1)) * (r2 - r1));
        }
        return result;
    }
    _applyHanning(data) {
        const N = data.length;
        return data.map((x, i) => x * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))));
    }
    _fft(signal) {
        const N = signal.length;
        const re = new Array(N).fill(0), im = new Array(N).fill(0);
        for (let k = 0; k < N; k++) {
            let sumRe = 0, sumIm = 0;
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * k * n) / N;
                sumRe += signal[n] * Math.cos(angle);
                sumIm -= signal[n] * Math.sin(angle);
            }
            re[k] = sumRe; im[k] = sumIm;
        }
        const magnitude = re.map((r, i) => Math.sqrt(r * r + im[i] * im[i]));
        return { magnitude, re, im };
    }
    _frequencyAxis(N) {
        const freqs = [];
        for (let i = 0; i < N; i++) freqs.push((i * this.sampleRate) / N);
        return freqs;
    }
    _computeBandMetrics(freqs, magnitudes) {
        let totalPower = 0, peakPower = 0, peakFreq = 0, peakBin = 0;
        for (let i = 0; i < freqs.length; i++) {
            const f = freqs[i], p = magnitudes[i] ** 2;
            if (f >= 0.04 && f <= 0.15 && p > peakPower) { peakPower = p; peakFreq = f; peakBin = i; }
            totalPower += p;
        }
        let peakBandPower = 0;
        const bandWidth = 0.015;
        for (let i = 0; i < freqs.length; i++) {
            if (Math.abs(freqs[i] - peakFreq) <= bandWidth) peakBandPower += magnitudes[i] ** 2;
        }
        return { peakFreq, peakBin, peakBandPower, totalPower };
    }
    _ema(value, now) {
        // Time-based EMA: α = dt / (τ + dt) so smoothing is independent of call rate.
        // On first call dt defaults to τ, giving α = 0.5 for fast initial lock-on.
        const dt    = this.lastCoherenceTime ? (now - this.lastCoherenceTime) / 1000 : this.emaTau;
        const alpha = dt / (this.emaTau + dt);
        this.lastCoherence     = alpha * value + (1 - alpha) * this.lastCoherence;
        this.lastCoherenceTime = now;
        return this.lastCoherence;
    }
    // Compute RMSSD, SDNN, mean RR from the clean buffer.
    // All artifacts (sensor and physiological) are removed via _removeArtifacts before
    // computing metrics — a single ectopic pair contributes two outlier successive
    // differences that can inflate RMSSD by an order of magnitude.
    // The buffer should already contain only clean beats (physio artifacts are excluded
    // at ingestion in recordRrHistory), but _removeArtifacts is applied here as a
    // safety net and to ensure waveform and time-domain analysis use identical data.
    computeHRVMetrics(windowMs = 180000) {
        if (this.buffer.length < 5) return null;
        const cutoff = Date.now() - windowMs;
        let startIdx = 0;
        while (startIdx < this.timestamps.length && this.timestamps[startIdx] < cutoff) startIdx++;
        const rawRrs = this.buffer.slice(startIdx);
        const rawTs  = this.timestamps.slice(startIdx);
        if (rawRrs.length < 5) return null;
        const { rrs } = this._removeArtifacts(rawRrs, rawTs);
        if (rrs.length < 5) return null;
        const meanRR = rrs.reduce((a, b) => a + b, 0) / rrs.length;
        const sdnn   = Math.sqrt(rrs.reduce((s, x) => s + (x - meanRR) ** 2, 0) / rrs.length);
        let sumSqDiff = 0;
        for (let i = 1; i < rrs.length; i++) sumSqDiff += (rrs[i] - rrs[i - 1]) ** 2;
        const rmssd = Math.sqrt(sumSqDiff / (rrs.length - 1));
        return { rmssd: Math.round(rmssd), sdnn: Math.round(sdnn), meanRR: Math.round(meanRR), n: rrs.length };
    }
    reset() {
        this.buffer = []; this.timestamps = [];
        this.lastCoherence = 0; this.lastCoherenceTime = 0;
        this._currentCycleMaxHr = 0;
        this._lastHrMaxTs = 0; this._lastInhaleEndTs = 0;
        this._lagHistory = [];
    }
}



const hrvProcessor = new HRVProcessor({ sampleRate: 4, windowSeconds: 120 });

// Rolling history of valid in-band spectral peak frequencies, used for the
// instability indicator only — not used to modify the coherence score.
const peakFreqHistory = [];
const PEAK_FREQ_MAX_HISTORY = 120; // ~1 Hz update rate → ~2 min of history

// Returns a 0–1 stability value (1 = stable, 0 = wandering).
// std dev thresholds: 0.005 Hz ≈ very stable; 0.02 Hz ≈ clearly drifting (~±1.2 bpm).
function computeStability(history) {
    if (!history || history.length < 10) return 1; // insufficient data — assume stable
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((s, f) => { const d = f - mean; return s + d * d; }, 0) / history.length;
    const std  = Math.sqrt(variance);
    const MIN_STD = 0.005, MAX_STD = 0.02;
    const norm = Math.max(0, Math.min(1, (std - MIN_STD) / (MAX_STD - MIN_STD)));
    return 1 - norm;
}

let lastRrTimestamp    = 0; // Continuous internal clock — prevents packet jitter gaps
let lastRrWallClock    = 0; // Wall-clock time of last packet — detects background resume

// Gap threshold: if wall-clock time since last packet exceeds this, the app was
// backgrounded. Flush processor buffers so stale/flood data doesn't corrupt metrics.
const BACKGROUND_GAP_MS = 4000;

function recordRrHistory(rrValuesMs, notifTs) {
    const wallNow   = Date.now();
    const wallGap   = lastRrWallClock > 0 ? wallNow - lastRrWallClock : 0;
    lastRrWallClock = wallNow;

    // Detect app resume from background: wall-clock gap implies queued packets
    // are about to flood in. Flush both processors and reset the clock so
    // metrics restart cleanly rather than being distorted by the burst.
    if (wallGap > BACKGROUND_GAP_MS) {
        hrvProcessor.reset();
        peakFreqHistory.length = 0;
        lastRrTimestamp = 0;
        recordRrHistory._lastCleanRr = 0;
        rrHistory.length = 0;
    }
    const pairs = [];
    const totalRrMs = rrValuesMs.reduce((sum, val) => sum + val, 0);

    // Build a continuous forward-running clock so beats across packet boundaries
    // have genuinely sequential timestamps. The old backward reconstruction from
    // notifTs caused cross-packet gaps that halved pair counts.
    if (lastRrTimestamp > 0 && (notifTs - lastRrTimestamp) < totalRrMs + 3000) {
        let ts = lastRrTimestamp;
        for (let i = 0; i < rrValuesMs.length; i++) {
            ts += rrValuesMs[i];
            pairs.push({ rr: rrValuesMs[i], ts });
        }
        lastRrTimestamp = ts;
    } else {
        // First packet or gap too large — seed from notifTs backwards as before.
        let ts = notifTs;
        for (let i = rrValuesMs.length - 1; i >= 0; i--) {
            pairs.push({ rr: rrValuesMs[i], ts });
            ts -= rrValuesMs[i];
        }
        pairs.reverse();
        lastRrTimestamp = notifTs;
    }

    // ── Artifact classification ───────────────────────────────────────────────
    //
    // All comparisons are made against lastCleanRr — the last beat confirmed clean —
    // NOT the immediate predecessor. This is essential for correct ectopic handling:
    //
    //   PVC (premature ventricular contraction):
    //     The SA node keeps firing on schedule. The premature beat fires early
    //     (short RR, e.g. 750 ms at 1000 ms baseline), then the ventricles are
    //     refractory when the SA fires on schedule, so the next beat is the one
    //     after (compensatory pause, e.g. 1250 ms). Short + long ≈ 2× baseline.
    //     Both beats deviate ~25% from the 1000 ms baseline → both are physio artifacts.
    //     If we compared the pause to the short beat (750 ms), the 67% deviation
    //     would wrongly flag it as a sensor artifact.
    //
    //   PAC (premature atrial contraction):
    //     The ectopic fires from within the atria, resetting the SA node. The
    //     premature beat is short (~750 ms), but the following beat is roughly
    //     normal (~1000 ms) because the SA node restarted from the ectopic.
    //     Short + normal ≈ 1.75× baseline (no full compensatory pause).
    //     Only the short beat is a physio artifact; the normal beat is clean.
    //
    //   Sensor artifact:
    //     >50% deviation from clean baseline, or outside physiological range.
    //     Implies hardware dropout/double-count, not a real cardiac event.
    //
    // Routing summary:
    //   Sensor artifact  → interpolated synthetic point in graph; excluded from HRV
    //   Physio artifact  → real HR value in graph (user sees PVC/PAC spikes); excluded from HRV
    //   Clean beat       → graph + HRV processor
    //
    // sessionPhysioArtifacts is populated for all session types (used in HRV calculations
    // only for HRV Reading sessions, but tracked universally for data completeness).

    let lastCleanRr = recordRrHistory._lastCleanRr || 0;

    for (const { rr, ts: t } of pairs) {
        sessionTotalBeats++;

        // ── Tier 1: sensor artifact — physiologically impossible or gross dropout ──
                // Relative deviation alone over-classifies large-swing beats at low HR:
        // a legitimate 20 bpm RFB oscillation at 50 bpm baseline spans ~240 ms,
        // which clears the 50% relative threshold. Requiring both deviation ≥ 0.5
        // AND absolute delta > 250 ms prevents those beats being wrongly suppressed
        // while still catching genuine dropouts (which are always large in both senses).
        const absDiff = lastCleanRr > 0 ? Math.abs(rr - lastCleanRr) : 0;
        const isSensorArtifact = rr < 250 || rr > 2000 ||
            (lastCleanRr > 0 && Math.abs(rr - lastCleanRr) / lastCleanRr >= 0.5 && absDiff > 250);

        if (isSensorArtifact) {
            sessionSensorArtifacts++;
            // Interpolate a synthetic beat at baseline HR to keep the graph line
            // smooth — a raw gap looks alarming and obscures real physiology.
            if (lastCleanRr > 0) {
                const syntheticHr = Math.round(60000 / lastCleanRr);
                if (syntheticHr >= 24 && syntheticHr <= 240) {
                    rrHistory.push({ hr: syntheticHr, state: currentState, ts: t });
                }
            }
            // lastCleanRr is NOT updated — baseline must survive sensor dropouts.
            continue;
        }

        // ── Tier 2: physiological artifact — ectopic beat (PVC or PAC) ──────────
        // Deviation is measured from lastCleanRr so the compensatory pause of a PVC
        // (~+25% from baseline) is correctly classified as physio rather than sensor.
        const deviation = lastCleanRr > 0 ? Math.abs(rr - lastCleanRr) / lastCleanRr : 0;
        const isPhysioArtifact = lastCleanRr > 0 && deviation >= 0.2;

        if (isPhysioArtifact) {
            // Direction indicates PVC vs PAC (both counted together):
            //   rr < lastCleanRr → premature beat (short RR = HR spike up)
            //                      could be PVC premature OR PAC premature
            //   rr > lastCleanRr → compensatory pause (long RR = HR spike down)
            //                      only occurs after a PVC premature beat
            sessionPhysioArtifacts++;

            // Include in graph: the user sees the physiological spike as real data.
            // PVC appears as a down-up spike pair; PAC as a single up spike.
            const instantHr = Math.round(60000 / rr);
            if (instantHr >= 24 && instantHr <= 240) {
                rrHistory.push({ hr: instantHr, state: currentState, ts: t });
            }
            // lastCleanRr is NOT updated — the clean baseline must be preserved
            // so the beat after the ectopic pair is evaluated against it, not
            // against the distorted ectopic interval.
            // Do NOT add to hrvProcessor — excluded from RMSSD, SDNN, and all
            // waveform analysis (coherence, stability, phase).
            continue;
        }

        // ── Clean beat ────────────────────────────────────────────────────────────
        lastCleanRr = rr;
        hrvProcessor.addRR(rr, t);
        const instantHr = Math.round(60000 / rr);
        if (instantHr >= 24 && instantHr <= 240) {
            rrHistory.push({ hr: instantHr, state: currentState, ts: t });
        }
    }
    recordRrHistory._lastCleanRr = lastCleanRr;

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
const MAX_RECONNECT_ATTEMPTS = 30;
let currentState = 'stopped';
let sessionInterval, wakeLock = null, heartbeatTimeout;

// ─── RFB (Resonance Frequency Breathing) ─────────────────────────────────────
let rfbPhase = false;
let rfbSecondsRemaining = 0;
let isResonanceBreathing = false; // true for the dedicated Resonance Breathing activity
let rfbExtended = false;          // true after user extends beyond the timed session
let rfbWallStartTime = 0;      // phase anchor: set once per session, never reset between RFB periods
let rfbSessionClockStart = 0;  // Date.now() of the very first RFB entry this session (0 = not yet started)
let rfbAnimFrame = null;
let rfbScheduleTimer = null;
let rfbAudioNodes = null;

// ─── HRV Reading ──────────────────────────────────────────────────────────────
let isHRVReading = false;
let hrvSecondsRemaining = 0;
let currentHRVIndex = null; // live-computed index shown during session and stored in summary
const HRV_READING_ID = 'hrv_reading';
const HRV_SESSION_DURATION_SEC = 180; // fixed 3-minute session

// Per-session artifact counters (reset in startSession, incremented in recordRrHistory)
let sessionTotalBeats     = 0;
let sessionSensorArtifacts  = 0;
let sessionPhysioArtifacts  = 0;

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
// Asymmetric sine for the HR graph overlay, consistent with RSA physiology:
// vagal tone is withdrawn during inhalation (HR rises) and restored during
// exhalation (HR falls). HR is at minimum at inhale start (phase=0), peaks at
// exhale start (phase=inhaleFrac), and troughs again at the next inhale start
// (phase=1). This aligns with the dot animation: dot smallest at phase=0,
// dot largest at phase=inhaleFrac.
function rfbAsymSine(phase, inhaleFrac) {
    if (inhaleFrac <= 0 || inhaleFrac >= 1) return -Math.cos(phase * 2 * Math.PI);
    if (phase < inhaleFrac) return -Math.cos((phase / inhaleFrac) * Math.PI);  // -1 → +1
    return Math.cos(((phase - inhaleFrac) / (1 - inhaleFrac)) * Math.PI);     // +1 → -1
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
const HR_RECORDING_MAX_SAMPLES = 10800; // 3 hours at 1 Hz — hard cap to protect memory

let sessionStartTime = 0, sessionSeconds = 0, stateSeconds = 0;
let recoverySeconds = 0, totalActiveSeconds = 0, totalTargetSeconds = 0, resetCount = 0;
let rfbActiveSeconds = 0;    // real clock of actual RFB time (increments while rfbPhase is true)
let rbSessionEndSeconds = 0; // sessionSeconds snapshot at the moment the RB timer hits zero
let activeToRestCount = 0, activeToResetCount = 0, restToActiveCount = 0, resetToActiveCount = 0;
let maxHrInRest = 0, timeOfMaxHrInRest = 0, isRecoveryState = false;
let activityLimitTriggered = false;
let sessionHrRecording = [];   // 1Hz HR log: {t, hr, state} — attached to summary on save
let rfbCoherenceRecording = []; // ~1Hz coherence log during valid RFB: {t, c} — c is 0-100 integer

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
function setTimerDisplay(el, seconds) {
    el.innerText = formatTime(seconds);
    el.classList.toggle('long-time', seconds >= 3600);
}
// Update the budget timer (active total or target total) and its label
// according to the current BUDGET_USING setting.
function updateBudgetTimerDisplay() {
    const byTarget = (typeof BUDGET_USING !== 'undefined') && BUDGET_USING === 1;
    const timerEl  = document.getElementById('totalActiveTimerDisplay');
    const labelEl  = document.getElementById('activeTotalLabel');
    if (timerEl) setTimerDisplay(timerEl, byTarget ? totalTargetSeconds : totalActiveSeconds);
    if (labelEl) labelEl.innerText = byTarget ? 'TARGET TOTAL' : 'ACTIVE TOTAL';
    const iconEl = document.getElementById('targetTimerIcon');
    if (iconEl) iconEl.style.display = byTarget ? '' : 'none';
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
            totalActiveSeconds, totalTargetSeconds, resetCount, isRecoveryState, maxHrInRest, timeOfMaxHrInRest, currentState,
            activePeriods, recoveryPeriods,
            currentPeriodType, currentPeriodStart,
            sessionHrMin: sessionHrSamples.length ? Math.min(...sessionHrSamples) : 0,
            sessionHrMax: sessionHrSamples.length ? Math.max(...sessionHrSamples) : 0,
            sessionHrSum: sessionHrSamples.reduce((a,b)=>a+b, 0),
            sessionHrCount: sessionHrSamples.length,
            currentActivityId, currentActivityName,
            rfbPhase, rfbSecondsRemaining, rfbSessionClockStart,
            isResonanceBreathing, rfbExtended,
            rfbActiveSeconds, rbSessionEndSeconds,
            isHRVReading, hrvSecondsRemaining,
            sessionTotalBeats, sessionSensorArtifacts, sessionPhysioArtifacts,
            currentHRVIndex,
            activityLimitTriggered,
            // Pack the HR recording so it survives a disconnect/reconnect without
            // exhausting localStorage. Packing reduces ~10KB of JSON to ~1KB binary.
            hrRecordingPacked: sessionHrRecording.length > 0
                ? packHrRecording(sessionHrRecording, sessionSeconds)
                : null,
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
        totalActiveSeconds = s.totalActiveSeconds; totalTargetSeconds = s.totalTargetSeconds || 0;
        resetCount = s.resetCount;
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
        isResonanceBreathing  = s.isResonanceBreathing  || false;
        rfbExtended           = s.rfbExtended           || false;
        rfbActiveSeconds      = s.rfbActiveSeconds      || 0;
        rbSessionEndSeconds   = s.rbSessionEndSeconds   || 0;
        isHRVReading          = s.isHRVReading          || false;
        hrvSecondsRemaining   = s.hrvSecondsRemaining   || 0;
        sessionTotalBeats     = s.sessionTotalBeats     || 0;
        sessionSensorArtifacts  = s.sessionSensorArtifacts  || 0;
        sessionPhysioArtifacts  = s.sessionPhysioArtifacts  || 0;
        currentHRVIndex       = s.currentHRVIndex       ?? null;
        // Restore the HR recording so the PDF graph survives a reconnect
        sessionHrRecording = s.hrRecordingPacked ? unpackHrRecording(s.hrRecordingPacked) : [];
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
    setRbDisplayMode(isResonanceBreathing || isHRVReading);
    setTimerDisplay(document.getElementById('stateTimerDisplay'),       stateSeconds);
    setTimerDisplay(document.getElementById('sessionTimerDisplay'),     sessionSeconds);
    updateBudgetTimerDisplay();
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
        manualResetBtn.innerHTML = '&#9654;';
        manualResetBtn.style.display = (isResonanceBreathing || isHRVReading) ? 'none' : 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        if (isHRVReading) {
            document.getElementById('stateIndicator').className = 'state-dot reset-hrv';
            descEl.style.color = '#7c3aed';
            descEl.innerText = `HRV — ${formatTime(Math.ceil(hrvSecondsRemaining))} remaining`;
        } else if (rfbOn) {
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

// --- Updated Wake Lock Logic ---
async function requestWakeLock() {
    // Only request if the API is supported and we don't already have an active lock
    if ('wakeLock' in navigator && wakeLock === null) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            
            // Log for debugging
            console.log('Wake Lock acquired');

            // Handle the case where the system releases the lock
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
                wakeLock = null; 
            });
        } catch (err) {
            console.log('Wake Lock Error:', err);
        }
    }
}

// --- Re-acquire lock when the app comes back to the foreground ---
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});


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

// ─── Resonance Index ─────────────────────────────────────────────────────────
// Single combined metric for display and longitudinal tracking.
// Coherence (validated HeartMath RSA measure) is the primary signal.
// Phase and stability act as trust multipliers — they can only reduce the score,
// never inflate it above the raw coherence value.
//
//   phaseMult = 0.75 + 0.25 × cos(phaseDiff)  → [0.5, 1.0]
//     Inverted phase (180°) → 0.50 × coherence  (likely not genuine RSA)
//     Aligned   (0°)        → 1.00 × coherence  (no penalty)
//     No data               → 0.85 × coherence  (uncertainty discount)
//
//   stabMult  = 0.70 + 0.30 × stability        → [0.7, 1.0]
//     Max instability → 0.70 × coherence  (dysautonomia causes inherent variability)
//     Perfect stability → 1.00 × coherence
//
// Worst case: coherence × 0.35.  Best case: coherence × 1.00.
function computeResonanceIndex(coherence, stability, phaseDiffDeg) {
    const phaseMult = phaseDiffDeg != null
        ? 0.75 + 0.25 * Math.cos(phaseDiffDeg * Math.PI / 180)
        : 0.85;
    const stabMult  = 0.70 + 0.30 * stability;
    return Math.min(1, coherence * phaseMult * stabMult);
}

// ─── HRV Index ────────────────────────────────────────────────────────────────
// Headline HRV index for the HRV Reading session type.
// Returns null when pSensor > 2% (session data is unreliable — don't produce a number).
// Otherwise: rawIndex × balanceFactor × qualityFactor
//   rawIndex      = ln(RMSSD) × 15          — vagal tone, calibrated to ~healthy adult values
//   balanceFactor ∈ [0,1]                   — sympathovagal balance; penalises sympathetic dominance
//   qualityFactor ∈ [0,1]                   — discounts physiological irregularity (ectopy / dysautonomia)
function calculateHRVIndex({ rmssd, sdnn, pSensor, pPhysio }) {
    const HEALTHY_BALANCE  = 0.5;  // healthy RMSSD/SDNN ratio target
    const ARTIFACT_CEILING = 0.05; // 5% physiological artifact rate → quality factor = 0
    if (pSensor > 0.02 || rmssd <= 0 || sdnn <= 0) return null;
    const rawIndex      = Math.log(rmssd) * 15;
    const balanceFactor = Math.min(Math.max((rmssd / sdnn) / HEALTHY_BALANCE, 0), 1);
    const qualityFactor = Math.max(1 - pPhysio / ARTIFACT_CEILING, 0);
    return {
        index:         Math.round(rawIndex * balanceFactor * qualityFactor * 10) / 10,
        rawIndex:      Math.round(rawIndex * 10) / 10,
        balanceFactor: Math.round(balanceFactor * 1000) / 1000,
        qualityFactor: Math.round(qualityFactor * 1000) / 1000,
    };
}

// ─── HRV display (updated once per second during HRV Reading sessions) ────────
let _lastHRVDisplayTs = 0;
function updateHRVDisplay() {
    if (!isHRVReading) return;
    const now = Date.now();
    if (now - _lastHRVDisplayTs < 1000) return;
    _lastHRVDisplayTs = now;

    const el       = document.getElementById('coherenceDisplay');
    const coherEl  = document.getElementById('coherenceRow');
    const coherVal = document.getElementById('coherenceValue');
    if (!el || !coherVal) return;

    el.style.display    = 'flex';
    if (coherEl) coherEl.style.display = 'flex';

    // Ensure HRV debug line exists (created once, persists)
    let dbg = document.getElementById('hrvDebug');
    if (!dbg) {
        dbg = document.createElement('div');
        dbg.id = 'hrvDebug';
        dbg.style.cssText = 'font-size:10px;text-align:center;width:100%;margin-top:2px;font-family:monospace;color:white;';
        coherVal.parentElement.insertAdjacentElement('afterend', dbg);
    }
    const showDebug = (typeof HRV_SHOW_DEBUG !== 'undefined') && HRV_SHOW_DEBUG;
    dbg.style.display = showDebug ? '' : 'none';

    const metrics = hrvProcessor.computeHRVMetrics(HRV_SESSION_DURATION_SEC * 1000);
    const pSensor = sessionTotalBeats > 0 ? sessionSensorArtifacts / sessionTotalBeats : 0;
    const pPhysio = sessionTotalBeats > 0 ? sessionPhysioArtifacts / sessionTotalBeats : 0;

    if (!metrics || pSensor > 0.02) {
        coherVal.textContent = '--';
        coherVal.style.color = '#7c3aed';
        if (showDebug) dbg.textContent = pSensor > 0.02 ? 'sensor unreliable' : 'collecting data…';
        currentHRVIndex = null;
        return;
    }

    const result = calculateHRVIndex({ rmssd: metrics.rmssd, sdnn: metrics.sdnn, pSensor, pPhysio });
    if (!result) {
        coherVal.textContent = '--';
        coherVal.style.color = '#7c3aed';
        if (showDebug) dbg.textContent = 'insufficient data';
        currentHRVIndex = null;
        return;
    }

    currentHRVIndex = result.index;
    coherVal.textContent = result.index.toFixed(1);
    coherVal.style.color = '#7c3aed';

    if (showDebug) {
        dbg.textContent =
            `RMSSD:${metrics.rmssd}ms  balance:${Math.round(result.balanceFactor * 100)}%  anomalies:${Math.round((1 - result.qualityFactor) * 100)}%`;
    }
}
function computeResonance() {
    if (!hasRrData) return null;
    const result = hrvProcessor.computeCoherence();
    if (result === null) return null;

    // Track in-band peaks only — out-of-band readings are noise and would
    // inflate the std dev even when breathing technique is sound.
    if (result.validBreathingRate) {
        peakFreqHistory.push(result.peakFreq);
        if (peakFreqHistory.length > PEAK_FREQ_MAX_HISTORY) peakFreqHistory.shift();
    }

    const stability = computeStability(peakFreqHistory);

    // Phase alignment — time-domain peak offset method.
    // Averages the last N finalised cycle lags for stability, then normalises
    // to degrees. 72° offset centres "0" on the expected healthy lag (1–2 s).
    let phaseDiffDeg = null;
    if (hrvProcessor._lagHistory.length > 0) {
        const avgLagSec     = hrvProcessor._lagHistory.reduce((a, b) => a + b, 0) / hrvProcessor._lagHistory.length;
        const breathPeriodSec = rfbBreathPeriodMs() / 1000;
        const rawPhaseDeg   = (avgLagSec / breathPeriodSec) * 360;
        phaseDiffDeg = Math.round(rawPhaseDeg - 72);
    }

    // Amplitude gate: low RSA oscillation amplitude means the coherence signal is
    // unreliable regardless of spectral shape — coherence computed on a near-flat
    // HR signal measures noise pattern, not genuine vagal modulation.
    //
    // Amplitude is estimated from instantaneous beat-to-beat HR values in rrHistory
    // (computed as 60000/RR, not the BLE-averaged HR integer which is attenuated by
    // the sensor's internal smoothing). The window is sliced into 20-second blocks;
    // max-min is computed per block and the results averaged. This captures local
    // oscillation amplitude while remaining immune to slow HR drift that would
    // inflate a single window-wide max-min.
    //
    // Threshold: 7.5 bpm = 50% of the Hirsch & Bishop (1981) healthy adult floor
    // (~15 bpm peak-to-trough at controlled tidal volume, breathing <6 cycles/min).
    // This is conservative — well below what a healthy person following the pacer
    // should produce — so the gate only fires when signal is genuinely absent.
    //   amplitudeMult = clamp(amplitudeBpm / 7.5, 0, 1)
    const RFB_MIN_AMPLITUDE = 7.5;
    let amplitudeBpm = 0;
    {
        const BLOCK_MS = 20000;
        const now = Date.now();
        const windowStart = now - hrvProcessor.windowSeconds * 1000;
        const relevant = rrHistory.filter(p => p.ts >= windowStart);
        if (relevant.length >= 4) {
            const earliest = relevant[0].ts;
            const latest   = relevant[relevant.length - 1].ts;
            const blockAmplitudes = [];
            for (let t = earliest; t < latest; t += BLOCK_MS) {
                const block = relevant.filter(p => p.ts >= t && p.ts < t + BLOCK_MS);
                if (block.length < 3) continue;
                const hrs = block.map(p => p.hr);
                blockAmplitudes.push(Math.max(...hrs) - Math.min(...hrs));
            }
            if (blockAmplitudes.length > 0) {
                amplitudeBpm = blockAmplitudes.reduce((a, b) => a + b, 0) / blockAmplitudes.length;
            }
        }
    }
    const amplitudeMult  = Math.min(1, Math.max(0, amplitudeBpm / RFB_MIN_AMPLITUDE));
    const coherenceGated = result.coherence * amplitudeMult;

    const ri = computeResonanceIndex(coherenceGated, stability, phaseDiffDeg);
    return {
        ri,
        coherence:    result.coherence,   // raw, for display
        coherenceGated,                   // amplitude-adjusted, fed into RI
        amplitudeBpm,
        stability,
        phaseDiffDeg,
        validRate:    result.validBreathingRate,
    };
}

let _lastCoherenceUpdateTs = 0;
function updateCoherenceDisplay() {
    // During HRV Reading, the coherence display area is managed by updateHRVDisplay instead.
    if (isHRVReading) return;
    const now = Date.now();
    if (now - _lastCoherenceUpdateTs < 1000) return;
    _lastCoherenceUpdateTs = now;
    const el       = document.getElementById('coherenceDisplay');
    const coherEl  = document.getElementById('coherenceRow');
    const coherVal = document.getElementById('coherenceValue');
    if (!el) return;

    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    const inRfb = currentState === 'reset' && rfbOn;

    if (!hasRrData) { el.style.display = 'none'; return; }

    el.style.display = 'flex';

    // Derive state text colour so metrics blend with the surrounding UI.
    const stateColor = currentState === 'active' ? '#28a745'
                     : currentState === 'rest'   ? '#fd7e14'
                     : currentState === 'reset'  ? (rfbOn ? '#1a7fff' : '#dc3545')
                     : currentState === 'pause'  ? '#888888'
                     : '#aaaaaa';

    // 4-level star system matching Polar coherence tiers:
    //   0 = none      (☆☆☆)  < 15%
    //   1 = amethyst  (★☆☆)  >= 15%
    //   2 = sapphire  (★★☆)  >= 30%
    //   3 = diamond   (★★★)  >= 50%
    function starsHtml(level, easterEgg) {
        return '★'.repeat(level) + '☆'.repeat(3 - level) + (easterEgg ? '🍓' : '') ;
    }

    // Resonance row — only during reset + RFB
    if (coherEl) coherEl.style.display = inRfb ? 'flex' : 'none';
    if (inRfb && coherVal) {
        const r = computeResonance();
        const showDebug = (typeof RFB_SHOW_DEBUG !== 'undefined') && RFB_SHOW_DEBUG;

        // Ensure debug element exists whenever we are in RFB (created once, persists)
        let dbg = document.getElementById('rfbDebug');
        if (!dbg) {
            dbg = document.createElement('div');
            dbg.id = 'rfbDebug';
            dbg.style.cssText = 'font-size:10px;text-align:center;width:100%;margin-top:2px;font-family:monospace;color:white;';
            coherVal.parentElement.insertAdjacentElement('afterend', dbg);
        }
        dbg.style.display = showDebug ? '' : 'none';

        if (r === null || !r.validRate) {
            coherVal.textContent = `0 ${starsHtml(0, false)}`;
            if (showDebug) dbg.textContent = 'collecting data…';
        } else {
            const riPct  = Math.round(r.ri * 100);
            const level  = riPct >= 50 ? 3 : riPct >= 30 ? 2 : riPct >= 15 ? 1 : 0;
            coherVal.textContent = `${riPct} ${starsHtml(level, riPct >= 65)}`;
            if (showDebug) {
                const relLagSec = r.phaseDiffDeg != null ? (r.phaseDiffDeg / 360 * (rfbBreathPeriodMs() / 1000)) : null;
                const lagStr = relLagSec != null ? `${relLagSec >= 0 ? '+' : ''}${relLagSec.toFixed(1)}s` : '--';
                dbg.textContent = `coherence:${Math.round(r.coherence * 100)}% ampl:${r.amplitudeBpm.toFixed(1)} stability:${Math.round(r.stability * 100)}% lag:${lagStr}`;
            }
            // Collect all raw components for post-session analysis
            if (isSessionRunning) rfbCoherenceRecording.push({
                t:    sessionSeconds,
                c:    Math.round(r.coherence * 100),
                ri:   riPct,
                stab: Math.round(r.stability * 100),
                ph:   r.phaseDiffDeg ?? null,
                amp:  Math.round(r.amplitudeBpm * 10) / 10,
            });
        }
        coherVal.style.color = stateColor;
    }
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
    // active→pause: if HR is still above the resting zone the user has paused
    // mid-effort — start recovery tracking so lag and peak are captured.
    if (newState === 'pause' && prevState === 'active') {
        const restingHi = (typeof RESTING_HR !== 'undefined' && typeof RESTING_HR_BANDWIDTH !== 'undefined')
            ? RESTING_HR + RESTING_HR_BANDWIDTH / 2
            : Infinity;
        if (latestHR > restingHi) {
            isRecoveryState = true;
            maxHrInRest = 0; timeOfMaxHrInRest = 0; recoverySeconds = 0;
            document.getElementById('maxHrDisplay').innerText = '--';
            document.getElementById('lagDisplay').innerText = '--';
        }
    }
    if (newState === 'reset') {
        if (!isManual) resetCount++;
        if (prevState === 'rest') isRecoveryState = true;
        // If coming from active with HR still above the resting zone, the user
        // stopped intentionally (timer or manual) rather than because HR dropped —
        // treat as a recovery so lag and peak HR are tracked.
        if (prevState === 'active') {
            const restingHi = (typeof RESTING_HR !== 'undefined' && typeof RESTING_HR_BANDWIDTH !== 'undefined')
                ? RESTING_HR + RESTING_HR_BANDWIDTH / 2
                : Infinity;
            if (latestHR > restingHi) isRecoveryState = true;
        }
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

    // Initialise recovery HR tracking whenever entering reset with isRecoveryState active.
    // Covers both the existing rest->reset path and the new active->reset-with-elevated-HR path.
    if (newState === 'reset' && isRecoveryState && prevState !== 'reset') {
        maxHrInRest = 0; timeOfMaxHrInRest = 0; recoverySeconds = 0;
        document.getElementById('maxHrDisplay').innerText = '--';
        document.getElementById('lagDisplay').innerText = '--';
    }

    // Stop RFB animation and clear RFB phase whenever leaving reset.
    // Hide the coherence row and clear debug display when not in RFB/HRV state.
    if (newState !== 'reset') {
        stopRfbAnimation();
        rfbPhase = false; rfbSecondsRemaining = 0;
        const coherEl = document.getElementById('coherenceRow');
        if (coherEl) coherEl.style.display = 'none';
        const dbg = document.getElementById('rfbDebug');
        if (dbg) dbg.textContent = '';
        const dbg2 = document.getElementById('hrvDebug');
        if (dbg2) dbg2.textContent = '';
    }

    const rfbOn = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
    const indicatorClass = (newState === 'reset' && rfbOn)       ? 'reset-rfb'
                         : (newState === 'reset' && isHRVReading) ? 'reset-hrv'
                         : newState;
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
        manualResetBtn.innerHTML = '&#9654;';
        manualResetBtn.style.display = (isResonanceBreathing || isHRVReading) ? 'none' : 'flex';
        manualResetBtn.classList.toggle('rfb', !!rfbOn);
        toggleBtn.innerText = 'Pause session'; toggleBtn.classList.remove('paused');
        if (isHRVReading) {
            descEl.innerText = `HRV — ${formatTime(Math.ceil(hrvSecondsRemaining))} remaining`;
            descEl.style.color = '#7c3aed';
        } else {
            descEl.innerText = resetCount >= NUM_RESETS_B4_WARN ? '⚠️ Finish this session ASAP' : 'Reset to resting HR';
            descEl.style.color = rfbOn ? '#1a7fff' : '#dc3545';
            if (rfbOn) startRfbAnimation();
        }
    } else if (newState === 'pause') {
        descEl.innerText = 'Pause activity'; descEl.style.color = '#888888';
        manualResetBtn.style.display = 'none'; manualResetBtn.classList.remove('rfb');
        toggleBtn.innerText = 'Resume session'; toggleBtn.classList.add('paused');
    } else { descEl.innerText = ''; }
}

function updateTimers(increment) {
    sessionSeconds += increment; stateSeconds += increment;
    if (isRecoveryState) recoverySeconds += increment;

    const byTarget  = (typeof BUDGET_USING !== 'undefined') && BUDGET_USING === 1;
    const limitSec  = (typeof ACTIVE_TIME_LIMIT !== 'undefined') ? ACTIVE_TIME_LIMIT * 60 : 0;
    const targetMin = (typeof TARGET_MIN_HR !== 'undefined') ? TARGET_MIN_HR : 70;

    if (currentState === 'active') {
        totalActiveSeconds += increment;
        // Active time limit
        if (!byTarget && limitSec > 0 && !activityLimitTriggered && totalActiveSeconds >= limitSec) {
            activityLimitTriggered = true;
            switchState('reset', false);
            const descEl = document.getElementById('stateDescription');
            if (descEl) descEl.innerText = 'Activity limit reached';
        }
    }

    // Target time accumulates whenever HR >= TARGET_MIN_HR, regardless of state
    if (latestHR > 0 && latestHR >= targetMin) {
        totalTargetSeconds += increment;
        if (byTarget && limitSec > 0 && !activityLimitTriggered && totalTargetSeconds >= limitSec) {
            activityLimitTriggered = true;
            switchState('reset', false);
            const descEl = document.getElementById('stateDescription');
            if (descEl) descEl.innerText = 'Target time reached';
        }
    }
    updateBudgetTimerDisplay();
    if (currentState === 'rest') {
        if (stateSeconds > MAX_RECOVERY_PERIOD) switchState('reset', false);
        else if (timeOfMaxHrInRest > MAX_RESPONSE_LAG) switchState('reset', false);
    }
    // Accumulate real RFB time regardless of extended/modal state
    if (currentState === 'reset' && rfbPhase) rfbActiveSeconds += increment;

    // RFB hold-period countdown
    if (currentState === 'reset' && rfbPhase) {
        if (!rfbExtended) rfbSecondsRemaining -= increment;
        if (!rfbExtended && rfbSecondsRemaining <= 0) {
            if (isResonanceBreathing) {
                // Time's up — snapshot the session clock before modal delay inflates it
                rfbSecondsRemaining = 0;
                rbSessionEndSeconds = sessionSeconds;
                document.getElementById('rbTimeUpModal').classList.add('visible');
            } else {
                rfbPhase = false;
                switchState('active', false);
            }
        } else {
            const descEl = document.getElementById('stateDescription');
            if (descEl) {
                descEl.innerText = rfbExtended
                    ? 'Resonance Breathing — extended'
                    : `RFB — ${formatTime(Math.ceil(rfbSecondsRemaining))} remaining`;
                descEl.style.color = '#1a7fff';
            }
        }
    }

    // HRV Reading countdown
    if (isHRVReading && currentState === 'reset') {
        hrvSecondsRemaining -= increment;
        if (hrvSecondsRemaining <= 0) {
            hrvSecondsRemaining = 0;
            finishSession();
            return;
        }
        const descEl = document.getElementById('stateDescription');
        if (descEl) {
            descEl.innerText = `HRV — ${formatTime(Math.ceil(hrvSecondsRemaining))} remaining`;
            descEl.style.color = '#7c3aed';
        }
    }
    setTimerDisplay(document.getElementById('sessionTimerDisplay'), sessionSeconds);
    setTimerDisplay(document.getElementById('stateTimerDisplay'),   stateSeconds);
}

function handleTick() {
    const trueSessionSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
    updateTimers(trueSessionSeconds - sessionSeconds);
    // 1Hz HR recording — only when connected and HR is available; hard-capped at 3 hours
    if (!isReconnecting && latestHR > 0 && sessionHrRecording.length < HR_RECORDING_MAX_SAMPLES) {
        sessionHrRecording.push({ t: sessionSeconds, hr: latestHR, state: currentState });
    }
    saveSession();
}

function handleHeartRate(event) {
    if (isReconnecting) return;

    const dv = event.target.value;
    
    // --- DUPLICATE PACKET FILTER ---
    // Convert the raw DataView bytes into a quick hex string for comparison
    let hex = '';
    for (let i = 0; i < dv.byteLength; i++) hex += dv.getUint8(i).toString(16);
    
    const now = Date.now();
    // If we receive the exact same byte payload in less than 100ms, it's a duplicate listener phantom
    if (now - lastBlePacket.time < 100 && lastBlePacket.hex === hex) {
        return; // Silently drop the duplicate
    }
    lastBlePacket = { time: now, hex: hex };
    // -------------------------------
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

    // ── RFB phase tracking: detect inhale→exhale turn and lock HR peak ──────────
const rfbOnNow = (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED;
if (currentState === 'reset' && rfbOnNow && rfbWallStartTime > 0) {
        const breathPeriodMs = rfbBreathPeriodMs();
        const elapsed        = Date.now() - rfbWallStartTime;
        const cyclePos       = elapsed % breathPeriodMs;
        const inhaleMs       = rfbGetInhaleSec() * 1000;

        // Detect the moment cyclePos crosses the inhale→exhale threshold.
        // A 1-second tolerance window catches the crossing on whichever heartbeat
        // arrives first after the boundary.
        if (cyclePos >= inhaleMs && (cyclePos - 1000) < inhaleMs) {
            // Finalise the PREVIOUS cycle's lag before resetting the peak tracker.
            // _lastHrMaxTs must be after _lastInhaleEndTs to be a valid exhale peak.
            if (hrvProcessor._lastInhaleEndTs > 0 &&
                hrvProcessor._lastHrMaxTs > hrvProcessor._lastInhaleEndTs) {
                const finalisedLag = (hrvProcessor._lastHrMaxTs - hrvProcessor._lastInhaleEndTs) / 1000;
                hrvProcessor._lagHistory.push(finalisedLag);
                if (hrvProcessor._lagHistory.length > hrvProcessor._LAG_HISTORY_SIZE) {
                    hrvProcessor._lagHistory.shift();
                }
            }
            hrvProcessor._lastInhaleEndTs   = Date.now();
            hrvProcessor._currentCycleMaxHr = 0;
            // Do NOT update _lastHrMaxTs on the crossing beat — it shares the same
            // millisecond as _lastInhaleEndTs, making > comparison fail and blocking
            // finalisation next cycle. Only non-crossing beats update _lastHrMaxTs.
        } else if (currentHeartRate > hrvProcessor._currentCycleMaxHr) {
            // Non-crossing beat: track highest HR — timestamp is guaranteed to be
            // after _lastInhaleEndTs, so finalisation will succeed next crossing.
            hrvProcessor._currentCycleMaxHr = currentHeartRate;
            hrvProcessor._lastHrMaxTs       = Date.now();
        } else {
            // HR is below current cycle max — no action needed for lag tracking.
        }
    }

    recordHrHistory(currentHeartRate);
    updateCoherenceDisplay(); // coherence row self-hides outside RFB
    if (isHRVReading) updateHRVDisplay();

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

        // Resonance Breathing and HRV Reading sessions stay in reset state throughout —
        // no HR-driven transitions apply.
        // During pause with recovery tracking active: monitor resting band and
        // stop recovery timer once HR is stable in zone (15 consecutive beats).
        // No state transition occurs — this is purely a timer stop.
        if (currentState === 'pause' && isRecoveryState) {
            const lo = RESTING_HR - RESTING_HR_BANDWIDTH / 2, hi = RESTING_HR + RESTING_HR_BANDWIDTH / 2;
            if (currentHeartRate >= lo && currentHeartRate <= hi) resetToActiveCount++; else resetToActiveCount = 0;
            if (resetToActiveCount >= 15) {
                isRecoveryState = false; // stop the recovery timer — HR has returned to resting
            }
        }

        if (!isResonanceBreathing && !isHRVReading) {
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
}

// ─── RFB coherence summary ────────────────────────────────────────────────────
// Computes session-level RFB stats from the coherence recording.
// All RFB periods in a session are amalgamated — the recording is a flat
// time-series regardless of how many reset/RFB cycles occurred.
function computeRfbSummary(recording, activeSec) {
    if (!recording || recording.length === 0) return null;
    const riVals  = recording.map(s => s.ri  ?? s.c);  // fall back to raw coherence for old format
    const avg     = Math.round(riVals.reduce((a, b) => a + b, 0) / riVals.length);
    const peak    = Math.max(...riVals);
    // Use the real RFB clock if available; fall back to recording length for old sessions
    const totalSec = (activeSec && activeSec > 0) ? activeSec : recording.length;
    // Denominator is total RFB time so warmup seconds count against the score
    const pctAboveStar1 = Math.round(riVals.filter(v => v >= 15).length / totalSec * 100);
    return { avg, peak, pctAboveStar1, totalSec };
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

    const rfbStats = computeRfbSummary(rfbCoherenceRecording, rfbActiveSeconds);
    return {
        date: new Date().toISOString(),
        activityName: currentActivityName || '',
        activityId:   currentActivityId   || '',
        activitySettings: window.activitiesAPI ? window.activitiesAPI.getSettingsSnapshot() : {},
        totalActiveSec:   aStats.total,
        totalTargetSec:   totalTargetSeconds,
        budgetUsing:      (typeof BUDGET_USING !== 'undefined') ? BUDGET_USING : 0,
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
        sessionLengthSec: (isResonanceBreathing && rbSessionEndSeconds > 0) ? rbSessionEndSeconds : sessionSeconds,
        highestHr: sessionHrSamples.length ? Math.max(...sessionHrSamples) : 0,
        avgHr:     sessionHrSamples.length ? arrAvg(sessionHrSamples)      : 0,
        lowestHr:  sessionHrSamples.length ? Math.min(...sessionHrSamples) : 0,
        hrRecording: sessionHrRecording.slice(),
        // RFB coherence — null if RFB was not used or no valid readings were collected
        rfbAvgRI:         rfbStats ? rfbStats.avg           : null,
        rfbPeakRI:        rfbStats ? rfbStats.peak          : null,
        rfbPctAboveStar1: rfbStats ? rfbStats.pctAboveStar1 : null,
        rfbTotalSec:      rfbStats ? rfbStats.totalSec      : null,
        rfbCoherenceRecording: rfbStats ? rfbCoherenceRecording.slice() : null,
        // HRV Reading fields
        hvIndexFinal:      isHRVReading ? currentHRVIndex : null,
        hrvSessionTooShort: isHRVReading && sessionSeconds < HRV_SESSION_DURATION_SEC - 5,
        activityIsHRV:     isHRVReading,
    };
}

let summarySaveState = null; // tracks state of the summary modal save flow

function showSummaryModal(summary) {
    // Build and inject the session tile using the shared SummaryCard builder.
    // The tile starts collapsed — the user can tap the header to expand the
    // full stat groups, or proceed directly to Save / Discard.
    // No delete button and no graph button are shown in the modal context.
    const container = document.getElementById('summaryCardContainer');
    if (container) {
        container.innerHTML = window.SummaryCard.buildCardHTML(summary, {
            cardId:       'card-modal',
            showDelete:   false,
            showGraphBtn: false,
        });
    }

    document.getElementById('summaryNotes').value = '';
    const errEl = document.getElementById('summaryError');
    if (errEl) errEl.className = '';
    const saveBtn = document.getElementById('summarySaveBtn');
    if (saveBtn) saveBtn.textContent = 'Save session';
    summarySaveState = null;
    document.getElementById('summaryModal').classList.add('visible');
}

function isQuotaError(e) {
    return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                 e.code === 22 || e.code === 1014);
}

function saveSessionToHistory(summary, notes) {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const history = raw ? JSON.parse(raw) : [];
        const toSave = { ...summary, notes };

        // Pack the HR recording before writing
        if (Array.isArray(toSave.hrRecording) && toSave.hrRecording.length > 0) {
            toSave.hrRecording = packHrRecording(toSave.hrRecording, summary.sessionLengthSec || 0);
        }
        history.push(toSave);

        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch (e1) {
            if (!isQuotaError(e1)) throw e1;
            // Retry without recording
            history[history.length - 1].hrRecording = null;
            try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
                if (summary.activityId) localStorage.setItem(LAST_ACTIVITY_KEY, summary.activityId);
                return 'ok_without_recording';
            } catch (e2) {
                if (!isQuotaError(e2)) throw e2;
                history.pop(); // remove the failed entry
                return 'failed';
            }
        }

        if (summary.activityId) localStorage.setItem(LAST_ACTIVITY_KEY, summary.activityId);
        return 'ok';
    } catch (e) {
        console.error('Failed to save session history', e);
        return 'failed';
    }
}

function finishSession() {
    const dbg = document.getElementById('rfbDebug');
    if (dbg) dbg.textContent = '';
    const dbg2 = document.getElementById('hrvDebug');
    if (dbg2) dbg2.textContent = '';
    if (currentPeriodType === 'active') closeActivePeriod(true);
    else if (currentPeriodType === 'recovery') closeRecoveryPeriod(true);
    clearInterval(sessionInterval);
    isSessionRunning = false;
    pendingSummary = computeSessionSummary();
    showSummaryModal(pendingSummary);
}

function teardownSession() {
    isResonanceBreathing = false; rfbExtended = false;
    isHRVReading = false; currentHRVIndex = null;
    setRbDisplayMode(false);
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

function setRbDisplayMode(isRb) {
    const hide = id => { const el = document.getElementById(id); if (el) el.style.display = isRb ? 'none' : ''; };
    hide('restStatsContainer');
    hide('stateTimerBlock');
    hide('activeTotalTimerBlock');
    hide('manualResetBtn');
    const desc = document.getElementById('stateDescription');
    if (desc) desc.classList.toggle('rb-mode', isRb);
}

function startSession() {
    isSessionRunning = true; sessionSeconds = 0; sessionStartTime = Date.now();
    stateSeconds = 0; totalActiveSeconds = 0; totalTargetSeconds = 0; resetCount = 0; recoverySeconds = 0;
    activePeriods = []; recoveryPeriods = []; currentPeriodType = null; sessionHrSamples = [];
    rfbSessionClockStart = 0; activityLimitTriggered = false; sessionHrRecording = []; rfbCoherenceRecording = [];
    rfbActiveSeconds = 0; rbSessionEndSeconds = 0;
    // Flush HR graph history and RR pipeline so stale inter-session data
    // (accumulated while the sensor kept broadcasting) doesn't anchor the
    // graph window behind the new session start.
    hrHistory.length = 0;
    rrHistory.length = 0;
    hasRrData = false;
    lastRrTimestamp = 0;
    lastRrWallClock = 0;
    recordRrHistory._lastAcceptedRr = 0;
    peakFreqHistory.length = 0;
    hrvProcessor.reset();
    document.getElementById('homeBtn').style.display = 'none';
    setTimerDisplay(document.getElementById('sessionTimerDisplay'), 0);
    setTimerDisplay(document.getElementById('stateTimerDisplay'), 0);
    updateBudgetTimerDisplay();
    document.getElementById('maxHrDisplay').innerText = '--';
    document.getElementById('lagDisplay').innerText = '--';
    document.getElementById('toggleSessionBtn').classList.add('running');
    updateActivityDisplay();
    isResonanceBreathing = (currentActivityId === 'resonance_breathing');
    isHRVReading         = (currentActivityId === HRV_READING_ID);
    rfbExtended = false;
    // Reset artifact counters and HRV index for fresh session
    sessionTotalBeats = 0; sessionSensorArtifacts = 0; sessionPhysioArtifacts = 0;
    currentHRVIndex = null; _lastHRVDisplayTs = 0;
    setRbDisplayMode(isResonanceBreathing || isHRVReading);
    if (isResonanceBreathing) {
        // Enter reset+RFB immediately — no active phase, no waiting for resting HR.
        switchState('reset', true);
        rfbPhase = true;
        rfbSecondsRemaining = (typeof RFB_DURATION !== 'undefined' ? RFB_DURATION : 10) * 60;
        rfbWallStartTime = Date.now();
        rfbSessionClockStart = Date.now();
        startRfbAnimation();
    } else if (isHRVReading) {
        // HRV Reading: stay in reset state for the full 3-minute measurement window.
        switchState('reset', true);
        hrvSecondsRemaining = HRV_SESSION_DURATION_SEC;
    } else {
        switchState('active', true);
    }
    sessionInterval = setInterval(handleTick, 1000);
}

// ─── Disconnect / Reconnect ───────────────────────────────────────────────────
function handleDisconnect() {
    if (isManualDisconnect) { isManualDisconnect = false; return; }
    clearTimeout(heartbeatTimeout);
    if (isSessionRunning && !isReconnecting) startReconnect();
    else if (!isSessionRunning) {
        log('❌ Disconnected from device', true);
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
        log('❌ Could not reconnect after 30 attempts. Session ended.', true);
        switchState('stopped', true);
        if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
        return;
    }
    try {
        const server = await bluetoothDevice.gatt.connect();
        const service = await server.getPrimaryService('heart_rate');
        const characteristic = await service.getCharacteristic('heart_rate_measurement');
        await characteristic.startNotifications();
        // Remove any old ghost listeners before adding the new one
        characteristic.removeEventListener('characteristicvaluechanged', handleHeartRate);
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
        if (isHRVReading) {
            document.getElementById('stateIndicator').className = 'state-dot reset-hrv';
            descEl.style.color = '#7c3aed';
            descEl.innerText = `HRV — ${formatTime(Math.ceil(hrvSecondsRemaining))} remaining`;
        } else if (rfbOn) {
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
    if (!isSessionRunning || isResonanceBreathing || isHRVReading) return;
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
    // Pause option is not available during Resonance Breathing or HRV Reading sessions
    document.getElementById('modalPauseBtn').style.display = (isResonanceBreathing || isHRVReading) ? 'none' : '';
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
    const errEl  = document.getElementById('summaryError');
    const saveBtn = document.getElementById('summarySaveBtn');

    // If already saved (warning shown) or acknowledged failure, just close
    if (summarySaveState === 'done') {
        if (errEl) errEl.className = '';
        summarySaveState = null;
        document.getElementById('summaryModal').classList.remove('visible');
        teardownSession();
        return;
    }

    const notes = document.getElementById('summaryNotes').value.trim();
    if (!pendingSummary) {
        document.getElementById('summaryModal').classList.remove('visible');
        teardownSession();
        return;
    }

    const result = saveSessionToHistory(pendingSummary, notes);

    if (result === 'ok') {
        pendingSummary = null;
        if (errEl) errEl.className = '';
        document.getElementById('summaryModal').classList.remove('visible');
        teardownSession();

    } else if (result === 'ok_without_recording') {
        // Saved, but HR graph recording was dropped to fit in storage
        pendingSummary = null;
        if (errEl) {
            errEl.className = 'summary-warning';
            errEl.textContent = '⚠️ Session saved, but the HR graph recording was dropped — storage is almost full. Export your history and delete old sessions to free space.';
        }
        if (saveBtn) saveBtn.textContent = 'Close';
        summarySaveState = 'done';

    } else {
        // Complete failure — keep modal open so user can navigate to history
        if (errEl) {
            errEl.className = 'summary-error';
            errEl.textContent = '❌ Storage full — session not saved. Go to History, export your data and delete old sessions, then return here and try again.';
        }
        // pendingSummary remains set so they can retry
    }
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
        log('4. Starting live notifications...<br><br>⚠️ TIP: If the app freezes here, the connection is stuck. Try:<br>1. Closing the HR monitor or watch app on your phone (e.g. Polar Flow).<br>2. Unpairing the phone from inside the HR monitor or watch settings menu.<br>3. Unpairing the HR monitor or watch from the phone\'s Bluetooth settings.');
        await characteristic.startNotifications();
        // Remove any old ghost listeners before adding the new one
        characteristic.removeEventListener('characteristicvaluechanged', handleHeartRate);
        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
        log('✅ Success! Waiting for first heartbeat...');
        document.body.classList.add('connected');
        requestWakeLock();
        const restored = restoreSession();
        if (restored) { restoreSessionUI(); sessionInterval = setInterval(handleTick, 1000); }
        else document.getElementById('homeBtn').style.display = 'flex';
    } catch (error) {
        log('❌ Error: ' + error.message + '<br><br>💡 Tip: Please close any other app (like Polar Flow) that might be paired with the HR device, or unpair from device or phone settings.', true);
    }
});

// ─── Resonance Breathing time-up modal ───────────────────────────────────────
document.getElementById('rbTimeUpEndBtn').addEventListener('click', () => {
    document.getElementById('rbTimeUpModal').classList.remove('visible');
    finishSession();
});
document.getElementById('rbTimeUpExtendBtn').addEventListener('click', () => {
    document.getElementById('rbTimeUpModal').classList.remove('visible');
    rfbExtended = true;
    // Update description immediately
    const descEl = document.getElementById('stateDescription');
    if (descEl) { descEl.innerText = 'Resonance Breathing — extended'; descEl.style.color = '#1a7fff'; }
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
