'use strict';
/**
 * @lib graph-nudge
 * @version 0.6.0
 * @plugin devops
 * @description Pure helpers for the ambient graphify nudge injected by
 *   pre.tokens.guard on the first broad search of a session. Detects whether a
 *   graphify knowledge graph exists in the project and builds the one-line hint
 *   that steers Claude toward `graphify query` instead of grepping raw files.
 *   Also carries the gate ELIGIBILITY heuristic (`isEligibleSearch`) that
 *   decides which searches are worth answering from the graph at all — a
 *   default-budget query (4.7k-6.3k chars) costs more than most scoped grep
 *   results (p50 1025 chars), so the gate must stay narrow: Grep only (Glob
 *   keeps the classic block, no answer-in-gate), path-less OR a `content`-mode
 *   directory search inside the resolved graph root, and a pattern that reads
 *   as a semantic/identifier question rather than an exact string, a path, or
 *   a version literal. Kept separate from the hook so the decision logic is
 *   unit-testable without stdin plumbing or an installed graphify.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
 * Turn a search pattern into a bare-terms graph question. Deliberately dumb
 * and predictable: strip regex metacharacters/escapes, collapse separators to
 * spaces, and send ONLY the extracted terms — no "What defines or uses X?"
 * template. Two live findings drove dropping the template: (1) graphify
 * matched the template's own noise words ("what", "defines", "uses") instead
 * of the real terms, corrupting answers for on-topic queries; (2) it is dead
 * weight once the terms alone are enough for a graph traversal query. The
 * result is additionally sanitized to `[A-Za-z0-9 ]` ONLY — defence in depth:
 * this string becomes one argv element passed straight to `graphify` (see
 * pre.tokens.guard's answer-in-gate), never shell-interpolated, but a
 * corrupted/legacy spawn path must never be able to carry a shell
 * metacharacter through here regardless. Never throws; returns null when
 * nothing usable remains. Shared by `suggestQuery` (the display suggestion)
 * and the PreToolUse answer-in-gate (the actual `graphify query` argument).
 */
function questionFromPattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return null;
  const words = pattern
    .replace(/\\[a-zA-Z]/g, ' ')          // \d \w \s \b etc.
    .replace(/[.*+?^${}()|[\]\\]/g, ' ')  // regex metacharacters
    .replace(/[_-]/g, ' ')                // snake/kebab separators → words
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  const sanitized = words.join(' ').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || null;
}

/**
 * Derive a concrete `graphify query` suggestion from the actual blocked
 * search (Gap #3) so the gate message is actionable instead of the generic
 * `<your question>` placeholder. Never throws; falls back to the generic
 * placeholder when nothing usable remains.
 */
function suggestQuery(pattern, graphFlagSuffix = '') {
  const q = questionFromPattern(pattern);
  if (!q) return `graphify query "<your question>"${graphFlagSuffix}`;
  return `graphify query "${q}"${graphFlagSuffix}`;
}

// ── Gate eligibility heuristic ────────────────────────────────────────────
// Whether a search is even worth answering from the graph. A default-budget
// `graphify query` costs 4.7k-6.3k chars — MORE than most scoped grep results
// (p50 1025 chars) — so forcing an answer onto every search would cost more
// tokens than it saves. Only Grep is eligible at all (Glob keeps the classic
// broad-search block only — see `isEligibleSearch` below), and only when the
// pattern looks like a semantic/identifier question AND either the search is
// path-less or it is a `content`-mode search scoped to a directory inside the
// resolved graph root.

/**
 * Cheap, statSync-only classification of a Grep/Glob `path` input for
 * telemetry and eligibility. Never throws.
 * @returns {'none'|'dir'|'file'} 'file' also covers a nonexistent path — an
 *   unresolvable path is never treated as an eligible directory scope.
 */
function pathKindFor(searchPath, cwd) {
  if (!searchPath) return 'none';
  try {
    const abs = path.isAbsolute(searchPath) ? searchPath : path.join(cwd || process.cwd(), searchPath);
    return fs.statSync(abs).isDirectory() ? 'dir' : 'file';
  } catch {
    return 'file';
  }
}

/**
 * True iff `term` looks specific enough to be worth a graph traversal on its
 * own: camelCase (a lower→upper transition), snake_case/kebab-case (`_`/`-`),
 * a dotted name (`.`), or just plain long (≥8 significant characters).
 * Deliberately excludes bare short lowercase words — `error`, `import` — an
 * eligible pattern needs at least ONE term like this (R10): those common
 * words matched far too much of the graph to be worth a query.
 */
function isSpecificTerm(term) {
  if (/[a-z][A-Z]/.test(term)) return true;            // camelCase
  if (term.includes('_') || term.includes('-')) return true; // snake_case / kebab-case
  if (term.includes('.')) return true;                  // dotted.name
  return term.replace(/[_.-]/g, '').length >= 8;         // just long enough
}

/**
 * True iff `pattern` reads as a semantic/identifier-like question the graph
 * can plausibly answer: 1-4 identifier-ish terms (camelCase, snake_case,
 * kebab-case, dotted names, or a `|` alternation of such terms) once regex
 * escapes are stripped, with AT LEAST ONE term specific enough
 * (`isSpecificTerm`) that the graph is likely to have something narrow to say
 * about it — a pattern built entirely from common short words (`error`,
 * `import`) is rejected even though each individual term parses as a valid
 * identifier shape (R10). Also rejects version/number literals (`0\.51\.0`),
 * path-like patterns (containing a slash), quoted/sentence patterns (more
 * than 4 words), very short terms (<3 significant characters), and patterns
 * with heavy regex structure (character classes, groups, quantifiers,
 * anchors). Never throws.
 */
function isSemanticPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  // Version/number literal: nothing but digits, dots and escapes (0\.51\.0).
  if (/^[\d.\\]+$/.test(trimmed)) return false;
  const stripped = trimmed.replace(/\\[a-zA-Z]/g, ' '); // \d \w \s \b etc.
  // Path-like: a slash (escaped or not) means "a file location", not a name.
  if (/\\?\//.test(stripped)) return false;
  // Heavy regex structure: character classes, groups, quantifiers, anchors.
  if (/[[\](){}^$*+?]/.test(stripped)) return false;
  const terms = stripped
    .split(/[|\s]+/)
    .map(t => t.trim())
    .filter(Boolean);
  if (!terms.length || terms.length > 4) return false; // nothing left, or a sentence/phrase
  for (const term of terms) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(term)) return false;
    if (term.replace(/[_.-]/g, '').length < 3) return false; // very short term
  }
  if (!terms.some(isSpecificTerm)) return false; // R10 — no common-word-only patterns
  return true;
}

// Directories whose contents never count toward "newest source file": VCS,
// dependencies, build output, and graphify's own output. Dot-dirs are skipped
// too (handled in the walk), so .git/.claude/.venv are covered by both.
// Also used by `isInsideGraphScope` (R4/R7) — a directory search under one of
// these is never eligible even if it sits under the resolved graph root.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'graphify-out', '.claude', 'dist', 'build',
  'coverage', '.next', 'out', 'vendor', '.venv', '__pycache__', 'target',
]);

/**
 * The directory whose `graphify-out/graph.json` was resolved for `cwd` — the
 * root a directory-scoped search must lie under to be eligible. `null` when
 * no graph resolves. Never throws.
 */
function resolveGraphRoot(cwd) {
  const r = resolveGraphJson(cwd);
  if (!r) return null;
  // GRAPH_JSON_REL is always the two segments `graphify-out/graph.json`.
  return path.dirname(path.dirname(r.file));
}

/**
 * True iff `searchPath` (a directory) lies inside the resolved graph root AND
 * no path segment between the root and it is a SKIP_DIRS entry or a dot-dir —
 * a directory search outside the indexed tree, or inside `node_modules` /
 * `.git` / graphify's own output, is never eligible (R4/R7). Never throws.
 */
function isInsideGraphScope(searchPath, cwd) {
  try {
    const root = resolveGraphRoot(cwd);
    if (!root) return false;
    const abs = path.isAbsolute(searchPath) ? searchPath : path.join(cwd || process.cwd(), searchPath);
    const rel = path.relative(root, abs);
    if (rel === '') return true; // the root itself
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false; // outside the root
    const segments = rel.split(/[\\/]/);
    return !segments.some(seg => SKIP_DIRS.has(seg) || seg.startsWith('.'));
  } catch {
    return false;
  }
}

/**
 * Is this Grep call worth answering from the graph? (R4/R7 — Glob is REMOVED
 * from the answer-in-gate entirely; glob patterns are shell globs, not
 * identifier questions, and keep only the classic broad-search block.) Grep
 * is eligible when:
 *   - the pattern reads as a semantic/identifier question (`isSemanticPattern`), AND
 *   - EITHER the search is path-less (the classic full-repo block would fire
 *     on it anyway — an answer simply replaces that block), OR the search is
 *     scoped to an existing DIRECTORY inside the resolved graph root (never a
 *     single file, and never outside SKIP_DIRS) with `output_mode: 'content'`.
 *     `files_with_matches`/`count` in a directory is deliberately NOT
 *     eligible — at a measured p50 of ~1k chars those modes are already
 *     cheaper than a block round-trip plus a ~400-token graph answer. No
 *     `glob`/`type` filter — those narrow the search further, which can only
 *     make the graph MORE likely to help, not less.
 * Never throws.
 */
function isEligibleSearch(toolName, toolInput = {}, cwd) {
  if (toolName !== 'Grep') return false;
  if (!isSemanticPattern(toolInput.pattern)) return false;
  if (!toolInput.path) return true;
  if (toolInput.output_mode !== 'content') return false;
  if (pathKindFor(toolInput.path, cwd) !== 'dir') return false;
  return isInsideGraphScope(toolInput.path, cwd);
}

// graphify's traversal summary line, e.g. "Traversal: BFS depth=2 | 33 nodes
// found". Anything printed BEFORE this header (warnings, deprecation notices)
// must never be mistaken for an answer, and "No matching nodes found." (no
// header at all, or N=0) must never count as one either.
const TRAVERSAL_HEADER_RE = /Traversal:[^\n]*\|\s*(\d+)\s*nodes?\s*found/i;

/**
 * True iff `stdout` carries a real graph answer: the `Traversal: … | N nodes
 * found` header with N>0. A bare "No matching nodes found." (no header, or a
 * header reporting 0) is never an answer, and neither is anything printed
 * only BEFORE a header that never actually appears. Never throws.
 */
function hasGraphAnswer(stdout) {
  const m = TRAVERSAL_HEADER_RE.exec(String(stdout || ''));
  return !!m && Number(m[1]) > 0;
}

/**
 * The delivered answer, trimmed to start AT the traversal header — drops any
 * warning/log lines graphify printed before it. Falls back to the trimmed
 * full text when no header is present (should not happen once `hasGraphAnswer`
 * gated the call, but never throws either way).
 */
function trimToTraversalHeader(stdout) {
  const t = String(stdout || '');
  const m = TRAVERSAL_HEADER_RE.exec(t);
  return (m ? t.slice(m.index) : t).trim();
}

/**
 * Short, stable hash of the exact search a gate event is about — links a
 * `gate_bypassed` telemetry event back to the `gate_fired` it bypassed
 * without carrying the raw (possibly sensitive) pattern text. `costFieldsJson`
 * is the caller's own `JSON.stringify(costFields(toolName, toolInput))` (see
 * pre.tokens.guard) so the hash uses the SAME key the escape-hatch flag is
 * keyed on — a retry that only changes `-i`/`head_limit` still gets a fresh
 * key, exactly like that flag. Never throws.
 */
function gateKeyHash(toolName, cwd, costFieldsJson) {
  try {
    return crypto.createHash('md5').update(`${toolName}:${cwd}:${costFieldsJson}`).digest('hex').slice(0, 8);
  } catch {
    return '';
  }
}

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
 * @param {object} [opts]
 * @param {{file:string,source:string}|null} [opts.resolved] a graph already
 *   resolved by the caller (e.g. `resolveGraphJson(cwd)`) — pass this to skip
 *   re-resolving here. Without it, this function resolves the graph itself.
 *   The PreToolUse gate resolves the graph exactly ONCE per invocation and
 *   threads it through every caller that would otherwise re-resolve it.
 * @returns {{newerCount:number, truncated:boolean, graphMtime:number}}
 */
function stalenessInfo(cwd, opts = {}) {
  // Resolved graph (local → repo root → primary checkout) vs. THIS tree's
  // sources: a worktree measured against the primary graph counts its own
  // branch edits as "newer", which is exactly the lag that graph has.
  let graphMtime;
  try {
    const r = Object.prototype.hasOwnProperty.call(opts, 'resolved') ? opts.resolved : resolveGraphJson(cwd);
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
  questionFromPattern,
  suggestQuery,
  pathKindFor,
  isSemanticPattern,
  isSpecificTerm,
  isEligibleSearch,
  resolveGraphRoot,
  isInsideGraphScope,
  hasGraphAnswer,
  trimToTraversalHeader,
  gateKeyHash,
  SKIP_DIRS,
  scanSources,
  stalenessInfo,
  graphIsStale,
};
