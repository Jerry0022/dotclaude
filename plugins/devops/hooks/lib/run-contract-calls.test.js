import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("./run-contract-calls.js");

describe("commandFacts", () => {
  test.each([
    ["git commit -m x", { commit: true }],
    ['git add -A && git commit -q -m "a && b; c"', { commit: true }],
    ["git -c core.x=y commit -m x", { commit: true }],
    ["FOO=1 git commit -m x", { commit: true }],
    ["git commit --dry-run", { commit: false }],
    ['echo "git commit -m x"', { commit: false }],
    ["git commit-tree x", { commit: false }],
  ])("%s", (cmd, want) => {
    expect(C.commandFacts(cmd)).toMatchObject(want);
  });

  test.each([
    ["git checkout -b fix/1", "fix/1"],
    ["git fetch -q origin && git checkout -q -b fix/473 origin/main", "fix/473"],
    ["git checkout -B x", "x"],
    ["git switch -c feat/y", "feat/y"],
    ["git switch -q -C feat/z", "feat/z"],
    ["git worktree add ../wt -b feat/w main", "feat/w"],
    ["git worktree add ../wt2", "wt2"],
  ])("branch: %s", (cmd, name) => {
    expect(C.commandFacts(cmd)).toMatchObject({ branch: true, branchName: name });
  });

  test.each([["git checkout main"], ["git switch main"], ["git worktree list"], ['echo "git checkout -b x"']])("no branch: %s", (cmd) => {
    expect(C.commandFacts(cmd).branch).toBe(false);
  });

  test("render-card path, quoted and bare", () => {
    expect(C.commandFacts('node "C:/p/mcp-server/index.js" --render-card "C:/t/card one.json"').renderCard).toBe("C:/t/card one.json");
    expect(C.commandFacts("node index.js --render-card /tmp/c.json").renderCard).toBe("/tmp/c.json");
    expect(C.commandFacts("node other.js --render-card x").renderCard).toBeNull();
  });
});

describe("isGatedPath", () => {
  const root = path.join(os.tmpdir(), "rc-root");
  test.each([
    ["src/a.js", true], [".claude/x", false], [".git/HEAD", false], ["docs/concepts/a.html", false],
    ["docs/x.md", true], ["BACKLOG-1.md", false], ["sub/AUTONOMOUS-x.md", false], ["BURN-a.md", false],
    [path.join(os.tmpdir(), "elsewhere.md"), false], ["", false],
  ])("%s → %s", (p, want) => {
    expect(C.isGatedPath(root, root, p)).toBe(want);
  });
});

test("closesOf", () => {
  expect(C.closesOf("Closes #473\nCloses #474\nfixes #5, Resolves: #6, see #7")).toEqual(["473", "474", "5", "6"]);
  expect(C.closesOf(undefined)).toEqual([]);
});

test("cardFacts", () => {
  expect(C.cardFacts({ variant: "ready" })).toEqual({ variant: "ready", final: true });
  expect(C.cardFacts({ variant: "ready", pending: [] }).final).toBe(true);
  expect(C.cardFacts({ variant: "ready", pending: [""] }).final).toBe(true);
  expect(C.cardFacts({ variant: "ready", pending: "x" }).final).toBe(false);
  expect(C.cardFacts({ variant: "ready", concept: { url: "u" } }).final).toBe(false);
  expect(C.cardFacts({ variant: "ship-blocked" }).final).toBe(false);
});

test("releaseResult", () => {
  expect(C.releaseResult([{ type: "text", text: '{"success":true,"merged":true}' }])).toEqual({ ok: true, merged: true });
  expect(C.releaseResult({ content: [{ type: "text", text: 'Result: {"success":false}' }] })).toEqual({ ok: false, merged: false });
  expect(C.releaseResult({ success: true })).toEqual({ ok: true, merged: false });
  expect(C.releaseResult("nope")).toBeNull();
});
