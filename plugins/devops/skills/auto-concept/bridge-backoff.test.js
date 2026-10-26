import { describe, test, expect } from "vitest";
import vm from "node:vm";
import { readTemplates } from "./templates-source.js";

// A built page served without a bridge (plain static server) used to fire
// hundreds of requests in minutes: every poll loop retried at its fixed 3-5 s
// cadence on 404 / refused connections. Each loop now backs off 5 -> 10 -> 20
// -> ... capped at 60 s and returns to its cadence on the first success.

const md = readTemplates();

function fn(name) {
  const start = md.indexOf(`function ${name}(`);
  expect(start, `function ${name}`).toBeGreaterThan(-1);
  const end = md.indexOf("\n}\n", start);
  return md.slice(start, end + 3);
}
function asyncFn(name) {
  const start = md.indexOf(`async function ${name}(`);
  expect(start, `async function ${name}`).toBeGreaterThan(-1);
  return md.slice(start, md.indexOf("\n}\n", start) + 3);
}

function sandbox(fetchImpl) {
  const calls = [];
  const ctx = {
    calls, Date, Math, Promise, Error,
    fetch: (u) => { calls.push(u); return fetchImpl(u); },
    _tabQuery: "?tab=t", _everPolled: false, _lastSampleAt: 0, _pollInFlight: null,
    applyHeartbeat: () => { ctx._everPolled = true; },
    sessionStorage: { setItem() {} }, location: { reload() {} },
    _bootReloadCounter: null,
  };
  vm.createContext(ctx);
  vm.runInContext(
    fn("makeBackoff") +
      "const _hbBackoff = makeBackoff(5000), _reloadBackoff = makeBackoff(5000);" +
      fn("pollHeartbeat") + asyncFn("pollReload"),
    ctx,
  );
  return ctx;
}

describe("bridge back-off", () => {
  test("delay doubles from 5 s, caps at 60 s and resets on success", () => {
    const ctx = sandbox(() => Promise.reject(new Error("x")));
    const bo = vm.runInContext("makeBackoff(5000)", ctx);
    expect(bo.delay()).toBe(5000);
    const seen = [];
    for (let i = 0; i < 8; i++) { bo.fail(0); seen.push(bo.delay()); }
    expect(seen).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000, 60000]);
    bo.ok();
    expect(bo.delay()).toBe(5000);
    expect(bo.due(0)).toBe(true);
  });

  test("a heartbeat poll that 404s is not retried before the back-off elapses", async () => {
    const ctx = sandbox(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("html")) }));
    await ctx.pollHeartbeat();
    expect(ctx.calls.length).toBe(1);
    for (let i = 0; i < 20; i++) await ctx.pollHeartbeat();   // 20 ticks inside the wait
    expect(ctx.calls.length).toBe(1);
    expect(vm.runInContext("_hbBackoff.fails()", ctx)).toBe(1);
    expect(vm.runInContext("_hbBackoff.delay()", ctx)).toBe(5000);
    await ctx.pollHeartbeat(true);                              // forced (load / tab visible)
    expect(ctx.calls.length).toBe(2);
    expect(vm.runInContext("_hbBackoff.delay()", ctx)).toBe(10000);
  });

  test("the first success restores the normal cadence and feeds applyHeartbeat", async () => {
    let up = false;
    const ctx = sandbox(() => up
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ claude_ts: 1 }) })
      : Promise.reject(new Error("refused")));
    await ctx.pollHeartbeat(true);
    await ctx.pollHeartbeat(true);
    expect(vm.runInContext("_hbBackoff.fails()", ctx)).toBe(2);
    up = true;
    await ctx.pollHeartbeat(true);
    expect(vm.runInContext("_hbBackoff.fails()", ctx)).toBe(0);
    expect(vm.runInContext("_hbBackoff.delay()", ctx)).toBe(5000);
    expect(ctx._everPolled).toBe(true);
  });

  test("pollReload skips the network while backing off and recovers", async () => {
    let up = false;
    const ctx = sandbox(() => up
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ counter: 7 }) })
      : Promise.resolve({ ok: false, status: 404 }));
    await ctx.pollReload();
    await ctx.pollReload();
    await ctx.pollReload();
    expect(ctx.calls.length).toBe(1);
    vm.runInContext("_reloadBackoff.ok()", ctx);
    up = true;
    await ctx.pollReload();
    expect(ctx.calls.length).toBe(2);
    expect(vm.runInContext("_reloadBackoff.fails()", ctx)).toBe(0);
  });

  test("the worker source backs off too", () => {
    const m = md.match(/const src = 'const u=' \+ url \+ '([^\n]*)';/);
    expect(m).toBeTruthy();
    expect(m[1]).toContain("Math.min(60000,5000*Math.pow(2,f-1))");
    expect(m[1]).toContain("setTimeout(p");
    expect(m[1]).not.toContain("setInterval");
  });

  test("the draft mirror stretches its debounce while failing and resets on an ack", () => {
    const ctx = { Math };
    vm.createContext(ctx);
    vm.runInContext("const DRAFT_DEBOUNCE_MS = 1000; let _draftFailures = 0;" + fn("_draftDelayMs"), ctx);
    const d = () => vm.runInContext("_draftDelayMs()", ctx);
    expect(d()).toBe(1000);
    const seen = [];
    for (let i = 1; i <= 6; i++) { vm.runInContext("_draftFailures++", ctx); seen.push(d()); }
    expect(seen).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
    vm.runInContext("_draftFailures = 0", ctx);
    expect(d()).toBe(1000);
    expect(md).toContain("setTimeout(flushDraft, _draftDelayMs())");
  });
});
