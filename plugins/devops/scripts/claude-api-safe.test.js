import { describe, test, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// Opt-in offload of advisory prompts onto the Max/Team monthly API credit.
// The wrapper must never call the network while the switch is off, never
// read ANTHROPIC_API_KEY, map an empty balance to rc 75 (remembered), and
// keep the codex-safe exit-code contract so callers can share one rc table.

const require = createRequire(import.meta.url);
const api = require("./claude-api-safe.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-api-safe-"));
const home = path.join(root, "home");
const cwd = path.join(root, "proj");
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });

function setConfig(apiCredit) {
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "devops-config.json"), JSON.stringify({ apiCredit }));
}
function setKeyFile(line) {
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", api.ENV_FILE), line);
}
function fakeFetch(status, body, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}
async function runCli(argv, extra = {}) {
  const outBuf = [];
  const errBuf = [];
  const rc = await api.run(argv, {
    env: {}, home, cwd, out: (s) => outBuf.push(s), err: (s) => errBuf.push(s), ...extra,
  });
  return { rc, out: outBuf.join(""), err: errBuf.join("") };
}

beforeEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
});

describe("switch and key gates", () => {
  test("off by default → rc 126 and no network call", async () => {
    const calls = [];
    const r = await runCli(["hi"], { fetchImpl: fakeFetch(200, {}, calls) });
    expect(r.rc).toBe(api.RC.DISABLED);
    expect(calls).toHaveLength(0);
  });

  test("DEVOPS_DISABLE_CLAUDE_API=1 wins over an enabled config", async () => {
    setConfig({ enabled: true });
    setKeyFile("DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
    const r = await runCli(["hi"], { env: { DEVOPS_DISABLE_CLAUDE_API: "1" }, fetchImpl: fakeFetch(200, {}) });
    expect(r.rc).toBe(api.RC.DISABLED);
  });

  test("enabled without key → rc 127, names the guide only when webGuide is on", async () => {
    setConfig({ enabled: true });
    let r = await runCli(["hi"]);
    expect(r.rc).toBe(api.RC.NO_KEY);
    expect(r.err).not.toMatch(/web guide/);
    setConfig({ enabled: true, webGuide: true });
    r = await runCli(["hi"]);
    expect(r.rc).toBe(api.RC.NO_KEY);
    expect(r.err).toMatch(/web guide/);
  });

  test("ANTHROPIC_API_KEY is never used as the key", () => {
    expect(api.resolveKey({ env: { ANTHROPIC_API_KEY: "sk-session" }, home })).toBeNull();
  });

  test("key from env beats the file; quotes in the file are stripped", () => {
    setKeyFile('DEVOPS_ANTHROPIC_API_KEY="sk-file"\n');
    expect(api.resolveKey({ env: {}, home })).toEqual({ key: "sk-file", source: "file" });
    expect(api.resolveKey({ env: { DEVOPS_ANTHROPIC_API_KEY: "sk-env" }, home })).toEqual({ key: "sk-env", source: "env" });
  });
});

describe("API call", () => {
  beforeEach(() => {
    setConfig({ enabled: true });
    setKeyFile("DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
  });

  test("success → rc 0, text on stdout, key only in the x-api-key header", async () => {
    const calls = [];
    const r = await runCli(["review this"], {
      fetchImpl: fakeFetch(200, { content: [{ type: "text", text: "LGTM" }], usage: { input_tokens: 3, output_tokens: 1 } }, calls),
    });
    expect(r.rc).toBe(0);
    expect(r.out).toBe("LGTM\n");
    expect(calls[0].init.headers["x-api-key"]).toBe("sk-test");
    expect(calls[0].init.body).not.toContain("sk-test");
    expect(JSON.parse(calls[0].init.body).model).toBe(api.DEFAULT_MODEL);
    expect(r.err).toMatch(/3 in \/ 1 out tokens/);
  });

  test("credit balance too low → rc 75, stored; next call skips without network", async () => {
    const body = { error: { message: "Your credit balance is too low to access the Anthropic API." } };
    let r = await runCli(["x"], { fetchImpl: fakeFetch(400, body) });
    expect(r.rc).toBe(api.RC.LIMIT);
    const calls = [];
    r = await runCli(["x"], { fetchImpl: fakeFetch(200, {}, calls) });
    expect(r.rc).toBe(api.RC.LIMIT);
    expect(calls).toHaveLength(0);
    await runCli(["--reset-limit"]);
    expect(api.activeLimit({ home })).toBeNull();
  });

  test("workspace spend limit → rc 75", async () => {
    const body = { error: { message: "You have reached your specified workspace API usage limits." } };
    const r = await runCli(["x"], { fetchImpl: fakeFetch(400, body) });
    expect(r.rc).toBe(api.RC.LIMIT);
  });

  test("expired limit marker is dropped", () => {
    api.storeLimit({ home, now: Date.now() - 13 * 3600 * 1000 });
    expect(api.activeLimit({ home })).toBeNull();
  });

  test("invalid key → rc 1, nothing stored", async () => {
    const r = await runCli(["x"], { fetchImpl: fakeFetch(401, { error: { message: "invalid x-api-key" } }) });
    expect(r.rc).toBe(api.RC.ERROR);
    expect(r.err).toMatch(/invalid API key/);
    expect(api.activeLimit({ home })).toBeNull();
  });

  test("timeout → rc 124", async () => {
    const hang = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
    const r = await runCli(["x"], { env: { CLAUDE_API_SAFE_TIMEOUT: "0.05" }, fetchImpl: hang });
    expect(r.rc).toBe(api.RC.TIMEOUT);
  });

  test("prompt from stdin with -", async () => {
    const calls = [];
    const r = await runCli(["-"], {
      readStdin: () => "from stdin",
      fetchImpl: fakeFetch(200, { content: [{ type: "text", text: "ok" }] }, calls),
    });
    expect(r.rc).toBe(0);
    expect(JSON.parse(calls[0].init.body).messages[0].content).toBe("from stdin");
  });
});

test("--status reports switches and key presence, never the key", async () => {
  setConfig({ enabled: true, webGuide: true });
  setKeyFile("DEVOPS_ANTHROPIC_API_KEY=sk-secret-value\n");
  const r = await runCli(["--status"]);
  expect(r.rc).toBe(0);
  expect(r.out).not.toContain("sk-secret-value");
  const s = JSON.parse(r.out);
  expect(s).toMatchObject({ enabled: true, webGuide: true, keyPresent: true, keySource: "file", limitUntil: null });
});

describe("sessionLine — the SessionStart [api-credit] line", () => {
  test("off → no line at all", () => {
    expect(api.sessionLine({ pluginRoot: "/p", cwd, home, env: {} })).toBeNull();
  });
  test("on without key → names the missing key and the guide", () => {
    setConfig({ enabled: true, webGuide: true });
    expect(api.sessionLine({ pluginRoot: "/p", cwd, home, env: {} })).toMatch(/no key stored.*web guide/);
  });
  test("on with key → credit-first route with the agent script path", () => {
    setConfig({ enabled: true });
    setKeyFile("DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
    const line = api.sessionLine({ pluginRoot: "C:\\p", cwd, home, env: {} });
    expect(line).toMatch(/API credit FIRST/);
    expect(line).toContain("{PLUGIN_ROOT}/scripts/claude-api-agent.js");
    expect(line).not.toContain("sk-test");
  });
});
