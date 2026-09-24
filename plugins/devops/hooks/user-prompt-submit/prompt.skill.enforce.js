#!/usr/bin/env node
/**
 * @hook prompt.skill.enforce
 * @version 0.6.0
 * @event UserPromptSubmit
 * @plugin devops
 * @description Detects inline skill commands (e.g. /do-learn, /do-ship) mentioned in a user
 *   prompt (typed as text, not invoked as a real slash command) and injects a
 *   mandatory instruction to load the referenced skill via the Skill tool
 *   before answering.
 *
 *   Why (#235): when a user writes "/concept lass uns das machen…"
 *   inside a longer message, the harness does not expand it as a slash
 *   command — no skill is loaded, and Claude predictably improvises the
 *   skill's workflow from memory, violating skill contracts (bridge server,
 *   decision panel, gates). This hook closes the input side by nudging the
 *   skill load BEFORE any work happens.
 *
 *   A real slash-command invocation arrives with the skill already loaded
 *   (<command-name> tag) — those turns are skipped. Mentions that do not
 *   correspond to an existing skill directory, or that sit inside code or
 *   quotes, are ignored.
 *
 *   Trigger ROUTER (lib/skill-trigger-router.js — read its header for the
 *   matching rules): pre-PR-2 names as aliases (`/claude-learn` → do-learn,
 *   `/run-backlog` → do-run mode backlog), multi-word
 *   `triggers:` phrases, non-skill slash forms, a curated single-word
 *   allowlist, and language-independent error patterns (→ auto-fix). Context
 *   filters applied here, before anything is emitted:
 *     - machine prompts (cron `Silently …`, `<<autonomous-loop>>`,
 *       `AUTONOMOUS_*:` / `RUN_BACKLOG_AUTOSTART:`, `<scheduled-task`,
 *       task notifications, channel messages) → the whole hook is silent;
 *     - batch collect mode active or being activated, or an AFK lockout
 *       armed → the router is silent;
 *     - a routed (not typed) skill already invoked this session (Skill tool
 *       or slash command, old or new name), `auto-concept` while a VALID, non-stale
 *       `.claude/concept-active.json` exists (ss.concept.resume's
 *       isValidState + isStale — a leftover copied into a new worktree does
 *       not mute it), auto-polish/auto-harden while claude-strict is active,
 *       `auto-fix` in a consumer project when the prompt is about the devops
 *       plugin (prompt.plugin.scope routes that to an upstream issue) → that
 *       entry is dropped.
 *
 *   Soft matches: a trigger-PHRASE match (not an alias, mention or error
 *   pattern) becomes a NON-mandatory hint instead of a mandate when the
 *   session runs in the plugin source repo (plugin-scope.isPluginSourceRepo
 *   — there, "der backlog runner parkt zu früh" talks about the component),
 *   or when a meta word (skill, hook, runner, guard, hint, …) stands next to
 *   the phrase.
 *
 *   Pending guide hint: when stop.guide.handoff recorded a web hand-off in a
 *   card turn, the next real user prompt gets ONE non-mandatory hint to
 *   offer auto-guide; the record is cleared on use.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { isMachineTurn, isSilent, isScheduledTask } = require('./prompt.flow.silent-turn');
const { isMachinePrompt, isModeActive, detectActivation, willBeCollected } = require('../lib/batch-state');
const { parseHookInput } = require('../lib/hook-input');
const { loadAllSkills } = require('../lib/skill-meta');
const { routeMessage, stripCodeAndQuotes } = require('../lib/skill-trigger-router');
const { projectRoot } = require('../lib/project-root');

// A mention is "/<name>" preceded by start-of-string, whitespace, or common
// opening punctuation — NOT by a path segment ("docs/devops-guide.md"). The
// captured name is validated against the plugin's skill directories downstream,
// so generic slashes ("/oder", "/help") that aren't real skills are dropped.
const MENTION_RE = /(^|[\s([{"'`>])\/([a-z][a-z0-9-]*)/gi;

/** Tail of the transcript scanned for "skill already invoked this session". */
const INVOKED_SCAN_BYTES = 4 * 1024 * 1024;

/** Skills auto-polish/auto-harden conflict with while strict mode is on. */
const STRICT_SUPPRESSED = new Set(['auto-polish', 'auto-harden']);

/**
 * Not typed by the user: cron/loop ticks, AFK resumes, scheduled tasks,
 * task notifications, channel messages.
 * @param {string} message
 */
function isNonUserPrompt(message) {
  if (typeof message !== 'string') return true;
  return isMachinePrompt(message) || isMachineTurn(message) || isSilent(message) || isScheduledTask(message);
}

/**
 * Extract inline skill mentions from a user prompt (outside code/quotes).
 * @param {string} message — raw user prompt
 * @param {string[]} knownSkills — existing skill directory names
 * @returns {string[]} deduped skill names (lowercase) in order of appearance
 */
function detectInlineSkillMentions(message, knownSkills) {
  if (typeof message !== 'string' || !message) return [];
  // Already-expanded slash command → the skill is loaded this turn.
  if (message.includes('<command-name>')) return [];
  // Machine turns are not the user typing (observed 2026-09-14: a red-team
  // report mentioning four run-* skills demanded four Skill loads).
  if (isNonUserPrompt(message)) return [];
  const known = new Set((knownSkills || []).map(s => String(s).toLowerCase()));
  const found = [];
  for (const m of stripCodeAndQuotes(message).matchAll(MENTION_RE)) {
    const name = m[2].toLowerCase().replace(/-+$/, '');
    if (known.has(name) && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Absolute path to the plugin's `skills/` root. */
const SKILLS_ROOT = path.join(__dirname, '..', '..', 'skills');

/**
 * Existing skill directory names under the plugin's skills/ root.
 * @returns {string[]}
 */
function listPluginSkills() {
  try {
    return fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

let cachedSkills = null;
function loadSkillsCached() {
  if (cachedSkills === null) cachedSkills = loadAllSkills(SKILLS_ROOT);
  return cachedSkills;
}

/** Read the last `bytes` of a file; '' on any error. */
function readTail(file, bytes) {
  if (typeof file !== 'string' || !file) return '';
  let fd;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/** A concept page is open: a state file that passes the same validity rules
 *  the resume hook and the completion card apply (ss.concept.resume's
 *  isValidState + isStale, as mode-state.readConceptState) — a stale or
 *  invalid leftover must not mute concept routing forever. `/auto-concept` state
 *  is keyed to the session cwd by design (CONVENTIONS.md → Project-Rooted
 *  State); the project root is checked too in case the session has since
 *  cd'ed into a subdirectory. */
function conceptActive(cwd) {
  const rel = path.join('.claude', 'concept-active.json');
  let R;
  try { R = require('../session-start/ss.concept.resume'); } catch { return false; }
  const live = (dir) => {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
      return R.isValidState(state) && !R.isStale(state);
    } catch {
      return false;
    }
  };
  if (live(cwd)) return true;
  let root;
  try { root = projectRoot(cwd); } catch { return false; }
  return root !== cwd && live(root);
}

/** The session runs inside the devops plugin's own source repo. */
function inPluginSourceRepo(cwd) {
  try {
    const { isPluginSourceRepo } = require('../lib/plugin-scope');
    const { findRepoRoot } = require('../lib/project-root');
    return isPluginSourceRepo(findRepoRoot(cwd));
  } catch {
    return false;
  }
}

/** Router must stay silent: batch mode on/activating, or an AFK lockout. */
function routerMuted(message, cwd) {
  try { if (isModeActive(cwd)) return true; } catch {}
  try { if (detectActivation(message).activating) return true; } catch {}
  try {
    const { readLockout } = require('../../scripts/autonomous-lockout');
    if (readLockout(cwd) || readLockout(projectRoot(cwd))) return true;
  } catch {}
  return false;
}

/**
 * Drop routed (non-explicit) entries that would contradict running state.
 * Each check runs lazily, only when an entry needs it.
 */
function filterRouted(entries, hook, message, cwd) {
  let invoked = null;
  const invokedSkills = () => {
    if (invoked === null) {
      const { invokedSkillsInTranscript } = require('../lib/skill-invocations');
      invoked = invokedSkillsInTranscript(readTail(hook.transcript_path, INVOKED_SCAN_BYTES));
    }
    return invoked;
  };
  let strict = null;
  const strictActive = () => {
    if (strict === null) {
      // No worktree inheritance: that needs git (~40 ms) and only matters for
      // agents' sub-worktrees, whose prompts are not the user's.
      try { strict = require('../lib/strict-state').isActive(cwd); } catch { strict = false; }
    }
    return strict;
  };
  const consumerPluginTalk = () => {
    try {
      const { hasPluginSignal } = require('./prompt.plugin.scope');
      if (!hasPluginSignal(message)) return false;
      return !inPluginSourceRepo(cwd);
    } catch {
      return false;
    }
  };

  return entries.filter(e => {
    if (e.explicit) return true;
    if (e.skill === 'auto-concept' && conceptActive(cwd)) return false;
    if (STRICT_SUPPRESSED.has(e.skill) && strictActive()) return false;
    if (e.skill === 'auto-fix' && consumerPluginTalk()) return false;
    if (invokedSkills().has(e.skill)) return false;
    return true;
  });
}

/**
 * Split routed entries into mandates and soft hints. A trigger-phrase match
 * is soft when a meta word stands next to it, or when the session runs in
 * the plugin source repo (checked lazily, only for phrase matches).
 * @returns {{hard:object[], soft:object[]}}
 */
function splitSoft(entries, cwd) {
  let source = null;
  const sourceRepo = () => {
    if (source === null) source = inPluginSourceRepo(cwd);
    return source;
  };
  const hard = [];
  const soft = [];
  for (const e of entries) {
    if (!e.explicit && e.phrase && (e.nearMeta || sourceRepo())) soft.push(e);
    else hard.push(e);
  }
  return { hard, soft };
}

/**
 * Non-mandatory hint for soft matches.
 * @param {{skill:string, reason:string}[]} entries
 * @returns {string}
 */
function buildSoftHint(entries) {
  const named = entries.map(e => `${e.skill} (${e.reason})`).join(', ');
  return [
    `[prompt.skill.enforce] Possible skill match: ${named}.`,
    'NOT mandatory: the prompt names a plugin component or runs in the plugin',
    'source repo, so it may be talking ABOUT the skill rather than asking to run',
    'it. Invoke it via the Skill tool only if the user wants that workflow run.',
  ].join('\n') + '\n';
}

/**
 * Build the combined mandatory-invoke instruction.
 * @param {{skill:string, reason:string, mode?:string}[]} entries — a `mode`
 *   (folded skill, e.g. do-run `backlog`) is passed as the skill's args
 * @returns {string}
 */
function buildInstruction(entries) {
  const calls = entries
    .map(e => (e.mode ? `  Skill("${e.skill}") with args "${e.mode}"` : `  Skill("${e.skill}")`))
    .join('\n');
  const named = entries.map(e => `${e.skill} (${e.reason})`).join(', ');
  return [
    `[prompt.skill.enforce] The user message references or triggers: ${named}.`,
    '',
    'MANDATORY: invoke the Skill tool for each referenced skill BEFORE any other',
    'response or action this turn:',
    calls,
    '',
    'Do NOT improvise the skill\'s workflow from memory — a mentioned-but-not-loaded',
    'skill predictably violates its contract (bridge server, decision panel, gates).',
    'If a skill turns out not to fit the request after loading, you may set it aside.',
  ].join('\n') + '\n';
}

/**
 * Compute the hook's output for one payload ('' = silent).
 * @param {object} hook parsed stdin payload
 * @returns {string}
 */
function run(hook) {
  const raw = hook.prompt || hook.user_message || hook.message || '';
  const message = typeof raw === 'string' ? raw : '';
  if (!message) return '';
  if (message.includes('<command-name>') || isNonUserPrompt(message)) return '';

  const cwd = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : process.cwd();
  const parts = [];

  const mentions = detectInlineSkillMentions(message, listPluginSkills());
  const entries = mentions.map(skill => ({ skill, reason: 'inline mention', explicit: true }));
  let soft = [];

  if (!routerMuted(message, cwd)) {
    const routed = routeMessage(message, loadSkillsCached())
      .filter(r => !entries.some(e => e.skill === r.skill));
    const split = splitSoft(filterRouted(routed, hook, message, cwd), cwd);
    for (const r of split.hard) entries.push(r);
    soft = split.soft;
  }

  if (entries.length) parts.push(buildInstruction(entries));
  if (soft.length) parts.push(buildSoftHint(soft));

  // A prompt that batch mode collects never reaches the model — keep the
  // pending hint for the next prompt that does.
  let collected = false;
  try { collected = willBeCollected(hook); } catch {}
  if (!collected) {
    try {
      const { consumePendingHandoff, buildPendingHint } = require('../lib/guide-pending');
      const service = consumePendingHandoff(hook.session_id);
      if (service) parts.push(buildPendingHint(service));
    } catch {}
  }

  return parts.join('\n');
}

if (require.main === module) {
  let inputData = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inputData += d; });
  process.stdin.on('end', () => {
    try {
      const hook = parseHookInput(inputData);
      if (hook) {
        const out = run(hook);
        if (out) process.stdout.write(out);
      }
    } catch { /* never surface an internal error */ }
    // No process.exit(): stdout to a pipe may still be flushing.
    process.exitCode = 0;
  });
}

module.exports = {
  detectInlineSkillMentions,
  isNonUserPrompt,
  listPluginSkills,
  MENTION_RE,
  buildInstruction,
  buildSoftHint,
  loadSkillsCached,
  filterRouted,
  splitSoft,
  conceptActive,
  inPluginSourceRepo,
  routerMuted,
  run,
  SKILLS_ROOT,
};
