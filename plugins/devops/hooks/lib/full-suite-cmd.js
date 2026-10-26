'use strict';
/**
 * @module full-suite-cmd
 * @version 0.1.0
 * @description Recognises a FULL test-suite run in a shell command: `npm test`,
 *   `npm run test`, `npm t`, `npx vitest run`, `vitest run` with no test-file
 *   filter. Shared by pre.ship.test-guard (blocks it during a ship) and
 *   post.test.record (records a green one for the tree).
 *
 *   A run is FILTERED (not full) when a positional argument names files/names
 *   (`vitest run a.test.js`, `npm test -- a.test.js`), or it is `vitest related`,
 *   `--changed`, or watch mode (no `run`). Quoted text is blanked first, so a
 *   command that merely mentions `npm test` in a string is not a run.
 */

const VALUED = new Set(['--reporter', '--outputFile', '--config', '-c', '--root', '-r', '--dir', '--project', '--pool',
  '--maxWorkers', '--minWorkers', '--testTimeout', '--hookTimeout', '-t', '--testNamePattern', '--shard', '--mode',
  '--environment', '--coverage.reporter']);

/** Blank quoted strings (keep the quotes) so words inside them never match. */
function blankQuoted(cmd) {
  return String(cmd || '').replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1]);
}

/** Positional (non-flag) tokens, skipping the values of known value flags. */
function positionals(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (a.startsWith('-')) { if (VALUED.has(a)) i++; continue; }
    out.push(a);
  }
  return out;
}

/**
 * Is this ONE command segment (no &&, ;, |) a full-suite run?
 * @param {string} segment
 * @returns {boolean}
 */
function isFullSuiteSegment(segment) {
  const toks = String(segment).trim().split(/\s+/).filter(Boolean);
  const isEnv = (t) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);
  while (toks.length && isEnv(toks[0])) toks.shift();
  if (toks[0] === 'cross-env') { toks.shift(); while (toks.length && isEnv(toks[0])) toks.shift(); }
  let rest;
  if (toks[0] === 'npm' && (toks[1] === 'test' || toks[1] === 't')) rest = toks.slice(2);
  else if (toks[0] === 'npm' && toks[1] === 'run' && toks[2] === 'test') rest = toks.slice(3);
  else if (toks[0] === 'npx' && toks[1] === 'vitest' && toks[2] === 'run') rest = toks.slice(3);
  else if (toks[0] === 'vitest' && toks[1] === 'run') rest = toks.slice(2);
  else return false;
  if (rest.some((a) => a === '--changed' || a.startsWith('--changed='))) return false;
  const args = rest[0] === '--' ? rest.slice(1) : rest;
  if (args[0] === 'related') return false;
  return positionals(args).length === 0;
}

/**
 * Any segment of the command (split on && || ; | newline) is a full-suite run?
 * Used by the guard: strict, any occurrence counts.
 * @param {string} cmd
 * @returns {boolean}
 */
function containsFullSuite(cmd) {
  return blankQuoted(cmd).split(/&&|\|\||;|\||\r?\n/).some(isFullSuiteSegment);
}

/**
 * Split into `&&`-chained segments, or null when the line uses `||`, `;`, `|`,
 * a single `&` or several lines: its success would not mean the suite passed.
 */
function andChain(cmd) {
  const s = blankQuoted(cmd).trim();
  if (/\|\||;|\||\r|\n/.test(s) || /(?<!&)&(?!&)/.test(s.replace(/\d?>&\d|&>/g, ''))) return null;
  return s.split('&&').map((x) => x.trim()).filter(Boolean);
}

/**
 * The full-suite segment when `cmd` is `[cd x &&] … && <full suite>` and ends
 * with it, so "tool succeeded" means "suite green on the tree as it is now".
 * @param {string} cmd
 * @returns {{segment: string, cdTo: (string|null)}|null}
 */
function trailingFullSuite(cmd) {
  const segs = andChain(cmd);
  if (!segs || segs.length === 0) return null;
  if (!isFullSuiteSegment(segs[segs.length - 1])) return null;
  let cdTo = null;
  for (const s of segs.slice(0, -1)) {
    const m = /^cd\s+(\S+)$/.exec(s);
    if (m) cdTo = m[1].replace(/^["']|["']$/g, '');
  }
  return { segment: String(cmd).split('&&').pop().trim(), cdTo };
}

module.exports = { isFullSuiteSegment, containsFullSuite, trailingFullSuite, blankQuoted };
