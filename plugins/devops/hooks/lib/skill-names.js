'use strict';
/**
 * @module skill-names
 * @version 0.4.0
 * @plugin devops
 * @description The one table of skill names that changed in PR 2 and PR 3 of
 *   the skill restructure
 *   (docs/superpowers/specs/2026-09-24-skill-restructure-design.md) and the
 *   helpers every hook, MCP tool and script uses to stay compatible with the
 *   OLD names:
 *
 *   - `RENAMED` — 1:1 renames (`ship` → `do-ship`, `fix` → `auto-fix`, …).
 *   - `FOLDED`  — skills whose body became a mode of another skill
 *     (`run-backlog` → `do-run` mode `backlog`, `promote` → `do-ship` mode
 *     `promote`).
 *   - `RETIRED` — PR 3: skills that are no skill at all any more; their body
 *     is a deep-knowledge doc and their triggers live in a hook
 *     (`setup-readme`, `auto-graph`, `auto-usage`, `claude-strict`; later
 *     `setup-project`). An old
 *     slash name maps to that mechanism, NEVER to a Skill: the router has no
 *     alias for them (`ALIAS_MAP` is built from RENAMED + FOLDED only), and
 *     `canonicalSkillName` passes them through unchanged — a name that is
 *     not in `skills/` is never mandated.
 *   - `canonicalSkillName(name)` — old or new name (with or without a
 *     `devops:` prefix) → the current skill name. A session that straddles
 *     the update recorded `devops:ship`; the router must read that as
 *     `do-ship` and not re-nudge.
 *   - `isDevopsSkill(raw, name)` — did a recorded invocation run the DEVOPS
 *     skill `name`? `devops:<old|new>` and a bare NEW name count; a bare OLD
 *     name does not (it can only be a consumer skill of that name now).
 *   - `legacyNamesOf(name)` — every old name that now lands on `name`.
 *   - `extensionNameCandidates(name, mode)` / `resolveExtensionFile(...)` —
 *     consumer extensions live at `{project}/.claude/skills/<name>/` and
 *     `~/.claude/skills/<name>/`; the loader looks up the NEW name first and
 *     falls back to the OLD one, so an extension written before the rename
 *     keeps working.
 *
 *   Names only — no fs access at module load (hook hot paths require this).
 */

const fs = require('fs');
const path = require('path');

/** Old name → new name, 1:1. */
const RENAMED = Object.freeze({
  'claude-batch': 'do-batch',
  'claude-learn': 'do-learn',
  concept: 'auto-concept',
  fix: 'auto-fix',
  'web-guide': 'auto-guide',
  'claude-extend-skill': 'auto-extend',
  ship: 'do-ship',
  'tune-harden': 'auto-harden',
  'tune-polish': 'auto-polish',
  'run-agents': 'auto-agents',
  'setup-issue': 'auto-issue',
  // 2026-09-24: out of the slash menu, reached through ship_hygiene's card
  // hint and its trigger phrases (skill-restructure spec § Addendum).
  'setup-cleanup': 'auto-cleanup',
});

/** Old name → the skill + mode its body moved into. */
const FOLDED = Object.freeze({
  'run-backlog': Object.freeze({ skill: 'do-run', mode: 'backlog' }),
  'run-autonomous': Object.freeze({ skill: 'do-run', mode: 'autonomous' }),
  'run-burn': Object.freeze({ skill: 'do-run', mode: 'burn' }),
  'tune-rethink': Object.freeze({ skill: 'do-run', mode: 'rethink' }),
  'tune-audit': Object.freeze({ skill: 'do-run', mode: 'audit' }),
  promote: Object.freeze({ skill: 'do-ship', mode: 'promote' }),
});

/**
 * The `triggers:` frontmatter of every folded skill as it stood before PR 2,
 * per mode. Two readers: the router tags a phrase hit with its mode (and lets
 * the promote phrases through although do-ship is owned by a dedicated
 * hook), and `scripts/skill-graph.test.js` asserts every phrase still sits in
 * the owner's `triggers:`.
 */
const FOLDED_TRIGGERS = Object.freeze({
  'run-backlog': Object.freeze({
    en: ['backlog runner', 'run the backlog'],
    de: ['backlog abarbeiten', 'arbeite den backlog ab', 'milestones abarbeiten', 'arbeite die milestones ab', 'arbeite den milestone ab'],
  }),
  'run-autonomous': Object.freeze({
    en: ['autonomous', 'run autonomous', "run this while I'm away", 'afk mode', 'autopilot'],
  }),
  'run-burn': Object.freeze({ en: ['/run-burn'] }),
  'tune-rethink': Object.freeze({
    en: ['stuck', 'unstuck', 'rethink', 'fresh approach'],
    de: ['festgefahren', 'wir drehen uns im Kreis', 'neu denken', 'frischer Ansatz', 'komplett neu denken', 'das führt zu nichts'],
  }),
  'tune-audit': Object.freeze({
    en: ['audit', 'full audit'],
    de: ['voller Audit', 'auditiere', 'auditieren', 'prüf alles', 'komplett durchchecken', 'health check der App', 'Qualitätsaudit'],
  }),
  promote: Object.freeze({
    en: ['release', 'promote', 'promotion', 'channel release', 'promote to beta', 'promote to stable'],
    de: ['auf stable heben'],
  }),
});

/**
 * Old skill name → where it went (PR 3). `doc` is the deep-knowledge file that
 * carries the body; `home` names the mechanism that now owns the triggers and
 * the behaviour. The dispatch pointer table (`hooks/lib/knowledge-pointers.js`)
 * is keyed by `doc`; `prompt.strict.enforce` owns the strict switch.
 */
const RETIRED = Object.freeze({
  'setup-readme': Object.freeze({
    doc: 'readme-standards.md',
    home: 'pre.readme.standards (first README write/edit) + prompt.knowledge.dispatch pointer',
  }),
  'auto-graph': Object.freeze({
    doc: 'graphify.md',
    home: 'ss.graphify / pre.tokens.guard / post.graphify.* + prompt.knowledge.dispatch pointer',
  }),
  'auto-usage': Object.freeze({
    doc: 'usage.md',
    home: 'MCP get_usage (dotclaude-completion) + prompt.knowledge.dispatch pointer',
  }),
  'claude-strict': Object.freeze({
    doc: 'strict.md',
    home: 'prompt.strict.enforce / pre.strict.agent-gate / stop.strict.release + do-run Q3 "Nur das" + prompt.knowledge.dispatch pointer',
  }),
  // 2026-09-24 (skill-restructure spec § Addendum)
  'setup-project': Object.freeze({
    doc: 'project-setup.md',
    home: 'ss.project.setup (runtime ignores → .git/info/exclude, one-time offer in a new repo) + prompt.knowledge.dispatch pointer',
  }),
});

/**
 * The `triggers:` frontmatter of every retired skill as it stood at
 * retirement, plus the German glossary (`triggers.de.txt`) of claude-strict.
 * `scripts/skill-graph.test.js` asserts every phrase still reaches its new
 * home (the dispatch pointer, and for strict the hook's switch).
 */
const RETIRED_TRIGGERS = Object.freeze({
  'setup-readme': Object.freeze({
    en: ['create a readme', 'update the readme', 'improve the readme'],
    de: ['README erstellen', 'README aktualisieren'],
  }),
  'auto-graph': Object.freeze({
    en: ['knowledge graph', 'graphify', 'code graph', '/auto-graph'],
  }),
  'auto-usage': Object.freeze({
    en: ['refresh usage', 'token budget'],
    de: ['wie viel hab ich verbraucht'],
  }),
  'claude-strict': Object.freeze({
    en: ['/claude-strict', 'strict'],
    de: ['strikt', 'genau so und nicht mehr', 'nur das ändern', 'nichts anderes anfassen',
      'strict modus', 'nur den rand', 'strict an', 'strict aus'],
  }),
  'setup-project': Object.freeze({
    en: ['set up this project', 'init repo', 'audit gitignore', 'add license', 'fix gitignore', 'repo hygiene', '/setup-project'],
    de: ['Projekt einrichten', 'Repo aufsetzen'],
  }),
});

/**
 * Where a retired skill went (`devops:auto-usage` → `{doc, home}`), else null.
 * @param {string} raw
 * @returns {{doc:string, home:string}|null}
 */
function retiredSkill(raw) {
  const name = stripNamespace(raw);
  return Object.prototype.hasOwnProperty.call(RETIRED, name) ? RETIRED[name] : null;
}

/**
 * The mode a trigger phrase of `skill` belongs to (from FOLDED_TRIGGERS),
 * else null. Case-insensitive.
 * @param {string} skill current skill name
 * @param {string} phrase
 * @returns {string|null}
 */
function modeForPhrase(skill, phrase) {
  if (typeof phrase !== 'string') return null;
  const lower = phrase.trim().toLowerCase();
  for (const [oldName, byLang] of Object.entries(FOLDED_TRIGGERS)) {
    const fold = FOLDED[oldName];
    if (!fold || fold.skill !== skill) continue;
    for (const list of Object.values(byLang)) {
      if (list.some(p => p.toLowerCase() === lower)) return fold.mode;
    }
  }
  return null;
}

/** `devops:Ship ` → `ship`; '' for anything non-string. */
function stripNamespace(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/^\//, '');
  const idx = s.lastIndexOf(':');
  return idx === -1 ? s : s.slice(idx + 1);
}

/**
 * Old or new skill name → current skill name. Unknown names pass through
 * (normalized), so a consumer skill or a third-party one is never renamed.
 * A RETIRED name passes through too: it names no skill, see `retiredSkill`.
 * @param {string} raw
 * @returns {string}
 */
function canonicalSkillName(raw) {
  const name = stripNamespace(raw);
  if (Object.prototype.hasOwnProperty.call(RENAMED, name)) return RENAMED[name];
  if (Object.prototype.hasOwnProperty.call(FOLDED, name)) return FOLDED[name].skill;
  return name;
}

/**
 * The mode an old folded name stands for (`run-burn` → `burn`), else null.
 * @param {string} raw
 * @returns {string|null}
 */
function foldedMode(raw) {
  const name = stripNamespace(raw);
  return Object.prototype.hasOwnProperty.call(FOLDED, name) ? FOLDED[name].mode : null;
}

/**
 * Every old name that now resolves to `name` (renames and folds).
 * @param {string} name current skill name
 * @returns {string[]}
 */
function legacyNamesOf(name) {
  const target = stripNamespace(name);
  const out = [];
  for (const [oldName, newName] of Object.entries(RENAMED)) {
    if (newName === target) out.push(oldName);
  }
  for (const [oldName, fold] of Object.entries(FOLDED)) {
    if (fold.skill === target) out.push(oldName);
  }
  return out;
}

/** Is `raw` (old or new, with or without prefix) the skill `name`? Name
 *  arithmetic only — for "did the DEVOPS skill run?" use `isDevopsSkill`. */
function isSkill(raw, name) {
  return canonicalSkillName(raw) === canonicalSkillName(name);
}

/** Is `name` (namespace stripped) a pre-PR-2 name (renamed or folded)? */
function isOldName(raw) {
  const name = stripNamespace(raw);
  return Object.prototype.hasOwnProperty.call(RENAMED, name)
    || Object.prototype.hasOwnProperty.call(FOLDED, name);
}

/** `devops:do-ship` → 'devops'; `do-ship` → ''. Lowercased, slash dropped. */
function namespaceOf(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/^\//, '');
  const idx = s.lastIndexOf(':');
  return idx === -1 ? '' : s.slice(0, idx);
}

/**
 * Does a recorded invocation name (`Skill` input or `<command-name>`) stand
 * for the DEVOPS plugin's skill `name`?
 *   - `devops:<old|new>` → yes when it canonicalizes to `name` (a session that
 *     straddles the update recorded `devops:fix`);
 *   - bare NEW name (`auto-fix`) → yes;
 *   - bare OLD name (`fix`, `setup-issue`) → NO: after the rename the plugin
 *     has no skill of that name, so a bare old name is a consumer project/user
 *     skill — typically an extension directory still under the old name
 *     (`.claude/skills/fix/`) — not the devops skill;
 *   - any other namespace (`other:auto-fix`) → no.
 * @param {string} raw
 * @param {string} name current skill name
 * @returns {boolean}
 */
function isDevopsSkill(raw, name) {
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const ns = namespaceOf(raw);
  if (ns && ns !== 'devops') return false;
  if (!ns && isOldName(raw)) return false;
  return canonicalSkillName(raw) === canonicalSkillName(name);
}

/**
 * Extension directory names to try, in order: the new name first, then the
 * old one. For a mode (`do-run` + `backlog`) the fallback is the folded
 * skill's old name (`run-backlog`); for a plain rename it is the old 1:1 name.
 * @param {string} name current skill name (an old name is canonicalized)
 * @param {string} [mode]
 * @returns {string[]}
 */
function extensionNameCandidates(name, mode) {
  const current = canonicalSkillName(name);
  const out = [current];
  for (const [oldName, newName] of Object.entries(RENAMED)) {
    if (newName === current) out.push(oldName);
  }
  if (mode) {
    for (const [oldName, fold] of Object.entries(FOLDED)) {
      if (fold.skill === current && fold.mode === mode) out.push(oldName);
    }
  }
  return out;
}

/**
 * First existing `<base>/.claude/skills/<candidate>/<file>` — new name first,
 * old name as fallback. `base` is a project root or the home directory.
 * @param {string} base
 * @param {string} name
 * @param {string} file e.g. 'reference.md'
 * @param {{mode?:string, exists?:(p:string)=>boolean}} [opts]
 * @returns {string|null}
 */
function resolveExtensionFile(base, name, file, opts = {}) {
  if (typeof base !== 'string' || !base) return null;
  const exists = typeof opts.exists === 'function' ? opts.exists : (p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  };
  for (const candidate of extensionNameCandidates(name, opts.mode)) {
    const p = path.join(base, '.claude', 'skills', candidate, file);
    if (exists(p)) return p;
  }
  return null;
}

module.exports = {
  RENAMED,
  FOLDED,
  FOLDED_TRIGGERS,
  RETIRED,
  RETIRED_TRIGGERS,
  retiredSkill,
  modeForPhrase,
  stripNamespace,
  canonicalSkillName,
  foldedMode,
  legacyNamesOf,
  isSkill,
  isOldName,
  namespaceOf,
  isDevopsSkill,
  extensionNameCandidates,
  resolveExtensionFile,
};
