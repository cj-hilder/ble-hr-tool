// summary.js — Shared session summary card builder.
// Loaded by both index.html (main app) and history.html (history page).
// Requires utils.js (formatTime, escHtml) to be loaded first.

(function () {
    'use strict';

    // ─── Formatting helpers ───────────────────────────────────────────────────
    function fmtT(s) { return s > 0 ? formatTime(s) : '--'; }
    function fmtN(n) { return n > 0 ? n : '--'; }
    // Lag times can legitimately be zero (instant recovery). Show '--' only when
    // there were no recovery periods at all; otherwise use formatTime so zero => '00:00'.
    function fmtLag(sec, numRecoveryPeriods) {
        return numRecoveryPeriods > 0 ? formatTime(sec) : '--';
    }

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

    // ─── Session type helpers ─────────────────────────────────────────────────
    function isHRVSession(s)  { return s.activityId === 'hrv_reading' || !!s.activityIsHRV; }
    function isRFBSession(s)  { return s.activityId === 'resonance_breathing'; }
    function hasTargetZone(s) { return s.budgetUsing === 1 && (s.totalTargetSec || 0) > 0; }

    // ─── Stat groups HTML ─────────────────────────────────────────────────────
    // Returns all the stat-group sections for a summary object.
    // Shared between the end-of-session modal tile and history card tiles.
    function buildStatGroupsHTML(s) {
        const isHRV = isHRVSession(s);
        const isRFB = isRFBSession(s);
        const byTarget = hasTargetZone(s);
        let html = '';

        // ── Active Periods (standard activities only, not HRV or RFB) ─────────
        if (!isHRV && !isRFB) {
            // Always show active-state time in this section, regardless of budget mode.
            // If budgeting by target, the target-zone data gets its own section below.
            html += `
            <div class="stat-group">
                <div class="stat-group-label active-label">🟢 Active Periods</div>
                <div class="stat-row">
                    ${statItem(fmtT(s.totalActiveSec), 'Total')}
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

            // ── Target Zone (only when budgeting by target time) ──────────────
            if (byTarget) {
                html += `
                <div class="stat-group">
                    <div class="stat-group-label target-label">🎯 Target Zone</div>
                    <div class="stat-row">
                        ${statItem(fmtT(s.totalTargetSec), 'Target time')}
                        ${statItem((s.pctTarget || '--') + (s.pctTarget ? '%' : ''), '% session')}
                        ${statItem(fmtN(s.avgHrTarget), 'Avg HR')}
                    </div>
                </div>`;
            }

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
                <div class="stat-group-label lag-label">📈 Recovery Lag & Peak HR</div>
                <div class="stat-row">
                    ${statItem(fmtLag(s.longestLagSec,  s.numRecoveryPeriods), 'Longest lag')}
                    ${statItem(fmtLag(s.avgLagSec,      s.numRecoveryPeriods), 'Avg lag')}
                    ${statItem(fmtLag(s.shortestLagSec, s.numRecoveryPeriods), 'Shortest lag')}
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

        // ── HRV Index (HRV Reading sessions only) ─────────────────────────────
        if (isHRV) {
            const hrvVal    = s.hvIndexFinal != null ? String(Math.round(s.hvIndexFinal)) : '--';
            const shortNote = s.hrvSessionTooShort
                ? `<div class="hrv-card-short-note">⚠️ Short snapshot — less than 3 minutes. Result may be unreliable.</div>`
                : '';
            html += `
            <div class="stat-group">
                <div class="stat-group-label hrv-label">💜 HRV Index</div>
                <div class="stat-row">
                    ${statItem(hrvVal,                   'HRV')}
                    ${statItem(fmtT(s.sessionLengthSec), 'Duration')}
                    ${statItem(fmtN(s.avgHr),            'Avg HR')}
                </div>
                ${shortNote}
            </div>`;
        }

        // ── Resonance Breathing stats (dedicated RFB sessions) ────────────────
        if (isRFB && s.rfbTotalSec > 0) {
            const rfbAvg  = (s.rfbAvgRI  ?? s.rfbAvgCoherence)  ?? '--';
            const rfbPeak = (s.rfbPeakRI ?? s.rfbPeakCoherence) ?? '--';
            const rfbPct  = s.rfbPctAboveStar1 != null ? s.rfbPctAboveStar1 + '%' : '--';
            html += `
            <div class="stat-group">
                <div class="stat-group-label rfb-label">💙 Resonance Index</div>
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

        // ── Activity settings ─────────────────────────────────────────────────
        if (s.activitySettings && Object.keys(s.activitySettings).length > 0) {
            const ss = s.activitySettings;
            let lines;

            if (isHRV) {
                // HRV Reading: only resting HR is relevant
                lines = [
                    `Resting HR: ${ss.RESTING_HR || '--'} \u00b1${ss.RESTING_HR_BANDWIDTH || '--'}`,
                ];
            } else if (isRFB) {
                // Resonance Breathing: breathing parameters only
                const inhale  = ss.RFB_INHALE_SEC || '--';
                const exhale  = ss.RFB_EXHALE_SEC || '--';
                const rateBpm = (inhale !== '--' && exhale !== '--')
                    ? (60 / (inhale + exhale)).toFixed(1) + ' bpm'
                    : '--';
                lines = [
                    `Max HR: ${ss.MAX_HR || '--'} \u00b7 Resting HR: ${ss.RESTING_HR || '--'} \u00b1${ss.RESTING_HR_BANDWIDTH || '--'}`,
                    `Inhale: ${inhale}s \u00b7 Exhale: ${exhale}s \u00b7 Rate: ${rateBpm}`,
                ];
            } else {
                // Standard activity
                lines = [
                    `Max HR: ${ss.MAX_HR || '--'} \u00b7 Resting HR: ${ss.RESTING_HR || '--'} \u00b1${ss.RESTING_HR_BANDWIDTH || '--'}`,
                    `Active: ${ss.ACTIVE_THRESHOLD_LOWER || '--'}\u2013${ss.ACTIVE_THRESHOLD_UPPER || '--'} bpm \u00b7 Brady: ${ss.BRADYCARDIA_THRESHOLD || '--'}`,
                    `Max recovery: ${ss.MAX_RECOVERY_PERIOD || '--'}s \u00b7 Max lag: ${ss.MAX_RESPONSE_LAG || '--'}s`,
                ];
                if (byTarget) {
                    lines.push(`Target zone: ${ss.TARGET_MIN_HR || '--'}\u2013${ss.TARGET_MAX_HR || '--'} bpm`);
                }
            }

            html += `
            <div class="stat-group">
                <div class="stat-group-label settings-label">⚙️ Session Settings</div>
                <div class="settings-summary">${lines.map(l => escHtml(l)).join('<br>')}</div>
            </div>`;
        }

        // ── Resonance Breathing (embedded in standard activity sessions) ──────
        // Show when RFB data is present but session is NOT a dedicated RFB session.
        if (!isHRV && !isRFB && s.rfbTotalSec > 0) {
            const rfbAvg  = (s.rfbAvgRI  ?? s.rfbAvgCoherence)  ?? '--';
            const rfbPeak = (s.rfbPeakRI ?? s.rfbPeakCoherence) ?? '--';
            const rfbPct  = s.rfbPctAboveStar1 != null ? s.rfbPctAboveStar1 + '%' : '--';
            html += `
            <div class="stat-group">
                <div class="stat-group-label rfb-label">💙 Resonance Breathing</div>
                <div class="stat-row">
                    ${statItem(rfbAvg,  'Avg RI')}
                    ${statItem(rfbPeak, 'Peak RI')}
                    ${statItem(rfbPct,  'Time \u2265\u2605')}
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
    function buildCardHeaderHTML(s, cardId) {
        const isHRV       = isHRVSession(s);
        const isRFB       = isRFBSession(s);
        const byTarget    = hasTargetZone(s);
        const actName     = s.activityName || '';
        const durationMin = s.sessionLengthSec ? Math.round(s.sessionLengthSec / 60) : '--';
        const resets      = s.numRecoveryPeriods || 0;
        const dateStr     = s.date ? `${fmtDate(s.date)} \u00b7 ${fmtTime(s.date)}` : 'New session';

        let chips = '';
        if (isHRV) {
            const hrvVal = s.hvIndexFinal != null ? String(Math.round(s.hvIndexFinal)) : null;
            chips = `
                <span class="chip chip-hrv">HRV Reading</span>
                <span class="chip chip-duration">${durationMin} min</span>
                ${hrvVal ? `<span class="chip chip-hrv-index">HRV ${hrvVal}</span>` : ''}`;
        } else if (isRFB) {
            const rfbAvg = (s.rfbAvgRI ?? s.rfbAvgCoherence);
            chips = `
                <span class="chip chip-rfb">Resonance Breathing</span>
                <span class="chip chip-duration">${durationMin} min</span>
                ${rfbAvg != null ? `<span class="chip chip-rfb-index">${rfbAvg} avg RI</span>` : ''}`;
        } else {
            // Standard activity — headline is target time or % active
            const headlineChip = byTarget
                ? `<span class="chip chip-target">${Math.round((s.totalTargetSec || 0) / 60)} min ≥ target</span>`
                : `<span class="chip chip-active">${s.pctActive || '--'}% active</span>`;
            chips = `
                ${actName ? `<span class="chip chip-activity">${escHtml(actName)}</span>` : ''}
                <span class="chip chip-duration">${durationMin} min</span>
                ${headlineChip}
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
            <span class="session-chevron" style="pointer-events:none">\u203a</span>
        </div>`;
    }

    // ─── Full card HTML ───────────────────────────────────────────────────────
    // opts:
    //   cardId      {string}  DOM id for the card element
    //   realIndex   {number}  data-index on action buttons (history page)
    //   notesHtml   {string}  pre-built notes container HTML; omit for modal
    //   showGraphBtn{boolean} show "View Session Graph (PDF)" button
    //   showDelete  {boolean} show "Delete this session" button
    //   startOpen   {boolean} card starts expanded (default: collapsed)
    function buildCardHTML(s, opts = {}) {
        const cardId    = opts.cardId || `card-${opts.realIndex}`;
        const openClass = opts.startOpen ? ' open' : '';
        const notesFrag = opts.notesHtml || '';
        const graphBtn  = opts.showGraphBtn
            ? `<button class="session-graph-btn" data-action="view-graph" data-index="${opts.realIndex}">\uD83D\uDCC8 View Session Graph (PDF)</button>`
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
