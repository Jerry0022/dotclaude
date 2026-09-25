/**
 * @module card-turn-end
 * @version 0.1.0
 * @description End the turn at the Desktop completion-card widget — no model
 *   call after the card, so nothing can land under it.
 *
 *   The card is the last action of a turn, yet 152 of 208 Desktop card turns
 *   (0.200–0.208) still had text under the widget: a recap, an answer to the
 *   app's "[Your previous response had no visible output…]" nudge, or a closing
 *   line after a post-card step. Instructions never fixed it — the model saw
 *   "no text after the card" in the render result and in the output style and
 *   still wrote. A PostToolUse hook answering `{"continue": false}` on the
 *   widget call stops the agentic loop before the next model call: no text, no
 *   nudge (verified headless on Claude Code 2.1.281).
 *
 *   The price: after such a stop Claude Code runs no command Stop hook — only
 *   the session's in-process callbacks (`turn_end_reactions`). So this module
 *   runs the plugin's own Stop hooks first, in hooks.json order, with the Stop
 *   payload Claude Code would have sent. When one of them would block (the V&V
 *   gate, the card gate, a web hand-off offer) the turn is NOT ended: the block
 *   reason goes to Claude instead, the fix happens, and the next card widget
 *   tries again — with `stop_hook_active: true`, as Claude Code's own retry
 *   would, so a gate that already yielded once is not re-armed.
 *
 *   Never ends the turn while an orchestrator still works after its cards: an
 *   active autonomous lockout (`/do-run` AFK and backlog runs — shutdown and
 *   finalizers follow the card) or a ship queue marker (`.claude/.ship-queue`,
 *   several ships and cards in one turn). `DOTCLAUDE_CARD_HARD_STOP=0` turns it
 *   off. Fail-open: any error → the turn continues exactly as before.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { projectRoot } = require('./project-root');
const { safeReadTranscript, TRANSCRIPT_TAIL_BYTES } = require('./card-guard');
const { isPromptEntry } = require('./skill-invocations');

/** The stop notice Claude sees next turn; the Desktop stream does not carry it. */
const STOP_REASON = '[devops] Card shown — turn ended.';
/** Marks the reminder a blocked hard stop hands Claude (and finds it again). */
const BLOCKED_TAG = '[card-turn-end]';
/** Per Stop hook, and for the whole chain — a PostToolUse hook times out at 60 s. */
const HOOK_TIMEOUT_MS = 15000;
const CHAIN_BUDGET_MS = 40000;
/** A queue marker older than this belongs to a queue that died (do-ship → Composed ships). */
const QUEUE_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Absolute paths of this plugin's Stop hook scripts, in hooks.json order.
 * @param {string} pluginRoot
 * @returns {string[]}
 */
function stopHookScripts(pluginRoot) {
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8')); }
  catch { return []; }
  const groups = (json && json.hooks && Array.isArray(json.hooks.Stop)) ? json.hooks.Stop : [];
  const out = [];
  for (const g of groups) {
    for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
      const m = /hooks\/stop\/([\w.-]+\.js)/.exec(String(h && h.command || '').replace(/\\/g, '/'));
      if (m) out.push(path.join(pluginRoot, 'hooks', 'stop', m[1]));
    }
  }
  return out;
}

/** An active autonomous lockout in `dir` (read-only — never removes a stale one). */
function lockoutActive(dir) {
  try {
    const { inspectLockout } = require('../../scripts/autonomous-lockout');
    const info = inspectLockout(dir);
    return !!info && !info.stale;
  } catch {
    return false;
  }
}

/** A fresh ship queue marker in `dir/.claude`. */
function queueActive(dir, now = Date.now()) {
  try {
    const st = fs.statSync(path.join(dir, '.claude', '.ship-queue'));
    return now - st.mtimeMs < QUEUE_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Why the turn must go on after the card, or '' when it may end.
 * @param {object} hook  PostToolUse payload
 * @param {NodeJS.ProcessEnv} [env]
 */
function holdReason(hook, env = process.env) {
  if (env.DOTCLAUDE_CARD_HARD_STOP === '0') return 'disabled';
  const cwd = (hook && hook.cwd) || process.cwd();
  let root = cwd;
  try { root = projectRoot(cwd); } catch { /* keep cwd */ }
  for (const dir of new Set([cwd, root])) {
    if (lockoutActive(dir)) return 'autonomous-lockout';
    if (queueActive(dir)) return 'ship-queue';
  }
  return '';
}

/**
 * Did a hard stop already fail once in this turn? Its reminder sits in the
 * transcript after the turn's opening prompt. Claude Code tells a Stop hook
 * the same through `stop_hook_active` on the retry after a block.
 * @param {string} transcript
 */
function blockedEarlierThisTurn(transcript) {
  if (!transcript) return false;
  const lines = transcript.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type === 'user' && isPromptEntry(entry)) return false;
    if (entry.type === 'attachment' && raw.includes(BLOCKED_TAG)) return true;
  }
  return false;
}

/** The Stop payload Claude Code would have sent at this turn end. */
function stopPayload(hook, stopHookActive) {
  return {
    session_id: hook.session_id,
    transcript_path: hook.transcript_path,
    cwd: hook.cwd,
    permission_mode: hook.permission_mode,
    hook_event_name: 'Stop',
    stop_hook_active: stopHookActive,
    last_assistant_message: '',
  };
}

/**
 * A Stop hook's verdict from its process result: a block is exit 2 (reason on
 * stderr), `decision: "block"`, or `continue: false` on stdout.
 * @returns {string|null} the block reason, or null when the hook let the turn end
 */
function blockReason(res) {
  if (!res) return null;
  if (res.status === 2) return String(res.stderr || '').trim() || 'Stop hook blocked (exit 2)';
  const out = String(res.stdout || '').trim();
  if (!out.startsWith('{')) return null;
  try {
    const json = JSON.parse(out);
    if (json && json.decision === 'block') return String(json.reason || 'Stop hook blocked');
    if (json && json.continue === false) return String(json.stopReason || 'Stop hook stopped the turn');
  } catch { /* not a verdict */ }
  return null;
}

/**
 * Run the plugin's Stop hooks for this turn and decide.
 * @param {object} hook  PostToolUse payload of the card widget call
 * @param {{ pluginRoot?: string, env?: NodeJS.ProcessEnv, run?: Function, now?: Function }} [opts]
 * @returns {{ end: boolean, reason?: string, hook?: string, hold?: string }}
 *   end: true → answer `{continue:false}`; a `reason` → a Stop hook blocked;
 *   `hold` → an orchestrator or the opt-out keeps the turn going.
 */
function decideCardTurnEnd(hook, opts = {}) {
  const env = opts.env || process.env;
  const hold = holdReason(hook, env);
  if (hold) return { end: false, hold };
  const pluginRoot = opts.pluginRoot || env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
  const scripts = stopHookScripts(pluginRoot);
  if (!scripts.length) return { end: false, hold: 'no-stop-hooks' };

  const transcript = safeReadTranscript(hook.transcript_path, TRANSCRIPT_TAIL_BYTES);
  const input = JSON.stringify(stopPayload(hook, blockedEarlierThisTurn(transcript)));
  const run = opts.run || ((script) => spawnSync(process.execPath, [script], {
    input,
    cwd: hook.cwd || process.cwd(),
    env,
    encoding: 'utf8',
    timeout: HOOK_TIMEOUT_MS,
    windowsHide: true,
  }));
  const now = opts.now || Date.now;
  const started = now();
  for (const script of scripts) {
    if (now() - started > CHAIN_BUDGET_MS) return { end: false, hold: 'budget' };
    const res = run(script, input);
    if (res && res.error && res.status === null) return { end: false, hold: 'spawn-failed' };
    const reason = blockReason(res);
    if (reason) return { end: false, reason, hook: path.basename(script, '.js') };
  }
  return { end: true };
}

/** The reminder that replaces the hard stop when a Stop hook blocked it. */
function blockedLines(decision) {
  return [
    `${BLOCKED_TAG} Card shown, but the turn cannot end yet — ${decision.hook || 'a Stop hook'} reports:`,
    String(decision.reason || '').trim(),
    'Fix that now (no text about it), then render and show the corrected card — that one ends the turn.',
  ];
}

module.exports = {
  STOP_REASON,
  BLOCKED_TAG,
  stopHookScripts,
  holdReason,
  blockedEarlierThisTurn,
  stopPayload,
  blockReason,
  decideCardTurnEnd,
  blockedLines,
};
