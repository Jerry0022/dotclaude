/**
 * @module usage-meter
 * @version 0.1.0
 * @plugin dotclaude-dev-ops
 * @description Shared usage meter rendering logic.
 *   Used by render-card.js (completion card) and mcp-server/index.js (get_usage tool).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function readUsageData() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'usage-live.json'),
    path.join(os.homedir(), '.claude', 'scripts', 'usage-live.json'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
  }
  return null;
}

function renderBar(pct) {
  const filled = Math.round((pct / 100) * 12);
  const empty = 12 - filled;
  return '\u2593'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatDelta(delta) {
  if (delta == null) return ' '.repeat(8);
  if (isNaN(delta)) delta = 0;
  const sign = '+' + delta;
  let marker;
  if (delta >= 6)      marker = '!!';
  else if (delta >= 2) marker = '! ';
  else                 marker = '  ';
  const inner = (sign + '% ' + marker).padEnd(6, ' ');
  return '(' + inner + ')';
}

function formatResetShort(minutes) {
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + h + 'h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + 'h ' + m + 'm';
}

function renderUsageMeter(usageData, delta5h, deltaWk) {
  if (!usageData || !usageData.session) {
    return '```\n\u26a0 Usage data unavailable \u2014 monitoring issue\n```';
  }

  const s = usageData.session;
  const w = usageData.weekly;

  const lines = [];

  // --- 5h window ---
  const bar5h = renderBar(s.pct);
  const pct5h = String(s.pct).padStart(3, ' ') + '%';
  const delta5hStr = formatDelta(delta5h);
  const reset5h = formatResetShort(s.resetInMinutes);
  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  const arrowPos5h = Math.round(Math.max(0, Math.min(100, elapsed5hPct)) / 100 * 12);
  const pace5h = s.pct - elapsed5hPct;
  const warn5h = pace5h > 10 ? '  \u26a0 Sonnet or new session' : '';

  lines.push('5h  ' + bar5h + '   ' + pct5h + ' ' + delta5hStr + '  \u00b7 Reset ' + reset5h + warn5h);
  lines.push(' '.repeat(4 + arrowPos5h) + '\u2191');
  lines.push('');

  // --- Wk window ---
  if (w) {
    const barWk = renderBar(w.pct);
    const pctWk = String(w.pct).padStart(3, ' ') + '%';
    const deltaWkStr = formatDelta(deltaWk);
    const resetWk = formatResetShort(w.resetInMinutes);
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    const arrowPosWk = Math.round(Math.max(0, Math.min(100, elapsedWkPct)) / 100 * 12);
    const paceWk = w.pct - elapsedWkPct;
    const warnWk = paceWk > 10 ? '  \u26a0 Sonnet or new session' : '';

    lines.push('Wk  ' + barWk + '   ' + pctWk + ' ' + deltaWkStr + '  \u00b7 Reset ' + resetWk + warnWk);
    lines.push(' '.repeat(4 + arrowPosWk) + '\u2191');
  }

  return '```\n' + lines.join('\n') + '\n```';
}

module.exports = { readUsageData, renderBar, formatDelta, formatResetShort, renderUsageMeter };
