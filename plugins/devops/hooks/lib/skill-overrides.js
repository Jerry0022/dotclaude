'use strict';
/**
 * @module skill-overrides
 * @version 0.1.0
 * @plugin devops
 * @description The ONE override loader for every devops skill (replaces the
 *   per-skill "Step 0 — Load Extensions" prose). When a skill starts, the
 *   hooks post.skill.overrides (Skill tool) and prompt.skill.overrides (typed
 *   `/skill`) call `overrideBlock()`:
 *
 *   1. resolve — `~/.claude/skills/<skill>/reference.md` (global) and
 *      `{project}/.claude/skills/<skill>/reference.md` (project). A legacy
 *      `SKILL.md` override is still found (deprecated: Claude Code also loads
 *      it as a skill of its own), and so are the pre-PR-2 directory names
 *      (`resolveExtensionFile` in skill-names.js: new name first, old name as
 *      fallback; a folded mode's old dir — `run-backlog/` for do-run backlog —
 *      is read in addition, labelled with its mode).
 *   2. parse — directive headings inside the file become explicit orders:
 *        `## Add after Step 4` / `## Add before Step 4`   → ADD
 *        `## Skip Step 3` (also `Skip Steps 3, 5`)       → SKIP
 *        `## Replace Step 2`                             → REPLACE
 *        `## Step 8 — …` (a heading that names a step)   → EXTEND
 *        everything else                                 → free-text rules
 *      German spellings (`Ergänze nach Schritt 4`, `Überspringe Schritt 3`,
 *      `Ersetze Schritt 2`, `Schritt 8 — …`) parse the same. Headings inside
 *      code fences are ignored.
 *   3. inject — one `[skill-overrides]` block, layers in the fixed order
 *      plugin defaults → global → project (project wins on conflict). Bodies
 *      are inlined up to INLINE_CAP characters in total; a file beyond the
 *      cap is named for the model to Read, its directives still listed.
 *      No file → null (the hook stays silent).
 *   4. record — the active overrides go to a per-session tmp file the
 *      completion card reads (`cardLine`), so "🧩 Override aktiv: …" shows on
 *      the card without the model having to remember it. The card marks the
 *      record rendered; the next user prompt clears a rendered record.
 *
 *   Which skills: a devops skill (`devops:<name>` or a bare current name the
 *   plugin ships). A foreign plugin's skill (`other:<name>`) gets its
 *   reference.md override too, when one exists. A bare name the plugin does
 *   not ship is a user/project skill — its `.claude/skills/<name>/` folder IS
 *   the skill, not an override of it, so nothing is injected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FOLDED, canonicalSkillName, foldedMode, isOldName, namespaceOf, stripNamespace,
  resolveExtensionFile,
} = require('./skill-names');

/** Override file name, and the deprecated legacy one. Order = lookup order. */
const OVERRIDE_FILE = 'reference.md';
const LEGACY_FILE = 'SKILL.md';
const OVERRIDE_FILES = Object.freeze([OVERRIDE_FILE, LEGACY_FILE]);

/** Total characters of override text inlined into one block. */
const INLINE_CAP = 6000;

/** Per-session record the completion card reads. */
const RECORD_PREFIX = 'dotclaude-devops-skill-overrides';

const STEP_ID = '[0-9][\\w.-]*';
const STEP_LIST = `${STEP_ID}(?:\\s*(?:,|&|/|\\band\\b|\\bund\\b)\\s*(?:(?:steps?|schritte?)\\s+)?${STEP_ID})*`;

/** Heading text → directive. First match wins; order matters (EXTEND last). */
const HEADING_RULES = [
  { kind: 'add', re: new RegExp(`^(?:add|insert|append)\\s+(after|before)\\s+step\\s+(${STEP_ID})`, 'i') },
  { kind: 'add', re: new RegExp(`^(?:ergänze|ergänzen|einfügen|füge)\\s+(?:\\S+\\s+)?(nach|vor)\\s+schritt\\s+(${STEP_ID})`, 'i') },
  { kind: 'skip', re: new RegExp(`^(?:skip|omit)\\s+steps?\\s+(${STEP_LIST})`, 'i') },
  { kind: 'skip', re: new RegExp(`^(?:überspringe|überspringen|auslassen|lasse)\\s+(?:schritte?|steps?)\\s+(${STEP_LIST})`, 'i') },
  { kind: 'replace', re: new RegExp(`^replace\\s+step\\s+(${STEP_ID})`, 'i') },
  { kind: 'replace', re: new RegExp(`^(?:ersetze|ersetzen)\\s+(?:schritt|step)\\s+(${STEP_ID})`, 'i') },
  { kind: 'extend', re: new RegExp(`^(?:step|schritt)\\s+(${STEP_ID})(?=\\s|$|[:—–-])`, 'i') },
];

/** 'nach' → 'after', 'vor' → 'before'. */
function position(word) {
  const w = String(word || '').toLowerCase();
  return w === 'before' || w === 'vor' ? 'before' : 'after';
}

function cleanStep(id) {
  return String(id).replace(/[.:,-]+$/, '');
}

function splitSteps(list) {
  return String(list)
    .split(/\s*(?:,|&|\/|\band\b|\bund\b)\s*/i)
    .map((s) => s.replace(/^(?:steps?|schritte?)\s+/i, '').trim())
    .filter(Boolean)
    .map(cleanStep);
}

/**
 * Heading text (without the #s) → directives it stands for, or [] for a
 * plain heading.
 * @param {string} text
 * @returns {{kind:string, step:string, position?:string}[]}
 */
function headingDirectives(text) {
  const t = String(text || '').trim();
  for (const { kind, re } of HEADING_RULES) {
    const m = t.match(re);
    if (!m) continue;
    if (kind === 'add') return [{ kind, step: cleanStep(m[2]), position: position(m[1]) }];
    if (kind === 'skip') return splitSteps(m[1]).map((step) => ({ kind, step }));
    return [{ kind, step: cleanStep(m[1]) }];
  }
  return [];
}

/** Drop a leading YAML frontmatter block (a legacy SKILL.md override has one). */
function stripFrontmatter(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const m = s.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? s.slice(m[0].length) : s;
}

/**
 * Parse an override file's text.
 * @param {string} text
 * @returns {{directives: {kind:string, step:string, position?:string, heading:string}[], hasRules: boolean}}
 *   `hasRules` — non-empty text outside every directive section.
 */
function parseOverride(text) {
  const lines = stripFrontmatter(text).split(/\r?\n/);
  const directives = [];
  let fence = null;
  let section = null; // { level } of the open directive section
  let rules = '';
  for (const line of lines) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      if (!section) rules += `${line}\n`;
      continue;
    }
    const h = fence ? null : line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      if (section && level <= section.level) section = null;
      const found = level >= 2 ? headingDirectives(h[2]) : [];
      if (found.length) {
        for (const d of found) directives.push({ ...d, heading: h[2] });
        section = { level };
        continue;
      }
      if (!section && level >= 2) rules += `${line}\n`;
      continue;
    }
    if (!section) rules += `${line}\n`;
  }
  const hasRules = rules
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .some((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()));
  return { directives, hasRules };
}

/** Skill directory names the plugin ships (dirs with a SKILL.md). */
function pluginSkillNames(root) {
  const base = root || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
  try {
    return new Set(fs.readdirSync(path.join(base, 'skills'))
      .filter((d) => fs.existsSync(path.join(base, 'skills', d, 'SKILL.md'))));
  } catch {
    return new Set();
  }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/** The work-tree root for `cwd`, never fatal. */
function projectBase(cwd) {
  if (typeof cwd !== 'string' || !cwd) return '';
  try { return require('./project-root').projectRoot(cwd) || cwd; } catch { return cwd; }
}

function samePath(a, b) {
  const n = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  try { return n(a) === n(b); } catch { return false; }
}

/** The mode a Skill call's args name for `skill` (`backlog --x` → backlog), else null. */
function modeFromArgs(skill, args) {
  if (typeof args !== 'string') return null;
  const first = args.trim().split(/\s+/)[0];
  if (!first) return null;
  const word = first.toLowerCase().replace(/^--?(?:mode=)?/, '');
  return Object.values(FOLDED).some((f) => f.skill === skill && f.mode === word) ? word : null;
}

/**
 * The override files a skill load picks up, in layer order (global, then
 * project; within a layer the skill's own dir before folded-mode dirs).
 *
 * @param {string} rawSkill the Skill tool's `skill` (or typed command name)
 * @param {{cwd?:string, home?:string, args?:string, pluginRoot?:string, skillNames?:Set<string>}} [opts]
 * @returns {{skill:string, mode:string|null, entries:{scope:'global'|'project', path:string, file:string, legacy:boolean, dir:string, oldName:boolean, mode:string|null}[]}}
 */
function resolveOverrides(rawSkill, opts = {}) {
  const none = { skill: '', mode: null, entries: [] };
  if (typeof rawSkill !== 'string' || !rawSkill.trim()) return none;
  const ns = namespaceOf(rawSkill);
  const bare = stripNamespace(rawSkill);
  if (!bare) return none;
  const names = opts.skillNames || pluginSkillNames(opts.pluginRoot);
  const foreign = !!ns && ns !== 'devops';
  if (!foreign) {
    if (!ns && (isOldName(bare) || !names.has(bare))) return none;
    if (ns === 'devops' && !names.has(canonicalSkillName(bare))) return none;
  }
  const skill = foreign ? bare : canonicalSkillName(bare);
  const mode = foreign ? null : (foldedMode(bare) || modeFromArgs(skill, opts.args));
  const files = foreign ? [OVERRIDE_FILE] : OVERRIDE_FILES;

  const home = opts.home || os.homedir();
  const project = projectBase(opts.cwd);
  const bases = [['global', home]];
  if (project && !(home && samePath(project, home))) bases.push(['project', project]);

  const entries = [];
  for (const [scope, base] of bases) {
    if (!base) continue;
    // The skill's own dir: new name first, the pre-PR-2 name as fallback
    // (resolveExtensionFile). reference.md anywhere beats a legacy SKILL.md.
    for (const file of files) {
      const p = foreign
        ? (isFile(path.join(base, '.claude', 'skills', skill, file)) ? path.join(base, '.claude', 'skills', skill, file) : null)
        : resolveExtensionFile(base, skill, file);
      if (!p) continue;
      const dir = path.basename(path.dirname(p));
      entries.push({ scope, path: p, file, legacy: file === LEGACY_FILE, dir, oldName: dir !== skill, mode: null });
      break;
    }
    if (foreign) continue;
    // A folded mode's old dir is read IN ADDITION — only that mode's when the
    // mode is known, every mode's (labelled) when it is not.
    for (const [oldName, fold] of Object.entries(FOLDED)) {
      if (fold.skill !== skill || (mode && fold.mode !== mode)) continue;
      for (const file of files) {
        const p = path.join(base, '.claude', 'skills', oldName, file);
        if (!isFile(p)) continue;
        entries.push({ scope, path: p, file, legacy: file === LEGACY_FILE, dir: oldName, oldName: true, mode: fold.mode });
        break;
      }
    }
  }
  return { skill, mode, entries };
}

const SCOPE_LABEL = { global: 'global', project: 'project' };

function slash(p) {
  return String(p).replace(/\\/g, '/');
}

/** One explicit order per directive. */
function directiveLine(d, skill, origin) {
  const step = `Step ${d.step} of ${skill}`;
  const sec = `the section "${d.heading}" below`;
  if (d.kind === 'skip') return `- SKIP ${step} (${origin}) — do not run it and do not do its work another way.`;
  if (d.kind === 'replace') return `- REPLACE ${step} (${origin}) — run ${sec} instead of the plugin's ${`Step ${d.step}`}.`;
  if (d.kind === 'add') return `- ADD ${d.position === 'before' ? 'before' : 'after'} ${step} (${origin}) — run ${sec} ${d.position === 'before' ? 'right before' : 'right after'} it.`;
  return `- EXTEND ${step} (${origin}) — apply ${sec} as part of that step.`;
}

/**
 * The `[skill-overrides]` block for one skill load, plus the record the card
 * reads. null when no override file exists.
 *
 * @param {string} rawSkill
 * @param {{cwd?:string, home?:string, args?:string, pluginRoot?:string, skillNames?:Set<string>, cap?:number, read?:(p:string)=>string}} [opts]
 * @returns {{text:string, record:{skill:string, mode:string|null, entries:object[]}}|null}
 */
function overrideBlock(rawSkill, opts = {}) {
  const resolved = resolveOverrides(rawSkill, opts);
  if (!resolved.entries.length) return null;
  const { skill } = resolved;
  const read = typeof opts.read === 'function' ? opts.read : (p) => fs.readFileSync(p, 'utf8');
  let budget = typeof opts.cap === 'number' ? opts.cap : INLINE_CAP;

  const files = [];
  for (const e of resolved.entries) {
    let text = '';
    try { text = stripFrontmatter(read(e.path)).trim(); } catch { continue; }
    if (!text) continue;
    files.push({ ...e, text, parsed: parseOverride(text) });
  }
  if (!files.length) return null;

  const origin = (f) => `${SCOPE_LABEL[f.scope]} override${f.mode ? `, ${f.mode} mode only` : ''}`;
  const head = files.map((f) => `${SCOPE_LABEL[f.scope]} ${f.file}${f.mode ? ` (${f.mode} mode)` : ''}`).join(', ');
  const out = [
    `[skill-overrides] ${skill}: ${head}`,
    `Override loader (this IS ${skill}'s Step 0): layers apply in the order plugin defaults → global → project; on a conflict project wins over global, global over the plugin. Binding for this run of ${skill}.`,
  ];
  const orders = [];
  for (const f of files) {
    for (const d of f.parsed.directives) orders.push(directiveLine(d, skill, origin(f)));
    if (f.parsed.hasRules) orders.push(`- RULES (${origin(f)}) — the rest of the file applies throughout ${skill}.`);
  }
  if (orders.length) out.push('Directives:', ...orders);
  for (const f of files) {
    if (f.legacy) out.push(`Legacy: \`${slash(f.path)}\` is a SKILL.md override — deprecated; rename it to reference.md (Claude Code also loads it as a skill of its own).`);
    if (f.oldName && !f.mode) out.push(`Pre-PR-2 dir: \`${slash(f.path)}\` sits under the old name \`${f.dir}/\`; new extensions go under \`${skill}/\`.`);
  }
  for (const f of files) {
    const label = `${SCOPE_LABEL[f.scope]}${f.mode ? ` · ${f.mode} mode` : ''}: ${slash(f.path)}`;
    if (f.text.length <= budget) {
      budget -= f.text.length;
      out.push('', `=== ${label} ===`, f.text, `=== end ${SCOPE_LABEL[f.scope]} ===`);
    } else {
      out.push('', `=== ${label} — ${f.text.length} chars, over the ${opts.cap || INLINE_CAP}-char inline cap: Read this file in full before Step 1 ===`);
    }
  }
  const record = {
    skill,
    mode: resolved.mode,
    entries: files.map((f) => ({
      scope: f.scope,
      path: slash(f.path),
      legacy: f.legacy,
      mode: f.mode,
      directives: f.parsed.directives.map(({ kind, step, position: pos }) => (pos ? { kind, step, position: pos } : { kind, step })),
      rules: f.parsed.hasRules,
    })),
  };
  return { text: out.join('\n'), record };
}

// ---------------------------------------------------------------------------
// Per-session record → the completion card line
// ---------------------------------------------------------------------------

function recordPath(sessionId, dir) {
  return path.join(dir || os.tmpdir(), `${RECORD_PREFIX}-${sessionId || 'unknown'}`);
}

function readRecordFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && Array.isArray(data.skills) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Add one skill load's record. A record the card already rendered starts over
 * (a new turn's overrides), and a skill loaded again replaces its old entry.
 */
function recordOverrides(sessionId, record, { dir, now } = {}) {
  if (!record || !record.skill) return;
  const file = recordPath(sessionId, dir);
  const prev = readRecordFile(file);
  const skills = prev && !prev.renderedAt ? prev.skills.filter((s) => s.skill !== record.skill) : [];
  skills.push({ ...record, at: now || Date.now() });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ skills }), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
  }
}

/** The card shows a record once per turn: mark it rendered (keeps it for a re-render). */
function markRendered(file, now) {
  const data = readRecordFile(file);
  if (!data || data.renderedAt) return;
  try { fs.writeFileSync(file, JSON.stringify({ ...data, renderedAt: now || Date.now() }), 'utf8'); } catch { /* advisory */ }
}

/** A new user prompt: drop a record the card already showed. */
function clearRendered(sessionId, { dir } = {}) {
  const file = recordPath(sessionId, dir);
  const data = readRecordFile(file);
  if (data && data.renderedAt) {
    try { fs.unlinkSync(file); } catch { /* gone */ }
  }
}

const CARD_TEXT = {
  de: {
    lead: '🧩 Override aktiv: ', global: 'Global', project: 'Projekt', rules: 'Regeln',
    add: (d) => `${d.position === 'before' ? 'vor' : 'nach'} Step ${d.step} ergänzt`,
    skip: (d) => `Step ${d.step} übersprungen`,
    replace: (d) => `Step ${d.step} ersetzt`,
    extend: (d) => `Step ${d.step} ergänzt`,
  },
  en: {
    lead: '🧩 Override active: ', global: 'global', project: 'project', rules: 'rules',
    add: (d) => `added ${d.position === 'before' ? 'before' : 'after'} Step ${d.step}`,
    skip: (d) => `Step ${d.step} skipped`,
    replace: (d) => `Step ${d.step} replaced`,
    extend: (d) => `Step ${d.step} extended`,
  },
};

const CARD_LINE_MAX = 160;

/**
 * The card's one override line, or null without a record.
 * `🧩 Override aktiv: Projekt do-ship (Step 8 ergänzt) · Global auto-fix (Regeln)`
 * @param {{skills:object[]}|null} data
 * @param {'de'|'en'} [lang]
 * @returns {string|null}
 */
function cardLine(data, lang = 'de') {
  if (!data || !Array.isArray(data.skills) || !data.skills.length) return null;
  const t = CARD_TEXT[lang === 'en' ? 'en' : 'de'];
  const parts = [];
  for (const s of data.skills) {
    const entries = Array.isArray(s.entries) ? s.entries : [];
    if (!entries.length) continue;
    const scopes = [...new Set(entries.map((e) => t[e.scope] || e.scope))].join(' + ');
    const labels = [];
    for (const e of entries) {
      for (const d of e.directives || []) {
        const fn = t[d.kind];
        if (fn) labels.push(fn(d));
      }
    }
    const uniq = [...new Set(labels)];
    if (!uniq.length) uniq.push(t.rules);
    const shown = uniq.length > 3 ? [...uniq.slice(0, 3), `+${uniq.length - 3}`] : uniq;
    parts.push(`${scopes} ${s.skill} (${shown.join(', ')})`);
  }
  if (!parts.length) return null;
  const line = t.lead + parts.join(' · ');
  return line.length > CARD_LINE_MAX ? `${line.slice(0, CARD_LINE_MAX - 1)}…` : line;
}

module.exports = {
  OVERRIDE_FILE,
  LEGACY_FILE,
  OVERRIDE_FILES,
  INLINE_CAP,
  RECORD_PREFIX,
  headingDirectives,
  parseOverride,
  resolveOverrides,
  overrideBlock,
  recordPath,
  readRecordFile,
  recordOverrides,
  markRendered,
  clearRendered,
  cardLine,
};
