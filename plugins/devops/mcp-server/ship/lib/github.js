/**
 * @module ship/lib/github
 * @description Wrappers around the gh CLI for PR, merge, tag, and release operations.
 */

import { execFileSync } from "node:child_process";

const DEFAULT_TIMEOUT = 30_000;

// ANSI escape pattern built at runtime to avoid literal control chars in source.
const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*[A-Za-z]", "g");

function gh(args, opts = {}) {
  const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts;
  return execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Delete a branch on origin after its PR merged (#442). Used where
 * `gh pr merge --delete-branch` is deliberately skipped — inside a worktree gh
 * would try to check out base locally — so the remote head never went away and
 * repos without `delete_branch_on_merge` accumulated stale `claude/*` heads
 * (34 on one consumer). The DELETE is safe for the worktree: it keeps working
 * on its local branch, and the next push re-creates the remote head.
 *
 * Tries the REST ref delete first (no local checkout involved), then
 * `git push origin --delete`. Never throws — the merge already landed and a
 * failed delete is a warning, not a failure (#398 post-merge contract).
 *
 * @returns {{ ok: boolean, method?: "gh-api"|"git-push", error?: string }}
 */
export function deleteRemoteBranch(branch, opts = {}) {
  const errors = [];
  try {
    gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/git/refs/heads/${branch}`], opts);
    return { ok: true, method: "gh-api" };
  } catch (e) {
    errors.push(`gh api: ${sanitizeError(e) || "failed"}`);
  }
  try {
    const { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT } = opts;
    execFileSync("git", ["push", "origin", "--delete", branch], { cwd, encoding: "utf8", timeout, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, method: "git-push" };
  } catch (e) {
    errors.push(`git push --delete: ${sanitizeError(e) || "failed"}`);
  }
  return { ok: false, error: errors.join("; ") };
}

/**
 * Create a PR and return { number, url }.
 * Body is passed via stdin to avoid shell escaping issues.
 */
export function createPR({ title, body, base = "main", head }, opts) {
  const cwd = opts?.cwd || process.cwd();
  // gh pr create does not support --json; parse URL from stdout instead
  const url = execFileSync(
    "gh",
    ["pr", "create", "--title", title, "--body-file", "-", "--base", base, "--head", head],
    {
      cwd,
      encoding: "utf8",
      input: body,
      timeout: DEFAULT_TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
  const match = url.match(/\/pull\/(\d+)/);
  const number = match ? parseInt(match[1], 10) : null;
  return { number, url };
}

/**
 * Block the current thread for `ms` milliseconds WITHOUT spawning a process.
 *
 * The previous backoff sleep was `execSync('node -e "setTimeout(…)"')` — a
 * shell-spawned (cmd.exe on Windows) child with its own 15 s cap. On a loaded
 * Windows box that spawn itself tripped `spawnSync cmd.exe ETIMEDOUT` *after*
 * `gh pr merge` had already landed, and the throw made the whole ship read as
 * failed with no merge state (#398). Atomics.wait cannot time out, cannot fail
 * to spawn, and costs nothing.
 */
export function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read a PR's state via gh; returns the state string or throws. */
function readPRState(prNumber, opts) {
  return gh(["pr", "view", String(prNumber), "--json", "state", "-q", ".state"], opts);
}

/** Sanitize a gh error for inclusion in a message: no ANSI, capped length. */
function sanitizeError(e) {
  const raw = e?.stderr?.toString() || e?.message || "";
  // Strip ANSI escape sequences; cap to 500 chars to avoid leaking long auth-bearing output
  return raw.replace(ANSI_PATTERN, "").slice(0, 500).trim();
}

/**
 * Poll the PR state up to `attempts` times with exponential backoff + jitter
 * (1s, 3s typical) to ride out transient network errors and GitHub eventual
 * consistency. Returns `{ state, lastError }` — `state` is the last state that
 * could be read (null when every read threw).
 */
function pollPRState(prNumber, opts, { attempts = 3, sleep = sleepSync } = {}) {
  let state = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      state = readPRState(prNumber, opts);
      if (state === "MERGED") break;
    } catch (e) {
      lastError = sanitizeError(e);
    }
    if (attempt < attempts) {
      const baseMs = 1000 * Math.pow(3, attempt - 1);
      sleep(Math.round(baseMs * (0.9 + Math.random() * 0.2)));
    }
  }
  return { state, lastError };
}

/**
 * Merge a PR by number, delete remote branch.
 *
 * Contract (#398): the merge is the ONE irreversible step of a ship, so this
 * function separates "did the merge land" from "could every follow-up read
 * succeed". It THROWS only while the merge is provably not done — the merge
 * command failed AND the PR is not in MERGED state, or the PR is verifiably in
 * a non-MERGED state afterwards. Once the merge has landed (merge command
 * exited 0, or the state reads MERGED), every later hiccup — an unreadable
 * state, a slow `git fetch`, a `rev-parse` timeout — is REPORTED on the return
 * value instead of thrown, so the caller can never mistake a merged PR for a
 * failed ship and never skips the ring tag because a read was slow.
 *
 * @param {number} prNumber
 * @param {string} base - Base branch name (e.g. "main", "develop")
 * @param {object} [opts]
 * @param {object} [flags]
 * @param {boolean} [flags.skipDeleteBranch=false] - Skip --delete-branch (e.g. in worktrees where local branch switch fails)
 * @param {"squash"|"merge"|"rebase"} [flags.strategy="squash"] - Merge strategy. Use "merge" for overlapping files to preserve ancestry.
 * @param {(ms:number)=>void} [flags.sleep] - Injectable backoff sleep (tests).
 * @returns {{ sha: string|null, verified: boolean, warning?: string }}
 *   `sha` — short sha of origin/<base> after the merge, or null when the
 *   post-merge fetch/rev-parse failed (the merge still landed);
 *   `verified` — whether `gh pr view` confirmed state MERGED;
 *   `warning` — human-readable reason for a null sha / unverified state.
 */
export function mergePR(prNumber, base = "main", opts, flags = {}) {
  const strategy = flags.strategy || "squash";
  const sleep = typeof flags.sleep === "function" ? flags.sleep : sleepSync;
  const args = ["pr", "merge", String(prNumber), `--${strategy}`, "--admin"];
  if (!flags.skipDeleteBranch) args.push("--delete-branch");

  let mergeCmdError = null;
  try {
    gh(args, opts);
  } catch (e) {
    // A client-side timeout can fire AFTER GitHub performed the merge. Do not
    // conclude "not merged" from the throw alone — the state poll below decides.
    mergeCmdError = sanitizeError(e) || "gh pr merge failed";
  }

  const { state, lastError } = pollPRState(prNumber, opts, { sleep });
  const warnings = [];

  if (state !== "MERGED") {
    if (mergeCmdError !== null) {
      // Merge command failed and the PR is not (readably) merged → not merged.
      const detail = lastError ? ` (last state error: ${lastError})` : state ? ` (state: "${state}")` : "";
      throw new Error(`PR #${prNumber} merge failed: ${mergeCmdError}${detail}`);
    }
    if (state !== null) {
      // The command exited 0 but the PR verifiably is NOT merged (e.g. CLOSED).
      const detail = lastError ? ` (last error: ${lastError})` : "";
      throw new Error(`PR #${prNumber} merge verification failed after 3 attempts — state is "${state}", expected "MERGED"${detail}`);
    }
    // Command exited 0, every state read threw → GitHub accepted the merge; we
    // just could not confirm it. Report, do not throw — throwing here is exactly
    // the merged-but-reads-as-failed case of #398.
    warnings.push(`merge command succeeded but PR state could not be verified after 3 attempts${lastError ? ` (last error: ${lastError})` : ""}`);
  }
  const verified = state === "MERGED";
  if (verified && mergeCmdError !== null) {
    warnings.push(`gh pr merge reported an error (${mergeCmdError}) but the PR is in MERGED state — merge landed`);
  }

  // Fetch updated base branch and read the merge commit. Both are reads after
  // the irreversible step: a failure here is reported, never thrown.
  const cwd = opts?.cwd || process.cwd();
  let sha = null;
  let readError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync("git", ["fetch", "origin", base], { cwd, encoding: "utf8", timeout: DEFAULT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"] });
      sha = execFileSync("git", ["rev-parse", "--short", `origin/${base}`], { cwd, encoding: "utf8", timeout: DEFAULT_TIMEOUT, stdio: ["pipe", "pipe", "pipe"] }).trim();
      break;
    } catch (e) {
      readError = sanitizeError(e) || e?.message || "unknown error";
      if (attempt < 3) sleep(1000 * attempt);
    }
  }
  if (sha === null) {
    warnings.push(`merged, but origin/${base} could not be fetched/resolved after 3 attempts (${readError}) — mergeSha unknown`);
  }

  const result = { sha, verified };
  if (warnings.length > 0) result.warning = warnings.join("; ");
  return result;
}

/**
 * Check if an open PR already exists for head → base.
 * Returns { number, url, mergeable } if found, null otherwise.
 * Includes mergeability state to detect stale PRs that need updating.
 */
export function findExistingPR({ base, head }, opts) {
  try {
    const raw = gh(
      ["pr", "list", "--head", head, "--base", base, "--state", "open", "--json", "number,url,mergeable", "--limit", "1"],
      opts,
    );
    const list = JSON.parse(raw);
    if (list.length === 0) return null;
    const pr = list[0];
    // mergeable: "MERGEABLE", "CONFLICTING", "UNKNOWN"
    return { number: pr.number, url: pr.url, mergeable: pr.mergeable || "UNKNOWN" };
  } catch {
    return null; // Network error or no PR — safe to proceed
  }
}

/**
 * Watch a PR's CI checks until they complete, fail, or timeout.
 *
 * Returns:
 *   { status: "passed",      checks: [...] }                       — all green
 *   { status: "no-checks",   checks: [] }                          — no CI configured on this PR
 *   { status: "failed",      checks, failed, pending, error }      — at least one check failed
 *   { status: "timeout",     checks, failed, pending, error }      — did not complete within timeoutSec, OR
 *                                                                    watch exited unexpectedly while checks were still pending
 *   { status: "probe-error", error }                                — initial probe failed (auth/network) and the
 *                                                                    state could not be determined; treated as block-worthy
 *                                                                    by the caller so the gate is fail-closed.
 *
 * Never throws — callers branch on `status`.
 */
export function watchPRChecks(prNumber, opts, { timeoutSec = 600, intervalSec = 10 } = {}) {
  // Initial probe — distinguishes "no checks at all" from "checks present".
  // gh exits non-zero with "no checks reported" when nothing is wired up.
  let initial;
  try {
    initial = gh(
      ["pr", "checks", String(prNumber), "--json", "bucket,state,name,workflow,link"],
      opts,
    );
  } catch (e) {
    const stderr = (e.stderr?.toString() || e.message || "").replace(ANSI_PATTERN, "");
    if (/no checks/i.test(stderr) || /no required checks/i.test(stderr)) {
      return { status: "no-checks", checks: [] };
    }
    // gh exits 8 = checks pending — that's expected, fall through to watch
    if (e.status !== 8) {
      // Real failure (auth, network, PR not found) — fail-closed: do NOT silently
      // treat as "no checks", or the gate becomes a no-op when auth breaks.
      return { status: "probe-error", error: `gh pr checks probe failed: ${stderr.slice(0, 300)}` };
    }
    initial = e.stdout?.toString() || "[]";
  }

  let initialChecks;
  try {
    initialChecks = JSON.parse(initial);
  } catch {
    initialChecks = [];
  }
  if (!initialChecks || initialChecks.length === 0) {
    return { status: "no-checks", checks: [] };
  }

  // Block on gh's own --watch loop. Wrap with our own timeout to bound it hard.
  let watchErr = null;
  try {
    execFileSync(
      "gh",
      ["pr", "checks", String(prNumber), "--watch", "--fail-fast", "--interval", String(intervalSec)],
      {
        cwd: opts?.cwd || process.cwd(),
        encoding: "utf8",
        timeout: timeoutSec * 1000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch (e) {
    watchErr = e;
  }

  // Snapshot final state regardless of watch outcome.
  let finalChecks = [];
  try {
    const raw = gh(
      ["pr", "checks", String(prNumber), "--json", "bucket,state,name,workflow,link"],
      opts,
    );
    finalChecks = JSON.parse(raw);
  } catch (e) {
    // gh exit 8 = pending; still try to read stdout
    if (e.stdout) {
      try { finalChecks = JSON.parse(e.stdout.toString()); } catch { /* keep [] */ }
    }
  }

  const failed = finalChecks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
  const pending = finalChecks.filter((c) => c.bucket === "pending");

  if (watchErr) {
    const isTimeout = watchErr.code === "ETIMEDOUT" || watchErr.signal === "SIGTERM";
    if (isTimeout) {
      return {
        status: "timeout",
        checks: finalChecks,
        failed,
        pending,
        error: `PR checks did not complete within ${timeoutSec}s (${pending.length} still pending)`,
      };
    }
    // gh exits non-zero when at least one check failed
    if (failed.length > 0) {
      return {
        status: "failed",
        checks: finalChecks,
        failed,
        pending,
        error: `${failed.length} check(s) failed: ${failed.map((c) => c.name || c.workflow).join(", ")}`,
      };
    }
    // No failures recorded — but if checks are still pending, watch died early.
    // Treating that as "passed" would let the merge race ahead of pending CI;
    // surface it as timeout so the caller blocks (fail-closed).
    const stderr = (watchErr.stderr?.toString() || watchErr.message || "").replace(ANSI_PATTERN, "");
    if (pending.length > 0) {
      return {
        status: "timeout",
        checks: finalChecks,
        failed,
        pending,
        error: `gh pr checks --watch exited early with ${pending.length} check(s) still pending: ${stderr.slice(0, 200)}`,
      };
    }
    // No failures, no pending — everything had already finished cleanly before
    // the noise. Treat as passed, but record the warning for the result.
    return { status: "passed", checks: finalChecks, watchWarning: stderr.slice(0, 300) };
  }

  // Watch exited cleanly — all checks passed
  return { status: "passed", checks: finalChecks };
}

/**
 * Create a GitHub release for a tag.
 * Notes are passed via stdin to avoid shell escaping issues.
 */
export function createRelease({ tag, title, notes, prerelease = false }, opts) {
  const cwd = opts?.cwd || process.cwd();
  const args = ["release", "create", tag, "--title", title, "--notes-file", "-"];
  if (prerelease) args.push("--prerelease");
  execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    input: notes,
    timeout: DEFAULT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Whether a GitHub release exists for a tag. Used by ship_promote to stay
 * idempotent against release.yml (which creates the stable release when the
 * bare tag push triggers it — promote only creates one as a fallback).
 */
export function releaseExists(tag, opts) {
  const cwd = opts?.cwd || process.cwd();
  try {
    execFileSync("gh", ["release", "view", tag], {
      cwd,
      encoding: "utf8",
      timeout: DEFAULT_TIMEOUT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}
