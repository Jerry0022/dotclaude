#!/usr/bin/env node
/**
 * @hook ss.knowledge.index
 * @version 0.7.0
 * @event SessionStart
 * @plugin devops
 * @description Inject deep-knowledge INDEX.md into context at session start,
 *   plus the always-on policy docs in full (ALWAYS_ON below). The index gives
 *   Claude awareness of all reference docs before message #1; the always-on
 *   docs are behavioral rules that must hold on every prompt — a pull-only
 *   reference would never flip the harness default they override (e.g. the
 *   agent delegation tiers). Fires on startup/clear/compact; on resume it
 *   emits only a fresh budget line (the one part that ages).
 *   Uses run-once to prevent duplicate injection within a session.
 *   The delegation kill-switch (lib/delegation.js) decides whether the
 *   policy body is injected at all: `off` replaces it with the one-line
 *   `[delegation] off …` state (no need to preload 5 KB of tiers that must
 *   not be applied); `ask`/`auto` inject the policy and the line.
 *   The index header carries the literal `{PLUGIN_ROOT} = <abs>` line
 *   (lib/plugin-root): the placeholder is never substituted and
 *   $CLAUDE_PLUGIN_ROOT is unset in the Bash tool, so without it the model
 *   searched `/` for plugin docs (2026-09-24).
 */

const { runOnce } = require('../lib/run-once');
const { readBudget, maybeRefreshUsage, budgetLine } = require('../lib/budget');
const { readDelegation, delegationLine } = require('../lib/delegation');
const { pluginRootLine } = require('../lib/plugin-root');
const fs = require('fs');
const path = require('path');

/**
 * Deep-knowledge files injected IN FULL at every session start. Keep this
 * list short and each file small — the byte cap below is the hard guard.
 * `prompt.knowledge.dispatch` must NOT list these (they are already loaded).
 */
const ALWAYS_ON = ['agent-proactivity.md'];

// Hard limit on the always-on payload so a growing policy doc cannot bloat
// every session's preload. Files past the cap are skipped, index still goes.
// 6 KB → 7 KB on 2026-09-20: the budget section gained the "newest [budget]
// line is the class" rule (the limit-reset incident); ~1.7k tokens per session.
const MAX_ALWAYS_ON_BYTES = 7168;

/**
 * Build the additionalContext string for a plugin root, or null when there
 * is nothing to inject. Pure — no session/run-once state — so tests can
 * pin the payload shape.
 */
function buildContext(pluginRoot, sessionId = null, cwd = process.cwd()) {
  const dkDir = path.join(pluginRoot, 'deep-knowledge');
  const delegation = readDelegation({ cwd });
  const indexPath = path.join(dkDir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) return null;

  const blocks = [
    '[deep-knowledge] The following reference docs are available.',
    'Read individual files from deep-knowledge/ when a topic is relevant to the task.',
    pluginRootLine(pluginRoot),
    '',
    fs.readFileSync(indexPath, 'utf8').trim(),
  ];

  let bytes = 0;
  for (const file of ALWAYS_ON) {
    if (delegation.mode === 'off') break; // the switch line below replaces the policy
    const filePath = path.join(dkDir, file);
    let content;
    try { content = fs.readFileSync(filePath, 'utf8').trim(); }
    catch { continue; }
    const entryBytes = Buffer.byteLength(content, 'utf8');
    if (bytes + entryBytes > MAX_ALWAYS_ON_BYTES) continue;
    bytes += entryBytes;
    blocks.push(
      '',
      `[deep-knowledge always-on] deep-knowledge/${file} — a standing plugin instruction, in effect for every prompt (it counts as the plugin asking):`,
      '',
      content,
    );
  }

  // Kill-switch state, then budget class — the policy's fourth input (see
  // lib/budget.js). One line each, always present, so "off" and "unknown"
  // are visible rather than silently assumed. A snapshot past its reset
  // (the morning-after Desktop session) starts a detached refresh, like the
  // completion card would — the per-prompt line then carries the live class.
  blocks.push('', delegationLine(delegation));
  try {
    const budget = readBudget({ sessionId });
    budget.refreshing = maybeRefreshUsage(budget, { pluginRoot });
    blocks.push(budgetLine(budget));
  } catch { /* never let the budget probe break the index injection */ }

  return blocks.join('\n');
}

/**
 * The resume payload: only the budget line, freshly read (plus the detached
 * refresh when the snapshot is past its reset). Null when the probe fails —
 * a resume must never fail on the budget.
 */
function buildResumeContext(pluginRoot, sessionId = null) {
  try {
    const budget = readBudget({ sessionId });
    budget.refreshing = maybeRefreshUsage(budget, { pluginRoot });
    return budgetLine(budget);
  } catch { return null; }
}

function main() {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook;
    try { hook = JSON.parse(inputData); }
    catch { process.exit(0); }

    const source = hook.source || hook.trigger || '';
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
      || path.resolve(__dirname, '..', '..');

    // Resume — index + policies are still in context from startup, but the
    // budget line in there is as old as that startup: a session resumed after
    // a limit hit must not inherit "sonnet-only" from last night. Emit only
    // the budget line (no run-once: every resume is a new reading).
    const additionalContext = source === 'resume'
      ? buildResumeContext(pluginRoot, hook.session_id)
      : (
        // Run-once guard per session. Compaction keeps the session_id but drops
        // the earlier injection from context (redteam 2026-09-14 #3) — so a
        // `compact` start always re-injects; startup/clear go through run-once.
        (source !== 'compact' && !runOnce('ss-knowledge-index', hook.session_id))
          ? null
          : buildContext(pluginRoot, hook.session_id, hook.cwd || process.cwd())
      );
    if (!additionalContext) process.exit(0);

    // Output as additionalContext (discrete injection, not visible in transcript)
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    };

    process.stdout.write(JSON.stringify(output));
  });
}

if (require.main === module) {
  require('../lib/plugin-guard');
  main();
}

module.exports = { buildContext, buildResumeContext, ALWAYS_ON, MAX_ALWAYS_ON_BYTES };
