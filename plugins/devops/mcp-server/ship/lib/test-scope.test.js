import { describe, test, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedVsBase, ciSuiteWorkflowPresent, decideTestScope, isTestConfigFile, relatedCommand,
} from "./test-step.js";
import { canonicalFullCmd, findFullGreen, fullTestCmd, recordResult } from "./test-results.js";

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "test-scope-"));
  dirs.push(d);
  return d;
}

const exists = () => true;
const base = { workflowPresent: true, githubOrigin: true, quotaExhausted: false, exists };

describe("decideTestScope", () => {
  test("CI suite + quota ok + plain source diff -> related, full suite via ci", () => {
    const d = decideTestScope({ ...base, changed: { files: ["plugins/a/x.js"], deleted: [] } });
    expect(d.scope).toBe("related");
    expect(d.fullSuiteVia).toBe("ci");
    expect(d.cmd).toBe("npx vitest related plugins/a/x.js plugins/a/x.test.js --run --passWithNoTests");
  });

  test("quota exhausted -> full, local", () => {
    const d = decideTestScope({ ...base, quotaExhausted: true, changed: { files: ["a/x.js"], deleted: [] } });
    expect(d).toMatchObject({ scope: "full", fullSuiteVia: "local" });
    expect(d.reason).toMatch(/quota/i);
  });

  test.each(["package.json", "package-lock.json", "vitest.config.mjs", "vitest.isolation-setup.mjs", "sub/package.json"])(
    "config file %s in the diff -> full", (file) => {
      const d = decideTestScope({ ...base, changed: { files: ["a/x.js", file], deleted: [] } });
      expect(d).toMatchObject({ scope: "full", fullSuiteVia: "local" });
    });

  test("no CI workflow -> full, local", () => {
    expect(decideTestScope({ ...base, workflowPresent: false, changed: { files: ["a/x.js"], deleted: [] } }))
      .toMatchObject({ scope: "full", fullSuiteVia: "local" });
  });

  test("no github origin -> full, local", () => {
    expect(decideTestScope({ ...base, githubOrigin: false, changed: { files: ["a/x.js"], deleted: [] } }).scope).toBe("full");
  });

  test("explicit ciSuite=true overrides detection, ciSuite=false forces local", () => {
    const changed = { files: ["a/x.js"], deleted: [] };
    expect(decideTestScope({ ...base, workflowPresent: false, ciSuite: true, changed }).scope).toBe("related");
    expect(decideTestScope({ ...base, ciSuite: false, changed }).scope).toBe("full");
  });

  test("quota still wins over an explicit ciSuite=true", () => {
    expect(decideTestScope({ ...base, ciSuite: true, quotaExhausted: true, changed: { files: ["a/x.js"], deleted: [] } }).scope).toBe("full");
  });

  test("diff not computable, empty, or with deletions -> full", () => {
    expect(decideTestScope({ ...base, changed: null }).scope).toBe("full");
    expect(decideTestScope({ ...base, changed: { files: [], deleted: [] } }).scope).toBe("full");
    expect(decideTestScope({ ...base, changed: { files: ["a/x.js"], deleted: ["a/old.js"] } }).scope).toBe("full");
  });

  test("docs-only diff -> related with nothing to run locally", () => {
    const d = decideTestScope({ ...base, changed: { files: ["README.md", "docs/a.json"], deleted: [] } });
    expect(d).toMatchObject({ scope: "related", fullSuiteVia: "ci", empty: true });
  });

  test("a related command that would exceed the Windows limit -> full", () => {
    const files = Array.from({ length: 400 }, (_, i) => `plugins/devops/some/long/path/module-${i}.js`);
    expect(decideTestScope({ ...base, changed: { files, deleted: [] } }).scope).toBe("full");
  });
});

describe("helpers", () => {
  test("isTestConfigFile", () => {
    expect(isTestConfigFile("vitest.config.mjs")).toBe(true);
    expect(isTestConfigFile("a/b/package.json")).toBe(true);
    expect(isTestConfigFile("plugins/x/foo.js")).toBe(false);
  });

  test("relatedCommand adds sibling tests only when they exist and skips non-JS", () => {
    const have = new Set(["a/x.js", "a/x.test.js", "b/y.js", "doc.md"]);
    const r = relatedCommand(["a/x.js", "b/y.js", "doc.md"], { exists: (p) => have.has(p.replace(/\\/g, "/").replace(/^\.\//, "")) });
    expect(r.files).toEqual(["a/x.js", "b/y.js", "a/x.test.js"]);
  });

  test("ciSuiteWorkflowPresent finds a top-level job named suite", () => {
    const d = tmp();
    mkdirSync(join(d, ".github", "workflows"), { recursive: true });
    writeFileSync(join(d, ".github", "workflows", "a.yml"), "name: x\njobs:\n  build:\n    runs-on: x\n");
    expect(ciSuiteWorkflowPresent(d)).toBe(false);
    writeFileSync(join(d, ".github", "workflows", "ci-suite.yml"), "name: y\njobs:\n  shards:\n    name: s\n  suite:\n    needs: shards\n");
    expect(ciSuiteWorkflowPresent(d)).toBe(true);
    expect(ciSuiteWorkflowPresent(join(d, "nope"))).toBe(false);
  });

  test("the shipped ci-suite.yml declares the aggregate job", () => {
    expect(ciSuiteWorkflowPresent(join(__dirname, "..", "..", "..", "..", ".."))).toBe(true);
  });

  test("changedVsBase: committed, modified, untracked and deleted files against main", () => {
    const d = tmp();
    const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d, encoding: "utf8", windowsHide: true });
    git("init", "-q", "-b", "main");
    writeFileSync(join(d, "keep.js"), "1");
    writeFileSync(join(d, "gone.js"), "1");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feat");
    writeFileSync(join(d, "keep.js"), "2");
    git("commit", "-q", "-am", "edit");
    writeFileSync(join(d, "new.js"), "x");
    rmSync(join(d, "gone.js"));
    const c = changedVsBase(d);
    expect(c.files.sort()).toEqual(["keep.js", "new.js"]);
    expect(c.deleted).toEqual(["gone.js"]);
  });
});

describe("findFullGreen", () => {
  function repo(script = "vitest run") {
    const d = tmp();
    writeFileSync(join(d, "package.json"), JSON.stringify({ scripts: { test: script } }));
    return d;
  }
  const file = () => join(tmp(), "results.json");

  test("returns the green full record for the tree, null for another tree / red / expired / scoped", () => {
    const d = repo();
    const f = file();
    const now = Date.parse("2026-10-26T12:00:00Z");
    recordResult(d, { treeHash: "a".repeat(40), testCmd: "npm test", passed: true, source: "ship_build", now, file: f });
    recordResult(d, { treeHash: "b".repeat(40), testCmd: "npm test", passed: false, now, file: f });
    recordResult(d, { treeHash: "c".repeat(40), testCmd: "npx vitest related a.js --run", passed: true, now, file: f });
    recordResult(d, { treeHash: "e".repeat(40), testCmd: "npm test", passed: true, now: now - 25 * 3600_000, file: f });
    expect(findFullGreen(d, { treeHash: "a".repeat(40), now, file: f })).toMatchObject({ passed: true, source: "ship_build", testCmd: "npm run test" });
    expect(findFullGreen(d, { treeHash: "d".repeat(40), now, file: f })).toBeNull();
    expect(findFullGreen(d, { treeHash: "b".repeat(40), now, file: f })).toBeNull();
    expect(findFullGreen(d, { treeHash: "c".repeat(40), now, file: f })).toBeNull();
    expect(findFullGreen(d, { treeHash: "e".repeat(40), now, file: f })).toBeNull();
  });

  test("null without a test script", () => {
    const d = tmp();
    expect(fullTestCmd(d)).toBeNull();
    expect(findFullGreen(d, { treeHash: "a".repeat(40), file: file() })).toBeNull();
  });

  test("canonicalFullCmd maps npx vitest run to the project's npm run test", () => {
    const d = repo("vitest run");
    expect(canonicalFullCmd(d, "npm test")).toBe("npm run test");
    expect(canonicalFullCmd(d, "CI=1 npx vitest run --reporter=dot")).toBe("npm run test");
    expect(canonicalFullCmd(d, "npx vitest run a.test.js")).toBe("npx vitest run a.test.js");
    expect(canonicalFullCmd(repo("jest"), "npx vitest run")).toBe("npx vitest run");
  });
});
