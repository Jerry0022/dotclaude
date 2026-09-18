import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, validate, checkState, run, DEFAULTS, BYE_GRACE_MS } from "./concept-watch.js";

function stateFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concept-watch-"));
  const p = path.join(dir, "concept-active.json");
  if (contents !== undefined) {
    fs.writeFileSync(p, typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  return p;
}

/** Drive run() with fake IO so no sockets, timers, or process.exit are involved. */
function harness({ mode = "watch", port = 8883, state, responses = [], exists = true, grace = 60, interval }) {
  const calls = [];
  let reason = null;
  const opts = {
    mode, port, state: state ?? "/fake/concept-active.json", ...DEFAULTS, grace,
    ...(interval === undefined ? {} : { interval }),
  };
  const p = run(opts, {
    exists: () => (typeof exists === "function" ? exists() : exists),
    sleep: async (ms) => { calls.push({ sleep: ms }); },
    // `state` here is the verdict checkState should return, not a path.
    checkState: () => state,
    request: async (_port, reqPath, method) => {
      calls.push({ reqPath, method });
      return responses.shift() ?? { ok: false, body: "" };
    },
    emit: (r) => { reason = r; return r; },
  });
  return { done: p.then(() => reason), calls };
}

describe("parseArgs / validate", () => {
  test("parses the documented invocation", () => {
    const o = parseArgs(["--mode", "watch", "--port", "8883", "--state", "C:/p/.claude/concept-active.json"]);
    expect(o.mode).toBe("watch");
    expect(o.port).toBe(8883);
    expect(o.state).toBe("C:/p/.claude/concept-active.json");
    expect(o.interval).toBe(20);   // under the page's 90s HEARTBEAT_STALE_MS
  });

  test.each([
    ["bad mode", { mode: "poll", port: 8883, state: "/s" }],
    ["port 0", { mode: "watch", port: 0, state: "/s" }],
    ["port too high", { mode: "watch", port: 70000, state: "/s" }],
    ["no state path", { mode: "watch", port: 8883, state: "" }],
  ])("rejects %s", (_l, partial) => {
    expect(validate({ ...DEFAULTS, ...partial })).toBeTruthy();
  });

  test("accepts a valid set", () => {
    expect(validate({ ...DEFAULTS, mode: "pulse", port: 8883, state: "/s" })).toBeNull();
  });
});

// The inline shell loops this replaces used `grep -qE '"port"…\b'`, which is
// spacing-dependent, GNU-only, and could not tell 8883 from 88831.
describe("checkState — the guard the shell version got wrong", () => {
  test("matching port → ok, whatever the JSON spacing", () => {
    expect(checkState(stateFile('{"port":8883}'), 8883)).toBe("ok");
    expect(checkState(stateFile('{ "port" :   8883 }'), 8883)).toBe("ok");
  });

  test("a longer port is not a prefix match", () => {
    expect(checkState(stateFile({ port: 88831 }), 8883)).toBe("port-changed");
  });

  test("a different port → port-changed", () => {
    expect(checkState(stateFile({ port: 9001 }), 8883)).toBe("port-changed");
  });

  test("missing file → gone", () => {
    expect(checkState(stateFile(undefined), 8883)).toBe("gone");
  });

  test("a half-written file is NOT a dead concept", () => {
    // A state rewrite must not kill both watchers mid-flight.
    expect(checkState(stateFile("{not json"), 8883)).toBe("ok");
  });

  test("valid JSON without a numeric port → gone", () => {
    expect(checkState(stateFile({ slug: "x" }), 8883)).toBe("gone");
  });
});

describe("run — waker", () => {
  test("exits PENDING_SUBMISSION the moment a submission lands", async () => {
    const h = harness({
      state: "ok",
      responses: [
        { ok: true, body: '{"pending": false}' },
        { ok: true, body: '{"pending": true, "version": 3}' },
      ],
    });
    await expect(h.done).resolves.toBe("PENDING_SUBMISSION");
    expect(h.calls.filter(c => c.reqPath === "/pending")).toHaveLength(2);
  });

  test("polls /pending, never /decisions — only /pending acks the pickup", async () => {
    const h = harness({ state: "ok", responses: [{ ok: true, body: '{"pending": true}' }] });
    await h.done;
    expect(h.calls.every(c => !c.reqPath || c.reqPath === "/pending")).toBe(true);
  });

  test("tolerates 3 transient failures, gives up on the 4th", async () => {
    const fail = { ok: false, body: "" };
    const h = harness({ state: "ok", responses: [fail, fail, fail, fail] });
    await expect(h.done).resolves.toBe("SERVER_DEAD");
  });

  test("a failure streak is reset by one success", async () => {
    const fail = { ok: false, body: "" };
    const ok = { ok: true, body: '{"pending": false}' };
    const h = harness({ state: "ok", responses: [fail, fail, fail, ok, fail, { ok: true, body: '{"pending": true}' }] });
    await expect(h.done).resolves.toBe("PENDING_SUBMISSION");
  });

  test("malformed /pending JSON is treated as not-pending, not as a crash", async () => {
    const h = harness({
      state: "ok",
      responses: [{ ok: true, body: "<html>oops" }, { ok: true, body: '{"pending": true}' }],
    });
    await expect(h.done).resolves.toBe("PENDING_SUBMISSION");
  });
});

describe("run — pulser", () => {
  test("POSTs the heartbeat, never GETs anything", async () => {
    const beat = { ok: true, body: "{}" };
    const fail = { ok: false, body: "" };
    const h = harness({ mode: "pulse", state: "ok", responses: [beat, beat, fail, fail, fail, fail] });
    await expect(h.done).resolves.toBe("SERVER_DEAD");
    const beats = h.calls.filter(c => c.reqPath);
    expect(beats).toHaveLength(6);
    expect(beats.every(c => c.reqPath === "/heartbeat" && c.method === "POST")).toBe(true);
  });

  test("keeps beating even while a submission IS pending", async () => {
    // The pulser/waker split exists for exactly this: if the pulser exited on
    // pending, nothing would keep `claude_ts` warm through a long `implement`
    // and the indicator would go red precisely during implementation.
    const pending = { ok: true, body: '{"pending": true}' };
    const fail = { ok: false, body: "" };
    const h = harness({
      mode: "pulse",
      state: "ok",
      responses: [pending, pending, pending, fail, fail, fail, fail],
    });
    await expect(h.done).resolves.toBe("SERVER_DEAD");
    expect(h.calls.filter(c => c.reqPath === "/heartbeat")).toHaveLength(7);
  });
});

describe("run — lifecycle guards", () => {
  test("a vanished concept exits STATE_GONE", async () => {
    const h = harness({ state: "gone", responses: [{ ok: true, body: '{"pending": false}' }] });
    await expect(h.done).resolves.toBe("STATE_GONE");
  });

  test("a superseded concept exits PORT_CHANGED", async () => {
    const h = harness({ state: "port-changed", responses: [{ ok: true, body: '{"pending": false}' }] });
    await expect(h.done).resolves.toBe("PORT_CHANGED");
  });

  test("a state file that does not exist YET is waited for, not fatal", async () => {
    // bridge-server.md launches the watchers in step 3 and writes the state
    // file in step 4. The shell version died on its first line.
    let attempts = 0;
    const h = harness({
      state: "ok",
      exists: () => ++attempts > 2,
      responses: [{ ok: true, body: '{"pending": true}' }],
    });
    await expect(h.done).resolves.toBe("PENDING_SUBMISSION");
    expect(attempts).toBeGreaterThan(2);
  });

  test("but a state file that never appears gives up — with its OWN reason", async () => {
    // Distinct from STATE_GONE on purpose: the action table answers STATE_GONE
    // with "do not re-launch, the session is over", which would be exactly
    // wrong for a live concept whose launch merely outran its setup.
    const h = harness({ state: "ok", exists: false, grace: 40, responses: [] });
    await expect(h.done).resolves.toBe("STATE_NEVER_APPEARED");
  });

  test.each([[0, 20], [10, 60], [70, 20]])(
    "the grace wait terminates for grace=%i interval=%i",
    async (grace, interval) => {
      // grace 0 must not hang, and interval > grace must not overshoot forever.
      const h = harness({ state: "ok", exists: false, grace, interval, responses: [] });
      await expect(h.done).resolves.toBe("STATE_NEVER_APPEARED");
      const slept = h.calls.filter(c => c.sleep !== undefined).reduce((a, c) => a + c.sleep, 0);
      expect(slept).toBeLessThanOrEqual(grace * 1000);
    }
  );

  test("run() rejects on an internal throw — the CLI turns that into a reason line", async () => {
    // The exit IS the wake, so an unhandled rejection would exit 1 with nothing
    // the reason → action table can key off. The CLI wraps run() in .catch().
    const boom = run(
      { ...DEFAULTS, mode: "watch", port: 8883, state: "/s" },
      {
        exists: () => true,
        checkState: () => { throw new Error("boom"); },
        sleep: async () => {},
        request: async () => ({ ok: true, body: "{}" }),
        emit: (r) => r,
      }
    );
    await expect(boom).rejects.toThrow("boom");
  });
});

describe("validate — the guards the shell version could not express", () => {
  test("a RELATIVE state path is rejected, not merely discouraged", () => {
    expect(validate({ ...DEFAULTS, mode: "watch", port: 8883, state: ".claude/concept-active.json" }))
      .toMatch(/ABSOLUTE/);
  });

  test("absolute paths in both shapes are accepted", () => {
    for (const p of ["C:/proj/.claude/concept-active.json", "/home/u/proj/.claude/concept-active.json"]) {
      expect(validate({ ...DEFAULTS, mode: "watch", port: 8883, state: p })).toBeNull();
    }
  });

  test.each(["interval", "grace", "tolerate", "timeout"])("a non-numeric --%s is rejected", key => {
    const opts = { ...DEFAULTS, mode: "watch", port: 8883, state: "/s", [key]: NaN };
    expect(validate(opts)).toBeTruthy();
  });

  test("a zero timeout is rejected — it would disable the request deadline", () => {
    expect(validate({ ...DEFAULTS, mode: "watch", port: 8883, state: "/s", timeout: 0 })).toBeTruthy();
  });
});

describe("parseArgs — odd argv", () => {
  test.each([
    ["a trailing flag with no value", ["--mode", "watch", "--port", "8883", "--state"]],
    ["a flag whose value is another flag", ["--mode", "watch", "--port", "8883", "--state", "--interval"]],
  ])("%s leaves state empty and is rejected", (_l, argv) => {
    const o = parseArgs(argv);
    expect(o.state).toBe("");
    expect(validate(o)).toBeTruthy();
  });

  test("a repeated --port takes the last value", () => {
    expect(parseArgs(["--port", "1111", "--port", "2222"]).port).toBe(2222);
  });

  test.each([["-1"], ["8883.5"], ["abc"], ["99999"]])("--port %s is rejected", raw => {
    const o = parseArgs(["--mode", "watch", "--state", "/s", "--port", raw]);
    expect(validate(o)).toMatch(/port/);
  });

  test("prototype keys cannot be injected as options", () => {
    const o = parseArgs(["--toString", "5", "--constructor", "7"]);
    expect(Object.prototype.hasOwnProperty.call(o, "toString")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(o, "constructor")).toBe(false);
  });
});

// #363 — the waker owns the monitoring duty the per-minute cron used to carry.
describe("run — waker owns cleanup, liveness and the structured exit (#363)", () => {
  /** Like harness(), but with a clock, a reopen spy and a readable state. */
  function watcher({ responses = [], state = "ok", liveness = 180, html = "docs/concepts/x.html", exists } = {}) {
    const calls = [];
    let clock = 1_000_000;
    let exit = null;
    const opts = { mode: "watch", port: 8883, state: "/proj/.claude/concept-active.json", ...DEFAULTS, liveness };
    const p = run(opts, {
      exists: exists || (() => true),
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      checkState: () => (typeof state === "function" ? state() : state),
      readState: () => ({ port: 8883, html_path: html }),
      reopen: (url) => { calls.push({ reopen: url }); },
      request: async (_port, reqPath, method) => {
        calls.push({ reqPath, method });
        return responses.shift() ?? { ok: false, body: "" };
      },
      emit: (reason, detail = "") => { exit = reason + detail; return reason; },
    });
    return { done: p.then(() => exit), calls, tick: (ms) => { clock += ms; } };
  }
  const idle = (browser_ts) => ({ ok: true, body: JSON.stringify({ pending: false, version: 0, action: "", browser_ts }) });

  test("PENDING_SUBMISSION carries version and action on the exit line", async () => {
    const w = watcher({ responses: [{ ok: true, body: '{"pending": true, "version": 7, "action": "implement", "browser_ts": 1}' }] });
    await expect(w.done).resolves.toBe("PENDING_SUBMISSION version=7 action=implement");
  });

  test("an odd action value is dropped from the line rather than echoed", async () => {
    const w = watcher({ responses: [{ ok: true, body: '{"pending": true, "version": 2, "action": "x y; rm", "browser_ts": 1}' }] });
    await expect(w.done).resolves.toBe("PENDING_SUBMISSION version=2");
  });

  test.each([["gone", "STATE_GONE"], ["port-changed", "PORT_CHANGED"], ["html-gone", "HTML_GONE"]])(
    "cleanup verdict %s → POST /shutdown, then exit %s",
    async (verdict, reason) => {
      const w = watcher({ state: verdict });
      await expect(w.done).resolves.toBe(reason);
      expect(w.calls).toEqual([{ reqPath: "/shutdown", method: "POST" }]);
    }
  );

  test("the pulser never shuts the bridge down — cleanup is the waker's job", async () => {
    const calls = [];
    let reason = null;
    await run({ mode: "pulse", port: 8883, state: "/proj/.claude/concept-active.json", ...DEFAULTS }, {
      exists: () => true, sleep: async () => {}, checkState: () => "gone",
      request: async (_p, reqPath, method) => { calls.push({ reqPath, method }); return { ok: true, body: "" }; },
      emit: (r) => { reason = r; return r; },
    });
    expect(reason).toBe("STATE_GONE");
    expect(calls).toEqual([]);
  });

  test("checkState: a state file whose html_path is gone → html-gone (watch mode only)", () => {
    const p = stateFile({ port: 8883, html_path: "docs/concepts/gone.html" });
    expect(checkState(p, 8883, () => false)).toBe("html-gone");
    expect(checkState(p, 8883, () => true)).toBe("ok");
    expect(checkState(p, 8883)).toBe("ok");                       // no exists → the pulser's old verdict
    const root = path.dirname(path.dirname(p));
    let asked = "";
    checkState(p, 8883, (f) => { asked = f; return true; });
    expect(asked).toBe(path.join(root, "docs/concepts/gone.html"));   // resolved against the project root
  });

  test("no browser poll for longer than --liveness → the page is re-opened exactly once per silence window", async () => {
    const w = watcher({
      responses: [
        idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0),   // 11 polls × 20 s = 220 s of silence
        { ok: true, body: '{"pending": true, "version": 1, "action": "iterate"}' },
      ],
    });
    await w.done;
    const reopens = w.calls.filter(c => c.reopen);
    expect(reopens).toEqual([{ reopen: "http://localhost:8883/docs/concepts/x.html" }]);
  });

  test("a fresh browser poll re-arms the reopen; the next silence window reopens again", async () => {
    // clock starts at 1_000_000; browser_ts values are absolute ms on that clock
    const w = watcher({
      responses: [
        idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0),          // silent → reopen #1 at ~200 s
        idle(1_000_000 + 200_000),                                                                        // the tab is back
        idle(1_000_000 + 200_000), idle(1_000_000 + 200_000), idle(1_000_000 + 200_000), idle(1_000_000 + 200_000),
        idle(1_000_000 + 200_000), idle(1_000_000 + 200_000), idle(1_000_000 + 200_000), idle(1_000_000 + 200_000),
        idle(1_000_000 + 200_000), idle(1_000_000 + 200_000),                                               // silent again → reopen #2
        { ok: true, body: '{"pending": true}' },
      ],
    });
    await w.done;
    expect(w.calls.filter(c => c.reopen)).toHaveLength(2);
  });

  test("a tab that keeps polling is never re-opened", async () => {
    let t = 1_000_000;
    const live = () => ({ ok: true, body: JSON.stringify({ pending: false, browser_ts: (t += 20_000) }) });
    const w = watcher({ responses: [live(), live(), live(), live(), live(), live(), live(), live(), live(), live(), live(), live(), { ok: true, body: '{"pending": true}' }] });
    await w.done;
    expect(w.calls.some(c => c.reopen)).toBe(false);
  });

  test("--liveness 0 switches the reopen off", async () => {
    const w = watcher({ liveness: 0, responses: [idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), idle(0), { ok: true, body: '{"pending": true}' }] });
    await w.done;
    expect(w.calls.some(c => c.reopen)).toBe(false);
  });

  test("validate: liveness must be 0 or positive; parseArgs reads --liveness", () => {
    const base = { mode: "watch", port: 8883, state: path.resolve("/x/concept-active.json"), ...DEFAULTS };
    expect(validate({ ...base, liveness: -1 })).toMatch(/liveness/);
    expect(validate({ ...base, liveness: 0 })).toBeNull();
    expect(parseArgs(["--mode", "watch", "--port", "8883", "--state", "/x/s.json", "--liveness", "90"]).liveness).toBe(90);
    expect(parseArgs([]).liveness).toBe(900);
  });
});

describe("run — liveness tells a hidden tab from a closed one (#397)", () => {
  function watcher({ responses = [], liveness = DEFAULTS.liveness, html = "docs/concepts/x.html" } = {}) {
    const calls = [];
    let clock = 1_000_000;
    let exit = null;
    const opts = { mode: "watch", port: 8883, state: "/proj/.claude/concept-active.json", ...DEFAULTS, liveness };
    const p = run(opts, {
      exists: () => true,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
      checkState: () => "ok",
      readState: () => ({ port: 8883, html_path: html }),
      reopen: (url) => { calls.push({ reopen: url }); },
      request: async (_port, reqPath, method) => {
        calls.push({ reqPath, method });
        const next = responses.shift();
        return typeof next === "function" ? next(clock) : (next ?? { ok: false, body: "" });
      },
      emit: (reason, detail = "") => { exit = reason + detail; return reason; },
    });
    return { done: p.then(() => exit), calls, reopens: () => calls.filter(c => c.reopen).length };
  }
  const T0 = 1_000_000;
  const pend = { ok: true, body: '{"pending": true, "version": 1}' };
  /** A /pending body from the #397 server: tabs registered + bye stamp. */
  const poll = (browser_ts, browser_tabs, browser_bye_ts = 0) =>
    ({ ok: true, body: JSON.stringify({ pending: false, version: 0, action: "", browser_ts, browser_tabs, browser_bye_ts }) });

  test("REGRESSION: a registered tab silent for 5+ minutes (background throttling) is NEVER re-opened", async () => {
    // browser_ts frozen at T0 while one tab stays registered — the reported
    // storm: 180 s of silence used to open a fresh tab every few minutes.
    const responses = [];
    for (let i = 0; i < 60; i++) responses.push(poll(T0, 1)); // 60 × 20 s = 20 min of silence
    responses.push(pend);
    const w = watcher({ responses });
    expect(await w.done).toMatch(/PENDING_SUBMISSION/);
    expect(w.reopens()).toBe(0);
  });

  test("the last tab says /bye → exactly one reopen, after BYE_GRACE_MS, not before", async () => {
    // Tab polled at T0, closed at T0+10 s (bye), nothing since.
    const bye = T0 + 10_000;
    const responses = [
      poll(T0, 1),                 // t=T0        tab live
      poll(T0, 0, bye),            // t=T0+20 s   bye 10 s ago → within grace → no reopen
      poll(T0, 0, bye),            // t=T0+40 s   30 s → still within grace
      poll(T0, 0, bye),            // t=T0+60 s   50 s → still within grace
      poll(T0, 0, bye),            // t=T0+80 s   70 s ≥ BYE_GRACE_MS → reopen #1
      poll(T0, 0, bye),            // t=T0+100 s  still closed → no second reopen
      poll(T0, 0, bye),
      pend,
    ];
    const w = watcher({ responses });
    await w.done;
    expect(w.reopens()).toBe(1);
    const firstReopenIdx = w.calls.findIndex(c => c.reopen);
    const pendingPollsBefore = w.calls.slice(0, firstReopenIdx).filter(c => c.reqPath === "/pending").length;
    expect(pendingPollsBefore).toBe(5); // fired on the 5th poll (t = T0+80 s), not the 2nd
  });

  test("a reload (bye immediately followed by the fresh load's poll) never reopens", async () => {
    // pagehide fires on reload too; the new document registers within a
    // second, so browser_ts advances past the bye and a tab is registered again.
    const responses = [
      poll(T0, 1),
      poll(T0 + 21_000, 1, T0 + 20_500),   // bye at 20.5 s, new tab polled at 21 s
      poll(T0 + 41_000, 1, T0 + 20_500),
      poll(T0 + 61_000, 1, T0 + 20_500),
      poll(T0 + 81_000, 1, T0 + 20_500),
      poll(T0 + 101_000, 1, T0 + 20_500),
      pend,
    ];
    const w = watcher({ responses });
    await w.done;
    expect(w.reopens()).toBe(0);
  });

  test("bye from one tab while another is still registered does not reopen", async () => {
    const responses = [];
    for (let i = 0; i < 12; i++) responses.push(poll(T0, 1, T0 + 5_000)); // 4 min: tab A said bye, tab B registered but throttled
    responses.push(pend);
    const w = watcher({ responses });
    await w.done;
    expect(w.reopens()).toBe(0);
  });

  test("no tab registered and no bye → the silence rule at --liveness still applies (tab died without a beacon)", async () => {
    const responses = [];
    for (let i = 0; i < 50; i++) responses.push(poll(T0, 0)); // 50 × 20 s = 1000 s > 900 s
    responses.push(pend);
    const w = watcher({ responses });
    await w.done;
    expect(w.reopens()).toBe(1);
    const idx = w.calls.findIndex(c => c.reopen);
    const pollsBefore = w.calls.slice(0, idx).filter(c => c.reqPath === "/pending").length;
    expect(pollsBefore * 20_000).toBeGreaterThanOrEqual(DEFAULTS.liveness * 1000); // not a second earlier
  });

  test("after a reopen, a tab registering again re-arms; a later bye reopens once more", async () => {
    // Polls land every 20 s from T0: poll n is at T0 + 20 s × (n − 1).
    const bye1 = T0 + 1_000, bye2 = T0 + 135_000;
    const responses = [
      poll(T0, 0, bye1), poll(T0, 0, bye1), poll(T0, 0, bye1), poll(T0, 0, bye1), poll(T0, 0, bye1), // polls 1–5 → reopen #1 at T0+80 s (79 s after bye)
      poll(T0 + 90_000, 1, bye1), poll(T0 + 110_000, 1, bye1),                                       // polls 6–7: the reopened tab is registered → re-arm
      poll(T0 + 130_000, 0, bye2), poll(T0 + 130_000, 0, bye2), poll(T0 + 130_000, 0, bye2), poll(T0 + 130_000, 0, bye2), // polls 8–11: closed again (bye at 135 s) → reopen #2 at T0+200 s
      pend,
    ];
    const w = watcher({ responses });
    await w.done;
    expect(w.reopens()).toBe(2);
  });

  test("DEFAULTS.liveness is 900 s and BYE_GRACE_MS 60 s — the Edge throttling numbers", () => {
    expect(DEFAULTS.liveness).toBe(900);
    expect(BYE_GRACE_MS).toBe(60_000);
    expect(parseArgs([]).liveness).toBe(900);
  });
});
