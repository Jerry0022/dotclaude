/**
 * @module ship/lib/github
 * @description Wrappers around the gh CLI for PR, merge, tag, and release operations.
 */

import { execSync, execFileSync } from "node:child_process";

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
 * Merge a PR by number, delete remote branch.
 * Verifies merge actually succeeded via PR state check. Returns merge commit sha.
 * @param {number} prNumber
 * @param {string} base - Base branch name (e.g. "main", "develop")
 * @param {object} [opts]
 * @param {object} [flags]
 * @param {boolean} [flags.skipDeleteBranch=false] - Skip --delete-branch (e.g. in worktrees where local branch switch fails)
 * @param {"squash"|"merge"|"rebase"} [flags.strategy="squash"] - Merge strategy. Use "merge" for overlapping files to preserve ancestry.
 */
export function mergePR(prNumber, base = "main", opts, flags = {}) {
  const strategy = flags.strategy || "squash";
  const args = ["pr", "merge", String(prNumber), `--${strategy}`, "--admin"];
  if (!flags.skipDeleteBranch) args.push("--delete-branch");
  gh(args, opts);
  // Verify the PR is actually in MERGED state with exponential backoff + jitter
  // (1s, 3s typical) to handle transient network errors or GitHub eventual consistency
  let state = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      state = gh(["pr", "view", String(prNumber), "--json", "state", "-q", ".state"], opts);
      if (state === "MERGED") break;
    } catch (e) {
      const raw = e.stderr?.toString() || e.message || "";
      // Strip ANSI escape sequences; cap to 500 chars to avoid leaking long auth-bearing output
      lastError = raw.replace(ANSI_PATTERN, "").slice(0, 500);
    }
    if (attempt < 3) {
      const baseMs = 1000 * Math.pow(3, attempt - 1);
      const jitterMs = Math.round(baseMs * (0.9 + Math.random() * 0.2));
      execSync(`node -e "setTimeout(()=>{},${jitterMs})"`, { timeout: 15_000 });
    }
  }
  if (state !== "MERGED") {
    const detail = lastError ? ` (last error: ${lastError.trim()})` : "";
    throw new Error(`PR #${prNumber} merge verification failed after 3 attempts — state is "${state || "unknown"}", expected "MERGED"${detail}`);
  }
  // Fetch updated base branch and get the merge commit
  execSync(`git fetch origin ${base}`, {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const sha = execSync(`git rev-parse --short origin/${base}`, {
    cwd: opts?.cwd || process.cwd(),
    encoding: "utf8",
    timeout: DEFAULT_TIMEOUT,
  }).trim();
  return sha;
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
