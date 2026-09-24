#!/usr/bin/env node
/**
 * @hook pre.run.contract
 * @version 0.1.0
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
const { projectRoot } = require('../lib/project-root');

const LIB = path.resolve(__dirname, '..', 'lib', 'run-contract.js');

const BATCH_BLOCK = [
  '[run-contract] BLOCKED: a do-batch plan is waiting for its hand-off.',
  'A ready plan goes to Skill("devops:do-run", "--from=do-batch …"), a plan with',
  'open decisions to Skill("devops:auto-concept", "--from=do-batch …") — never',
  'implemented directly. Reading, exploring and planning stay allowed.',
  `Stale marker / not a do-batch hand-off: node "${LIB}" batch-clear --reason "<why>"`,
  'Kill switch (every run-contract gate): DOTCLAUDE_RUN_CONTRACT=off',
].join('\n');

function gitNames(root, args) {
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['diff', '--name-only', ...args], {
    cwd: root, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/**
 * The qa diff base (R9): an explicit base, else origin/HEAD's branch, else
 * `main`, then `master` when that exists locally or on origin.
 */
function resolveBase(root, explicit, C) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
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
    let names;
    try { names = gitNames(root, [`origin/${base}...HEAD`]); } catch { names = gitNames(root, [`${base}...HEAD`]); }
    const set = new Set(names);
    if (gate !== 'release') for (const n of gitNames(root, ['HEAD'])) set.add(n);
    const { isCodeChange } = require('../lib/browsertest-guard');
    return [...set].filter(f => isCodeChange(f)).length;
  } catch { return null; }
}

/** The gates this call hits: {gates:[], batch:boolean, closes, base}. */
function classify(hook, root, cwd, C) {
  const tool = hook.tool_name || '';
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  if (C.EDIT_TOOLS.has(tool)) {
    return C.isGatedPath(root, cwd, C.toolFilePath(tool, input)) ? { gates: ['edit'], batch: true } : null;
  }
  if (C.SHELL_TOOLS.has(tool)) {
    const f = C.commandFacts(input.command);
    const gates = [];
    let batch = false;
    if (f.commit) { gates.push('commit'); batch = true; }
    if (f.branch && C.isItemBranch(f, hook, hook.agent_id || f.worktree || f.detach ? null : C.baseBranch(root, f.branchName, false))) {
      gates.push('branch');
    }
    if (f.renderCard) {
      const payload = C.readCardPayload(f.renderCard, cwd);
      if (payload && C.cardFacts(payload).final) gates.push('card');
    }
    return gates.length ? { gates, batch } : null;
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
  if (found) fields = RC.parseRouterAnswers(found.questions, found.answers, { doRunArgs: marker.args });
  if (!fields) {
    source = 'fallback';
    // The click-through defaults: parse an empty Q4 whose options carry the
    // recommended passes; the do-run args still set a preset mode.
    const q4 = { header: 'Durchgänge?', question: 'Durchgänge?', options: [{ label: 'Harden danach (Recommended)' }, { label: 'Polish danach (Recommended)' }] };
    fields = RC.parseRouterAnswers([q4], {}, { doRunArgs: marker.args });
  }
  const h = RC.arm(root, { ...fields, source, sessionId: sessionId || marker.sessionId || null });
  RC.clearPendingArm(root);
  if (h && found) for (const patch of found.followUps) RC.applyFollowUp(root, patch, { sessionId });
  return h ? { source } : null;
}

function main(hook) {
  const cwd = hook.cwd || process.cwd();
  const root = projectRoot(cwd);
  // ship_release / the card act on tool_input.cwd — its root is tried second.
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const inputRoot = typeof input.cwd === 'string' && input.cwd.trim() && String(hook.tool_name || '').startsWith('mcp__')
    ? projectRoot(input.cwd) : null;
  const roots = inputRoot && inputRoot !== root ? [root, inputRoot] : [root];
  const hasState = (r) => ['run-contract.json', 'run-contract.pending', 'batch-handoff.json']
    .some(n => fs.existsSync(path.join(r, '.claude', n)));
  if (!roots.some(hasState)) return 0;

  const C = require('../lib/run-contract-calls');
  const call = classify(hook, root, cwd, C);
  if (!call) return 0;

  const RC = require('../lib/run-contract');
  if (RC.disabled()) return 0;

  const sessionId = hook.session_id || null;
  if (call.batch && RC.batchHandoffPending(root, { sessionId })) {
    process.stderr.write(`${BATCH_BLOCK}\n`);
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

  for (const gate of call.gates) {
    const ctx = { closes: call.closes || [] };
    if ((gate === 'release' || gate === 'card' || gate === 'branch') && RC.segmentHasWork(seg)) {
      const n = codeFilesChanged(gitRoot, gate, resolveBase(gitRoot, call.base, C));
      ctx.codeFilesChanged = n;
      // Recorded before deciding, so the card knows qa's input (`QA ?` when unknown).
      if (RC.record(croot, { k: 'measure', codeFiles: n }, { sessionId })) evs.push({ k: 'measure', codeFiles: n });
    }
    const open = RC.openObligations(contract, evs, gate, ctx);
    if (!open.length) continue;
    let msg = RC.formatBlock(contract, open, gate, { libPath: LIB });
    if (armed && armed.source === 'fallback') {
      msg += `\nNote: this contract was armed from the click-through defaults (the do-run answers were not found). Wrong? node "${LIB}" arm --mode <m> --flow <f> --ship <s> --passes <p>`;
    }
    process.stderr.write(`${msg}\n`);
    return 2;
  }
  return 0;
}

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
