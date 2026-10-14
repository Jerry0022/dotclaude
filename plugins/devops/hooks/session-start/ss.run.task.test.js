import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskInstruction, taskPath } from "./ss.run.task.js";

describe("ss.run.task", () => {
  let cwd;
  const TASK = "bau X, aber fass Y nicht an, inkl. ship";
  const writeTask = (text = TASK, mtime = Date.now()) => {
    fs.writeFileSync(taskPath(cwd), text);
    fs.utimesSync(taskPath(cwd), mtime / 1000, mtime / 1000);
  };
  const contract = (armedAt = new Date().toISOString()) => ({ armedAt, sessionId: "s1" });

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "run-task-"));
    fs.mkdirSync(path.join(cwd, ".claude"));
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  test("re-injects the task verbatim after a compaction", () => {
    writeTask();
    const out = buildTaskInstruction({ cwd, source: "compact", contract: contract() });
    expect(out).toContain(TASK);
    expect(out).toContain("VERBATIM");
    expect(out).toContain("just compacted");
  });

  test("also on resume", () => {
    writeTask();
    expect(buildTaskInstruction({ cwd, source: "resume", contract: contract() })).toContain(TASK);
  });

  test("silent on a fresh startup", () => {
    writeTask();
    expect(buildTaskInstruction({ cwd, source: "startup", contract: contract() })).toBeNull();
  });

  test("silent without an active contract of this session", () => {
    writeTask();
    expect(buildTaskInstruction({ cwd, source: "compact", contract: null })).toBeNull();
  });

  test("silent when the file predates the last closed run (a finished run's leftover)", () => {
    writeTask(TASK, Date.now() - 60 * 60 * 1000);
    fs.writeFileSync(path.join(cwd, ".claude", "run-contract.prev.json"),
      JSON.stringify({ closedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }));
    expect(buildTaskInstruction({ cwd, source: "compact", contract: contract() })).toBeNull();
  });

  test("keeps a file written long before a late-armed contract (no previous run)", () => {
    writeTask(TASK, Date.now() - 60 * 60 * 1000);
    expect(buildTaskInstruction({ cwd, source: "compact", contract: contract() })).toContain(TASK);
  });

  test("resolves the file at the work-tree root from a subdirectory", () => {
    fs.mkdirSync(path.join(cwd, ".git"));
    fs.mkdirSync(path.join(cwd, "sub"));
    writeTask();
    expect(buildTaskInstruction({ cwd: path.join(cwd, "sub"), source: "compact", contract: contract() })).toContain(TASK);
  });

  test("silent without a task file or with an empty one", () => {
    expect(buildTaskInstruction({ cwd, source: "compact", contract: contract() })).toBeNull();
    writeTask("   ");
    expect(buildTaskInstruction({ cwd, source: "compact", contract: contract() })).toBeNull();
  });

  test("truncates a huge task and points at the file", () => {
    writeTask("x".repeat(9000));
    const out = buildTaskInstruction({ cwd, source: "compact", contract: contract() });
    expect(out).toContain("truncated — read .claude/run-task.md");
  });
});
