'use strict';
/**
 * @module devops-config
 * @version 0.1.0
 * @plugin devops
 * @description Plugin settings a user can change in plain words, per project
 *   or for every project on the machine.
 *
 *   The user tells Claude ("in diesem Projekt nie automatisch aufräumen",
 *   "Cleanup-Hinweis erst ab 80 Branches, überall") and Claude writes the
 *   value with `scripts/devops-config.js` — no skill involved;
 *   deep-knowledge/devops-config.md is the runbook. Only the keys in SCHEMA
 *   exist. Anything else is rejected, so a typo never silently changes nothing.
 *
 *   Resolution per key: project > global > default.
 *     project  <main-checkout>/.claude/devops-config.json — anchored at the
 *              MAIN checkout of the clone, so every worktree reads the same
 *              file (the copy the Desktop app seeds into a new worktree is
 *              never consulted). Per clone, never committed: it is listed in
 *              runtime-ignores.js, which ss.project.setup writes into
 *              .git/info/exclude.
 *     global   ~/.claude/devops-config.json — every project on this machine.
 *
 *   Both files hold the same shape: { "<section>": { "<key>": value } }.
 *   Reads never throw: an unreadable or malformed file counts as absent, and
 *   a stored value that fails validation falls through to the next layer.
 *   Pure fs — no git spawn (the main checkout is found via the `.git` file
 *   and `commondir` of a linked worktree).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { findRepoRoot, samePath, gitCommonDir } = require('./project-root');

const FILE_NAME = 'devops-config.json';

/**
 * Every setting that exists. `min`/`max` bound integers; `doc` is the one-line
 * meaning `scripts/devops-config.js list` prints.
 */
const SCHEMA = Object.freeze({
  cleanup: Object.freeze({
    autoClean: Object.freeze({
      type: 'boolean', default: true,
      doc: 'After a successful ship, remove old leftovers on its own (only once the age gate opens).',
    }),
    autoCleanGateDays: Object.freeze({
      type: 'integer', default: 30, min: 1, max: 3650,
      doc: 'The automatic cleanup only runs once a removable leftover is older than this many days.',
    }),
    autoCleanMinAgeDays: Object.freeze({
      type: 'integer', default: 7, min: 1, max: 3650,
      doc: 'The automatic cleanup removes leftovers older than this; younger ones only via the cleanup page.',
    }),
    nudge: Object.freeze({
      type: 'boolean', default: true,
      doc: 'After a successful ship or promote, suggest the cleanup page when too much piles up.',
    }),
    nudgeThreshold: Object.freeze({
      type: 'integer', default: 50, min: 1, max: 100000,
      doc: 'Suggest the cleanup page when more than this many branches/worktrees lie around.',
    }),
    nudgeCooldownDays: Object.freeze({
      type: 'integer', default: 7, min: 0, max: 3650,
      doc: 'Days of silence after a suggestion (0 = suggest after every ship above the threshold).',
    }),
  }),
});

/** `section.key` for every setting, in SCHEMA order. */
function listKeys() {
  const out = [];
  for (const [section, keys] of Object.entries(SCHEMA)) {
    for (const key of Object.keys(keys)) out.push(`${section}.${key}`);
  }
  return out;
}

/**
 * The SCHEMA entry for `section.key`, or null.
 * @param {string} fullKey
 */
function specOf(fullKey) {
  if (typeof fullKey !== 'string') return null;
  const [section, key, extra] = fullKey.split('.');
  if (extra !== undefined || !section || !key) return null;
  const sec = Object.prototype.hasOwnProperty.call(SCHEMA, section) ? SCHEMA[section] : null;
  if (!sec || !Object.prototype.hasOwnProperty.call(sec, key)) return null;
  return { section, key, spec: sec[key] };
}

/** Is `value` valid for `spec`? */
function isValid(spec, value) {
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'integer') {
    return Number.isInteger(value)
      && (spec.min === undefined || value >= spec.min)
      && (spec.max === undefined || value <= spec.max);
  }
  return false;
}

/**
 * Parse a CLI/user string into the typed value for `fullKey`.
 * @returns {boolean|number}
 * @throws {Error} unknown key or invalid value — the message names the fix
 */
function parseValue(fullKey, raw) {
  const hit = specOf(fullKey);
  if (!hit) throw new Error(`unknown setting "${fullKey}" — valid: ${listKeys().join(', ')}`);
  const { spec } = hit;
  const text = String(raw).trim().toLowerCase();
  let value;
  if (spec.type === 'boolean') {
    if (['true', 'on', 'yes', 'ja', 'an', '1'].includes(text)) value = true;
    else if (['false', 'off', 'no', 'nein', 'aus', '0'].includes(text)) value = false;
  } else if (spec.type === 'integer' && /^-?\d+$/.test(text)) {
    value = Number(text);
  }
  if (value === undefined || !isValid(spec, value)) {
    const range = spec.type === 'integer'
      ? `an integer${spec.min !== undefined ? ` ≥ ${spec.min}` : ''}${spec.max !== undefined ? ` and ≤ ${spec.max}` : ''}`
      : 'true or false';
    throw new Error(`invalid value "${raw}" for ${fullKey} — expected ${range}`);
  }
  return value;
}

/**
 * The main checkout of the clone that contains `cwd` — for a linked worktree
 * the directory whose `.git` is the shared common dir. Falls back to the
 * enclosing work tree, and to `cwd` itself outside any repo. A repo rooted at
 * the home directory (dotfiles) never anchors project state (as projectRoot).
 * @param {string} [cwd]
 * @returns {string}
 */
function mainCheckoutRoot(cwd) {
  const start = path.resolve(cwd || process.cwd());
  const root = findRepoRoot(start);
  if (!root) return start;
  try {
    if (samePath(root, os.homedir()) && !samePath(start, root)) return start;
  } catch { /* no home dir — keep the repo root */ }
  const common = gitCommonDir(root);
  return common && path.basename(common) === '.git' ? path.dirname(common) : root;
}

/**
 * Absolute paths of both config files for `cwd`.
 * @param {string} [cwd]
 * @param {{home?:string}} [opts]
 */
function configPaths(cwd, opts = {}) {
  const home = opts.home || os.homedir();
  return {
    project: path.join(mainCheckoutRoot(cwd), '.claude', FILE_NAME),
    global: path.join(home, '.claude', FILE_NAME),
  };
}

function readJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Effective settings for `cwd`, with the layer each value came from.
 * @param {string} [cwd]
 * @param {{home?:string}} [opts]
 * @returns {{values:Object, sources:Object<string,'project'|'global'|'default'>, files:{project:string, global:string}}}
 */
function load(cwd, opts = {}) {
  const files = configPaths(cwd, opts);
  const layers = [['project', readJson(files.project)], ['global', readJson(files.global)]];
  const values = {};
  const sources = {};
  for (const [section, keys] of Object.entries(SCHEMA)) {
    values[section] = {};
    for (const [key, spec] of Object.entries(keys)) {
      let value = spec.default;
      let source = 'default';
      for (const [name, data] of layers) {
        const sec = data && data[section];
        if (sec && typeof sec === 'object' && isValid(spec, sec[key])) {
          value = sec[key];
          source = name;
          break;
        }
      }
      values[section][key] = value;
      sources[`${section}.${key}`] = source;
    }
  }
  return { values, sources, files };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * Store `raw` for `fullKey` in one layer.
 * @param {string} fullKey `section.key`
 * @param {*} raw string or already-typed value
 * @param {'project'|'global'} scope
 * @param {string} [cwd]
 * @param {{home?:string}} [opts]
 * @returns {{file:string, key:string, value:boolean|number}}
 * @throws {Error} unknown key, invalid value or scope
 */
function setValue(fullKey, raw, scope, cwd, opts = {}) {
  if (scope !== 'project' && scope !== 'global') throw new Error('scope must be "project" or "global"');
  const value = parseValue(fullKey, raw);
  const { section, key } = specOf(fullKey);
  const file = configPaths(cwd, opts)[scope];
  const data = readJson(file) || {};
  if (!data[section] || typeof data[section] !== 'object') data[section] = {};
  data[section][key] = value;
  writeJson(file, data);
  return { file, key: fullKey, value };
}

/**
 * Remove `fullKey` from one layer (the next layer or the default applies).
 * @returns {{file:string, key:string, removed:boolean}}
 */
function unsetValue(fullKey, scope, cwd, opts = {}) {
  if (scope !== 'project' && scope !== 'global') throw new Error('scope must be "project" or "global"');
  const hit = specOf(fullKey);
  if (!hit) throw new Error(`unknown setting "${fullKey}" — valid: ${listKeys().join(', ')}`);
  const file = configPaths(cwd, opts)[scope];
  const data = readJson(file);
  const sec = data && data[hit.section];
  if (!sec || !Object.prototype.hasOwnProperty.call(sec, hit.key)) return { file, key: fullKey, removed: false };
  delete sec[hit.key];
  if (Object.keys(sec).length === 0) delete data[hit.section];
  writeJson(file, data);
  return { file, key: fullKey, removed: true };
}

module.exports = {
  SCHEMA, FILE_NAME,
  listKeys, specOf, parseValue,
  mainCheckoutRoot, configPaths, load, setValue, unsetValue,
};
