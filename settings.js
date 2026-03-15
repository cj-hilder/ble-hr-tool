// settings.js — must be loaded before app.js
// Declares all setting constants as globals (window.*), loads from
// localStorage, and injects a hamburger button + slide-in panel.

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
    MAX_RECOVERY_PERIOD:    240,
    MAX_RESPONSE_LAG:       60,
    NUM_RESETS_B4_WARN:     3,
};

const FIELDS = [
    { group: 'Heart Rate Range' },
    { key: 'MAX_HR', label: 'Max HR', unit: 'bpm',
      desc: 'Your personal maximum heart rate. Used to scale the speedometer and the HR history graph. Calculate it with <a href="https://www.targetheartratecalculator.org/">this tool</a>.' },
    { key: 'BRADYCARDIA_THRESHOLD', label: 'Bradycardia threshold', unit: 'bpm',
      desc: 'If HR drops below this it triggers a heart rate reset (stop activity and wait for a return to resting heart rate). Detects an unusually low heart rate that may indicate overexertion or heart rate recovery undershoot.' },
    { group: 'Resting HR' },
    { key: 'RESTING_HR', label: 'Resting HR', unit: 'bpm',
      desc: 'Your typical resting heart rate. Used as the target to return to during a heart rate.' },
    { key: 'RESTING_HR_BANDWIDTH', label: 'Bandwidth', unit: 'bpm',
      desc: 'Width of the acceptable resting HR window. HR must stay within this band for 15 consecutive seconds before a HR reset is considered complete.' },
    { group: 'Target Zone' },
    { key: 'TARGET_MIN_HR', label: 'Target min', unit: 'bpm',
      desc: 'Lower edge of the active target zone, shown as an arc on the speedometer.' },
    { key: 'TARGET_MAX_HR', label: 'Target max', unit: 'bpm',
      desc: 'Upper edge of the active target zone, shown as an arc on the speedometer.' },
    { group: 'Active Thresholds' },
    { key: 'ACTIVE_THRESHOLD_UPPER', label: 'Upper threshold', unit: 'bpm',
      desc: 'If HR exceeds this during activity it will trigger "Rest or pull back". If you are unsure how to determine this, the safe choice is resting HR + 15.' },
    { key: 'ACTIVE_THRESHOLD_LOWER', label: 'Lower threshold', unit: 'bpm',
      desc: 'HR must fall below this to transition back to "Continue activity". Usually set just below the upper threshold.' },
    { group: 'Recovery Timers' },
    { key: 'MAX_RECOVERY_PERIOD', label: 'Max recovery period', unit: 's',
      desc: 'Maximum time allowed in the "Rest or pull back" state before a forced HR reset is triggered. Prevents indefinite rest periods that mask incomplete HR recovery.' },
    { key: 'MAX_RESPONSE_LAG', label: 'Max response lag', unit: 's',
      desc: 'If HR has not started falling within this many seconds of "Rest or pull back", a HR reset is forced. This detects a slow HR response to stopping activity.' },
    { group: 'Session' },
    { key: 'NUM_RESETS_B4_WARN', label: 'Resets before warning', unit: '',
      desc: 'Number of HR resets allowed before the app shows a prominent warning to end the session. Reaching this count suggests the autonomic system is struggling to recover.' },
];

const STORAGE_KEY = 'hrPacerSettings';

// --- Load persisted values, exposing each as a global ---
function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch (e) {}
    for (const [key, def] of Object.entries(DEFAULTS)) {
        window[key] = (key in saved) ? Number(saved[key]) : def;
    }
}

function save() {
    const data = {};
    for (const key of Object.keys(DEFAULTS)) data[key] = window[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Redraw speedometer in case thresholds or MAX_HR changed
    if (typeof updateSpeedometer === 'function' && typeof latestHR !== 'undefined') {
        updateSpeedometer(latestHR);
    }
}

load();

// --- Inject UI after DOM is ready ---
document.addEventListener('DOMContentLoaded', () => {

    // Styles
    const style = document.createElement('style');
    style.textContent = `
        #settingsBtn {
            position: fixed;
            top: 10px; right: 12px;
            z-index: 200;
            background: transparent;
            color: #888;
            font-size: 26px;
            padding: 2px 8px;
            border-radius: 6px;
            line-height: 1;
            transition: color 0.2s;
        }
        #settingsBtn:hover { color: white; }

        #settingsOverlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 299;
        }
        #settingsOverlay.open { display: block; }

        #settingsPanel {
            position: fixed;
            top: 0; right: 0;
            width: min(300px, 88vw);
            height: 100vh;
            background: #111;
            border-left: 1px solid #2a2a2a;
            z-index: 300;
            display: flex;
            flex-direction: column;
            transform: translateX(100%);
            transition: transform 0.25s ease;
        }
        #settingsPanel.open { transform: translateX(0); }

        #settingsPanelHeader {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            border-bottom: 1px solid #2a2a2a;
            flex-shrink: 0;
        }
        #settingsPanelHeader span {
            font-size: 11px;
            font-weight: bold;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #888;
        }
        #settingsCloseBtn {
            background: transparent;
            color: #666;
            font-size: 26px;
            line-height: 1;
            padding: 0 4px;
            transition: color 0.2s;
        }
        #settingsCloseBtn:hover { color: white; }

        #settingsPanelBody {
            overflow-y: auto;
            flex: 1;
            padding-bottom: 24px;
        }

        .sg-group {
            font-size: 10px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #4af;
            padding: 18px 16px 6px;
        }
        .sg-row {
            display: flex;
            flex-direction: column;
            padding: 9px 16px;
        }
        .sg-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .sg-label {
            font-size: 14px;
            color: #ccc;
        }
        .sg-desc {
            font-size: 11px;
            color: #888;
            margin-top: 5px;
            line-height: 1.4;
        }
        .sg-left {
            flex: 1;
            padding-right: 12px;
        }
        .sg-right {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sg-input {
            width: 62px;
            background: #1c1c1c;
            border: 1px solid #333;
            border-radius: 6px;
            color: white;
            font-size: 15px;
            font-family: monospace;
            text-align: right;
            padding: 5px 8px;
        }
        .sg-input:focus { outline: none; border-color: #4af; }
        .sg-unit {
            font-size: 11px;
            color: #555;
            width: 24px;
        }
        #settingsResetBtn {
            display: block;
            margin: 20px 16px 0;
            width: calc(100% - 32px);
            padding: 10px;
            background: #1a1a1a;
            color: #666;
            font-size: 13px;
            border-radius: 8px;
            border: 1px solid #2a2a2a;
            transition: color 0.2s, border-color 0.2s;
        }
        #settingsResetBtn:hover { color: #ccc; border-color: #555; }
    `;
    document.head.appendChild(style);

    // Hamburger button
    const btn = document.createElement('button');
    btn.id = 'settingsBtn';
    btn.innerHTML = '&#9776;';
    document.body.appendChild(btn);

    // Backdrop
    const overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    document.body.appendChild(overlay);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'settingsPanel';

    const header = document.createElement('div');
    header.id = 'settingsPanelHeader';
    const title = document.createElement('span');
    title.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'settingsCloseBtn';
    closeBtn.innerHTML = '&times;';
    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.id = 'settingsPanelBody';

    for (const item of FIELDS) {
        if (item.group) {
            const g = document.createElement('div');
            g.className = 'sg-group';
            g.textContent = item.group;
            body.appendChild(g);
        } else {
            const row = document.createElement('div');
            row.className = 'sg-row';

            const top = document.createElement('div');
            top.className = 'sg-top';

            const lbl = document.createElement('div');
            lbl.className = 'sg-label';
            lbl.textContent = item.label;

            const right = document.createElement('div');
            right.className = 'sg-right';

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'sg-input';
            input.id = `sg_${item.key}`;
            input.value = window[item.key];

            const unit = document.createElement('span');
            unit.className = 'sg-unit';
            unit.textContent = item.unit;

            right.appendChild(input);
            right.appendChild(unit);
            top.appendChild(lbl);
            top.appendChild(right);

            const desc = document.createElement('div');
            desc.className = 'sg-desc';
            desc.innerHTML = item.desc;
            row.appendChild(top);
            row.appendChild(desc);
            body.appendChild(row);

            input.addEventListener('change', () => {
                const v = Number(input.value);
                if (!isNaN(v)) { window[item.key] = v; save(); }
            });
        }
    }

    const resetBtn = document.createElement('button');
    resetBtn.id = 'settingsResetBtn';
    resetBtn.textContent = 'Reset to defaults';
    body.appendChild(resetBtn);

    panel.appendChild(body);
    document.body.appendChild(panel);

    // Open/close
    function openPanel() {
        for (const item of FIELDS) {
            if (item.key) document.getElementById(`sg_${item.key}`).value = window[item.key];
        }
        panel.classList.add('open');
        overlay.classList.add('open');
    }
    function closePanel() {
        panel.classList.remove('open');
        overlay.classList.remove('open');
    }

    btn.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    resetBtn.addEventListener('click', () => {
        for (const [key, def] of Object.entries(DEFAULTS)) window[key] = def;
        localStorage.removeItem(STORAGE_KEY);
        for (const item of FIELDS) {
            if (item.key) document.getElementById(`sg_${item.key}`).value = window[item.key];
        }
        save();
    });
});

})();
