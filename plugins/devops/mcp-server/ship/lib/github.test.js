import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execSync, execFileSync } from "node:child_process";
import { createPR, mergePR, findExistingPR, watchPRChecks } from "./github.js";

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

describe("mergePR — success path", () => {
  test("returns short sha when state goes MERGED on first attempt", () => {
    execFileSync
      .mockReturnValueOnce("")          // pr merge
      .mockReturnValueOnce("MERGED");   // pr view → state
    execSync
      .mockReturnValueOnce("")          // git fetch
      .mockReturnValueOnce("abc1234\n"); // git rev-parse
    expect(mergePR(42, "main")).toBe("abc1234");
  });

  test("includes --delete-branch by default", () => {
    execFileSync
      .mockReturnValueOnce("")
      .mockReturnValueOnce("MERGED");
    execSync.mockReturnValue("");
    mergePR(42, "main");
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "merge", "42", "--squash", "--admin", "--delete-branch"]),
      expect.any(Object),
    );
  });

  test("skips --delete-branch when skipDeleteBranch flag set", () => {
    execFileSync
      .mockReturnValueOnce("")
      .mockReturnValueOnce("MERGED");
    execSync.mockReturnValue("");
    mergePR(42, "main", undefined, { skipDeleteBranch: true });
    const mergeCall = execFileSync.mock.calls[0][1];
    expect(mergeCall).not.toContain("--delete-branch");
  });

  test("supports merge strategy override", () => {
    execFileSync
      .mockReturnValueOnce("")
      .mockReturnValueOnce("MERGED");
    execSync.mockReturnValue("");
    mergePR(42, "main", undefined, { strategy: "merge" });
    expect(execFileSync.mock.calls[0][1]).toContain("--merge");
  });
});

describe("mergePR — failure path with stderr sanitization", () => {
  test("throws after 3 failed verification attempts with sanitized stderr", () => {
    execFileSync
      .mockReturnValueOnce("")  // pr merge ok
      .mockImplementation(() => { const err = new Error("net"); err.stderr = Buffer.from("connection refused"); throw err; });
    execSync.mockReturnValue(""); // backoff sleep

    let captured;
    try { mergePR(42, "main"); } catch (e) { captured = e; }
    expect(captured).toBeDefined();
    expect(captured.message).toMatch(/merge verification failed/);
    expect(captured.message).toMatch(/connection refused/);
  });

  test("strips ANSI escape sequences from error stderr", () => {
    const ansiStderr = Buffer.from(String.fromCharCode(27) + "[31merror message" + String.fromCharCode(27) + "[0m more");
    execFileSync
      .mockReturnValueOnce("")
      .mockImplementation(() => { const err = new Error("e"); err.stderr = ansiStderr; throw err; });
    execSync.mockReturnValue("");

    let captured;
    try { mergePR(42, "main"); } catch (e) { captured = e.message; }
    expect(captured).toBeDefined();
    expect(captured).not.toContain(String.fromCharCode(27));
    expect(captured).toContain("error message");
  });

  test("caps stderr output to 500 chars", () => {
    const longStderr = Buffer.from("x".repeat(2000));
    execFileSync
      .mockReturnValueOnce("")
      .mockImplementation(() => { const err = new Error("e"); err.stderr = longStderr; throw err; });
    execSync.mockReturnValue("");

    let captured;
    try { mergePR(42, "main"); } catch (e) { captured = e.message; }
    const lastErrorMatch = captured.match(/last error: (x+)/);
    expect(lastErrorMatch).toBeTruthy();
    expect(lastErrorMatch[1].length).toBeLessThanOrEqual(500);
  });

  test("throws on non-MERGED state without exception (e.g. CLOSED)", () => {
    execFileSync
      .mockReturnValueOnce("")            // pr merge
      .mockReturnValue("CLOSED");          // state lookup always returns CLOSED
    execSync.mockReturnValue("");
    expect(() => mergePR(42, "main")).toThrow(/CLOSED/);
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

  test("treats watch exit-1 without failures as passed (transient noise)", () => {
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
});
