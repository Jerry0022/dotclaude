/**
 * @module skill-turn-marker
 * @version 0.1.0
 * @description Hook-written record of the skills invoked in the current turn,
 *   for runs that have no transcript to read it from.
 *
 *   Guards that require a skill "in this turn" (`pre.issue.guard`) read the
 *   session transcript (lib/skill-invocations.skillInvokedThisTurn). Under
 *   `claude -p --no-session-persistence` — the A/B eval runner
 *   (evals/ab-run.js) — no transcript is written, so that check can never
 *   pass. This marker is the fallback signal:
 *     - `post.skill.marker` (PostToolUse, matcher Skill) appends the skill
 *       name after the Skill tool loaded it;
 *     - `prompt.skill.enforce` (UserPromptSubmit) starts a new turn: it
 *       deletes the main thread's marker and records a slash-started skill
 *       (`/devops:auto-issue …`), which never goes through the Skill tool.
 *
 *   One file per caller in os.tmpdir(): `<PREFIX>-<session_id>` for the main
 *   thread, `<PREFIX>-<session_id>.agent-<agent_id>` for a subagent — a skill
 *   the orchestrator ran never licenses a subagent's call, and the other way
 *   round (same rule as pre.issue.guard's transcript choice). Reads are exact
 *   (lib/session-id `{ exact: true }`): this is an enforcement input, a
 *   foreign session's marker must never count. A payload without a usable
 *   session_id has no marker at all.
 *
 *   Consumers use the marker ONLY when the caller's transcript is not on
 *   disk; a session with a transcript keeps the transcript as its sole
 *   source. Like the `# via auto-issue` marker it is a convention, not a
 *   security boundary — a process that can write os.tmpdir() can forge it.
 */

const fs = require('fs');
const { sessionFile, readSessionFile, writeSessionFile } = require('./session-id');
const { isDevopsSkill } = require('./skill-names');

const PREFIX = 'dotclaude-devops-skill-turn';
const SAFE_ID_RE = /^[\w-]+$/;
/** Cap on recorded names per turn — a runaway loop must not grow the file. */
const MAX_SKILLS = 50;

/**
 * Marker key of the calling agent, or null when the payload has no safe id.
 * @param {object} hook parsed payload
 * @returns {string|null}
 */
function markerKey(hook) {
  if (!hook || typeof hook.session_id !== 'string' || !SAFE_ID_RE.test(hook.session_id)) return null;
  if (hook.agent_id === undefined || hook.agent_id === null || hook.agent_id === '') return hook.session_id;
  const agentId = String(hook.agent_id);
  return SAFE_ID_RE.test(agentId) ? `${hook.session_id}.agent-${agentId}` : null;
}

/** Recorded raw skill names of the caller's current turn. */
function recordedSkills(hook) {
  const key = markerKey(hook);
  if (!key) return [];
  const file = readSessionFile(PREFIX, key, { exact: true });
  if (!file) return [];
  try {
    const data = JSON.parse(file.content);
    return Array.isArray(data.skills) ? data.skills.filter(s => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Append a skill to the caller's turn marker.
 * @param {object} hook parsed payload (session_id, optional agent_id)
 * @param {string} skill raw skill name as invoked (`devops:auto-issue`)
 * @returns {boolean} written
 */
function recordSkill(hook, skill) {
  const key = markerKey(hook);
  if (!key || typeof skill !== 'string' || !skill.trim()) return false;
  const skills = recordedSkills(hook);
  if (skills.includes(skill.trim()) || skills.length >= MAX_SKILLS) return true;
  skills.push(skill.trim());
  writeSessionFile(sessionFile(PREFIX, key), JSON.stringify({ skills }));
  return true;
}

/**
 * A new turn begins: forget the main thread's skills. Subagent markers are
 * keyed by their own agent id and are not touched.
 * @param {object} hook UserPromptSubmit payload
 */
function clearTurn(hook) {
  if (!hook || typeof hook.session_id !== 'string' || !SAFE_ID_RE.test(hook.session_id)) return;
  try { fs.unlinkSync(sessionFile(PREFIX, hook.session_id)); } catch { /* none yet */ }
}

/**
 * Did the caller's current turn invoke the devops skill `name`? Same name
 * rule as the transcript check (lib/skill-names.isDevopsSkill: namespaced or
 * bare current name, a namespaced old name; a bare old name is a consumer skill).
 * @param {object} hook parsed payload
 * @param {string} name current devops skill name (`auto-issue`)
 * @returns {boolean}
 */
function skillMarkedThisTurn(hook, name) {
  return recordedSkills(hook).some(s => isDevopsSkill(s, name));
}

module.exports = { PREFIX, markerKey, recordedSkills, recordSkill, clearTurn, skillMarkedThisTurn };
