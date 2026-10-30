import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const gate = require("./cleanup-gate.js");
const { gitFor } = require("../pre-tool-use/pre.cleanup.gate.js");

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function armedFor(...scopeLines) {
  const state = { armedAt: Date.now(), dryRun: [], unmerged: [] };
  const q = {
    header: "Dry-Run",
    question: `Folgende Aktionen werden ausgeführt:\n${scopeLines.join("\n")}\nFortfahren?`,
    options: [{ label: "Ja, ausführen" }, { label: "Abbrechen" }],
    multiSelect: false,
  };
  gate.recordAnswers(state, [q], { [q.question]: "Ja, ausführen" });
  return state;
}

describe("hasLanded — sub-agent branches of a squash-merged integration branch (#825)", () => {
  let dir, g, headOf;
  const commit = (files, msg) => {
    for (const [f, c] of Object.entries(files)) {
      if (c === null) git(dir, "rm", "-q", f); else fs.writeFileSync(path.join(dir, f), c);
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
  };
  const lands = (name, heads) => gate.hasLanded(g, { kind: "branch", target: name }, { cwd: dir, mergedHeads: heads });
  const heads = (...names) => () => new Set(names.map(n => git(dir, "rev-parse", n)));

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-gate-chain-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "commit.gpgsign", "false");
    commit({ "a.txt": "0\n" }, "c0");
    git(dir, "checkout", "-q", "-b", "agent/ok", "main");
    commit({ "ok.txt": "ok\n" }, "ok");
    git(dir, "checkout", "-q", "-b", "agent/dropped", "main");
    commit({ "dropped.txt": "d\n" }, "dropped");
    git(dir, "checkout", "-q", "-b", "agent/after", "main");
    commit({ "after.txt": "a\n" }, "after");
    git(dir, "checkout", "-q", "-b", "int", "main");
    for (const b of ["agent/ok", "agent/dropped", "agent/after"]) git(dir, "merge", "-q", "--no-ff", "-m", `merge ${b}`, b);
    commit({ "dropped.txt": null }, "int drops agent work");
    git(dir, "checkout", "-q", "main");
    commit({ "ok.txt": "ok\n", "after.txt": "a\n", "int.txt": "i\n" }, "squash of int");
    // main later deletes a file an agent added: the content check alone would fail for it
    commit({ "ok.txt": null }, "main removes ok.txt");
    // an agent keeps working after the PR merged
    git(dir, "checkout", "-q", "agent/after");
    commit({ "more.txt": "m\n" }, "post-merge commit");
    git(dir, "checkout", "-q", "main");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    g = gitFor(dir);
    headOf = heads("int");
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  test("tip inside a merged PR head with its changes intact (file later deleted in main) → landed", () => {
    expect(lands("agent/ok", headOf)).toBe(true);
  });

  test("a merged PR that dropped the branch's changes → not landed", () => {
    expect(lands("agent/dropped", headOf)).toBe(false);
  });

  test("commits after the merge → not landed", () => {
    expect(lands("agent/after", headOf)).toBe(false);
  });

  test("fails closed: no merged-PR data, gh failing, no cwd", () => {
    expect(lands("agent/ok", () => null)).toBe(false);
    expect(lands("agent/ok", () => new Set())).toBe(false);
    expect(lands("agent/ok", () => { throw new Error("gh down"); })).toBe(false);
    expect(gate.hasLanded(g, { kind: "branch", target: "agent/ok" }, { mergedHeads: headOf })).toBe(false);
    expect(gate.hasLanded(g, { kind: "branch", target: "agent/ok" })).toBe(false);
  });

  test("decide: chain-landed branch needs no Unmerged yes; a dropped one still does", () => {
    const state = armedFor("- agent/ok", "- agent/dropped");
    const run = (cmd) => gate.decide({ command: cmd, cwd: dir, state, gitFor, mergedHeads: headOf });
    expect(run("git branch -D agent/ok")).toBeNull();
    expect(run("git branch -D agent/dropped").block).toMatch(/header "Unmerged"/);
  });

  test("decide: one merged-PR lookup per command, and a spent budget counts as not landed", () => {
    const state = armedFor("- agent/ok", "- agent/dropped");
    let calls = 0;
    const counting = (...a) => { calls++; return headOf(...a); };
    gate.decide({ command: "git branch -D agent/ok agent/dropped", cwd: dir, state, gitFor, mergedHeads: counting });
    expect(calls).toBe(1);
    expect(lands("agent/ok", headOf)).toBe(true);
    expect(gate.hasLanded(g, { kind: "branch", target: "agent/ok" }, { cwd: dir, mergedHeads: headOf, deadline: Date.now() - 1 })).toBe(false);
  });
});

describe("hasLanded — agent change superseded inside a squash-merged head (#983)", () => {
  let dir, g;
  const commit = (files, msg) => {
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-gate-superseded-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "commit.gpgsign", "false");
    commit({ "a.txt": "0\n" }, "c0");
    git(dir, "checkout", "-q", "-b", "agent/edited", "main");
    commit({ "a.txt": "agent\n" }, "agent edit");
    git(dir, "checkout", "-q", "-b", "feat", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "merge agent", "agent/edited");
    commit({ "a.txt": "feature\n" }, "feature edits the same file later");
    git(dir, "checkout", "-q", "main");
    commit({ "a.txt": "feature\n" }, "squash of feat");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    g = gitFor(dir);
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  test("tip inside a merged head whose tree equals main → landed, although the file changed again", () => {
    const heads = () => new Set([git(dir, "rev-parse", "feat")]);
    expect(gate.hasLanded(g, { kind: "branch", target: "agent/edited" }, { cwd: dir, mergedHeads: heads })).toBe(true);
  });
});
