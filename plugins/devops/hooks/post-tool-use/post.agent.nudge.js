#!/usr/bin/env node
/**
 * @hook post.agent.nudge
 * @version 0.2.0
 * @event PostToolUse
 * @plugin devops
 * @matcher Write|Edit|NotebookEdit
 * @description AUD-024: outside a do-run run, a single turn can change many
 *   files without ever spawning an auto-agent, and nothing points that out —
 *   the delegation policy (deep-knowledge/agent-proactivity.md) is prompt-
 *   level advice only. At the 6th DISTINCT file a turn changes, this hook
 *   tells Claude once, via `hookSpecificOutput.additionalContext`, to
 *   MENTION the `auto-agents` skill in one sentence — never to auto-start it
 *   or to stall on it (offer vs. auto-start, agent-proactivity.md § Full
 *   ceremony).
 *
 *   Distinct files are counted from the transcript, scoped to the current
 *   turn by walking backward to the turn's opening user-prompt entry — the
 *   same turn-boundary walk `lib/skill-invocations.js#skillInvokedThisTurn`
 *   and `lib/card-guard.js#showWidgetCalledThisTurn` use, and filtered to the
 *   session's own work tree (R14a) the same way the CURRENT call's file is.
 *   Because the count is recomputed fresh from the transcript every call
 *   (never a session counter that needs resetting), a new user turn resets
 *   it for free — no extra UserPromptSubmit hook needed. The nudge fires the
 *   one call where the running distinct-file count first reaches exactly 6;
 *   it stays silent before and after. A once-per-turn marker (R14d), keyed
 *   by the turn's opening prompt text, additionally guards against firing
 *   twice: the transcript is only read as a 1 MB tail, so on a very long
 *   turn older edits can slide out of the tail and the running count can
 *   drop back to exactly 6 a second time.
 *
 *   Silent when: the call is a subagent's (`hook.agent_id` set — a subagent's
 *   edits are not the parent's turn, same rule `post.flow.completion.js`
 *   applies); the edited file is outside the session's own work tree (outside
 *   `projectRoot(cwd)`, or inside a nested linked worktree — same rule as
 *   `post.flow.completion.js#inOwnWorkTree`, copied locally since that file
 *   exports nothing); a run contract is active for this session
 *   (`lib/run-contract.js#readContract` — the run's own delegation gates
 *   apply instead); the turn was not typed by the user — silent, machine, or
 *   a scheduled task (R14c, `lib/non-user-prompt.js`'s classifiers, same as
 *   `stop.guide.handoff.js#isMachineDrivenTurn` — nobody to nudge); ANY
 *   devops skill (not just `auto-agents`) already ran this turn, via the
 *   Skill tool OR a typed slash command (R14b/c,
 *   `lib/skill-invocations.js#skillInvokedThisTurn`'s command-name scan
 *   already covers a typed `/auto-agents`); the nudge already fired this
 *   turn (R14d); or the delegation kill switch (`lib/delegation.js`)
 *   resolves to `off`.
 *
 *   Never blocks: every failure path exits 0 silently.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NUDGE_AT = 6;
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const FIRED_FLAG_PREFIX = 'dotclaude-devops-agent-nudge-fired';

// R15 part 2: these sibling lib requires sat unguarded at module scope — a
// load error during a plugin update (a half-written file, a version skew
// mid-update) crashed this hook on every single Edit/Write/NotebookEdit
// call. Guarded here so a load error instead makes `run()` a silent no-op,
// same as every other failure path.
let projectRoot, findRepoRoot, samePath, readContract, readDelegation, safeReadTranscript,
  skillInvokedThisTurn, isPromptEntry, lastUserPromptText, namespaceOf, isOldName,
  isSilent, isMachineTurn, isScheduledTask, isMachinePrompt, sessionFile, readSessionFile, writeSessionFile;
let loadError = false;
try {
  ({ projectRoot, findRepoRoot, samePath } = require('../lib/project-root'));
  ({ readContract } = require('../lib/run-contract'));
  ({ readDelegation } = require('../lib/delegation'));
  ({ safeReadTranscript } = require('../lib/card-guard'));
  ({ skillInvokedThisTurn, isPromptEntry, lastUserPromptText } = require('../lib/skill-invocations'));
  ({ namespaceOf, isOldName } = require('../lib/skill-names'));
  ({ isSilent, isMachineTurn, isScheduledTask } = require('../user-prompt-submit/prompt.flow.silent-turn'));
  ({ isMachinePrompt } = require('../lib/batch-state'));
  ({ sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id'));
} catch {
  loadError = true;
}

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
      let abs;
      try { abs = path.resolve(cwd || process.cwd(), String(p)); } catch { continue; }
      // R14a: a memory / scratchpad / out-of-repo path must not count toward
      // the 6, same rule as the CURRENT call's own file below.
      if (!inOwnWorkTree(abs, cwd)) continue;
      out.add(abs);
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
        'Per deep-knowledge/agent-proactivity.md, mention the `auto-agents` skill in one ' +
        'sentence (never auto-start it) and continue.',
    },
  });
}

/** Turn opened by a cron / loop / scheduled task / notification, or an
 *  explicitly silent one — nobody to nudge. Same classifiers as
 *  `stop.guide.handoff.js#isMachineDrivenTurn`. */
function isMachineDrivenTurn(transcript) {
  const prompt = lastUserPromptText(transcript);
  if (!prompt) return false;
  return isSilent(prompt) || isMachinePrompt(prompt) || isMachineTurn(prompt) || isScheduledTask(prompt);
}

/** Did THIS turn already invoke ANY devops skill (not just `auto-agents`),
 *  via the Skill tool or a typed slash command? A turn that is already
 *  delegating — to any devops skill — needs no nudge toward one. */
function anyDevopsSkillInvokedThisTurn(transcript) {
  return skillInvokedThisTurn(transcript, (input) => {
    const raw = input && input.skill;
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const ns = namespaceOf(raw);
    if (ns) return ns === 'devops';
    return !isOldName(raw);
  });
}

/** R14d: has the nudge already fired this turn? Keyed by session + cwd + the
 *  turn's opening prompt text, so a fresh turn (new prompt) always gets a
 *  fresh marker even though the 1 MB transcript tail can make the running
 *  distinct-file count dip back below 6 and cross it again later. */
function firedMarkerKey(hook, transcript) {
  const prompt = lastUserPromptText(transcript);
  const raw = `${hook.session_id || ''}|${hook.cwd || ''}|${prompt}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20);
}

function alreadyFiredThisTurn(key) {
  try { return readSessionFile(FIRED_FLAG_PREFIX, key, { exact: true }) !== null; } catch { return false; }
}

function markFiredThisTurn(key) {
  try { writeSessionFile(sessionFile(FIRED_FLAG_PREFIX, key), '1'); } catch { /* best effort */ }
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
    if (loadError) return '';
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
    if (isMachineDrivenTurn(transcript)) return '';
    if (anyDevopsSkillInvokedThisTurn(transcript)) return '';

    const files = editedFilesThisTurn(transcript, cwd);
    files.add(path.resolve(cwd, String(filePath)));
    if (files.size !== NUDGE_AT) return '';

    const key = firedMarkerKey(hook, transcript);
    if (alreadyFiredThisTurn(key)) return '';
    markFiredThisTurn(key);
    return buildNudge();
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
