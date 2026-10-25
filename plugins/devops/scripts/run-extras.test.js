/**
 * Frustrated Mode F7/F8: do-run extras (Q4 option visibility, hand-off check).
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const extras = require("./run-extras.js");
const plans = require("../hooks/lib/run-contract-plan.js");
const { writeState } = require("../hooks/lib/frustration-state.js");
const { emptyState } = require("../hooks/lib/frustration-detect.js");

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-extras.js");
const NOW = Date.parse("2026-10-25T12:00:00Z");
const H2 = 2 * 60 * 60 * 1000;
const PLAN = { direction: "fix the cache", steps: [{ n: 1, type: "implement", goal: "invalidate", objects: ["a.js"] }], out_of_scope: [] };

let dir, root, stateFile, on, off;
const flagged = { ...emptyState(), rounds: 4, score: 9, updatedAt: NOW };
const quiet = { ...emptyState(), rounds: 1, score: 1, updatedAt: NOW };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rx-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rx-reg-"));
  fs.writeFileSync(path.join(root, "features.json"), JSON.stringify({ features: { "frustrated-mode": { minChannel: "alpha", summary: "t", docs: [], scripts: [] } } }));
  stateFile = path.join(dir, "frustration.json");
  on = { pluginRoot: root, channel: "alpha" };
  off = { pluginRoot: root, channel: "stable" };
});
afterEach(() => {
  for (const d of [dir, root]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

describe("q4Extra visibility", () => {
  test("stable -> never, even when flagged", () => {
    writeState("s1", flagged, { file: stateFile });
    expect(extras.q4Extra("s1", { ...off, stateFile, nowMs: NOW })).toBeNull();
  });
  test("beta -> never (minChannel alpha)", () => {
    writeState("s1", flagged, { file: stateFile });
    expect(extras.q4Extra("s1", { ...on, channel: "beta", stateFile, nowMs: NOW })).toBeNull();
  });
  test("alpha + not flagged -> never", () => {
    writeState("s1", quiet, { file: stateFile });
    expect(extras.q4Extra("s1", { ...on, stateFile, nowMs: NOW })).toBeNull();
  });
  test("alpha + no state / no session id -> never", () => {
    expect(extras.q4Extra("s1", { ...on, stateFile, nowMs: NOW })).toBeNull();
    expect(extras.q4Extra("", { ...on, nowMs: NOW })).toBeNull();
  });
  test("alpha + snoozed -> never", () => {
    writeState("s1", { ...flagged, snoozed: true }, { file: stateFile });
    expect(extras.q4Extra("s1", { ...on, stateFile, nowMs: NOW })).toBeNull();
  });
  test("alpha + flagged -> shown, and it wins", () => {
    writeState("s1", flagged, { file: stateFile });
    const x = extras.q4Extra("s1", { ...on, stateFile, nowMs: NOW });
    expect(x).toMatchObject({ id: "analyze-first", label: "Erst analysieren", wins: true });
  });
  test("alpha + flagged but state older than 2 h -> never", () => {
    writeState("s1", flagged, { file: stateFile });
    expect(extras.q4Extra("s1", { ...on, stateFile, nowMs: NOW + H2 + 1000 })).toBeNull();
  });
});

describe("fromPreset", () => {
  test("alpha knows the preset, stable and unknown names do not", () => {
    expect(extras.fromPreset("frustrated", on)).toEqual({ known: true, doc: "deep-knowledge/frustrated-mode.md", section: "Hand-off" });
    expect(extras.fromPreset("frustrated", off)).toEqual({ known: false });
    expect(extras.fromPreset("do-batch", on)).toEqual({ known: false });
    expect(extras.fromPreset("__proto__", on)).toEqual({ known: false });
  });
  test("each receiving skill gets its own section; unknown skills and stable get none", () => {
    const doc = "deep-knowledge/frustrated-mode.md";
    expect(extras.fromPreset("frustrated", on, "auto-agents")).toEqual({ known: false });
    expect(extras.fromPreset("frustrated", on, "auto-concept")).toEqual({ known: true, doc, section: "Hand-off in auto-concept" });
    expect(extras.fromPreset("frustrated", on, "do-learn")).toEqual({ known: true, doc, section: "Hand-off in do-learn" });
    expect(extras.fromPreset("frustrated", on, "auto-fix")).toEqual({ known: false });
    expect(extras.fromPreset("frustrated", on, "constructor")).toEqual({ known: false });
    expect(extras.fromPreset("frustrated", off, "do-learn")).toEqual({ known: false });
  });
  test("every receiving hand-off verifies the plan before acting", () => {
    const root = path.join(path.dirname(SCRIPT), "..");
    const md = fs.readFileSync(path.join(root, "deep-knowledge", "frustrated-mode.md"), "utf8");
    for (const sec of ["Hand-off in auto-concept", "Hand-off in do-learn"]) {
      const body = md.split(`\n## ${sec}\n`)[1].split("\n## ")[0];
      expect(body, sec).toMatch(/Verify first[^\n]*run-extras\.js" handoff --plan/);
    }
    // auto-agents skips its confirmation only for a --via plan the helper confirms.
    const agents = fs.readFileSync(path.join(root, "skills", "auto-agents", "SKILL.md"), "utf8");
    expect(agents).toMatch(/`--via`\+`--plan=<ref>` that `node "\{PLUGIN_ROOT\}\/scripts\/run-extras\.js" handoff --plan <ref>` confirms/);
  });
  test("every section the helper names exists in the feature doc", () => {
    const md = fs.readFileSync(path.join(path.dirname(SCRIPT), "..", "deep-knowledge", "frustrated-mode.md"), "utf8");
    for (const skill of ["do-run", "auto-concept", "do-learn"]) {
      const { section } = extras.fromPreset("frustrated", on, skill);
      expect(md, skill).toContain(`\n## ${section}\n`);
    }
  });
});

describe("parsePlanRef", () => {
  test("accepts id@hash8+, rejects the rest", () => {
    expect(extras.parsePlanRef("fm-20261025-k3q9@3F9A1C2E")).toEqual({ id: "fm-20261025-k3q9", short: "3f9a1c2e" });
    for (const bad of ["", "fm-1", "fm-1@abc", "x@3f9a1c2e", "fm-1@zzzzzzzz", undefined]) expect(extras.parsePlanRef(bad)).toBeNull();
  });
});

describe("checkHandoff", () => {
  const o = (extra = {}) => ({ featureOpts: on, now: NOW, ...extra });
  function recordPlan(approve) {
    const rec = plans.recordPlan(dir, PLAN, { id: "fm-20261025-t1t1" }, o());
    if (approve) plans.approvePlan(dir, { id: rec.plan.id, hash: rec.plan.short }, {}, o());
    return rec.plan;
  }
  test("approved + matching -> ok", () => {
    const p = recordPlan(true);
    const r = extras.checkHandoff(`${p.id}@${p.short}`, dir, o());
    expect(r.ok).toBe(true);
    expect(r.steps).toBe(1);
  });
  test("pending (not approved) -> refused", () => {
    const p = recordPlan(false);
    const r = extras.checkHandoff(`${p.id}@${p.short}`, dir, o());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pending, not approved/);
  });
  test("wrong hash or id -> refused", () => {
    const p = recordPlan(true);
    expect(extras.checkHandoff(`${p.id}@deadbeef`, dir, o()).error).toMatch(/plan changed/);
    expect(extras.checkHandoff(`fm-other@${p.short}`, dir, o()).ok).toBe(false);
  });
  test("expired record -> refused", () => {
    const p = recordPlan(true);
    const r = extras.checkHandoff(`${p.id}@${p.short}`, dir, o({ now: NOW + H2 + 1000 }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired/);
  });
  test("no record, bad ref, feature off -> refused", () => {
    expect(extras.checkHandoff("fm-a@12345678", dir, o()).ok).toBe(false);
    expect(extras.checkHandoff("nonsense", dir, o()).ok).toBe(false);
    const p = recordPlan(true);
    expect(extras.checkHandoff(`${p.id}@${p.short}`, dir, { featureOpts: off, now: NOW }).ok).toBe(false);
  });
});

describe("CLI", () => {
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, HOME: dir, USERPROFILE: dir } });
  test("exits 126 without output on a stable pin", () => {
    fs.mkdirSync(path.join(dir, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "plugins", ".channels.json"), JSON.stringify({ dotclaude: "stable" }));
    const r = run(["q4", "--session", "s1"]);
    expect(r.status).toBe(126);
    expect(r.stdout).toBe("");
  });
});
