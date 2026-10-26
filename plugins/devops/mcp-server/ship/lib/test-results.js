/**
 * @module ship/lib/test-results
 * @description Green full-suite results keyed by the tree they ran on (#762).
 *
 * An agent that already ran the full suite green on a tree should not make
 * ship_build run it again on the same tree — on a loaded machine that second
 * run costs up to an hour. Each green run is recorded as
 * `{ treeHash, testCmd, passed, at, source, durationMs }`; ship_build reuses a
 * record when the tree hash and the normalized test command match and the
 * record is younger than REUSE_TTL_MS. Any difference runs the suite as before.
 *
 * Tree key (treeKey): the git tree object the working tree WOULD commit to —
 *   - clean working tree (`git status --porcelain` empty) → `HEAD^{tree}`;
 *   - otherwise a throwaway COPY of the index (GIT_INDEX_FILE in the OS temp
 *     dir), `git add -A` on that copy, then `git write-tree`. Staged, unstaged
 *     and untracked-but-not-ignored files all count; the real index is never
 *     touched. Git-ignored files (node_modules, runtime state) are not part of
 *     the key — a dependency change without a lockfile change is not detected.
 *   Either way the same content gives the same hash, so a green run on a dirty
 *   tree is reused once that exact content is committed.
 *
 * Store: `<git common dir>/devops-test-results.json` — shared by all worktrees
 * of the repo, never inside a worktree (Desktop copies untracked .claude/ into
 * new worktrees). Override: env DEVOPS_TEST_RESULTS_FILE or the `file` option.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** A green record older than this is not reused. */
export const REUSE_TTL_MS = 24 * 60 * 60 * 1000;
/** Records are pruned after this age / beyond this count. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_RECORDS = 50;
/** Last N green durations per command — the "usual" run time for the load signal. */
const KEEP_DURATIONS = 5;
export const STORE_NAME = "devops-test-results.json";

function git(cwd, args, env) {
  return execFileSync("git", args, { windowsHide: true,
    cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env,
  });
}

/** `npm test`, `npm t` and `npm run test` are the same command; whitespace is collapsed. */
export function normalizeCmd(cmd) {
  const s = String(cmd || "").trim().replace(/\s+/g, " ");
  return s.replace(/^npm (?:t|test)(?=$| )/, "npm run test");
}

/**
 * The tree key for `cwd` — `{ treeHash, method: "head" | "worktree" }`, or null
 * outside a git repo / on any git failure (callers then simply run the suite).
 */
export function treeKey(cwd) {
  let tmp = null;
  try {
    // --no-optional-locks: never take the real index.lock for a stat refresh.
    const status = git(cwd, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=all"]);
    if (status.trim() === "") {
      return { treeHash: git(cwd, ["rev-parse", "HEAD^{tree}"]).trim(), method: "head" };
    }
    const indexPath = resolve(cwd, git(cwd, ["rev-parse", "--git-path", "index"]).trim());
    tmp = join(tmpdir(), `devops-tree-key-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.idx`);
    if (existsSync(indexPath)) copyFileSync(indexPath, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    git(cwd, ["add", "-A"], env);
    const treeHash = git(cwd, ["write-tree"], env).trim();
    return /^[0-9a-f]{40,64}$/.test(treeHash) ? { treeHash, method: "worktree" } : null;
  } catch {
    return null;
  } finally {
    if (tmp) { try { unlinkSync(tmp); } catch { /* never created */ } }
  }
}

/** The store file for `cwd`, or null outside a git repo. */
export function storePath(cwd, { file } = {}) {
  if (file) return file;
  if (process.env.DEVOPS_TEST_RESULTS_FILE) return process.env.DEVOPS_TEST_RESULTS_FILE;
  try {
    return join(resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]).trim()), STORE_NAME);
  } catch {
    return null;
  }
}

function load(path) {
  let data = null;
  try { data = JSON.parse(readFileSync(path, "utf8")); } catch { /* absent or garbled */ }
  if (!data || !Array.isArray(data.records)) data = { version: 1, records: [], durations: {} };
  if (!data.durations || typeof data.durations !== "object") data.durations = {};
  return data;
}

function save(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    return false;
  }
}

/**
 * Record a finished run. Only `passed: true` records are ever reused; a red run
 * drops a green record for the same key. Returns the stored record or null.
 */
export function recordResult(cwd, { treeHash, testCmd, passed, durationMs = null, source = "unknown", now = Date.now(), file } = {}) {
  const path = storePath(cwd, { file });
  if (!path || !treeHash || !testCmd) return null;
  const cmd = normalizeCmd(testCmd);
  const data = load(path);
  data.records = data.records.filter((r) =>
    r && !(r.treeHash === treeHash && r.testCmd === cmd) && now - Date.parse(r.at) < KEEP_MS);
  const rec = { treeHash, testCmd: cmd, passed: passed === true, at: new Date(now).toISOString(), source, durationMs };
  data.records.push(rec);
  if (data.records.length > KEEP_RECORDS) data.records = data.records.slice(-KEEP_RECORDS);
  if (rec.passed && Number.isFinite(durationMs) && durationMs > 0) {
    data.durations[cmd] = [...(data.durations[cmd] || []), Math.round(durationMs)].slice(-KEEP_DURATIONS);
  }
  return save(path, data) ? rec : null;
}

/** The reusable green record for this tree + command, or null. */
export function findGreen(cwd, { treeHash, testCmd, maxAgeMs = REUSE_TTL_MS, now = Date.now(), file } = {}) {
  const path = storePath(cwd, { file });
  if (!path || !treeHash || !testCmd) return null;
  const cmd = normalizeCmd(testCmd);
  const hit = load(path).records.filter((r) => r && r.passed === true && r.treeHash === treeHash && r.testCmd === cmd)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (!hit) return null;
  const age = now - Date.parse(hit.at);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs ? hit : null;
}

/** Median of the last green durations for this command, or null with no history. */
export function usualDurationMs(cwd, testCmd, { file } = {}) {
  const path = storePath(cwd, { file });
  if (!path) return null;
  const list = (load(path).durations[normalizeCmd(testCmd)] || []).filter((n) => Number.isFinite(n) && n > 0);
  if (list.length === 0) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * The project's full test command, normalized (`npm run test`), or null when
 * package.json declares no `test` script. This is the key under which a FULL
 * suite run is recorded and looked up.
 */
export function fullTestCmd(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return pkg?.scripts?.test ? "npm run test" : null;
  } catch {
    return null;
  }
}

const VITEST_RUN = /^(?:npx )?vitest run(?: |$)/;

/**
 * Map a full-suite command Claude ran by hand to the key ship_build uses:
 * `npm test` / `npm t` / `npm run test` become `npm run test`; `npx vitest run`
 * and `vitest run` (flags only, no file args) also, when the project's `test`
 * script is itself an unfiltered `vitest run`. Anything else is returned
 * normalized and unchanged.
 */
export function canonicalFullCmd(cwd, cmd) {
  const norm = normalizeCmd(String(cmd || "").replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, ""));
  if (norm === "npm run test") return norm;
  const { isFullSuiteSegment } = createRequire(import.meta.url)("../../../hooks/lib/full-suite-cmd.js");
  if (!VITEST_RUN.test(norm) || !isFullSuiteSegment(norm)) return norm;
  try {
    const script = String(JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))?.scripts?.test || "").trim();
    if (VITEST_RUN.test(script) && isFullSuiteSegment(script)) return "npm run test";
  } catch { /* no package.json */ }
  return norm;
}

/**
 * The record of a green FULL-suite run for exactly this tree, or null.
 *
 * "Full" means the project's own full test command (package.json
 * `scripts.test`, recorded as `npm run test`) — a scoped run (`vitest related`)
 * is never recorded and never matches. Reuse is EXACT: only an identical git
 * tree hash counts, and the record must be younger than `maxAgeMs` (24 h).
 * ship_build (local full run) and the post.test.record hook (manual full run)
 * write such records. The release merge gate calls this when the CI full-suite
 * check is unavailable (account limit / quota): no record means run or ask for
 * the local full suite instead of merging.
 *
 * @param {string} cwd repo (or worktree) directory
 * @param {{treeHash?: string, now?: number, maxAgeMs?: number, file?: string}} [opts]
 *   treeHash defaults to the tree key of `cwd`'s current state (HEAD^{tree}
 *   when clean). Pass HEAD's tree explicitly for the commit that gets merged.
 * @returns {{treeHash: string, testCmd: string, passed: true, at: string, source: string, durationMs: (number|null)}|null}
 */
export function findFullGreen(cwd, { treeHash, now = Date.now(), maxAgeMs = REUSE_TTL_MS, file } = {}) {
  const testCmd = fullTestCmd(cwd);
  if (!testCmd) return null;
  const hash = treeHash || treeKey(cwd)?.treeHash;
  if (!hash) return null;
  return findGreen(cwd, { treeHash: hash, testCmd, maxAgeMs, now, file });
}
