'use strict';
/**
 * @module frustration-log
 * @version 0.1.0
 * @plugin devops
 * @feature frustrated-mode (alpha)
 * @description Marker-only log of detector verdicts at
 *   `~/.claude/devops-frustration.log`: ISO time, short session id, verdict,
 *   rounds, score and the signal markers (T1s, T2, ...). Never the prompt text.
 *
 *   Retention: every append rotates — the file is cut back to its newest
 *   MAX_LINES lines, so cleanup runs exactly as often as the log grows and
 *   needs no scheduler. The log has no reader besides
 *   scripts/frustration-replay.js and a human tuning the weights; delete it by
 *   hand any time. It is removed for good with the feature when Frustrated Mode
 *   graduates or is dropped (delete this module with it).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LINES = 300;

function logPath(opts = {}) {
  if (opts.file) return opts.file;
  const home = opts.home || process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.claude', 'devops-frustration.log');
}

/** One log line; every field is restricted to a safe charset so no prompt text can ride along. */
function formatLine({ sessionId, verdict, rounds, score, signals, nowMs }) {
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const ts = new Date(nowMs == null ? Date.now() : nowMs).toISOString();
  return `${ts} ${safe(sessionId).slice(0, 8) || '-'} ${safe(verdict) || '-'} rounds=${Number(rounds) || 0} score=${Number(score) || 0} signals=${(signals || []).map(safe).filter(Boolean).join(',') || '-'}`;
}

/** Append one verdict and rotate. Never throws. @returns {boolean} written */
function appendVerdict(entry, opts = {}) {
  try {
    const file = logPath(opts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* first write */ }
    lines.push(formatLine(entry));
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return true;
  } catch { return false; }
}

module.exports = { appendVerdict, formatLine, logPath, MAX_LINES };
