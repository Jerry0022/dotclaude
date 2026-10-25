import { test, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const batch = require("./claude-api-batch.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-api-batch-"));
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const reqs = ["a", "b", "c"].map((id) => ({ custom_id: id, params: { model: "claude-opus-5-5", max_tokens: 10, messages: [] } }));
const usage = { input_tokens: 1000, output_tokens: 100 };
const jsonl = (ids) => ids.map((id) => JSON.stringify({ custom_id: id, result: { type: "succeeded", message: { model: "claude-opus-5-5", content: [{ type: "text", text: `res-${id}` }], usage } } })).join("\n");
const res = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

function opts(home, fetchImpl, extra = {}) {
  let t = 0;
  return { key: "sk-test", home, cwd: home, fetchImpl, featureOpts: { channel: "alpha" }, sleep: async (ms) => { t += ms; }, now: () => t, firstPollMs: 1000, ...extra };
}
const readLog = (home) => fs.readFileSync(path.join(home, ".claude", "api-credit-usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("happy path: submit, poll until ended, collect, one batch usage line at 50 %", async () => {
  const home = path.join(tmp, "h1");
  let polls = 0;
  const fetchImpl = async (url, init) => {
    if (init.method === "POST") return res({ id: "msgbatch_1" });
    if (url.endsWith("/results")) return res(jsonl(["a", "b", "c"]));
    polls++;
    return res({ processing_status: polls < 3 ? "in_progress" : "ended", results_url: `${batch.BASE_URL}/msgbatch_1/results` });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl));
  expect(r.unfinished).toEqual([]);
  expect(r.done.map((d) => d.text)).toEqual(["res-a", "res-b", "res-c"]);
  const [line] = readLog(home);
  expect(line).toMatchObject({ tool: "batch", batch: true, done: 3, unfinished: 0 });
  expect(line.usd).toBeCloseTo(line.savingUsd, 6);
  expect(line.usd).toBeGreaterThan(0);
});

test("deadline: cancels, salvages finished results, rest unfinished", async () => {
  const home = path.join(tmp, "h2");
  let canceled = false;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/cancel")) { canceled = true; return res({}); }
    if (init.method === "POST") return res({ id: "msgbatch_2" });
    if (url.endsWith("/results")) return res(jsonl(["a"]));
    return res(canceled ? { processing_status: "ended", results_url: `${batch.BASE_URL}/msgbatch_2/results` } : { processing_status: "in_progress" });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl, { deadlineMs: 5000 }));
  expect(canceled).toBe(true);
  expect(r.done.map((d) => d.custom_id)).toEqual(["a"]);
  expect(r.unfinished).toEqual(["b", "c"]);
});

test("deadline: waits through `canceling` until `ended` — billed results are salvaged, never re-run", async () => {
  const home = path.join(tmp, "h2b");
  let canceled = false;
  let pollsAfterCancel = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/cancel")) { canceled = true; return res({}); }
    if (init.method === "POST") return res({ id: "msgbatch_2b" });
    if (url.endsWith("/results")) return res(jsonl(["a", "b"]));
    if (!canceled) return res({ processing_status: "in_progress" });
    pollsAfterCancel++;
    return res(pollsAfterCancel < 3 ? { processing_status: "canceling" } : { processing_status: "ended", results_url: `${batch.BASE_URL}/msgbatch_2b/results` });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl, { deadlineMs: 5000 }));
  expect(pollsAfterCancel).toBe(3);
  expect(r.done.map((d) => d.custom_id)).toEqual(["a", "b"]);
  expect(r.unfinished).toEqual(["c"]);
});

test("deadline: a batch that never ends within the drain window → all unfinished, bounded", async () => {
  const home = path.join(tmp, "h2c");
  let canceled = false;
  let polls = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/cancel")) { canceled = true; return res({}); }
    if (init.method === "POST") return res({ id: "msgbatch_2c" });
    polls++;
    return res({ processing_status: canceled ? "canceling" : "in_progress" });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl, { deadlineMs: 5000 }));
  expect(r.unfinished).toEqual(["a", "b", "c"]);
  expect(polls).toBeLessThan(40);
});

test("poll failures: cancel, then salvage what ended — no request with a result goes back", async () => {
  const home = path.join(tmp, "h2d");
  let canceled = false;
  const fetchImpl = async (url, init) => {
    if (url.endsWith("/cancel")) { canceled = true; return res({}); }
    if (init.method === "POST") return res({ id: "msgbatch_2d" });
    if (url.endsWith("/results")) return res(jsonl(["b"]));
    if (!canceled) return res({ error: { message: "flaky" } }, false, 503);
    return res({ processing_status: "ended", results_url: `${batch.BASE_URL}/msgbatch_2d/results` });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl));
  expect(canceled).toBe(true);
  expect(r.done.map((d) => d.custom_id)).toEqual(["b"]);
  expect(r.unfinished).toEqual(["a", "c"]);
});

test("results_url on a foreign host never receives the API key — the default results path is used", async () => {
  const home = path.join(tmp, "h2e");
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, key: init.headers["x-api-key"] });
    if (init.method === "POST") return res({ id: "msgbatch_2e" });
    if (url.endsWith("/results")) return res(jsonl(["a", "b", "c"]));
    return res({ processing_status: "ended", results_url: "https://evil.example.com/steal/results" });
  };
  const r = await batch.runBatch(reqs, opts(home, fetchImpl));
  expect(r.unfinished).toEqual([]);
  expect(seen.some((s) => s.url.includes("evil.example.com"))).toBe(false);
  expect(seen.every((s) => new URL(s.url).hostname === "api.anthropic.com")).toBe(true);
  expect(batch.trustedResultsUrl("http://api.anthropic.com/x")).toBe(null);
  expect(batch.trustedResultsUrl("https://api.anthropic.com.evil.io/x")).toBe(null);
  expect(batch.trustedResultsUrl(`${batch.BASE_URL}/id/results`)).toBe(`${batch.BASE_URL}/id/results`);
});

test("mixed-model batch: parts priced per request with its own model, Haiku tier per prompt", async () => {
  const home = path.join(tmp, "h2f");
  const big = { input_tokens: 60000, output_tokens: 1000 }; // two of these sum to >100k, each is <100k
  const rows = [
    { custom_id: "a", result: { type: "succeeded", message: { model: "claude-haiku-5-5", content: [{ type: "text", text: "x" }], usage: big } } },
    { custom_id: "b", result: { type: "succeeded", message: { model: "claude-haiku-5-5", content: [{ type: "text", text: "y" }], usage: big } } },
    { custom_id: "c", result: { type: "succeeded", message: { model: "claude-opus-5-5", content: [{ type: "text", text: "z" }], usage } } },
  ].map((o) => JSON.stringify(o)).join("\n");
  const fetchImpl = async (url, init) => {
    if (init.method === "POST") return res({ id: "msgbatch_2f" });
    if (url.endsWith("/results")) return res(rows);
    return res({ processing_status: "ended", results_url: `${batch.BASE_URL}/msgbatch_2f/results` });
  };
  await batch.runBatch(reqs, opts(home, fetchImpl));
  const [line] = readLog(home);
  const safe = require("./claude-api-safe.js");
  const normal = 2 * safe.costOf("claude-haiku-5-5", big) + safe.costOf("claude-opus-5-5", usage);
  expect(line.model).toBe("mixed");
  expect(line.usd).toBeCloseTo(normal / 2, 6);
  const partsSum = Object.values(line.parts).reduce((s, v) => s + v, 0);
  expect(partsSum).toBeCloseTo(line.usd, 5);
});

test("any API error → everything unfinished, no throw", async () => {
  const home = path.join(tmp, "h3");
  const bad = await batch.runBatch(reqs, opts(home, async () => res({ error: { message: "boom" } }, false, 500)));
  expect(bad.done).toEqual([]);
  expect(bad.unfinished).toEqual(["a", "b", "c"]);
  const thrown = await batch.runBatch(reqs, opts(home, async () => { throw new Error("network down"); }));
  expect(thrown.unfinished).toEqual(["a", "b", "c"]);
});

test("credit-limit error on submit stores the rc-75 marker", async () => {
  const home = path.join(tmp, "h4");
  const r = await batch.runBatch(reqs, opts(home, async () => res({ error: { message: "Your credit balance is too low" } }, false, 400)));
  expect(r.unfinished.length).toBe(3);
  expect(require("./claude-api-safe.js").activeLimit({ home })).toBeTruthy();
});

test("flag off → nothing is fetched, all unfinished; CLI exits 126", async () => {
  let fetched = 0;
  const r = await batch.runBatch(reqs, opts(path.join(tmp, "h5"), async () => { fetched++; return res({}); }, { featureOpts: { channel: "stable" } }));
  expect(fetched).toBe(0);
  expect(r.unfinished).toEqual(["a", "b", "c"]);
  expect((await batch.submit(reqs, { key: "k", featureOpts: { channel: "stable" }, fetchImpl: async () => { fetched++; return res({}); } })).ok).toBe(false);
  expect(fetched).toBe(0);
  const cli = spawnSync(process.execPath, [path.join(__dirname, "claude-api-batch.js"), "x.json"], { encoding: "utf8", env: { ...process.env, HOME: tmp, USERPROFILE: tmp } });
  expect(cli.status).toBe(126);
});
