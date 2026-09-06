import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseArgs,
  validate,
  splitPaths,
  readState,
  writeBaseline,
  parseCommits,
  parseChangedPaths,
  intersect,
  check,
  capture,
} from "./concept-drift.js";

// The contract this file pins, in one sentence: a reality check may refuse to
// answer, but it may never block an implement order. Every unresolvable
// condition has to come back `verdict: "skip", safe: true` — because the caller
// (SKILL.md § 5b step 0) treats exactly that as "proceed to implement".
//
// The second contract is the deadlock guard's other half: a completed check
// always reports `advanceTo`, so the baseline moves past drift the user has
// already decided on and the same drift can never force a second round.

let root;
let statePath;

const LIVE = {
  port: 8883,
  html_path: "docs/concepts/2026-09-06-x.html",
  slug: "x",
  server_pid: 4242,
  cron_id: "ab12cd34",
  started_at: "2026-09-06T10:00:00.000Z",
};

function writeState(obj) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, typeof obj === "string" ? obj : JSON.stringify(obj));
}

/** A fake git: `matchers` maps a substring of the joined argv to a return value. */
function fakeGit(matchers) {
  return (args) => {
    const key = args.join(" ");
    for (const [needle, value] of Object.entries(matchers)) {
      if (key.includes(needle)) return typeof value === "function" ? value(args) : value;
    }
    return null;
  };
}

const OK_DEPS = {
  cwd: "/repo",
  isRepo: () => true,
  hasOrigin: () => true,
  detectDefaultBranch: () => "main",
  commitExists: () => true,
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "concept-drift-"));
  statePath = path.join(root, ".claude", "concept-active.json");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("args", () => {
  test("state must be absolute — a relative path resolves against the caller's cwd", () => {
    expect(validate(parseArgs(["--state", ".claude/concept-active.json"]))).toMatch(/ABSOLUTE/);
    expect(validate(parseArgs(["--state", path.join(root, "s.json")]))).toBeNull();
  });

  test("--capture is a flag, not a value", () => {
    const opts = parseArgs(["--capture", "--state", path.join(root, "s.json")]);
    expect(opts.capture).toBe(true);
    expect(opts.state).toBe(path.join(root, "s.json"));
  });

  test("a bogus sha is rejected rather than written into the state file", () => {
    expect(validate(parseArgs(["--state", path.join(root, "s.json"), "--sha", "not-a-sha"]))).toMatch(/hex/);
  });

  test("prototype keys cannot be smuggled in as options", () => {
    const opts = parseArgs(["--state", path.join(root, "s.json"), "--toString", "5"]);
    expect(typeof opts.toString).toBe("function");
  });

  test("paths are normalised to forward slashes", () => {
    expect(splitPaths("plugins\\devops\\x.js, ./a/b")).toEqual(["plugins/devops/x.js", "a/b"]);
  });
});

describe("path intersection", () => {
  test("exact hit, and a directory reference catches files inside it", () => {
    const changed = [{ path: "plugins/devops/hooks/a.js", status: "M" }];
    expect(intersect(changed, ["plugins/devops/hooks/a.js"])).toHaveLength(1);
    expect(intersect(changed, ["plugins/devops/hooks"])).toHaveLength(1);
    expect(intersect(changed, ["plugins/devops/hooks/"])).toHaveLength(1);
  });

  test("a changed directory matches a file referenced inside it", () => {
    expect(intersect([{ path: "plugins/devops", status: "M" }], ["plugins/devops/hooks/a.js"])).toHaveLength(1);
  });

  test("substring lookalikes do not match", () => {
    const changed = [{ path: "other/hooks/a.js.bak", status: "M" }];
    expect(intersect(changed, ["hooks/a.js"])).toEqual([]);
  });
});

describe("diff parsing", () => {
  test("a rename contributes BOTH paths — the old one is the drift that matters", () => {
    const parsed = parseChangedPaths("R096\told/name.js\tnew/name.js", 50);
    expect(parsed.map((p) => p.path)).toEqual(["old/name.js", "new/name.js"]);
    expect(parsed[0].status).toBe("R");
  });

  test("commit lines split on the first space only", () => {
    const parsed = parseCommits("abc123def456 fix(x): subject with spaces", 10);
    expect(parsed).toEqual([{ sha: "abc123def456", subject: "fix(x): subject with spaces" }]);
  });
});

describe("check — every unresolvable condition fails SAFE", () => {
  const cases = [
    ["no-state", () => {}, {}],
    ["no-repo", () => writeState(LIVE), { isRepo: () => false }],
    ["no-remote", () => writeState(LIVE), { hasOrigin: () => false }],
    ["no-default-branch", () => writeState(LIVE), { detectDefaultBranch: () => null }],
    ["no-baseline", () => writeState(LIVE), {}],
  ];

  for (const [reason, setup, extraDeps] of cases) {
    test(`${reason} → skip, safe`, () => {
      setup();
      const res = check({ state: statePath, paths: [], timeout: 5 }, { ...OK_DEPS, ...extraDeps, git: fakeGit({}) });
      expect(res).toMatchObject({ verdict: "skip", safe: true, reason });
    });
  }

  test("an offline fetch is not 'no drift' — it is a skip", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaa" });
    const res = check({ state: statePath, paths: [], timeout: 5 }, { ...OK_DEPS, git: fakeGit({}) });
    expect(res).toMatchObject({ verdict: "skip", safe: true, reason: "fetch-failed" });
  });

  test("a force-pushed-away baseline re-anchors instead of blocking", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaa" });
    const res = check(
      { state: statePath, paths: [], timeout: 5 },
      { ...OK_DEPS, commitExists: () => false, git: fakeGit({ fetch: "", "rev-parse": "bbbbbbbbbbbb" }) },
    );
    expect(res).toMatchObject({ verdict: "skip", safe: true, reason: "baseline-gone" });
    expect(res.advanceTo).toBe("bbbbbbbbbbbb");
  });
});

describe("check — verdicts", () => {
  test("remote tip unchanged → clear, no visible round", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaaaaaaa" });
    const res = check(
      { state: statePath, paths: ["plugins/x.js"], timeout: 5 },
      { ...OK_DEPS, git: fakeGit({ fetch: "", "rev-parse": "aaaaaaaaaaaa" }) },
    );
    expect(res).toMatchObject({ verdict: "clear", reason: "unchanged" });
  });

  test("main moved but nowhere near the concept → clear", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaaaaaaa" });
    const res = check(
      { state: statePath, paths: ["plugins/devops/skills/concept"], timeout: 5, maxCommits: 50, maxPaths: 200 },
      {
        ...OK_DEPS,
        git: fakeGit({
          fetch: "",
          "rev-parse": "bbbbbbbbbbbb",
          log: "bbbbbbbbbbbb chore: bump deps",
          diff: "M\tpackage-lock.json",
        }),
      },
    );
    expect(res).toMatchObject({ verdict: "clear", reason: "no-overlap" });
    expect(res.advanceTo).toBe("bbbbbbbbbbbb");
  });

  test("main touched a referenced path → candidates, with the evidence attached", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaaaaaaa" });
    const res = check(
      { state: statePath, paths: ["plugins/devops/hooks/pre.x.js"], timeout: 5, maxCommits: 50, maxPaths: 200 },
      {
        ...OK_DEPS,
        git: fakeGit({
          fetch: "",
          "rev-parse": "bbbbbbbbbbbb",
          log: "bbbbbbbbbbbb feat(hooks): rename pre.x",
          diff: "R100\tplugins/devops/hooks/pre.x.js\tplugins/devops/hooks/pre.y.js",
        }),
      },
    );
    expect(res.verdict).toBe("candidates");
    expect(res.overlap.map((o) => o.path)).toContain("plugins/devops/hooks/pre.x.js");
    // Evidence is mandatory: a drift card without a SHA + path may not be shown.
    expect(res.commits[0]).toMatchObject({ sha: "bbbbbbbbbbbb" });
    expect(res.advanceTo).toBe("bbbbbbbbbbbb");
  });

  test("without a path filter it hands over everything rather than claiming 'clear'", () => {
    writeState({ ...LIVE, baseline_ref: "main", baseline_sha: "aaaaaaaaaaaa" });
    const res = check(
      { state: statePath, paths: [], timeout: 5, maxCommits: 50, maxPaths: 200 },
      {
        ...OK_DEPS,
        git: fakeGit({ fetch: "", "rev-parse": "bbbbbbbbbbbb", log: "bbbbbbbbbbbb x", diff: "M\tanything.js" }),
      },
    );
    expect(res).toMatchObject({ verdict: "candidates", reason: "no-path-filter" });
  });
});

describe("capture — baseline bookkeeping", () => {
  test("adds the baseline keys and leaves the bridge's own fields untouched", () => {
    writeState(LIVE);
    const res = capture(
      { state: statePath, sha: "", timeout: 5 },
      { ...OK_DEPS, git: fakeGit({ fetch: "", "rev-parse": "cccccccccccc" }) },
    );
    expect(res).toMatchObject({ captured: true, branch: "main" });
    const after = readState(statePath);
    expect(after.baseline_ref).toBe("main");
    expect(after.baseline_sha).toBe("cccccccccccc");
    expect(after.baseline_captured_at).toMatch(/^\d{4}-/);
    expect(after.port).toBe(LIVE.port);
    expect(after.html_path).toBe(LIVE.html_path);
    expect(after.cron_id).toBe(LIVE.cron_id);
  });

  test("--sha pins the exact commit a check examined, without re-fetching", () => {
    writeState(LIVE);
    const res = capture(
      { state: statePath, sha: "dddddddddddd", timeout: 5 },
      { ...OK_DEPS, git: fakeGit({ "rev-parse": "eeeeeeeeeeee" }) },
    );
    expect(res.captured).toBe(true);
    expect(readState(statePath).baseline_sha).toBe("dddddddddddd");
  });

  test("a repo with no remote reports it instead of throwing", () => {
    writeState(LIVE);
    expect(capture({ state: statePath, sha: "", timeout: 5 }, { ...OK_DEPS, hasOrigin: () => false })).toMatchObject({
      captured: false,
      reason: "no-remote",
    });
  });

  test("writeBaseline refuses to invent a state file that is not there", () => {
    expect(writeBaseline(path.join(root, "missing.json"), { baseline_sha: "x" })).toBe(false);
  });
});
