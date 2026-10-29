import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const hook = require("./ss.ci.workflows.sweep.js");
const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "dispatch", "manifest.json"), "utf8"));
const lanes = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "dispatch", "lanes.json"), "utf8"));

let dir, file;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-ciwf-")); file = path.join(dir, "q.json"); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ss.ci.workflows.sweep (#949)", () => {
  test("registered in the SessionStart manifest and lanes", () => {
    const cmds = manifest.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.includes("session-start/ss.ci.workflows.sweep.js"))).toBe(true);
    expect(lanes.lanes.SessionStart.flat()).toContain("ss.ci.workflows.sweep");
  });

  test("buildContext is silent without overdue repos and names them otherwise", () => {
    expect(hook.buildContext([])).toBeNull();
    expect(hook.buildContext(["o/r", "o/x"])).toMatch(/o\/r, o\/x/);
  });

  test("the CLI --list reads only the quota file: no store, overdue and covered records", () => {
    const run = () => {
      const r = spawnSync(process.execPath, [hook.CLI, "--list"], { encoding: "utf8", env: { ...process.env, DEVOPS_CI_QUOTA_FILE: file } });
      expect(r.status).toBe(0);
      return JSON.parse(r.stdout);
    };
    expect(run()).toEqual([]);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      repos: { o: { detectedAt: "2026-10-01T00:00:00.000Z", resetAt: future } },
      decisions: { o: { value: "skip-checks", decidedAt: "2026-10-02T00:00:00.000Z", validUntil: future } },
      disabledWorkflows: {
        "o/covered": { ids: [{ id: 1 }], disabledAt: "x", until: future, state: "disabled" },
        "o/pending": { ids: [{ id: 2 }], disabledAt: "x", until: future, state: "pending-enable" },
        "x/revoked": { ids: [{ id: 3 }], disabledAt: "x", until: future, state: "disabled" },
        "o/late": { ids: [{ id: 4 }], disabledAt: "x", until: "2020-01-01T00:00:00.000Z", state: "disabled" },
      },
    }));
    expect(run().sort()).toEqual(["o/late", "o/pending", "x/revoked"]);
  });
});
