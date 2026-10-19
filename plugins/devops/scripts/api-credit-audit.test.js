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

test("parseArgs keeps the defaults", () => {
  expect(audit.parseArgs([])).toEqual({ root: null, maxUsd: 5, model: null, focus: null });
});
