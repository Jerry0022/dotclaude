import { describe, test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";

// WIP watch: detection (incl. the squash-merge cases), suggestion rules,
// fingerprint dedupe, notify-only-on-findings, disabled no-op. Temp repos with
// a bare origin, injected notify / fetchMerged / scheduler spawns — never the
// real machine.

const require = createRequire(import.meta.url);
const wip = require("./wip-watch.js");
const cfg = require("../hooks/lib/devops-config.js");

const tmps = [];
afterAll(() => { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* best effort */ } } });

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_TERMINAL_PROMPT: "0" };
function g(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
function commit(dir, rel, text, msg) { write(dir, rel, text); g(dir, "add", "-A"); g(dir, "commit", "-q", "-m", msg || `edit ${rel}`); }
const fwd = (p) => p.replace(/\\/g, "/");

const LINES = (x) => ["one", "two", "three", "four", "five"].map((l, i) => (i === 2 ? x : l)).join("\n") + "\n";
const DAY = 86400000;

function world({ enabled = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wip-watch-"));
  tmps.push(tmp);
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "root");
  const bare = path.join(tmp, "origin.git");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  g(tmp, "init", "-q", "--bare", "-b", "main", bare);
  const repo = path.join(root, "proj");
  g(root, "clone", "-q", bare, repo);
  g(repo, "checkout", "-q", "-b", "main");
  commit(repo, "a.txt", LINES("base"), "init");
  commit(repo, "b.txt", "b\n", "b");
  g(repo, "push", "-q", "-u", "origin", "main");
  g(repo, "remote", "set-head", "origin", "main");
  if (enabled) cfg.setValue("wipWatch.enabled", true, "global", home, { home });
  cfg.setValue("wipWatch.roots", [root], "global", home, { home });
  const calls = [];
  const io = { home, notify: (m) => { calls.push(m); return true; }, fetchMerged: () => null };
  return { tmp, home, root, bare, repo, io, calls };
}

/** Branch off main with one commit; back on main. Returns the tip sha. */
function branch(w, name, rel, text) {
  g(w.repo, "checkout", "-q", "-b", name, "main");
  commit(w.repo, rel, text, `work ${name}`);
  const tip = g(w.repo, "rev-parse", "HEAD");
  g(w.repo, "checkout", "-q", "main");
  return tip;
}
function squash(w, name) {
  g(w.repo, "merge", "--squash", name);
  g(w.repo, "commit", "-q", "-m", `squash ${name}`);
  g(w.repo, "push", "-q", "origin", "main");
}
function findings(w, io = {}) {
  const rep = wip.scanAll({ ...w.io, ...io });
  return rep.repos.flatMap((r) => r.findings);
}
const find = (list, kind, ref) => list.find((f) => f.kind === kind && (f.branch === ref || f.worktree === ref || f.stash === ref));

describe("detection", () => {
  test("squash-merged branch: listed as delete, landed, not notify-worthy", () => {
    const w = world();
    branch(w, "feat", "a.txt", LINES("feat"));
    squash(w, "feat");
    const f = find(findings(w), "branch", "feat");
    expect(f.landed).toBe(true);
    expect(f.suggestion.action).toBe("delete");
    const r = wip.run(w.io);
    expect(r.notified).toBe(false);
    expect(w.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(w.home, ".claude", "wip-watch", "report.json"))).toBe(true);
  }, 60000);

  test("squash-merged, main edited the same lines later: tip is a merged PR head -> landed", () => {
    const w = world();
    const tip = branch(w, "feat", "a.txt", LINES("feat"));
    squash(w, "feat");
    commit(w.repo, "a.txt", LINES("main-later"), "later");
    g(w.repo, "push", "-q", "origin", "main");
    // without PR info the content rule alone cannot prove it
    expect(find(findings(w), "branch", "feat").landed).toBe(false);
    const f = find(findings(w, { fetchMerged: () => ({ bySha: new Set([tip]), byName: new Map() }) }), "branch", "feat");
    expect(f.landed).toBe(true);
    expect(f.suggestion.action).toBe("delete");
  }, 60000);

  test("unlanded branch is a finding and notifies once with the prompt", () => {
    const w = world();
    branch(w, "wip", "c.txt", "c\n");
    const f = find(findings(w), "branch", "wip");
    expect(f.landed).toBe(false);
    expect(f.ahead).toBe(1);
    expect(f.behind).toBe(0);
    expect(f.id).toMatch(/^[0-9a-f]{12}$/);
    wip.run(w.io);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].body).toContain("WIP-Report aufräumen");
    expect(w.calls[0].body).toContain("report.json");
  }, 60000);

  test("branch with upstream: pushed -> silent; unpushed commit -> finding", () => {
    const w = world();
    branch(w, "up", "c.txt", "c\n");
    g(w.repo, "push", "-q", "-u", "origin", "up");
    expect(find(findings(w), "branch", "up")).toBeUndefined();
    g(w.repo, "checkout", "-q", "up");
    commit(w.repo, "c.txt", "c2\n", "more");
    g(w.repo, "checkout", "-q", "main");
    expect(find(findings(w), "branch", "up").landed).toBe(false);
  }, 60000);

  test("gone upstream with unlanded content is a finding", () => {
    const w = world();
    branch(w, "gone", "c.txt", "c\n");
    g(w.repo, "push", "-q", "-u", "origin", "gone");
    g(w.repo, "push", "-q", "origin", "--delete", "gone");
    g(w.repo, "fetch", "-q", "--prune");
    expect(find(findings(w), "branch", "gone").landed).toBe(false);
  }, 60000);

  test("dirty worktree: grace for fresh, commit for aged, discard past discardAfterWeeks", () => {
    const w = world();
    const wt = path.join(w.root, "wt");
    g(w.repo, "worktree", "add", "-q", wt, "-b", "sess");
    write(wt, "new.txt", "x\n");
    const base = Date.now();
    const key = fwd(wt);
    expect(find(findings(w, { now: base }), "worktree-dirty", key)).toBeUndefined();
    let f = find(findings(w, { now: base + 3 * DAY }), "worktree-dirty", key);
    expect(f.suggestion.action).toBe("commit");
    expect(f.branch).toBe("sess");
    expect(f.ageDays).toBeGreaterThan(2.9);
    f = find(findings(w, { now: base + 100 * DAY }), "worktree-dirty", key);
    expect(f.suggestion.action).toBe("discard");
    expect(f.landed).toBe(false);
    // the linked worktree is not a second repo
    expect(wip.discoverRepos([w.root], w.home)).toHaveLength(1);
  }, 60000);

  test("dirty main checkout is found too", () => {
    const w = world();
    write(w.repo, "a.txt", "changed\n");
    const f = findings(w, { now: Date.now() + 3 * DAY }).find((x) => x.kind === "worktree-dirty");
    expect(f.suggestion.action).toBe("commit");
  }, 60000);

  test("old stash: none when young, stash-branch past 30 days, stash-drop past discardAfterWeeks", () => {
    const w = world();
    write(w.repo, "a.txt", "stashed\n");
    g(w.repo, "stash", "push", "-q", "-m", "old");
    const base = Date.now();
    expect(find(findings(w, { now: base }), "stash", "stash@{0}")).toBeUndefined();
    expect(find(findings(w, { now: base + 40 * DAY }), "stash", "stash@{0}").suggestion.action).toBe("stash-branch");
    expect(find(findings(w, { now: base + 70 * DAY }), "stash", "stash@{0}").suggestion.action).toBe("stash-drop");
  }, 60000);

  test("broken worktree (directory deleted) -> prune, notify-worthy", () => {
    const w = world();
    const wt = path.join(w.root, "gone-wt");
    g(w.repo, "worktree", "add", "-q", wt, "-b", "gw");
    fs.rmSync(wt, { recursive: true, force: true });
    const f = find(findings(w), "worktree-broken", fwd(wt));
    expect(f.suggestion.action).toBe("prune");
    expect(f.landed).toBe(false);
    wip.run(w.io);
    expect(w.calls).toHaveLength(1);
  }, 60000);
});

describe("suggestion rules", () => {
  test("ahead + clean rebase -> push-pr", () => {
    const w = world();
    branch(w, "ok", "c.txt", "c\n");
    commit(w.repo, "b.txt", "b2\n", "main moves");
    g(w.repo, "push", "-q", "origin", "main");
    const f = find(findings(w), "branch", "ok");
    expect(f.suggestion.action).toBe("push-pr");
    expect(f.behind).toBe(1);
  }, 60000);

  test("conflicts with main -> reimplement", () => {
    const w = world();
    branch(w, "clash", "a.txt", LINES("branch"));
    commit(w.repo, "a.txt", LINES("main"), "main edits");
    g(w.repo, "push", "-q", "origin", "main");
    expect(find(findings(w), "branch", "clash").suggestion.action).toBe("reimplement");
  }, 60000);

  test("far behind -> reimplement", () => {
    const w = world();
    branch(w, "old", "c.txt", "c\n");
    for (let i = 0; i < 3; i++) commit(w.repo, "b.txt", `b${i}\n`, `m${i}`);
    g(w.repo, "push", "-q", "origin", "main");
    const f = find(findings(w, { farBehind: 3 }), "branch", "old");
    expect(f.behind).toBe(3);
    expect(f.suggestion.action).toBe("reimplement");
    expect(find(findings(w), "branch", "old").suggestion.action).toBe("push-pr");
  }, 60000);

  test("uninspectable branch (no merge base) -> review, never landed", () => {
    const w = world();
    g(w.repo, "checkout", "-q", "--orphan", "island");
    commit(w.repo, "z.txt", "z\n", "island");
    g(w.repo, "checkout", "-q", "main");
    const f = find(findings(w), "branch", "island");
    expect(f.landed).toBe(false);
    expect(f.suggestion.action).toBe("review");
    wip.run(w.io);
    expect(w.calls).toHaveLength(1);
  }, 60000);

  test("merged content with no upstream -> delete", () => {
    const w = world();
    g(w.repo, "branch", "stale", "main");
    const f = find(findings(w), "branch", "stale");
    expect(f.suggestion.action).toBe("delete");
    expect(f.landed).toBe(true);
  }, 60000);
});

describe("notification dedupe", () => {
  test("same set twice -> one notify; new finding -> notify; subset -> silent; zero -> reset", () => {
    const w = world();
    branch(w, "a1", "c.txt", "c\n");
    wip.run(w.io);
    wip.run(w.io);
    expect(w.calls).toHaveLength(1);
    branch(w, "a2", "d.txt", "d\n");
    wip.run(w.io);
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1].body).toContain("2 ");
    g(w.repo, "branch", "-D", "a2");
    wip.run(w.io); // subset of the notified set
    expect(w.calls).toHaveLength(2);
    g(w.repo, "branch", "-D", "a1");
    const zero = wip.run(w.io);
    expect(zero.notified).toBe(false);
    expect(w.calls).toHaveLength(2);
    const state = JSON.parse(fs.readFileSync(path.join(w.home, ".claude", "wip-watch", "state.json"), "utf8"));
    expect(state.notifiedIds).toEqual([]);
    branch(w, "a1", "c.txt", "c\n");
    wip.run(w.io); // same id as before, but the set was reset
    expect(w.calls).toHaveLength(3);
  }, 90000);

  test("landed-only findings never notify; report still lists them", () => {
    const w = world();
    g(w.repo, "branch", "stale", "main");
    const r = wip.run(w.io);
    expect(w.calls).toHaveLength(0);
    expect(r.report.repos[0].findings[0].suggestion.action).toBe("delete");
    expect(r.report.version).toBe(1);
    expect(r.report.fingerprint).toBe(wip.fingerprintOf([]));
  }, 60000);

  test("a notification that was not shown is retried next run", () => {
    const w = world();
    branch(w, "a1", "c.txt", "c\n");
    let shown = false;
    w.io.notify = (m) => { w.calls.push(m); return shown; };
    wip.run(w.io);
    shown = true;
    wip.run(w.io);
    expect(w.calls).toHaveLength(2);
  }, 60000);

  test("disabled -> no-op: no scan, no report, no notify", () => {
    const w = world({ enabled: false });
    branch(w, "a1", "c.txt", "c\n");
    const r = wip.run(w.io);
    expect(r.ran).toBe(false);
    expect(w.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(w.home, ".claude", "wip-watch"))).toBe(false);
    expect(wip.main(["run"], w.io)).toBe(0);
  }, 60000);
});

describe("enable / disable", () => {
  test("enable writes config and registers the weekly job; disable reverses", () => {
    const w = world({ enabled: false });
    const spawns = [];
    const run = (cmd, args) => { spawns.push([cmd, args.join(" ")]); return { status: 0, stdout: "", stderr: "" }; };
    const io = { home: w.home, platform: "linux", run, out: () => {} };
    expect(wip.main(["enable", "--roots", "~/a,~/b", "--day", "wed"], io)).toBe(0);
    const v = cfg.load(w.home, { home: w.home }).values.wipWatch;
    expect(v.enabled).toBe(true);
    expect(v.day).toBe("wed");
    expect(v.roots).toEqual(["~/a", "~/b"]);
    expect(spawns.some(([c, a]) => c === "crontab" && a === "-")).toBe(true);
    expect(wip.main(["disable"], io)).toBe(0);
    expect(cfg.load(w.home, { home: w.home }).values.wipWatch.enabled).toBe(false);
  });

  test("failed registration leaves the watch disabled", () => {
    const w = world({ enabled: false });
    const run = () => ({ status: 1, stdout: "", stderr: "denied" });
    expect(wip.main(["enable"], { home: w.home, platform: "linux", run, out: () => {} })).toBe(1);
    expect(cfg.load(w.home, { home: w.home }).values.wipWatch.enabled).toBe(false);
  });

  test("status reports config and last report", () => {
    const w = world();
    const s = wip.status({ ...w.io, platform: "linux", run: () => ({ status: 1, stdout: "", stderr: "" }) });
    expect(s.enabled).toBe(true);
    expect(s.jobRegistered).toBe(false);
    expect(s.lastReport).toBeNull();
  });
});
