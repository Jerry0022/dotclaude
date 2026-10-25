import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { telemetryLine } from "./ss.orphan.nudge.js";

const NOW = Date.now();
let dir;
let file;
let stamp;

function write(hook, runs, killed) {
  const lines = [];
  for (let i = 0; i < runs; i++) {
    const id = `${hook}${i}`;
    lines.push({ ts: NOW - 900000 + i, id, hook, phase: "start" });
    if (i >= killed) lines.push({ ts: NOW - 900000 + i, id, hook, phase: "end", outcome: "ok" });
  }
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n"));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nudge-tel-"));
  file = path.join(dir, "tel.jsonl");
  stamp = path.join(dir, "stamp");
});
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

describe("ss.orphan.nudge — hook telemetry line", () => {
  test("names the hook and its kill rate above 5 %, once a day", () => {
    write("stop.flow.guard", 200, 20);
    const line = telemetryLine({ lang: "en", file, now: NOW, stamp });
    expect(line).toContain("stop.flow.guard");
    expect(line).toContain("10 %");
    expect(telemetryLine({ lang: "en", file, now: NOW + 3600_000, stamp })).toBeNull();
    expect(telemetryLine({ lang: "de", file, now: NOW + 25 * 3600_000, stamp })).toContain("10 %");
  });

  test("silent at or below 5 % and for a hook with too few runs", () => {
    write("a", 200, 10);
    expect(telemetryLine({ file, now: NOW, stamp })).toBeNull();
    write("b", 10, 5);
    expect(telemetryLine({ file, now: NOW, stamp })).toBeNull();
  });
});
