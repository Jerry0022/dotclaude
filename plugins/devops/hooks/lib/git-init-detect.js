'use strict';
/**
 * @module git-init-detect
 * @version 0.1.0
 * @description Finds `git init` invocations inside a shell command string and
 *   resolves the directory each one initializes, so a PostToolUse hook can
 *   react to a mid-session `git init` the same way `ss.project.setup` reacts
 *   to a repo found at SessionStart.
 *
 *   Handles the three shapes named in issue #503:
 *     - `git init`             → target = cwd
 *     - `git init <dir>`       → target = cwd/<dir>
 *     - `git -C <dir> init`    → target = cwd/<dir>
 *   and their combination (`git -C <dir> init <sub>`), chained with `&&`,
 *   `||`, `;`, `|` or a newline, and prefixed by `env`/`sudo`/`command`/
 *   `exec`/`time`/`nohup` wrappers or `VAR=val` assignments. Pure string
 *   parsing — never spawns a process, never touches the filesystem.
 */

const path = require('path');

const WRAPPERS = /^(?:env|command|exec|sudo|time|nohup|!)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Split a shell command into its top-level segments. */
function segments(command) {
  return command.split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}

/** Split a segment into words, keeping quoted spans together, then unquote. */
function words(segment) {
  const matches = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return matches.map((w) => w.replace(/^["']|["']$/g, ''));
}

/**
 * @param {string} segment one `&&`/`;`/`|`-separated shell segment
 * @returns {{cDir:string|null, targetArg:string|null}|null} null when the
 *   segment is not a `git init` call
 */
function parseGitInitSegment(segment) {
  let w = words(segment);
  while (w.length && (ASSIGNMENT.test(w[0]) || WRAPPERS.test(w[0]))) w.shift();
  const first = (w.shift() || '').replace(/\.exe$/i, '');
  if (path.basename(first.replace(/\\/g, '/')).toLowerCase() !== 'git') return null;

  let cDir = null;
  let sawInit = false;
  let targetArg = null;
  for (let i = 0; i < w.length; i++) {
    const tok = w[i];
    if (!sawInit && tok === '-C') { cDir = w[++i] ?? null; continue; }
    if (!sawInit && tok.startsWith('-C') && tok.length > 2) { cDir = tok.slice(2); continue; }
    if (!sawInit && tok === 'init') { sawInit = true; continue; }
    if (sawInit && targetArg === null && !tok.startsWith('-')) { targetArg = tok; }
  }
  if (!sawInit) return null;
  return { cDir, targetArg };
}

/**
 * @param {string} command raw shell command from `tool_input.command`
 * @param {string} cwd the tool call's working directory
 * @returns {string[]} absolute, de-duplicated target directories, one per
 *   `git init` invocation found in `command`
 */
function detectGitInitTargets(command, cwd) {
  if (typeof command !== 'string' || !command.trim()) return [];
  const base = path.resolve(cwd || process.cwd());
  const targets = [];
  const seen = new Set();
  for (const segment of segments(command)) {
    const hit = parseGitInitSegment(segment);
    if (!hit) continue;
    const root = hit.cDir ? path.resolve(base, hit.cDir) : base;
    const target = hit.targetArg ? path.resolve(root, hit.targetArg) : root;
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

module.exports = { detectGitInitTargets, parseGitInitSegment };
