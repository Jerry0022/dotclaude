import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasGraph, hasLocalGraph, resolveGraphJson, graphFlag, buildGraphNudge, graphJsonPath,
  graphIsStale, stalenessInfo, suggestQuery, questionFromPattern,
  pathKindFor, isSemanticPattern, isEligibleSearch, hasGraphAnswer,
} from "./graph-nudge.js";

describe("hasGraph — graph.json detection", () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-"));
  });
  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("false when no graph.json present", () => {
    expect(hasGraph(dir)).toBe(false);
  });

  test("false when graph.json exists but is under the size floor", () => {
    const gp = graphJsonPath(dir);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, "{}");
    expect(hasGraph(dir)).toBe(false);
  });

  test("true once graphify-out/graph.json exists and clears the size floor", () => {
    const gp = graphJsonPath(dir);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, JSON.stringify({ nodes: Array(50).fill({ id: "x" }) }));
    expect(hasGraph(dir)).toBe(true);
  });

  test("false for a non-existent directory", () => {
    expect(hasGraph(path.join(dir, "nope"))).toBe(false);
  });

  test("ignores a directory named graph.json (must be a file)", () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-dir-"));
    fs.mkdirSync(graphJsonPath(d2), { recursive: true });
    expect(hasGraph(d2)).toBe(false);
    try { fs.rmSync(d2, { recursive: true, force: true }); } catch {}
  });
});

describe("buildGraphNudge — ambient hint text", () => {
  test("names the query command, the graph path, and the refresh skill", () => {
    const t = buildGraphNudge();
    expect(t).toContain("graphify query");
    expect(t).toContain("graphify-out/graph.json");
    expect(t).toContain("/auto-graph");
  });
});

describe("graphIsStale — gate precondition", () => {
  const OLD = new Date(Date.now() - 60_000);
  const NOW = new Date();

  function freshTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "graph-stale-"));
  }
  function writeGraph(dir) {
    const gp = graphJsonPath(dir);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    // Must clear the size floor: staleness is measured against the RESOLVED graph, and an under-floor file never resolves.
    fs.writeFileSync(gp, JSON.stringify({ nodes: Array(50).fill({ id: "x" }) }));
    return gp;
  }

  test("missing graph.json counts as stale", () => {
    const d = freshTmp();
    expect(graphIsStale(d)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("fresh when graph.json is newer than every source", () => {
    const d = freshTmp();
    fs.writeFileSync(path.join(d, "a.js"), "x");
    const gp = writeGraph(d);
    fs.utimesSync(path.join(d, "a.js"), OLD, OLD);
    fs.utimesSync(gp, NOW, NOW);
    expect(graphIsStale(d)).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("stale when a source file is newer than graph.json", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.writeFileSync(path.join(d, "a.js"), "x");
    fs.utimesSync(gp, OLD, OLD);
    fs.utimesSync(path.join(d, "a.js"), NOW, NOW);
    expect(graphIsStale(d)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("ignores newer files inside graphify-out / skipped dirs", () => {
    const d = freshTmp();
    fs.writeFileSync(path.join(d, "a.js"), "x"); // a real (older) source so count >= 1
    const gp = writeGraph(d);
    fs.utimesSync(path.join(d, "a.js"), OLD, OLD);
    fs.utimesSync(gp, NOW, NOW);
    const inside = path.join(d, "graphify-out", "cache.bin");
    fs.writeFileSync(inside, "x");
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(inside, future, future); // newer than the graph, but must be ignored
    expect(graphIsStale(d)).toBe(false); // graphify-out churn must not mark stale
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("fail-safe: a truncated scan (maxFiles hit) is treated as stale", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, NOW, NOW);
    fs.writeFileSync(path.join(d, "a.js"), "x");
    fs.mkdirSync(path.join(d, "sub"));
    fs.writeFileSync(path.join(d, "sub", "b.js"), "x");
    // Cannot see every file → must NOT claim fresh.
    expect(graphIsStale(d, { maxFiles: 1 })).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("fail-safe: a repo with no comparable source files is stale", () => {
    const d = freshTmp();
    const gp = writeGraph(d); // only graphify-out/graph.json, no sources
    fs.utimesSync(gp, NOW, NOW);
    expect(graphIsStale(d)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("follows symlinked dirs so newer source behind a link is detected", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, OLD, OLD);
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-link-target-"));
    const newer = path.join(realDir, "new.js");
    fs.writeFileSync(newer, "x");
    fs.utimesSync(newer, NOW, NOW);
    let linked = true;
    try {
      fs.symlinkSync(realDir, path.join(d, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      linked = false; // no symlink privilege (e.g. Windows non-admin) — skip assert
    }
    if (linked) expect(graphIsStale(d)).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(realDir, { recursive: true, force: true });
  });
});

describe("stalenessInfo — bounded-tolerance gate precondition", () => {
  const OLD = new Date(Date.now() - 60_000);
  const NOW = new Date();

  function freshTmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "graph-stalenessinfo-"));
  }
  function writeGraph(dir) {
    const gp = graphJsonPath(dir);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, JSON.stringify({ nodes: Array(50).fill({ id: "x" }) }));
    return gp;
  }
  function newSourceFile(dir, name) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "x");
    fs.utimesSync(p, NOW, NOW);
    return p;
  }

  test("missing graph.json → newerCount Infinity, not truncated", () => {
    const d = freshTmp();
    const info = stalenessInfo(d);
    expect(info.newerCount).toBe(Infinity);
    expect(info.truncated).toBe(false);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("newerCount 0 when graph is newer than every source", () => {
    const d = freshTmp();
    fs.writeFileSync(path.join(d, "a.js"), "x");
    fs.utimesSync(path.join(d, "a.js"), OLD, OLD);
    const gp = writeGraph(d);
    fs.utimesSync(gp, NOW, NOW);
    expect(stalenessInfo(d).newerCount).toBe(0);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("newerCount reflects exactly how many files are newer (boundary: 1)", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, OLD, OLD);
    newSourceFile(d, "a.js");
    expect(stalenessInfo(d).newerCount).toBe(1);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("newerCount at the tolerance boundary (25) and one past it (26)", () => {
    const TOLERANCE = 25;
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, OLD, OLD);
    for (let i = 0; i < TOLERANCE; i++) newSourceFile(d, `f${i}.js`);
    expect(stalenessInfo(d).newerCount).toBe(TOLERANCE);
    newSourceFile(d, "one-more.js");
    expect(stalenessInfo(d).newerCount).toBe(TOLERANCE + 1);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("truncated scan → newerCount Infinity, truncated true", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, NOW, NOW);
    fs.writeFileSync(path.join(d, "a.js"), "x");
    fs.mkdirSync(path.join(d, "sub"));
    fs.writeFileSync(path.join(d, "sub", "b.js"), "x");
    const info = stalenessInfo(d, { maxFiles: 1 });
    expect(info.newerCount).toBe(Infinity);
    expect(info.truncated).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  test("no comparable source files → newerCount Infinity", () => {
    const d = freshTmp();
    const gp = writeGraph(d);
    fs.utimesSync(gp, NOW, NOW);
    expect(stalenessInfo(d).newerCount).toBe(Infinity);
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("suggestQuery — Gap #3 concrete gate suggestion", () => {
  test("strips regex metachars and collapses into a plain-English question", () => {
    expect(suggestQuery("foo.*bar")).toBe('graphify query "What defines or uses foo bar?"');
  });

  test("collapses snake/kebab separators into words", () => {
    expect(suggestQuery("foo_bar-baz")).toBe('graphify query "What defines or uses foo bar baz?"');
  });

  test("falls back to the generic placeholder for empty/non-string patterns", () => {
    expect(suggestQuery("")).toBe('graphify query "<your question>"');
    expect(suggestQuery(undefined)).toBe('graphify query "<your question>"');
    expect(suggestQuery("...")).toBe('graphify query "<your question>"');
  });

  test("carries a --graph suffix through, on the concrete and the placeholder form", () => {
    const flag = ' --graph "C:\\repo\\graphify-out\\graph.json"';
    expect(suggestQuery("foo_bar", flag)).toBe(`graphify query "What defines or uses foo bar?"${flag}`);
    expect(suggestQuery("", flag)).toBe(`graphify query "<your question>"${flag}`);
  });
});

describe("resolveGraphJson — local → repo root → primary checkout", () => {
  const GRAPH = JSON.stringify({ nodes: Array(50).fill({ id: "x" }) });
  function writeGraph(root) {
    const gp = graphJsonPath(root);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, GRAPH);
    return gp;
  }
  /** primary checkout + linked worktree (subdir included), no graphs yet */
  function pair() {
    const main = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-main-"));
    fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-wt-"));
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
    const sub = path.join(wt, "src");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "a.js"), "const a = 1;");
    return { main, wt, sub };
  }
  const dirs = [];
  afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

  test("null when no candidate holds a usable graph", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    expect(resolveGraphJson(sub)).toBeNull();
    expect(hasGraph(sub)).toBe(false);
    expect(graphFlag(sub)).toBe("");
  });

  test("local wins and needs no --graph flag", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    writeGraph(main);
    const local = writeGraph(sub);
    expect(resolveGraphJson(sub)).toEqual({ file: local, source: "local" });
    expect(graphFlag(sub)).toBe("");
    expect(hasLocalGraph(sub)).toBe(true);
  });

  test("a subdirectory session resolves to the enclosing repo root's graph", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    const rootGraph = writeGraph(wt);
    expect(resolveGraphJson(sub)).toEqual({ file: rootGraph, source: "root" });
    expect(hasGraph(sub)).toBe(true);
    expect(hasLocalGraph(sub)).toBe(false);
    expect(graphFlag(sub)).toBe(` --graph "${rootGraph}"`);
  });

  test("a graph-less worktree falls back to the primary checkout's graph", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    const mainGraph = writeGraph(main);
    expect(resolveGraphJson(wt)).toEqual({ file: mainGraph, source: "main" });
    expect(resolveGraphJson(sub)).toEqual({ file: mainGraph, source: "main" });
    expect(hasGraph(wt)).toBe(true);
    expect(hasLocalGraph(wt)).toBe(false);
    // The nudge names the resolved file and hands Claude the flag verbatim.
    const nudge = buildGraphNudge(wt);
    expect(nudge).toContain(mainGraph);
    expect(nudge).toContain(`graphify query "<question>" --graph "${mainGraph}"`);
  });

  test("staleness is measured against the resolved (primary) graph, over THIS tree's sources", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    const mainGraph = writeGraph(main);
    const OLD = new Date(Date.now() - 60_000), NOW = new Date();
    fs.utimesSync(mainGraph, NOW, NOW);
    // Age EVERY file the scan will see, not just a.js: the worktree's `.git`
    // pointer is a dot-FILE (scanSources skips dot-dirs only) and pair() wrote
    // it within the same millisecond as NOW, so its sub-ms NTFS mtime landed
    // above the graph's ms-rounded one on ~half the runs — a flaky "1".
    for (const f of [path.join(wt, ".git"), path.join(sub, "a.js")]) fs.utimesSync(f, OLD, OLD);
    expect(stalenessInfo(wt).newerCount).toBe(0);
    // A branch edit in the worktree is exactly the lag the primary graph has.
    const later = new Date(Date.now() + 5_000);
    fs.writeFileSync(path.join(sub, "b.js"), "const b = 2;");
    fs.utimesSync(path.join(sub, "b.js"), later, later);
    expect(stalenessInfo(wt).newerCount).toBe(1);
  });

  test("an under-floor graph in the worktree does not shadow a usable primary graph", () => {
    const { main, wt, sub } = pair(); dirs.push(main, wt);
    const mainGraph = writeGraph(main);
    const gp = graphJsonPath(wt);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, "{}");
    expect(resolveGraphJson(wt)).toEqual({ file: mainGraph, source: "main" });
  });
});

describe("isSemanticPattern — eligibility heuristic (Requirement B1)", () => {
  test.each([
    "authService", "get_user_by_id", "user-repo", "Foo.Bar",
    "authService|userRepo", "foo|bar|baz|qux",
  ])("%s → eligible", (p) => expect(isSemanticPattern(p)).toBe(true));

  test.each([
    [null, "not a string"],
    ["", "empty"],
    ["   ", "whitespace only"],
    ["0\\.51\\.0", "version literal"],
    ["12345", "pure digits"],
    ["plugins/devops/hooks", "path-like (slash)"],
    ["plugins\\/devops\\/hooks", "path-like (escaped slash)"],
    ["where is the retry logic implemented exactly", "sentence (>4 words)"],
    ["ab", "very short term"],
    ["a|bc", "one term too short even in an alternation"],
    ["fo|barBaz|qu|x1", "4 terms but one too short"],
    ["[a-z]+Service", "character class"],
    ["(foo|bar)Baz", "capturing group"],
    ["auth{2,3}", "quantifier braces"],
    ["^authService$", "anchors"],
    ["auth+Service", "quantifier plus"],
    ["one two three four five", "5 words"],
  ])("%s (%s) → not eligible", (p) => expect(isSemanticPattern(p)).toBe(false));
});

describe("pathKindFor — cheap path classification", () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-pathkind-")); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test("no path → 'none'", () => expect(pathKindFor("", dir)).toBe("none"));
  test("an existing directory → 'dir'", () => expect(pathKindFor(dir, dir)).toBe("dir"));
  test("an existing file → 'file'", () => {
    const f = path.join(dir, "a.js");
    fs.writeFileSync(f, "x");
    expect(pathKindFor(f, dir)).toBe("file");
  });
  test("a nonexistent path → 'file' (never treated as an eligible directory)", () => {
    expect(pathKindFor(path.join(dir, "does-not-exist"), dir)).toBe("file");
  });
  test("a relative path resolves against cwd", () => {
    expect(pathKindFor("a.js", dir)).toBe("file");
  });
});

describe("isEligibleSearch — Grep vs. Glob eligibility", () => {
  let dir;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-nudge-eligible-")); });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  test("Grep, no path, semantic pattern → eligible", () => {
    expect(isEligibleSearch("Grep", { pattern: "authService" }, dir)).toBe(true);
  });

  test("Grep scoped to a directory, semantic pattern → eligible", () => {
    expect(isEligibleSearch("Grep", { pattern: "authService", path: dir }, dir)).toBe(true);
  });

  test("Grep scoped to a FILE → never eligible, even with a semantic pattern", () => {
    const f = path.join(dir, "b.js");
    fs.writeFileSync(f, "x");
    expect(isEligibleSearch("Grep", { pattern: "authService", path: f }, dir)).toBe(false);
  });

  test("Grep with a non-semantic pattern → not eligible", () => {
    expect(isEligibleSearch("Grep", { pattern: "0\\.51\\.0" }, dir)).toBe(false);
  });

  test("Glob, no path → eligible (unchanged behaviour)", () => {
    expect(isEligibleSearch("Glob", { pattern: "**/*.js" }, dir)).toBe(true);
  });

  test("Glob with a path → not eligible", () => {
    expect(isEligibleSearch("Glob", { pattern: "**/*.js", path: dir }, dir)).toBe(false);
  });

  test("an unrelated tool → not eligible", () => {
    expect(isEligibleSearch("Read", { file_path: "x" }, dir)).toBe(false);
  });
});

describe("questionFromPattern / suggestQuery", () => {
  test("turns identifier terms into a plain-English question", () => {
    expect(questionFromPattern("authService")).toBe("What defines or uses authService?");
  });

  test("returns null for nothing usable", () => {
    expect(questionFromPattern("")).toBe(null);
    expect(questionFromPattern(undefined)).toBe(null);
  });

  test("suggestQuery wraps the question in a graphify query command", () => {
    expect(suggestQuery("authService")).toBe('graphify query "What defines or uses authService?"');
    expect(suggestQuery("")).toBe('graphify query "<your question>"');
  });
});

describe("hasGraphAnswer — did the query find anything?", () => {
  test("empty / whitespace-only output → no answer", () => {
    expect(hasGraphAnswer("")).toBe(false);
    expect(hasGraphAnswer("   \n  ")).toBe(false);
    expect(hasGraphAnswer(undefined)).toBe(false);
  });

  test("the exact 'no nodes' message → no answer", () => {
    expect(hasGraphAnswer("No matching nodes found.")).toBe(false);
    expect(hasGraphAnswer("no matching nodes found")).toBe(false);
    expect(hasGraphAnswer("  No matching nodes found.  \n")).toBe(false);
  });

  test("any other non-empty output → an answer", () => {
    expect(hasGraphAnswer("Node: authService (src/auth.js:12)")).toBe(true);
  });
});
