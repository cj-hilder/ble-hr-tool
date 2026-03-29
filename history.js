// history.js

const HISTORY_KEY    = 'hrPacerHistory';
const ACTIVITIES_KEY = 'hrPacerActivities';
const SETTINGS_KEY   = 'hrPacerSettings';
const SESSION_KEY    = 'hrPacerSession';
const SELECTED_ACTIVITY_KEY = 'hrPacerSelectedActivity';
const EXPORT_VERSION = 1;

// All localStorage keys we own — used for export/import
const LAST_ACTIVITY_KEY = 'hrPacerLastActivity';

const ALL_STORAGE_KEYS = [
    HISTORY_KEY,
    ACTIVITIES_KEY,
    SETTINGS_KEY,
    SESSION_KEY,
    SELECTED_ACTIVITY_KEY,
    LAST_ACTIVITY_KEY,
];

let allHistory   = [];
let activeCharts = [];
let activeFilters = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(s) {
    s = Math.max(0, Math.round(s));
    if (s >= 3600) {
        return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
               String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' +
               String(s % 60).padStart(2, '0');
    }
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function fmtT(s) { return s > 0 ? formatTime(s) : '--'; }
function fmtN(n) { return n > 0 ? n : '--'; }
function shortLabel(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}
function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toastMsg');
    el.textContent = msg;
    el.className = 'visible' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Error modal ──────────────────────────────────────────────────────────────
function showErrorModal(title, message) {
    document.getElementById('errorModalTitle').textContent = title;
    document.getElementById('errorModalMsg').textContent  = message;
    document.getElementById('errorModal').classList.add('visible');
}

// ── Three-dots menu ───────────────────────────────────────────────────────────
function initMenu() {
    const menuBtn      = document.getElementById('menuBtn');
    const menuDropdown = document.getElementById('menuDropdown');

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        menuDropdown.classList.remove('open');
    });

    document.getElementById('menuExport').addEventListener('click', () => {
        menuDropdown.classList.remove('open');
        doExport();
    });

    document.getElementById('menuImport').addEventListener('click', () => {
        menuDropdown.classList.remove('open');
        document.getElementById('importFileInput').click();
    });

    document.getElementById('errorModalOk').addEventListener('click', () => {
        document.getElementById('errorModal').classList.remove('visible');
    });

    document.getElementById('importFileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) doImport(file);
        e.target.value = ''; // reset so same file can be re-selected
    });
}

// ── Export ────────────────────────────────────────────────────────────────────
function doExport() {
    // Collect all app localStorage keys into one object
    const data = { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), store: {} };
    for (const key of ALL_STORAGE_KEYS) {
        const val = localStorage.getItem(key);
        if (val !== null) data.store[key] = val; // store raw JSON strings
    }

    // Unpack hrRecording in each session so the export is readable by other
    // software — replace packed {fmt:'p1', b64, len} objects with plain
    // [{t, hr, state}] arrays. Works on a deep copy; localStorage is unchanged.
    if (data.store[HISTORY_KEY]) {
        try {
            const sessions = JSON.parse(data.store[HISTORY_KEY]);
            const unpacked = sessions.map(s => {
                if (!hasHrRecording(s)) return s;
                return { ...s, hrRecording: unpackHrRecording(s.hrRecording) };
            });
            data.store[HISTORY_KEY] = JSON.stringify(unpacked);
        } catch (e) {
            console.warn('doExport: could not unpack hrRecording data', e);
        }
    }

    const json    = JSON.stringify(data, null, 2);
    const blob    = new Blob([json], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const anchor  = document.createElement('a');
    anchor.href     = url;
    anchor.download = `hr-pacer-backup-${dateStr}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    showToast('Export saved', 'success');
}

// ── Import ────────────────────────────────────────────────────────────────────
function doImport(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        let data;
        try {
            data = JSON.parse(e.target.result);
        } catch {
            showErrorModal('Invalid file', 'The selected file is not valid JSON.');
            return;
        }

        // Validate structure
        const validationError = validateImportData(data);
        if (validationError) {
            showErrorModal('Import failed', validationError);
            return;
        }

        // Count sessions for confirmation message
        let sessionCount = 0;
        try {
            const raw = data.store[HISTORY_KEY];
            if (raw) sessionCount = JSON.parse(raw).length;
        } catch { /* leave at 0 */ }

        const activityCount = (() => {
            try { const raw = data.store[ACTIVITIES_KEY]; return raw ? JSON.parse(raw).length : 0; }
            catch { return 0; }
        })();

        const msg = `Replace all local data with this backup?\n\n` +
                    `• ${sessionCount} session${sessionCount !== 1 ? 's' : ''}\n` +
                    `• ${activityCount} activity type${activityCount !== 1 ? 's' : ''}\n` +
                    `• Exported: ${new Date(data.exportedAt).toLocaleString()}\n\n` +
                    `This will overwrite your current data and cannot be undone.`;

        if (!confirm(msg)) return;

        // Clear existing app keys then write imported values
        for (const key of ALL_STORAGE_KEYS) localStorage.removeItem(key);
        for (const [key, val] of Object.entries(data.store)) {
            if (ALL_STORAGE_KEYS.includes(key)) localStorage.setItem(key, val);
        }

        showToast(`Imported ${sessionCount} session${sessionCount !== 1 ? 's' : ''}`, 'success');
        renderPage();
    };
    reader.onerror = () => showErrorModal('File error', 'Failed to read the selected file.');
    reader.readAsText(file);
}

function validateImportData(data) {
    if (!data || typeof data !== 'object')           return 'file is not a JSON object';
    if (data.version !== EXPORT_VERSION)             return `unexpected version (got ${data.version}, expected ${EXPORT_VERSION})`;
    if (!data.exportedAt || !data.store)             return 'missing required fields (exportedAt, store)';
    if (typeof data.store !== 'object')              return 'store field is not an object';

    // Validate stored values. SELECTED_ACTIVITY_KEY is a plain string (not JSON),
    // so exclude it from the JSON parse check.
    const PLAIN_STRING_KEYS = [SELECTED_ACTIVITY_KEY, LAST_ACTIVITY_KEY];
    const JSON_KEYS = ALL_STORAGE_KEYS.filter(k => !PLAIN_STRING_KEYS.includes(k));
    for (const [key, val] of Object.entries(data.store)) {
        if (!ALL_STORAGE_KEYS.includes(key)) return `unexpected key "${key}" in store`;
        if (typeof val !== 'string')          return `store["${key}"] must be a string`;
        if (JSON_KEYS.includes(key)) {
            try { JSON.parse(val); } catch { return `store["${key}"] is not valid JSON`; }
        }
    }

    // Validate history entries have expected shape
    if (data.store[HISTORY_KEY]) {
        let history;
        try { history = JSON.parse(data.store[HISTORY_KEY]); } catch { return 'history data is corrupt'; }
        if (!Array.isArray(history)) return 'history must be an array';
        for (const s of history) {
            if (typeof s !== 'object' || !s.date || typeof s.sessionLengthSec === 'undefined') {
                return 'one or more history entries are missing required fields';
            }
        }
    }

    // Validate activities have expected shape
    if (data.store[ACTIVITIES_KEY]) {
        let acts;
        try { acts = JSON.parse(data.store[ACTIVITIES_KEY]); } catch { return 'activities data is corrupt'; }
        if (!Array.isArray(acts)) return 'activities must be an array';
        for (const a of acts) {
            if (typeof a !== 'object' || !a.id || !a.name) {
                return 'one or more activity entries are missing required fields';
            }
        }
    }

    return null; // valid
}

// ── Charts ────────────────────────────────────────────────────────────────────
function buildChartConfig(labels, data, color, unit) {
    return {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data, borderColor: color, backgroundColor: color + '22', borderWidth: 2,
                pointRadius: data.length <= 15 ? 3 : 1, pointBackgroundColor: color,
                tension: 0.3, fill: true,
            }],
        },
        options: {
            responsive: true, animation: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.parsed.y}${unit}` } },
            },
            scales: {
                x: { ticks: { color: '#555', font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: '#1f1f1f' } },
                y: { ticks: { color: '#555', font: { size: 10 }, maxTicksLimit: 5 }, grid: { color: '#1f1f1f' }, beginAtZero: true },
            },
        },
    };
}

function renderCharts(history) {
    activeCharts.forEach(c => c.destroy());
    activeCharts = [];
    if (history.length === 0) return;
    const labels      = history.map(s => shortLabel(s.date));
    const pctActive   = history.map(s => s.pctActive || 0);
    const avgLag      = history.map(s => s.avgLagSec || 0);
    const avgPeakHr   = history.map(s => s.avgPeakHr || 0);
    const sessionMins = history.map(s => s.sessionLengthSec ? Math.round(s.sessionLengthSec / 60) : 0);
    activeCharts.push(new Chart(document.getElementById('chartPctActive'),  buildChartConfig(labels, pctActive,   '#28a745', '%')));
    activeCharts.push(new Chart(document.getElementById('chartAvgLag'),     buildChartConfig(labels, avgLag,      '#17a2b8', 's')));
    activeCharts.push(new Chart(document.getElementById('chartAvgPeak'),    buildChartConfig(labels, avgPeakHr,   '#fd7e14', ' bpm')));
    activeCharts.push(new Chart(document.getElementById('chartSessionLen'), buildChartConfig(labels, sessionMins, '#6c757d', ' min')));
}

// ── Notes editing ─────────────────────────────────────────────────────────────
function openNotesEditor(realIndex) {
    const container = document.getElementById(`notes-container-${realIndex}`);
    if (!container) return;
    const current = allHistory[realIndex] ? (allHistory[realIndex].notes || '') : '';
    container.innerHTML = `
        <div class="notes-editor">
            <textarea class="notes-edit-area" data-index="${realIndex}" rows="3">${escHtml(current)}</textarea>
            <div class="notes-save-row">
                <button class="notes-save-btn" data-action="save-notes" data-index="${realIndex}">Save</button>
                <button class="notes-cancel-btn" data-action="cancel-notes" data-index="${realIndex}">Cancel</button>
            </div>
        </div>`;
    const ta = container.querySelector('textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function saveNotesForIndex(realIndex) {
    const container = document.getElementById(`notes-container-${realIndex}`);
    if (!container) return;
    const ta = container.querySelector('textarea');
    if (!ta) return;
    const newNotes = ta.value.trim();
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const history = raw ? JSON.parse(raw) : [];
        if (history[realIndex] !== undefined) {
            history[realIndex].notes = newNotes;
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
            allHistory = history;
        }
    } catch (err) { showToast('Failed to save notes', 'error'); return; }
    renderNotesDisplay(realIndex);
}

function cancelNotesForIndex(realIndex) {
    renderNotesDisplay(realIndex);
}

function renderNotesDisplay(realIndex) {
    const container = document.getElementById(`notes-container-${realIndex}`);
    if (!container) return;
    const notes = allHistory[realIndex] ? (allHistory[realIndex].notes || '') : '';
    container.innerHTML = `
        <div class="notes-row">
            <div class="notes-text${notes ? '' : ' empty'}">${notes ? escHtml(notes) : 'No notes'}</div>
            <button class="notes-edit-btn" data-action="edit-notes" data-index="${realIndex}" title="Edit notes">✏️</button>
        </div>`;
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.addEventListener('click', function (e) {
    const action = e.target.getAttribute('data-action');
    const idx    = parseInt(e.target.getAttribute('data-index'), 10);
    if (!action) return;

    if (action === 'edit-notes' && !isNaN(idx)) {
        openNotesEditor(idx);
    } else if (action === 'save-notes' && !isNaN(idx)) {
        saveNotesForIndex(idx);
    } else if (action === 'cancel-notes' && !isNaN(idx)) {
        cancelNotesForIndex(idx);
    } else if (action === 'delete-session' && !isNaN(idx)) {
        e.stopPropagation();
        if (!confirm('Delete this session? This cannot be undone.')) return;
        try {
            allHistory.splice(idx, 1);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(allHistory));
            renderPage();
        } catch (err) { showToast('Failed to delete session', 'error'); }
    } else if (action === 'toggle-card' && !isNaN(idx)) {
        document.getElementById(`card-${idx}`).classList.toggle('open');
    } else if (action === 'view-graph' && !isNaN(idx)) {
        e.stopPropagation();
        generateSessionPDF(allHistory[idx]);
    }
});

// ── Card builder ──────────────────────────────────────────────────────────────
function statItem(value, label) {
    return `<div class="stat-item"><span>${escHtml(String(value))}</span><label>${escHtml(label)}</label></div>`;
}

function buildSessionCard(s, realIndex) {
    const resets      = s.numRecoveryPeriods || 0;
    const durationMin = s.sessionLengthSec ? Math.round(s.sessionLengthSec / 60) : '--';
    const actName     = s.activityName || '';
    const notes       = s.notes || '';

    const notesHtml = `
        <div class="notes-row">
            <div class="notes-text${notes ? '' : ' empty'}">${notes ? escHtml(notes) : 'No notes'}</div>
            <button class="notes-edit-btn" data-action="edit-notes" data-index="${realIndex}" title="Edit notes">✏️</button>
        </div>`;

    let settingsHtml = '';
    if (s.activitySettings && Object.keys(s.activitySettings).length > 0) {
        const ss = s.activitySettings;
        const lines = [
            `Max HR: ${ss.MAX_HR || '--'} · Resting HR: ${ss.RESTING_HR || '--'} ±${ss.RESTING_HR_BANDWIDTH || '--'}`,
            `Active: ${ss.ACTIVE_THRESHOLD_LOWER || '--'}–${ss.ACTIVE_THRESHOLD_UPPER || '--'} bpm · Brady: ${ss.BRADYCARDIA_THRESHOLD || '--'}`,
            `Max recovery: ${ss.MAX_RECOVERY_PERIOD || '--'}s · Max lag: ${ss.MAX_RESPONSE_LAG || '--'}s`,
        ];
        settingsHtml = `<div class="stat-group">
            <div class="stat-group-label settings-label">⚙️ Session Settings</div>
            <div class="settings-summary">${lines.map(l => escHtml(l)).join('<br>')}</div>
        </div>`;
    }

    return `
    <div class="session-card" id="card-${realIndex}">
        <div class="session-card-header" data-action="toggle-card" data-index="${realIndex}">
            <div class="session-header-left" style="pointer-events:none">
                <div class="session-date">${fmtDate(s.date)} · ${fmtTime(s.date)}</div>
                <div class="session-chips">
                    ${actName ? `<span class="chip chip-activity">${escHtml(actName)}</span>` : ''}
                    <span class="chip chip-duration">${durationMin} min</span>
                    <span class="chip chip-active">${s.pctActive || '--'}% active</span>
                    ${resets > 0 ? `<span class="chip chip-resets">${resets} recovery periods</span>` : ''}
                </div>
            </div>
            <span class="session-chevron" style="pointer-events:none">›</span>
        </div>
        <div class="session-detail">
            <div id="notes-container-${realIndex}">${notesHtml}</div>

            <div class="stat-group">
                <div class="stat-group-label active-label">🟢 Active Periods</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.totalActiveSec), 'Total')}
                    ${statItem((s.pctActive || '--') + (s.pctActive ? '%' : ''), '% session')}
                    ${statItem(fmtN(s.numActivePeriods), 'Count')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestActiveSec), 'Longest')}
                    ${statItem(fmtT(s.avgActiveSec), 'Average')}
                    ${statItem(fmtT(s.shortestActiveSec), 'Shortest')}
                </div>
                <div class="stat-row">${statItem(fmtN(s.avgHrActive), 'Avg HR')}<div></div><div></div></div>
            </div>

            <div class="stat-group">
                <div class="stat-group-label recovery-label">🟠 Recovery Periods</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.totalRecoverySec), 'Total')}
                    ${statItem((s.pctRecovery || '--') + (s.pctRecovery ? '%' : ''), '% session')}
                    ${statItem(fmtN(s.numRecoveryPeriods), 'Count')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestRecoverySec), 'Longest')}
                    ${statItem(fmtT(s.avgRecoverySec), 'Average')}
                    ${statItem(fmtT(s.shortestRecoverySec), 'Shortest')}
                </div>
                <div class="stat-row">${statItem(fmtN(s.avgHrRecovery), 'Avg HR')}<div></div><div></div></div>
            </div>

            <div class="stat-group">
                <div class="stat-group-label lag-label">📈 Lag & Peak HR</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestLagSec), 'Longest lag')}
                    ${statItem(fmtT(s.avgLagSec), 'Avg lag')}
                    ${statItem(fmtT(s.shortestLagSec), 'Shortest lag')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtN(s.highestPeakHr), 'Highest peak')}
                    ${statItem(fmtN(s.avgPeakHr), 'Avg peak')}
                    ${statItem(fmtN(s.lowestPeakHr), 'Lowest peak')}
                </div>
            </div>

            <div class="stat-group">
                <div class="stat-group-label session-label">📊 Session</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.sessionLengthSec), 'Duration')}
                    ${statItem(fmtN(s.highestHr), 'Highest HR')}
                    ${statItem(fmtN(s.avgHr), 'Avg HR')}
                </div>
                <div class="stat-row">${statItem(fmtN(s.lowestHr), 'Lowest HR')}<div></div><div></div></div>
            </div>

            ${settingsHtml}

            ${hasHrRecording(s)
                ? `<button class="session-graph-btn" data-action="view-graph" data-index="${realIndex}">📈 View Session Graph (PDF)</button>`
                : ''}
            <button class="session-delete-btn" data-action="delete-session" data-index="${realIndex}">Delete this session</button>
        </div>
    </div>`;
}

// ── Filter chips ──────────────────────────────────────────────────────────────
function getActivityNames(history) {
    const names = new Set();
    history.forEach(s => { if (s.activityName) names.add(s.activityName); });
    return [...names].sort();
}

function renderFilterChips(actNames) {
    const filterBar = document.getElementById('filterBar');
    const chipsEl   = document.getElementById('filterChips');

    if (actNames.length === 0) { filterBar.style.display = 'none'; return; }
    filterBar.style.display = 'block';

    // Drop stale filters
    const nameSet = new Set(actNames);
    for (const n of [...activeFilters]) { if (!nameSet.has(n)) activeFilters.delete(n); }

    const allActive = activeFilters.size === 0;
    chipsEl.innerHTML =
        `<span class="filter-chip filter-chip-all${allActive ? ' active' : ''}" data-filter-all="1">All</span>` +
        actNames.map(n =>
            `<span class="filter-chip${activeFilters.has(n) ? ' active' : ''}" data-filter-name="${escHtml(n)}">${escHtml(n)}</span>`
        ).join('');

    chipsEl.querySelectorAll('.filter-chip-all').forEach(el =>
        el.addEventListener('click', () => { activeFilters.clear(); applyFilter(); })
    );
    chipsEl.querySelectorAll('.filter-chip[data-filter-name]').forEach(el =>
        el.addEventListener('click', () => {
            const name = el.getAttribute('data-filter-name');
            if (activeFilters.has(name)) activeFilters.delete(name);
            else activeFilters.add(name);
            applyFilter();
        })
    );
}

// ── Render ────────────────────────────────────────────────────────────────────
function applyFilter() {
    const actNames = getActivityNames(allHistory);
    renderFilterChips(actNames);

    const filtered = activeFilters.size > 0
        ? allHistory.map((s, i) => ({ s, i })).filter(({ s }) => activeFilters.has(s.activityName))
        : allHistory.map((s, i) => ({ s, i }));

    document.getElementById('sessionCount').innerText =
        filtered.length !== allHistory.length
            ? `${filtered.length} of ${allHistory.length} session${allHistory.length !== 1 ? 's' : ''}`
            : `${allHistory.length} session${allHistory.length !== 1 ? 's' : ''}`;

    renderCharts(filtered.map(({ s }) => s));

    const noResults = document.getElementById('noResults');
    const list      = document.getElementById('sessionsList');
    if (filtered.length === 0) {
        noResults.style.display = 'block';
        list.innerHTML = '';
    } else {
        noResults.style.display = 'none';
        list.innerHTML = [...filtered].reverse().map(({ s, i }) => buildSessionCard(s, i)).join('');
    }
}

function renderPage() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        allHistory = raw ? JSON.parse(raw) : [];
    } catch (e) { allHistory = []; }

    const empty  = document.getElementById('emptyState');
    const charts = document.getElementById('chartsSection');

    if (allHistory.length === 0) {
        empty.style.display  = 'block';
        charts.style.display = 'none';
        document.getElementById('filterBar').style.display = 'none';
        document.getElementById('sessionCount').innerText  = '';
        return;
    }

    empty.style.display  = 'none';
    charts.style.display = 'block';
    applyFilter();
}

// ── HR Recording helpers ──────────────────────────────────────────────────────
// Inverse of packHrRecording in app.js.
// Accepts either the packed {fmt:'p1', b64, len} object or a legacy plain array.
function unpackHrRecording(hrRecording) {
    if (!hrRecording) return [];
    // Legacy format: plain array of {t, hr, state}
    if (Array.isArray(hrRecording)) return hrRecording;
    if (hrRecording.fmt !== 'p1' || !hrRecording.b64) return [];

    const STATE_NAMES = ['active', 'rest', 'reset', 'pause', 'stopped'];
    const binary = atob(hrRecording.b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const result = [];
    const numPairs = Math.floor(bytes.length / 3);
    for (let p = 0; p < numPairs; p++) {
        const base  = p * 3;
        const b0 = bytes[base], b1 = bytes[base + 1], b2 = bytes[base + 2];
        const hr0 = (b0 << 1) | (b1 >> 7);
        const st0 = (b1 >> 4) & 7;
        const hr1 = ((b1 & 0xF) << 5) | (b2 >> 3);
        const st1 = b2 & 7;
        const t0  = p * 2, t1 = p * 2 + 1;
        if (hr0 > 0 && t0 < hrRecording.len) result.push({ t: t0, hr: hr0, state: STATE_NAMES[st0] || 'active' });
        if (hr1 > 0 && t1 < hrRecording.len) result.push({ t: t1, hr: hr1, state: STATE_NAMES[st1] || 'active' });
    }
    return result;
}

function hasHrRecording(session) {
    const r = session.hrRecording;
    if (!r) return false;
    if (Array.isArray(r)) return r.length > 0;
    return r.fmt === 'p1' && !!r.b64;
}

// ── Session Graph PDF ─────────────────────────────────────────────────────────
function generateSessionPDF(session) {
    if (typeof window.jspdf === 'undefined') {
        showToast('PDF library not loaded — try refreshing', 'error'); return;
    }
    const rec = unpackHrRecording(session.hrRecording);
    if (!rec || rec.length < 2) {
        showToast('No HR recording data for this session', 'error'); return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // ── Page layout constants ─────────────────────────────────────────────────
    const PW = 297, PH = 210;
    const ML = 24, MR = 18, MT = 30, MB = 32;
    const PX = ML, PY = MT, PW2 = PW - ML - MR, PH2 = PH - MT - MB;

    // ── Data range ────────────────────────────────────────────────────────────
    const maxT   = Math.max(rec[rec.length - 1].t, session.sessionLengthSec || 1);
    const hrVals = rec.map(r => r.hr).filter(h => h > 0);
    if (hrVals.length === 0) { showToast('No valid HR data to chart', 'error'); return; }

    const settingsMaxHR = (session.activitySettings && session.activitySettings.MAX_HR) || 200;
    const rawMin = Math.min(...hrVals), rawMax = Math.max(...hrVals);
    const yMin = Math.max(0,  Math.floor((rawMin - 10) / 10) * 10);
    const yMax = Math.min(settingsMaxHR, Math.ceil( (rawMax + 10) / 10) * 10);
    const yRange = yMax - yMin || 1;

    // ── Coordinate helpers ────────────────────────────────────────────────────
    function tToX(t)   { return PX + (t / maxT) * PW2; }
    function hrToY(hr) { return PY + PH2 - ((hr - yMin) / yRange) * PH2; }

    // ── State colours ─────────────────────────────────────────────────────────
    // Background bands: state colour blended at 22% opacity onto white
    const STATE_BG = {
        active:  [207, 237, 214], // #28a745
        rest:    [255, 227, 207], // #fd7e14
        reset:   [247, 212, 215], // #dc3545
        pause:   [228, 228, 228], // #888888
        stopped: [215, 215, 215],
    };
    const STATE_STROKE = {
        active: [40, 167, 69], rest: [253, 126, 20],
        reset:  [220, 53, 69], pause: [136, 136, 136], stopped: [80, 80, 80],
    };
    const STATE_LABEL = { active: 'Active', rest: 'Rest', reset: 'Reset', pause: 'Pause' };

    // ── White page background ─────────────────────────────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PW, PH, 'F');

    // ── State background bands ────────────────────────────────────────────────
    // Merge consecutive same-state samples into rectangles
    const bands = [];
    let bState = rec[0].state, bStart = rec[0].t;
    for (let i = 1; i <= rec.length; i++) {
        const cur = rec[i] ? rec[i].state : null;
        if (cur !== bState) {
            bands.push({ state: bState, t: bStart, endT: rec[i - 1].t + 1 });
            if (rec[i]) { bState = cur; bStart = rec[i].t; }
        }
    }
    for (const b of bands) {
        const x1 = Math.max(PX, tToX(b.t));
        const x2 = Math.min(PX + PW2, tToX(b.endT));
        if (x2 <= x1) continue;
        const bg = STATE_BG[b.state] || STATE_BG.stopped;
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(x1, PY, x2 - x1, PH2, 'F');
    }

    // ── Y-axis grid lines and labels ──────────────────────────────────────────
    const yStep = yRange <= 60 ? 10 : 20;
    doc.setFont('helvetica', 'normal');
    for (let hr = Math.ceil(yMin / yStep) * yStep; hr <= yMax; hr += yStep) {
        const y = hrToY(hr);
        if (y < PY - 0.5 || y > PY + PH2 + 0.5) continue;
        doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.15);
        doc.line(PX, y, PX + PW2, y);
        doc.setFontSize(7); doc.setTextColor(140, 140, 140);
        doc.text(String(hr), PX - 2, y + 1.5, { align: 'right' });
    }

    // ── X-axis grid lines and labels ──────────────────────────────────────────
    const minutesTotal = maxT / 60;
    const xStepMin = minutesTotal <= 10 ? 1 : minutesTotal <= 30 ? 5 :
                     minutesTotal <= 60 ? 10 : minutesTotal <= 120 ? 15 : 30;
    for (let m = 0; m <= minutesTotal + 0.01; m += xStepMin) {
        const x = tToX(m * 60);
        if (x < PX - 0.5 || x > PX + PW2 + 0.5) continue;
        doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.15);
        doc.line(x, PY, x, PY + PH2);
        const mm = Math.floor(m), ss = Math.round((m % 1) * 60);
        doc.setFontSize(7); doc.setTextColor(140, 140, 140);
        doc.text(`${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`,
                 x, PY + PH2 + 5, { align: 'center' });
    }

    // ── Plot border ───────────────────────────────────────────────────────────
    doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.25);
    doc.rect(PX, PY, PW2, PH2, 'S');

    // ── Resting HR reference line (dashed, blue) ──────────────────────────────
    const restingHR = session.activitySettings && session.activitySettings.RESTING_HR;
    if (restingHR && restingHR >= yMin && restingHR <= yMax) {
        const ry = hrToY(restingHR);
        doc.setDrawColor(100, 149, 237); doc.setLineWidth(0.3);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(PX, ry, PX + PW2, ry);
        doc.setLineDashPattern([], 0);
        doc.setFontSize(6.5); doc.setTextColor(100, 149, 237);
        doc.text('Resting HR', PX + PW2 + 1.5, ry + 1.5);
    }

    // ── HR line ───────────────────────────────────────────────────────────────
    const pts = rec.filter(r => r.hr > 0);
    if (pts.length >= 2) {
        doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.45);
        const segs = [];
        for (let i = 1; i < pts.length; i++) {
            segs.push([tToX(pts[i].t) - tToX(pts[i-1].t),
                       hrToY(pts[i].hr) - hrToY(pts[i-1].hr)]);
        }
        doc.lines(segs, tToX(pts[0].t), hrToY(pts[0].hr), [1, 1], 'S');
    }

    // ── Axis labels ───────────────────────────────────────────────────────────
    doc.setTextColor(80, 80, 80); doc.setFontSize(8);
    doc.text('HR (bpm)', PX - 16, PY + PH2 / 2, { angle: 90, align: 'center' });
    doc.text('Time (mm:ss)', PX + PW2 / 2, PY + PH2 + 11, { align: 'center' });

    // ── Title ─────────────────────────────────────────────────────────────────
    const dateStr = session.date
        ? new Date(session.date).toLocaleString(undefined, {
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit' })
        : 'Unknown date';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20, 20, 20);
    doc.text('HR Session Graph', PX, 10);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 90, 90);
    const meta = [
        dateStr,
        session.activityName ? `Activity: ${session.activityName}` : null,
        session.sessionLengthSec ? `Duration: ${formatTime(session.sessionLengthSec)}` : null,
        session.avgHr ? `Avg HR: ${session.avgHr} bpm` : null,
    ].filter(Boolean).join('   ·   ');
    doc.text(meta, PX, 18);

    // ── Session notes (if present) ────────────────────────────────────────────
    const notes = session.notes ? session.notes.trim() : '';
    if (notes) {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
        const noteLines = doc.splitTextToSize(`Notes: ${notes}`, PW2);
        // Render up to 2 lines in the gap between meta and plot (y=18 to y=30)
        noteLines.slice(0, 2).forEach((line, i) => doc.text(line, PX, 24 + i * 4));
        doc.setFont('helvetica', 'normal');
    }

    // ── Legend ────────────────────────────────────────────────────────────────
    const usedStates = [...new Set(rec.map(r => r.state))].filter(s => STATE_LABEL[s]);
    let lx = PX;
    const ly = PY + PH2 + 21;
    doc.setFontSize(8);
    for (const state of usedStates) {
        const bg = STATE_BG[state] || STATE_BG.stopped;
        const st = STATE_STROKE[state] || [80, 80, 80];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.setDrawColor(st[0], st[1], st[2]);
        doc.setLineWidth(0.3);
        doc.rect(lx, ly - 3.5, 5, 4.5, 'FD');
        doc.setTextColor(50, 50, 50);
        doc.text(STATE_LABEL[state], lx + 6.5, ly);
        lx += 30;
    }
    // HR line entry
    doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.45);
    doc.line(lx, ly - 1.5, lx + 5, ly - 1.5);
    doc.setTextColor(50, 50, 50);
    doc.text('Heart rate', lx + 6.5, ly);
    // Resting HR entry (if shown)
    if (restingHR && restingHR >= yMin && restingHR <= yMax) {
        lx += 30;
        doc.setDrawColor(100, 149, 237); doc.setLineWidth(0.3);
        doc.setLineDashPattern([2, 2], 0);
        doc.line(lx, ly - 1.5, lx + 5, ly - 1.5);
        doc.setLineDashPattern([], 0);
        doc.setTextColor(100, 149, 237);
        doc.text('Resting HR', lx + 6.5, ly);
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    const fileDate = session.date
        ? new Date(session.date).toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
        : 'session';
    doc.save(`hr-session-${fileDate}.pdf`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMenu();
    renderPage();
});
