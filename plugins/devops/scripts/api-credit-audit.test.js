import { test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// The month-end audit is a thin wrapper over claude-api-agent: it must pass
// its budget and the read-only task through, write the report only on rc 0,
// and hand any other rc back unchanged (the caller's fallback contract).

const require = createRequire(import.meta.url);
const audit = require("./api-credit-audit.js");
const safe = require("./claude-api-safe.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "api-credit-audit-"));
const home = path.join(tmp, "home");
const proj = path.join(tmp, "myrepo");
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
fs.mkdirSync(proj, { recursive: true });

function enable() {
  fs.writeFileSync(path.join(home, ".claude", "devops-config.json"), JSON.stringify({ apiCredit: { enabled: true } }));
  fs.writeFileSync(path.join(home, ".claude", "devops-api.env"), "DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
}

test("switch off → the agent's rc 126, no report written", async () => {
  const rc = await audit.run([], { env: {}, home, cwd: proj, err: () => {}, out: () => {} });
  expect(rc).toBe(safe.RC.DISABLED);
  expect(fs.existsSync(path.join(home, ".claude", "devops-audits"))).toBe(false);
});

test("success → report under ~/.claude/devops-audits/<repo>-<day>.md; budget and focus reach the request", async () => {
  enable();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "- high · a.js:1 · bug" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }) };
  };
  const out = [];
  const rc = await audit.run(["--focus", "auth", "--max-usd", "3"], {
    env: {}, home, cwd: proj, now: Date.parse("2026-10-31T12:00:00Z"), fetchImpl, err: () => {}, out: (s) => out.push(s),
  });
  expect(rc).toBe(0);
  const file = path.join(home, ".claude", "devops-audits", "myrepo-2026-10-31.md");
  expect(fs.readFileSync(file, "utf8")).toContain("- high · a.js:1 · bug");
  expect(out.join("")).toContain(file);
  expect(JSON.stringify(calls[0].messages[0].content)).toMatch(/Focus especially on: auth/);
});

test("--batch with useBatch false (flag off) runs the normal agent audit and says why on stderr", async () => {
  enable();
  fs.writeFileSync(path.join(proj, "a.js"), "console.log(1)\n");
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "- low · a.js:1 · x" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }) };
  };
  const errs = [];
  const rc = await audit.run(["--batch"], {
    env: {}, home, cwd: proj, now: Date.parse("2026-11-01T12:00:00Z"), fetchImpl, featureOpts: { channel: "stable" }, err: (s) => errs.push(s), out: () => {},
  });
  expect(rc).toBe(0);
  expect(errs.join("")).toMatch(/batch skipped \(R1/);
  expect(calls.every((u) => !u.includes("/batches"))).toBe(true);
  expect(fs.readFileSync(path.join(home, ".claude", "devops-audits", "myrepo-2026-11-01.md"), "utf8")).toContain("a.js:1");
});

test("buildPacks skips secret-shaped files and groups by top-level dir", () => {
  const r = path.join(tmp, "packrepo");
  fs.mkdirSync(path.join(r, "src"), { recursive: true });
  fs.writeFileSync(path.join(r, "src", "x.js"), "x");
  fs.writeFileSync(path.join(r, ".env"), "SECRET=1");
  fs.writeFileSync(path.join(r, "top.js"), "t");
  const packs = audit.buildPacks(r);
  expect(packs.map((p) => p.name).sort()).toEqual(["(root)", "src"]);
  expect(packs.flatMap((p) => p.files)).not.toContain(".env");
  expect(JSON.stringify(audit.packRequest(packs[0], "m", null).params.system)).toContain('"ttl":"1h"');
});

test("--batch with all rules true: packs go through the batch, no agent loop", async () => {
  enable();
  const r = path.join(tmp, "bigrepo");
  fs.mkdirSync(path.join(r, "src"), { recursive: true });
  fs.writeFileSync(path.join(r, "src", "x.js"), "x");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    const j = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => b });
    if (init.method === "POST") return j({ id: "b1" });
    if (url.endsWith("/results")) return j(JSON.stringify({ custom_id: "pack-1", result: { type: "succeeded", message: { model: "m", content: [{ type: "text", text: "- high · src/x.js:1 · batch finding" }], usage: { input_tokens: 5, output_tokens: 5 } } } }));
    return j({ processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/b1/results" });
  };
  // One tiny pack never passes R4: open the policy through a stubbed decide.
  const policy = require("./batch-policy.js");
  const orig = policy.decide;
  policy.decide = () => ({ useBatch: true, reason: "test", estUsd: 5, estSavingUsd: 5 });
  try {
    const rc = await audit.run(["--batch", "--root", r], {
      env: {}, home, cwd: proj, now: Date.parse("2026-11-02T12:00:00Z"), fetchImpl, featureOpts: { channel: "alpha" }, err: () => {}, out: () => {},
      batchOpts: { sleep: async () => {}, firstPollMs: 1 },
    });
    expect(rc).toBe(0);
  } finally { policy.decide = orig; }
  expect(calls.some((c) => c.endsWith("/v1/messages"))).toBe(false);
  expect(fs.readFileSync(path.join(home, ".claude", "devops-audits", "bigrepo-2026-11-02.md"), "utf8")).toContain("batch finding");
});

test("parseArgs keeps the defaults", () => {
  expect(audit.parseArgs([])).toEqual({ root: null, maxUsd: 5, model: null, focus: null, batch: false });
});
