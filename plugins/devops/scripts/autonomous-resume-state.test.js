import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../hooks/lib/run-contract-store.js");
const RS = require("./autonomous-resume-state.js");

const T0 = Date.parse("2026-10-20T01:00:00Z");
let cwd;
let prevEnv;
beforeEach(() => {
  prevEnv = process.env.DOTCLAUDE_RUN_CONTRACT;
  delete process.env.DOTCLAUDE_RUN_CONTRACT;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "resume-state-"));
  const r = spawnSync("git", ["init", "-q"], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
});
afterEach(() => {
  if (prevEnv === undefined) delete process.env.DOTCLAUDE_RUN_CONTRACT; else process.env.DOTCLAUDE_RUN_CONTRACT = prevEnv;
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

const resumeFile = () => path.join(cwd, "AUTONOMOUS-RESUME.json");
const run = (...args) => { let out; const code = RS.cli(args, { cwd, now: T0 + 60_000, out: (o) => { out = o; } }); return { code, out }; };

describe("interrupted autonomous run keeps its do-run answers (D1)", () => {
  test("save → abort → rearm re-arms with the original ship / strict / flow, not manual", () => {
    store.arm(cwd, { mode: "prompt", flow: "autonomous", ship: "auto", strict: true, passes: ["harden"], items: ["12"] }, { now: T0 });
    fs.writeFileSync(resumeFile(), JSON.stringify({ task: "fix it", mode: "implement", missingPermission: "gh pr merge" }));
    const s = run("save");
    expect(s.code).toBe(0);
    const data = JSON.parse(fs.readFileSync(resumeFile(), "utf8"));
    expect(data).toMatchObject({ task: "fix it", missingPermission: "gh pr merge", run: { ship: "auto", strict: true, flow: "autonomous", mode: "prompt", passes: ["harden"], items: ["12"] } });
    store.close(cwd, "INTERRUPTED: missing permission", { aborted: true, now: T0 + 60_000 });
    expect(store.readContract(cwd, { now: T0 + 60_000 })).toBeNull();

    const r = run("rearm", "--session", "s-2");
    expect(r.code).toBe(0);
    expect(r.out.legacy).toBeUndefined();
    expect(store.readContract(cwd, { now: T0 + 120_000 })).toMatchObject({ ship: "auto", strict: true, flow: "autonomous", mode: "prompt", passes: ["harden"], items: ["12"], source: "resume", sessionId: "s-2" });
  });

  test("save without a resume file creates it; without a live contract it refuses", () => {
    expect(run("save")).toMatchObject({ code: 1, out: { ok: false } });
    store.arm(cwd, { flow: "autonomous", ship: "manual" }, { now: T0 });
    expect(run("save").code).toBe(0);
    expect(JSON.parse(fs.readFileSync(resumeFile(), "utf8")).run).toMatchObject({ ship: "manual", strict: false, flow: "autonomous" });
  });

  test("save never overwrites a resume file that is not a JSON object", () => {
    store.arm(cwd, { flow: "autonomous", ship: "auto" }, { now: T0 });
    fs.writeFileSync(resumeFile(), "not json");
    expect(run("save").code).toBe(1);
    expect(fs.readFileSync(resumeFile(), "utf8")).toBe("not json");
  });

  test("a legacy resume file without run answers re-arms autonomous with the defaults and flags it", () => {
    fs.writeFileSync(resumeFile(), JSON.stringify({ task: "x", mode: "implement" }));
    const r = run("rearm");
    expect(r).toMatchObject({ code: 0, out: { ok: true, legacy: true } });
    expect(r.out.contract).toMatchObject({ flow: "autonomous", ship: "manual", strict: false });
  });

  test("garbage run values are normalised; a missing file is refused", () => {
    expect(run("rearm").code).toBe(1);
    fs.writeFileSync(resumeFile(), JSON.stringify({ run: { ship: "yolo", strict: "yes", flow: "autonomous", items: ["12),13", "#7"] } }));
    expect(run("rearm").out.contract).toMatchObject({ ship: "manual", strict: true, items: ["7"] });
    expect(run("bogus").code).toBe(1);
  });
});
