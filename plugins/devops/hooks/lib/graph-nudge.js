'use strict';
/**
 * @lib graph-nudge
 * @version 0.1.0
 * @plugin devops
 * @description Pure helpers for the ambient graphify nudge injected by
 *   pre.tokens.guard on the first broad search of a session. Detects whether a
 *   graphify knowledge graph exists in the project and builds the one-line hint
 *   that steers Claude toward `graphify query` instead of grepping raw files.
 *   Kept separate from the hook so the decision logic is unit-testable without
 *   stdin plumbing or an installed graphify.
 */

const fs = require('node:fs');
const path = require('node:path');

// graphify's default output location (see the devops-graph skill).
const GRAPH_JSON_REL = path.join('graphify-out', 'graph.json');

/** Absolute path to the project's graph.json under `cwd`. */
function graphJsonPath(cwd) {
  return path.join(cwd, GRAPH_JSON_REL);
}

/** True iff a graphify graph.json exists for this project. Never throws. */
function hasGraph(cwd) {
  try {
    return fs.statSync(graphJsonPath(cwd)).isFile();
  } catch {
    return false;
  }
}

/** The ambient hint appended to the session-start injection when a graph exists. */
function buildGraphNudge() {
  return [
    '[graphify] A knowledge graph exists at graphify-out/graph.json.',
    'For semantic questions (what defines/calls X, how do A and B relate, where is',
    'Y handled), prefer `graphify query "<question>"` over grepping raw files — it',
    'reads the graph, not the code, so it is cheaper. Refresh with /devops-graph if',
    'the code changed meaningfully.',
  ].join('\n');
}

// Directories whose contents never count toward "newest source file": VCS,
// dependencies, build output, and graphify's own output. Dot-dirs are skipped
// too (handled in the walk), so .git/.claude/.venv are covered by both.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'graphify-out', '.claude', 'dist', 'build',
  'coverage', '.next', 'out', 'vendor', '.venv', '__pycache__', 'target',
]);

/**
 * Scan project source files for the newest mtime, ignoring SKIP_DIRS and
 * dot-dirs. Symlinked dirs/files ARE followed (resolved via stat) so a newer
 * file behind a symlink is not invisible. Bounded by `opts.maxFiles` (default
 * 8000); if the bound is hit the scan is `truncated`. Never throws.
 * @returns {{newest:number, count:number, truncated:boolean}}
 */
function scanSources(cwd, opts = {}) {
  const maxFiles = opts.maxFiles || 8000;
  let newest = 0;
  let count = 0;
  const stack = [cwd];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (count >= maxFiles) return { newest, count, truncated: true };
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        // Resolve the link target so symlinked source is not silently skipped.
        // Loops are bounded by maxFiles → truncated → treated as stale upstream.
        try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); }
        catch { continue; }
      }
      if (isDir) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (isFile) {
        count++;
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        } catch { /* unreadable — skip */ }
      }
    }
  }
  return { newest, count, truncated: false };
}

/**
 * Is the graph stale relative to the working tree? This is the hard
 * precondition for the PreToolUse graphify-gate — a hard block must NEVER force
 * Claude onto an out-of-date graph, so it is deliberately fail-safe: when
 * freshness cannot be PROVEN, return stale (the gate then simply does not fire).
 * Stale when: graph.json is missing; the scan was truncated (could not see all
 * files); no source files were found; or any source file is newer than the
 * graph. Fresh only when the full scan saw ≥1 file and none is newer.
 */
function graphIsStale(cwd, opts = {}) {
  let graphMtime;
  try { graphMtime = fs.statSync(graphJsonPath(cwd)).mtimeMs; } catch { return true; }
  const { newest, count, truncated } = scanSources(cwd, opts);
  if (truncated) return true;   // partial scan → cannot prove freshness
  if (count === 0) return true; // nothing comparable → do not enforce
  return newest > graphMtime;
}

module.exports = {
  GRAPH_JSON_REL,
  graphJsonPath,
  hasGraph,
  buildGraphNudge,
  scanSources,
  graphIsStale,
};
