#!/usr/bin/env node
/**
 * @hook post.agent.nudge
 * @version 0.3.1
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
 *   it for free — no extra UserPromptSubmit hook needed. The nudge fires on
 *   the first call where the running distinct-file count is 6 or more — the
 *   parallel Edit/Write calls of one message can already be in the transcript
 *   when the first of them runs, so the count may jump from 5 straight past
 *   6 (harden H-N1); it stays silent before. A once-per-turn marker (R14d), keyed
 *   by the turn's opening prompt entry's `uuid` (its `timestamp` when no
 *   `uuid`) — NOT its text, so a later turn that repeats the same short
 *   prompt ("weiter", "continue") still gets its own marker and is nudged —
 *   keeps it silent after: every later call of the turn also counts 6 or
 *   more, and on a very long turn older edits can slide out of the 1 MB
 *   transcript tail and the count can climb past 6 a second time (Q8).
 *
 *   Silent when: the call is a subagent's (`hook.agent_id` set — a subagent's
 *   edits are not the parent's turn, same rule `post.flow.completion.js`
 *   applies); the edited file is outside the session's own work tree (outside
 *   `projectRoot(cwd)`, or inside a nested linked worktree —
 *   `lib/project-root.js#inOwnWorkTree`, the rule `post.flow.completion.js`
 *   applies too); a run contract is active for this session
 *   (`lib/run-contract.js#readContract` — the run's own delegation gates
 *   apply instead); the turn was not typed by the user — silent, machine, or
 *   a scheduled task (R14c, `lib/non-user-prompt.js`'s classifiers, same as
 *   `stop.guide.handoff.js#isMachineDrivenTurn` — nobody to nudge); ANY
 *   DEVOPS skill (not just `auto-agents`) already ran this turn, via the
 *   Skill tool OR a typed slash command (R14b/c,
 *   `lib/skill-invocations.js#skillInvokedThisTurn`'s command-name scan
 *   already covers a typed `/auto-agents`) — an un-namespaced name only
 *   counts as a devops skill when it is one of THIS plugin's own skill
 *   directory names (`skills/*` under `lib/plugin-root.js#pluginRoot()`,
 *   read once and cached), so a user/consumer skill of the same shape
 *   (e.g. `graphify`) never silences the nudge (Q8); the nudge already
 *   fired this turn (R14d); or the delegation kill switch
 *   (`lib/delegation.js`) resolves to `off`.
 *
 *   Never blocks: every failure path exits 0 silently. Stdin and parsing go
 *   through lib/hook-input.js's runHook (parseHookInput — a BOM-prefixed
 *   payload now parses instead of reading as no payload).
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
let inOwnWorkTree, readContract, readDelegation, safeReadTranscript,
  skillInvokedThisTurn, isPromptEntry, lastUserPromptText, normalizeSkillName, namespaceOf,
  isSilent, isMachineTurn, isScheduledTask, isMachinePrompt, sessionFile, readSessionFile, writeSessionFile,
  pluginRoot;
let loadError = false;
try {
  ({ inOwnWorkTree } = require('../lib/project-root'));
  ({ readContract } = require('../lib/run-contract'));
  ({ readDelegation } = require('../lib/delegation'));
  ({ safeReadTranscript } = require('../lib/card-guard'));
  ({ skillInvokedThisTurn, isPromptEntry, lastUserPromptText, normalizeSkillName } = require('../lib/skill-invocations'));
  ({ namespaceOf } = require('../lib/skill-names'));
  ({ isSilent, isMachineTurn, isScheduledTask } = require('../user-prompt-submit/prompt.flow.silent-turn'));
  ({ isMachinePrompt } = require('../lib/batch-state'));
  ({ sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id'));
  ({ pluginRoot } = require('../lib/plugin-root'));
} catch {
  loadError = true;
}

/** A subagent's tool call: the harness sets `agent_id`, but keeps the PARENT's session_id. */
function isSubagentCall(hook) {
  return !!hook && typeof hook.agent_id === 'string' && hook.agent_id !== '';
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

/** This plugin's own skill directory names (`skills/auto-agents`, `skills/do-ship`,
 *  …), lowercased. Read once from disk and cached for the process lifetime —
 *  a hook process is short-lived, so there is no staleness concern. Q8: an
 *  un-namespaced skill name must match THIS list to count as a devops skill;
 *  otherwise a user/consumer skill of the same bare shape (e.g. `graphify`)
 *  would silently be treated as devops and silence the nudge. */
let cachedSkillDirNames = null;
function devopsSkillDirNames() {
  if (cachedSkillDirNames) return cachedSkillDirNames;
  const out = new Set();
  try {
    const skillsDir = path.join(pluginRoot(), 'skills');
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) out.add(entry.name.toLowerCase());
    }
  } catch { /* best effort: an empty set just means no bare name matches */ }
  cachedSkillDirNames = out;
  return cachedSkillDirNames;
}

/** Did THIS turn already invoke ANY devops skill (not just `auto-agents`),
 *  via the Skill tool or a typed slash command? A turn that is already
 *  delegating — to any devops skill — needs no nudge toward one. An
 *  un-namespaced name only counts when it is one of THIS plugin's own skill
 *  directory names (Q8) — a bare old name (pre-rename) is deliberately NOT
 *  in that list, same as a bare user/consumer skill. */
function anyDevopsSkillInvokedThisTurn(transcript) {
  return skillInvokedThisTurn(transcript, (input) => {
    const raw = input && input.skill;
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const ns = namespaceOf(raw);
    if (ns) return ns === 'devops';
    return devopsSkillDirNames().has(normalizeSkillName(raw));
  });
}

/** Identity of the turn's opening user-prompt entry: its `uuid`, or its
 *  `timestamp` when no `uuid` is recorded. Q8: text is deliberately NOT used
 *  — a later turn that repeats the same short prompt ("weiter", "continue")
 *  must still get its own marker, not silently reuse an earlier turn's. */
function lastUserPromptEntryId(transcriptContent) {
  if (typeof transcriptContent !== 'string' || !transcriptContent) return '';
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || entry.type !== 'user' || !isPromptEntry(entry)) continue;
    if (typeof entry.uuid === 'string' && entry.uuid) return entry.uuid;
    if (entry.timestamp) return String(entry.timestamp);
    return '';
  }
  return '';
}

/** R14d: has the nudge already fired this turn? Keyed by session + cwd + the
 *  turn's opening prompt entry's identity (Q8: uuid, falling back to
 *  timestamp — never its text), so a fresh turn (new prompt entry) always
 *  gets a fresh marker even though the 1 MB transcript tail can make the
 *  running distinct-file count dip back below 6 and cross it again later. */
function firedMarkerKey(hook, transcript) {
  const id = lastUserPromptEntryId(transcript);
  const raw = `${hook.session_id || ''}|${hook.cwd || ''}|${id}`;
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
    if (files.size < NUDGE_AT) return '';

    const key = firedMarkerKey(hook, transcript);
    if (alreadyFiredThisTurn(key)) return '';
    markFiredThisTurn(key);
    return buildNudge();
  } catch {
    return '';
  }
}

if (require.main === module) {
  // run() returns the serialized envelope (or ''), written as is; the try:
  // a lib that fails to load never surfaces as a hook failure.
  try { require('../lib/hook-input').runHook(run, { event: 'PostToolUse' }); } catch { /* fail open */ }
}

module.exports = {
  run, editedPathOf, editedFilesThisTurn, inOwnWorkTree, isSubagentCall, buildNudge, NUDGE_AT,
  firedMarkerKey, lastUserPromptEntryId, devopsSkillDirNames, anyDevopsSkillInvokedThisTurn,
};
