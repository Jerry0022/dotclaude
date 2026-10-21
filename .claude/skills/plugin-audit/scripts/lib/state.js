'use strict';
/**
 * @module plugin-audit/state
 * @version 0.1.0
 * @description Persistent state of the plugin-audit skill, anchored at the MAIN
 *   repo root so every worktree shares it:
 *     <git-common-dir>/../.claude/plugin-audit/
 *       last.json     { version, minor, decade, ranAt, trigger }
 *       history.json  [ one summary object per run ]
 *       runs/<version>-<timestamp>/   results.json, suggestions.json, report/
 *       report-pending.json           set when a run finished without a live
 *                                     session; the next session opens the report
 *   The directory is git-ignored (`.claude/plugin-audit/`).
 */

const fs = require('fs');
const path = require('path');
const { git, readJson } = require('./util');

/** Main-repo root for `cwd` (resolves worktrees via --git-common-dir). */
function mainRoot(cwd = process.cwd()) {
  const common = git(['rev-parse', '--git-common-dir'], cwd);
  if (!common) return path.resolve(cwd);
  return path.dirname(path.resolve(cwd, common));
}

/** State directory; `override` (tests) wins over everything. */
function stateDir(cwd = process.cwd(), override = process.env.PLUGIN_AUDIT_STATE_DIR) {
  if (override) return path.resolve(override);
  return path.join(mainRoot(cwd), '.claude', 'plugin-audit');
}

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

/** decade of a version: floor(minor / 10) */
function decadeOf(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  return m ? Math.floor(Number(m[2]) / 10) : null;
}

function readLast(dir) { return readJson(path.join(dir, 'last.json'), null); }

function writeLast(dir, { version, trigger, ranAt = new Date().toISOString() }) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  const minor = m ? Number(m[2]) : null;
  const last = { version, minor, decade: decadeOf(version), ranAt, trigger };
  fs.writeFileSync(path.join(ensure(dir), 'last.json'), JSON.stringify(last, null, 2));
  return last;
}

function readHistory(dir) {
  const h = readJson(path.join(dir, 'history.json'), []);
  return Array.isArray(h) ? h : [];
}

function appendHistory(dir, summary) {
  const h = readHistory(dir);
  h.push(summary);
  fs.writeFileSync(path.join(ensure(dir), 'history.json'), JSON.stringify(h, null, 2));
  return h;
}

/** Fresh runs/<version>-<timestamp>/ directory. */
function newRunDir(dir, version, now = new Date()) {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return ensure(path.join(dir, 'runs', `${version || 'unknown'}-${ts}`));
}

function writePending(dir, info) {
  fs.writeFileSync(path.join(ensure(dir), 'report-pending.json'), JSON.stringify(info, null, 2));
}

module.exports = { mainRoot, stateDir, decadeOf, readLast, writeLast, readHistory, appendHistory, newRunDir, writePending };
