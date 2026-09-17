'use strict';
/**
 * @lib graph-nudge
 * @version 0.4.0
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

// graphify's default output location (see the auto-graph skill).
const GRAPH_JSON_REL = path.join('graphify-out', 'graph.json');

/** Absolute path to the project's graph.json under `cwd`. */
function graphJsonPath(cwd) {
  return path.join(cwd, GRAPH_JSON_REL);
}

// Cheap validity floor for the PreToolUse hot path: a 0-byte or near-empty
// graph.json (partial write, truncated extract) must not count as present.
// Deliberately NOT a JSON.parse here — this runs on every broad search, so it
// stays a statSync-only check. A deeper (JSON-parsing) validity check belongs
// to the SessionStart hook, which runs once per session (see ss.graphify.js).
const MIN_GRAPH_BYTES = 512;

/** statSync-only presence + size-floor check for one candidate path. Never throws. */
function graphFileUsable(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > MIN_GRAPH_BYTES;
  } catch {
    return false;
  }
}

/**
 * Where the graph for `cwd` actually lives. Candidates, first usable wins:
 *   1. `local`  — `<cwd>/graphify-out/graph.json` (graphify's default)
 *   2. `root`   — the same under the enclosing git work-tree root (a session
 *                 whose cwd is a subdirectory of the project)
 *   3. `main`   — the PRIMARY checkout's graph when `cwd` is a linked worktree
 *                 (graphify-state `mainCheckoutRoot`)
 * A linked worktree starts graph-less until its own background build lands,
 * while the primary checkout usually holds a fresh graph already; falling back
 * to it makes the nudge/gate live from the first search instead of never
 * (measured: 11 of 20 sessions had no graph in cwd). Callers pass `.file` to
 * `graphify query --graph` when `.source !== 'local'`. Never throws.
 * @returns {{file:string, source:'local'|'root'|'main'}|null}
 */
function resolveGraphJson(cwd) {
  const local = graphJsonPath(cwd);
  if (graphFileUsable(local)) return { file: local, source: 'local' };
  let gstate;
  try { gstate = require('./graphify-state'); } catch { return null; }
  try {
    const root = gstate.findRepoRoot(cwd);
    if (root && path.resolve(root) !== path.resolve(cwd)) {
      const f = graphJsonPath(root);
      if (graphFileUsable(f)) return { file: f, source: 'root' };
    }
    const main = gstate.mainCheckoutRoot(cwd);
    if (main) {
      const f = graphJsonPath(main);
      if (graphFileUsable(f)) return { file: f, source: 'main' };
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * True iff a usable graph exists for `cwd` — locally, at the repo root, or in
 * the primary checkout (see `resolveGraphJson`). Never throws.
 */
function hasGraph(cwd) {
  return resolveGraphJson(cwd) !== null;
}

/** True iff `cwd` itself holds a usable graph (no fallback) — the build-side check. */
function hasLocalGraph(cwd) {
  return graphFileUsable(graphJsonPath(cwd));
}

/**
 * The `--graph <path>` suffix a query needs when the resolved graph is not
 * graphify's cwd-relative default; '' when it is (or nothing resolved).
 */
function graphFlag(cwd) {
  const r = resolveGraphJson(cwd);
  return r && r.source !== 'local' ? ` --graph "${r.file}"` : '';
}

/**
 * The ambient hint appended to the session-start injection when a graph exists.
 * With a `cwd`, names the resolved graph and carries the `--graph` flag so a
 * worktree session queries the primary checkout's graph without guessing.
 */
function buildGraphNudge(cwd) {
  const r = cwd ? resolveGraphJson(cwd) : null;
  const where = r && r.source !== 'local' ? r.file : 'graphify-out/graph.json';
  const flag = r && r.source !== 'local' ? ` --graph "${r.file}"` : '';
  return [
    `[graphify] A knowledge graph exists at ${where}.`,
    'For semantic questions (what defines/calls X, how do A and B relate, where is',
    `Y handled), prefer \`graphify query "<question>"${flag}\` over grepping raw files — it`,
    'reads the graph, not the code, so it is cheaper. Refresh with /auto-graph if',
    'the code changed meaningfully.',
  ].join('\n');
}

/**
 * Derive a concrete `graphify query` suggestion from the actual blocked
 * search (Gap #3) so the gate message is actionable instead of the generic
 * `<your question>` placeholder. Deliberately dumb and predictable: strip
 * regex metacharacters/escapes, collapse separators to spaces, and wrap the
 * remaining words in a fixed "What defines or uses X?" template. Never
 * throws; falls back to the generic placeholder when nothing usable remains.
 */
function suggestQuery(pattern, graphFlagSuffix = '') {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return `graphify query "<your question>"${graphFlagSuffix}`;
  }
  const words = pattern
    .replace(/\\[a-zA-Z]/g, ' ')          // \d \w \s \b etc.
    .replace(/[.*+?^${}()|[\]\\]/g, ' ')  // regex metacharacters
    .replace(/[_-]/g, ' ')                // snake/kebab separators → words
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return `graphify query "<your question>"${graphFlagSuffix}`;
  return `graphify query "What defines or uses ${words.join(' ')}?"${graphFlagSuffix}`;
}

// Directories whose contents never count toward "newest source file": VCS,
// dependencies, build output, and graphify's own output. Dot-dirs are skipped
// too (handled in the walk), so .git/.claude/.venv are covered by both.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'graphify-out', '.claude', 'dist', 'build',
  'coverage', '.next', 'out', 'vendor', '.venv', '__pycache__', 'target',
]);

/**
 * Scan project source files for the newest mtime (and, when `opts.newerThan`
 * is given, how many files are newer than that reference mtime), ignoring
 * SKIP_DIRS and dot-dirs. Symlinked dirs/files ARE followed (resolved via
 * stat) so a newer file behind a symlink is not invisible. Bounded by
 * `opts.maxFiles` (default 8000); if the bound is hit the scan is
 * `truncated`. Single walk — both `graphIsStale` and `stalenessInfo` reuse it,
 * so bounded-tolerance staleness never costs a second filesystem pass. Never
 * throws.
 * @returns {{newest:number, count:number, truncated:boolean, newerCount:number}}
 */
function scanSources(cwd, opts = {}) {
  const maxFiles = opts.maxFiles || 8000;
  const newerThan = opts.newerThan || 0;
  let newest = 0;
  let count = 0;
  let newerCount = 0;
  const stack = [cwd];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (count >= maxFiles) return { newest, count, truncated: true, newerCount };
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
          if (m > newerThan) newerCount++;
        } catch { /* unreadable — skip */ }
      }
    }
  }
  return { newest, count, truncated: false, newerCount };
}

/**
 * Bounded-staleness read for the PreToolUse graphify-gate. Rather than a
 * binary fresh/stale verdict, reports HOW MANY source files are newer than
 * the graph (`newerCount`) so the gate can apply a tolerance band: a graph
 * that lags a handful of files behind is still useful and worth enforcing
 * (with a disclosure + a kicked background refresh), while a graph that
 * cannot be trusted at all (missing, or the scan was truncated / found
 * nothing comparable) must never be enforced. `newerCount` is reported as
 * `Infinity` in the "cannot be trusted at all" cases so any tolerance
 * threshold naturally treats them as fully stale. Reuses the single
 * `scanSources` walk. Never throws.
 * @returns {{newerCount:number, truncated:boolean, graphMtime:number}}
 */
function stalenessInfo(cwd, opts = {}) {
  // Resolved graph (local → repo root → primary checkout) vs. THIS tree's
  // sources: a worktree measured against the primary graph counts its own
  // branch edits as "newer", which is exactly the lag that graph has.
  let graphMtime;
  try {
    const r = resolveGraphJson(cwd);
    if (!r) return { newerCount: Infinity, truncated: false, graphMtime: 0 };
    graphMtime = fs.statSync(r.file).mtimeMs;
  } catch { return { newerCount: Infinity, truncated: false, graphMtime: 0 }; }
  const { count, truncated, newerCount } = scanSources(cwd, { ...opts, newerThan: graphMtime });
  if (truncated) return { newerCount: Infinity, truncated: true, graphMtime };
  if (count === 0) return { newerCount: Infinity, truncated: false, graphMtime }; // nothing comparable
  return { newerCount, truncated: false, graphMtime };
}

/**
 * Is the graph stale relative to the working tree? Binary convenience wrapper
 * over `stalenessInfo` (newerCount > 0), kept for callers that only need a
 * yes/no answer. The PreToolUse gate itself uses `stalenessInfo` directly so
 * it can apply a bounded-tolerance policy instead of this strict boundary —
 * see the `GRAPHIFY_STALE_TOLERANCE` policy in pre.tokens.guard.js.
 */
function graphIsStale(cwd, opts = {}) {
  const info = stalenessInfo(cwd, opts);
  return info.truncated || info.newerCount > 0;
}

module.exports = {
  GRAPH_JSON_REL,
  MIN_GRAPH_BYTES,
  graphJsonPath,
  resolveGraphJson,
  hasGraph,
  hasLocalGraph,
  graphFlag,
  buildGraphNudge,
  suggestQuery,
  scanSources,
  stalenessInfo,
  graphIsStale,
};
