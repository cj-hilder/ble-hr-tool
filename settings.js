// settings.js — must be loaded before app.js
// Manages activity types (each with their own settings), exposes activitiesAPI,
// and injects the hamburger settings panel.

(function () {

const DEFAULTS = {
    MAX_HR:                 170,
    RESTING_HR:             65,
    RESTING_HR_BANDWIDTH:   10,
    TARGET_MIN_HR:          70,
    TARGET_MAX_HR:          90,
    ACTIVE_THRESHOLD_UPPER: 80,
    ACTIVE_THRESHOLD_LOWER: 77,
    BRADYCARDIA_THRESHOLD:  55,
    ACTIVE_TIME_LIMIT:      0,   // minutes; 0 = no limit
    MAX_RECOVERY_PERIOD:    240,
    MAX_RESPONSE_LAG:       60,
    NUM_RESETS_B4_WARN:     3,
    ALERT_VIBRATION:        1,   // 0=off, 1=subtle, 2=intense
    ALERT_SOUND:            1,   // 0=off, 1=subtle, 2=intense
    RFB_ENABLED:            0,   // 0=off, 1=on
    RFB_INHALE_SEC:         4.0, // inhale duration in seconds
    RFB_EXHALE_SEC:         6.0, // exhale duration in seconds (sum gives breath period)
    RFB_DURATION:           2.0, // minutes to spend in RFB after resting HR achieved
    RFB_SOUND:              1,   // 0=off, 1=on
    RFB_VIBRATION:          1,   // 0=off, 1=on
    RFB_SHOW_DEBUG:         0,   // 0=off, 1=on
    HRV_SHOW_DEBUG:         0,   // 0=off, 1=on
};

const RESONANCE_BREATHING_ID = 'resonance_breathing';
const HRV_READING_ID_S = 'hrv_reading';

// Defaults for the built-in HRV Reading activity.
const HRV_DEFAULTS = {
    MAX_HR:               170,
    RESTING_HR:           65,
    RESTING_HR_BANDWIDTH: 10,
    TARGET_MIN_HR:        60,
    TARGET_MAX_HR:        75,
    HRV_SHOW_DEBUG:       0,
    // All other settings inherit from DEFAULTS but are hidden in the panel
};

// Defaults for the built-in Resonance Breathing activity.
// RFB_ENABLED is always 1 here and is not user-editable.
const RB_DEFAULTS = {
    MAX_HR:                 170,
    RESTING_HR:             65,
    RESTING_HR_BANDWIDTH:   10,
    TARGET_MIN_HR:          60,
    TARGET_MAX_HR:          75,
    ACTIVE_THRESHOLD_UPPER: 80,
    ACTIVE_THRESHOLD_LOWER: 77,
    BRADYCARDIA_THRESHOLD:  55,
    ACTIVE_TIME_LIMIT:      0,
    MAX_RECOVERY_PERIOD:    240,
    MAX_RESPONSE_LAG:       60,
    NUM_RESETS_B4_WARN:     3,
    ALERT_VIBRATION:        0,
    ALERT_SOUND:            0,
    RFB_ENABLED:            1,   // always on — not user-editable
    RFB_INHALE_SEC:         4.0,
    RFB_EXHALE_SEC:         6.0,
    RFB_DURATION:           10.0, // session length in minutes
    RFB_SOUND:              1,
    RFB_VIBRATION:          1,
    RFB_SHOW_DEBUG:         0,
    HRV_SHOW_DEBUG:         0,
};

// Fields hidden in the settings panel when Resonance Breathing is selected.
const RESONANCE_HIDDEN_KEYS = new Set([
    'BRADYCARDIA_THRESHOLD',
    'ACTIVE_THRESHOLD_UPPER', 'ACTIVE_THRESHOLD_LOWER', 'ACTIVE_TIME_LIMIT',
    'MAX_RECOVERY_PERIOD', 'MAX_RESPONSE_LAG', 'NUM_RESETS_B4_WARN',
    'TARGET_MIN_HR', 'TARGET_MAX_HR',
    'ALERT_VIBRATION', 'ALERT_SOUND',
    'RFB_ENABLED',
    'HRV_SHOW_DEBUG',
]);
const RESONANCE_HIDDEN_GROUPS = new Set([
    'Active Thresholds', 'Recovery Limits', 'Target Zone', 'Alerts', 'HRV Reading',
]);

// Fields shown in the settings panel when HRV Reading is selected.
const HRV_SHOWN_KEYS = new Set([
    'MAX_HR', 'RESTING_HR', 'RESTING_HR_BANDWIDTH',
    'HRV_SHOW_DEBUG',
]);
const HRV_SHOWN_GROUPS = new Set([
    'Heart Rate Range', 'Resting HR', 'HRV Reading',
]);

// Fields always hidden for standard (non-built-in) activities.
const DEFAULT_HIDDEN_KEYS   = new Set(['HRV_SHOW_DEBUG']);
const DEFAULT_HIDDEN_GROUPS = new Set(['HRV Reading']);

const ALERT_OPTIONS = [
    { value: 0, label: 'Off'     },
    { value: 1, label: 'Subtle'  },
    { value: 2, label: 'Intense' },
];

const FIELDS = [
    { group: 'Heart Rate Range' },
    { key: 'MAX_HR', label: 'Max HR', unit: 'bpm',
      desc: 'Your personal maximum heart rate. Used to scale the speedometer and the HR history graph. Calculate it with <a href="https://www.targetheartratecalculator.org/">this tool</a>.' },
    { key: 'BRADYCARDIA_THRESHOLD', label: 'Bradycardia threshold', unit: 'bpm',
      desc: 'If HR drops below this it triggers a heart rate reset. Detects an unusually low heart rate that may indicate overexertion or heart rate recovery undershoot.' },
    { group: 'Resting HR' },
    { key: 'RESTING_HR', label: 'Resting HR', unit: 'bpm',
      desc: 'Your typical resting heart rate. Used as the target to return to during a heart rate reset.' },
    { key: 'RESTING_HR_BANDWIDTH', label: 'Bandwidth', unit: 'bpm',
      desc: 'Width of the acceptable resting HR window. HR must stay within this band for 15 consecutive seconds before a HR reset is considered complete.' },
    { group: 'Active Thresholds' },
    { key: 'ACTIVE_THRESHOLD_UPPER', label: 'Upper threshold', unit: 'bpm',
      desc: 'If HR exceeds this during activity it will trigger "Rest or pull back". If you are unsure, the safe choice is resting HR + 15.' },
    { key: 'ACTIVE_THRESHOLD_LOWER', label: 'Lower threshold', unit: 'bpm',
      desc: 'HR must fall below this to transition back to "Continue activity". Usually set just below the upper threshold.' },
    { key: 'ACTIVE_TIME_LIMIT', label: 'Activity time limit', unit: 'min',
      desc: 'Total active time allowed per session in minutes. When reached the app transitions to reset state. Set to 0 for no limit.' },
    { group: 'Recovery Limits' },
    { key: 'MAX_RECOVERY_PERIOD', label: 'Max recovery period', unit: 's',
      desc: 'Maximum time allowed in the "Rest or pull back" state before a forced HR reset is triggered.' },
    { key: 'MAX_RESPONSE_LAG', label: 'Max response lag', unit: 's',
      desc: 'If HR has not started falling within this many seconds of "Rest or pull back", a HR reset is forced.' },
    { key: 'NUM_RESETS_B4_WARN', label: 'Resets before warning', unit: '',
      desc: 'Number of HR resets allowed before the app shows a prominent warning to end the session.' },
    { group: 'Target Zone' },
    { key: 'TARGET_MIN_HR', label: 'Target min', unit: 'bpm',
      desc: 'Lower edge of the target zone shown on the speedometer. Purely a guide.' },
    { key: 'TARGET_MAX_HR', label: 'Target max', unit: 'bpm',
      desc: 'Upper edge of the target zone.' },
    { group: 'Alerts' },
    { key: 'ALERT_VIBRATION', label: 'Vibration', type: 'select', options: ALERT_OPTIONS,
      desc: 'Subtle: two short pulses. Intense: rapid triple burst — designed to cut through background noise.' },
    { key: 'ALERT_SOUND', label: 'Sound', type: 'select', options: ALERT_OPTIONS,
      desc: 'Subtle: single soft tone. Intense: two sharp high-pitched beeps at higher volume.' },
    { group: 'Resonance Frequency Breathing' },
    { key: 'RFB_ENABLED', label: 'Enable RFB', type: 'toggle',
      desc: 'During the reset state the status dot turns blue and pulses as a breath pacer. A sine-wave overlay on the graph shows the expected HR coherence pattern.' },
    { key: 'RFB_INHALE_SEC', label: 'Inhale', unit: 's',
      desc: 'Duration of each inhale in seconds. Longer inhales increase parasympathetic activation.' },
    { key: 'RFB_EXHALE_SEC', label: 'Exhale', unit: 's',
      desc: 'Duration of each exhale in seconds. Longer exhales increase vagal tone.' },
    { type: 'display', id: 'rfbRateDisplay', label: 'Breathing rate',
      desc: 'Calculated from inhale + exhale. 6.0 bpm is the classic adult resonance frequency.' },
    { key: 'RFB_DURATION', label: 'RFB duration', unit: 'min',
      desc: 'Extra minutes to spend in resonance breathing after heart rate returns to resting.' },
    { key: 'RFB_SOUND', label: 'Inhale sound guide', type: 'toggle',
      desc: 'Rising filtered noise during each inhale — starts low and brightens, helping you pace the breath without watching the screen.' },
    { key: 'RFB_VIBRATION', label: 'Inhale vibration guide', type: 'toggle',
      desc: 'An initial pulse, followed by buzzing that accelerates through the inhale, then a closing pulse.' },
    { key: 'RFB_SHOW_DEBUG', label: 'Display details', type: 'toggle',
      desc: 'Display wave coherence, frequency stability, and phase lag — the components that are used to calculate the resonance index.' },
    { group: 'HRV Reading' },
    { key: 'HRV_SHOW_DEBUG', label: 'Display details', type: 'toggle',
      desc: 'Display RMSSD, autonomic balance, and anomaly percentage during an HRV Reading session.' },
];

const ACTIVITIES_KEY        = 'hrPacerActivities';
const SELECTED_ACTIVITY_KEY = 'hrPacerSelectedActivity';

// ── Activity management ──────────────────────────────────────────────────────

let activities = [];
let selectedActivityId = '';

function generateId() {
    return 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function loadActivities() {
    try {
        const raw = localStorage.getItem(ACTIVITIES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) activities = parsed;
        }
    } catch(e) {}

    if (activities.length === 0) {
        const migratedSettings = {};
        try {
            const old = JSON.parse(localStorage.getItem('hrPacerSettings') || '{}');
            for (const [k, v] of Object.entries(DEFAULTS))
                migratedSettings[k] = (k in old) ? Number(old[k]) : v;
        } catch(e) {
            for (const [k, v] of Object.entries(DEFAULTS)) migratedSettings[k] = v;
        }
        activities = [{
            id: 'default',
            name: 'General Activity',
            description: 'Default heart rate pacing protocol for general physical activity.',
            settings: { ...migratedSettings }
        }];
        persistActivities();
    }

    // Ensure the built-in Resonance Breathing activity always exists and is first.
    // This runs on every load so it self-heals after migrations or manual storage edits.
    (function ensureResonanceBreathing() {
        const idx = activities.findIndex(a => a.id === RESONANCE_BREATHING_ID);
        if (idx >= 0) {
            const rb = activities[idx];
            if (!rb.settings) rb.settings = {};
            rb.settings.RFB_ENABLED = 1; // always enforce
            if (idx !== 0) { activities.splice(idx, 1); activities.unshift(rb); }
        } else {
            activities.unshift({
                id: RESONANCE_BREATHING_ID,
                name: 'Resonance Breathing',
                description: 'Guided resonance frequency breathing session with real-time coherence monitoring.',
                settings: { ...RB_DEFAULTS },
            });
        }
        persistActivities();
    })();

    // Ensure the built-in HRV Reading activity always exists at position 1 (after RB).
    (function ensureHRVReading() {
        const idx = activities.findIndex(a => a.id === HRV_READING_ID_S);
        const baseSettings = { ...DEFAULTS, ...HRV_DEFAULTS };
        if (idx >= 0) {
            const hrv = activities[idx];
            if (!hrv.settings) hrv.settings = {};
            // Move to position 1 if not already there
            if (idx !== 1) { activities.splice(idx, 1); activities.splice(1, 0, hrv); }
        } else {
            activities.splice(1, 0, {
                id: HRV_READING_ID_S,
                name: 'HRV Reading',
                description: 'A 3-minute resting HRV measurement. Sit still and breathe normally.',
                settings: baseSettings,
            });
        }
        persistActivities();
    })();

    const savedSel = localStorage.getItem(SELECTED_ACTIVITY_KEY);
    selectedActivityId = (savedSel && activities.find(a => a.id === savedSel))
        ? savedSel : activities[0].id;
}

function persistActivities() {
    localStorage.setItem(ACTIVITIES_KEY, JSON.stringify(activities));
}

function persistSelectedActivity() {
    localStorage.setItem(SELECTED_ACTIVITY_KEY, selectedActivityId);
}

function getSelectedActivity() {
    return activities.find(a => a.id === selectedActivityId) || activities[0];
}

function loadActivitySettingsIntoGlobals(act) {
    const a = act || getSelectedActivity();
    for (const [k, v] of Object.entries(DEFAULTS))
        window[k] = (a.settings && k in a.settings) ? Number(a.settings[k]) : v;
}

// ── Initialize synchronously ─────────────────────────────────────────────────
loadActivities();
loadActivitySettingsIntoGlobals();

// ── Public API ───────────────────────────────────────────────────────────────
window.activitiesAPI = {
    getAll:   ()   => JSON.parse(JSON.stringify(activities)),
    getById:  (id) => { const a = activities.find(x => x.id === id); return a ? JSON.parse(JSON.stringify(a)) : null; },
    applySettings: (id) => {
        const act = activities.find(a => a.id === id) || getSelectedActivity();
        loadActivitySettingsIntoGlobals(act);
    },
    getSettingsSnapshot: () => {
        const snap = {};
        for (const k of Object.keys(DEFAULTS)) snap[k] = window[k];
        return snap;
    }
};

// ── Build Settings Panel ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    const style = document.createElement('style');
    style.textContent = `
        #settingsBtn {
            position: fixed; top: 10px; right: 12px; z-index: 200;
            background: transparent; color: #888; font-size: 26px;
            padding: 2px 8px; border-radius: 6px; line-height: 1; transition: color 0.2s;
        }
        #settingsBtn:hover { color: white; }
        #settingsOverlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.55); z-index: 299;
        }
        #settingsOverlay.open { display: block; }
        #settingsPanel {
            position: fixed; top: 0; right: 0;
            width: min(320px, 92vw); height: 100vh;
            background: #111; border-left: 1px solid #2a2a2a;
            z-index: 300; display: flex; flex-direction: column;
            transform: translateX(100%); transition: transform 0.25s ease;
        }
        #settingsPanel.open { transform: translateX(0); }
        #settingsPanelHeader {
            display: flex; align-items: center; justify-content: space-between;
            padding: 14px 16px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
        }
        #settingsPanelHeader span {
            font-size: 11px; font-weight: bold; letter-spacing: 0.12em;
            text-transform: uppercase; color: #888;
        }
        #settingsCloseBtn {
            background: transparent; color: #666; font-size: 26px;
            line-height: 1; padding: 0 4px; transition: color 0.2s; cursor: pointer; border: none;
        }
        #settingsCloseBtn:hover { color: white; }
        #settingsPanelBody { overflow-y: auto; flex: 1; padding-bottom: 24px; }

        /* Activity section */
        #activitySection { padding: 14px 16px 14px; border-bottom: 1px solid #2a2a2a; }
        #activitySectionTitle {
            font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
            color: #4af; margin-bottom: 10px;
        }
        #sgActivitySelect {
            width: 100%; background: #1c1c1c; border: 1px solid #333;
            border-radius: 6px; color: white; font-size: 14px; padding: 7px 8px;
            margin-bottom: 8px; box-sizing: border-box;
        }
        #sgActivitySelect:focus { outline: none; border-color: #4af; }
        #sgActivityDescDisplay {
            font-size: 12px; color: #888; font-style: italic;
            margin-bottom: 12px; line-height: 1.5; min-height: 16px;
        }
        .sg-act-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
        .sg-act-field label {
            font-size: 10px; color: #555; letter-spacing: 0.08em; text-transform: uppercase;
        }
        .sg-act-input {
            background: #1c1c1c; border: 1px solid #333; border-radius: 6px;
            color: white; font-size: 14px; padding: 7px 9px; width: 100%; box-sizing: border-box;
        }
        .sg-act-input:focus { outline: none; border-color: #4af; }
        #sgActivityDescEdit { resize: vertical; min-height: 58px; font-family: sans-serif; }
        #activityActions { display: flex; gap: 8px; margin-top: 4px; }
        #sgNewActivityBtn {
            flex: 1; padding: 8px 6px; background: #1c2b1c; color: #28a745;
            border: 1px solid #1f4020; border-radius: 6px; font-size: 12px; font-weight: 600;
            cursor: pointer; transition: background 0.2s;
        }
        #sgNewActivityBtn:hover { background: #1f3a1f; }
        #sgDeleteActivityBtn {
            flex: 1; padding: 8px 6px; background: #2b1010; color: #dc3545;
            border: 1px solid #4a1515; border-radius: 6px; font-size: 12px; font-weight: 600;
            cursor: pointer; transition: background 0.2s;
        }
        #sgDeleteActivityBtn:hover { background: #3a1414; }
        #sgDeleteActivityBtn:disabled { opacity: 0.3; cursor: default; }

        /* Settings fields */
        .sg-group {
            font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
            color: #4af; padding: 18px 16px 6px;
        }
        .sg-row { display: flex; flex-direction: column; padding: 9px 16px; }
        .sg-top { display: flex; align-items: center; justify-content: space-between; }
        .sg-label { font-size: 14px; color: #ccc; }
        .sg-desc { font-size: 11px; color: #aaa; margin-top: 5px; line-height: 1.4; }
        .sg-desc a:link { color: #fff; }
        .sg-desc a:visited { color: #ddd; }
        .sg-left { flex: 1; padding-right: 12px; }
        .sg-right { display: flex; align-items: center; gap: 6px; }
        .sg-input {
            width: 62px; background: #1c1c1c; border: 1px solid #333;
            border-radius: 6px; color: white; font-size: 15px;
            font-family: monospace; text-align: right; padding: 5px 8px;
        }
        .sg-input:focus { outline: none; border-color: #4af; }
        .sg-unit { font-size: 11px; color: #555; width: 24px; }
        .sg-select {
            background: #1c1c1c; border: 1px solid #333; border-radius: 6px;
            color: white; font-size: 14px; padding: 5px 6px;
        }
        .sg-select:focus { outline: none; border-color: #4af; }
        input.sg-toggle {
            appearance: none; -webkit-appearance: none;
            width: 46px; height: 26px; background: #333; border-radius: 13px;
            cursor: pointer; position: relative; transition: background 0.2s;
            flex-shrink: 0; border: none; outline: none;
        }
        input.sg-toggle:checked { background: #4af; }
        input.sg-toggle::after {
            content: ''; position: absolute;
            top: 3px; left: 3px; width: 20px; height: 20px;
            border-radius: 50%; background: white; transition: left 0.2s;
        }
        input.sg-toggle:checked::after { left: 23px; }
        .sg-computed {
            font-family: monospace; font-size: 15px;
            color: #4af; padding: 5px 8px;
        }
        #settingsResetBtn {
            display: block; margin: 20px 16px 0; width: calc(100% - 32px);
            padding: 10px; background: #1a1a1a; color: #666; font-size: 13px;
            border-radius: 8px; border: 1px solid #2a2a2a; cursor: pointer;
            transition: color 0.2s, border-color 0.2s;
        }
        #settingsResetBtn:hover { color: #ccc; border-color: #555; }
    `;
    document.head.appendChild(style);

    // Hamburger button
    const btn = document.createElement('button');
    btn.id = 'settingsBtn'; btn.innerHTML = '&#9776;';
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    document.body.appendChild(overlay);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'settingsPanel';

    const header = document.createElement('div');
    header.id = 'settingsPanelHeader';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'settingsCloseBtn'; closeBtn.innerHTML = '&times;';
    header.appendChild(titleSpan); header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.id = 'settingsPanelBody';

    // Activity section
    body.innerHTML = `
        <div id="activitySection">
            <div id="activitySectionTitle">Activity Type</div>
            <select id="sgActivitySelect"></select>
            <div id="sgActivityDescDisplay"></div>
            <div class="sg-act-field">
                <label>Name</label>
                <input type="text" id="sgActivityName" class="sg-act-input" placeholder="Activity name">
            </div>
            <div class="sg-act-field">
                <label>Description</label>
                <textarea id="sgActivityDescEdit" class="sg-act-input" placeholder="Describe when to use this activity…" rows="3"></textarea>
            </div>
            <div id="activityActions">
                <button id="sgNewActivityBtn">+ New Activity</button>
                <button id="sgDeleteActivityBtn">🗑 Delete</button>
            </div>
        </div>
    `;

    // Settings fields
    for (const item of FIELDS) {
        if (item.group) {
            const g = document.createElement('div');
            g.className = 'sg-group'; g.textContent = item.group;
            g.dataset.group = item.group;
            body.appendChild(g);
        } else {
            const row = document.createElement('div');
            row.className = 'sg-row';
            if (item.key) row.dataset.key = item.key;
            const top = document.createElement('div'); top.className = 'sg-top';
            const left = document.createElement('div'); left.className = 'sg-left';
            const lbl = document.createElement('div'); lbl.className = 'sg-label'; lbl.textContent = item.label;
            const desc = document.createElement('div'); desc.className = 'sg-desc'; desc.innerHTML = item.desc;
            left.appendChild(lbl); left.appendChild(desc);
            const right = document.createElement('div'); right.className = 'sg-right';
            if (item.type === 'display') {
                const span = document.createElement('span');
                span.className = 'sg-computed'; span.id = item.id;
                right.appendChild(span);
            } else if (item.type === 'select') {
                const sel = document.createElement('select');
                sel.className = 'sg-select'; sel.id = `sg_${item.key}`;
                (item.options || []).forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.value; o.textContent = opt.label;
                    sel.appendChild(o);
                });
                right.appendChild(sel);
            } else if (item.type === 'toggle') {
                const inp = document.createElement('input');
                inp.type = 'checkbox'; inp.className = 'sg-toggle'; inp.id = `sg_${item.key}`;
                right.appendChild(inp);
            } else {
                const input = document.createElement('input');
                input.type = 'number'; input.className = 'sg-input'; input.id = `sg_${item.key}`;
                const unit = document.createElement('span'); unit.className = 'sg-unit'; unit.textContent = item.unit;
                right.appendChild(input); right.appendChild(unit);
            }
            top.appendChild(left); top.appendChild(right);
            row.appendChild(top); body.appendChild(row);
        }
    }

    const resetBtn = document.createElement('button');
    resetBtn.id = 'settingsResetBtn'; resetBtn.textContent = 'Reset to defaults';
    body.appendChild(resetBtn);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // ── Activity UI wiring ────────────────────────────────────────────────────
    const activitySelect    = document.getElementById('sgActivitySelect');
    const activityDescDisp  = document.getElementById('sgActivityDescDisplay');
    const activityNameInp   = document.getElementById('sgActivityName');
    const activityDescEdit  = document.getElementById('sgActivityDescEdit');
    const newActivityBtn    = document.getElementById('sgNewActivityBtn');
    const deleteActivityBtn = document.getElementById('sgDeleteActivityBtn');

    function rebuildActivityDropdown() {
        activitySelect.innerHTML = activities.map(a =>
            `<option value="${escHtml(a.id)}">${escHtml(a.name)}</option>`
        ).join('');
        activitySelect.value = selectedActivityId;
        deleteActivityBtn.disabled = activities.length <= 1;
    }

    function updatePanelForActivity(act) {
        const isRB  = act.id === RESONANCE_BREATHING_ID;
        const isHRV = act.id === HRV_READING_ID_S;
        // Lock/unlock the name field
        activityNameInp.disabled = isRB || isHRV;
        activityNameInp.style.opacity = (isRB || isHRV) ? '0.4' : '';
        // Show/hide delete button (built-ins cannot be deleted)
        deleteActivityBtn.style.display = (isRB || isHRV) ? 'none' : '';
        // Show/hide new button
        newActivityBtn.style.display = (isRB || isHRV) ? 'none' : '';
        // Toggle individual field rows (those with a data-key attribute)
        document.querySelectorAll('.sg-row[data-key]').forEach(row => {
            const key = row.dataset.key;
            if (isRB)       { row.style.display = RESONANCE_HIDDEN_KEYS.has(key)  ? 'none' : ''; }
            else if (isHRV) { row.style.display = HRV_SHOWN_KEYS.has(key)         ? ''     : 'none'; }
            else            { row.style.display = DEFAULT_HIDDEN_KEYS.has(key)     ? 'none' : ''; }
        });
        // Hide display rows (no data-key, e.g. breathing rate) for non-RFB activity types
        document.querySelectorAll('.sg-row:not([data-key])').forEach(row => {
            row.style.display = (isRB && !isHRV) ? '' : 'none';
        });
        // Toggle group headers
        document.querySelectorAll('.sg-group[data-group]').forEach(g => {
            const grp = g.dataset.group;
            if (isRB)       { g.style.display = RESONANCE_HIDDEN_GROUPS.has(grp)  ? 'none' : ''; }
            else if (isHRV) { g.style.display = HRV_SHOWN_GROUPS.has(grp)         ? ''     : 'none'; }
            else            { g.style.display = DEFAULT_HIDDEN_GROUPS.has(grp)     ? 'none' : ''; }
        });
        // Reset-to-defaults button label
        document.getElementById('settingsResetBtn').textContent = 'Reset to defaults';
    }

    function updateRfbRateDisplay() {
        const el = document.getElementById('rfbRateDisplay');
        if (!el) return;
        const inhaleEl = document.getElementById('sg_RFB_INHALE_SEC');
        const exhaleEl = document.getElementById('sg_RFB_EXHALE_SEC');
        const i = inhaleEl ? parseFloat(inhaleEl.value) || 5 : 5;
        const e = exhaleEl ? parseFloat(exhaleEl.value) || 5 : 5;
        el.textContent = (60 / (i + e)).toFixed(2) + ' bpm';
    }

    function loadActivityIntoPanel(act) {
        activityNameInp.value  = act.name;
        activityDescEdit.value = act.description || '';
        activityDescDisp.textContent = act.description || '';
        for (const item of FIELDS) {
            if (!item.key) continue;
            const el = document.getElementById(`sg_${item.key}`);
            if (!el) continue;
            const val = (act.settings && item.key in act.settings)
                ? act.settings[item.key] : DEFAULTS[item.key];
            if (el.type === 'checkbox') { el.checked = !!Number(val); }
            else { el.value = String(val); }
        }
        updateRfbRateDisplay();
        updatePanelForActivity(act);
    }

    function applyGlobalsIfNeeded() {
        const sessionRunning = (typeof isSessionRunning !== 'undefined') && isSessionRunning;
        const sameActivity   = (typeof currentActivityId !== 'undefined') && currentActivityId === selectedActivityId;
        if (!sessionRunning || sameActivity) {
            loadActivitySettingsIntoGlobals(getSelectedActivity());
            if (typeof updateSpeedometer === 'function' && typeof latestHR !== 'undefined') {
                updateSpeedometer(latestHR);
            }
        }
    }

    activitySelect.addEventListener('change', () => {
        selectedActivityId = activitySelect.value;
        persistSelectedActivity();
        loadActivityIntoPanel(getSelectedActivity());
        applyGlobalsIfNeeded();
    });

    activityNameInp.addEventListener('change', () => {
        const act = getSelectedActivity();
        if (act.id === RESONANCE_BREATHING_ID || act.id === HRV_READING_ID_S) return; // name is locked
        const trimmed = activityNameInp.value.trim();
        if (trimmed) { act.name = trimmed; persistActivities(); rebuildActivityDropdown(); }
    });

    activityDescEdit.addEventListener('input', () => {
        const act = getSelectedActivity();
        act.description = activityDescEdit.value;
        activityDescDisp.textContent = act.description;
        persistActivities();
    });

    newActivityBtn.addEventListener('click', () => {
        const newAct = { id: generateId(), name: 'New Activity', description: '', settings: { ...DEFAULTS } };
        activities.push(newAct);
        persistActivities();
        selectedActivityId = newAct.id;
        persistSelectedActivity();
        rebuildActivityDropdown();
        loadActivityIntoPanel(newAct);
        activityNameInp.focus(); activityNameInp.select();
    });

    deleteActivityBtn.addEventListener('click', () => {
        if (activities.length <= 1) { alert('You need at least one activity type.'); return; }
        const act = getSelectedActivity();
        if (act.id === RESONANCE_BREATHING_ID) { alert('Resonance Breathing cannot be deleted.'); return; }
        if (act.id === HRV_READING_ID_S)       { alert('HRV Reading cannot be deleted.'); return; }
        if (!confirm(`Delete activity "${act.name}"? This cannot be undone.`)) return;
        activities = activities.filter(a => a.id !== selectedActivityId);
        persistActivities();
        selectedActivityId = activities[0].id;
        persistSelectedActivity();
        rebuildActivityDropdown();
        loadActivityIntoPanel(getSelectedActivity());
        applyGlobalsIfNeeded();
    });

    for (const item of FIELDS) {
        if (!item.key) continue;
        const el = document.getElementById(`sg_${item.key}`);
        if (!el) continue;
        el.addEventListener('change', () => {
            let v;
            if (el.type === 'checkbox') { v = el.checked ? 1 : 0; }
            else { v = Number(el.value); if (isNaN(v)) return; }
            const act = getSelectedActivity();
            if (!act.settings) act.settings = {};
            // Resonance Breathing always has RFB_ENABLED = 1
            if (act.id === RESONANCE_BREATHING_ID && item.key === 'RFB_ENABLED') { v = 1; }
            act.settings[item.key] = v;
            persistActivities();
            const sessionRunning = (typeof isSessionRunning !== 'undefined') && isSessionRunning;
            const sameActivity   = (typeof currentActivityId !== 'undefined') && currentActivityId === selectedActivityId;
            if (!sessionRunning || sameActivity) {
                window[item.key] = v;
                if (typeof updateSpeedometer === 'function' && typeof latestHR !== 'undefined') {
                    updateSpeedometer(latestHR);
                }
            }
            if (item.key === 'RFB_INHALE_SEC' || item.key === 'RFB_EXHALE_SEC') updateRfbRateDisplay();
        });
    }

    resetBtn.addEventListener('click', () => {
        const act = getSelectedActivity();
        act.settings = act.id === RESONANCE_BREATHING_ID ? { ...RB_DEFAULTS }
                     : act.id === HRV_READING_ID_S       ? { ...DEFAULTS, ...HRV_DEFAULTS }
                     : { ...DEFAULTS };
        persistActivities();
        loadActivityIntoPanel(act);
        applyGlobalsIfNeeded();
    });

    function openPanel() {
        // If a session is running, show that session's activity in the panel
        const sessionRunning = (typeof isSessionRunning !== 'undefined') && isSessionRunning;
        const sessionActId   = (typeof currentActivityId !== 'undefined') && currentActivityId;
        if (sessionRunning && sessionActId && activities.find(a => a.id === sessionActId)) {
            selectedActivityId = sessionActId;
            persistSelectedActivity();
        }
        rebuildActivityDropdown();
        loadActivityIntoPanel(getSelectedActivity());
        panel.classList.add('open'); overlay.classList.add('open');
    }
    function closePanel() {
        panel.classList.remove('open'); overlay.classList.remove('open');
    }

    btn.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    rebuildActivityDropdown();
    loadActivityIntoPanel(getSelectedActivity());
});

})();
