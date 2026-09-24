import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  lockoutPathFor, readLockout, inspectLockout, parseArmArgs, ttlFor,
  LOCKOUT_FILE, SHIP_TTL_MS, RUN_TTL_MS,
} from "./autonomous-lockout.js";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "autonomous-lockout.js");
const HOUR = 60 * 60 * 1000;

const dirs = [];
const mkdtemp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lockout-test-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) {
    try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const cli = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd, encoding: "utf8", env: { ...process.env, CLAUDE_SESSION_ID: "", CLAUDE_CODE_SESSION_ID: "" },
  });
  return JSON.parse(r.stdout.trim());
};

const writeSentinel = (d, obj) => fs.writeFileSync(lockoutPathFor(d), JSON.stringify(obj));

describe("autonomous-lockout — sentinel resolution", () => {
  test("lockoutPathFor joins the well-known filename onto the project dir", () => {
    expect(lockoutPathFor(path.join("/", "proj"))).toBe(path.join("/", "proj", LOCKOUT_FILE));
  });

  test("readLockout returns null when no sentinel is present", () => {
    expect(readLockout(mkdtemp())).toBeNull();
  });

  test("readLockout returns the parsed sentinel when present and fresh", () => {
    const d = mkdtemp();
    const since = new Date().toISOString();
    writeSentinel(d, { owner: "backlog-runner", since, session: "abc" });
    expect(readLockout(d)).toEqual({ owner: "backlog-runner", since, session: "abc" });
  });

  test("a present-but-corrupt sentinel still reads as locked (fail toward non-interactive)", () => {
    // The whole guard exists to keep an AFK run from hanging on a modal — so a
    // damaged sentinel must resolve to "locked", never to "no lockout".
    const d = mkdtemp();
    fs.writeFileSync(lockoutPathFor(d), "{ this is not json");
    const r = readLockout(d);
    expect(r).not.toBeNull();
    expect(r.owner).toBe("unknown");
  });
});

describe("autonomous-lockout — TTL (a crashed run must not lock forever)", () => {
  test("do-run owns a single ship (6 h); every other owner a whole AFK run (24 h)", () => {
    expect(ttlFor("do-run")).toBe(SHIP_TTL_MS);
    expect(SHIP_TTL_MS).toBe(6 * HOUR);
    expect(ttlFor("backlog-runner")).toBe(RUN_TTL_MS);
    expect(ttlFor("unknown")).toBe(RUN_TTL_MS);
    expect(RUN_TTL_MS).toBe(24 * HOUR);
  });

  test("a do-run lockout older than 6 h is stale: ignored and removed", () => {
    const d = mkdtemp();
    const now = Date.now();
    writeSentinel(d, { owner: "do-run", since: new Date(now - 7 * HOUR).toISOString() });
    expect(inspectLockout(d, now)).toMatchObject({ owner: "do-run", stale: true });
    expect(readLockout(d, now)).toBeNull();
    expect(fs.existsSync(lockoutPathFor(d))).toBe(false);
  });

  test("a do-run lockout inside its TTL stays active", () => {
    const d = mkdtemp();
    const now = Date.now();
    writeSentinel(d, { owner: "do-run", since: new Date(now - 5 * HOUR).toISOString() });
    expect(readLockout(d, now)).toMatchObject({ owner: "do-run" });
    expect(fs.existsSync(lockoutPathFor(d))).toBe(true);
  });

  test("a backlog-runner lockout survives 7 h but not 25 h", () => {
    const d = mkdtemp();
    const now = Date.now();
    writeSentinel(d, { owner: "backlog-runner", since: new Date(now - 7 * HOUR).toISOString() });
    expect(readLockout(d, now)).not.toBeNull();
    writeSentinel(d, { owner: "backlog-runner", since: new Date(now - 25 * HOUR).toISOString() });
    expect(readLockout(d, now)).toBeNull();
  });

  test("a corrupt sentinel ages by its mtime", () => {
    const d = mkdtemp();
    fs.writeFileSync(lockoutPathFor(d), "{ nope");
    const old = new Date(Date.now() - 25 * HOUR);
    fs.utimesSync(lockoutPathFor(d), old, old);
    expect(readLockout(d)).toBeNull();
  });
});

describe("autonomous-lockout — CLI", () => {
  test("arm records owner, since and the session; check reports it active; clear removes it", () => {
    const d = mkdtemp();
    const armed = cli(d, "arm", "do-run", "--session=s-123");
    expect(armed).toMatchObject({ ok: true, active: true, owner: "do-run", session: "s-123" });
    expect(Date.parse(armed.since)).toBeGreaterThan(0);
    expect(cli(d, "check")).toMatchObject({ active: true, owner: "do-run", session: "s-123" });
    expect(cli(d, "clear")).toEqual({ ok: true, cleared: true });
    expect(cli(d, "check")).toEqual({ ok: true, active: false });
  });

  test("check reports a stale lockout as inactive + stale and removes it", () => {
    const d = mkdtemp();
    writeSentinel(d, { owner: "do-run", since: new Date(Date.now() - 7 * HOUR).toISOString() });
    expect(cli(d, "check")).toMatchObject({ ok: true, active: false, stale: true, removed: true, owner: "do-run" });
    expect(fs.existsSync(lockoutPathFor(d))).toBe(false);
  });

  test("parseArmArgs: owner default, --session flag, env fallback", () => {
    expect(parseArmArgs([], {})).toEqual({ owner: "autonomous", session: null });
    expect(parseArmArgs(["--session=x", "do-run"], {})).toEqual({ owner: "do-run", session: "x" });
    expect(parseArmArgs(["do-run"], { CLAUDE_SESSION_ID: "env-1" })).toEqual({ owner: "do-run", session: "env-1" });
  });
});
