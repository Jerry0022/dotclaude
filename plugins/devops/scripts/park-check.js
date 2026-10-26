#!/usr/bin/env node
/**
 * @script park-check
 * @version 0.1.0
 * @plugin devops
 * @description Before a dirty worktree is committed, secured or parked: is
 *   its uncommitted "work" only an older state of the base branch (a stale
 *   checkout, #877)? Prints one JSON line
 *   { stale, base, changed, reverted[], own[], message } and exits 0.
 *   `message` is the factual commit subject to use when it is NOT stale
 *   ("wip: N file(s) differ from <base>") — never an inferred intent.
 *   Usage: node park-check.js <worktree> [--base <ref>]  (default origin/<default branch>)
 */

'use strict';

const path = require('path');
const { staleRevert } = require('../hooks/lib/stale-revert');
const { dirtyPaths } = require('../hooks/lib/integration-check');
const { defaultBranch } = require('../hooks/lib/wip-commit');

async function main(argv) {
  const wt = path.resolve(argv.find((a) => !a.startsWith('--')) || process.cwd());
  const i = argv.indexOf('--base');
  const def = defaultBranch(wt);
  const base = i >= 0 ? argv[i + 1] : (def ? `origin/${def}` : null);
  const changed = await dirtyPaths(wt);
  const r = base ? staleRevert(wt, changed, base) : { stale: false, reverted: [], own: [] };
  return {
    stale: r.stale, base, changed: changed.length, reverted: r.reverted, own: r.own,
    message: r.stale ? null : `wip: ${changed.length} file(s) differ from ${base || 'HEAD'}`,
  };
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((out) => process.stdout.write(JSON.stringify(out) + '\n'))
    .catch(() => process.stdout.write(JSON.stringify({ stale: false, error: 'park-check failed' }) + '\n'));
}

module.exports = { main };
