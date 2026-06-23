#!/usr/bin/env node
/**
 * @hook ss.graphify
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description graphify enforcement — install-check + auto-build wiring for the
 *   devops-graph feature. Behavior depends on the per-project consent record at
 *   .claude/graphify.json (written ONLY after the user opts in/out via the
 *   offer below — never silently):
 *     - consent:true  → ensure graphify is installed; (once/day) install its git
 *       hooks; if the graph is missing/stale, kick off a background
 *       `graphify extract . --update` (AST-only, free). Keeps the graph fresh so
 *       the PreToolUse graphify-gate enforces against current data.
 *     - consent:false → stay silent (user declined).
 *     - no record     → (throttled, weekly) emit a one-time instruction for
 *       Claude to OFFER enabling graphify via AskUserQuestion.
 *   Fail-open and non-blocking: every graphify invocation is detached/guarded so
 *   a missing Python toolchain never degrades session start.
 */

require('../lib/plugin-guard');

const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { runOnce } = require('../lib/run-once');
const gstate = require('../lib/graphify-state');
const graphNudge = require('../lib/graph-nudge');

const cwd = process.cwd();
const cwdKey = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);

function graphifyInstalled() {
  try {
    const { checkTool } = require('../../scripts/check-tool.js');
    return checkTool('graphify').installed;
  } catch {
    return false;
  }
}

function isGitRepo() {
  try {
    return execSync('git rev-parse --is-inside-work-tree', {
      cwd, encoding: 'utf8', timeout: 4000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() === 'true';
  } catch {
    return false;
  }
}

function bg(cmd, args) {
  // Detached + unref so a 5-10s graphify build never blocks session start.
  // `shell` on Windows so a `graphify.cmd`/`.bat` shim (what `uv tool install`
  // produces) actually runs — a bare spawn cannot exec a .cmd and would
  // silently no-op, leaving the graph un-refreshed. Guarded: a missing
  // toolchain throws → no-op.
  try {
    spawn(cmd, args, {
      cwd, detached: true, stdio: 'ignore', shell: process.platform === 'win32',
    }).unref();
  } catch { /* toolchain absent */ }
}

const state = gstate.readState(cwd);

if (state && state.consent === true) {
  // Opted in. Keep the graph fresh so the gate enforces against current code.
  if (!graphifyInstalled()) {
    if (runOnce('ss-graphify-reinstall', cwdKey, { cooldownMs: 24 * 60 * 60 * 1000 })) {
      process.stdout.write(
        '[graphify] Enabled for this project but the `graphify` CLI is not on PATH. ' +
        'Offer the user to reinstall (`uv tool install graphifyy && graphify install`), ' +
        'or to disable graphify here (set .claude/graphify.json {"consent":false}).\n'
      );
    }
    process.exit(0);
  }
  if (isGitRepo() && runOnce('ss-graphify-hookinstall', cwdKey, { cooldownMs: 24 * 60 * 60 * 1000 })) {
    bg('graphify', ['hook', 'install']); // idempotent git post-commit/checkout AST rebuild
  }
  // Throttle the rebuild so repeated SessionStart re-entries (multiple agents /
  // worktrees on the same cwd) cannot stack concurrent `graphify extract`.
  if ((!graphNudge.hasGraph(cwd) || graphNudge.graphIsStale(cwd))
      && runOnce('ss-graphify-extract', cwdKey, { cooldownMs: 10 * 60 * 1000 })) {
    bg('graphify', ['extract', '.', '--update']); // background, AST-only, free
  }
  process.exit(0);
}

if (state && state.consent === false) {
  process.exit(0); // declined — never nag
}

// No decision yet → offer ONCE (re-offer at most weekly if ignored).
// Only in real git projects — never nag in scratch/throwaway folders.
if (isGitRepo() && runOnce('ss-graphify-offer', cwdKey, { cooldownMs: 7 * 24 * 60 * 60 * 1000 })) {
  process.stdout.write(
    '[graphify] No knowledge-graph config for this project. Offer the user (AskUserQuestion) to enable graphify — ' +
    'it builds a queryable code graph so broad searches use the graph instead of grepping (token saver), kept fresh via git hooks. ' +
    'On YES: run `uv tool install graphifyy && graphify install && graphify hook install && graphify extract .`, then write .claude/graphify.json {"consent":true,"autoBuild":true}. ' +
    'On NO: write .claude/graphify.json {"consent":false}. Always confirm before installing — never silently.\n'
  );
}
process.exit(0);
