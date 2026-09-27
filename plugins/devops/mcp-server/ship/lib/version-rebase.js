/**
 * @module ship/lib/version-rebase
 * @description Rebase a release branch whose only collisions with its base are
 *   the version bump and the new CHANGELOG entry — then bump again on top.
 *
 *   Two ships that start from the same main both bump 0.222.0 → 0.223.0 and
 *   both add a `## [0.223.0]` entry. The second one used to get
 *   `rebaseRequired` and a manual round: reset, rebase, resolve the version
 *   files and CHANGELOG by hand, bump again (5 consumer releases and one
 *   dotclaude backlog run in two days, benchmark 2026-09-27).
 *
 *   The resolution is deterministic and refuses everything else:
 *     - a conflict hunk whose sides differ only in version numbers
 *       (x.y.z replaced) → the base's side;
 *     - a CHANGELOG hunk where both sides only ADD entries (`## [` headers)
 *       at the same place → our entries on top of the base's;
 *     - any other hunk, a conflict in any other file, or a JSON file that no
 *       longer parses → the rebase is aborted and the branch restored.
 *   After the rebase the version is bumped again from the base's version by
 *   the same kind (patch / minor / major) this branch used, and our
 *   CHANGELOG header follows. The rebased tree contains the base's new
 *   commits, so the caller must build and test it again before merging.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitArgs, gitTry, dirtyState } from "./git.js";
import { readVersion, bumpVersion, updateVersionFiles, verifyVersionFiles } from "./version.js";

/** Files a version bump and its CHANGELOG entry touch. */
export const VERSION_FILE_RE = /(^|\/)(CHANGELOG\.md|README\.md|package\.json|package-lock\.json|plugin\.json|marketplace\.json)$/;

const SEMVER_RE = /\d+\.\d+\.\d+/g;

/** True when every file both sides changed is a version file (none counts too). */
export function versionOnlyOverlap(overlap) {
  return Array.isArray(overlap) && overlap.every((f) => VERSION_FILE_RE.test(f));
}

/** patch / minor / major / none between two x.y.z versions. */
export function bumpKind(from, to) {
  if (!from || !to || from === to) return "none";
  const [a, b] = [from, to].map((v) => v.split(".").map(Number));
  if (b[0] !== a[0]) return "major";
  if (b[1] !== a[1]) return "minor";
  return "patch";
}

const normVersions = (s) => s.replace(SEMVER_RE, "X");
const isEntryBlock = (s) => /^\s*## \[/.test(s);

/**
 * Resolve the conflict hunks of one file's content, or return null when a
 * hunk is not a pure version / CHANGELOG-entry collision.
 * During a rebase the first side (`<<<<<<<`) is the base being rebased onto,
 * the last side (`>>>>>>>`) is our commit.
 */
export function resolveVersionConflicts(content, file) {
  // Keep the file's own line endings (core.autocrlf checks out CRLF on Windows).
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const out = [];
  const isChangelog = /(^|\/)CHANGELOG\.md$/.test(file);
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("<<<<<<<")) { out.push(lines[i]); i++; continue; }
    const up = []; const base = []; const ours = [];
    let part = up;
    i++;
    for (; i < lines.length && !lines[i].startsWith(">>>>>>>"); i++) {
      if (lines[i].startsWith("|||||||")) { part = base; continue; }
      if (lines[i].startsWith("=======")) { part = ours; continue; }
      part.push(lines[i]);
    }
    if (i >= lines.length) return null; // unterminated hunk
    i++; // skip >>>>>>>
    const upText = up.join(eol);
    const oursText = ours.join(eol);
    if (normVersions(upText) === normVersions(oursText)) {
      out.push(...up);
    } else if (isChangelog && base.join("").trim() === "" && isEntryBlock(upText) && isEntryBlock(oursText)) {
      const trimmed = [...ours];
      while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") trimmed.pop();
      out.push(...trimmed, "", ...up);
    } else {
      return null;
    }
  }
  const resolved = out.join(eol);
  if (/\.json$/.test(file)) {
    try { JSON.parse(resolved); } catch { return null; }
  }
  return resolved;
}

function unmergedFiles(opts) {
  const raw = gitTry(["diff", "--name-only", "--diff-filter=U"], opts) || "";
  return raw.split("\n").filter(Boolean);
}

function versionAt(ref, file, opts) {
  const raw = gitTry(["show", `${ref}:./${file}`], opts);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return (obj.metadata && obj.metadata.version) || obj.version || null;
  } catch { return null; }
}

/**
 * Rebase HEAD onto `upstream` (e.g. "origin/main") when only version files
 * collide, then bump again. Leaves the branch untouched on any refusal.
 *
 * @returns {{ ok: true, from, to, bump, resolved: string[], commit: string }
 *         | { ok: false, reason: string, files?: string[] }}
 */
export function rebaseVersionFiles({ upstream, cwd }) {
  const opts = { cwd };
  const state = dirtyState(opts);
  if (state.error || state.dirty) return { ok: false, reason: "dirty-tree" };

  const orig = gitArgs(["rev-parse", "HEAD"], opts);
  const mergeBase = gitTry(["merge-base", "HEAD", upstream], opts);
  const { version: ourVersion, file: sourceFile } = readVersion(cwd);
  if (!mergeBase || !sourceFile) return { ok: false, reason: "no-version-file" };
  const kind = bumpKind(versionAt(mergeBase, sourceFile, opts), ourVersion);
  const upstreamVersion = versionAt(upstream, sourceFile, opts);
  if (!upstreamVersion) return { ok: false, reason: "no-upstream-version" };

  const restore = () => {
    gitTry(["rebase", "--abort"], opts);
    gitTry(["reset", "--hard", orig], opts);
  };

  const root = gitArgs(["rev-parse", "--show-toplevel"], opts);
  const run = (args) => {
    try {
      gitArgs(["-c", "merge.conflictstyle=diff3", "-c", "core.editor=true", ...args], { cwd, timeout: 60_000 });
      return true;
    } catch { return false; }
  };

  const resolved = new Set();
  let done = run(["rebase", upstream]);
  for (let round = 0; !done && round < 200; round++) {
    const files = unmergedFiles(opts);
    if (files.length === 0) {
      // A commit that became empty (its change is already upstream).
      done = run(["rebase", "--skip"]);
      if (!done && unmergedFiles(opts).length === 0 && !gitTry(["rev-parse", "--verify", "--quiet", "REBASE_HEAD"], opts)) done = true;
      continue;
    }
    const foreign = files.filter((f) => !VERSION_FILE_RE.test(f));
    if (foreign.length) { restore(); return { ok: false, reason: "code-conflict", files: foreign }; }
    for (const f of files) {
      const abs = join(root, f); // diff paths are repo-root relative
      const next = resolveVersionConflicts(readFileSync(abs, "utf8"), f);
      if (next === null) { restore(); return { ok: false, reason: "non-version-hunk", files: [f] }; }
      writeFileSync(abs, next);
      gitArgs(["add", "--", `:/${f}`], opts);
      resolved.add(f);
    }
    done = run(["rebase", "--continue"]);
  }
  if (!done) { restore(); return { ok: false, reason: "rebase-failed" }; }

  // Bump again, from the base's version, by the kind this branch used.
  const to = bumpVersion(upstreamVersion, kind);
  if (kind !== "none") {
    updateVersionFiles(readVersion(cwd).version, to, cwd);
    const changelog = join(root, "CHANGELOG.md");
    try {
      const text = readFileSync(changelog, "utf8");
      const header = `## [${ourVersion}]`;
      if (ourVersion !== to && text.includes(header)) writeFileSync(changelog, text.replace(header, `## [${to}]`));
    } catch { /* no CHANGELOG — the version files carry the bump */ }
    const check = verifyVersionFiles(to, cwd);
    if (!check.consistent) { restore(); return { ok: false, reason: "version-mismatch", files: check.mismatches.map((m) => m.file) }; }
    if (dirtyState(opts).dirty) {
      gitArgs(["add", "-u", ":/"], opts);
      gitArgs(["commit", "-m", `chore: bump to v${to} after rebasing onto ${upstream}`], opts);
    }
  }
  if (gitTry(["rev-list", "--count", `HEAD..${upstream}`], opts) !== "0") {
    restore();
    return { ok: false, reason: "not-rebased" };
  }
  return { ok: true, from: ourVersion, to, bump: kind, resolved: [...resolved], commit: gitArgs(["rev-parse", "--short", "HEAD"], opts) };
}
