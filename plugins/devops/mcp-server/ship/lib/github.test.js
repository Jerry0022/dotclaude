import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execSync, execFileSync } from "node:child_process";
import { createPR, mergePR, findExistingPR, watchPRChecks, deleteRemoteBranch } from "./github.js";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createPR", () => {
  test("parses PR number from gh stdout URL", () => {
    execFileSync.mockReturnValue("https://github.com/o/r/pull/42\n");
    const result = createPR({ title: "T", body: "B", base: "main", head: "feat/x" });
    expect(result).toEqual({ number: 42, url: "https://github.com/o/r/pull/42" });
  });

  test("returns null number when URL has no /pull/N", () => {
    execFileSync.mockReturnValue("unexpected\n");
    const result = createPR({ title: "T", body: "B", base: "main", head: "feat/x" });
    expect(result.number).toBeNull();
  });

  test("passes body to gh via stdin", () => {
    execFileSync.mockReturnValue("https://github.com/o/r/pull/1");
    createPR({ title: "T", body: "BODY-VIA-STDIN", base: "main", head: "feat/x" });
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "create", "--body-file", "-"]),
      expect.objectContaining({ input: "BODY-VIA-STDIN" }),
    );
  });
});

// mergePR now runs every child process through execFileSync (no shell, no
// cmd.exe — #398). The call order on the happy path is:
//   1 gh pr merge · 2 gh pr view (state) · 3 git fetch · 4 git rev-parse
// `sleep` is injected as a no-op so the backoff never waits on real timers.
const noSleep = { sleep: () => {} };

/** Route execFileSync by binary + first args so tests read like the call order. */
function routeExec(routes) {
  execFileSync.mockImplementation((bin, args) => {
    const key = `${bin} ${args.slice(0, 2).join(" ")}`;
    const r = routes[key];
    if (r === undefined) throw new Error(`unexpected exec: ${key}`);
    return typeof r === "function" ? r() : r;
  });
}

describe("mergePR — success path", () => {
  test("returns { sha, verified:true } when state goes MERGED on first attempt", () => {
    routeExec({
      "gh pr merge": "",
      "gh pr view": "MERGED",
      "git fetch origin": "",
      "git rev-parse --short": "abc1234\n",
    });
    expect(mergePR(42, "main", undefined, noSleep)).toEqual({ sha: "abc1234", verified: true });
  });

  test("includes --delete-branch by default", () => {
    routeExec({ "gh pr merge": "", "gh pr view": "MERGED", "git fetch origin": "", "git rev-parse --short": "abc\n" });
    mergePR(42, "main", undefined, noSleep);
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "merge", "42", "--squash", "--admin", "--delete-branch"]),
      expect.any(Object),
    );
  });

  test("skips --delete-branch when skipDeleteBranch flag set", () => {
    routeExec({ "gh pr merge": "", "gh pr view": "MERGED", "git fetch origin": "", "git rev-parse --short": "abc\n" });
    mergePR(42, "main", undefined, { skipDeleteBranch: true, ...noSleep });
    const mergeCall = execFileSync.mock.calls[0][1];
    expect(mergeCall).not.toContain("--delete-branch");
  });

  test("supports merge strategy override", () => {
    routeExec({ "gh pr merge": "", "gh pr view": "MERGED", "git fetch origin": "", "git rev-parse --short": "abc\n" });
    mergePR(42, "main", undefined, { strategy: "merge", ...noSleep });
    expect(execFileSync.mock.calls[0][1]).toContain("--merge");
  });

  test("never spawns a shell — no execSync in the merge path (#398)", () => {
    routeExec({ "gh pr merge": "", "gh pr view": "MERGED", "git fetch origin": "", "git rev-parse --short": "abc\n" });
    mergePR(42, "main", undefined, noSleep);
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe("mergePR — merged, but a follow-up read failed (#398)", () => {
  // The ETIMEDOUT class: the merge landed, then a later child process timed
  // out. The old code threw here and the ship read as failed with no merge
  // state; the contract now is "report, never throw, once the merge landed".
  test("post-merge fetch timing out returns sha:null + warning instead of throwing", () => {
    routeExec({
      "gh pr merge": "",
      "gh pr view": "MERGED",
      "git fetch origin": () => { const e = new Error("spawnSync git ETIMEDOUT"); e.code = "ETIMEDOUT"; throw e; },
    });
    const r = mergePR(42, "main", undefined, noSleep);
    expect(r.sha).toBeNull();
    expect(r.verified).toBe(true);
    expect(r.warning).toMatch(/merged, but origin\/main could not be fetched/);
    expect(r.warning).toMatch(/ETIMEDOUT/);
    // fetch is retried before giving up
    const fetches = execFileSync.mock.calls.filter((c) => c[0] === "git" && c[1][0] === "fetch");
    expect(fetches.length).toBe(3);
  });

  test("merge command exit 0 + every state read throwing → verified:false with sanitized warning, no throw", () => {
    routeExec({
      "gh pr merge": "",
      "gh pr view": () => { const err = new Error("net"); err.stderr = Buffer.from(String.fromCharCode(27) + "[31mconnection refused" + String.fromCharCode(27) + "[0m"); throw err; },
      "git fetch origin": "",
      "git rev-parse --short": "abc1234\n",
    });
    const r = mergePR(42, "main", undefined, noSleep);
    expect(r).toMatchObject({ sha: "abc1234", verified: false });
    expect(r.warning).toMatch(/could not be verified after 3 attempts/);
    expect(r.warning).toContain("connection refused");
    expect(r.warning).not.toContain(String.fromCharCode(27));
  });

  test("merge command throws (client-side timeout) but the PR reads MERGED → treated as merged with warning", () => {
    routeExec({
      "gh pr merge": () => { const e = new Error("spawnSync gh ETIMEDOUT"); throw e; },
      "gh pr view": "MERGED",
      "git fetch origin": "",
      "git rev-parse --short": "abc1234\n",
    });
    const r = mergePR(42, "main", undefined, noSleep);
    expect(r).toMatchObject({ sha: "abc1234", verified: true });
    expect(r.warning).toMatch(/gh pr merge reported an error .* but the PR is in MERGED state/);
  });

  test("caps a state-read error to 500 chars in the warning", () => {
    routeExec({
      "gh pr merge": "",
      "gh pr view": () => { const err = new Error("e"); err.stderr = Buffer.from("x".repeat(2000)); throw err; },
      "git fetch origin": "",
      "git rev-parse --short": "abc\n",
    });
    const r = mergePR(42, "main", undefined, noSleep);
    const m = r.warning.match(/last error: (x+)/);
    expect(m).toBeTruthy();
    expect(m[1].length).toBeLessThanOrEqual(500);
  });
});

describe("mergePR — genuinely not merged still throws", () => {
  test("throws on non-MERGED state without exception (e.g. CLOSED)", () => {
    routeExec({ "gh pr merge": "", "gh pr view": "CLOSED" });
    expect(() => mergePR(42, "main", undefined, noSleep)).toThrow(/CLOSED/);
  });

  test("merge command fails AND state is not MERGED → throws with both errors", () => {
    routeExec({
      "gh pr merge": () => { const e = new Error("merge failed"); e.stderr = Buffer.from("not mergeable"); throw e; },
      "gh pr view": "OPEN",
    });
    expect(() => mergePR(42, "main", undefined, noSleep)).toThrow(/merge failed: not mergeable.*state: "OPEN"/);
  });

  test("merge command fails AND state unreadable → throws (nothing proves a merge)", () => {
    routeExec({
      "gh pr merge": () => { throw new Error("boom"); },
      "gh pr view": () => { throw new Error("net"); },
    });
    expect(() => mergePR(42, "main", undefined, noSleep)).toThrow(/merge failed: boom/);
  });
});

describe("findExistingPR", () => {
  test("returns null when no PR matches", () => {
    execFileSync.mockReturnValue("[]");
    expect(findExistingPR({ base: "main", head: "feat/x" })).toBeNull();
  });

  test("returns first PR with mergeable state when found", () => {
    execFileSync.mockReturnValue(JSON.stringify([
      { number: 7, url: "u", mergeable: "MERGEABLE" },
    ]));
    expect(findExistingPR({ base: "main", head: "feat/x" })).toEqual({
      number: 7, url: "u", mergeable: "MERGEABLE",
    });
  });

  test("defaults mergeable to UNKNOWN when missing", () => {
    execFileSync.mockReturnValue(JSON.stringify([{ number: 7, url: "u" }]));
    expect(findExistingPR({ base: "main", head: "feat/x" }).mergeable).toBe("UNKNOWN");
  });

  test("swallows network errors and returns null", () => {
    execFileSync.mockImplementation(() => { throw new Error("net"); });
    expect(findExistingPR({ base: "main", head: "feat/x" })).toBeNull();
  });
});

describe("watchPRChecks", () => {
  test("returns no-checks when gh reports no checks configured", () => {
    execFileSync.mockImplementation(() => {
      const err = new Error("no checks");
      err.stderr = Buffer.from("no checks reported on the 'feat/x' branch");
      throw err;
    });
    const result = watchPRChecks(42);
    expect(result.status).toBe("no-checks");
    expect(result.checks).toEqual([]);
  });

  test("returns no-checks when initial probe returns empty array", () => {
    execFileSync.mockReturnValueOnce("[]");
    const result = watchPRChecks(42);
    expect(result.status).toBe("no-checks");
  });

  test("returns passed when watch exits cleanly and all checks are pass", () => {
    const checks = JSON.stringify([
      { bucket: "pass", state: "SUCCESS", name: "build", workflow: "CI" },
      { bucket: "pass", state: "SUCCESS", name: "test", workflow: "CI" },
    ]);
    execFileSync
      .mockReturnValueOnce(checks)  // initial probe
      .mockReturnValueOnce("")       // watch blocks then exits 0
      .mockReturnValueOnce(checks);  // final snapshot
    const result = watchPRChecks(42);
    expect(result.status).toBe("passed");
    expect(result.checks).toHaveLength(2);
  });

  test("returns failed with details when watch exits non-zero and a check failed", () => {
    const initial = JSON.stringify([
      { bucket: "pending", state: "IN_PROGRESS", name: "build", workflow: "CI" },
    ]);
    const finalChecks = JSON.stringify([
      { bucket: "fail", state: "FAILURE", name: "build", workflow: "CI", link: "https://x/run/1" },
    ]);
    execFileSync
      .mockReturnValueOnce(initial)
      .mockImplementationOnce(() => { const e = new Error("watch failed"); e.status = 1; throw e; })
      .mockReturnValueOnce(finalChecks);
    const result = watchPRChecks(42);
    expect(result.status).toBe("failed");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("build");
    expect(result.error).toMatch(/1 check\(s\) failed/);
  });

  test("returns timeout when watch is killed by ETIMEDOUT", () => {
    const initial = JSON.stringify([
      { bucket: "pending", state: "QUEUED", name: "build", workflow: "CI" },
    ]);
    execFileSync
      .mockReturnValueOnce(initial)
      .mockImplementationOnce(() => { const e = new Error("timeout"); e.code = "ETIMEDOUT"; throw e; })
      .mockReturnValueOnce(initial);
    const result = watchPRChecks(42, undefined, { timeoutSec: 60 });
    expect(result.status).toBe("timeout");
    expect(result.pending).toHaveLength(1);
    expect(result.error).toMatch(/60s/);
  });

  test("treats watch exit-1 without failures as passed (transient noise) ONLY when nothing pending", () => {
    const initial = JSON.stringify([
      { bucket: "pass", state: "SUCCESS", name: "build", workflow: "CI" },
    ]);
    execFileSync
      .mockReturnValueOnce(initial)
      .mockImplementationOnce(() => { const e = new Error("flaky"); e.status = 1; e.stderr = Buffer.from("network blip"); throw e; })
      .mockReturnValueOnce(initial);
    const result = watchPRChecks(42);
    expect(result.status).toBe("passed");
    expect(result.watchWarning).toMatch(/network blip/);
  });

  test("returns timeout when watch dies early with checks still pending (fail-closed)", () => {
    const initial = JSON.stringify([
      { bucket: "pending", state: "IN_PROGRESS", name: "build", workflow: "CI" },
      { bucket: "pending", state: "QUEUED", name: "test", workflow: "CI" },
    ]);
    execFileSync
      .mockReturnValueOnce(initial)
      .mockImplementationOnce(() => { const e = new Error("flake"); e.status = 1; e.stderr = Buffer.from("ws closed"); throw e; })
      .mockReturnValueOnce(initial);
    const result = watchPRChecks(42);
    expect(result.status).toBe("timeout");
    expect(result.pending).toHaveLength(2);
    expect(result.error).toMatch(/exited early/);
  });

  test("returns probe-error when initial gh call fails for non-pending non-no-checks reason (fail-closed)", () => {
    execFileSync.mockImplementationOnce(() => {
      const e = new Error("auth lost");
      e.status = 4;
      e.stderr = Buffer.from("could not refresh token");
      throw e;
    });
    const result = watchPRChecks(42);
    expect(result.status).toBe("probe-error");
    expect(result.error).toMatch(/could not refresh token/);
  });
});

// #442 — the remote head of a worktree ship is deleted after the merge by a
// REST ref delete (no local checkout involved), falling back to git push.
describe("deleteRemoteBranch (#442)", () => {
  test("deletes the ref through gh api first", () => {
    routeExec({ "gh api -X": "" });
    expect(deleteRemoteBranch("claude/x")).toEqual({ ok: true, method: "gh-api" });
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      ["api", "-X", "DELETE", "repos/{owner}/{repo}/git/refs/heads/claude/x"],
      expect.any(Object),
    );
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  test("falls back to git push --delete when the api call fails", () => {
    routeExec({
      "gh api -X": () => { throw new Error("HTTP 422: Reference does not exist"); },
      "git push origin": "",
    });
    expect(deleteRemoteBranch("claude/x")).toEqual({ ok: true, method: "git-push" });
    expect(execFileSync).toHaveBeenCalledWith("git", ["push", "origin", "--delete", "claude/x"], expect.any(Object));
  });

  test("never throws — both paths failing yield ok:false with both reasons", () => {
    routeExec({
      "gh api -X": () => { throw new Error("HTTP 403"); },
      "git push origin": () => { throw new Error("remote: permission denied"); },
    });
    const r = deleteRemoteBranch("claude/x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gh api: .*HTTP 403/);
    expect(r.error).toMatch(/git push --delete: .*permission denied/);
  });
});
