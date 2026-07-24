#!/usr/bin/env node
/**
 * @script check-tool
 * @version 0.1.0
 * @plugin devops
 * @description Generic cross-platform CLI availability probe. Resolves whether
 *   a command is on PATH (manual PATH scan — no shell) and optionally captures
 *   its version. Prints one JSON line to stdout when run directly:
 *     {"installed":true,"path":"C:\\...\\node.exe","version":"v22.3.0"}
 *     {"installed":false}
 *   Exported for reuse (e.g. the auto-graph skill detecting `graphify`).
 *   Detection is a pure PATH scan so it is unit-testable without the target
 *   tool installed. Exit code is always 0 — callers rely on the JSON.
 *
 *   CLI: node check-tool.js <command> [versionArg...]
 *     node check-tool.js graphify --version
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const IS_WIN = process.platform === 'win32';

/**
 * Resolve a command to an absolute executable path via a manual PATH scan.
 * No shell is spawned, so this is safe and deterministic.
 * @param {string} command bare binary name, e.g. "graphify"
 * @returns {string|null} absolute path, or null if not found
 */
function which(command) {
  if (!command || typeof command !== 'string') return null;
  const dirs = (process.env.PATH || '').split(IS_WIN ? ';' : ':').filter(Boolean);
  const exts = IS_WIN
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  const accessMode = IS_WIN ? fs.constants.F_OK : fs.constants.X_OK;

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      try {
        fs.accessSync(candidate, accessMode);
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch { /* not here — keep scanning */ }
    }
  }
  return null;
}

/**
 * Capture the first line of a tool's version output. Never throws.
 * @param {string} exe absolute path to the executable
 * @param {string[]} versionArgs e.g. ["--version"]
 * @returns {string|undefined}
 */
function probeVersion(exe, versionArgs) {
  try {
    const out = execFileSync(exe, versionArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const first = String(out).split('\n')[0].trim();
    return first || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe whether a CLI tool is available, optionally capturing its version.
 * @param {string} command bare binary name
 * @param {{versionArgs?: string[]}} [opts]
 * @returns {{installed: boolean, path?: string, version?: string}}
 */
function checkTool(command, opts = {}) {
  const resolved = which(command);
  if (!resolved) return { installed: false };

  const result = { installed: true, path: resolved };
  if (Array.isArray(opts.versionArgs) && opts.versionArgs.length) {
    const version = probeVersion(resolved, opts.versionArgs);
    if (version) result.version = version;
  }
  return result;
}

if (require.main === module) {
  const [, , command, ...versionArgs] = process.argv;
  if (!command) {
    process.stderr.write('usage: check-tool <command> [versionArg...]\n');
    process.exit(2);
  }
  const result = checkTool(command, versionArgs.length ? { versionArgs } : {});
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

module.exports = { checkTool, which, probeVersion };
