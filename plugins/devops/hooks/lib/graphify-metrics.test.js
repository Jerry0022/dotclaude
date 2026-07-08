import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { record, metricsPath, DEFAULT_METRICS_PATH } from "./graphify-metrics.js";

describe("graphify-metrics — event telemetry", () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-metrics-"));
    file = path.join(dir, "sub", "graphify-metrics.jsonl");
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("metricsPath defaults to ~/.claude/graphify-metrics.jsonl", () => {
    expect(metricsPath()).toBe(DEFAULT_METRICS_PATH);
    expect(DEFAULT_METRICS_PATH).toContain(os.homedir());
  });

  test("appends one JSON line per event with ts/event/project/sid", () => {
    record("gate_fired", { newerCount: 3 }, { path: file, cwd: "/proj", sid: "s1" });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("gate_fired");
    expect(entry.project).toBe("/proj");
    expect(entry.sid).toBe("s1");
    expect(entry.newerCount).toBe(3);
    expect(typeof entry.ts).toBe("string");
  });

  test("multiple record() calls append (not overwrite)", () => {
    record("gate_fired", {}, { path: file });
    record("query_ran", {}, { path: file });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[1]).event).toBe("query_ran");
  });

  test("creates parent directories on demand", () => {
    expect(fs.existsSync(path.dirname(file))).toBe(false);
    record("offer_shown", { source: "session_start" }, { path: file });
    expect(fs.existsSync(file)).toBe(true);
  });

  test("caps the file to the newest half once it exceeds the byte cap", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bigLine = "x".repeat(200);
    const lines = [];
    // Write enough lines to exceed a small synthetic cap by writing directly,
    // then let one more record() call trigger the cap check with a tiny
    // override — the module's real MAX_BYTES is 2MB, too slow to exercise
    // directly, so we assert the truncate-rewrite mechanics via capIfNeeded's
    // observable effect: after crossing the module's cap the file should
    // never throw and should remain valid JSONL. We approximate by writing
    // ~2.1MB of lines directly, then confirming the next record() call still
    // succeeds and produces a smaller, valid file.
    let size = 0;
    while (size < 2.1 * 1024 * 1024) {
      const l = JSON.stringify({ ts: "t", event: "gate_fired", i: lines.length, pad: bigLine });
      lines.push(l);
      size += l.length + 1;
    }
    fs.writeFileSync(file, lines.join("\n") + "\n");
    const beforeCount = fs.readFileSync(file, "utf8").trim().split("\n").length;
    record("query_ran", {}, { path: file });
    const after = fs.readFileSync(file, "utf8").trim().split("\n");
    // Capped: fewer lines than before + 1 (the new one), and every line still
    // valid JSON (no corruption from the truncate-rewrite).
    expect(after.length).toBeLessThan(beforeCount + 1);
    for (const l of after) expect(() => JSON.parse(l)).not.toThrow();
  });

  test("fail-silent: never throws when the path is unwritable", () => {
    const bogus = path.join(dir, "not-a-dir.txt");
    fs.writeFileSync(bogus, "x"); // a FILE, so path.join(bogus, 'metrics.jsonl') dir creation fails
    const badPath = path.join(bogus, "graphify-metrics.jsonl");
    expect(() => record("gate_fired", {}, { path: badPath })).not.toThrow();
  });
});
