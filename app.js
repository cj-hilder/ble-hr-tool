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
// True once the connected device has sent at least one RR-containing packet.
// Unlike hasRrData this is NOT reset on session start — it reflects hardware capability.
// Reset only on disconnect. Used to gate sine-wave guide and HRV session start.
let deviceSupportsRR = false;

// ─── HRV Pipeline (HRVProcessor) ─────────────────────────────────────────────
// Spectral coherence: interpolates RR to 4 Hz, Hanning-windowed FFT,
// HeartMath Coherence Ratio in the 0.04–0.26 Hz LF band (64-s window).
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
        this._lagHistory        = []; // kept for reset() symmetry — not used for averaging
        this._lagEma            = null;  // EMA of per-cycle lag (seconds); null until first cycle
        this._LAG_EMA_ALPHA     = 0.2;   // α=0.2 → time constant ≈ 4–5 cycles (~40–50s at 6 bpm)
    }
    addRR(rrInterval, timestamp) {
        if (!this._isValidRR(rrInterval)) return;
        this.buffer.push(rrInterval);
        this.timestamps.push(timestamp);
        this._trimBuffer();
    }
    computeCoherence(guideFreq) {
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
        const { peakFreq, peakBin, peakBandPower, totalPower } = this._computeBandMetrics(freqs, fftResult.magnitude, guideFreq);
        if (totalPower === 0) return null;
        // HeartMath Coherence Ratio, normalised form: PBP / totalPower.
        // Algebraically equivalent to CR/(1+CR) where CR = PBP/(totalPower−PBP),
        // but bounded to 0–1 without a separate normalisation step. A narrow
        // dominant peak at the breathing frequency drives the value toward 1;
        // background noise drives it toward 0.
        //   (McCraty et al. 2009; McCraty & Childre 2010)
        const coherenceRaw = peakBandPower / totalPower;
        // validBreathingRate is removed: the peak search is now anchored to guideFreq
        // ± 0.020 Hz by construction, so any returned peak is by definition in-band.
        const now      = this.timestamps.length ? this.timestamps[this.timestamps.length - 1] : Date.now();
        // No confidence ramp: FFT coherence is only displayed from 65s onwards (via the
        // phase-gated display in updateCoherenceDisplay), so early underestimation from
        // short windows is never shown. The ramp was suppressing a problem that no longer
        // exists and was persistently biasing the score at 90–120s.
        const coherence = this._ema(coherenceRaw, now);
        // Phase of the dominant RR oscillation at the START of the analysis window (n=0).
        // atan2(im, re) of the peak FFT bin: phase=0 means oscillation at maximum at t=0.
        // The Hanning window emphasises the window centre, so we also expose the centre
        // timestamp — that is the correct reference point for the phase comparison.
        const peakPhaseRad      = Math.atan2(fftResult.im[peakBin], fftResult.re[peakBin]);
        const windowCenterTime  = cleanedTs.length > 1
            ? (cleanedTs[0] + cleanedTs[cleanedTs.length - 1]) / 2
            : cleanedTs[0] || 0;
        return { coherence, peakFreq, breathingRate: peakFreq * 60, peakPhaseRad, windowCenterTime };
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
        //
        // 25% threshold (widened from 20%): this is a safety net behind the ingestion-time
        // classifier in recordRrHistory, which already removes sensor and physio artifacts.
        // The gate must be permissive enough to preserve legitimate large-amplitude RSA
        // peaks during deep resonance breathing (beat-to-beat swings can approach 10–15%
        // of RR at sustained high-amplitude breathing), while still catching gross values
        // that slipped through ingestion.
        const outRrs = [], outTs = [];
        let lastClean = 0;
        for (let i = 0; i < rrs.length; i++) {
            const ref = lastClean || rrs[i];
            if (Math.abs(rrs[i] - ref) / ref < 0.25) {
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
    _computeBandMetrics(freqs, magnitudes, guideFreq) {
        const N = freqs.length;
        // Only sum positive frequencies (i <= N/2) for power calculations.
        // The FFT of a real signal produces mirror-image bins for i > N/2 — summing
        // all N bins doubles totalPower and halves every coherence value. Literature
        // values use positive frequencies only, so restricting to i <= N/2 keeps our
        // scale in alignment with published benchmarks.
        //
        // Peak search is constrained to guideFreq ± 0.020 Hz — wide enough to
        // accommodate slight user drift from the guide pace (~±1.2 bpm at 6 bpm),
        // tight enough to exclude unrelated LF artefacts and slow HR drift that
        // previously inflated coherence when the FFT latched onto the wrong peak.
        const SEARCH_WIDTH = 0.020;
        let totalPower = 0, peakPower = 0, peakFreq = guideFreq, peakBin = 0;
        for (let i = 0; i < freqs.length; i++) {
            const f = freqs[i], p = magnitudes[i] ** 2;
            if (Math.abs(f - guideFreq) <= SEARCH_WIDTH && p > peakPower) {
                peakPower = p; peakFreq = f; peakBin = i;
            }
            if (i <= N / 2) totalPower += p;
        }
        // Peak band: ±0.010 Hz around the dominant peak, positive frequencies only.
        // At 64-s/4-Hz resolution (bin width 0.015625 Hz) this captures approximately
        // the peak bin alone, minimising spectral leakage contamination of peakBandPower.
        let peakBandPower = 0;
        const bandWidth = 0.010;
        for (let i = 0; i <= N / 2; i++) {
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
        return this._computeFromSlice(startIdx);
    }
    // Compute metrics for a specific time range [fromMs, toMs] (wall-clock milliseconds).
    // Used to get the excluded portion of the session for the weighted combination.
    computeHRVMetricsForRange(fromMs, toMs) {
        let startIdx = 0;
        while (startIdx < this.timestamps.length && this.timestamps[startIdx] < fromMs) startIdx++;
        let endIdx = startIdx;
        while (endIdx < this.timestamps.length && this.timestamps[endIdx] < toMs) endIdx++;
        return this._computeFromSlice(startIdx, endIdx);
    }
    _computeFromSlice(startIdx, endIdx) {
        const end    = endIdx !== undefined ? endIdx : this.timestamps.length;
        const rawRrs = this.buffer.slice(startIdx, end);
        const rawTs  = this.timestamps.slice(startIdx, end);
        if (rawRrs.length < 5) return null;
        const { rrs } = this._removeArtifacts(rawRrs, rawTs);
        if (rrs.length < 5) return null;
        const n      = rrs.length;
        const sumRR  = rrs.reduce((a, b) => a + b, 0);
        const meanRR = sumRR / n;
        const SS     = rrs.reduce((s, x) => s + (x - meanRR) ** 2, 0);
        const sdnn   = Math.sqrt(SS / n);
        let SSD = 0;
        for (let i = 1; i < n; i++) SSD += (rrs[i] - rrs[i - 1]) ** 2;
        const rmssd = Math.sqrt(SSD / (n - 1));
        return {
            rmssd: Math.round(rmssd), sdnn: Math.round(sdnn), meanRR: Math.round(meanRR), n,
            SSD, SS, sumRR,
        };
    }
    reset() {
        this.buffer = []; this.timestamps = [];
        this.lastCoherence = 0; this.lastCoherenceTime = 0;
        this._currentCycleMaxHr = 0;
        this._lastHrMaxTs = 0; this._lastInhaleEndTs = 0;
        this._lagHistory = [];
        this._lagEma     = null;
    }
}



const hrvProcessor = new HRVProcessor({ sampleRate: 4, windowSeconds: 64 });

// Rolling history of valid in-band spectral peak frequencies, used for the
// instability indicator only — not used to modify the coherence score.
const peakFreqHistory = [];
const PEAK_FREQ_MAX_HISTORY = 120; // ~1 Hz update rate → ~2 min of history

// ─── RFB display phase thresholds ─────────────────────────────────────────────
// t < RFB_DISPLAY_SEC : progress animation shown; debug shows coherence from 30s
// t ≥ RFB_DISPLAY_SEC : headline RI + stars shown; recording begins
const RFB_DISPLAY_SEC    = 65;  // 64-s window + 1-s grace; when headline number and recording activate
const RFB_DEBUG_SEC      = 30;  // when debug line switches from "collecting" to coherence stats
// Amplitude gate (go/no-go): RSA oscillation must exceed this floor before any
// RI score is awarded. Below the threshold the signal is too weak to distinguish
// genuine entrainment from noise, so RI is forced to zero. Amplitude is still
// reported in the debug line regardless of gate state.
// 2.0 bpm is a minimal-detectable-signal floor — above sensor noise and motion
// artefact at rest, but well below clinical RSA amplitude. It blocks scoring only
// when there is essentially no discernible HR oscillation at all.
const RFB_AMP_GATE = 2.0;
// Engagement detection (general activity RFB only):
// After the 65-s lead-in, require RFB_ENGAGE_STREAK consecutive seconds where
// coherence >= RFB_ENGAGE_COHERENCE AND |peakFreq - guideFreq| <= 0.010 Hz
// before opening the recording window. Once engaged, recording continues for
// the rest of the reset period regardless of subsequent coherence.
const RFB_ENGAGE_COHERENCE = 0.15; // half the HeartMath "very low" threshold
const RFB_ENGAGE_STREAK    = 5;    // consecutive qualifying seconds required

// Returns a 0–1 stability value (1 = stable, 0 = wandering).
// Thresholds are calibrated for the full PEAK_FREQ_MAX_HISTORY window:
//   MIN_STD = 0.005 Hz ≈ very stable
//   MAX_STD = 0.020 Hz ≈ clearly drifting (~±1.2 bpm)
//
// With fewer samples the sample std dev has more estimation noise, scaling as
// √(N_max/N). Thresholds are widened by this factor so that a user breathing
// perfectly steadily scores consistently from the first valid samples onward,
// rather than showing an artificial low-to-high ramp during history warmup.
function computeStability(history) {
    if (!history || history.length < 10) return 1; // insufficient data — assume stable
    const N    = history.length;
    const mean = history.reduce((a, b) => a + b, 0) / N;
    const variance = history.reduce((s, f) => { const d = f - mean; return s + d * d; }, 0) / N;
    const std  = Math.sqrt(variance);
    const scale   = Math.sqrt(PEAK_FREQ_MAX_HISTORY / N); // → 1.0 at full history
    const MIN_STD = 0.005 * scale;
    const MAX_STD = 0.020 * scale;
    const norm = Math.max(0, Math.min(1, (std - MIN_STD) / (MAX_STD - MIN_STD)));
    return 1 - norm;
}

let lastRrTimestamp    = 0; // Continuous internal clock — prevents packet jitter gaps
let lastRrWallClock    = 0; // Wall-clock time of last RR packet — detects background resume
let lastHrWallClock    = 0; // Wall-clock time of last HR packet (with or without RR)

// Gap threshold: if wall-clock time since last packet exceeds this, the app was
// backgrounded. Flush processor buffers so stale/flood data doesn't corrupt metrics.
const BACKGROUND_GAP_MS = 4000;

function recordRrHistory(rrValuesMs, notifTs) {
    const wallNow   = Date.now();
    const wallGap   = lastRrWallClock > 0 ? wallNow - lastRrWallClock : 0;
    lastRrWallClock = wallNow;
    // Pre-session beats are tagged 'idle' so the graph can colour them grey,
    // distinct from both active (black) and recovery/reset (white) states.
    const beatState = isSessionRunning ? currentState : 'idle';

    // Distinguish two gap scenarios using lastHrWallClock, which is updated on
    // every HR packet AFTER recordRrHistory returns, so it always holds the
    // previous packet's timestamp when we read it here.
    //
    //   Background gap: app suspended — both HR and RR stopped.
    //   → Full flush: queued packets are about to flood in.
    //
    //   Sensor RR interruption: brief skin contact loss (e.g. finger swipe).
    //   HR packets kept arriving; only RR stopped.
    //   → Soft reset: reseed the clock, discard pending beat; preserve processor
    //     buffers and lastCleanRr so metrics resume cleanly.
    const hrGap         = lastHrWallClock > 0 ? wallNow - lastHrWallClock : wallGap;
    const isBackgroundGap = wallGap > BACKGROUND_GAP_MS && hrGap > BACKGROUND_GAP_MS;
    const isSensorRrGap   = wallGap > BACKGROUND_GAP_MS && hrGap <= BACKGROUND_GAP_MS;

    if (isBackgroundGap) {
        hrvProcessor.reset();
        peakFreqHistory.length = 0;
        lastRrTimestamp = 0;
        recordRrHistory._lastCleanRr = 0;
        recordRrHistory._pendingBeat = null;
        recordRrHistory._warmupRrs = [];
        recordRrHistory._streak = null;
        rrHistory.length = 0;
    } else if (isSensorRrGap) {
        lastRrTimestamp = 0;
        recordRrHistory._pendingBeat = null;

        // Retroactively trim the last 3s of pre-gap data. A drift in the seconds
        // before the gap often escapes beat-by-beat artifact classification (each
        // step is small relative to its predecessor) but reflects the same sensor
        // degradation that produced the gap — the gap is the late-arriving evidence
        // that those preceding beats were already corrupted. Without this trim,
        // the post-gap graph bridges from the drift's peak rather than from clean
        // baseline, producing a tabletop. Anchor on gapStart (= previous
        // lastRrWallClock, recovered as wallNow - wallGap) rather than
        // lastHrWallClock — the latter has been advancing through the gap on
        // HR-only packets and would point inside the silence, not at its onset.
        const PRE_GAP_TRIM_MS = 3000;
        const gapStart        = wallNow - wallGap;
        const trimBoundary    = gapStart - PRE_GAP_TRIM_MS;
        while (rrHistory.length > 0 && rrHistory[rrHistory.length - 1].ts > trimBoundary) {
            rrHistory.pop();
        }
        // Parallel trim of the HRV processor's buffer so the corrupted pre-gap
        // beats do not feed RMSSD/SDNN/coherence. buffer and timestamps are kept
        // in lockstep by addRR; pop both together.
        while (hrvProcessor.timestamps.length > 0 &&
               hrvProcessor.timestamps[hrvProcessor.timestamps.length - 1] > trimBoundary) {
            hrvProcessor.timestamps.pop();
            hrvProcessor.buffer.pop();
        }
        // Clear the artifact-classifier baseline so resumed beats reseed via the
        // existing warmup path rather than being compared against a reference
        // that may itself have been a drift-corrupted beat we just discarded.
        recordRrHistory._lastCleanRr = 0;
        recordRrHistory._warmupRrs   = [];
        recordRrHistory._streak      = null;
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
        // Flood guard: beats can't happen in the future. When queued packets
        // flush after a background period, they arrive ms apart but each
        // carries seconds of RR content, so the forward clock races ahead of
        // wall-clock. Without this clamp, lastRrTimestamp drifts permanently
        // into the future — the re-anchor condition above stays satisfied
        // trivially (LHS negative, RHS positive), so every subsequent real-time
        // beat continues to forward-clock until disconnect. Shifting the packet
        // back so its last beat lands at notifTs keeps timestamps plausible
        // and collapses flood beats into the tail of the 90s window.
        if (ts > notifTs) {
            const shift = ts - notifTs;
            for (const p of pairs) p.ts -= shift;
            ts = notifTs;
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
    // All comparisons are made against lastCleanRr — the last beat confirmed clean.
    //
    // Graph consistency rule: a real HR spike is shown on the graph if and only if
    // the beat is part of a classified ectopic pair (PVC or PAC). All other deviant
    // beats receive a synthetic interpolated point so that what the user sees matches
    // what gets counted in the session summary.
    //
    // Physiological artifact classification requires a recognised consecutive PAIR.
    // "Consecutive" means adjacent cardiac events with no sensor gap between them:
    //   — within the same packet: guaranteed consecutive by construction
    //   — across packets: validated by comparing notifTs against the deferred beat's
    //     forward-clock timestamp plus the new packet's total RR span (±1500ms jitter)
    //
    // Two recognised pair patterns (±20% tolerance):
    //
    //   PVC (premature ventricular contraction):
    //     SA node keeps firing on schedule. Premature beat fires early (short RR),
    //     ventricles refractory for next SA impulse → compensatory pause (long RR).
    //     Criterion: rr1 short AND rr1 + rr2 ≈ 2 × lastCleanRr.
    //     Both beats excluded from HRV; shown as real spikes; counted as 1 event.
    //
    //   PAC (premature atrial contraction):
    //     Ectopic fires from atria, resetting the SA node. Short premature beat
    //     followed immediately by a normal beat (SA node restarted from ectopic).
    //     Criterion: rr1 short AND rr2 ≈ lastCleanRr.
    //     Only rr1 excluded from HRV and shown as spike; rr2 is clean. 1 event.
    //
    //   Short beat at end of packet → deferred to _pendingBeat for cross-packet check.
    //   Short beat matching neither pattern → sensor artifact (synthetic point).
    //   Long beat ≥20% above lastCleanRr not preceded by a classified short beat →
    //     sensor artifact. Genuine beat-to-beat HR changes are gradual (<5–10% per
    //     beat); a lone 20%+ long beat is almost always an orphaned compensatory pause
    //     or dropout. Synthetic-izing it ensures graph/count consistency.
    //
    // Stale-baseline recovery (consistent-streak reseed):
    //   When lastCleanRr becomes stale (e.g. noise burst masks the start of a real
    //   HR transition — cooldown after exercise, onset of activity), every genuine
    //   beat at the new level is rejected as long/short with no path back to clean.
    //   Runs of ≥5 consecutive same-direction rejections with RR spread ≤100 ms are
    //   self-consistency incompatible with random noise: the baseline is reseeded
    //   to the streak median and the current beat is promoted to clean. Any
    //   successful classification (clean / PVC / PAC) or gross Tier 1 rejection
    //   clears the streak.
    //
    // Routing:
    //   Sensor artifact  → synthetic interpolated graph point; excluded from HRV
    //   Physio artifact  → real HR spike on graph; excluded from HRV; counted
    //   Clean beat       → graph + HRV processor

    let lastCleanRr         = recordRrHistory._lastCleanRr         || 0;
    let lastSensorArtifactTs = recordRrHistory._lastSensorArtifactTs || 0;
    // Warmup seed: until lastCleanRr is established, collect the first 3 beats
    // that fall within a permissive physiological range (400–1500 ms, i.e. 40–150
    // bpm) and seed lastCleanRr from their median. Trusting a single first beat
    // as the classification baseline is unsafe — a noise beat at connection time
    // (e.g. 1800 ms) would lock subsequent real beats into Tier 1 sensor-artifact
    // classification with no recovery path short of a background flush.
    if (!recordRrHistory._warmupRrs) recordRrHistory._warmupRrs = [];

    // Prepend any beat deferred from the previous packet, validated by timestamp.
    const pendingBeat = recordRrHistory._pendingBeat || null;
    recordRrHistory._pendingBeat = null;
    if (pendingBeat) {
        const CONSECUTIVE_TOL_MS = 1500; // generous BLE jitter allowance
        if (notifTs - pendingBeat.ts <= totalRrMs + CONSECUTIVE_TOL_MS) {
            pairs.unshift({ ...pendingBeat, alreadyCounted: true });
        } else {
            // Gap too large — deferred beat is not adjacent to the new ones.
            sessionSensorArtifacts++;
            lastSensorArtifactTs = pendingBeat.ts;
            recordRrHistory._streak = null;
            if (recordRrHistory._lastCleanRr > 0) {
                const synth = Math.round(60000 / recordRrHistory._lastCleanRr);
                if (synth >= 24 && synth <= 240)
                    rrHistory.push({ hr: synth, state: beatState, ts: pendingBeat.ts });
            }
        }
    }

    // ── Consistent-streak baseline re-seed helpers ────────────────────────
    // Any rejection path that might represent a real baseline shift (rather
    // than noise) calls tryStreakReseed with the direction of rejection. When
    // a run of STREAK_LEN same-direction rejections accumulates with RR spread
    // ≤ STREAK_SPREAD_MS, the beats are self-consistent enough to not be noise:
    // the helper returns the median and the caller reseeds lastCleanRr,
    // promoting the current beat to clean from that point forward. Any
    // successful classification (clean / PVC / PAC) or gross Tier 1 rejection
    // calls resetStreak to invalidate an in-progress run.
    const STREAK_LEN       = 5;
    const STREAK_SPREAD_MS = 100;
    const tryStreakReseed = (rrVal, direction) => {
        if (!recordRrHistory._streak || recordRrHistory._streak.direction !== direction) {
            recordRrHistory._streak = { direction, rrs: [] };
        }
        recordRrHistory._streak.rrs.push(rrVal);
        if (recordRrHistory._streak.rrs.length >= STREAK_LEN) {
            const s = [...recordRrHistory._streak.rrs].sort((a, b) => a - b);
            if (s[s.length - 1] - s[0] <= STREAK_SPREAD_MS) {
                recordRrHistory._streak = null;
                return s[Math.floor(s.length / 2)];
            }
        }
        return null;
    };
    const resetStreak = () => { recordRrHistory._streak = null; };

    // PVC compensatory pauses are mechanistically precise (SA node fires on schedule),
    // so the pair-sum tolerance can be tight. PAC follow-up is near-normal but slightly
    // less constrained because the SA node resets from an arbitrary ectopic phase.
    // Both are tighter than the old 0.20 to avoid sensor noise satisfying either pattern.
    const PVC_TOL       = 0.12;  // pair-sum tolerance for PVC — percentage of 2×lastCleanRr
    const PAC_TOL_BPM   = 10;    // next-beat tolerance for PAC — fixed bpm, consistent with
                                  // DEV_BPM. Percentage tolerance was too permissive at high
                                  // HR (15% of RR 500ms = 18 bpm for a "normal" successor beat).
    // Fixed 10 bpm threshold for entry into artifact/ectopic analysis.
    // A percentage threshold becomes too permissive at high HR (15% of RR 500ms
    // = 18 bpm) and too tight at low RFB HR. A fixed bpm threshold correctly
    // reflects that genuine beat-to-beat variability is physiologically constrained
    // in absolute terms regardless of mean HR. At RFB HR 50 bpm the maximum
    // genuine beat-to-beat swing from a 20 bpm amplitude oscillation at 6 bpm
    // is ~7.5 bpm; at exercise HR 120 bpm genuine variability is well under 5 bpm.
    // 10 bpm provides headroom for both cases without becoming permissive at
    // high HR. False positive cost (synthetic fill) is low; false negative cost
    // (artifact displayed as real HR spike) is high — bias toward sensitivity.
    const DEV_BPM = 10; // bpm, entry threshold for Tier 2 artifact/ectopic analysis
    let i = 0;
    while (i < pairs.length) {
        const { rr, ts: t, alreadyCounted } = pairs[i];
        if (!alreadyCounted) sessionTotalBeats++;

        // ── Warmup: seed lastCleanRr from median of first 3 in-range beats ────
        // Only active when no baseline exists yet (session start with no inherited
        // baseline, or after a background/disconnect flush). Beats inside 400–1500
        // ms are accepted as clean (graphed + fed to HRV); beats outside that range
        // are counted as sensor artifacts with no synthetic fill (no baseline yet
        // to fill with). Once 3 in-range beats have accumulated, lastCleanRr is set
        // to their median and normal classification takes over on subsequent beats.
        if (lastCleanRr === 0) {
            if (rr >= 400 && rr <= 1500) {
                recordRrHistory._warmupRrs.push(rr);
                const instantHr = Math.round(60000 / rr);
                if (instantHr >= 24 && instantHr <= 240)
                    rrHistory.push({ hr: instantHr, state: beatState, ts: t });
                hrvProcessor.addRR(rr, t);
                if (recordRrHistory._warmupRrs.length >= 3) {
                    const sorted = [...recordRrHistory._warmupRrs].sort((a, b) => a - b);
                    lastCleanRr = sorted[1]; // median of 3
                    recordRrHistory._warmupRrs = [];
                }
            } else {
                sessionSensorArtifacts++;
                lastSensorArtifactTs = t;
                // No synthetic fill — no baseline established yet to fill from.
            }
            i++; continue;
        }

        // ── Tier 1: sensor artifact — outside physiological range or gross dropout ──
        // Require both relative deviation ≥ 50% AND absolute delta > 250 ms to avoid
        // misclassifying large RFB HR swings at low HR as sensor artifacts.
        const absDiff = lastCleanRr > 0 ? Math.abs(rr - lastCleanRr) : 0;
        const isSensorArtifact = rr < 250 || rr > 2000 ||
            (lastCleanRr > 0 && Math.abs(rr - lastCleanRr) / lastCleanRr >= 0.5 && absDiff > 250);

        if (isSensorArtifact) {
            sessionSensorArtifacts++;
            lastSensorArtifactTs = t;
            resetStreak();
            if (lastCleanRr > 0) {
                const syntheticHr = Math.round(60000 / lastCleanRr);
                if (syntheticHr >= 24 && syntheticHr <= 240)
                    rrHistory.push({ hr: syntheticHr, state: beatState, ts: t });
            }
            i++; continue;
        }

        // deviationBpm: positive = beat is faster than baseline (short RR), negative = slower
        const deviationBpm = lastCleanRr > 0 ? (60000 / rr) - (60000 / lastCleanRr) : 0;

        // ── Tier 2a: short beat — enter pair-based ectopic detection ─────────
        const isShort = lastCleanRr > 0 && deviationBpm >= DEV_BPM;

        if (isShort) {
            // ── Noise-burst guard ─────────────────────────────────────────────
            // If this short beat falls within NOISE_BURST_MS of a confirmed sensor
            // artifact it is almost certainly the tail of the same noise burst
            // rather than a genuine ectopic. Skip both deferral and PVC/PAC
            // evaluation and force a sensor-artifact classification immediately.
            // A run of such rejections can still trigger the streak-reseed path
            // if the underlying data is a real baseline shift masked by noise.
            const NOISE_BURST_MS = 1500;
            if (lastSensorArtifactTs > 0 && t - lastSensorArtifactTs <= NOISE_BURST_MS) {
                const reseed = tryStreakReseed(rr, 'short');
                if (reseed !== null) {
                    lastCleanRr = reseed;
                    const instantHr = Math.round(60000 / rr);
                    if (instantHr >= 24 && instantHr <= 240)
                        rrHistory.push({ hr: instantHr, state: beatState, ts: t });
                    hrvProcessor.addRR(rr, t);
                    i++; continue;
                }
                sessionSensorArtifacts++;
                lastSensorArtifactTs = t;
                if (lastCleanRr > 0) {
                    const syntheticHr = Math.round(60000 / lastCleanRr);
                    if (syntheticHr >= 24 && syntheticHr <= 240)
                        rrHistory.push({ hr: syntheticHr, state: beatState, ts: t });
                }
                i++; continue;
            }

            if (i + 1 >= pairs.length) {
                // No successor in this packet — defer for cross-packet validation.
                recordRrHistory._pendingBeat = { rr, ts: t };
                i++; break;
            }

            const next    = pairs[i + 1];
            const pairSum = rr + next.rr;

            // PVC: rr1 + rr2 ≈ 2 × lastCleanRr  (compensatory pause)
            const isPvc = Math.abs(pairSum - 2 * lastCleanRr) / (2 * lastCleanRr) < PVC_TOL;
            // PAC: rr2 ≈ lastCleanRr  (SA node reset — next beat is normal)
            // Extra sanity: rr2 must be longer than rr1. A premature beat is always
            // followed by a longer recovery; if rr2 ≤ rr1 it is more likely two noise hits.
            const isPac = !isPvc &&
                Math.abs((60000 / next.rr) - (60000 / lastCleanRr)) < PAC_TOL_BPM &&
                next.rr > rr;

            // ── Symmetric noise-burst guard ────────────────────────────────
            // Complement to the forward-looking guard above: if the beat
            // IMMEDIATELY AFTER a classified PVC/PAC pair is itself a sensor
            // artifact, the pair is more likely the leading edge of a noise
            // burst than a genuine ectopic. Roll back to sensor-artifact
            // classification for the short beat; normal flow will reclassify
            // the subsequent pause/follow-up on the next loop iteration
            // (long-beat Tier 2b → sensor for a PVC pause; near-baseline
            // → clean for a PAC follow-up). The guard only fires when
            // look-ahead is available in the current packet; a pair at the
            // very end of a packet is classified as before.
            if ((isPvc || isPac) && (i + 2) < pairs.length) {
                const after = pairs[i + 2];
                const afterAbsDiff = Math.abs(after.rr - lastCleanRr);
                const afterIsSensor = after.rr < 250 || after.rr > 2000 ||
                    (afterAbsDiff / lastCleanRr >= 0.5 && afterAbsDiff > 250);
                if (afterIsSensor) {
                    const reseed = tryStreakReseed(rr, 'short');
                    if (reseed !== null) {
                        lastCleanRr = reseed;
                        const instantHr = Math.round(60000 / rr);
                        if (instantHr >= 24 && instantHr <= 240)
                            rrHistory.push({ hr: instantHr, state: beatState, ts: t });
                        hrvProcessor.addRR(rr, t);
                        i++; continue;
                    }
                    sessionSensorArtifacts++;
                    lastSensorArtifactTs = t;
                    const syntheticHr = Math.round(60000 / lastCleanRr);
                    if (syntheticHr >= 24 && syntheticHr <= 240)
                        rrHistory.push({ hr: syntheticHr, state: beatState, ts: t });
                    i++; continue;
                }
            }

            if (isPvc) {
                if (!next.alreadyCounted) sessionTotalBeats++;
                sessionPhysioArtifacts++;
                resetStreak();
                const hrPremature = Math.round(60000 / rr);
                const hrPause     = Math.round(60000 / next.rr);
                if (hrPremature >= 24 && hrPremature <= 240)
                    rrHistory.push({ hr: hrPremature, state: beatState, ts: t, ectopic: true });
                if (hrPause >= 24 && hrPause <= 240)
                    rrHistory.push({ hr: hrPause, state: beatState, ts: next.ts, ectopic: true });
                // lastCleanRr NOT updated — baseline preserved through ectopic pair.
                i += 2; continue;
            }

            if (isPac) {
                sessionPhysioArtifacts++;
                resetStreak();
                const hrPremature = Math.round(60000 / rr);
                if (hrPremature >= 24 && hrPremature <= 240)
                    rrHistory.push({ hr: hrPremature, state: beatState, ts: t, ectopic: true });
                // lastCleanRr NOT updated — next beat evaluated against original baseline.
                i++; continue;
            }

            // Short beat matching neither pattern → sensor artifact, unless it is
            // part of a coherent streak that represents a real baseline shift.
            const reseed = tryStreakReseed(rr, 'short');
            if (reseed !== null) {
                lastCleanRr = reseed;
                const instantHr = Math.round(60000 / rr);
                if (instantHr >= 24 && instantHr <= 240)
                    rrHistory.push({ hr: instantHr, state: beatState, ts: t });
                hrvProcessor.addRR(rr, t);
                i++; continue;
            }
            sessionSensorArtifacts++;
            lastSensorArtifactTs = t;
            if (lastCleanRr > 0) {
                const syntheticHr = Math.round(60000 / lastCleanRr);
                if (syntheticHr >= 24 && syntheticHr <= 240)
                    rrHistory.push({ hr: syntheticHr, state: beatState, ts: t });
            }
            i++; continue;
        }

        // ── Tier 2b: long beat not preceded by a classified short beat ────────
        // Genuine HR deceleration is gradual — each step stays well within DEV_BPM.
        // A lone beat ≥ 10 bpm slower than baseline is almost always an orphaned
        // compensatory pause or sensor dropout. Synthetize it so the graph only
        // shows real HR values for classified ectopic pairs. A run of long beats
        // with tight spread is handled by the streak-reseed path below — the
        // common case is a post-exercise cooldown masked by a transient noise
        // burst, after which every real (slower) beat looks like an orphaned pause.
        const isLong = lastCleanRr > 0 && deviationBpm <= -DEV_BPM;

        if (isLong) {
            const reseed = tryStreakReseed(rr, 'long');
            if (reseed !== null) {
                lastCleanRr = reseed;
                const instantHr = Math.round(60000 / rr);
                if (instantHr >= 24 && instantHr <= 240)
                    rrHistory.push({ hr: instantHr, state: beatState, ts: t });
                hrvProcessor.addRR(rr, t);
                i++; continue;
            }
            sessionSensorArtifacts++;
            lastSensorArtifactTs = t;
            const syntheticHr = Math.round(60000 / lastCleanRr);
            if (syntheticHr >= 24 && syntheticHr <= 240)
                rrHistory.push({ hr: syntheticHr, state: beatState, ts: t });
            i++; continue;
        }

        // ── Clean beat ────────────────────────────────────────────────────────
        resetStreak();
        lastCleanRr = rr;
        hrvProcessor.addRR(rr, t);
        const instantHr = Math.round(60000 / rr);
        if (instantHr >= 24 && instantHr <= 240)
            rrHistory.push({ hr: instantHr, state: beatState, ts: t });
        i++;
    }
    recordRrHistory._lastCleanRr          = lastCleanRr;
    recordRrHistory._lastSensorArtifactTs = lastSensorArtifactTs;

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
    hrHistory.push({ hr, state: isSessionRunning ? currentState : 'idle', ts: now });
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
    // Always anchor the X-axis to wall-clock: show the most recent 90s.
    // Data older than the window clips off the left; on first connection
    // data builds in from the right (ECG-style) rather than the left.
    const windowStart = now - HR_HISTORY_MS;
    function toX(ts) { return ((ts - windowStart) / HR_HISTORY_MS) * W; }
    function toY(hr)  { return H - (hr / MAX_HR) * H; }

    // ── RFB breathing guide overlay ───────────────────────────────────────────
    // Drawn BEFORE the HR line so it sits behind it.
    // Only drawn when connected to a device that provides beat-to-beat RR data
    // (e.g. Polar H10).  A watch-type sensor without RR would show a flat HR
    // line that bears no relationship to the guide, which is misleading.
    const rfbResting = (typeof RESTING_HR !== 'undefined') ? RESTING_HR : 65;
    if (currentState === 'reset' && (typeof RFB_ENABLED !== 'undefined') && RFB_ENABLED && rfbWallStartTime > 0 && deviceSupportsRR) {
        const breathPeriodMs = rfbBreathPeriodMs();
        const inhaleFrac     = rfbGetInhaleFrac();
        const amplitude = 8; // ±8 bpm visual range
        ctx.globalAlpha = 0.75; // semi-transparent — picks up blue tint from background
        ctx.strokeStyle = '#202020';
        ctx.lineWidth = 2;
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
        ctx.globalAlpha = 1;
    }

    // ── HR line (beat-to-beat if available, averaged as fallback) ─────────────
    if (activeHistory.length >= 2) {
        // #b0b0b0 for pre-session idle data — lighter than #888 pause text,
        // darker than white session data, contrasts with black background.
        const hrLineColor = s => s === 'active' ? 'black' : s === 'idle' ? '#b0b0b0' : 'white';
        ctx.globalAlpha = 0.7;
        // Beat-to-beat data is drawn thinner since it has natural jaggedness
        ctx.lineWidth = hasRrData && activeHistory === rrHistory ? 1.5 : 3;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = hrLineColor(activeHistory[0].state);
        const GAP_HALF = 2.0;
        ctx.beginPath();
        let pathStarted = false, prevState = null;
        for (let i = 0; i < activeHistory.length; i++) {
            const { hr, state, ts } = activeHistory[i];
            const x = toX(ts), y = toY(hr);
            const isStateChange = prevState !== null && state !== prevState;
            if (isStateChange) {
                ctx.stroke();
                ctx.strokeStyle = hrLineColor(state);
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
let sessionInterval, wakeLock = null, wakeLockDesired = false, heartbeatTimeout;

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

// Session duration: 3 min (180s) default, 5 min (300s) if HRV_DURATION setting = 5.
// 5 min is recommended — provides ~5 vasomotor cycles for a stable estimate.
// 3 min is an acceptable compromise for daily practice.
function hrvSessionDurationSec() {
    return (typeof HRV_DURATION !== 'undefined' && HRV_DURATION === 5) ? 300 : 180;
}

const HRV_READING_ID = 'hrv_reading';

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
let rfbEngaged         = false; // latched true once engagement confirmed; reset each new RFB phase
let rfbEngagementStreak = 0;    // consecutive qualifying seconds toward engagement threshold

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
let targetHrSamples  = [];   // HR readings while latestHR >= TARGET_MIN_HR
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
            targetHrSum: targetHrSamples.reduce((a,b)=>a+b, 0),
            targetHrCount: targetHrSamples.length,
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
        const tCnt = s.targetHrCount || 0;
        if (tCnt > 0) {
            const tAvg = Math.round(s.targetHrSum / tCnt);
            targetHrSamples = [];
            for (let i = 0; i < tCnt; i++) targetHrSamples.push(tAvg);
        } else { targetHrSamples = []; }
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
// wakeLockDesired tracks *intent* (should we be holding a lock), independent of
// whether we currently hold one. The Screen Wake Lock API auto-releases the
// lock whenever the page becomes hidden, so we can't use `wakeLock !== null`
// as a signal to re-acquire — by the time visibilitychange fires on return,
// the release event has already nulled it out.
async function requestWakeLock() {
    wakeLockDesired = true;
    // Only request if the API is supported and we don't already have an active lock
    if ('wakeLock' in navigator && (wakeLock === null || wakeLock.released)) {
        wakeLock = null;          // normalise stale reference before the await
        try {
            wakeLock = await navigator.wakeLock.request('screen');

            // Log for debugging
            console.log('Wake Lock acquired');

            // Handle the case where the system releases the lock.
            // Two scenarios:
            //   1. Page hidden (switch app, lock button): visibilitychange re-acquires on return.
            //   2. System release while still visible (battery saver, low battery, OS power
            //      management): visibilitychange never fires, so we must re-acquire here.
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
                wakeLock = null;
                if (wakeLockDesired && document.visibilityState === 'visible') {
                    requestWakeLock();
                }
            });
        } catch (err) {
            console.log('Wake Lock Error:', err);
        }
    }
}

// --- Re-acquire lock and refresh graph when the app comes back to the foreground ---
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;

    // Re-acquire the wake lock if we wanted one. The API auto-released it when
    // the page was hidden, so wakeLock is null here even though we still want it.
    if (wakeLockDesired && (wakeLock === null || wakeLock.released)) {
        wakeLock = null;          // clear stale reference before re-acquiring
        await requestWakeLock();
    }

    // Eager flush if we were backgrounded long enough for the BLE queue to hold
    // stale data. The lazy flush inside recordRrHistory only fires when the
    // first queued packet arrives — that can leave pre-background data visible
    // for tens/hundreds of ms. Doing it here makes the resume instantaneous-
    // blank rather than briefly-stale. The first flood packet will still hit
    // the isBackgroundGap branch (idempotent) and seed cleanly from notifTs.
    const hrGap = lastHrWallClock > 0 ? Date.now() - lastHrWallClock : 0;
    if (hrGap > BACKGROUND_GAP_MS) {
        hrvProcessor.reset();
        peakFreqHistory.length = 0;
        lastRrTimestamp = 0;
        recordRrHistory._lastCleanRr = 0;
        recordRrHistory._pendingBeat = null;
        recordRrHistory._warmupRrs = [];
        recordRrHistory._streak = null;
        rrHistory.length = 0;
        hrHistory.length = 0;
    }

    // Force an immediate redraw of the HR graph. While hidden, requestAnimationFrame
    // is paused and BLE handlers are throttled, so the canvas is still showing the
    // last frame with its old windowStart — it looks frozen in the past until the
    // next beat arrives. Redrawing now snaps the window to the current time.
    drawHrGraph();
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
    // Add a small offset (PHASE_FLAT_K) to the cosine before scaling, then clamp
    // at 1.0. This flattens the top of the curve so that lags within the normal
    // healthy range (≈ ±1 s of the expected 2 s baroreflex delay, equivalent to
    // ±37° at 6 bpm) attract no penalty at all. Only lags clearly outside that
    // range begin to reduce the multiplier.
    // k = 0.2  →  flat zone: phaseDiffDeg where cos(θ)+0.2 ≥ 1  →  |θ| ≤ 37°
    // Floor shifts from 0.50 to 0.55 at 180° — slightly less severe at the extreme.
    const PHASE_FLAT_K = 0.2;
    const phaseMult = phaseDiffDeg != null
        ? Math.min(1, 0.75 + 0.25 * (Math.cos(phaseDiffDeg * Math.PI / 180) + PHASE_FLAT_K))
        : 1.0;
    const stabMult  = 0.70 + 0.30 * stability;
    return Math.min(1, coherence * phaseMult * stabMult);
}

// ─── HRV Index ────────────────────────────────────────────────────────────────
// Returns null when pSensor > 2% (session data is unreliable).
// Otherwise: rawIndex × balanceFactor
//   rawIndex      = ln(RMSSD) × 15.3  — vagal tone, scaled to ~0–100 for typical adults
//   balanceFactor ∈ [0,1]           — sympathovagal balance (RMSSD/SDNN ratio)
//
// Physiological artifact rate (ectopy) is intentionally not penalised here.
// In a 3-minute window (~200 beats) the count is dominated by Poisson sampling
// noise. Ectopics are reported separately in the session summary for longitudinal
// tracking across full-length sessions where sample sizes are meaningful.
function calculateHRVIndex({ rmssd, sdnn, pSensor }) {
    const HEALTHY_BALANCE = 0.5;
    if (pSensor > 0.02 || rmssd <= 0 || sdnn <= 0) return null;
    const rawIndex      = Math.log(rmssd) * 15.3;
    const balanceFactor = Math.min(Math.max((rmssd / sdnn) / HEALTHY_BALANCE, 0), 1);
    return {
        index:         Math.round(rawIndex * balanceFactor * 10) / 10,
        rawIndex:      Math.round(rawIndex * 10) / 10,
        balanceFactor: Math.round(balanceFactor * 1000) / 1000,
    };
}

// ─── HRV display (updated once per second during HRV Reading sessions) ────────
let _lastHRVDisplayTs = 0;
let _hrv60Stats = null; // fixed first-60s metrics, captured once at t=60
function updateHRVDisplay() {
    if (!isHRVReading) return;
    const now = Date.now();
    if (now - _lastHRVDisplayTs < 1000) return;
    _lastHRVDisplayTs = now;

    const el       = document.getElementById('coherenceDisplay');
    const coherEl  = document.getElementById('coherenceRow');
    const coherVal = document.getElementById('coherenceValue');
    if (!el || !coherVal) return;

    el.style.display = 'flex';

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

    const elapsedSec  = sessionSeconds;
    const progressEl  = document.getElementById('rfbProgress');
    const arc         = document.getElementById('rfbProgressArc');

    // First 60s: show progress arc, hide RI number.
    // The rolling window needs at least one complete minute to cancel the
    // vasomotor oscillation; showing a number before that is misleading.
    if (elapsedSec < 60) {
        if (coherEl) coherEl.style.display = 'none';
        if (progressEl) progressEl.style.display = 'flex';
        if (arc) {
            const CIRCUMFERENCE = 125.66;
            arc.setAttribute('stroke', '#7c3aed'); // purple for HRV
            arc.setAttribute('stroke-dashoffset',
                (CIRCUMFERENCE * (1 - elapsedSec / 60)).toFixed(2));
        }
        if (showDebug) dbg.textContent = 'collecting data…';
        return;
    }

    // 60s+: hide progress arc, show RI.
    if (progressEl) progressEl.style.display = 'none';
    if (coherEl) coherEl.style.display = 'flex';

    // Capture the first 60 seconds of data once and hold it fixed.
    // R60/SDNN60 represent a full vasomotor cycle and are the anchor
    // for the weighted mean that smooths minute-boundary jumps.
    if (!_hrv60Stats) {
        _hrv60Stats = hrvProcessor.computeHRVMetricsForRange(
            sessionStartTime,
            sessionStartTime + 60000) || null;
    }

    const t = elapsedSec;
    const W = Math.floor(t / 60) * 60; // trailing window length (complete minutes)
    const E = t - W;                    // seconds not in trailing window (0–59)

    // Rw: RMSSD/SDNN from the most recent W seconds.
    const winMetrics = hrvProcessor.computeHRVMetrics(W * 1000);

    // Weighted mean: R = (E/t) × R60 + (W/t) × Rw
    // When E=0 (at a minute boundary): pure Rw — no blending needed.
    // When E>0: R60 gets weight E/t, Rw gets weight W/t.
    // This fills in the excluded fraction of the session with the known-good
    // first-minute value, keeping the estimate smooth across boundaries.
    let rmssd, sdnn;
    if (!winMetrics) {
        coherVal.textContent = '--';
        coherVal.style.color = '#7c3aed';
        if (showDebug) dbg.textContent = 'collecting data…';
        currentHRVIndex = null;
        return;
    }
    if (E === 0 || !_hrv60Stats) {
        rmssd = winMetrics.rmssd;
        sdnn  = winMetrics.sdnn;
    } else {
        const wW = W / t, wE = E / t;
        rmssd = wE * _hrv60Stats.rmssd + wW * winMetrics.rmssd;
        sdnn  = wE * _hrv60Stats.sdnn  + wW * winMetrics.sdnn;
    }

    const pSensor = sessionTotalBeats > 0 ? sessionSensorArtifacts / sessionTotalBeats : 0;

    if (pSensor > 0.02) {
        coherVal.textContent = '--';
        coherVal.style.color = '#7c3aed';
        if (showDebug) dbg.textContent = 'sensor unreliable';
        currentHRVIndex = null;
        return;
    }

    const result = calculateHRVIndex({ rmssd, sdnn, pSensor });
    if (!result) {
        coherVal.textContent = '--';
        coherVal.style.color = '#7c3aed';
        if (showDebug) dbg.textContent = 'insufficient data';
        currentHRVIndex = null;
        return;
    }

    currentHRVIndex = result.index;
    coherVal.textContent = String(Math.round(result.index));
    coherVal.style.color = '#7c3aed';

    if (showDebug) {
        dbg.textContent =
            `RMSSD:${Math.round(rmssd)}ms  balance:${Math.round(result.balanceFactor * 100)}%` ;
    }
}
function computeResonance() {
    if (!hasRrData) return null;
    // Guide frequency derived from current inhale/exhale settings — passed into
    // computeCoherence so the FFT peak search is anchored to the breathing pace
    // the user is following, rather than searching the whole LF band.
    const guideFreq = 1 / (rfbGetInhaleSec() + rfbGetExhaleSec());
    const result = hrvProcessor.computeCoherence(guideFreq);
    if (result === null) return null;

    // All returned peaks are now in-band by construction (search is guideFreq ± 0.020 Hz),
    // so every reading is valid for stability tracking.
    peakFreqHistory.push(result.peakFreq);
    if (peakFreqHistory.length > PEAK_FREQ_MAX_HISTORY) peakFreqHistory.shift();

    const stability = computeStability(peakFreqHistory);

    // Stability is only meaningful once the processor buffer spans a full analysis
    // window. Before that the FFT peak bin jumps around due to short-window spectral
    // noise, not genuine breathing instability. Using 1.0 (neutral) during warmup
    // prevents a misleading early penalty on the resonance index.
    // Stability is meaningful once enough in-band peaks have accumulated for
    // computeStability to produce a reliable estimate. The sqrt(N_max/N) scaling
    // corrects for estimation noise at partial history, so 30 samples (~30s of
    // valid in-band readings) is sufficient to display a trustworthy value.
    // The buffer-span check was unreliable because _trimBuffer keeps the span
    // just below windowSeconds * 1000, so the condition was never met.
    const stabilityReady = peakFreqHistory.length >= 30;
    const stabilityForIndex = stabilityReady ? stability : 1.0;

    // Phase alignment — time-domain peak offset method.
    // Averages the last N finalised cycle lags for stability, then normalises
    // to degrees. The expected healthy lag (baroreflex loop delay) is ~2 s;
    // this is converted to degrees at the current breathing rate so the
    // centering remains correct across the full RFB range rather than being
    // calibrated only to 6 bpm.
    let phaseDiffDeg = null;
    if (hrvProcessor._lagEma !== null) {
        const breathPeriodSec  = rfbBreathPeriodMs() / 1000;
        const EXPECTED_LAG_SEC = 2.0; // physiological RSA lag: baroreflex loop delay
        const rawPhaseDeg      = (hrvProcessor._lagEma  / breathPeriodSec) * 360;
        const expectedLagDeg   = (EXPECTED_LAG_SEC / breathPeriodSec) * 360;
        phaseDiffDeg = Math.round(rawPhaseDeg - expectedLagDeg);
    }

    // Amplitude gate (go/no-go): measure RSA oscillation amplitude from instantaneous
    // beat-to-beat HR values in rrHistory (60000/RR — not BLE-averaged integers, which
    // are attenuated by sensor smoothing). The window is sliced into 20-second blocks;
    // max−min per block is averaged to capture local oscillation while staying immune
    // to slow HR drift that would inflate a single window-wide max−min.
    // If amplitude is below RFB_AMP_GATE the signal is too weak to confirm entrainment
    // and RI is forced to zero. Above the gate, amplitude does not affect the score.
    let amplitudeBpm = 0;
    {
        const BLOCK_MS = 20000;
        const now = Date.now();
        const windowStart = now - hrvProcessor.windowSeconds * 1000;
        const relevant = rrHistory.filter(p => p.ts >= windowStart && !p.ectopic);
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
    const amplitudeOk = amplitudeBpm >= RFB_AMP_GATE;
    const ri = amplitudeOk
        ? computeResonanceIndex(result.coherence, stabilityForIndex, phaseDiffDeg)
        : 0;

    return {
        ri,
        coherence:    result.coherence,
        peakFreq:     result.peakFreq,
        amplitudeBpm,
        amplitudeOk,
        stability,
        stabilityReady,
        phaseDiffDeg,
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

    // Resonance row — only during reset + RFB
    if (coherEl) coherEl.style.display = inRfb ? 'flex' : 'none';
    if (inRfb && coherVal) {
        const guideFreq = 1 / (rfbGetInhaleSec() + rfbGetExhaleSec());
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

        // Compute elapsed time upfront — progress arc fills during the lead-in regardless
        // of FFT state; coherence is only displayed from 65s onwards.
        const rfbElapsedSec = rfbWallStartTime > 0 ? (Date.now() - rfbWallStartTime) / 1000 : 0;
        const progressEl    = document.getElementById('rfbProgress');
        const arc           = document.getElementById('rfbProgressArc');

        if (rfbElapsedSec < RFB_DISPLAY_SEC) {
            // Progress arc phase — headline suppressed until FFT window is full at 65s.
            if (coherEl) coherEl.style.display = 'none';
            if (progressEl) progressEl.style.display = 'flex';
            if (arc) {
                const CIRCUMFERENCE = 125.66; // 2π × r=20
                const pct = Math.min(1, rfbElapsedSec / RFB_DISPLAY_SEC);
                arc.setAttribute('stroke', '#1a7fff'); // reset to blue (may have been purple from HRV)
                arc.setAttribute('stroke-dashoffset', (CIRCUMFERENCE * (1 - pct)).toFixed(2));
            }
            // Debug: "collecting data…" for first 30s, then live coherence (even if jumpy).
            if (showDebug) {
                if (rfbElapsedSec < RFB_DEBUG_SEC || r === null) {
                    dbg.textContent = 'collecting data…';
                } else {
                    const amp = r.amplitudeBpm;
                    const relLagSec = r.phaseDiffDeg != null ? (r.phaseDiffDeg / 360 * (rfbBreathPeriodMs() / 1000)) : null;
                    const lagStr   = relLagSec != null ? `${relLagSec >= 0 ? '+' : ''}${relLagSec.toFixed(1)}s` : '--';
                    const stabStr  = r.stabilityReady ? `${Math.round(r.stability * 100)}%` : '--';
                    dbg.textContent = `coherence:${Math.round(r.coherence * 100)}% ampl:${amp.toFixed(1)} stability:${stabStr} lag:${lagStr}`;
                }
            }

        } else {
            // 65s+: FFT window is full.
            if (progressEl) progressEl.style.display = 'none';

            if (r === null) {
                if (coherEl) coherEl.style.display = 'none';
                if (showDebug) dbg.textContent = 'collecting data…';
            } else {
                // Engagement gate — general activity only. isResonanceBreathing users
                // opted in explicitly so record unconditionally after the lead-in.
                // For general activity, require RFB_ENGAGE_STREAK consecutive seconds
                // of coherence >= RFB_ENGAGE_COHERENCE and peak frequency within
                // 0.010 Hz of the guide frequency. Once latched, rfbEngaged stays
                // true for the rest of this reset period.
                if (!isResonanceBreathing && !rfbEngaged) {
                    const freqMatch  = Math.abs(r.peakFreq - guideFreq) <= 0.010;
                    const coherOk    = r.coherence >= RFB_ENGAGE_COHERENCE;
                    if (freqMatch && coherOk) {
                        rfbEngagementStreak++;
                        if (rfbEngagementStreak >= RFB_ENGAGE_STREAK) rfbEngaged = true;
                    } else {
                        rfbEngagementStreak = 0;
                    }
                }

                if (!isResonanceBreathing && !rfbEngaged) {
                    // Waiting for engagement confirmation.
                    if (coherEl) coherEl.style.display = 'flex';
                    coherVal.textContent = 'Waiting…';
                    if (showDebug) {
                        const amp = r.amplitudeBpm;
                        const relLagSec = r.phaseDiffDeg != null ? (r.phaseDiffDeg / 360 * (rfbBreathPeriodMs() / 1000)) : null;
                        const lagStr   = relLagSec != null ? `${relLagSec >= 0 ? '+' : ''}${relLagSec.toFixed(1)}s` : '--';
                        const stabStr  = r.stabilityReady ? `${Math.round(r.stability * 100)}%` : '--';
                        dbg.textContent = `c:${r.coherence.toFixed(2)} f:${(r.peakFreq * 60).toFixed(1)}bpm ampl:${amp.toFixed(1)} stab:${stabStr} lag:${lagStr} streak:${rfbEngagementStreak}/${RFB_ENGAGE_STREAK}`;
                    }
                } else {
                    // Engaged (or Resonance Breathing): show RI and record.
                    if (coherEl) coherEl.style.display = 'flex';
                    const riPct = Math.round(r.ri * 100);
                    const amp   = r.amplitudeBpm;
                    coherVal.textContent = riPct > 0
                        ? `${riPct} ${window.rfbRating(riPct, true)}`
                        : window.rfbRating(0, true);
                    if (showDebug) {
                        const relLagSec = r.phaseDiffDeg != null ? (r.phaseDiffDeg / 360 * (rfbBreathPeriodMs() / 1000)) : null;
                        const lagStr   = relLagSec != null ? `${relLagSec >= 0 ? '+' : ''}${relLagSec.toFixed(1)}s` : '--';
                        const stabStr  = r.stabilityReady ? `${Math.round(r.stability * 100)}%` : '--';
                        dbg.textContent = `c:${Math.round(r.coherence * 100)}% f:${(r.peakFreq * 60).toFixed(1)}bpm ampl:${amp.toFixed(1)} stab:${stabStr} lag:${lagStr}`;
                    }
                    // Recording starts only once engaged — keeps summary data honest.
                    if (isSessionRunning) rfbCoherenceRecording.push({
                        t:    sessionSeconds,
                        c:    Math.round(r.coherence * 100),
                        ri:   riPct,
                        stab: Math.round(r.stability * 100),
                        ph:   r.phaseDiffDeg ?? null,
                        amp:  Math.round(r.amplitudeBpm * 10) / 10,
                    });
                }
            }
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
    const progressEl = document.getElementById('rfbProgress');
    if (progressEl) progressEl.style.display = 'none';
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
        targetHrSamples.push(latestHR);
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
                // Time's up — show modal and alert once; the condition stays true on
                // every subsequent tick, so guard against re-firing with a visibility check.
                rfbSecondsRemaining = 0;
                const modal = document.getElementById('rbTimeUpModal');
                if (!modal.classList.contains('visible')) {
                    rbSessionEndSeconds = sessionSeconds;
                    triggerNotification();
                    modal.classList.add('visible');
                }
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
            triggerNotification();
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
        // Mark device as RR-capable on first RR-containing packet.
        // This persists until disconnect so session start checks are reliable.
        deviceSupportsRR = true;
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
    // Updated AFTER the RR block so that inside recordRrHistory, lastHrWallClock
    // still holds the previous packet's timestamp. If updated before, hrGap would
    // always be ~0 and the sensor-RR-gap detection would never fire.
    lastHrWallClock = Date.now();

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
                // EMA update: on first cycle seed directly; thereafter blend with α.
                // α=0.4 weights the most recent cycle at 40%, giving a time constant
                // of ~2–3 cycles so genuine phase shifts appear within ~20–30s at 6 bpm.
                if (hrvProcessor._lagEma === null) {
                    hrvProcessor._lagEma = finalisedLag;
                } else {
                    hrvProcessor._lagEma = hrvProcessor._LAG_EMA_ALPHA * finalisedLag +
                                           (1 - hrvProcessor._LAG_EMA_ALPHA) * hrvProcessor._lagEma;
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
                        // Fresh RFB phase — engagement must be re-demonstrated.
                        rfbEngaged = false; rfbEngagementStreak = 0;
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
    // Denominator excludes the warmup period (first 75s) during which no recordings
    // are collected. Fall back to recording length for old sessions that pre-date
    // the warmup gate (they have no warmup to subtract).
    const RFB_WARMUP_SEC = RFB_DISPLAY_SEC; // recording starts when headline activates
    const measuredSec = (activeSec && activeSec > RFB_WARMUP_SEC)
        ? activeSec - RFB_WARMUP_SEC
        : recording.length;
    const totalSec = measuredSec;
    const pctAboveStar1 = Math.round(riVals.filter(v => v >= window.RFB_STAR_LEVELS.STAR1).length / totalSec * 100);
    // Amplitude stats — stored to allow future recalculation of RI if the
    // amplitude gate formula changes. amp is 0 for old sessions without the field.
    const ampVals = recording.map(s => s.amp ?? 0);
    const avgAmplitude = Math.round(ampVals.reduce((a, b) => a + b, 0) / ampVals.length * 10) / 10;
    const peakRiIdx    = riVals.indexOf(peak);
    const peakRiAmplitude = ampVals[peakRiIdx] ?? null;
    return { avg, peak, pctAboveStar1, totalSec, avgAmplitude, peakRiAmplitude };
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

        // If the terminal period is the only valid period, treat it as non-terminal
        // so it participates fully in all statistics (avg, min, max, count).
        // A lone terminal has nothing to skew — the usual protection against a
        // truncated final period distorting an established dataset doesn't apply.
        const promoted       = nonTerminal.length === 0 && !!terminal;
        const effNonTerminal = promoted ? [terminal] : nonTerminal;
        const effTerminal    = promoted ? null       : terminal;

        const ntDur = effNonTerminal.map(p => p.duration);
        const currentMin = ntDur.length ? Math.min(...ntDur) : Infinity;

        // Determine whether terminal joins the average pool
        const terminalInAvg = effTerminal && ntDur.length > 0 && effTerminal.duration >= currentMin;
        const avgPool = terminalInAvg ? [...effNonTerminal, effTerminal] : effNonTerminal;
        const maxPool = effTerminal   ? [...effNonTerminal, effTerminal] : effNonTerminal;

        const dur    = avgPool.map(p => p.duration);
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

        // Apply the same promotion as periodStats.
        const promoted    = nonTerm.length === 0 && !!terminal;
        const effNonTerm  = promoted ? [terminal] : nonTerm;
        const effTerminal = promoted ? null       : terminal;

        const ntDur = effNonTerm.map(p => p.duration);
        const currentMin = ntDur.length ? Math.min(...ntDur) : Infinity;
        const termInAvg = effTerminal && ntDur.length > 0 && effTerminal.duration >= currentMin;
        const avgPool   = termInAvg ? [...effNonTerm, effTerminal] : effNonTerm;

        // Lags and peaks are assembled independently of the duration-based avgPool.
        // Non-terminal (or promoted) periods: included if they have a recorded peak.
        // Terminal period (unpromoted): included if the lag is valid — lagSec < duration
        // means the peak HR occurred before the period ended, so HR was observed declining.
        const lagPool = [
            ...effNonTerm.filter(p => p.maxHr > 0),
            ...(effTerminal && effTerminal.maxHr > 0 && effTerminal.lagSec < effTerminal.duration
                ? [effTerminal] : []),
        ];
        return {
            ...base,
            lagCount: lagPool.length,
            lags:  lagPool.map(p => p.lagSec),
            peaks: lagPool.map(p => p.maxHr),
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
        numLagPeriods:       rStats.lagCount,
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
        pctTarget:    sessionSeconds > 0 && totalTargetSeconds > 0
                        ? Math.round(totalTargetSeconds / sessionSeconds * 100) : 0,
        avgHrTarget:  targetHrSamples.length ? Math.round(arrAvg(targetHrSamples)) : 0,
        // Schema version — increment when stored fields change in a way that
        // affects recalculation of derived metrics (e.g. RI amplitude gate).
        // Absent on pre-versioning sessions (treat as version 0 / legacy).
        schemaVersion: 1,
        sessionLengthSec: (isResonanceBreathing && rbSessionEndSeconds > 0) ? rbSessionEndSeconds : sessionSeconds,
        highestHr: sessionHrSamples.length ? Math.max(...sessionHrSamples) : 0,
        avgHr:     sessionHrSamples.length ? arrAvg(sessionHrSamples)      : 0,
        lowestHr:  sessionHrSamples.length ? Math.min(...sessionHrSamples) : 0,
        hrRecording: sessionHrRecording.slice(),
        // RFB coherence — null if RFB was not used or no valid readings were collected
        rfbAvgRI:           rfbStats ? rfbStats.avg              : null,
        rfbPeakRI:          rfbStats ? rfbStats.peak             : null,
        rfbPctAboveStar1:   rfbStats ? rfbStats.pctAboveStar1    : null,
        rfbTotalSec:        rfbStats ? rfbStats.totalSec         : null,
        // Amplitude stats stored for future recalculation of historical RI scores
        // if the amplitude gate formula changes. peakRiAmplitude is the RSA
        // amplitude at the moment of peak RI, giving context for that best score.
        rfbAvgAmplitude:    rfbStats ? rfbStats.avgAmplitude     : null,
        rfbPeakRiAmplitude: rfbStats ? rfbStats.peakRiAmplitude  : null,
        rfbCoherenceRecording: rfbStats ? rfbCoherenceRecording.slice() : null,
        // HRV Reading fields
        hvIndexFinal:      isHRVReading ? currentHRVIndex : null,
        // Short-session warning fires below 180s — at 179s the rolling window
        // uses only floor(179/60)×60 = 120s (2 min), so 180s is the minimum
        // for a valid 3-min measurement regardless of session length setting.
        hrvSessionTooShort: isHRVReading && sessionSeconds < 180,
        activityIsHRV:     isHRVReading,
        // Ectopic beat tracking — all session types.
        // Reported as count + rate for longitudinal monitoring across full sessions.
        // Omitted from summary display when count is zero.
        totalBeats:   sessionTotalBeats,
        ectopicCount: sessionPhysioArtifacts,
        ectopicPct:   sessionTotalBeats > 0
            ? Math.round(sessionPhysioArtifacts / sessionTotalBeats * 1000) / 10
            : null,
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
    const progressEl = document.getElementById('rfbProgress');
    if (progressEl) progressEl.style.display = 'none';
    setRbDisplayMode(false);
    const toggleBtn = document.getElementById('toggleSessionBtn');
    toggleBtn.innerText = 'Start Session'; toggleBtn.classList.remove('running', 'paused');
    document.getElementById('manualResetBtn').style.display = 'none';
    clearSession();
    document.getElementById('homeBtn').style.display = 'flex';
    currentActivityId = null; currentActivityName = null;
    updateActivityDisplay();
    switchState('stopped', true);
    wakeLockDesired = false; if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
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

// ─── No-RR warning ────────────────────────────────────────────────────────────
// Shown when the user tries to start an HRV Reading on a device that has not
// transmitted any RR interval data (e.g. a Polar watch rather than an H10).
// Creates a minimal modal overlay inline so no new HTML is required.
// Calls teardownSession() on OK — does NOT go through finishSession(), so no
// summary modal appears for this zero-length, data-free session.
function showNoRrWarningAndEnd() {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)', 'z-index:9999',
        'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
    ].join(';');
    overlay.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid #7c3aed;border-radius:14px;
                    padding:28px 24px;max-width:320px;text-align:center;color:#f0f0f0;
                    box-shadow:0 8px 32px rgba(0,0,0,0.6);">
            <div style="font-size:2.2em;margin-bottom:12px;">⚠️</div>
            <p style="margin:0 0 8px;font-size:1.05em;font-weight:600;color:#c4b5fd;">
                Chest strap required
            </p>
            <p style="margin:0 0 20px;font-size:0.9em;line-height:1.55;color:#d1d5db;">
                HRV Reading needs a chest strap heart rate monitor that transmits
                beat-to-beat RR intervals, such as the&nbsp;<strong>Polar&nbsp;H10</strong>.
                <br><br>
                Your current device does not appear to support RR data.
                Please reconnect with a compatible chest strap.
            </p>
            <button id="noRrOkBtn"
                style="background:#7c3aed;color:white;border:none;border-radius:8px;
                       padding:13px 0;font-size:1em;font-weight:600;cursor:pointer;width:100%;">
                OK
            </button>
        </div>`;
    document.body.appendChild(overlay);
    document.getElementById('noRrOkBtn').addEventListener('click', () => {
        overlay.remove();
        teardownSession();
    });
}

function startSession() {
    isSessionRunning = true; sessionSeconds = 0; sessionStartTime = Date.now();
    stateSeconds = 0; totalActiveSeconds = 0; totalTargetSeconds = 0; resetCount = 0; recoverySeconds = 0;
    activePeriods = []; recoveryPeriods = []; currentPeriodType = null; sessionHrSamples = []; targetHrSamples = [];
    rfbSessionClockStart = 0; activityLimitTriggered = false; sessionHrRecording = []; rfbCoherenceRecording = [];
    rfbActiveSeconds = 0; rbSessionEndSeconds = 0;
    rfbEngaged = false; rfbEngagementStreak = 0;
    // Preserve hrHistory and rrHistory across session start — pre-session beats
    // are tagged 'idle' and displayed in grey, giving up to 90s of context before
    // the session begins. The RR pipeline (lastRrTimestamp, processor, etc.) is
    // still reset so metrics start fresh and the first post-start packet re-anchors.
    hasRrData = false;
    lastRrTimestamp = 0;
    lastRrWallClock = 0;
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
    currentHRVIndex = null; _lastHRVDisplayTs = 0; _hrv60Stats = null;
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
        hrvSecondsRemaining = hrvSessionDurationSec();
        if (!deviceSupportsRR) {
            // Device has sent no RR data since connecting — almost certainly a watch,
            // not a chest strap.  Defer the warning by one frame so the session UI
            // renders first (gives the user visual context), then abort cleanly.
            setTimeout(showNoRrWarningAndEnd, 50);
        }
    } else {
        switchState('active', true);
    }
    sessionInterval = setInterval(handleTick, 1000);
}

// ─── Disconnect / Reconnect ───────────────────────────────────────────────────
function handleDisconnect() {
    if (isManualDisconnect) { isManualDisconnect = false; return; }
    clearTimeout(heartbeatTimeout);
    deviceSupportsRR = false; // reset — next connected device must prove RR capability
    if (isSessionRunning && !isReconnecting) startReconnect();
    else if (!isSessionRunning) {
        log('❌ Disconnected from device', true);
        document.body.classList.remove('connected');
        wakeLockDesired = false; if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
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
        document.getElementById('homeBtn').style.display = 'flex';
        // Null the device reference so requestDevice() starts fresh next time.
        // Keeping the old reference can cause the browser to block the picker
        // because it considers the device still claimed from the previous session.
        bluetoothDevice = null;
        log('❌ Could not reconnect after 30 attempts. Session ended.', true);
        switchState('stopped', true);
        wakeLockDesired = false; if (wakeLock !== null) wakeLock.release().then(() => { wakeLock = null; });
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
    // Always just hide the connected UI without disconnecting. If a session is
    // running it continues normally; if not, the BLE connection is preserved so
    // Connect can fast-path straight back without showing the device picker.
    document.body.classList.remove('connected');
    if (!isSessionRunning) {
        document.getElementById('homeBtn').style.display = 'none';
    }
});

document.getElementById('connectBtn').addEventListener('click', async () => {
    // Fast-path: already connected (e.g. user hit home during a session).
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        document.body.classList.add('connected');
        if (isSessionRunning) {
            restoreSessionUI();
            // sessionInterval is already running — do not start a second one
        } else {
            document.getElementById('homeBtn').style.display = 'flex';
        }
        return;
    }

    // Previously-paired device path: use the user gesture to drive gatt.connect()
    // on a device the browser already has permission for, avoiding the picker.
    // This handles the page-refresh case where the JS context was cleared but
    // the browser still remembers the device from getDevices().
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
        try {
            log('Looking for previously connected device...');
            const devices = await navigator.bluetooth.getDevices();
            if (devices.length > 0) {
                const device = devices[0];
                device.addEventListener('gattserverdisconnected', handleDisconnect);
                // Retry up to 3 times — H10 may take a few seconds to start
                // advertising again after a disconnect / page reload.
                let connected = false;
                for (let attempt = 1; attempt <= 3 && !connected; attempt++) {
                    try {
                        log(`Reconnecting to ${device.name || 'device'}… (attempt ${attempt}/3)`);
                        const server = await device.gatt.connect();
                        const service = await server.getPrimaryService('heart_rate');
                        const characteristic = await service.getCharacteristic('heart_rate_measurement');
                        await characteristic.startNotifications();
                        characteristic.removeEventListener('characteristicvaluechanged', handleHeartRate);
                        characteristic.addEventListener('characteristicvaluechanged', handleHeartRate);
                        bluetoothDevice = device;
                        log('✅ Reconnected. Waiting for first heartbeat...');
                        document.body.classList.add('connected');
                        requestWakeLock();
                        const restored = restoreSession();
                        if (restored) { restoreSessionUI(); sessionInterval = setInterval(handleTick, 1000); }
                        else document.getElementById('homeBtn').style.display = 'flex';
                        connected = true;
                    } catch (e) {
                        if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
                    }
                }
                if (connected) return;
                log('Could not reconnect automatically — please select your device below.');
            } else {
                log('No previous device found — please select your HR monitor.');
            }
        } catch (e) {
            log('Bluetooth lookup failed — please select your device below.');
        }
    }

    // Full picker path: no known device or reconnect failed.
    try {
        // Ensure any stale device reference is cleared before requesting a new one.
        // If the previous device was abandoned (e.g. after failed reconnection),
        // some browsers block requestDevice() until the old reference is released.
        if (bluetoothDevice && !bluetoothDevice.gatt.connected) {
            bluetoothDevice = null;
        }
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
    // ── Session restore ───────────────────────────────────────────────────────
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
