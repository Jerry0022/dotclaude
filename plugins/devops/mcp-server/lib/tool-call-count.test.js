import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readToolCallCount, projectSlug, TOOLCALL_PREFIX } from "./tool-call-count.js";

// Card audit row 6: the "self" card must not show a parallel session's count.
let tmp, cfg;
const cwd = "C:\\Users\\me\\repo-a";
const write = (id, n, ageMs = 0) => {
  const f = path.join(tmp, `${TOOLCALL_PREFIX}${id}`);
  fs.writeFileSync(f, String(n));
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(f, t, t);
};
const transcript = (forCwd, id) => {
  const d = path.join(cfg, "projects", projectSlug(forCwd));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${id}.jsonl`), "{}\n");
};
const opts = (over = {}) => ({ dir: tmp, env: { CLAUDE_CONFIG_DIR: cfg, HOME: cfg, USERPROFILE: cfg }, cwd, ...over });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tcc-"));
  cfg = fs.mkdtempSync(path.join(os.tmpdir(), "tcc-cfg-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(cfg, { recursive: true, force: true });
});

describe("tool-call count for the card", () => {
  test("slug matches Claude Code's project directory naming", () => {
    expect(projectSlug("C:\\Users\\Jerem\\IdeaProjects\\dotclaude")).toBe("C--Users-Jerem-IdeaProjects-dotclaude");
  });

  test("the exact id wins", () => {
    write("real-1", 7);
    write("other", 99);
    expect(readToolCallCount("real-1", opts())).toBe(7);
  });

  test("'self' resolves to the session whose transcript lives under this cwd, not the newest foreign one", () => {
    write("mine", 12, 5000);
    write("foreign", 99, 0);
    transcript(cwd, "mine");
    transcript("C:\\Users\\me\\repo-b", "foreign");
    expect(readToolCallCount("self", opts())).toBe(12);
  });

  test("project dir exists but none of its sessions has a counter → hidden, never borrowed", () => {
    write("foreign", 99);
    transcript(cwd, "mine");
    expect(readToolCallCount("self", opts())).toBe(0);
  });

  test("unresolvable cwd: newest counter within 30 min only", () => {
    write("stale", 50, 31 * 60 * 1000);
    expect(readToolCallCount("self", opts({ cwd: "" }))).toBe(0);
    write("fresh", 4, 60 * 1000);
    expect(readToolCallCount("self", opts({ cwd: "" }))).toBe(4);
  });

  test("a stale counter of this cwd's session is ignored too", () => {
    write("mine", 12, 31 * 60 * 1000);
    transcript(cwd, "mine");
    expect(readToolCallCount("self", opts())).toBe(0);
  });
});
