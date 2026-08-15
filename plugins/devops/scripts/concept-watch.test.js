import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, validate, checkState, run, DEFAULTS } from "./concept-watch.js";

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
