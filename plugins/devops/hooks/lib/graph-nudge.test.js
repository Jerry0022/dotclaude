import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasGraph, buildGraphNudge, graphJsonPath, graphIsStale, stalenessInfo, suggestQuery } from "./graph-nudge.js";

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
    expect(t).toContain("/devops-auto-graph");
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
    fs.writeFileSync(gp, "{}");
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
    fs.writeFileSync(gp, "{}");
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
});
