/**
 * @module cache-inuse
 * @version 0.1.0
 * @description Honors Claude Code's native plugin-cache reference counting when
 *   deciding which cached plugin version dirs a rebuild may delete.
 *
 *   Claude Code drops a marker file per live session into every plugin version
 *   dir that session has loaded:
 *
 *     <versionDir>/.in_use/<pid>   →  {"pid":<pid>,"procStartFt":"<FILETIME>"}
 *
 *   Its own sweeper only collects version dirs with no live marker left, which
 *   is why two versions of the same plugin legitimately coexist in the cache
 *   while older sessions are still open.
 *
 *   ss.plugin.update's rebuildCache used to prune old version dirs
 *   unconditionally. Those dirs are the CLAUDE_PLUGIN_ROOT — the `cwd` AND the
 *   require() root — of the MCP servers belonging to every OTHER still-running
 *   Claude session. Upgrading in one session therefore tore the working
 *   directory out from under all the others, and they reported "MCP server
 *   disconnected" (issue: local plugin install / MCP disconnects). Pruning must
 *   go through this module so a claimed dir is left alone.
 *
 *   FAIL-SAFE: uncertainty always means "in use". An unreadable marker dir, a
 *   marker that is neither parsable JSON nor PID-prefixed, or any marker whose
 *   PID is alive all keep the dir. Only a version dir with no live claim at all
 *   is prunable — over-retention is harmless (Claude Code's own sweeper
 *   collects it later), while under-retention breaks live sessions.
 *
 *   PID reuse is deliberately NOT screened via the marker's `procStartFt`:
 *   treating a recycled PID as still-live over-retains, which is the safe
 *   direction, and avoids depending on a Windows-only FILETIME comparison.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { isProcessAlive } = require('./mcp-status');

// Claude Code's marker directory name inside each cached plugin version dir.
const IN_USE_DIR = '.in_use';

/**
 * Resolve the PID a marker file stands for. Prefers the marker's JSON body and
 * falls back to the filename's leading digits, which is what survives a
 * half-written `<pid>.tmp.<hash>` marker.
 * @param {string} markerDir
 * @param {string} name  marker filename
 * @returns {number|null}  null when the marker claims no identifiable PID
 */
function markerPid(markerDir, name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(markerDir, name), 'utf8'));
    if (Number.isFinite(parsed && parsed.pid)) return parsed.pid;
  } catch {
    // Unreadable or not JSON — fall through to the filename.
  }
  const match = /^(\d+)/.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Is any live Claude session still claiming this cached version dir?
 * @param {string} versionDir  e.g. …/cache/dotclaude/devops/0.136.0
 * @param {(pid:number)=>boolean} [isAlive]  injectable for tests
 * @returns {boolean}
 */
function isVersionDirInUse(versionDir, isAlive = isProcessAlive) {
  const markerDir = path.join(versionDir, IN_USE_DIR);
  let names;
  try {
    if (!fs.existsSync(markerDir)) return false; // nothing ever claimed it
    names = fs.readdirSync(markerDir);
  } catch {
    return true; // marker dir exists but is unreadable → assume claimed
  }
  for (const name of names) {
    const pid = markerPid(markerDir, name);
    if (pid === null) return true; // unidentifiable claim → assume live
    if (isAlive(pid)) return true;
  }
  return false;
}

/**
 * The entries of a plugin's cache dir a rebuild may safely delete: everything
 * except the version being built and anything a live session still claims.
 * @param {string} pluginCache  e.g. …/cache/dotclaude/devops
 * @param {string} keepVersion  the version dir the rebuild targets
 * @param {(pid:number)=>boolean} [isAlive]  injectable for tests
 * @returns {string[]}  entry names, relative to pluginCache
 */
function prunableEntries(pluginCache, keepVersion, isAlive = isProcessAlive) {
  let entries;
  try {
    entries = fs.readdirSync(pluginCache);
  } catch {
    return []; // cache dir absent or unreadable — nothing to prune
  }
  return entries.filter(
    (entry) => entry !== keepVersion && !isVersionDirInUse(path.join(pluginCache, entry), isAlive),
  );
}

module.exports = {
  IN_USE_DIR,
  markerPid,
  isVersionDirInUse,
  prunableEntries,
};
