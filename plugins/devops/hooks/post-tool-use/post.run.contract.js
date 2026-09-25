#!/usr/bin/env node
/**
 * @hook post.run.contract
 * @version 0.3.0
 * @event PostToolUse
 * @plugin devops
 * @matcher AskUserQuestion|Skill|Agent|Edit|Write|NotebookEdit|Bash|PowerShell|mcp__plugin_devops_dotclaude-ship__ship_release|mcp__plugin_devops_dotclaude-completion__render_completion_card|mcp__.*__merge_pull_request
 * @description Record what happened for the do-run RUN CONTRACT (spec A
 *   events, B arming, E batch marker, H closing):
 *   - AskUserQuestion: router answers arm a new contract (and clear the arm
 *     marker); follow-up answers (Issues, Milestones, Ergebnis, PC danach)
 *     update the active one.
 *   - Skill: `skill` event; `do-run` writes the arm marker; `do-run` /
 *     `auto-concept` clear the do-batch hand-off marker.
 *   - Agent → `agent`; Edit/Write/NotebookEdit on a gated path → `edit`;
 *     Bash/PowerShell `git commit` → `commit`, branch creation → `branch`
 *     (PostToolUse only fires for successful calls; an interrupted call or a
 *     non-zero exit code in tool_response records neither).
 *   - ship_release → `release` {ok, merged, closes}; a backlog contract closes
 *     once every item shipped or was parked (an obligation skip never
 *     finishes an item).
 *   - GitHub MCP `*__merge_pull_request` (AUD-025) → `release` too, mirroring
 *     ship_release: `ok` from the tool's own `{merged}` result shape, `closes`
 *     from `Closes #N` in the commit title/message or the response text —
 *     pre.run.contract gates this call as a release; without this handler the
 *     contract never saw that the ship happened.
 *   - completion card (MCP or offline renderer) → `card`; a final card closes
 *     a prompt / audit contract (its PreToolUse gate already passed). An
 *     `analysis` card (AUD-012) is never a final variant — the PreToolUse
 *     gate never refuses it — but still closes an AUDIT run. An offline card
 *     post cannot read closes only with work done and nothing open at the
 *     card gate.
 *   - A partial router call arms after a do-run, else merges into this
 *     session's active contract, else says it was not recorded. This
 *     session's contract expired unclosed → one notice.
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
    // RT3-R1: only `park N` finishes an item — an obligation skip
    // (`skip refine --item N`) satisfies that obligation, never the item.
    if (ev.k === 'park' && ev.item) closed.add(String(ev.item));
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

function recordCard(root, variant, final, RC, s, { unreadable = false } = {}) {
  RC.record(root, { k: 'card', variant: variant || null }, s);
  // AUD-012: `analysis` is deliberately NOT in FINAL_VARIANTS — the
  // PreToolUse gate must never refuse an analysis card — but a run ending on
  // one must still close, else an AUDIT run never closes. Prompt/backlog
  // runs are unaffected: an analysis card there is recorded but closes nothing.
  if (variant === 'analysis') {
    const h = RC.readContract(root, s);
    if (h && h.mode === 'audit') RC.close(root, 'done: final card', s);
    return;
  }
  // H-B8: the close follows from the card being final and the contract's
  // mode — not from the append succeeding (a card that was shown but whose
  // event could not be written still ends a prompt / audit run).
  if (!final) return;
  const h = RC.readContract(root, s);
  if (!h || (h.mode !== 'prompt' && h.mode !== 'audit')) return;
  // RT3-R2: an offline card whose payload post cannot read (`-`, `$p`, a file
  // deleted in the same command) may be an interim card pre let through —
  // it closes only where a final card could have passed: the contract did
  // work and nothing is open at the card gate.
  if (unreadable) {
    const evs = RC.events(root);
    if (!RC.segmentHasWork(evs) || RC.openObligations(h, evs, 'card').length) return;
  }
  RC.close(root, 'done: final card', s);
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
  // RT3-R8: for a partial call (1) a fresh do-run marker → a new run → arm;
  // (2) else this session's active contract (any age) → merge; (3) else the
  // answer is dropped — said so, with the re-arm line.
  if (!fields) return null;
  const partial = RC.isPartialRouterCall(questions);
  if (partial && !marker && !RC.mergeRouterAnswers(root, questions, fields, s)) {
    return `[run-contract] These do-run answers were NOT recorded: no do-run just ran and this session has no active run contract. To gate this run, arm it: ${RC.rearmHint()}`;
  }
  // A failed write must not delete the marker (AUD-001): keep it so the
  // next gated call's pre-hook fallback arm can retry.
  if (!partial || marker) {
    if (RC.arm(root, { ...fields, source: 'router', sessionId })) RC.clearPendingArm(root);
  }
  return null;
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
  // RT3-X1: a non-zero exit fires PostToolUseFailure, not this hook; an
  // interrupt or a (legacy) non-zero exit code in tool_response still skips.
  const { normalizeToolResponse } = require('../lib/browsertest-guard');
  const r = normalizeToolResponse(hook.tool_response);
  const failed = r.interrupted || (r.exitCode !== null && r.exitCode !== 0);
  if (f.commit && !failed) RC.record(root, { k: 'commit' }, s);
  if (f.itemBranch && !failed) RC.record(root, { k: 'branch', name: f.branchName }, s);
  if (f.card) recordCard(root, f.card.variant, f.card.final, RC, s, { unreadable: f.card.readable === false });
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

/**
 * AUD-025: a GitHub MCP `merge_pull_request` is gated as a release by
 * pre.run.contract (C.MCP_MERGE_RE) but was never recorded here — the
 * contract could not see that ship happened. Mirrors onRelease(): `ok` from
 * the merge result (GitHub's own `{merged}` shape, C.mergeResult — not
 * ship_release's `{success}` one), `closes` from `Closes #N` in the commit
 * title/message the caller passed or the tool's own response text; a
 * finished backlog closes the same way a ship_release does.
 */
function onMcpMerge({ input, roots, sessionId, s, RC, C, hook }) {
  const r = contractRootOf(roots, RC, sessionId);
  const res = C.mergeResult(hook.tool_response) || { ok: false };
  // Closes #N can be in the caller's commit title/message or the tool's own
  // response text (GitHub echoes the merge commit's message back).
  const text = [input.commit_title, input.commit_message, C.responseText(hook.tool_response)]
    .filter(v => typeof v === 'string' && v).join('\n');
  const closes = C.closesOf(text);
  RC.record(r, { k: 'release', ok: res.ok, merged: res.ok, closes }, s);
  const h = RC.readContract(r, s);
  if (h && backlogFinished(h, RC.events(r))) RC.close(r, 'done: every queued item shipped', s);
}

function handlerFor(tool, C) {
  if (tool === 'AskUserQuestion') return onAsk;
  if (tool === 'Skill') return onSkill;
  // AUD-020: the description is recorded (shortened) so run-contract-
  // obligations.js's isTriageAgent() can tell a real pre-triage agent call
  // apart from an unrelated one (e.g. an Explore search).
  if (tool === 'Agent') {
    return ({ input, root, s, RC }) => {
      const { short } = require('../lib/run-contract-obligations');
      const description = short(input.description || '', 120);
      RC.record(root, { k: 'agent', type: input.subagent_type || 'general-purpose', description }, s);
    };
  }
  if (C.EDIT_TOOLS.has(tool)) {
    return ({ input, cwd, root, s, RC }) => { if (C.isGatedEdit(tool, input, root, cwd)) RC.record(root, { k: 'edit' }, s); };
  }
  if (C.SHELL_TOOLS.has(tool)) return onShell;
  if (tool === C.SHIP_RELEASE) return onRelease;
  if (tool === C.RENDER_CARD) return onCard;
  if (C.MCP_MERGE_RE.test(tool)) return onMcpMerge;
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
  // RT3-X2: read before the handler — its first write archives the expired header.
  const expired = RC.expiryNotice(root, s);
  const note = handler({ hook, input: C.toolInput(hook), cwd, root, roots, sessionId, s, RC, C });
  const ctxOut = (text) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
  if (typeof note === 'string' && note) return ctxOut(note);

  let h = RC.readContract(root, s);
  // H-C5: an item parked AFTER the last release also finishes the backlog —
  // not only a ship_release.
  if (h && tool !== C.SHIP_RELEASE && backlogFinished(h, RC.events(root))) {
    RC.close(root, 'done: every queued item shipped', s);
    h = RC.readContract(root, s);
  }
  if (h && (h.source === 'fallback' || h.source === 'machine') && !h.announced) {
    if (RC.update(root, { announced: true }, s)) return ctxOut(announcement(h, RC));
  }
  if (expired && !h) return ctxOut(expired);
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

module.exports = { backlogFinished, recordCard, onAsk, onSkill, onShell, onRelease, onCard, onMcpMerge, main };
