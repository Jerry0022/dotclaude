'use strict';
/**
 * @module knowledge-pointers
 * @version 0.2.0
 * @plugin devops
 * @description Trigger phrases → one-line POINTERS to a deep-knowledge doc,
 *   for `prompt.knowledge.dispatch`. PR 3 of the skill restructure
 *   (docs/superpowers/specs/2026-09-24-skill-restructure-design.md) retired
 *   four skills into deep-knowledge docs (setup-project followed on
 *   2026-09-24); their trigger phrases live here now (the full retirement
 *   snapshot is `RETIRED_TRIGGERS` in skill-names.js, and
 *   `scripts/skill-graph.test.js` asserts each phrase still matches). An entry
 *   with `legacy: null` is a plain topic pointer that never was a skill
 *   (devops-config.md — the settings runbook).
 *
 *   Why a pointer and not the doc body (the dispatch's TOPIC_MAP injects
 *   whole files): these docs are 5–14 KB, and some of their words are common
 *   ("strict", "graphify") — a false match must cost one line, not 3 k
 *   tokens. The pointer names the file; the model reads it when the prompt
 *   really is about that topic. Nothing here is mandatory, and nothing ever
 *   names a Skill — the four names are no skills any more.
 *
 *   Matching reuses the trigger router's phrase matcher
 *   (`skill-trigger-router.matchWordTriggers`): case-insensitive, Unicode word
 *   boundaries, never inside code, quotes, identifiers or paths. Unlike the
 *   router, single words count — a pointer is cheap.
 *
 *   A consumer extension written for the old skill
 *   (`{project}/.claude/skills/<old>/reference.md` or `SKILL.md`, and the
 *   same under the home directory) is named in the pointer when it exists,
 *   so it keeps applying on top of the doc — for the three skills that had
 *   an extension step (`extension: true`); auto-graph never had one.
 */

const fs = require('fs');
const path = require('path');

/**
 * @type {ReadonlyArray<{file:string, legacy:string|null, extension:boolean, topic:string, phrases:ReadonlyArray<string>}>}
 */
const POINTERS = Object.freeze([
  Object.freeze({
    file: 'readme-standards.md',
    legacy: 'setup-readme',
    extension: true,
    topic: 'README standards (sections by project category, badges, media, style) — for creating, rewriting or substantially updating a README; not for one-line edits',
    phrases: Object.freeze([
      'create a readme', 'update the readme', 'improve the readme', 'rewrite the readme', 'write a readme',
      'README erstellen', 'README aktualisieren', 'README überarbeiten', 'README schreiben', 'README anpassen',
      '/setup-readme',
    ]),
  }),
  Object.freeze({
    file: 'graphify.md',
    legacy: 'auto-graph',
    extension: false,
    topic: 'the devops graphify integration (install, freshness, `graphify query`, the search gate, opt-out) — for codebase-graph questions; not for single-file lookups',
    phrases: Object.freeze(['knowledge graph', 'graphify', 'code graph', 'codebase graph', '/auto-graph']),
  }),
  Object.freeze({
    file: 'usage.md',
    legacy: 'auto-usage',
    extension: true,
    topic: 'live token usage — call the get_usage MCP tool first; the doc covers the manual scraper run and its one-time login',
    phrases: Object.freeze([
      'refresh usage', 'token budget', 'usage refresh', 'wie viel hab ich verbraucht', 'wieviel hab ich verbraucht',
      'usage aktualisieren', '/auto-usage',
    ]),
  }),
  Object.freeze({
    file: 'strict.md',
    legacy: 'claude-strict',
    extension: true,
    topic: 'strict mode (literal scope, chosen attributes reported; switch with `strict on` / `strict off` / `strict: <task>`) — ignore when "strict" means a compiler or linter option',
    phrases: Object.freeze([
      'strict', 'strikt', 'strict mode', 'strict modus', 'strikt modus', 'strict an', 'strict aus',
      'genau so und nicht mehr', 'nur das ändern', 'nichts anderes anfassen', 'nur den rand',
      '/claude-strict',
    ]),
  }),
  Object.freeze({
    file: 'project-setup.md',
    legacy: 'setup-project',
    extension: true,
    topic: 'project setup / repo hygiene (.gitignore for the stack, secrets, LICENSE, CLAUDE.md audit, platform audit) — do only the part asked for; the plugin\'s own runtime files are excluded automatically',
    phrases: Object.freeze([
      'set up this project', 'init repo', 'audit gitignore', 'add license', 'fix gitignore', 'repo hygiene',
      'Projekt einrichten', 'Repo aufsetzen', 'Lizenz hinzufügen', 'gitignore prüfen',
      '/setup-project',
    ]),
  }),
  Object.freeze({
    file: 'devops-config.md',
    legacy: null,
    extension: false,
    topic: 'devops plugin settings, per project or global (e.g. when the cleanup hint appears, whether old branches/worktrees are removed automatically) — change them with scripts/devops-config.js, never by editing JSON',
    phrases: Object.freeze([
      'devops config', 'devops settings', 'devops einstellungen', 'plugin einstellungen', 'plugin settings',
      'cleanup einstellen', 'cleanup settings', 'cleanup konfigurieren', 'aufräumen einstellen',
      'nicht automatisch aufräumen', 'automatisch aufräumen', 'aufräum-hinweis', 'cleanup hint',
    ]),
  }),
]);

let corpus = null;
/** Router-style corpus, keyed by doc file (the router dedupes by `skill`). */
function buildCorpus() {
  if (corpus) return corpus;
  const { buildPhraseMatcher } = require('./skill-trigger-router');
  const entries = [];
  for (const p of POINTERS) {
    for (const phrase of p.phrases) entries.push({ skill: p.file, phrase, matcher: buildPhraseMatcher(phrase) });
  }
  entries.sort((a, b) => b.phrase.length - a.phrase.length);
  corpus = entries;
  return corpus;
}

/**
 * Pointers whose phrases occur in the prompt (outside code and quotes).
 * @param {string} message raw prompt
 * @returns {{file:string, legacy:string, extension:boolean, topic:string, phrase:string}[]} in POINTERS order
 */
function matchPointers(message) {
  if (typeof message !== 'string' || !message.trim()) return [];
  const { matchWordTriggers } = require('./skill-trigger-router');
  const hits = new Map(matchWordTriggers(message, buildCorpus()).map(h => [h.skill, h.phrase]));
  return POINTERS.filter(p => hits.has(p.file)).map(p => ({ file: p.file, legacy: p.legacy, extension: p.extension, topic: p.topic, phrase: hits.get(p.file) }));
}

/**
 * Old-skill extension files that still apply on top of the doc: project
 * first, then home; `reference.md` and `SKILL.md`.
 * @param {string} legacy old skill name
 * @param {{cwd?:string, home?:string, exists?:(p:string)=>boolean}} [opts]
 * @returns {string[]}
 */
function legacyOverrides(legacy, opts = {}) {
  const exists = typeof opts.exists === 'function' ? opts.exists : (p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  };
  const out = [];
  for (const base of [opts.cwd, opts.home]) {
    if (typeof base !== 'string' || !base) continue;
    for (const file of ['reference.md', 'SKILL.md']) {
      const p = path.join(base, '.claude', 'skills', legacy, file);
      if (exists(p)) out.push(p);
    }
  }
  return out;
}

/**
 * The one-line pointer for a matched doc.
 * @param {{file:string, legacy:string, topic:string, phrase:string}} hit
 * @param {string} dkDir absolute deep-knowledge directory
 * @param {string[]} [overrides] from legacyOverrides
 * @returns {string}
 */
function pointerLine(hit, dkDir, overrides = []) {
  const file = path.join(dkDir, hit.file).replace(/\\/g, '/');
  let line = hit.legacy
    ? `[deep-knowledge pointer] "${hit.phrase}" → ${hit.topic}. Read ${file} before acting on it (not a skill — do not invoke one named ${hit.legacy}).`
    : `[deep-knowledge pointer] "${hit.phrase}" → ${hit.topic}. Read ${file} before acting on it (not a skill).`;
  if (overrides.length) {
    line += ` Project override from the old ${hit.legacy} extension, applies on top: ${overrides.map(o => o.replace(/\\/g, '/')).join(', ')}.`;
  }
  return line;
}

module.exports = { POINTERS, matchPointers, legacyOverrides, pointerLine };
