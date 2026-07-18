#!/usr/bin/env node
/**
 * @hook ss.graphify
 * @version 0.3.1
 * @event SessionStart
 * @plugin devops
 * @description graphify enforcement — install-check + auto-build wiring for the
 *   devops-graph feature. DEFAULT-ON, opt-out, key-less, windowless: no
 *   AskUserQuestion, no interaction, no per-project setup. Behavior depends on
 *   gstate.isEnabled/isDeclined, which read (never write) the per-project
 *   record at .claude/graphify.json and the global, machine-wide record at
 *   ~/.claude/graphify.json:
 *     - declined (either record has consent:false) → stay silent, exit 0.
 *     - enabled (INCLUDING no record at all — the default) →
 *         - surface any PREVIOUS background build failure as one line before
 *           doing anything else (see reportBgFailureIfAny / hooks/lib/
 *           graphify-state's readSentinel — bg spawns are stdio:'ignore', so
 *           without this a failing build is otherwise invisible).
 *         - if this is the first time graphify auto-enables for a project with
 *           NO record (nothing to do with consent:true — that value is no
 *           longer written by anyone), print a ONE-TIME (weekly-throttled)
 *           transparency line so the user knows it's on and how to opt out.
 *         - if graphify is not installed: kick a best-effort background
 *           `uv tool install graphifyy` (windowless, fail-open) and exit —
 *           the graph builds next session once the CLI lands.
 *         - if graphify IS installed: ONE-TIME (per project, persistent —
 *           never re-run) legacy cleanup of graphify's own git hooks
 *           (`graphify hook uninstall` — those pop a console window on
 *           Windows on every commit; devops owns freshness instead via this
 *           SessionStart refresh + the PreToolUse self-heal, both windowless).
 *           This is NOT a recurring fight: new projects never get graphify's
 *           git hooks installed by devops in the first place, so the removal
 *           only ever needs to happen once per project.
 *           Then, if the graph is missing/stale/invalid (once/day JSON.parse
 *           validity check), kick off a background `graphify update .`
 *           (AST-only, free, key-less) via a sentinel-tracked spawn. Keeps the
 *           graph fresh so the PreToolUse graphify-gate enforces against
 *           current data.
 *   Fail-open and non-blocking: every graphify invocation is detached/guarded
 *   (windowless on Windows too) so a missing Python toolchain never degrades
 *   session start.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { runOnce } = require('../lib/run-once');
const gstate = require('../lib/graphify-state');
const graphNudge = require('../lib/graph-nudge');

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
      `⚠ graphify background build failed${codeInfo} — run \`graphify update .\` manually or /devops-graph\n`
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
  // Fire-and-forget background task (uv install / graphify hook uninstall) with
  // NO sentinel. Delegates to gstate.bgWindowless, which runs it through a
  // detached, windowless Node runner: survives this hook's exit AND never pops a
  // console window on Windows (a naive detached shell spawn does — the grandchild
  // graphify/uv process inherits no console and Windows gives it a visible one).
  // Fail-open inside the helper: a missing toolchain never degrades session start.
  gstate.bgWindowless(cmd, args, cwd);
}

if (gstate.isDeclinedAnywhere(cwd)) {
  process.exit(0); // explicit opt-out (project OR global) — never nag
}

// Enabled — including the common case of NO record at all (default-on).
reportBgFailureIfAny();

// First time graphify auto-enables for a project with no record at all: a
// one-time (weekly-throttled), non-blocking transparency line. Not an offer —
// no interaction, nothing to confirm, just disclosure + the opt-out path.
if (gstate.isUndecided(cwd) && runOnce('ss-graphify-auto-enabled', cwdKey, { cooldownMs: 7 * 24 * 60 * 60 * 1000 })) {
  process.stdout.write(
    '[graphify] Auto-enabled for this project (knowledge-graph, token-saver). ' +
    'Disable: .claude/graphify.json {"consent":false}.\n'
  );
}

if (!graphifyInstalled()) {
  // Best-effort, windowless background install — fail-open if `uv` is absent.
  // Never blocks: the graph builds next session once the CLI lands on PATH.
  // NOTE: `graphifyy` is intentionally unpinned (no version pin) — it is a
  // first-party CLI under active development; disclosure of this tradeoff is
  // handled separately (out of scope for this fix pass).
  if (runOnce('ss-graphify-install', cwdKey, { cooldownMs: 24 * 60 * 60 * 1000 })) {
    bg('uv', ['tool', 'install', 'graphifyy']);
    process.stdout.write(
      '[graphify] Not installed yet — installing in the background (`uv tool install graphifyy`). ' +
      'The knowledge graph will build automatically once installed. Disable: .claude/graphify.json {"consent":false}.\n'
    );
  }
  process.exit(0);
}

// Installed. ONE-TIME (per project, not per-day) legacy cleanup of graphify's
// OWN git hooks — those fire a Python rebuild on every commit/checkout and pop
// a console window on Windows. devops owns freshness instead via this
// SessionStart refresh (below) and the PreToolUse self-heal
// (pre.tokens.guard.js), both windowless. This is a ONE-TIME sweep, not a
// perpetual fight: new projects are never given graphify's git hooks in the
// first place (devops never installs them), so once removed here there is
// nothing left to reintroduce them short of the user deliberately running
// `graphify hook install` again — which we must not then immediately undo.
// runOnce with no cooldownMs is checked FIRST (persistent per-project marker,
// no re-entry ever) so the ~4s `isGitRepo()` git spawn only runs the one time
// the uninstall is actually due — it must never gate every session (R7).
// Guarded/fail-open: a missing toolchain here never degrades session start.
if (runOnce('ss-graphify-hookuninstall', cwdKey) && isGitRepo()) {
  bg('graphify', ['hook', 'uninstall']);
}

// Once/24h deeper validity check (JSON.parse) beyond hasGraph()'s cheap size
// floor — a present-but-empty/corrupt graph.json must trigger a rebuild too.
const needsRebuild = !graphNudge.hasGraph(cwd)
  || graphNudge.graphIsStale(cwd)
  || (runOnce('ss-graphify-validate', cwdKey, { cooldownMs: 24 * 60 * 60 * 1000 }) && !graphLooksValid());
// Debounce bursts of SessionStart re-entries (multiple agents / worktrees on the
// same cwd) so they do not each kick a rebuild within 10 min. This is only a
// DEBOUNCE, not a mutex: on a large repo a single `graphify update` can run
// longer than the cooldown while a trigger recurs at least as often (e.g. the
// */10 git-sync cron opens a fresh session every 10 min), which previously let
// runs stack without bound. The hard concurrency guard lives in
// gstate.bgWithSentinel (a per-project PID lock) — it is what actually caps
// concurrency at one build per project across all spawn triggers.
if (needsRebuild && runOnce('ss-graphify-update', cwdKey, { cooldownMs: 10 * 60 * 1000 })) {
  gstate.bgWithSentinel('graphify', ['update', '.'], cwd); // background, key-less, AST-only, free
}
process.exit(0);
