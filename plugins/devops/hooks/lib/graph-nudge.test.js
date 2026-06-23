import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasGraph, buildGraphNudge, graphJsonPath } from "./graph-nudge.js";

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

  test("true once graphify-out/graph.json exists", () => {
    const gp = graphJsonPath(dir);
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, "{}");
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
    expect(t).toContain("/devops-graph");
  });
});
