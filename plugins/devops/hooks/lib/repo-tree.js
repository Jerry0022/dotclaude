'use strict';
/**
 * @module repo-tree
 * @version 0.1.0
 * @plugin devops
 * @description Is a file inside the git work tree of the hook's cwd? Edits and
 *   writes outside it (a scratchpad, %TEMP%, ~/.claude) change nothing a card
 *   ships, so they must not count as code edits (edit counter, SHIP / test
 *   nudges) nor make the Stop gate classify a turn as "changed something".
 *   The root is the one `git rev-parse --show-toplevel` prints (pure fs walk via
 *   project-root, no git spawn). No work tree around the cwd -> true: without a
 *   repo there is nothing to compare against, the old behaviour stays.
 */

const path = require('path');
const { findRepoRoot, projectRoot, isInside } = require('./project-root');

/**
 * @param {unknown} file path of the edited file (absolute, or relative to cwd)
 * @param {string} [cwd] the hook's cwd
 * @returns {boolean}
 */
function inRepoTree(file, cwd) {
  try {
    if (typeof file !== 'string' || !file) return true;
    const base = cwd || process.cwd();
    if (!findRepoRoot(base)) return true;
    return isInside(path.resolve(base, file), projectRoot(base));
  } catch {
    return true;
  }
}

module.exports = { inRepoTree };
