import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { GIT_TIMEOUT_MS, TOTAL_GIT_BUDGET_MS, SMALL_GIT_BUDGET_MS, gitBudget, gitRun, gitOut, gitLines } from "./git-timeout.js";

describe("GIT_TIMEOUT_MS", () => {
  test("is a single positive number, the one per-call timeout", () => {
    expect(typeof GIT_TIMEOUT_MS).toBe("number");
    expect(GIT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("R13: TOTAL_GIT_BUDGET_MS", () => {
  test("is exported, above GIT_TIMEOUT_MS — the one whole-invocation ceiling pre and the CLI now share", () => {
    expect(typeof TOTAL_GIT_BUDGET_MS).toBe("number");
    expect(TOTAL_GIT_BUDGET_MS).toBeGreaterThan(GIT_TIMEOUT_MS);
  });
});

describe("H8: SMALL_GIT_BUDGET_MS", () => {
  test("is the named 3 s budget pre.run.contract's onMainBranch fallback and post.run.contract's onMcpMerge use", () => {
    expect(typeof SMALL_GIT_BUDGET_MS).toBe("number");
    expect(SMALL_GIT_BUDGET_MS).toBe(3000);
    expect(SMALL_GIT_BUDGET_MS).toBeLessThan(TOTAL_GIT_BUDGET_MS);
  });
});

describe("gitBudget", () => {
  test("timeout() starts at min(totalMs, GIT_TIMEOUT_MS)", () => {
    const b = gitBudget(2000);
    expect(b.timeout()).toBeLessThanOrEqual(2000);
    expect(b.timeout()).toBeGreaterThan(0);
  });

  test("a totalMs above GIT_TIMEOUT_MS is clamped to GIT_TIMEOUT_MS", () => {
    const b = gitBudget(GIT_TIMEOUT_MS * 10);
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
  });

  test("defaults to GIT_TIMEOUT_MS when called with no argument", () => {
    const b = gitBudget();
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
    expect(b.timeout()).toBeGreaterThan(0);
  });

  test("timeout() never drops to 0 or below, even once the deadline has passed", () => {
    const b = gitBudget(0);
    expect(b.expired()).toBe(true);
    expect(b.timeout()).toBeGreaterThanOrEqual(1);
  });

  test("a negative totalMs is treated as an already-expired, zero-length budget", () => {
    const b = gitBudget(-500);
    expect(b.expired()).toBe(true);
    expect(b.timeout()).toBeGreaterThanOrEqual(1);
  });

  test("expired() is false while time remains, true once the deadline passes", async () => {
    const b = gitBudget(30);
    expect(b.expired()).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(b.expired()).toBe(true);
  });

  test("timeout() shrinks as the budget is consumed, bounding a CHAIN of calls (AUD-031)", async () => {
    const b = gitBudget(200);
    const first = b.timeout();
    await new Promise((r) => setTimeout(r, 60));
    const second = b.timeout();
    expect(second).toBeLessThan(first);
    expect(second).toBeGreaterThan(0);
  });

  test("two independent budgets do not share state", () => {
    const a = gitBudget(50);
    const b = gitBudget(GIT_TIMEOUT_MS * 5);
    expect(a.timeout()).toBeLessThanOrEqual(50);
    expect(b.timeout()).toBeLessThanOrEqual(GIT_TIMEOUT_MS);
  });
});

// The git helpers moved here from run-contract-calls.js (harden scan
// 2026-09-26); run-contract-calls re-exports them.
describe("gitRun / gitOut / gitLines", () => {
  let dir;
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-timeout-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  test("gitRun returns raw stdout and throws on a failing command", () => {
    expect(gitRun(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main\n");
    expect(() => gitRun(dir, ["rev-parse", "--verify", "--quiet", "refs/heads/nope"])).toThrow();
  });

  test("gitOut trims, and reads a failure or an empty output as null", () => {
    expect(gitOut(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(gitOut(dir, ["rev-parse", "--verify", "--quiet", "refs/heads/nope"])).toBeNull();
    expect(gitOut(dir, ["diff", "--name-only", "HEAD"])).toBeNull();
  });

  test("gitLines returns non-empty trimmed lines and throws on a failure", () => {
    fs.writeFileSync(path.join(dir, "b.txt"), "1\n");
    fs.writeFileSync(path.join(dir, "c.txt"), "1\n");
    expect(gitLines(dir, ["ls-files", "--others", "--exclude-standard"]).sort()).toEqual(["b.txt", "c.txt"]);
    expect(() => gitLines(dir, ["diff", "--name-only", "no-such-ref...HEAD"])).toThrow();
  });

  test("gitOut and gitLines take each call's timeout from a shared budget", () => {
    let asked = 0;
    const budget = { timeout: () => { asked++; return GIT_TIMEOUT_MS; } };
    expect(gitOut(dir, ["rev-parse", "HEAD"], { budget })).toMatch(/^[0-9a-f]{40}$/);
    expect(gitLines(dir, ["rev-parse", "HEAD"], { budget })).toHaveLength(1);
    expect(asked).toBe(2);
  });

  test("an explicit gitLines timeout wins over the budget", () => {
    let asked = 0;
    const budget = { timeout: () => { asked++; return 1; } };
    expect(gitLines(dir, ["rev-parse", "HEAD"], { timeout: GIT_TIMEOUT_MS, budget })).toHaveLength(1);
    expect(asked).toBe(0);
  });

  test("run-contract-calls re-exports the very same functions (tests spy on C.gitOut)", () => {
    const req = createRequire(import.meta.url);
    const G = req("./git-timeout.js");
    const C = req("./run-contract-calls.js");
    expect(C.gitOut).toBe(G.gitOut);
    expect(C.gitLines).toBe(G.gitLines);
  });
});

// pre.main.guard, pre.edit.branch and prompt.ship.detect spawned git with no
// timeout at all until they moved onto gitOut — a hung git then held the
// hook until the harness killed it. Every other git spawn under hooks/ names
// one; this keeps it that way.
describe("every git subprocess a hook spawns carries a timeout", () => {
  const HOOKS = fileURLToPath(new URL("..", import.meta.url));
  const GIT_CALL_RE = /\b(?:execFileSync|execSync|spawnSync)\(\s*(?:'git'|"git"|`git[\s`]|'git |"git )/g;

  function sources(d, out = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") sources(p, out); }
      else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) out.push(p);
    }
    return out;
  }

  /** The call's text from its name to the matching close paren. */
  function callText(src, start) {
    let depth = 0;
    for (let i = src.indexOf("(", start); i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
  }

  test("no execFileSync / execSync / spawnSync of git without a timeout option", () => {
    const found = [];
    const missing = [];
    for (const file of sources(HOOKS)) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(GIT_CALL_RE)) {
        const where = `${path.relative(HOOKS, file)}:${src.slice(0, m.index).split("\n").length}`;
        found.push(where);
        if (!/\btimeout\b/.test(callText(src, m.index))) missing.push(where);
      }
    }
    expect(found.length).toBeGreaterThan(5); // the scan itself still finds the known call sites
    expect(missing).toEqual([]);
  });
});
