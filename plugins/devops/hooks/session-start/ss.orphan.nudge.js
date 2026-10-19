#!/usr/bin/env node
/**
 * @hook ss.orphan.nudge
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description One-line nudge when the current repo has unlanded work or
 *   worktrees with uncommitted changes. Reads ~/.claude/orphan-report.json
 *   (written daily by scripts/orphan-scan.js) — no git calls, no network, so
 *   it is boot-window safe. Silent without a report, with a report older than
 *   7 days, for an unknown repo, or when nothing is at risk. The report entry
 *   is matched by path prefix (worktrees live under the main checkout).
 *   Output: additionalContext asking Claude to show the line, e.g.
 *   "⚠ 3 ungelandete Branches / 2 Worktrees mit uncommitteter Arbeit → /auto-cleanup".
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_AGE_MS = 7 * 86_400_000;

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
  return lang === 'en'
    ? `⚠ ${unlanded} unlanded ${unlanded === 1 ? 'branch' : 'branches'} / ${dirty} ${dirty === 1 ? 'worktree' : 'worktrees'} with uncommitted work → /auto-cleanup`
    : `⚠ ${unlanded} ungelandete ${unlanded === 1 ? 'Branch' : 'Branches'} / ${dirty} ${dirty === 1 ? 'Worktree' : 'Worktrees'} mit uncommitteter Arbeit → /auto-cleanup`;
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', () => {
    try {
      const hook = input.trim() ? JSON.parse(input) : {};
      const report = JSON.parse(fs.readFileSync(reportPath(), 'utf8'));
      let lang = 'de';
      try { lang = require('../lib/locale').getLocale(hook.session_id); } catch { /* default */ }
      const line = buildNudge({ cwd: hook.cwd || process.cwd(), lang, report });
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

module.exports = { buildNudge, reportPath };
