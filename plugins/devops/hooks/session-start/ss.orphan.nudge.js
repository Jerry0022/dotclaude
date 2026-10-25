#!/usr/bin/env node
/**
 * @hook ss.orphan.nudge
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description One-line nudge when the current repo has unlanded work or
 *   worktrees with uncommitted changes. Reads ~/.claude/orphan-report.json
 *   (written daily by scripts/orphan-scan.js) — no git calls, no network, so
 *   it is boot-window safe. Silent without a report, with a report older than
 *   24 h (the line names the report age otherwise), for an unknown repo, or when nothing is at risk. The report entry
 *   A missing or >24 h old report also starts orphan-scan.js detached (the
 *   daily refresh). The report entry is matched by path prefix (worktrees live under the main checkout).
 *   Also (hook telemetry, lib/hook-telemetry.js): one line when a hook was
 *   killed/timed out in more than 5 % of its last 200 runs, at most once a day.
 *   Output: additionalContext asking Claude to show the line, e.g.
 *   "⚠ 3 ungelandete Branches / 2 Worktrees mit uncommitteter Arbeit → /auto-cleanup".
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_AGE_MS = 24 * 3_600_000;

function reportPath() {
  return process.env.DEVOPS_ORPHAN_REPORT || path.join(os.homedir(), '.claude', 'orphan-report.json');
}

function norm(p) {
  const n = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/**
 * The nudge line for `cwd`, or null.
 * @param {{cwd:string, lang?:string, report?:object|null, now?:number}} o
 */
function buildNudge({ cwd, lang = 'de', report, now = Date.now() }) {
  if (!report || !Array.isArray(report.repos)) return null;
  const t = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(t) || now - t > MAX_AGE_MS) return null;
  const here = norm(cwd);
  const entry = report.repos
    .filter((r) => r && r.path && (here === norm(r.path) || here.startsWith(`${norm(r.path)}/`)))
    .sort((a, b) => norm(b.path).length - norm(a.path).length)[0];
  if (!entry) return null;
  const risk = Array.isArray(entry.atRisk) ? entry.atRisk : [];
  const dirty = risk.filter((r) => r.dirty > 0).length;
  const unlanded = risk.length - dirty;
  if (unlanded + dirty === 0) return null;
  const age = formatAge(now - t);
  return lang === 'en'
    ? `⚠ ${unlanded} unlanded ${unlanded === 1 ? 'branch' : 'branches'} / ${dirty} ${dirty === 1 ? 'worktree' : 'worktrees'} with uncommitted work (as of ${age} ago) → /auto-cleanup`
    : `⚠ ${unlanded} ungelandete ${unlanded === 1 ? 'Branch' : 'Branches'} / ${dirty} ${dirty === 1 ? 'Worktree' : 'Worktrees'} mit uncommitteter Arbeit (Stand vor ${age}) → /auto-cleanup`;
}

/** "3 h" from one hour on, otherwise minutes (at least 1). */
function formatAge(ms) {
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h} h` : `${Math.max(1, Math.round(ms / 60_000))} min`;
}

const REFRESH_MS = 24 * 3_600_000;
const SPAWN_COOLDOWN_MS = 3_600_000;

/**
 * Daily refresh without an external scheduler: a missing or >24 h old report
 * starts scripts/orphan-scan.js detached (fire-and-forget, windowless). A
 * tmp marker keeps concurrent sessions from starting it twice within an hour.
 */
function refreshIfStale(file) {
  if (process.env.DEVOPS_ORPHAN_NO_SPAWN) return;
  try {
    let age = Infinity;
    try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { /* no report yet */ }
    if (age < REFRESH_MS) return;
    const marker = path.join(os.tmpdir(), 'dotclaude-orphan-scan.started');
    try {
      if (Date.now() - fs.statSync(marker).mtimeMs < SPAWN_COOLDOWN_MS) return;
    } catch { /* never started */ }
    fs.writeFileSync(marker, String(Date.now()));
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
    const child = require('child_process').spawn(process.execPath, [path.join(pluginRoot, 'scripts', 'orphan-scan.js')], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd(),
    });
    child.unref();
  } catch { /* the nudge is best effort */ }
}

const KILL_RATE_LIMIT = 0.05;
const KILL_MIN_RUNS = 20;
const NUDGE_INTERVAL_MS = 24 * 3_600_000;

/** "⚠ stop.flow.guard killed in 8 % of its last 200 runs (hook timeout) — ..." or null. */
function telemetryLine({ lang = 'de', file, now = Date.now(), stamp } = {}) {
  const tel = require('../lib/hook-telemetry');
  const target = file || tel.filePath();
  if (!target) return null;
  try { if (now - fs.statSync(stamp).mtimeMs < NUDGE_INTERVAL_MS) return null; } catch { /* never nudged */ }
  const bad = tel.killRates(target, { now })
    .filter((r) => r.runs >= KILL_MIN_RUNS && r.rate > KILL_RATE_LIMIT)
    .sort((a, b) => b.rate - a.rate)[0];
  if (!bad) return null;
  try { fs.writeFileSync(stamp, String(now)); } catch { /* best effort */ }
  const rate = Math.round(bad.rate * 100);
  return lang === 'en'
    ? `⚠ Hook ${bad.hook} was killed/timed out in ${rate} % of its last ${bad.runs} runs (overloaded machine or a slow hook)`
    : `⚠ Hook ${bad.hook} wurde in ${rate} % der letzten ${bad.runs} Läufe abgebrochen/Timeout (überlastete Maschine oder langsamer Hook)`;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    try {
      const hook = input.trim() ? JSON.parse(input) : {};
      refreshIfStale(reportPath());
      let lang = 'de';
      try { lang = require('../lib/locale').getLocale(hook.session_id); } catch { /* default */ }
      const lines = [];
      try {
        const report = JSON.parse(fs.readFileSync(reportPath(), 'utf8'));
        const orphan = buildNudge({ cwd: hook.cwd || process.cwd(), lang, report });
        if (orphan) lines.push(orphan);
      } catch { /* no report or unreadable */ }
      try {
        const tl = telemetryLine({ lang, stamp: path.join(os.tmpdir(), 'dotclaude-hook-telemetry-nudged') });
        if (tl) lines.push(tl);
      } catch { /* telemetry is optional */ }
      const line = lines.join('\n');
      if (line) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `[ss.orphan.nudge] Show the user this line verbatim in your first reply, once:\n${line}`,
          },
        }) + '\n');
      }
    } catch { /* no report or unreadable — stay silent */ }
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { buildNudge, reportPath, telemetryLine };
