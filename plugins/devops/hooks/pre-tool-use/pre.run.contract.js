#!/usr/bin/env node
/**
 * @hook pre.run.contract
 * @version 0.2.0
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
 *   harden, polish, qa, do-ship.
 *
 *   Fast path: none of run-contract.json / run-contract.pending /
 *   batch-handoff.json in the work-tree root → exit 0 before loading the lib.
 *   qa counts changed code files from git only at release / card / branch
 *   gates (5 s timeout); any git failure means unknown and never blocks.
 *   An internal error never blocks. Kill switch: DOTCLAUDE_RUN_CONTRACT=off.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

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

const GIT_TIMEOUT = { timeout: 5000 };

// RT2-R7: widened to Unicode letters/digits (`größe`, non-ASCII branch
// names are legal in git) plus `._/+@-` (`release/1.2`, `feat/a+b`,
// `user@x`). Still rejects a leading `-` (flag injection), `..` anywhere
// (path-traversal-ish ref, also invalid in a git refname) and anything
// with whitespace / control characters (excluded by the character class).
const SAFE_BASE_RE = /^[\p{L}\p{N}._/+@-]+$/u;
function safeBase(explicit) {
  const b = typeof explicit === 'string' ? explicit.trim() : '';
  if (!b || b.startsWith('-') || b.includes('..') || !SAFE_BASE_RE.test(b)) return '';
  return b;
}

/**
 * The qa diff base (R9): an explicit base, else origin/HEAD's branch, else
 * `main`, then `master` when that exists locally or on origin. An unsafe
 * explicit base (leading `-`, shell metacharacters) is never trusted — the
 * base is auto-detected instead (AUD-007).
 */
function resolveBase(root, explicit, C) {
  const safe = safeBase(explicit);
  if (safe) return safe;
  const sym = C.gitOut(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (sym) return sym.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (C.gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])
      || C.gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`])) return b;
  }
  return 'main';
}

/** Changed code files for the qa rule, or null (unknown). */
function codeFilesChanged(root, gate, base) {
  try {
    // H-A6: gitLines throws on a git failure → the catch below = unknown.
    const { gitLines } = require('../lib/run-contract-calls');
    const diff = (range) => gitLines(root, ['diff', '--name-only', range], GIT_TIMEOUT);
    let names;
    try { names = diff(`origin/${base}...HEAD`); } catch { names = diff(`${base}...HEAD`); }
    const set = new Set(names);
    if (gate !== 'release') {
      for (const n of diff('HEAD')) set.add(n);
      // H-B4: new code files never `git add`ed count too.
      for (const n of gitLines(root, ['ls-files', '--others', '--exclude-standard'], GIT_TIMEOUT)) set.add(n);
    }
    const { isCodeChange } = require('../lib/browsertest-guard');
    return [...set].filter(f => isCodeChange(f)).length;
  } catch { return null; }
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
    return gates.length ? { gates, batch: f.commit, shellRelease: f.release } : null;
  }
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

/** Spec B: a do-run started but its answers were never recorded — arm now. */
function armFromPending(hook, root, RC, C, sessionId) {
  const marker = RC.pendingArm(root, { sessionId });
  if (!marker) return null;
  // R1: a do-run that skipped the router (resume, machine prompt, backlog's
  // own sub-run) never replaces the contract the user already chose.
  if (RC.readContract(root, { sessionId })) { RC.clearPendingArm(root); return null; }
  const found = C.routerFromTranscript(hook.transcript_path, marker.at, RC);
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

function main(hook) {
  const cwd = hook.cwd || process.cwd();
  // H-B17: required here, inside the stdin handler's try/catch — a load
  // error never crashes the hook.
  const { projectRoot } = require('../lib/project-root');
  const C = require('../lib/run-contract-calls');
  // H-B1: ship_release / the card act on tool_input.cwd — its root is tried
  // second; post records into the same root.
  const { root, inputRoot, roots } = C.contractRoots(hook, projectRoot);
  const hasState = (r) => ['run-contract.json', 'run-contract.pending', 'batch-handoff.json']
    .some(n => fs.existsSync(path.join(r, '.claude', n)));
  if (!roots.some(hasState)) return 0;

  const call = classify(hook, root, cwd, C);
  if (!call) return 0;

  // The kill switch is checked before main() runs (H-F20).
  const RC = require('../lib/run-contract');

  const sessionId = hook.session_id || null;
  if (call.batch && RC.batchHandoffPending(root, { sessionId })) {
    // AUD-004: a refused call leaves a lasting trace. A no-op when no
    // contract is active yet (record() needs one) — the batch marker itself
    // is that trace then.
    RC.record(root, { k: 'block', gate: 'batch', open: [] }, { sessionId });
    process.stderr.write(`${batchBlock(RC)}\n`);
    return 2;
  }

  const armed = armFromPending(hook, root, RC, C, sessionId);
  let croot = null;
  let contract = null;
  for (const r of roots) {
    RC.claim(r, sessionId);
    contract = RC.readContract(r, { sessionId });
    if (contract) { croot = r; break; }
  }
  if (!contract) return 0;
  const evs = RC.events(croot);
  const seg = RC.currentSegment(contract, evs);
  const gitRoot = inputRoot || root;
  // H-F20: one base and one count per release / non-release case per call,
  // not per gate (one compound shell line can hit branch, card and release).
  let base;
  const counts = new Map();
  const countFor = (gate) => {
    const key = gate === 'release' ? 'release' : 'other';
    if (!counts.has(key)) {
      if (base === undefined) base = resolveBase(gitRoot, call.base, C);
      counts.set(key, codeFilesChanged(gitRoot, gate, base));
    }
    return counts.get(key);
  };

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
    process.stderr.write(`${msg}\n`);
    return 2;
  }
  return 0;
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let code = 0;
    try {
      if (String(process.env.DOTCLAUDE_RUN_CONTRACT || '').trim().toLowerCase() === 'off') process.exit(0);
      const { parseHookInput } = require('../lib/hook-input');
      const hook = parseHookInput(inputData);
      if (!hook) process.exit(0);
      code = main(hook);
    } catch {
      code = 0; // an internal error never surfaces as a hook failure
    }
    process.exit(code);
  });
}

module.exports = { safeBase, resolveBase, codeFilesChanged };
