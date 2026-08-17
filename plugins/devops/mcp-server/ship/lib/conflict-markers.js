/**
 * @module ship/lib/conflict-markers
 * @description Detect unresolved git conflict markers in the files a ship is
 * about to land.
 *
 * Nothing else in the pipeline reads file *content*: preflight counts commits,
 * compares trees and verifies version files, and `ship_release` diffs refs — so
 * a conflict resolution that leaves a marker behind passes every gate. v0.130.0
 * landed a lone `||||||| parent of <sha> (chore(release): v0.130.0)` line in
 * CHANGELOG.md on main that way, and it sat there for five releases.
 *
 * Preflight *enforces* `merge.conflictstyle=diff3`, which is exactly what puts
 * the fourth and least-familiar marker on the branch: a resolver who deletes
 * `<<<<<<<`, `=======` and `>>>>>>>` from muscle memory misses `|||||||` one
 * line up, and the file still looks plausible.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git, dirtyState } from "./git.js";

/** Skip anything larger — a marker inside a multi-megabyte blob is not this guard's case. */
const MAX_BYTES = 4 * 1024 * 1024;
/** The report is a pointer to the damage, not an inventory of it. */
const MAX_REPORTED_FILES = 20;
const MAX_REPORTED_HITS = 5;
/** Ceiling for the advisory whole-repo sweep, so a monorepo cannot stall a ship. */
const MAX_REPO_FILES = 5000;

/**
 * Classify a single line. A git conflict marker is EXACTLY seven of its
 * character at the start of a line — the anchoring is what keeps this cheap
 * enough to run on every ship without a false-positive budget:
 *
 *   `<<<<<<<` / `>>>>>>>` — no legitimate use at line start in any text format.
 *   `|||||||`             — diff3 base marker. Required to carry a label, because
 *                           a bare `|||||||` is also a markdown table row of six
 *                           empty cells. git always writes the label (the ref,
 *                           or `parent of <sha> (<subject>)` during a rebase).
 *   `=======`             — handled separately: see findMarkersInText.
 */
function markerAt(line) {
  if (/^<{7}(?: |$)/.test(line)) return "<<<<<<<";
  if (/^>{7}(?: |$)/.test(line)) return ">>>>>>>";
  if (/^\|{7} \S/.test(line)) return "|||||||";
  return null;
}

/** A bare seven-character separator — ambiguous on its own (see below). */
const SEPARATOR = /^={7}$/;

/**
 * Find conflict markers in text. Returns `[{ line, marker }]`, 1-indexed.
 *
 * `=======` is deliberately NOT unambiguous: a seven-character setext H1
 * underline in markdown is byte-identical to it, and this repo's CHANGELOG and
 * docs are markdown. It therefore only counts when the file also carries one of
 * the three markers that have no other reading. The cost of that rule is a lone
 * leftover `=======` going unreported; the alternative is blocking every ship
 * on a legal heading, which would get the whole guard switched off.
 */
export function findMarkersInText(text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  const separators = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = markerAt(lines[i]);
    if (marker) hits.push({ line: i + 1, marker });
    else if (SEPARATOR.test(lines[i])) separators.push({ line: i + 1, marker: "=======" });
  }
  if (hits.length === 0) return [];
  return [...hits, ...separators].sort((a, b) => a.line - b.line);
}

/** NUL in the first 8 KiB — the same heuristic git itself uses to call a blob binary. */
function isBinary(buf) {
  const end = Math.min(buf.length, 8192);
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * The files this ship would land: everything the branch changed since it forked
 * off `base`, plus whatever is still uncommitted (the version bump about to be
 * staged into the release commit).
 *
 * Scoped to the ship's own diff rather than the whole repo on purpose. A
 * pre-existing marker in an unrelated corner is not this ship's to fix, and
 * making it block every release until someone does would turn a guard into an
 * obstacle. Cost is O(files touched), not O(repo).
 *
 * Returns `{ root, files, scope }`; `scope` is `"diff+worktree"` when the
 * merge-base could be resolved and `"worktree"` when it could not (a detached
 * or freshly-cloned checkout), so callers can say what was actually covered.
 */
export function candidateFiles(cwd, base) {
  const opts = { cwd };
  const root = git("rev-parse --show-toplevel", opts) || cwd;
  const files = new Set();
  let scope = "worktree";

  for (const ref of [base && `origin/${base}`, base].filter(Boolean)) {
    const mergeBase = git(`merge-base HEAD ${ref}`, opts);
    if (!mergeBase) continue;
    const raw = git(`diff --name-only ${mergeBase} HEAD`, opts) || "";
    for (const f of raw.split("\n").filter(Boolean)) files.add(f);
    scope = "diff+worktree";
    break;
  }

  const state = dirtyState(opts);
  for (const f of [...state.modified, ...state.untracked]) files.add(f);

  return { root, files: [...files], scope };
}

/** Every tracked path, repo-root-relative. Empty when git cannot answer. */
function trackedFiles(cwd) {
  const raw = git("ls-files -z", { cwd });
  return raw ? raw.split("\0").filter(Boolean) : [];
}

/**
 * Read and classify one file. Returns null when it is not scannable text
 * (deleted, oversized, binary, unreadable), else `{ file, count, hits }`.
 */
function scanFile(root, rel) {
  let buf;
  try {
    if (statSync(join(root, rel)).size > MAX_BYTES) return null;
    buf = readFileSync(join(root, rel));
  } catch {
    return null; // deleted by the diff, renamed away, or unreadable — nothing to land
  }
  if (isBinary(buf)) return null;
  const hits = findMarkersInText(buf.toString("utf8"));
  return { file: rel, count: hits.length, hits: hits.slice(0, MAX_REPORTED_HITS) };
}

/**
 * Scan for unresolved conflict markers. Two scopes, deliberately weighted
 * differently:
 *
 *   `offenders`     — the files THIS ship would land. **Blocking**: a marker here
 *                     is the ship's own damage and must not reach the base branch.
 *   `repoOffenders` — every other tracked text file, only with `scanRepo: true`.
 *                     **Advisory.** A marker that predates this branch is a repo
 *                     defect, not this release's, and holding an unrelated ship
 *                     hostage to it is the wrong trade — not least because a repo
 *                     may legitimately carry conflict-marker fixtures (this
 *                     plugin's own git-sync parses them) with no way to opt out of
 *                     a hard gate. Reporting is what was missing: the v0.130.0
 *                     marker survived five releases because nothing ever looked at
 *                     a file the shipping branch had not touched.
 *
 * @returns {{clean: boolean, scanned: number, scope: string, offenders: Array, repoOffenders: Array, repoScanned: number, repoTruncated: boolean}}
 */
export function scanConflictMarkers(cwd, options = {}) {
  const { base = null, scanRepo = false } = options;
  const { root, files, scope } = candidateFiles(cwd, base);
  const offenders = [];
  let scanned = 0;

  for (const rel of files) {
    if (offenders.length >= MAX_REPORTED_FILES) break;
    const result = scanFile(root, rel);
    if (!result) continue;
    scanned++;
    if (result.count > 0) offenders.push(result);
  }

  const repoOffenders = [];
  let repoScanned = 0;
  let repoTruncated = false;
  if (scanRepo) {
    const shipped = new Set(files);
    const rest = trackedFiles(cwd).filter((f) => !shipped.has(f));
    repoTruncated = rest.length > MAX_REPO_FILES;
    for (const rel of rest.slice(0, MAX_REPO_FILES)) {
      if (repoOffenders.length >= MAX_REPORTED_FILES) break;
      const result = scanFile(root, rel);
      if (!result) continue;
      repoScanned++;
      if (result.count > 0) repoOffenders.push(result);
    }
  }

  return {
    clean: offenders.length === 0,
    scanned,
    scope,
    offenders,
    repoOffenders,
    repoScanned,
    repoTruncated,
  };
}

/** One-line, actionable summary of a failed scan. */
export function describeMarkers(offenders) {
  const list = offenders
    .map((o) => `${o.file}:${o.hits[0].line} (${o.hits[0].marker})`)
    .join(", ");
  const n = offenders.length;
  return `Unresolved conflict marker(s) in ${n} file(s): ${list}`;
}
