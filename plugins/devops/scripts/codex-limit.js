#!/usr/bin/env node
/**
 * @script codex-limit
 * @version 0.1.0
 * @plugin devops
 * @description Remembers an exhausted Codex usage limit on this machine so
 *   codex-safe.sh skips Codex until the announced reset instead of letting
 *   every ship run into the same wall (and wait for the 5-min ceiling).
 *   The limit belongs to the ChatGPT account, not to a repo — the state
 *   lives per user in ~/.claude/codex-limit.json. It clears itself on the
 *   first check after the reset time; `reset` clears it early (e.g. after
 *   buying a plan).
 *
 * Usage:
 *   codex-limit.js check              exit 0 + reset time on stdout while the
 *                                     limit is active; exit 1 otherwise (an
 *                                     expired entry is deleted on the way)
 *   codex-limit.js record <file>...   scan Codex output; on a usage-limit
 *                                     error store it, print the reset time,
 *                                     exit 0; exit 1 when there is none
 *   codex-limit.js reset              forget the stored limit
 *   codex-limit.js status             one human line
 *
 * Environment:
 *   CODEX_LIMIT_FILE   state file override (tests)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_FILE = process.env.CODEX_LIMIT_FILE
  || path.join(os.homedir(), '.claude', 'codex-limit.json');

// Codex gives no reset time ("try again later") → retry after an hour. With
// the live detection in codex-safe.sh that retry costs seconds, not minutes.
const FALLBACK_MS = 60 * 60 * 1000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// eslint-disable-next-line no-control-regex
const stripAnsi =(s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/**
 * The Codex error line announcing an exhausted usage limit, or null.
 * Only lines that START like a Codex error count — the prompt Codex echoes
 * back (a diff, source code, fixtures) never starts that way, because diff
 * lines carry a +/-/space marker. That keeps a review of code that merely
 * mentions "usage limit" from switching Codex off.
 */
function findLimitLine(text) {
  for (const raw of stripAnsi(String(text || '')).split(/\r?\n/)) {
    const line = raw.replace(/^\[[^\]]*\]\s*/, '').trim(); // `[timestamp] ` prefix
    if (!/^(ERROR:|error:|stream error|You['’]ve hit your usage limit)/.test(line)) continue;
    if (/usage limit|rate limit reached|quota exceeded/i.test(line)) return line;
  }
  return null;
}

function to24h(h, m, ampm) {
  let hour = Number(h);
  if (ampm) {
    const pm = /pm/i.test(ampm);
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  return [hour, Number(m)];
}

/**
 * Reset time announced in a Codex usage-limit line, or null.
 * Codex prints the local time ("try again at 3:04 PM." today,
 * "try again at Oct 11th, 2026 3:04 PM." later) — older builds a
 * duration ("try again in 2 days 3 hours 5 minutes").
 */
function parseResetAt(line, now = new Date()) {
  const text = String(line || '');

  const at = text.match(/try again at\s+(?:([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+)?(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?/);
  if (at) {
    const [, mon, day, year, h, m, ampm] = at;
    const [hour, minute] = to24h(h, m, ampm);
    if (mon) {
      const month = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
      if (month < 0) return null;
      return new Date(Number(year), month, Number(day), hour, minute, 0, 0);
    }
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1); // time-only means the next such time
    return d;
  }

  const inPart = text.match(/try again in\s+([^.]+)/i);
  if (inPart) {
    const units = { day: 86400e3, hour: 3600e3, hr: 3600e3, minute: 60e3, min: 60e3, second: 1e3, sec: 1e3 };
    let ms = 0;
    for (const [, n, unit] of inPart[1].matchAll(/(\d+)\s*(day|hour|hr|minute|min|second|sec)s?/gi)) {
      ms += Number(n) * units[unit.toLowerCase()];
    }
    if (ms > 0) return new Date(now.getTime() + ms);
  }
  return null;
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const resetAt = new Date(s.resetAt);
    return Number.isNaN(resetAt.getTime()) ? null : { ...s, resetAt };
  } catch {
    return null;
  }
}

function clearState() {
  try { fs.unlinkSync(STATE_FILE); return true; } catch { return false; }
}

/** Active limit or null; an expired entry is removed (auto-reset). */
function activeLimit(now = new Date()) {
  const s = readState();
  if (!s) {
    if (fs.existsSync(STATE_FILE)) clearState(); // unreadable → never block Codex on it
    return null;
  }
  if (s.resetAt <= now) { clearState(); return null; }
  return s;
}

/** Store a limit found in `text`; returns the stored state or null. */
function recordFromText(text, now = new Date()) {
  const line = findLimitLine(text);
  if (!line) return null;
  const parsed = parseResetAt(line, now);
  const state = {
    resetAt: (parsed && parsed > now ? parsed : new Date(now.getTime() + FALLBACK_MS)).toISOString(),
    resetKnown: Boolean(parsed && parsed > now),
    recordedAt: now.toISOString(),
    message: line.slice(0, 300),
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  return { ...state, resetAt: new Date(state.resetAt) };
}

const fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'check': {
      const s = activeLimit();
      if (!s) return 1;
      process.stdout.write(fmt(s.resetAt) + '\n');
      return 0;
    }
    case 'record': {
      const text = rest.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
      const s = recordFromText(text);
      if (!s) return 1;
      process.stdout.write(fmt(s.resetAt) + '\n');
      return 0;
    }
    case 'reset': {
      const had = clearState();
      process.stdout.write(had
        ? 'codex-limit: stored Codex usage limit cleared — next call runs Codex again.\n'
        : 'codex-limit: no Codex usage limit stored.\n');
      return 0;
    }
    case 'status': {
      const s = activeLimit();
      process.stdout.write(s
        ? `codex-limit: Codex usage limit active until ${fmt(s.resetAt)}${s.resetKnown ? '' : ' (no reset time announced — retry window)'}.\n`
        : 'codex-limit: no active Codex usage limit.\n');
      return 0;
    }
    default:
      process.stderr.write('usage: codex-limit.js check | record <file>... | reset | status\n');
      return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { findLimitLine, parseResetAt, recordFromText, activeLimit, clearState, readState, STATE_FILE };
