/**
 * Frustrated Mode F6: plan record + approval recorder beside the run contract.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("./run-contract-store.js");
const { cli } = require("./run-contract-cli.js");
const plans = require("./run-contract-plan.js");

let dir, root, on, off;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const H2 = 2 * 60 * 60 * 1000;
const PLAN = { direction: "fix the stale cache", steps: [{ n: 1, type: "implement", goal: "invalidate on write", objects: ["a.js"] }], out_of_scope: [] };

function run(args, o = {}) {
  const out = [];
  const code = cli(["--cwd", dir, ...args], { out: (x) => out.push(x), now: NOW, featureOpts: on, ...o });
  return { code, out: out[0] };
}
const record = (plan = PLAN, extra = [], o = {}) => run(["plan", "record", ...extra], { stdin: JSON.stringify(plan), ...o });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-plan-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "rc-plan-reg-"));
  fs.writeFileSync(path.join(root, "features.json"), JSON.stringify({ features: { "frustrated-mode": { minChannel: "alpha", summary: "t", docs: [], scripts: [] } } }));
  on = { pluginRoot: root, channel: "alpha" };
  off = { pluginRoot: root, channel: "stable" };
});
afterEach(() => {
  for (const d of [dir, root]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

describe("gating", () => {
  test.each(["record", "approve", "status", "clear"])("plan %s exits 126 on stable and touches nothing", (sub) => {
    const r = run(["plan", sub, "--id", "x", "--hash", "12345678"], { featureOpts: off, stdin: JSON.stringify(PLAN) });
    expect(r.code).toBe(126);
    expect(r.out).toEqual({ ok: false, disabled: true, error: "not available" });
    expect(fs.existsSync(plans.planPath(dir))).toBe(false);
  });
  test("library entries are gated too", () => {
    expect(plans.recordPlan(dir, PLAN, {}, { featureOpts: off }).disabled).toBe(true);
    expect(plans.approvePlan(dir, { id: "a", hash: "b" }, {}, { featureOpts: off }).disabled).toBe(true);
    expect(plans.statusPlan(dir, {}, { featureOpts: off }).disabled).toBe(true);
    expect(plans.clearPlan(dir, { featureOpts: off }).disabled).toBe(true);
  });
  test("unregistered feature is closed even on alpha", () => {
    fs.writeFileSync(path.join(root, "features.json"), JSON.stringify({ features: {} }));
    expect(record().code).toBe(126);
  });
});

describe("record", () => {
  test("pending by default, id/hash/version/expiry", () => {
    const r = record();
    expect(r.code).toBe(0);
    expect(r.out.plan).toMatchObject({ version: 1, state: "pending", approvedAt: null });
    expect(r.out.plan.id).toMatch(/^fm-20261025-[a-z0-9]{4}$/);
    expect(r.out.plan.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.out.plan.short).toBe(r.out.plan.hash.slice(0, 8));
    expect(Date.parse(r.out.plan.expiresAt) - NOW).toBe(H2);
  });
  test("hash ignores whitespace and key order, not content", () => {
    const a = plans.hashPlan({ direction: "a  b", steps: [] });
    expect(plans.hashPlan({ steps: [], direction: " a b " })).toBe(a);
    expect(plans.hashPlan({ id: "zz", version: 9, direction: "a b", steps: [] })).toBe(a);
    expect(plans.hashPlan({ direction: "a c", steps: [] })).not.toBe(a);
  });
  test("same id: same content keeps version, changed content bumps it and drops approval", () => {
    const id = record(PLAN, ["--id", "fm-1"]).out.plan;
    expect(record(PLAN, ["--id", "fm-1"]).out.plan.version).toBe(1);
    expect(run(["plan", "approve", "--id", "fm-1", "--hash", id.short]).code).toBe(0);
    expect(record(PLAN, ["--id", "fm-1"]).out.plan.state).toBe("approved");
    const v2 = record({ ...PLAN, direction: "other" }, ["--id", "fm-1"]).out.plan;
    expect(v2).toMatchObject({ version: 2, state: "pending" });
  });
  test.each([
    ["no steps", { direction: "x", steps: [] }],
    ["unknown step type", { direction: "x", steps: [{ type: "banana" }] }],
    ["too big", { direction: "x".repeat(20000), steps: [{ type: "implement" }] }],
  ])("rejects %s", (_n, plan) => {
    const r = record(plan);
    expect(r.code).toBe(1);
    expect(r.out.ok).toBe(false);
  });
  test("invalid JSON is a usage error", () => {
    expect(run(["plan", "record"], { stdin: "{nope" }).code).toBe(1);
  });
});

describe("ship steps (d9)", () => {
  const shipPlan = { direction: "x", steps: [{ type: "implement" }, { type: "ship", goal: "release" }] };
  test.each([[{ type: "ship" }], [{ type: "implement", ship: true }], [{ type: "implement", payload: { ship: true } }], [{ type: "Merge" }]])("rejected without the close-out flag: %j", (step) => {
    const r = record({ direction: "x", steps: [step] });
    expect(r.code).toBe(1);
    expect(r.out.error).toMatch(/ship step/);
    expect(fs.existsSync(plans.planPath(dir))).toBe(false);
  });
  test("accepted from a concept close-out, approvable, never arms a contract", () => {
    const r = record(shipPlan, ["--from-concept-closeout"]);
    expect(r.code).toBe(0);
    expect(r.out.plan.fromConceptCloseout).toBe(true);
    expect(run(["plan", "approve", "--id", r.out.plan.id, "--hash", r.out.plan.hash]).code).toBe(0);
    expect(store.readContract(dir, { now: NOW })).toBeNull();
  });
  test("a hand-edited record with a ship step is not approvable", () => {
    const r = record();
    const rec = JSON.parse(fs.readFileSync(plans.planPath(dir), "utf8"));
    rec.plan.steps.push({ type: "ship" });
    rec.hash = plans.hashPlan(rec.plan);
    rec.short = rec.hash.slice(0, 8);
    fs.writeFileSync(plans.planPath(dir), JSON.stringify(rec));
    const a = run(["plan", "approve", "--id", r.out.plan.id, "--hash", rec.short]);
    expect(a.code).toBe(1);
    expect(a.out.error).toMatch(/close-out/);
  });
});

describe("approve", () => {
  test("records approval for the exact id + hash (short or full)", () => {
    const p = record().out.plan;
    const a = run(["plan", "approve", "--id", p.id, "--hash", p.short]);
    expect(a.code).toBe(0);
    expect(a.out).toMatchObject({ ok: true, approved: true, replaced: null });
    expect(a.out.plan.state).toBe("approved");
    expect(run(["plan", "status"]).out.plan.state).toBe("approved");
  });
  test.each([["wrong id", (p) => ["--id", "fm-nope", "--hash", p.short]], ["wrong hash", (p) => ["--id", p.id, "--hash", "deadbeef"]], ["short hash", (p) => ["--id", p.id, "--hash", p.short.slice(0, 4)]], ["missing hash", (p) => ["--id", p.id]]])("refuses %s", (_n, args) => {
    const p = record().out.plan;
    const a = run(["plan", "approve", ...args(p)]);
    expect(a.code).toBe(1);
    expect(a.out.approved).toBe(false);
    expect(run(["plan", "status"]).out.plan.state).toBe("pending");
  });
  test("refuses an approval of an outdated hash after the plan changed", () => {
    const v1 = record(PLAN, ["--id", "fm-1"]).out.plan;
    record({ ...PLAN, direction: "changed" }, ["--id", "fm-1"]);
    const a = run(["plan", "approve", "--id", "fm-1", "--hash", v1.short]);
    expect(a.code).toBe(1);
    expect(a.out.error).toMatch(/plan changed/);
  });
  test("refuses after 2 h, record is gone (silence is never approval)", () => {
    const p = record().out.plan;
    const a = run(["plan", "approve", "--id", p.id, "--hash", p.short], { now: NOW + H2 });
    expect(a.code).toBe(1);
    expect(a.out.error).toMatch(/expired|no pending/);
    expect(fs.existsSync(plans.planPath(dir))).toBe(false);
  });
  test("refuses a tampered record", () => {
    const p = record().out.plan;
    const rec = JSON.parse(fs.readFileSync(plans.planPath(dir), "utf8"));
    rec.plan.direction = "evil";
    fs.writeFileSync(plans.planPath(dir), JSON.stringify(rec));
    expect(run(["plan", "approve", "--id", p.id, "--hash", p.short]).out.error).toMatch(/altered/);
  });
  test("replaces a running other contract and reports it (d8); status announces it first", () => {
    const c = store.arm(dir, { mode: "prompt", flow: "autonomous", ship: "auto", passes: [] }, { now: NOW });
    const p = record().out.plan;
    expect(run(["plan", "status"]).out.wouldReplace).toMatchObject({ id: c.id, mode: "prompt", flow: "autonomous" });
    const a = run(["plan", "approve", "--id", p.id, "--hash", p.short]);
    expect(a.out.replaced).toMatchObject({ id: c.id });
    expect(store.readContract(dir, { now: NOW })).toBeNull();
  });
  test("a refused approval leaves the running contract alone", () => {
    const c = store.arm(dir, { mode: "prompt" }, { now: NOW });
    const p = record().out.plan;
    run(["plan", "approve", "--id", p.id, "--hash", "deadbeef"]);
    expect(store.readContract(dir, { now: NOW }).id).toBe(c.id);
  });
});

describe("status / clear / expiry", () => {
  test("status inactive, then active, then expired", () => {
    expect(run(["plan", "status"]).out).toMatchObject({ ok: true, active: false, plan: null });
    record();
    expect(run(["plan", "status"]).out).toMatchObject({ active: true, steps: 1 });
    expect(run(["plan", "status"], { now: NOW + H2 - 1 }).out.active).toBe(true);
    expect(run(["plan", "status"], { now: NOW + H2 }).out.active).toBe(false);
  });
  test("clear removes the record", () => {
    record();
    expect(run(["plan", "clear"]).out).toEqual({ ok: true, cleared: true });
    expect(run(["plan", "clear"]).out).toEqual({ ok: true, cleared: false });
  });
  test("the plan expiry is independent of the contract's", () => {
    store.arm(dir, { mode: "prompt" }, { now: NOW });
    record();
    expect(store.readContract(dir, { now: NOW + H2 + 1000 })).not.toBeNull();
    expect(run(["plan", "status"], { now: NOW + H2 + 1000 }).out.active).toBe(false);
  });
  test("unknown subcommand prints the plan usage", () => {
    const r = run(["plan", "bogus"]);
    expect(r.code).toBe(1);
    expect(r.out.error).toMatch(/plan record/);
  });
});
