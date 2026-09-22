'use strict';
/**
 * @lib graphify-query-spawn
 * @version 0.1.0
 * @plugin devops
 * @description Synchronous, injection-safe argv spawn used by the graphify
 *   answer-in-gate (pre.tokens.guard). Split out from the hook so the
 *   shell:false-first / strict-quoted-shell-fallback logic is unit-testable
 *   against a real spawnable stub (a `.js` file launched via
 *   `process.execPath` — unlike a `.cmd`/`.bat`, Node can execute that
 *   directly without a shell on every platform) instead of only being
 *   exercisable through the live `graphify` binary.
 *
 *   Live finding that made this its own module: `shell:
 *   process.platform === 'win32'` on the query spawn let Node's own
 *   array-to-command-line join corrupt the untrusted question — against the
 *   real `graphify.exe`, a multi-word question collapsed onto only its
 *   first word and graphify answered unrelated nodes, and a crafted search
 *   pattern (e.g. a Glob `**\/*&calc&`) could have launched an arbitrary
 *   program. `spawnGraphifySync` below is `shell:false` FIRST and ALWAYS for
 *   the real binary — there is no shell at all on that path, so shell
 *   metacharacters in any argv element are inert bytes, not command syntax.
 */

const { spawnSync } = require('node:child_process');

/**
 * Strict-quote one argv element for a literal cmd.exe command line. Used
 * ONLY by `spawnGraphifySync`'s ENOENT shell fallback — an explicit
 * `.cmd`/`.bat` binary override (the real `graphify` binary is a
 * `.exe`/native executable and never takes this path). Wraps the argument in
 * double quotes and escapes embedded double quotes; deliberately narrower
 * than a general cmd.exe escaper (it does not separately neutralise
 * `&`/`|`/`^`/`%` — cmd.exe treats those as literal once inside a quoted
 * span) but every element handed to it is already a discrete argv element,
 * never a string built by interpolating untrusted input.
 */
function quoteForCmdExe(arg) {
  return `"${String(arg).replace(/"/g, '\\"')}"`;
}

// child_process error codes a shell-less spawn of a non-PE Windows binary
// (a `.cmd`/`.bat` batch file) can surface — measured both: an async `spawn`
// reports `ENOENT` (the historical, documented case — see
// `graphify-state.js`'s `runBgEntrypointChild`), while `spawnSync` on a
// current Node/Windows build was measured reporting `EINVAL` for the exact
// same input. Both mean the same thing here — "CreateProcess cannot exec
// this file directly" — never a signal to widen the fallback to anything
// else.
const SHELLLESS_BATCH_SPAWN_ERROR_CODES = new Set(['ENOENT', 'EINVAL']);

/**
 * Run `bin args…` synchronously, `shell:false` first and always. The ONE
 * fallback: if that spawn fails with an error CODE that means "this file
 * cannot be exec'd directly" (see `SHELLLESS_BATCH_SPAWN_ERROR_CODES`) AND
 * `bin` is an explicit `.cmd`/`.bat` path (the real `graphify` binary is a
 * `.exe`/native executable and never takes this path), retry exactly once
 * through `shell:true` — but with every argv element quoted by
 * `quoteForCmdExe` ourselves into a single command string, NEVER by handing
 * Node's `shell:true` the raw `(command, args)` pair (that array-join is
 * exactly the corruption mechanism this function exists to avoid). Never
 * throws — a spawn failure comes back as `{error}` on the returned object,
 * same as plain `spawnSync`.
 * @param {string} bin
 * @param {string[]} args
 * @param {object} opts spawnSync options (cwd, timeout, encoding, …) — `shell` is ignored/overridden
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function spawnGraphifySync(bin, args, opts = {}) {
  const direct = spawnSync(bin, args, { ...opts, shell: false });
  const isExplicitShim = /\.(cmd|bat)$/i.test(String(bin));
  if (direct.error && SHELLLESS_BATCH_SPAWN_ERROR_CODES.has(direct.error.code) && process.platform === 'win32' && isExplicitShim) {
    const commandLine = [bin, ...args].map(quoteForCmdExe).join(' ');
    return spawnSync(commandLine, { ...opts, shell: true });
  }
  return direct;
}

module.exports = { quoteForCmdExe, spawnGraphifySync };
