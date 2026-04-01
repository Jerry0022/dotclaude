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

function renderBar(pct, elapsedPct) {
  const total = 14;
  const filled = Math.round((pct / 100) * total);
  const elapsedPos = Math.round(Math.max(0, Math.min(100, elapsedPct || 0)) / 100 * total);

  let bar = '';
  for (let i = 0; i < total; i++) {
    if (i === elapsedPos) {
      bar += '\u254f'; // ╏ thin vertical — elapsed marker
    } else if (i < filled) {
      bar += '\u2501'; // ━ heavy horizontal — used
    } else {
      bar += '\u2500'; // ─ light horizontal — free
    }
  }
  return bar;
}

function formatDelta(delta) {
  if (delta == null) return '';
  if (isNaN(delta)) delta = 0;
  let marker = '';
  if (delta >= 6)      marker = '!!';
  else if (delta >= 2) marker = '!';
  return '+' + delta + '%' + (marker ? ' ' + marker : '');
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

function renderUsageLine(label, pct, elapsedPct, delta, resetMinutes) {
  const bar = renderBar(pct, elapsedPct);
  const pctStr = String(pct).padStart(3, ' ') + '%';
  const deltaStr = formatDelta(delta);
  const resetStr = formatResetShort(resetMinutes);
  const pace = pct - elapsedPct;
  const warn = pace > 10 ? '  \u26a0 Pace!' : '';
  const deltaPart = deltaStr ? '  ' + deltaStr : '';
  return label + '  ' + bar + '  ' + pctStr + deltaPart + '  \u00b7 ' + resetStr + ' left' + warn;
}

function renderUsageMeter(usageData, delta5h, deltaWk) {
  if (!usageData || !usageData.session) {
    return '```\n\u26a0 Usage data unavailable \u2014 monitoring issue\n```';
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const lines = [];

  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  lines.push(renderUsageLine('5h', s.pct, elapsed5hPct, delta5h, s.resetInMinutes));

  if (w) {
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    lines.push(renderUsageLine('Wk', w.pct, elapsedWkPct, deltaWk, w.resetInMinutes));
  }

  return '```\n' + lines.join('\n') + '\n```';
}

module.exports = { readUsageData, renderBar, formatDelta, formatResetShort, renderUsageLine, renderUsageMeter };
