#!/usr/bin/env node
/**
 * @hook post.run.contract
 * @version 0.2.0
 * @event PostToolUse
 * @plugin devops
 * @matcher AskUserQuestion|Skill|Agent|Edit|Write|NotebookEdit|Bash|PowerShell|mcp__plugin_devops_dotclaude-ship__ship_release|mcp__plugin_devops_dotclaude-completion__render_completion_card
 * @description Record what happened for the do-run RUN CONTRACT (spec A
 *   events, B arming, E batch marker, H closing):
 *   - AskUserQuestion: router answers arm a new contract (and clear the arm
 *     marker); follow-up answers (Issues, Milestones, Ergebnis, PC danach)
 *     update the active one.
 *   - Skill: `skill` event; `do-run` writes the arm marker; `do-run` /
 *     `auto-concept` clear the do-batch hand-off marker.
 *   - Agent → `agent`; Edit/Write/NotebookEdit on a gated path → `edit`;
 *     Bash/PowerShell `git commit` → `commit`, branch creation → `branch`
 *     (PostToolUse only fires for successful calls).
 *   - ship_release → `release` {ok, merged, closes}; a backlog contract closes
 *     once every item shipped or was skipped.
 *   - completion card (MCP or offline renderer) → `card`; a final card closes
 *     a prompt / audit contract (its PreToolUse gate already passed).
 *   A contract armed from `fallback` or `machine` is announced once via
 *   additionalContext. Never fails the tool call; kill switch
 *   DOTCLAUDE_RUN_CONTRACT=off.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

function announcement(h, RC) {
  const from = h.source === 'machine' ? 'a machine prompt (autostart)' : 'the click-through defaults — the do-run answers were not found';
  return [
    `[run-contract] A run contract was armed from ${from}: ${RC.chosenLine(h)}.`,
    'Its gates now refuse edits, commits, ship_release and final cards that walk past an open obligation.',
    `Wrong choice? Re-arm: ${RC.rearmHint()}`,
    `Not a run at all: node "${RC.LIB_PATH}" done`,
  ].join('\n');
}

function backlogFinished(h, evs) {
  if (h.mode !== 'backlog' || !Array.isArray(h.items) || !h.items.length) return false;
  const closed = new Set();
  for (const ev of evs) {
    if (ev.k === 'release' && ev.ok === true && Array.isArray(ev.closes)) ev.closes.forEach(n => closed.add(String(n)));
    if ((ev.k === 'skip' || ev.k === 'park') && ev.item) closed.add(String(ev.item));
  }
  return h.items.every(n => closed.has(String(n)));
}

/** Did the current turn open with a machine prompt (R1)? */
function machineTurn(hook, C) {
  if (typeof hook.transcript_path !== 'string' || !hook.transcript_path) return false;
  try {
    const { lastUserPromptText } = require('../lib/skill-invocations');
    return C.MACHINE_TURN_RE.test(lastUserPromptText(C.readTail(hook.transcript_path)) || '');
  } catch { return false; }
}

function recordCard(root, variant, final, RC, s) {
  RC.record(root, { k: 'card', variant: variant || null }, s);
  // H-B8: the close follows from the card being final and the contract's
  // mode — not from the append succeeding (a card that was shown but whose
  // event could not be written still ends a prompt / audit run).
  if (!final) return;
  const h = RC.readContract(root, s);
  if (h && (h.mode === 'prompt' || h.mode === 'audit')) RC.close(root, 'done: final card', s);
}

/** H-B1: the first of `roots` holding this session's contract (claimed on the way), else the session root. */
function contractRootOf(roots, RC, sessionId) {
  for (const r of roots) {
    RC.claim(r, sessionId);
    if (RC.readContract(r, { sessionId })) return r;
  }
  return roots[0];
}

// H-D15: one handler per tool kind. Each gets the call context
// `{hook, input, cwd, root, roots, sessionId, s, RC, C}`.

/** Router answers arm (or merge into) a contract; follow-up answers patch it. */
function onAsk({ hook, input, root, sessionId, s, RC }) {
  const { questions, answers } = RC.extractAnswers(hook.tool_response, input);
  if (!RC.isRouterCall(questions)) {
    // "Run fortsetzen" answered → the resume path asks no router questions.
    if (RC.hasHeader(questions, 'Fortsetzen') && RC.pendingArm(root, s)) RC.clearPendingArm(root);
    const patch = RC.parseFollowUp(questions, answers);
    if (patch) RC.applyFollowUp(root, patch, s);
    return;
  }
  const marker = RC.pendingArm(root, s);
  const fields = RC.parseRouterAnswers(questions, answers, { doRunArgs: marker && marker.args });
  // A partial router call (only some headers) merges into this session's
  // fresh contract instead of re-arming with defaults (R7). H-B13: with no
  // merge target it arms only after a do-run (fresh same-session arm
  // marker) — a model-written Flow + Scope / Passes question elsewhere never
  // arms. A FULL router call (Ablauf + Umfang + Durchgänge) is do-run's own
  // signature and arms with or without the marker.
  const partial = RC.isPartialRouterCall(questions);
  if (fields && !RC.mergeRouterAnswers(root, questions, fields, s) && (!partial || marker)) {
    // A failed write must not delete the marker (AUD-001): keep it so the
    // next gated call's pre-hook fallback arm can retry.
    if (RC.arm(root, { ...fields, source: 'router', sessionId })) RC.clearPendingArm(root);
  }
}

/** `skill` event; do-run writes the arm marker; do-run / auto-concept take over a batch hand-off. */
function onSkill({ hook, input, root, sessionId, s, RC, C }) {
  const name = RC.skillName(input.skill || input.name);
  const args = typeof input.args === 'string' ? input.args : '';
  if (name === 'do-run' && !machineTurn(hook, C)) RC.markPendingArm(root, { sessionId, args });
  if ((name === 'do-run' || name === 'auto-concept') && RC.batchHandoffPending(root, s)) RC.clearBatchHandoff(root);
  RC.record(root, { k: 'skill', name, args }, s);
}

/** `commit`, item `branch` and an offline `--render-card` card (H-A2: the facts pre gated on). */
function onShell({ hook, cwd, root, s, RC, C }) {
  const f = C.shellCallFacts(hook, root, cwd, { after: true });
  if (f.commit) RC.record(root, { k: 'commit' }, s);
  if (f.itemBranch) RC.record(root, { k: 'branch', name: f.branchName }, s);
  if (f.card) recordCard(root, f.card.variant, f.card.final, RC, s);
}

/** `release` in the contract's root (ship_release acts on tool_input.cwd); a finished backlog closes. */
function onRelease({ hook, input, roots, sessionId, s, RC, C }) {
  const r = contractRootOf(roots, RC, sessionId);
  const res = C.releaseResult(hook.tool_response) || { ok: false, merged: false };
  RC.record(r, { k: 'release', ok: res.ok, merged: res.merged, closes: C.closesOf(input.body) }, s);
  const h = RC.readContract(r, s);
  if (h && backlogFinished(h, RC.events(r))) RC.close(r, 'done: every queued item shipped', s);
}

/** H-B1: the MCP card takes `cwd` too — recorded and closed where pre gated it. */
function onCard({ input, roots, sessionId, s, RC, C }) {
  const cf = C.cardFacts(input);
  recordCard(contractRootOf(roots, RC, sessionId), cf.variant, cf.final, RC, s);
}

function handlerFor(tool, C) {
  if (tool === 'AskUserQuestion') return onAsk;
  if (tool === 'Skill') return onSkill;
  if (tool === 'Agent') return ({ input, root, s, RC }) => RC.record(root, { k: 'agent', type: input.subagent_type || 'general-purpose' }, s);
  if (C.EDIT_TOOLS.has(tool)) {
    return ({ input, cwd, root, s, RC }) => { if (C.isGatedEdit(tool, input, root, cwd)) RC.record(root, { k: 'edit' }, s); };
  }
  if (C.SHELL_TOOLS.has(tool)) return onShell;
  if (tool === C.SHIP_RELEASE) return onRelease;
  if (tool === C.RENDER_CARD) return onCard;
  return null;
}

function main(hook) {
  const cwd = hook.cwd || process.cwd();
  // H-B17: required here, inside the stdin handler's try/catch.
  const { projectRoot } = require('../lib/project-root');
  const C = require('../lib/run-contract-calls');
  // H-B1: the same root choice as pre (session root, then tool_input.cwd's
  // root for the MCP tools).
  const { root, roots } = C.contractRoots(hook, projectRoot);
  const tool = hook.tool_name || '';
  // Fast path: only AskUserQuestion (arming) and Skill (arm / batch markers)
  // can matter without a contract on disk.
  if (tool !== 'AskUserQuestion' && tool !== 'Skill'
    && !roots.some(r => fs.existsSync(path.join(r, '.claude', 'run-contract.json')))) return null;
  const RC = require('../lib/run-contract');
  if (RC.disabled()) return null;
  const handler = handlerFor(tool, C);
  if (!handler) return null;
  const sessionId = hook.session_id || null;
  const s = { sessionId };
  RC.claim(root, sessionId);
  handler({ hook, input: C.toolInput(hook), cwd, root, roots, sessionId, s, RC, C });

  let h = RC.readContract(root, s);
  // H-C5: an item parked / skipped (run-contract CLI, a Bash call) AFTER the
  // last release also finishes the backlog — not only a ship_release.
  if (h && tool !== C.SHIP_RELEASE && backlogFinished(h, RC.events(root))) {
    RC.close(root, 'done: every queued item shipped', s);
    h = RC.readContract(root, s);
  }
  if (h && (h.source === 'fallback' || h.source === 'machine') && !h.announced) {
    if (RC.update(root, { announced: true }, s)) {
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: announcement(h, RC) } });
    }
  }
  return null;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const { parseHookInput } = require('../lib/hook-input');
      const hook = parseHookInput(inputData);
      if (!hook) process.exit(0);
      const out = main(hook);
      if (out) process.stdout.write(`${out}\n`);
    } catch { /* never surfaces as a hook failure */ }
    process.exit(0);
  });
}

module.exports = { backlogFinished, recordCard, onAsk, onSkill, onShell, onRelease, onCard, main };
