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
 *       hooks; if the graph is missing/stale/invalid (once/day JSON.parse
 *       validity check), kick off a background `graphify extract . --update`
 *       (AST-only, free) via a sentinel-tracked spawn. Keeps the graph fresh so
 *       the PreToolUse graphify-gate enforces against current data. If the
 *       PREVIOUS background build failed, surface it as one line before doing
 *       anything else (see reportBgFailureIfAny / hooks/lib/graphify-state's
 *       readSentinel — bg spawns are stdio:'ignore', so without this a failing
 *       build is otherwise invisible).
 *     - consent:false → stay silent (user declined).
 *     - no record     → (throttled, weekly) emit a one-time instruction for
 *       Claude to OFFER enabling graphify via AskUserQuestion, and record an
 *       `offer_shown` metrics event (see hooks/lib/graphify-metrics).
 *   Fail-open and non-blocking: every graphify invocation is detached/guarded so
 *   a missing Python toolchain never degrades session start.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { runOnce } = require('../lib/run-once');
const gstate = require('../lib/graphify-state');
const graphNudge = require('../lib/graph-nudge');
const metrics = require('../lib/graphify-metrics');

const cwd = process.cwd();
const cwdKey = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 12);

/**
 * Gap #5/#6: surface a background-build failure or a graph that looks
 * present but is invalid (0 nodes / unparsable) as ONE line to the user, and
 * report whether a rebuild is warranted. Deliberately does not throw.
 */
function reportBgFailureIfAny() {
  const sentinel = gstate.readSentinel(cwd);
  if (sentinel && sentinel.status === 'fail') {
    const codeInfo = sentinel.code == null ? '' : ` (exit ${sentinel.code})`;
    process.stdout.write(
      `⚠ graphify background build failed${codeInfo} — run \`graphify extract . --update\` manually or /devops-graph\n`
    );
    gstate.clearSentinel(cwd); // one report per failure, not every session
  }
}

/**
 * Deeper (once/24h) validity check beyond the cheap size-floor in hasGraph():
 * a graph.json that parses but has no "nodes" is as useless as a missing one.
 * JSON.parse only runs here (once per day, SessionStart) — never on the
 * PreToolUse hot path.
 */
function graphLooksValid() {
  try {
    const raw = fs.readFileSync(graphNudge.graphJsonPath(cwd), 'utf8');
    const parsed = JSON.parse(raw);
    return !!(parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && parsed.nodes.length > 0);
  } catch {
    return false;
  }
}

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
  reportBgFailureIfAny();
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
  // Once/24h deeper validity check (JSON.parse) beyond hasGraph()'s cheap size
  // floor — a present-but-empty/corrupt graph.json must trigger a rebuild too.
  const needsRebuild = !graphNudge.hasGraph(cwd)
    || graphNudge.graphIsStale(cwd)
    || (runOnce('ss-graphify-validate', cwdKey, { cooldownMs: 24 * 60 * 60 * 1000 }) && !graphLooksValid());
  // Throttle the rebuild so repeated SessionStart re-entries (multiple agents /
  // worktrees on the same cwd) cannot stack concurrent `graphify extract`.
  if (needsRebuild && runOnce('ss-graphify-extract', cwdKey, { cooldownMs: 10 * 60 * 1000 })) {
    gstate.bgWithSentinel('graphify', ['extract', '.', '--update'], cwd); // background, AST-only, free
  }
  process.exit(0);
}

if (state && state.consent === false) {
  process.exit(0); // declined — never nag
}

// No decision yet → offer ONCE (re-offer at most weekly if ignored).
// Only in real git projects — never nag in scratch/throwaway folders.
if (isGitRepo() && runOnce('ss-graphify-offer', cwdKey, { cooldownMs: 7 * 24 * 60 * 60 * 1000 })) {
  metrics.record('offer_shown', { source: 'session_start' }, { cwd });
  process.stdout.write(
    '[graphify] No knowledge-graph config for this project. Offer the user (AskUserQuestion) to enable graphify — ' +
    'it builds a queryable code graph so broad searches use the graph instead of grepping (token saver), kept fresh via git hooks. ' +
    'On YES: run `uv tool install graphifyy && graphify install && graphify hook install && graphify extract .`, then write .claude/graphify.json {"consent":true,"autoBuild":true}. ' +
    'After extract completes, verify graphify-out/graph.json exists and report its node count to the user; if missing, report the failure instead of claiming success. ' +
    'On NO: write .claude/graphify.json {"consent":false}. Always confirm before installing — never silently.\n'
  );
}
process.exit(0);
