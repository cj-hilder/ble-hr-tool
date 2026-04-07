// summary.js — Shared session summary card builder.
// Loaded by both index.html (main app) and history.html (history page).
// Requires utils.js (formatTime, escHtml) to be loaded first.

(function () {
    'use strict';

    // ─── Formatting helpers ───────────────────────────────────────────────────
    function fmtT(s) { return s > 0 ? formatTime(s) : '--'; }
    function fmtN(n) { return n > 0 ? n : '--'; }

    function fmtDate(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
    }
    function fmtTime(iso) {
        return new Date(iso).toLocaleTimeString(undefined, {
            hour: '2-digit', minute: '2-digit'
        });
    }

    // ─── Stat item helper ─────────────────────────────────────────────────────
    function statItem(value, label) {
        return `<div class="stat-item"><span>${escHtml(String(value))}</span><label>${escHtml(label)}</label></div>`;
    }

    // ─── Stat groups HTML ─────────────────────────────────────────────────────
    // Returns all the stat-group sections for a summary object.
    // Shared between the end-of-session modal tile and history card tiles.
    function buildStatGroupsHTML(s) {
        const isHRV = s.activityId === 'hrv_reading' || !!s.activityIsHRV;
        let html = '';

        if (!isHRV) {
            // ── Active Periods ────────────────────────────────────────────────
            const activeTotal = fmtT(s.budgetUsing === 1 ? s.totalTargetSec : s.totalActiveSec)
                              + (s.budgetUsing === 1 ? ' 𖣠' : '');
            const activeTotalLabel = s.budgetUsing === 1 ? 'Target time' : 'Total';
            html += `
            <div class="stat-group">
                <div class="stat-group-label active-label">🟢 Active Periods</div>
                <div class="stat-row">
                    ${statItem(activeTotal, activeTotalLabel)}
                    ${statItem((s.pctActive || '--') + (s.pctActive ? '%' : ''), '% session')}
                    ${statItem(fmtN(s.numActivePeriods), 'Count')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestActiveSec),  'Longest')}
                    ${statItem(fmtT(s.avgActiveSec),      'Average')}
                    ${statItem(fmtT(s.shortestActiveSec), 'Shortest')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtN(s.avgHrActive), 'Avg HR')}
                    <div></div><div></div>
                </div>
            </div>`;

            // ── Recovery Periods ──────────────────────────────────────────────
            html += `
            <div class="stat-group">
                <div class="stat-group-label recovery-label">🟠 Recovery Periods</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.totalRecoverySec), 'Total')}
                    ${statItem((s.pctRecovery || '--') + (s.pctRecovery ? '%' : ''), '% session')}
                    ${statItem(fmtN(s.numRecoveryPeriods), 'Count')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestRecoverySec),  'Longest')}
                    ${statItem(fmtT(s.avgRecoverySec),      'Average')}
                    ${statItem(fmtT(s.shortestRecoverySec), 'Shortest')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtN(s.avgHrRecovery), 'Avg HR')}
                    <div></div><div></div>
                </div>
            </div>`;

            // ── Lag & Peak HR ─────────────────────────────────────────────────
            html += `
            <div class="stat-group">
                <div class="stat-group-label lag-label">📈 Lag & Peak HR</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.longestLagSec),  'Longest lag')}
                    ${statItem(fmtT(s.avgLagSec),      'Avg lag')}
                    ${statItem(fmtT(s.shortestLagSec), 'Shortest lag')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtN(s.highestPeakHr), 'Highest peak')}
                    ${statItem(fmtN(s.avgPeakHr),     'Avg peak')}
                    ${statItem(fmtN(s.lowestPeakHr),  'Lowest peak')}
                </div>
            </div>`;
        }

        // ── Session (always shown) ────────────────────────────────────────────
        html += `
        <div class="stat-group">
            <div class="stat-group-label session-label">📊 Session</div>
            <div class="stat-row">
                ${statItem(fmtT(s.sessionLengthSec), 'Duration')}
                ${statItem(fmtN(s.highestHr),        'Highest HR')}
                ${statItem(fmtN(s.avgHr),            'Avg HR')}
            </div>
            <div class="stat-row">
                ${statItem(fmtN(s.lowestHr), 'Lowest HR')}
                <div></div><div></div>
            </div>
        </div>`;

        // ── HRV Reading (HRV sessions only) ───────────────────────────────────
        if (isHRV) {
            const hrvVal    = s.hvIndexFinal != null ? String(Math.round(s.hvIndexFinal)) : '--';
            const shortNote = s.hrvSessionTooShort
                ? `<div class="hrv-card-short-note">⚠️ Short snapshot — less than 3 minutes. Result may be unreliable.</div>`
                : '';
            html += `
            <div class="stat-group">
                <div class="stat-group-label hrv-label">💜 HRV Index</div>
                <div class="stat-row">
                    ${statItem(hrvVal,                'HRV')}
                    ${statItem(fmtT(s.sessionLengthSec), 'Duration')}
                    ${statItem(fmtN(s.avgHr),         'Avg HR')}
                </div>
                ${shortNote}
            </div>`;
        }

        // ── Activity settings (if present) ────────────────────────────────────
        if (s.activitySettings && Object.keys(s.activitySettings).length > 0) {
            const ss = s.activitySettings;
            // For HRV Reading sessions only show the resting HR setting —
            // active thresholds, bradycardia, recovery and lag limits are irrelevant.
            const lines = isHRV
                ? [`Resting HR: ${ss.RESTING_HR || '--'} ±${ss.RESTING_HR_BANDWIDTH || '--'}`]
                : [
                    `Max HR: ${ss.MAX_HR || '--'} · Resting HR: ${ss.RESTING_HR || '--'} ±${ss.RESTING_HR_BANDWIDTH || '--'}`,
                    `Active: ${ss.ACTIVE_THRESHOLD_LOWER || '--'}–${ss.ACTIVE_THRESHOLD_UPPER || '--'} bpm · Brady: ${ss.BRADYCARDIA_THRESHOLD || '--'}`,
                    `Max recovery: ${ss.MAX_RECOVERY_PERIOD || '--'}s · Max lag: ${ss.MAX_RESPONSE_LAG || '--'}s`,
                ];
            html += `
            <div class="stat-group">
                <div class="stat-group-label settings-label">⚙️ Session Settings</div>
                <div class="settings-summary">${lines.map(l => escHtml(l)).join('<br>')}</div>
            </div>`;
        }

        // ── Resonance Breathing (if RFB data present; not for HRV Reading) ────
        if (!isHRV && s.rfbTotalSec > 0) {
            const rfbAvg  = (s.rfbAvgRI  ?? s.rfbAvgCoherence)  ?? '--';
            const rfbPeak = (s.rfbPeakRI ?? s.rfbPeakCoherence) ?? '--';
            const rfbPct  = s.rfbPctAboveStar1 != null ? s.rfbPctAboveStar1 + '%' : '--';
            html += `
            <div class="stat-group">
                <div class="stat-group-label rfb-label">💙 Resonance Breathing</div>
                <div class="stat-row">
                    ${statItem(rfbAvg,  'Avg RI')}
                    ${statItem(rfbPeak, 'Peak RI')}
                    ${statItem(rfbPct,  'Time ≥★')}
                </div>
                <div class="stat-row">
                    ${statItem(fmtT(s.rfbTotalSec), 'Duration')}
                    <div></div><div></div>
                </div>
            </div>`;
        }

        return html;
    }

    // ─── Card header HTML ─────────────────────────────────────────────────────
    // Returns the clickable header row (date, chips, chevron) for a card tile.
    function buildCardHeaderHTML(s, cardId) {
        const isHRV       = s.activityId === 'hrv_reading' || !!s.activityIsHRV;
        const actName     = s.activityName || '';
        const durationMin = s.sessionLengthSec ? Math.round(s.sessionLengthSec / 60) : '--';
        const resets      = s.numRecoveryPeriods || 0;
        const dateStr     = s.date ? `${fmtDate(s.date)} · ${fmtTime(s.date)}` : 'New session';

        let chips = '';
        if (isHRV) {
            const hrvVal = s.hvIndexFinal != null ? String(Math.round(s.hvIndexFinal)) : null;
            chips = `
                <span class="chip chip-hrv">HRV Reading</span>
                <span class="chip chip-duration">${durationMin} min</span>
                ${hrvVal ? `<span class="chip chip-hrv-index">HRV ${hrvVal}</span>` : ''}`;
        } else {
            chips = `
                ${actName ? `<span class="chip chip-activity">${escHtml(actName)}</span>` : ''}
                <span class="chip chip-duration">${durationMin} min</span>
                <span class="chip chip-active">${s.pctActive || '--'}% active</span>
                ${resets > 0 ? `<span class="chip chip-resets">${resets} recovery periods</span>` : ''}`;
        }

        return `
        <div class="session-card-header"
             data-action="toggle-card"
             data-card-id="${escHtml(cardId)}"
             style="pointer-events:auto">
            <div class="session-header-left" style="pointer-events:none">
                <div class="session-date">${escHtml(dateStr)}</div>
                <div class="session-chips">${chips}</div>
            </div>
            <span class="session-chevron" style="pointer-events:none">›</span>
        </div>`;
    }

    // ─── Full card HTML ───────────────────────────────────────────────────────
    // opts:
    //   cardId      {string}  DOM id for the card element (required)
    //   realIndex   {number|string}  used in data-index on buttons (for history actions)
    //   notesHtml   {string}  pre-built notes row HTML; omit for modal
    //   showGraphBtn{boolean} show "View Session Graph (PDF)" button
    //   showDelete  {boolean} show "Delete this session" button
    //   startOpen   {boolean} card starts expanded (default: false = collapsed)
    function buildCardHTML(s, opts = {}) {
        const cardId    = opts.cardId || `card-${opts.realIndex}`;
        const openClass = opts.startOpen ? ' open' : '';
        const notesFrag = opts.notesHtml || '';
        const graphBtn  = opts.showGraphBtn
            ? `<button class="session-graph-btn" data-action="view-graph" data-index="${opts.realIndex}">📈 View Session Graph (PDF)</button>`
            : '';
        const deleteBtn = opts.showDelete
            ? `<button class="session-delete-btn" data-action="delete-session" data-index="${opts.realIndex}">Delete this session</button>`
            : '';

        return `
        <div class="session-card${openClass}" id="${escHtml(cardId)}">
            ${buildCardHeaderHTML(s, cardId)}
            <div class="session-detail">
                ${notesFrag}
                ${buildStatGroupsHTML(s)}
                ${graphBtn}
                ${deleteBtn}
            </div>
        </div>`;
    }

    // ─── Generic toggle handler ───────────────────────────────────────────────
    // Handles data-action="toggle-card" data-card-id="<id>" on any page.
    // history.js delegates notes/delete/graph; this covers the toggle only.
    document.addEventListener('click', function (e) {
        const el = e.target.closest('[data-action="toggle-card"]');
        if (!el) return;
        const cardId = el.getAttribute('data-card-id');
        if (cardId) {
            const card = document.getElementById(cardId);
            if (card) card.classList.toggle('open');
        }
    });

    // ─── Public API ───────────────────────────────────────────────────────────
    window.SummaryCard = {
        buildCardHTML,
        buildStatGroupsHTML,
        buildCardHeaderHTML,
        statItem,
    };
})();
