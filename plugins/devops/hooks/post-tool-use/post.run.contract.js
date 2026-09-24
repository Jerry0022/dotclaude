#!/usr/bin/env node
/**
 * @hook post.run.contract
 * @version 0.1.0
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
const { projectRoot } = require('../lib/project-root');

const LIB = path.resolve(__dirname, '..', 'lib', 'run-contract.js');

function announcement(h, RC) {
  const from = h.source === 'machine' ? 'a machine prompt (autostart)' : 'the click-through defaults — the do-run answers were not found';
  return [
    `[run-contract] A run contract was armed from ${from}: ${RC.chosenLine(h)}.`,
    'Its gates now refuse edits, commits, ship_release and final cards that walk past an open obligation.',
    `Wrong choice? Re-arm: node "${LIB}" arm --mode <prompt|backlog|audit> --flow <interactive|autonomous> --ship <auto|manual> --passes <harden,polish|none>`,
    `Not a run at all: node "${LIB}" done`,
  ].join('\n');
}

function backlogFinished(h, evs) {
  if (h.mode !== 'backlog' || !Array.isArray(h.items) || !h.items.length) return false;
  const closed = new Set();
  for (const ev of evs) {
    if (ev.k === 'release' && ev.ok === true && Array.isArray(ev.closes)) ev.closes.forEach(n => closed.add(String(n)));
    if (ev.k === 'skip' && ev.item) closed.add(String(ev.item));
  }
  return h.items.every(n => closed.has(String(n)));
}

function recordCard(root, variant, final, RC) {
  const ev = RC.record(root, { k: 'card', variant: variant || null });
  if (!ev || !final) return;
  const h = RC.readContract(root);
  if (h && (h.mode === 'prompt' || h.mode === 'audit')) RC.close(root, 'done: final card');
}

function main(hook) {
  const cwd = hook.cwd || process.cwd();
  const root = projectRoot(cwd);
  const tool = hook.tool_name || '';
  // Fast path: only AskUserQuestion (arming) and Skill (arm / batch markers)
  // can matter without a contract on disk.
  if (tool !== 'AskUserQuestion' && tool !== 'Skill'
    && !fs.existsSync(path.join(root, '.claude', 'run-contract.json'))) return null;
  const RC = require('../lib/run-contract');
  if (RC.disabled()) return null;
  const C = require('../lib/run-contract-calls');
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const sessionId = hook.session_id || null;

  if (tool === 'AskUserQuestion') {
    const { questions, answers } = RC.extractAnswers(hook.tool_response, input);
    if (RC.isRouterCall(questions)) {
      const marker = RC.pendingArm(root);
      const fields = RC.parseRouterAnswers(questions, answers, { doRunArgs: marker && marker.args });
      if (fields) {
        RC.arm(root, { ...fields, source: 'router', sessionId });
        RC.clearPendingArm(root);
      }
    } else {
      const patch = RC.parseFollowUp(questions, answers);
      if (patch) RC.update(root, patch);
    }
  } else if (tool === 'Skill') {
    const name = RC.skillName(input.skill || input.name);
    const args = typeof input.args === 'string' ? input.args : '';
    if (name === 'do-run') RC.markPendingArm(root, { sessionId, args });
    if (name === 'do-run' || name === 'auto-concept') RC.clearBatchHandoff(root);
    RC.record(root, { k: 'skill', name, args });
  } else if (tool === 'Agent') {
    RC.record(root, { k: 'agent', type: input.subagent_type || 'general-purpose' });
  } else if (C.EDIT_TOOLS.has(tool)) {
    if (C.isGatedPath(root, cwd, C.toolFilePath(tool, input))) RC.record(root, { k: 'edit' });
  } else if (C.SHELL_TOOLS.has(tool)) {
    const f = C.commandFacts(input.command);
    if (f.commit) RC.record(root, { k: 'commit' });
    if (f.branch) RC.record(root, { k: 'branch', name: f.branchName });
    if (f.renderCard) {
      const payload = C.readCardPayload(f.renderCard, cwd);
      if (payload) { const cf = C.cardFacts(payload); recordCard(root, cf.variant, cf.final, RC); }
    }
  } else if (tool === C.SHIP_RELEASE) {
    const res = C.releaseResult(hook.tool_response) || { ok: false, merged: false };
    RC.record(root, { k: 'release', ok: res.ok, merged: res.merged, closes: C.closesOf(input.body) });
    const h = RC.readContract(root);
    if (h && backlogFinished(h, RC.events(root))) RC.close(root, 'done: every queued item shipped');
  } else if (tool === C.RENDER_CARD) {
    const cf = C.cardFacts(input);
    recordCard(root, cf.variant, cf.final, RC);
  } else {
    return null;
  }

  const h = RC.readContract(root);
  if (h && (h.source === 'fallback' || h.source === 'machine') && !h.announced) {
    if (RC.update(root, { announced: true })) {
      return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: announcement(h, RC) } });
    }
  }
  return null;
}

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
