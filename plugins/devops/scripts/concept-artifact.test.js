import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { wrap, stripWrapper, run, START, END, WRAPPER_JS } from "./concept-artifact.js";

// #589: the artifact copy of a concept page. The engine bytes stay untouched,
// only POST/GET /decisions move to the artifact's db, and nothing changes
// where no artifact runtime exists.

const PAGE = '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body><script>/* engine */</script></body>\n</html>\n';

/** Run the wrapper in a fake window; returns the patched fetch and the calls. */
function sandbox({ claude, db } = {}) {
  const calls = [];
  const realFetch = (input, init) => {
    calls.push({ input, init });
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  const store = new Map();
  const fakeDb = db === undefined ? {
    doc: (p) => ({
      set: async (data) => { store.set(p, data); },
      get: async () => ({ exists: store.has(p), data: () => store.get(p) }),
    }),
  } : db;
  const window = { fetch: realFetch };
  if (claude !== false) window.claude = { use: async (name) => (name === "db" ? fakeDb : null) };
  const ctx = { window, location: { href: "https://example.claude.ai/a/x" }, Response, URL, Promise, JSON, Date, TypeError, String };
  vm.runInNewContext(WRAPPER_JS, ctx);
  return { fetch: window.fetch, realFetch, calls, store };
}

describe("wrap — engine bytes unchanged", () => {
  test("inserts one block right after <head> and nothing else", () => {
    const res = wrap(PAGE);
    expect(res.ok).toBe(true);
    expect(res.html.indexOf(START)).toBe(PAGE.indexOf("<head>") + "<head>".length);
    expect(stripWrapper(res.html)).toBe(PAGE);
  });

  test("a re-run replaces the wrapper instead of stacking it", () => {
    const twice = wrap(wrap(PAGE).html).html;
    expect(twice.split(START).length - 1).toBe(1);
    expect(twice.split(END).length - 1).toBe(1);
    expect(stripWrapper(twice)).toBe(PAGE);
  });

  test("falls back to <html> and refuses a page without either", () => {
    expect(wrap("<html><body></body></html>").ok).toBe(true);
    expect(wrap("<body>x</body>")).toEqual({ ok: false, reason: "no-head" });
  });
});

describe("wrapper runtime", () => {
  test("no window.claude → fetch is left untouched (local bridge path)", () => {
    const s = sandbox({ claude: false });
    expect(s.fetch).toBe(s.realFetch);
  });

  test("POST /decisions is stored in the db and acked durable", async () => {
    const s = sandbox();
    const res = await s.fetch("/decisions", { method: "POST", body: JSON.stringify({ submitted: true, action: "iterate" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ durable: true });
    expect(s.store.get("concept/decisions")).toMatchObject({ submitted: true, action: "iterate" });
    expect(s.calls).toHaveLength(0);
  });

  test("GET /decisions reads the stored doc back; empty object before any submit", async () => {
    const s = sandbox();
    expect(await (await s.fetch("/decisions", { cache: "no-store" })).json()).toEqual({});
    await s.fetch("/decisions", { method: "POST", body: '{"submitted":true}' });
    expect(await (await s.fetch("/decisions")).json()).toMatchObject({ submitted: true });
  });

  test("no db namespace → POST 507 (engine keeps -pending), GET rejects like an unreachable bridge", async () => {
    const s = sandbox({ db: null });
    const res = await s.fetch("/decisions", { method: "POST", body: "{}" });
    expect(res.status).toBe(507);
    expect((await res.json()).durable).toBe(false);
    await expect(s.fetch("/decisions")).rejects.toThrow(/no artifact db/);
  });

  test("a refused write answers 507, never a durable ack", async () => {
    const s = sandbox({ db: { doc: () => ({ set: () => Promise.reject({ code: "not_granted" }) }) } });
    const res = await s.fetch("/decisions", { method: "POST", body: "{}" });
    expect(res.status).toBe(507);
    expect(await res.json()).toEqual({ durable: false, reason: "not_granted" });
  });

  test("every other endpoint goes to the real fetch (heartbeat stays not connected)", async () => {
    const s = sandbox();
    await s.fetch("/heartbeat");
    await s.fetch("/status", { method: "POST", body: "{}" });
    await s.fetch("/decisions-old");
    expect(s.calls.map((c) => c.input)).toEqual(["/heartbeat", "/status", "/decisions-old"]);
  });
});

describe("run — CLI", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "concept-artifact-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("writes <name>.artifact.html next to the source and names the read-back", () => {
    const src = path.join(dir, "2026-09-28-x.html");
    fs.writeFileSync(src, PAGE);
    const res = run({ artifact: src });
    expect(res.ok).toBe(true);
    expect(res.out).toBe(path.join(dir, "2026-09-28-x.artifact.html"));
    expect(stripWrapper(fs.readFileSync(res.out, "utf8"))).toBe(PAGE);
    expect(fs.readFileSync(src, "utf8")).toBe(PAGE);
    expect(res.capabilities).toEqual({ db: {} });
    expect(res.readBack).toEqual({ tool: "ArtifactData", action: "get", collection: "concept", doc_id: "decisions" });
  });

  test("missing or unreadable input is an error, not a silent no-op", () => {
    expect(run({}).ok).toBe(false);
    expect(run({ artifact: path.join(dir, "nope.html") }).reason).toBe("unreadable");
  });
});
