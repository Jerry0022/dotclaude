#!/usr/bin/env node
/**
 * @hook pre.run.contract
 * @version 0.4.4
 * @event PreToolUse
 * @plugin devops
 * @matcher Edit|Write|NotebookEdit|Bash|PowerShell|Skill|mcp__plugin_devops_dotclaude-ship__ship_release|mcp__plugin_devops_dotclaude-completion__render_completion_card
 * @description Refuse (exit 2) the tool call that would walk past an open
 *   obligation of the do-run RUN CONTRACT, or past a pending do-batch
 *   hand-off. Spec: docs/superpowers/specs/2026-09-24-run-contract-design.md
 *   (B fallback arm, D gates, E batch hand-off).
 *
 *   Gates: Edit/Write/NotebookEdit on a gated path and `git commit` →
 *   auto-agents + batch hand-off · branch creation (backlog) → the left
 *   segment's harden/polish/qa/do-ship · first Skill auto-agents (backlog) →
 *   triage · ship_release → everything incl. refine · a final completion card
 *   (MCP or the offline `--render-card <payload.json>` renderer) → auto-agents,
 *   harden, polish, qa, do-ship. Under ship: auto a shell release (`gh pr
 *   merge`, `gh api -X PUT …/pulls/N/merge`, a push onto main / master, a
 *   push of the current branch while that is main / master) and a GitHub MCP
 *   `*__merge_pull_request` call hit the release gate too (RT3-R4).
 *
 *   Fast path: none of run-contract.json / run-contract.pending /
 *   batch-handoff.json / run-contract.json.corrupt.pending in the work-tree
 *   root (lib/run-contract-store.js hasState) → exit 0 before loading the lib.
 *   qa counts changed code files from git only at release / card / branch
 *   gates, via lib/run-contract-qa.js (shared with the CLI, AUD-010); any git
 *   failure or an expired gitBudget means unknown and never blocks (AUD-019:
 *   one 15 s budget bounds the whole call's git chain, not just one call).
 *   An internal error never blocks. Kill switch: DOTCLAUDE_RUN_CONTRACT=off.
 *   Stdin, parsing and the reply go through lib/hook-input.js's runHook;
 *   main() walks the numbered steps 1–7 below in order.
 */

require('../lib/plugin-guard');

function batchBlock(RC) {
  return [
    '[run-contract] BLOCKED: a do-batch plan is waiting for its hand-off.',
    'A ready plan goes to Skill("devops:do-run", "--from=do-batch …"), a plan with',
    'open decisions to Skill("devops:auto-concept", "--from=do-batch …") — never',
    'implemented directly. Reading, exploring and planning stay allowed.',
    `Stale marker / not a do-batch hand-off: node "${RC.LIB_PATH}" batch-clear --reason "<why>"`,
    'Kill switch (every run-contract gate): DOTCLAUDE_RUN_CONTRACT=off',
  ].join('\n');
}

// AUD-019: one deadline for a whole gated call's git chain (base resolution,
// up to two diff attempts, ls-files, the release count and the pushHead
// branch check) — comfortably under the 60 s worst case the audit measured
// when each call re-armed its own 3-5 s timeout independently. R13: this
// ceiling now lives in git-timeout.js (TOTAL_GIT_BUDGET_MS) so the CLI's
// measureQa() shares it instead of falling back to a 5 s default.

/**
 * RT3-R4: is the work tree's current branch main / master? Asked only for a
 * `pushHead` call under ship: auto; a git failure or timeout means no (the
 * gate never blocks on unknown).
 * @param {object} [budget] shares the call's gitBudget() (AUD-019)
 * @param {number} [fallbackTimeoutMs] used only when no shared budget is
 *   given — H8: the caller passes git-timeout's SMALL_GIT_BUDGET_MS (it is
 *   required lazily inside main(), H-B17, so this module-scope function
 *   cannot reach for the constant itself).
 */
function onMainBranch(root, C, budget, fallbackTimeoutMs) {
  try {
    const opts = budget ? { budget } : { timeout: fallbackTimeoutMs };
    const b = C.gitLines(root, ['rev-parse', '--abbrev-ref', 'HEAD'], opts)[0];
    return b === 'main' || b === 'master';
  } catch { return false; }
}

/** The gates this call hits: {gates:[], batch:boolean, closes, base}. */
function classify(hook, root, cwd, C) {
  const tool = hook.tool_name || '';
  const input = C.toolInput(hook);
  if (C.EDIT_TOOLS.has(tool)) {
    return C.isGatedEdit(tool, input, root, cwd) ? { gates: ['edit'], batch: true } : null;
  }
  if (C.SHELL_TOOLS.has(tool)) {
    const f = C.shellCallFacts(hook, root, cwd, { after: false });
    const gates = [];
    if (f.commit) gates.push('commit');
    if (f.itemBranch) gates.push('branch');
    if (f.card && f.card.final) gates.push('card');
    // gh pr merge / git push onto main|master → release gate (ship: auto only).
    if (f.release) gates.push('release');
    // RT3-R4: a push of the current branch is a release only on main / master (asked in main()).
    if (gates.length || f.pushHead) return { gates, batch: f.commit, shellRelease: true, pushHead: f.pushHead && !f.release };
    return null;
  }
  // RT3-R4: a GitHub MCP merge is a release, gated like a shell one (ship: auto only).
  if (C.MCP_MERGE_RE.test(tool)) return { gates: ['release'], batch: false, shellRelease: true };
  if (tool === 'Skill') {
    const RC = require('../lib/run-contract');
    return RC.skillName(input.skill || input.name) === 'auto-agents' ? { gates: ['auto-agents'], batch: false } : null;
  }
  if (tool === C.SHIP_RELEASE) {
    return { gates: ['release'], batch: false, closes: C.closesOf(input.body), base: input.base };
  }
  if (tool === C.RENDER_CARD) {
    return C.cardFacts(input).final ? { gates: ['card'], batch: false } : null;
  }
  return null;
}

/**
 * Spec B: a do-run started but its answers were never recorded — arm now.
 * @param {object} [budget] R12: the invocation's one overall deadline
 *   (git-timeout's gitBudget) — also bounds the transcript walk, not just
 *   the git chain that follows.
 */
function armFromPending(hook, root, RC, C, sessionId, budget) {
  const marker = RC.pendingArm(root, { sessionId });
  if (!marker) return null;
  // R1: a do-run that skipped the router (resume, machine prompt, backlog's
  // own sub-run) never replaces the contract the user already chose.
  if (RC.readContract(root, { sessionId })) { RC.clearPendingArm(root); return null; }
  const info = { stoppedOnBudget: false };
  const found = C.routerFromTranscript(hook.transcript_path, marker.at, RC, budget, info);
  // R2 (red-team round 2 Q5): the budget cut the transcript walk short — arming
  // now would either use an incomplete router chain (found but partial) or
  // fall through to the click-through defaults though the real answers may
  // still be further back. Neither is the user's actual choice, so this call
  // arms nothing and — critically — keeps the marker: the NEXT gated call
  // (a fresh budget) retries the walk instead of silently losing the arm.
  if (info.stoppedOnBudget) return null;
  let fields = null;
  let source = 'router';
  if (found) {
    // H-C2c: a partial re-ask merges over the full answers before it — only
    // the fields it answered replace them (R7, like mergeRouterAnswers).
    for (const call of [...(found.earlier || []), found]) {
      const f = RC.parseRouterAnswers(call.questions, call.answers, { doRunArgs: marker.args });
      if (f) fields = fields ? { ...fields, ...RC.answeredFields(f) } : f;
    }
  }
  if (!fields) {
    source = 'fallback';
    // The click-through defaults: parse an empty Q4 whose options carry the
    // recommended passes; the do-run args still set a preset mode.
    const q4 = { header: 'Durchgänge?', question: 'Durchgänge?', options: [{ label: 'Harden danach (Recommended)' }, { label: 'Polish danach (Recommended)' }] };
    fields = RC.parseRouterAnswers([q4], {}, { doRunArgs: marker.args });
  }
  const h = RC.arm(root, { ...fields, source, sessionId: sessionId || marker.sessionId || null });
  // A failed write must not delete the marker (AUD-001): keep it so the next
  // gated call retries this same fallback arm.
  if (!h) return null;
  RC.clearPendingArm(root);
  if (found) for (const patch of found.followUps) RC.applyFollowUp(root, patch, { sessionId });
  return { source };
}

/**
 * 1. The call's two replies (runHook sends them: `{context}` → exit 0,
 * `{block}` → exit 2). R5: the corrupt/expiry one-shot notice rides both,
 * independent of whether this call hits a gate — PreToolUse never blocks on
 * it (H-F20). R2 (red-team round 2 Q6): the notice is consumed (one-shot),
 * but must NOT go to stdout on a refusal — Claude Code ignores stdout on an
 * exit-2 hook result, so it would be lost on every gate this same call hits.
 * `ok()` carries it as additionalContext on the exit-0 paths; `blocked()`
 * appends it to the stderr block instead.
 * H9: expiryNotice() is read lazily, AT REPLY TIME (inside ok()/blocked()),
 * not once up front — a call whose own RC.readContract() discovers a corrupt
 * run-contract.json quarantines it AND writes the one-shot marker DURING this
 * same call; reading the notice before that point (the old behaviour) always
 * missed it, so it only ever surfaced on the NEXT gated call. Every return
 * path of main() after the fast path goes through ok()/blocked(), so the
 * notice is still delivered exactly once, whichever path returns.
 */
function replies(RC, root, sessionId) {
  const notice = () => RC.expiryNotice(root, { sessionId });
  return {
    ok() {
      const n = notice();
      return n ? { context: n } : null;
    },
    blocked(msg) {
      const n = notice();
      return { block: `${msg}${n ? `\n\n${n}` : ''}` };
    },
  };
}

/**
 * 2. A do-batch plan waits for its hand-off (spec E): an implementing call
 * is refused. → the block text, or null.
 */
function batchRefusal(call, root, RC, sessionId) {
  if (!call.batch || !RC.batchHandoffPending(root, { sessionId })) return null;
  // AUD-004: a refused call leaves a lasting trace. A no-op when no
  // contract is active yet (record() needs one) — the batch marker itself
  // is that trace then.
  RC.record(root, { k: 'block', gate: 'batch', open: [] }, { sessionId });
  return batchBlock(RC);
}

/**
 * 4. H-B1: the first of `roots` holding this session's contract (claimed on
 * the way). → {croot, contract} | null
 */
function sessionContract(roots, RC, sessionId) {
  for (const r of roots) {
    RC.claim(r, sessionId);
    const contract = RC.readContract(r, { sessionId });
    if (contract) return { croot: r, contract };
  }
  return null;
}

/**
 * 5. RT3-R4: a push of the current branch is a release under ship: auto
 * when that branch is main / master — adds the release gate to `call`.
 * AUD-019: the call's shared deadline also bounds this branch check — an
 * expired budget reads as unknown (never a block), it just stops asking git.
 */
function promotePushHead(call, contract, root, C, budget, fallbackTimeoutMs) {
  if (call.pushHead && contract.ship === 'auto' && !call.gates.includes('release') && onMainBranch(root, C, budget, fallbackTimeoutMs)) {
    call.gates.push('release');
  }
}

/**
 * 6. H-F20: one base and one count per release / non-release case per call,
 * not per gate (one compound shell line can hit branch, card and release).
 * Measured lazily — only a gate that needs qa asks git.
 * @param {{resolveBase: Function, codeFilesChanged: Function}} Q lib/run-contract-qa.js
 * @returns {(gate: string) => number|null}
 */
function qaCounter(gitRoot, explicitBase, C, Q, budget) {
  let base;
  const counts = new Map();
  return (gate) => {
    const key = gate === 'release' ? 'release' : 'other';
    if (!counts.has(key)) {
      if (base === undefined) base = Q.resolveBase(gitRoot, explicitBase, C, budget);
      counts.set(key, budget.expired() ? null : Q.codeFilesChanged(gitRoot, gate, base, C.gitLines, budget));
    }
    return counts.get(key);
  };
}

/**
 * 7. The first of the call's gates that an open obligation refuses → the
 * block text, or null. A gate that needs qa records its measure before
 * deciding; a refusal records a `block` event.
 */
function gateRefusal(call, { croot, contract }, RC, countFor, armed, sessionId) {
  const evs = RC.events(croot);
  const seg = RC.currentSegment(contract, evs);
  for (const gate of call.gates) {
    if (gate === 'release' && call.shellRelease && contract.ship !== 'auto') continue;
    const ctx = { closes: call.closes || [] };
    if ((gate === 'release' || gate === 'card' || gate === 'branch') && RC.segmentHasWork(seg)) {
      const n = countFor(gate);
      ctx.codeFilesChanged = n;
      // Recorded before deciding, so the card knows qa's input (`QA ?` when unknown).
      if (RC.record(croot, { k: 'measure', codeFiles: n }, { sessionId })) evs.push({ k: 'measure', codeFiles: n });
    }
    const open = RC.openObligations(contract, evs, gate, ctx);
    if (!open.length) continue;
    // AUD-004: a refused call leaves a lasting trace (`block` never counts as
    // work or a boundary — it changes neither segments nor obligations).
    RC.record(croot, { k: 'block', gate, open: open.map(o => o.ob) }, { sessionId });
    let msg = RC.formatBlock(contract, open, gate);
    if (armed && armed.source === 'fallback') {
      msg += `\nNote: this contract was armed from the click-through defaults (the do-run answers were not found). Wrong? ${RC.rearmHint()}`;
    }
    return msg;
  }
  return null;
}

/**
 * The hook: the reply runHook sends — `{block}` (exit 2), `{context}` or
 * null (exit 0).
 */
function main(hook) {
  // H-B17: every lib is required here, inside runHook's try — a half-written
  // lib during a plugin update must not break every matched PreToolUse call.
  const store = require('../lib/run-contract-store');
  // H-F20: the kill switch before anything else runs.
  if (store.disabled()) return null;
  const cwd = hook.cwd || process.cwd();
  const { projectRoot } = require('../lib/project-root');
  const C = require('../lib/run-contract-calls');
  // AUD-019/AUD-031: the one git subprocess timeout + shared-chain budget,
  // named once in lib/git-timeout.js — this hook keeps no GIT_TIMEOUT of its own.
  const { gitBudget, TOTAL_GIT_BUDGET_MS, SMALL_GIT_BUDGET_MS } = require('../lib/git-timeout');
  // AUD-010: qa's own git chain (base resolution + diff) lives in a shared lib
  // so run-contract-cli.js's `status` / `done` measure it exactly like this
  // gate does, instead of evaluating obligations against an empty ctx.
  const Q = require('../lib/run-contract-qa');
  // H-B1: ship_release / the card act on tool_input.cwd — its root is tried
  // second; post records into the same root.
  const { root, inputRoot, roots } = C.contractRoots(hook, projectRoot);
  // Fast path. R5: once a corrupt header is quarantined only
  // run-contract.json.corrupt.pending is left on disk — hasState counts it,
  // so the path stays open long enough to deliver the notice once.
  if (!roots.some(r => store.hasState(r, { pending: true, batch: true }))) return null;

  const RC = require('../lib/run-contract');
  const sessionId = hook.session_id || null;
  const { ok, blocked } = replies(RC, root, sessionId);

  const call = classify(hook, root, cwd, C);
  if (!call) return ok();

  const batchMsg = batchRefusal(call, root, RC, sessionId);
  if (batchMsg) return blocked(batchMsg);

  // 3. R12: ONE overall deadline for the whole invocation — before this it
  // bounded only the git chain below; the transcript walk (routerFromTrans
  // cript, backward up to 32 MB) could run long past it and a timed-out
  // PreToolUse fails open (exits 0, gating nothing). Created here, ahead of
  // armFromPending, so the walk shares the exact same ceiling as the git
  // calls that follow it (base resolution, diffs, ls-files, the pushHead
  // branch check), not a fresh one.
  const budget = gitBudget(TOTAL_GIT_BUDGET_MS);
  const armed = armFromPending(hook, root, RC, C, sessionId, budget);

  const found = sessionContract(roots, RC, sessionId);
  if (!found) return ok();
  promotePushHead(call, found.contract, root, C, budget, SMALL_GIT_BUDGET_MS);
  if (!call.gates.length) return ok();

  const countFor = qaCounter(inputRoot || root, call.base, C, Q, budget);
  const refusal = gateRefusal(call, found, RC, countFor, armed, sessionId);
  return refusal ? blocked(refusal) : ok();
}

if (require.main === module) {
  // The try: a lib that fails to load never surfaces as a hook failure.
  try { require('../lib/hook-input').runHook(main, { event: 'PreToolUse' }); } catch { /* fail open */ }
}

module.exports = { armFromPending };
