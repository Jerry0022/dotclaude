#!/usr/bin/env node
/**
 * @hook post.agent.nudge
 * @version 0.1.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Write|Edit|NotebookEdit
 * @description AUD-024: outside a do-run run, a single turn can change many
 *   files without ever spawning an auto-agent, and nothing points that out —
 *   the delegation policy (deep-knowledge/agent-proactivity.md) is prompt-
 *   level advice only. At the 6th DISTINCT file a turn changes, this hook
 *   tells Claude once, via `hookSpecificOutput.additionalContext`, to OFFER
 *   the `auto-agents` skill — never to auto-start it (offer vs. auto-start,
 *   agent-proactivity.md § Full ceremony).
 *
 *   Distinct files are counted from the transcript, scoped to the current
 *   turn by walking backward to the turn's opening user-prompt entry — the
 *   same turn-boundary walk `lib/skill-invocations.js#skillInvokedThisTurn`
 *   and `lib/card-guard.js#showWidgetCalledThisTurn` use. Because the count
 *   is recomputed fresh from the transcript every call (never a session
 *   counter that needs resetting), a new user turn resets it for free — no
 *   extra UserPromptSubmit hook needed. The nudge fires the one call where
 *   the running distinct-file count first reaches 6; it stays silent before
 *   and after (a 7th+ file sees the count already past 6).
 *
 *   Silent when: the call is a subagent's (`hook.agent_id` set — a subagent's
 *   edits are not the parent's turn, same rule `post.flow.completion.js`
 *   applies); the edited file is outside the session's own work tree (outside
 *   `projectRoot(cwd)`, or inside a nested linked worktree — same rule as
 *   `post.flow.completion.js#inOwnWorkTree`, copied locally since that file
 *   exports nothing); a run contract is active for this session
 *   (`lib/run-contract.js#readContract` — the run's own delegation gates
 *   apply instead); the `auto-agents` skill was already invoked via the
 *   Skill tool this turn; or the delegation kill switch
 *   (`lib/delegation.js`) resolves to `off`.
 *
 *   Never blocks: every failure path exits 0 silently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { projectRoot, findRepoRoot, samePath } = require('../lib/project-root');
const { readContract } = require('../lib/run-contract');
const { readDelegation } = require('../lib/delegation');
const { safeReadTranscript } = require('../lib/card-guard');
const { skillInvokedThisTurn, isPromptEntry } = require('../lib/skill-invocations');
const { isDevopsSkill } = require('../lib/skill-names');

const NUDGE_AT = 6;
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

/** A subagent's tool call: the harness sets `agent_id`, but keeps the PARENT's session_id. */
function isSubagentCall(hook) {
  return !!hook && typeof hook.agent_id === 'string' && hook.agent_id !== '';
}

/** Is `child` the directory `parent` or below it? (win32: path.relative ignores case.) */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // another drive
  return rel !== '..' && !rel.startsWith('..' + path.sep);
}

/** Is `dir` a LINKED worktree — `.git` a FILE whose gitdir points into a `…/worktrees/…` admin dir? */
function isLinkedWorktree(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    if (!fs.statSync(dotGit).isFile()) return false;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return false;
    return /(^|\/)worktrees\//.test(path.resolve(dir, m[1]).replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

/**
 * Does `file` belong to the session's own work tree? Local copy of
 * `post.flow.completion.js#inOwnWorkTree` (not exported there, and that file
 * is out of scope here) — outside `projectRoot(cwd)` it does not; nor inside
 * a linked worktree nested in it (an isolated agent's own worktree).
 */
function inOwnWorkTree(file, cwd) {
  if (!file) return true;
  const base = cwd || process.cwd();
  const own = projectRoot(base);
  const abs = path.resolve(base, String(file));
  if (!isInside(abs, own)) return false;
  const nearest = findRepoRoot(path.dirname(abs));
  if (nearest && !samePath(nearest, own) && isInside(nearest, own) && isLinkedWorktree(nearest)) {
    return false;
  }
  return true;
}

/** Edit/Write/NotebookEdit target path, per tool (NotebookEdit uses `notebook_path`). */
function editedPathOf(toolName, input) {
  if (!input) return null;
  if (toolName === 'Edit' || toolName === 'Write') return input.file_path || null;
  if (toolName === 'NotebookEdit') return input.notebook_path || input.file_path || null;
  return null;
}

const EDIT_TOOL_RE = /^(?:.*__)?(Edit|Write|NotebookEdit)$/;

/**
 * Distinct absolute paths edited by Edit/Write/NotebookEdit tool_use blocks
 * so far THIS turn, walking the transcript backward to (not including) the
 * turn's opening user-prompt entry — same walk as
 * `skill-invocations.js#skillInvokedThisTurn` / `card-guard.js#showWidgetCalledThisTurn`.
 * @returns {Set<string>}
 */
function editedFilesThisTurn(transcriptContent, cwd) {
  const out = new Set();
  if (typeof transcriptContent !== 'string' || !transcriptContent) return out;
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'user') {
      if (isPromptEntry(entry)) break;
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      const m = typeof block.name === 'string' ? EDIT_TOOL_RE.exec(block.name) : null;
      if (!m) continue;
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      const p = editedPathOf(m[1], input);
      if (!p) continue;
      try { out.add(path.resolve(cwd || process.cwd(), String(p))); } catch { /* skip */ }
    }
  }
  return out;
}

function buildNudge() {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        '[agent-nudge] This turn has changed 6+ distinct files without auto-agents. ' +
        'Per deep-knowledge/agent-proactivity.md, OFFER the `auto-agents` skill in one ' +
        'sentence (never auto-start it) — let the user decide before continuing.',
    },
  });
}

/**
 * Pure decision: given the parsed hook payload, the additionalContext JSON
 * string to emit, or '' when silent. Never throws — every failure path
 * returns ''.
 * @param {object} hook
 * @returns {string}
 */
function run(hook) {
  try {
    if (!hook || typeof hook !== 'object') return '';
    if (isSubagentCall(hook)) return '';

    const toolName = hook.tool_name || '';
    if (!['Edit', 'Write', 'NotebookEdit'].includes(toolName)) return '';

    const cwd = hook.cwd || process.cwd();
    const filePath = editedPathOf(toolName, hook.tool_input);
    if (!filePath) return '';
    if (!inOwnWorkTree(filePath, cwd)) return '';

    if (readContract(cwd, { sessionId: hook.session_id })) return '';

    const delegation = readDelegation({ cwd });
    if (delegation.mode === 'off') return '';

    const transcript = safeReadTranscript(hook.transcript_path, TRANSCRIPT_TAIL_BYTES);
    if (skillInvokedThisTurn(transcript, (input) => isDevopsSkill(input && input.skill, 'auto-agents'))) {
      return '';
    }

    const files = editedFilesThisTurn(transcript, cwd);
    files.add(path.resolve(cwd, String(filePath)));

    return files.size === NUDGE_AT ? buildNudge() : '';
  } catch {
    return '';
  }
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    let hook = null;
    try { hook = JSON.parse(inputData); } catch { /* run(null) below is silent */ }
    try {
      const out = run(hook);
      if (out) process.stdout.write(out);
    } catch { /* never surface an internal error */ }
    process.exitCode = 0;
  });
}

module.exports = {
  run, editedPathOf, editedFilesThisTurn, inOwnWorkTree, isSubagentCall, buildNudge, NUDGE_AT,
};
