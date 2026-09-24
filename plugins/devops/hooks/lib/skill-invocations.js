/**
 * @module skill-invocations
 * @version 0.4.0
 * @description Which skills did the transcript already invoke? Shared by
 *   `prompt.skill.enforce` (the trigger router must not re-mandate a skill
 *   that is already running this session), `stop.guide.handoff` (the turn
 *   already invoked auto-guide), `post.flow.debug` (auto-fix is
 *   already active this turn) and `pre.issue.guard` (auto-issue
 *   ran this turn). Both a Skill tool_use and a slash-started skill
 *   (`<command-name>/devops:x</command-name>`, with or without the plugin
 *   prefix) count.
 *
 *   Old names count only when namespaced (PR 2 renames, `skill-names.js`):
 *   a session that invoked `devops:ship` before the update reads as having
 *   run `do-ship`, but a BARE old name (`fix`, `setup-issue`) is a consumer
 *   project/user skill — an extension directory still under the old name —
 *   and never stands for the devops skill (`isDevopsSkill`). The session-wide
 *   set holds the recorded name (namespace stripped) and, for a devops
 *   invocation, its current name plus `<skill>#<mode>` when a mode is known
 *   (folded old name `devops:tune-audit` → `do-run#audit`; `args` / slash
 *   `<command-args>` whose first token is a mode of the skill → `do-run#audit`),
 *   so the router can tell a do-run audit from a do-run rethink.
 *   `skillInvokedThisTurn` predicates compare with `isDevopsSkill`.
 *
 *   Two scans, deliberately different in cost:
 *     - `invokedSkillsInTranscript` — session-wide, a single regex pass over
 *       the raw JSONL text (no per-line JSON.parse), so a multi-MB tail stays
 *       within the router's latency budget.
 *     - `skillInvokedThisTurn` — walks back line by line to the turn's opening
 *       prompt (same walk as card-guard.showWidgetCalledThisTurn), parsing
 *       only the lines it visits.
 *
 *   Transcript shape (verified against real Claude Code transcripts):
 *   `{"type":"tool_use","id":…,"name":"Skill","input":{"skill":"devops:auto-concept",…}}`
 *   — the skill name may carry a `plugin:` namespace, which is stripped.
 */

const { canonicalSkillName, foldedMode, isOldName, namespaceOf, FOLDED } = require('./skill-names');

/** Current skill → its folded modes (`do-run` → backlog, autonomous, …). */
const MODES_BY_SKILL = (() => {
  const out = {};
  for (const f of Object.values(FOLDED)) (out[f.skill] = out[f.skill] || new Set()).add(f.mode);
  return out;
})();

/** Router key for a skill + mode (`do-run#audit`). */
function modeKey(skill, mode) {
  return `${skill}#${mode}`;
}

/** The Skill tool — bare or under a connector namespace (`…__Skill`). */
function isSkillTool(name) {
  return typeof name === 'string' && (name === 'Skill' || name.endsWith('__Skill'));
}

/** A user-role entry the user (or a hook on their behalf) wrote — as opposed
 *  to one that only carries tool results, or an `isMeta` entry the harness
 *  inserts mid-turn (a loaded skill's body). Marks where the current turn began. */
function isPromptEntry(entry) {
  if (!entry || entry.isMeta === true) return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some(b => b && b.type !== 'tool_result');
}

/** `devops:auto-concept` → `auto-concept`; lowercased; '' for anything non-string. */
function normalizeSkillName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase();
  const idx = s.lastIndexOf(':');
  return idx === -1 ? s : s.slice(idx + 1);
}

const SKILL_INVOKE_RE =
  /"name"\s*:\s*"(?:[\w.-]+__)?Skill"\s*,\s*"input"\s*:\s*\{\s*"skill"\s*:\s*"([^"\\]+)"(?:\s*,\s*"args"\s*:\s*"((?:[^"\\]|\\.)*)")?/g;

/** A slash-started skill: the harness records `<command-name>/devops:x</command-name>`
 *  (or `/x`, or no slash) in the user entry instead of a Skill tool_use. */
const COMMAND_NAME_RE = /<command-name>\s*\/?([\w.:-]+)\s*<\/command-name>/g;

/**
 * Raw names of every slash command recorded in a text (`devops:auto-concept`, `auto-fix`).
 * @param {string} text
 * @returns {string[]}
 */
function commandNamesIn(text) {
  if (typeof text !== 'string' || !text.includes('<command-name>')) return [];
  return [...text.matchAll(COMMAND_NAME_RE)].map(m => m[1]);
}

/** `<command-args>…</command-args>` right after a `<command-name>` (JSONL-escaped newlines allowed). */
const COMMAND_ARGS_AFTER_RE =
  /^(?:\s|\\n|<command-message>[^<]*<\/command-message>)*<command-args>([^<]*)<\/command-args>/;

/** Mode named by an args string: its first token, when that is a folded mode of `skill`. */
function modeFromArgs(skill, args) {
  if (typeof args !== 'string') return null;
  const first = args.replace(/\\n/g, ' ').trim().split(/\s+/)[0] || '';
  const token = first.toLowerCase().replace(/^--(?:mode=)?/, '');
  const modes = MODES_BY_SKILL[skill];
  return modes && modes.has(token) ? token : null;
}

/**
 * Add the keys one recorded invocation contributes to the invoked set.
 * @param {Set<string>} out
 * @param {string} raw recorded name (`devops:tune-audit`, `fix`, `do-run`)
 * @param {string|null} args Skill args / slash `<command-args>`
 */
function addInvocation(out, raw, args) {
  const name = normalizeSkillName(raw);
  if (!name) return;
  const ns = namespaceOf(raw);
  if (ns && ns !== 'devops') {
    // Another plugin's skill — never the devops skill of the same bare name.
    out.add(`${ns}:${name}`);
    return;
  }
  out.add(name);
  // A bare old name is a consumer skill (an extension under the old name).
  if (!ns && isOldName(name)) return;
  const current = canonicalSkillName(name);
  out.add(current);
  const mode = foldedMode(name) || modeFromArgs(current, args);
  if (mode) out.add(modeKey(current, mode));
}

/**
 * Every skill name invoked anywhere in the (tail of the) transcript — via
 * the Skill tool or as a slash command.
 * @param {string} transcriptContent raw JSONL
 * @returns {Set<string>} normalized names: the recorded name, and for a
 *   devops invocation its current name and `<skill>#<mode>` when a mode is
 *   known (`devops:ship` → `ship` + `do-ship`; `devops:tune-audit` →
 *   `tune-audit` + `do-run` + `do-run#audit`). A bare old name (`fix`) adds
 *   only itself; another plugin's skill adds only `<ns>:<name>`.
 */
function invokedSkillsInTranscript(transcriptContent) {
  const out = new Set();
  if (typeof transcriptContent !== 'string' || !transcriptContent) return out;
  for (const m of transcriptContent.matchAll(SKILL_INVOKE_RE)) {
    addInvocation(out, m[1], m[2] === undefined ? null : m[2]);
  }
  if (transcriptContent.includes('<command-name>')) {
    for (const m of transcriptContent.matchAll(COMMAND_NAME_RE)) {
      const after = transcriptContent.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      const a = COMMAND_ARGS_AFTER_RE.exec(after);
      addInvocation(out, m[1], a ? a[1] : null);
    }
  }
  return out;
}

/** Plain text of a user entry (string content or its text blocks). */
function userEntryText(entry) {
  const content = entry && entry.message && entry.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('');
}

/** Does a user entry carry a slash command that satisfies `predicate`? */
function commandMatches(entry, predicate) {
  for (const raw of commandNamesIn(userEntryText(entry))) {
    try {
      if (predicate({ skill: raw }, normalizeSkillName(raw))) return true;
    } catch { /* a throwing predicate is a non-match */ }
  }
  return false;
}

/**
 * Did THIS turn invoke a Skill whose input satisfies `predicate`? Scans back
 * from the end of the transcript to the turn's opening prompt. A slash
 * command (`<command-name>/devops:x</command-name>`) in a user entry of the
 * turn — the opening prompt included — counts as an invocation with input
 * `{ skill: "<raw name>" }`.
 * @param {string} transcriptContent raw JSONL
 * @param {(input:object, name:string)=>boolean} predicate receives the raw
 *   tool input and the normalized `input.skill` name
 * @returns {boolean}
 */
function skillInvokedThisTurn(transcriptContent, predicate) {
  if (typeof transcriptContent !== 'string' || !transcriptContent) return false;
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'user') {
      if (commandMatches(entry, predicate)) return true;
      if (isPromptEntry(entry)) return false;
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== 'tool_use' || !isSkillTool(block.name)) continue;
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      try {
        if (predicate(input, normalizeSkillName(input.skill))) return true;
      } catch { /* a throwing predicate is a non-match */ }
    }
  }
  return false;
}

/**
 * Text of the turn's opening user prompt (the last prompt entry), or ''.
 * Lets a Stop hook classify the turn (silent / machine) from the transcript
 * itself instead of a session flag another Stop hook may already have deleted.
 * @param {string} transcriptContent raw JSONL
 * @returns {string}
 */
function lastUserPromptText(transcriptContent) {
  if (typeof transcriptContent !== 'string' || !transcriptContent) return '';
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || entry.type !== 'user' || !isPromptEntry(entry)) continue;
    return userEntryText(entry);
  }
  return '';
}

/**
 * Text of EVERY assistant entry of the current turn (back to its opening
 * prompt), oldest first — one string per entry. Claude Code writes each
 * content block as its own entry, so the turn's last entry may hold only
 * the completion card while the answer sits in earlier ones.
 * @param {string} transcriptContent raw JSONL
 * @returns {string[]}
 */
function turnAssistantTexts(transcriptContent) {
  if (typeof transcriptContent !== 'string' || !transcriptContent) return [];
  const out = [];
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type === 'user' && isPromptEntry(entry)) break;
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('');
    if (text) out.push(text);
  }
  return out.reverse();
}

module.exports = {
  isSkillTool,
  isPromptEntry,
  normalizeSkillName,
  SKILL_INVOKE_RE,
  COMMAND_NAME_RE,
  commandNamesIn,
  modeKey,
  modeFromArgs,
  invokedSkillsInTranscript,
  skillInvokedThisTurn,
  lastUserPromptText,
  turnAssistantTexts,
};
