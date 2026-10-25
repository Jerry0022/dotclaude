import { test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const policy = require("./batch-policy.js");
const safe = require("./claude-api-safe.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "batch-policy-"));
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

function mkHome(name, { enabled = true, key = true } = {}) {
  const home = path.join(tmp, name);
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "devops-config.json"), JSON.stringify({ apiCredit: { enabled } }));
  if (key) fs.writeFileSync(path.join(home, ".claude", "devops-api.env"), "DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
  return home;
}

// 2M input + 200k output on opus = ~$12 normal, ~$6 saving.
const good = { requests: 8, estInputTokens: 2e6, estOutputTokens: 2e5, unattended: true };
const ctx = (home, extra = {}) => ({ home, env: {}, featureOpts: { channel: "alpha" }, ...extra });

test("all rules true → batch with estimates", () => {
  const d = policy.decide(good, ctx(mkHome("ok")));
  expect(d.useBatch).toBe(true);
  expect(d.estSavingUsd).toBeGreaterThan(1);
});

test("R1 flag off (stable channel)", () => {
  const d = policy.decide(good, ctx(mkHome("r1"), { featureOpts: { channel: "stable" } }));
  expect(d.useBatch).toBe(false);
  expect(d.reason).toMatch(/^R1/);
});

test("R2 each credit precondition rejects", () => {
  expect(policy.decide(good, ctx(mkHome("r2a", { enabled: false }))).reason).toMatch(/^R2/);
  expect(policy.decide(good, ctx(mkHome("r2b", { key: false }))).reason).toMatch(/^R2 no API key/);
  const h = mkHome("r2c");
  safe.storeLimit({ home: h });
  expect(policy.decide(good, ctx(h)).reason).toMatch(/^R2 API credit limit/);
  expect(policy.decide({ ...good, monthBudgetUsd: 2 }, ctx(mkHome("r2d"))).reason).toMatch(/^R2 month budget/);
});

test("R2 per-run cap: an estimate above maxUsd takes the normal path", () => {
  const d = policy.decide({ ...good, maxUsd: 1 }, ctx(mkHome("r2e")));
  expect(d.useBatch).toBe(false);
  expect(d.reason).toMatch(/^R2 estimated .* per-run cap/);
  expect(policy.decide({ ...good, maxUsd: 100 }, ctx(mkHome("r2f"))).useBatch).toBe(true);
  expect(policy.parseArgs(["--max-usd", "3"]).maxUsd).toBe(3);
});

test("estimate is priced per request: Haiku's >100k tier never hits a job of small prompts", () => {
  // 10 requests × 50k input = 500k total; per prompt < 100k → base Haiku price.
  const job = { ...good, model: "claude-haiku-5-5", requests: 10, estInputTokens: 5e5, estOutputTokens: 1e4 };
  const d = policy.decide(job, ctx(mkHome("tier")));
  const perReq = safe.costOf("claude-haiku-5-5", { input_tokens: 5e4, output_tokens: 1e3 });
  expect(d.estUsd).toBeCloseTo(Math.round(perReq * 10 / 2 * 100) / 100, 6);
  expect(d.estUsd).toBeLessThan(Math.round(safe.costOf("claude-haiku-5-5", { input_tokens: 5e5, output_tokens: 1e4 }) / 2 * 100) / 100);
});

test("R3 interactive caller", () => {
  expect(policy.decide({ ...good, unattended: false }, ctx(mkHome("r3"))).reason).toMatch(/^R3/);
});

test("R4 too few requests, or too little saving", () => {
  expect(policy.decide({ ...good, requests: 4 }, ctx(mkHome("r4a"))).reason).toMatch(/^R4/);
  expect(policy.decide({ ...good, estInputTokens: 1e5, estOutputTokens: 1e4 }, ctx(mkHome("r4b"))).reason).toMatch(/^R4 estimated saving/);
});

test("R5 deadline too short", () => {
  expect(policy.decide({ ...good, deadlineMs: 10 * 60e3 }, ctx(mkHome("r5"))).reason).toMatch(/^R5/);
});

test("CLI: flag off → exit 126 without output; main maps no → 3, yes → 0", () => {
  const cli = spawnSync(process.execPath, [path.join(__dirname, "batch-policy.js"), "--requests", "9"], { encoding: "utf8", env: { ...process.env, HOME: tmp, USERPROFILE: tmp } });
  expect(cli.status).toBe(126);
  expect(cli.stdout).toBe("");
  const out = [];
  const argv = ["--requests", "8", "--est-input-tokens", "2000000", "--est-output-tokens", "200000", "--unattended"];
  expect(policy.main(argv, { out: (s) => out.push(s), ctx: ctx(mkHome("cli")) })).toBe(0);
  expect(policy.main(argv.slice(0, -1), { out: () => {}, ctx: ctx(mkHome("cli2")) })).toBe(3);
});
