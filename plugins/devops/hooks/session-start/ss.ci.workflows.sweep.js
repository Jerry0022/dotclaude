#!/usr/bin/env node
/**
 * @hook ss.ci.workflows.sweep
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Safety net for #949: workflows the ship pipeline paused while a
 *   skip-checks decision covered an exhausted Actions-minutes block must never
 *   stay disabled. Reads ~/.claude/devops-ci-quota.json (no network) through
 *   mcp-server/ship/lib/ci-workflow-sweep-cli.mjs --list; when records are
 *   overdue (period over, block cleared, decision revoked, or a re-enable that
 *   failed earlier) it starts the sweep detached (gh workflow enable) and adds
 *   one warning line. Silent without records. Never blocks: fail open.
 */

require('../lib/plugin-guard');

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'mcp-server', 'ship', 'lib', 'ci-workflow-sweep-cli.mjs');

/** The additionalContext line for the overdue repos, or null. */
function buildContext(repos) {
  if (!repos.length) return null;
  return `[ss.ci.workflows.sweep] Paused CI workflows are overdue for re-enabling (${repos.join(', ')}) — `
    + 'the sweep was started in the background (gh workflow enable). Mention in one line to the user: '
    + '"Workflows in <repo> werden wieder aktiviert (Minutenlimit vorbei)"; a failed enable is retried on the next ship or session.';
}

function overdue() {
  const r = spawnSync(process.execPath, [CLI, '--list'], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
  if (r.status !== 0) return [];
  const list = JSON.parse(r.stdout || '[]');
  return Array.isArray(list) ? list : [];
}

function startSweep() {
  const child = spawn(process.execPath, [CLI], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function main() {
  const repos = overdue();
  const ctx = buildContext(repos);
  if (!ctx) return null;
  try { startSweep(); } catch { /* best effort */ }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } };
}

if (require.main === module) {
  try { require('../lib/hook-input').runHook(main, { event: 'SessionStart' }); } catch { /* fail open */ }
}

module.exports = { main, buildContext, overdue, CLI };
