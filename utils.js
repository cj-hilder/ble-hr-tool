// utils.js — shared utilities loaded before app.js, settings.js, and history.js
// Keep this file free of DOM references and app state.

// ─── Time formatting ──────────────────────────────────────────────────────────
function formatTime(s) {
    s = Math.max(0, Math.round(s));
    if (s >= 3600) {
        return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
               String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' +
               String(s % 60).padStart(2, '0');
    }
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ─── HTML escaping ────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── HR Recording codec ───────────────────────────────────────────────────────
// Pack a 1Hz HR recording into a compact binary format for localStorage.
// Scheme: 12 bits per sample (9-bit HR + 3-bit state), 2 samples per 3 bytes,
// Base64 encoded. Dense array indexed by second; missing seconds stored as HR=0.
function packHrRecording(samples, sessionLengthSec) {
    const STATE_CODE = { active: 0, rest: 1, reset: 2, pause: 3, stopped: 4 };
    const len = Math.max(sessionLengthSec + 1, samples.length > 0 ? samples[samples.length - 1].t + 1 : 1);

    const slots = new Array(len).fill(null).map(() => [0, 0]);
    for (const s of samples) {
        if (s.t >= 0 && s.t < len && s.hr > 0) {
            slots[s.t] = [Math.min(511, Math.max(1, Math.round(s.hr))), STATE_CODE[s.state] ?? 0];
        }
    }

    const paddedLen = slots.length % 2 === 0 ? slots.length : slots.length + 1;
    const bytes = new Uint8Array((paddedLen / 2) * 3);
    for (let i = 0; i < paddedLen; i += 2) {
        const [hr0, st0] = slots[i]     || [0, 0];
        const [hr1, st1] = slots[i + 1] || [0, 0];
        const base = (i / 2) * 3;
        bytes[base]     = (hr0 >> 1) & 0xFF;
        bytes[base + 1] = ((hr0 & 1) << 7) | ((st0 & 7) << 4) | ((hr1 >> 5) & 0xF);
        bytes[base + 2] = ((hr1 & 0x1F) << 3) | (st1 & 7);
    }

    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { fmt: 'p1', b64: btoa(binary), len: slots.length };
}

// Inverse of packHrRecording. Accepts either the packed {fmt, b64, len} object
// or a legacy plain array of {t, hr, state}.
function unpackHrRecording(packed) {
    if (!packed) return [];
    if (Array.isArray(packed)) return packed;
    if (packed.fmt !== 'p1' || !packed.b64) return [];

    const STATE_NAMES = ['active', 'rest', 'reset', 'pause', 'stopped'];
    const binary = atob(packed.b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const result = [];
    const numPairs = Math.floor(bytes.length / 3);
    for (let p = 0; p < numPairs; p++) {
        const base = p * 3;
        const b0 = bytes[base], b1 = bytes[base + 1], b2 = bytes[base + 2];
        const hr0 = (b0 << 1) | (b1 >> 7);
        const st0 = (b1 >> 4) & 7;
        const hr1 = ((b1 & 0xF) << 5) | (b2 >> 3);
        const st1 = b2 & 7;
        const t0 = p * 2, t1 = p * 2 + 1;
        if (hr0 > 0 && t0 < packed.len) result.push({ t: t0, hr: hr0, state: STATE_NAMES[st0] || 'active' });
        if (hr1 > 0 && t1 < packed.len) result.push({ t: t1, hr: hr1, state: STATE_NAMES[st1] || 'active' });
    }
    return result;
}
