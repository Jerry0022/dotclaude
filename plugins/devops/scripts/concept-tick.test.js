import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseArgs,
  validate,
  inspectState,
  cleanupInstruction,
  pendingInstruction,
  tick,
} from "./concept-tick.js";

const PORT = 8883;

// A real temp project tree — inspectState reads the state file and stats the
// concept HTML relative to it, and faking fs for that would test the fake.
let root;
let statePath;

function writeState(obj) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, typeof obj === "string" ? obj : JSON.stringify(obj));
}

function writeHtml(rel) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "<html></html>");
}

const LIVE = {
  port: PORT,
  html_path: "docs/concepts/2026-08-16-x.html",
  slug: "x",
  cron_id: "ab12cd34",
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "concept-tick-"));
  statePath = path.join(root, ".claude", "concept-active.json");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("parseArgs / validate", () => {
  test("reads port, state and the timeout default", () => {
    const opts = parseArgs(["--port", "8883", "--state", "C:/p/.claude/concept-active.json"]);
    expect(opts.port).toBe(8883);
    expect(opts.state).toBe("C:/p/.claude/concept-active.json");
    expect(opts.timeout).toBe(8);
  });

  test("does not walk the prototype chain", () => {
    // `key in DEFAULTS` would let `--toString 5` set junk on the options object.
    const opts = parseArgs(["--toString", "5"]);
    expect(typeof opts.toString).toBe("function");
  });

  test("rejects a relative state path", () => {
    // The defect this argument exists to prevent: resolved against the cron
    // task's cwd, which is not always the project root.
    expect(validate({ port: PORT, state: ".claude/concept-active.json", timeout: 8 }))
      .toMatch(/ABSOLUTE/);
  });

  test.each([0, -1, 70000, 1.5, NaN])("rejects port %s", p => {
    expect(validate({ port: p, state: "C:/p/x.json", timeout: 8 })).toMatch(/port/);
  });

  test("accepts a valid pair", () => {
    expect(validate({ port: PORT, state: path.resolve("/p/x.json"), timeout: 8 })).toBeNull();
  });
});

// Step (0) of bridge-server.md § step 3 — the gate that keeps a stale cron
// from servicing a concept that is over.
describe("inspectState — the self-cleanup gate", () => {
  test("a live concept is not a cleanup trigger", () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    expect(inspectState(statePath, PORT).cleanup).toBe(false);
  });

  test("a missing state file triggers cleanup, with no cron id to delete", () => {
    const res = inspectState(statePath, PORT);
    expect(res.cleanup).toBe(true);
    expect(res.cronId).toBeNull();
  });

  test("a state file owning a different port triggers cleanup and keeps the id", () => {
    writeState({ ...LIVE, port: 9001 });
    writeHtml(LIVE.html_path);
    const res = inspectState(statePath, PORT);
    expect(res.cleanup).toBe(true);
    expect(res.cronId).toBe("ab12cd34");
    expect(res.reason).toContain("9001");
  });

  test("the port comparison is numeric, not a JSON-spacing substring match", () => {
    // `"port": 8883` vs `"port":8883` used to decide this, and 88831 used to
    // match 8883.
    writeState(`{"port":${PORT},"html_path":"${LIVE.html_path}","cron_id":"ab12cd34"}`);
    writeHtml(LIVE.html_path);
    expect(inspectState(statePath, PORT).cleanup).toBe(false);

    writeState({ ...LIVE, port: 88831 });
    expect(inspectState(statePath, PORT).cleanup).toBe(true);
  });

  test("a vanished concept HTML triggers cleanup", () => {
    writeState(LIVE);
    const res = inspectState(statePath, PORT);
    expect(res.cleanup).toBe(true);
    expect(res.reason).toContain(LIVE.html_path);
  });

  test("html_path resolves against the project root, not the cwd", () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    // Proof it is the state file's grandparent that is used: the same relative
    // path under the process cwd must NOT satisfy the check.
    const seen = [];
    inspectState(statePath, PORT, p => { seen.push(p); return true; });
    expect(seen[0]).toBe(path.join(root, LIVE.html_path));
  });

  test("a half-written state file is NOT a dead concept", () => {
    writeState('{"port": 88');
    expect(inspectState(statePath, PORT).cleanup).toBe(false);
  });

  test("a state file that is a directory (EISDIR/EPERM) is NOT a dead concept", () => {
    // Stands in for the EBUSY/EPERM window during a state rewrite on Windows:
    // any read error that is not ENOENT must be tolerated, or one unlucky tick
    // tears down a live concept.
    fs.mkdirSync(statePath, { recursive: true });
    expect(inspectState(statePath, PORT).cleanup).toBe(false);
  });
});

describe("the instructions the script emits", () => {
  test("cleanup names the cron id when the state file still has one", () => {
    const out = cleanupInstruction(PORT, "concept HTML is gone", "ab12cd34");
    expect(out).toContain("CronDelete the cron with id ab12cd34");
    expect(out).not.toContain("CronList");
  });

  test("cleanup falls back to the by-port sweep when the id is lost", () => {
    const out = cleanupInstruction(PORT, "state file is gone", null);
    expect(out).toContain("CronList");
    expect(out).toContain(`mentions \`port ${PORT}\``);
  });

  test("the pending instruction carries the version it was handed", () => {
    expect(pendingInstruction(PORT, 7)).toContain("(version 7)");
    // A version-less /pending response must not invent one — Claude still
    // reads the authoritative `_version` out of /decisions either way.
    expect(pendingInstruction(PORT, null)).not.toMatch(/\(version /);
    expect(pendingInstruction(PORT, null)).toContain("`_version`");
  });
});

describe("tick", () => {
  const ok = body => ({ ok: true, body });

  function spyRequest(routes) {
    const calls = [];
    return {
      calls,
      request: async (port, pathname) => {
        calls.push(pathname);
        return routes[pathname] || { ok: false, body: "" };
      },
    };
  }

  test("an idle tick prints absolutely nothing", async () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    const spy = spyRequest({
      "/heartbeat": ok(""),
      "/pending": ok(JSON.stringify({ pending: false, version: 3 })),
    });
    const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
    expect(res).toEqual({ stdout: "", stderr: "" });
  });

  test("a pending submission returns the processing instruction", async () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    const spy = spyRequest({
      "/heartbeat": ok(""),
      "/pending": ok(JSON.stringify({ pending: true, version: 4 })),
    });
    const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
    expect(res.stdout).toContain("version 4");
    expect(res.stdout).toContain("/decisions");
    expect(res.stdout).toContain("409");
  });

  test("the gate runs FIRST — no bridge traffic beyond /shutdown", async () => {
    // No state file at all.
    const spy = spyRequest({ "/shutdown": ok("") });
    const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
    expect(spy.calls).toEqual(["/shutdown"]);
    expect(res.stdout).toContain("CronList");
  });

  test("a heartbeat failure is stderr only, never an instruction", async () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    const spy = spyRequest({});
    const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("/heartbeat");
    // It must not go on to probe a bridge that just failed to answer.
    expect(spy.calls).toEqual(["/heartbeat"]);
  });

  test("unparseable /pending JSON is a silent tick, not a guess", async () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    const spy = spyRequest({ "/heartbeat": ok(""), "/pending": ok("<html>not json") });
    const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("unparseable");
  });

  test("`pending` must be exactly true — no truthiness", async () => {
    writeState(LIVE);
    writeHtml(LIVE.html_path);
    for (const value of ["true", 1, {}, null]) {
      const spy = spyRequest({
        "/heartbeat": ok(""),
        "/pending": ok(JSON.stringify({ pending: value })),
      });
      const res = await tick({ port: PORT, state: statePath, timeout: 8 }, { request: spy.request });
      expect(res.stdout, String(value)).toBe("");
    }
  });
});
