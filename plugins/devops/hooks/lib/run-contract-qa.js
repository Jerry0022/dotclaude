'use strict';
/**
 * @module run-contract-qa
 * @version 0.1.0
 * @plugin devops
 * @description The one qa measurement (AUD-010): base resolution + changed
 *   code files, shared by the PreToolUse gate (pre-tool-use/pre.run.contract.js)
 *   and the CLI (`status` / `done` in run-contract-cli.js) so both report the
 *   same number. Before this module the CLI evaluated obligations with an
 *   empty ctx — qa was never measured there, so `done` could close a run
 *   while qa was owed even though a real gated call would have refused it.
 *
 *   safeBase(explicit) → string  (RT2-R7: rejects flag-injection / `..` / whitespace)
 *   resolveBase(root, explicit, C, budget?) → string  (explicit, else origin/HEAD, else main/master)
 *   codeFilesChanged(root, gate, base, gitLines?, budget?) → number|null (AUD-007/H-B4/RT3-R6)
 *   measureQa(root, gate, explicitBase, opts?) → number|null
 *     (opts: {C, budget, totalMs} — one gitBudget bounds the whole chain,
 *     AUD-019; an expired budget or any git failure reads as unknown, null,
 *     never a block)
 */

const SAFE_BASE_RE = /^[\p{L}\p{N}._/+@-]+$/u;

// RT2-R7: widened to Unicode letters/digits (`größe`, non-ASCII branch names
// are legal in git) plus `._/+@-` (`release/1.2`, `feat/a+b`, `user@x`).
// Still rejects a leading `-` (flag injection), `..` anywhere (path-
// traversal-ish ref, also invalid in a git refname) and anything with
// whitespace / control characters (excluded by the character class).
function safeBase(explicit) {
  const b = typeof explicit === 'string' ? explicit.trim() : '';
  if (!b || b.startsWith('-') || b.includes('..') || !SAFE_BASE_RE.test(b)) return '';
  return b;
}

/**
 * The qa diff base (R9): an explicit base, else origin/HEAD's branch, else
 * `main`, then `master` when that exists locally or on origin. An unsafe
 * explicit base (leading `-`, shell metacharacters) is never trusted — the
 * base is auto-detected instead (AUD-007).
 * @param {object} [budget] an optional git-timeout gitBudget() shared across a chain (AUD-019)
 */
function resolveBase(root, explicit, C, budget) {
  const safe = safeBase(explicit);
  if (safe) return safe;
  const opts = budget ? { budget } : undefined;
  const sym = C.gitOut(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], opts);
  if (sym) return sym.replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (C.gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], opts)
      || C.gitOut(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`], opts)) return b;
  }
  return 'main';
}

const { GIT_TIMEOUT_MS } = require('./git-timeout');

/**
 * Changed code files for the qa rule, or null (unknown).
 * @param {(root:string, args:string[], opts?:object) => string[]} [gitLines]
 *   defaults to run-contract-calls' gitLines; tests inject a fake
 * @param {object} [budget] an optional git-timeout gitBudget() shared across a chain (AUD-019)
 */
function codeFilesChanged(root, gate, base, gitLines = require('./run-contract-calls').gitLines, budget) {
  try {
    // H-A6: gitLines throws on a git failure → the catch below = unknown.
    const opts = budget ? { budget } : { timeout: GIT_TIMEOUT_MS };
    const diff = (range) => gitLines(root, ['diff', '--name-only', range], opts);
    let names;
    try { names = diff(`origin/${base}...HEAD`); } catch { names = diff(`${base}...HEAD`); }
    const set = new Set(names);
    if (gate !== 'release') {
      for (const n of diff('HEAD')) set.add(n);
      // H-B4: new code files never `git add`ed count too. RT3-R6: a failing
      // or slow ls-files keeps the diff count instead of making it unknown.
      try {
        for (const n of gitLines(root, ['ls-files', '--others', '--exclude-standard'], opts)) set.add(n);
      } catch { /* untracked files unknown: the diff count stands */ }
    }
    const { isCodeChange } = require('./browsertest-guard');
    return [...set].filter(f => isCodeChange(f)).length;
  } catch { return null; }
}

/**
 * The gate's qa measurement (AUD-010/AUD-019): one shared base + count,
 * bounded by one gitBudget for the whole chain — an expired budget or any
 * git failure reads as unknown (null), never a block.
 * @param {string} root the git root to measure
 * @param {'release'|'card'|'branch'|string} gate
 * @param {string} [explicitBase]
 * @param {{C?:object, budget?:object, totalMs?:number}} [opts]
 *   `C` defaults to run-contract-calls; a caller-supplied `budget` wins over
 *   `totalMs` (which else seeds a fresh gitBudget()).
 * @returns {number|null}
 */
function measureQa(root, gate, explicitBase, opts = {}) {
  const C = opts.C || require('./run-contract-calls');
  const budget = opts.budget || require('./git-timeout').gitBudget(opts.totalMs);
  try {
    if (budget.expired()) return null;
    const base = resolveBase(root, explicitBase, C, budget);
    if (budget.expired()) return null;
    return codeFilesChanged(root, gate, base, C.gitLines, budget);
  } catch { return null; }
}

module.exports = { safeBase, resolveBase, codeFilesChanged, measureQa };
