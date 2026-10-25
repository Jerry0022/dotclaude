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

  test("reply without text (thinking used the whole budget) → rc 65, never an empty rc 0", async () => {
    const body = {
      content: [{ type: "thinking", thinking: "", signature: "sig" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 79677, output_tokens: 8000 },
    };
    const r = await runCli(["review this diff"], { fetchImpl: fakeFetch(200, body) });
    expect(r.rc).toBe(api.RC.NO_TEXT);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/no text in the reply \(stop_reason max_tokens, 8000 output tokens\)/);
    expect(r.err).toMatch(/raise --max-tokens or lower --effort/);
    const log = fs.readFileSync(path.join(home, ".claude", api.USAGE_FILE), "utf8").trim().split("\n");
    expect(JSON.parse(log.at(-1)).rc).toBe(api.RC.NO_TEXT);
  });

  test("text cut at max_tokens → rc 0 with the text and a stderr warning", async () => {
    const body = {
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: "file.js:12 — high — partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 16000 },
    };
    const r = await runCli(["x"], { fetchImpl: fakeFetch(200, body) });
    expect(r.rc).toBe(0);
    expect(r.out).toBe("file.js:12 — high — partial\n");
    expect(r.err).toMatch(/WARNING reply cut at max_tokens/);
  });

  test("default max_tokens leaves room for thinking; --effort lands in output_config", async () => {
    const calls = [];
    await runCli(["x"], { fetchImpl: fakeFetch(200, { content: [{ type: "text", text: "CLEAN" }] }, calls) });
    let sent = JSON.parse(calls[0].init.body);
    expect(sent.max_tokens).toBe(16000);
    expect(sent.output_config).toBeUndefined();
    await runCli(["--effort", "low", "x"], { fetchImpl: fakeFetch(200, { content: [{ type: "text", text: "CLEAN" }] }, calls) });
    sent = JSON.parse(calls[1].init.body);
    expect(sent.output_config).toEqual({ effort: "low" });
    const bad = await runCli(["--effort", "huge", "x"], { fetchImpl: fakeFetch(200, {}, calls) });
    expect(bad.rc).toBe(api.RC.ERROR);
    expect(calls).toHaveLength(2);
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

describe("usage log — what the credit was spent on", () => {
  test("a call is logged with tokens and $, never the prompt or key; --usage sums this month", async () => {
    setConfig({ enabled: true });
    setKeyFile("DEVOPS_ANTHROPIC_API_KEY=sk-test\n");
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 };
    const now = Date.parse("2026-10-19T12:00:00Z");
    await runCli(["secret prompt text"], { now, fetchImpl: fakeFetch(200, { content: [{ type: "text", text: "ok" }], usage }) });
    await runCli(["x"], { now, fetchImpl: fakeFetch(500, { error: { message: "overloaded" } }) });
    const log = fs.readFileSync(path.join(home, ".claude", api.USAGE_FILE), "utf8");
    expect(log).not.toContain("secret prompt");
    expect(log).not.toContain("sk-test");
    const rows = log.trim().split("\n").map((l) => JSON.parse(l));
    expect(rows[0]).toMatchObject({ tool: "safe", tag: "review", project: "proj", in: 1_000_000, out: 100_000, usd: 6, rc: 0 });
    expect(rows[1]).toMatchObject({ rc: 1, usd: 0 });
    const r = await runCli(["--usage"], { now });
    const s = JSON.parse(r.out);
    expect(s).toMatchObject({ since: "2026-10-01", calls: 2, ok: 1, usd: 6 });
    expect(s.byUse.review).toEqual({ calls: 2, ok: 1, usd: 6 });
    expect(JSON.parse((await runCli(["--usage", "--since", "2026-10-20"], { now })).out).calls).toBe(0);
    expect((await runCli(["--usage", "--since", "2026-13-45"], { now })).rc).toBe(api.RC.ERROR);
  });
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

describe("parseEnvFile unescapes double-quoted values (H4)", () => {
  const { quoteValue } = require("./web-guide.js");

  test("\\\" and \\\\ inside double quotes are unescaped", () => {
    const env = api.parseEnvFile('A="a\\"b"\nB="c\\\\d"\nC="e\\\\\\"f"\n');
    expect(env.A).toBe('a"b');
    expect(env.B).toBe("c\\d");
    expect(env.C).toBe('e\\"f');
  });

  test("single-quoted values stay literal", () => {
    expect(api.parseEnvFile("A='a\\\\b\\\"c'\n").A).toBe('a\\\\b\\"c');
  });

  test.each([
    `it's "quoted"`,
    `back\\slash and it's`,
    `trail\\`,
    `mix \\" of 'both' \\\\`,
    `plain-value`,
    `has space`,
  ])("round-trips through web-guide quoteValue: %s", (value) => {
    expect(api.parseEnvFile(`KEY=${quoteValue(value)}\n`).KEY).toBe(value);
  });
});

describe("prices and cost view", () => {
  test("Sonnet cache read is $0.10/MTok", () => {
    expect(api.costOf("claude-sonnet-5-5", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.1, 6);
  });
  test("Haiku prompts over 100k tokens use the higher tier (prompt = input + read + write)", () => {
    expect(api.costOf("claude-haiku-5-5", { input_tokens: 1_000_000 })).toBeCloseTo(0.5, 6);
    const small = { input_tokens: 10_000, output_tokens: 1_000_000 };
    expect(api.costParts("claude-haiku-5-5", small).output).toBeCloseTo(0.5, 6);
    const big = { input_tokens: 10_000, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 20_001, output_tokens: 1_000_000 };
    const p = api.costParts("claude-haiku-5-5", big);
    expect(p.output).toBeCloseTo(2.5, 6);
    expect(p.cacheRead).toBeCloseTo(80_000 * 0.05 / 1e6, 9);
    expect(p.cacheWrite).toBeCloseTo(20_001 * 0.625 / 1e6, 9);
    expect(api.costParts("claude-haiku-5-5", { ...big, cache_creation_input_tokens: 10_000 }).output).toBeCloseTo(0.5, 6);
  });
  test("summed usage of several turns is priced per turn: Haiku's tier is judged per prompt, not on the sum", () => {
    // 4 turns × 50k input = 200k summed; each prompt < 100k → base tier.
    const sum = { input_tokens: 200_000, output_tokens: 4_000 };
    const perTurn = api.costOf("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 1_000 });
    const parts = api.costPartsOfSum("claude-haiku-5-5", sum, 4);
    const total = Object.values(parts).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(4 * perTurn, 9);
    expect(total).toBeLessThan(api.costOf("claude-haiku-5-5", sum));
    expect(api.costPartsOfSum("claude-haiku-5-5", sum, 1)).toEqual(api.costParts("claude-haiku-5-5", sum));
    // An old log line without parts is recomputed the same way by --usage.
    const h = fs.mkdtempSync(path.join(os.tmpdir(), "safe-sum-"));
    fs.mkdirSync(path.join(h, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(h, ".claude", "api-credit-usage.jsonl"),
      JSON.stringify({ ts: "2026-10-20T00:00:00.000Z", tool: "agent", model: "claude-haiku-5-5", in: 200_000, out: 4_000, cacheRead: 0, cacheWrite: 0, usd: 0, rc: 0, turns: 4 }) + "\n");
    const s = api.usageSummary({ home: h, since: "2026-10-01" });
    expect(s.byCostType.input).toBeCloseTo(Math.round(200_000 * 0.1 / 1e6 * 100) / 100, 6);
    fs.rmSync(h, { recursive: true, force: true });
  });
  test("--usage adds $ per cost type, top 3 calls, >10M cache-read warning and context-editing totals", async () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const log = (o) => api.logUsage({ home, now, tool: "agent", tag: "scout", cwd: "/x/proj", rc: 0, ...o });
    const big = { input_tokens: 0, cache_read_input_tokens: 11_000_000, cache_creation_input_tokens: 1_000_000, output_tokens: 100_000 };
    log({ model: "claude-opus-5-5", usage: big, usd: api.costOf("claude-opus-5-5", big), ctx: { clears: 2, clearedTokens: 130000 } });
    for (const n of [1, 2, 3]) log({ model: "claude-sonnet-5-5", usage: { input_tokens: n * 1000 }, usd: n * 0.002 });
    const r = await runCli(["--usage"], { now });
    const s = JSON.parse(r.out);
    expect(s.calls).toBe(4);
    expect(s.byCostType.cacheRead).toBeCloseTo(2.2, 2);
    expect(s.byCostType.cacheWrite).toBeCloseTo(5, 2);
    expect(s.byCostType.output).toBeCloseTo(2, 2);
    expect(Object.keys(s.byCostType)).toEqual(["input", "cacheWrite", "cacheRead", "output", "webSearch"]);
    expect(s.topCalls).toHaveLength(3);
    expect(s.topCalls[0]).toMatchObject({ tag: "scout", project: "proj" });
    expect(s.topCalls[0].usd).toBeGreaterThanOrEqual(s.topCalls[1].usd);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toMatch(/11\.0 M cache tokens/);
    expect(r.err).toMatch(/WARNING/);
    expect(s.contextEditing).toEqual({ clears: 2, clearedTokens: 130000 });
    expect(s.byUse.scout.calls).toBe(4);
  });
});
