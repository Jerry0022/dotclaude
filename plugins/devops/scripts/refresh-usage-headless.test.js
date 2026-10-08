import { describe, test, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseUsageText,
  mapApiUsage,
  writeJsonAtomic,
  isMarkerPending,
  shouldOpenLoginWindow,
  classifyScraperPid,
  killScraperInstance,
  openLoginWindow,
  buildScraperArgs,
  slimScraperProfile,
  SCRAPER_PRUNE_DIRS,
  SCRAPER_SLIM_MARKER,
  LOGIN_RETRY_AFTER_MS,
  AUTO_LOGIN_RETRY_MS,
  bringLoginWindowToFront,
  powershellArgs,
} from "./refresh-usage-headless.js";

// #328 — a stale PID file + `taskkill /F /PID <pid> /T` killed the user's main
// Edge tree once the OS had reused the pid. The kill path must verify ownership
// first and never use /T.
describe("killScraperInstance — ownership check before any kill (#328)", () => {
  let dir;
  afterEach(() => {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} dir = null; }
  });

  // A fake execSync: answers the CIM query with `cimLine`, records every call.
  function fakeExec(cimLine, { throwOnCim = false } = {}) {
    const calls = [];
    const exec = vi.fn((cmd) => {
      calls.push(cmd);
      if (/Get-CimInstance/.test(cmd)) {
        if (throwOnCim) throw new Error("powershell timed out");
        return cimLine;
      }
      return "";
    });
    exec.calls = calls;
    exec.kills = () => calls.filter(c => /^taskkill/.test(c));
    return exec;
  }

  function pidFileWith(content) {
    dir = mkdtempSync(join(tmpdir(), "usage-pid-test-"));
    const pidFile = join(dir, "edge-usage-scraper.pid");
    fs.writeFileSync(pidFile, content);
    return pidFile;
  }

  test("classifyScraperPid: our scraper = msedge.exe + the profile dir on its command line", () => {
    const ours = fakeExec("msedge.exe|\"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe\" --user-data-dir=C:\\Users\\x\\.claude\\edge-usage-profile --remote-debugging-port=9223");
    expect(classifyScraperPid(28664, { exec: ours })).toBe("ours");
    // Same image, the USER's profile → foreign. This is the exact #328 case.
    const mainEdge = fakeExec("msedge.exe|\"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe\" --profile-directory=Default");
    expect(classifyScraperPid(28664, { exec: mainEdge })).toBe("foreign");
    expect(classifyScraperPid(28664, { exec: fakeExec("notepad.exe|notepad.exe") })).toBe("foreign");
    expect(classifyScraperPid(28664, { exec: fakeExec("") })).toBe("gone");
    expect(classifyScraperPid(28664, { exec: fakeExec("", { throwOnCim: true }) })).toBe("unknown");
    expect(classifyScraperPid(0, { exec: fakeExec("x") })).toBe("gone");
  });

  test("PID file pointing at the user's main Edge → no taskkill, file removed, reap still runs", () => {
    const pidFile = pidFileWith("28664");
    const exec = fakeExec("msedge.exe|msedge.exe --profile-directory=Default");
    const reap = vi.fn();
    killScraperInstance({ exec, pidFile, reap });
    expect(exec.kills()).toEqual([]);
    expect(fs.existsSync(pidFile)).toBe(false);
    expect(reap).toHaveBeenCalledTimes(1);
  });

  test("PID file pointing at a non-Edge process → no taskkill", () => {
    const pidFile = pidFileWith("4242");
    const exec = fakeExec("notepad.exe|notepad.exe");
    killScraperInstance({ exec, pidFile, reap: () => {} });
    expect(exec.kills()).toEqual([]);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  test("PID file pointing at our scraper → taskkill on that pid, WITHOUT /T", () => {
    const pidFile = pidFileWith("31337");
    const exec = fakeExec("msedge.exe|msedge.exe --user-data-dir=C:\\u\\.claude\\edge-usage-profile --remote-debugging-port=9223");
    killScraperInstance({ exec, pidFile, reap: () => {} });
    expect(exec.kills()).toEqual(["taskkill /F /PID 31337"]);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  test("ownership query fails (timeout) → treated as unknown, no kill", () => {
    const pidFile = pidFileWith("777");
    const exec = fakeExec("", { throwOnCim: true });
    killScraperInstance({ exec, pidFile, reap: () => {} });
    expect(exec.kills()).toEqual([]);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  test("pid already gone → no kill; no PID file → no query at all", () => {
    const pidFile = pidFileWith("9");
    const exec = fakeExec("");
    killScraperInstance({ exec, pidFile, reap: () => {} });
    expect(exec.kills()).toEqual([]);

    const exec2 = fakeExec("x");
    const reap = vi.fn();
    killScraperInstance({ exec: exec2, pidFile: join(dir, "missing.pid"), reap });
    expect(exec2).not.toHaveBeenCalled();
    expect(reap).toHaveBeenCalledTimes(1);
  });
});

// Fixed "now" so the age math is deterministic.
const NOW = Date.parse("2026-06-18T12:00:00.000Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

describe("isMarkerPending — login-once retry window", () => {
  test("retry window is 30 minutes", () => {
    expect(LOGIN_RETRY_AFTER_MS).toBe(30 * 60 * 1000);
  });

  test("a window opened just now is pending → no reopen", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(0) }, NOW)).toBe(true);
  });

  test("opened 10 min ago → still pending (within window)", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(10) }, NOW)).toBe(true);
  });

  test("opened 29 min ago → still pending", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(29) }, NOW)).toBe(true);
  });

  test("opened 31 min ago → expired, one retry allowed", () => {
    expect(isMarkerPending({ openedAt: minutesAgo(31) }, NOW)).toBe(false);
  });

  test.each([
    ["null marker", null],
    ["undefined marker", undefined],
    ["empty object", {}],
    ["missing openedAt", { pid: 1234 }],
    ["unparseable openedAt", { openedAt: "not-a-date" }],
  ])("%s → not pending (fail open, allow a fresh window)", (_label, marker) => {
    expect(isMarkerPending(marker, NOW)).toBe(false);
  });
});

describe("shouldOpenLoginWindow — login-window policy", () => {
  test("--no-login mode never opens a window (automatic card path)", () => {
    expect(shouldOpenLoginWindow({ noLogin: true, loginPending: false })).toBe(false);
    expect(shouldOpenLoginWindow({ noLogin: true, loginPending: true })).toBe(false);
  });

  test("manual run with no pending window may open one", () => {
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: false })).toBe(true);
  });

  test("manual run never stacks onto an already-pending window", () => {
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: true })).toBe(false);
  });
  // A revoked claude.ai session stayed silent ("refresh failed: not logged in")
  // because every automatic caller passed --no-login. The hook path now passes
  // --login-prompt: one window machine-wide, rate-limited while ignored.
  test("--login-prompt opens a window when none was offered recently", () => {
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: false, loginPrompt: true })).toBe(true);
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: false, loginPrompt: true, markerAgeMs: AUTO_LOGIN_RETRY_MS })).toBe(true);
  });

  test("--login-prompt does not reopen an ignored window before AUTO_LOGIN_RETRY_MS", () => {
    expect(AUTO_LOGIN_RETRY_MS).toBeGreaterThan(LOGIN_RETRY_AFTER_MS);
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: false, loginPrompt: true, markerAgeMs: LOGIN_RETRY_AFTER_MS + 1 })).toBe(false);
    expect(shouldOpenLoginWindow({ noLogin: false, loginPending: true, loginPrompt: true })).toBe(false);
  });
});

// The reap ran `powershell -Command "<script>"` through cmd, which stripped the
// quotes around Name='msedge.exe' — Get-CimInstance rejected the filter and the
// hidden off-screen scraper was never reaped. The visible login window then
// landed inside that instance as a ghost window nobody could bring up.
describe("powershellArgs — no shell quoting layer", () => {
  test("round-trips a script with nested quotes byte for byte", () => {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*edge-usage-profile*' }";
    const args = powershellArgs(script);
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(Buffer.from(args[3], "base64").toString("utf16le")).toBe(script);
  });
});

describe("bringLoginWindowToFront", () => {
  test("Windows: runs PowerShell with an encoded command scoped to the scraper profile", () => {
    const calls = [];
    const ok = bringLoginWindowToFront({ platform: "win32", profileDir: String.raw`C:\p\edge-usage-profile`, run: (cmd, args) => calls.push([cmd, args]) });
    expect(ok).toBe(true);
    expect(calls[0][0]).toBe("powershell.exe");
    const script = Buffer.from(calls[0][1].at(-1), "base64").toString("utf16le");
    expect(script).toContain(String.raw`C:\p\edge-usage-profile`);
    expect(script).toContain("SetForegroundWindow");
    expect(script).toContain("ShowWindow($h,3)"); // maximized
    expect(script).toContain("MoveWindow($h,$wa.X,$wa.Y"); // onto the primary work area first
  });

  test("never throws and does nothing off Windows", () => {
    expect(bringLoginWindowToFront({ platform: "win32", run: () => { throw new Error("x"); } })).toBe(false);
    expect(bringLoginWindowToFront({ platform: "linux", run: () => { throw new Error("must not run"); } })).toBe(false);
  });
});

describe("mapApiUsage — claude.ai internal usage API → usage-live.json schema", () => {
  // Shape captured live from GET /api/organizations/{id}/usage on 2026-07-04.
  const apiUsage = {
    five_hour: { utilization: 80.0, resets_at: new Date(NOW + 150 * 60_000).toISOString() },
    seven_day: { utilization: 45.4, resets_at: new Date(NOW + 2 * 24 * 60 * 60_000).toISOString() },
    seven_day_sonnet: null,
    limits: [
      { kind: "session", group: "session", percent: 80, severity: "warning" },
      { kind: "weekly_all", group: "weekly", percent: 45, severity: "normal" },
    ],
  };
  const apiRateLimits = { rate_limit_tier: "default_claude_max_5x" };

  test("maps five_hour/seven_day onto session/weekly with rounded pcts", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.session).toEqual({ pct: 80, resetInMinutes: 150 });
    expect(snap.weekly.pct).toBe(45);
    expect(snap.weekly.resetInMinutes).toBe(2 * 24 * 60);
  });

  test("weekly resetDay/resetTime are null (API carries durations, not day strings)", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.weekly.resetDay).toBeNull();
    expect(snap.weekly.resetTime).toBeNull();
  });

  test("stamps a fresh timestamp from nowMs and no _cached markers", () => {
    const snap = mapApiUsage(apiUsage, apiRateLimits, NOW);
    expect(snap.timestamp).toBe(new Date(NOW).toISOString());
    expect(snap._cached).toBeUndefined();
    expect(snap._ageMinutes).toBeUndefined();
  });

  test("plan label is humanized from the rate_limit_tier", () => {
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_max_5x" }, NOW).plan).toBe("Max 5x");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_max_20x" }, NOW).plan).toBe("Max 20x");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "default_claude_pro" }, NOW).plan).toBe("Pro");
  });

  test("missing/unknown rate limits fall back to the generic plan label", () => {
    expect(mapApiUsage(apiUsage, null, NOW).plan).toBe("Max Plan");
    expect(mapApiUsage(apiUsage, { rate_limit_tier: "something_new" }, NOW).plan).toBe("Max Plan");
  });

  test("weeklySonnet omitted when seven_day_sonnet is null, mapped when present", () => {
    expect(mapApiUsage(apiUsage, null, NOW).weeklySonnet).toBeUndefined();
    const withSonnet = { ...apiUsage, seven_day_sonnet: { utilization: 12.4 } };
    expect(mapApiUsage(withSonnet, null, NOW).weeklySonnet).toEqual({ pct: 12 });
  });

  test("missing seven_day → weekly null, session still mapped", () => {
    const snap = mapApiUsage({ five_hour: apiUsage.five_hour }, null, NOW);
    expect(snap.session.pct).toBe(80);
    expect(snap.weekly).toBeNull();
  });

  test("invalid or missing five_hour utilization → null (don't write garbage)", () => {
    expect(mapApiUsage(null, null, NOW)).toBeNull();
    expect(mapApiUsage({}, null, NOW)).toBeNull();
    expect(mapApiUsage({ five_hour: { utilization: "NaN%" } }, null, NOW)).toBeNull();
    expect(mapApiUsage({ five_hour: { utilization: null } }, null, NOW)).toBeNull();
  });

  test("resets_at in the past clamps to 0; missing resets_at → null", () => {
    const past = { five_hour: { utilization: 5, resets_at: new Date(NOW - 60_000).toISOString() } };
    expect(mapApiUsage(past, null, NOW).session.resetInMinutes).toBe(0);
    const none = { five_hour: { utilization: 5 } };
    expect(mapApiUsage(none, null, NOW).session.resetInMinutes).toBeNull();
  });

  test("utilization beyond [0,100] is clamped — an over-quota 118% must not overflow the bar", () => {
    const over = { five_hour: { utilization: 118.5 }, seven_day: { utilization: -3 } };
    const snap = mapApiUsage(over, null, NOW);
    expect(snap.session.pct).toBe(100);
    expect(snap.weekly.pct).toBe(0);
  });

  test("seven_day present but without utilization → weekly null (renderers need a pct; a bare resets_at is not renderable)", () => {
    const shape = { five_hour: { utilization: 9 }, seven_day: { resets_at: new Date(NOW + 60_000).toISOString() } };
    expect(mapApiUsage(shape, null, NOW).weekly).toBeNull();
  });
});

describe("writeJsonAtomic — persistence must survive Windows rename contention", () => {
  let dir;
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} dir = null; }
  });

  test("writes parseable JSON content to the target path", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-atomic-test-"));
    const target = join(dir, "usage-live.json");
    writeJsonAtomic(target, { session: { pct: 7 } });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ session: { pct: 7 } });
  });

  test("falls back to a direct write when renameSync throws (EPERM with a concurrent open reader on NTFS)", () => {
    dir = mkdtempSync(join(tmpdir(), "usage-atomic-test-"));
    const target = join(dir, "usage-live.json");
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      const err = new Error("EPERM: operation not permitted");
      err.code = "EPERM";
      throw err;
    });
    writeJsonAtomic(target, { session: { pct: 42 } });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ session: { pct: 42 } });
  });
});

describe("parseUsageText — claude.ai usage scrape", () => {
  const sample = [
    "Aktuelle Nutzung",
    "42 % verwendet",
    "Zurücksetzung in 2 Std. 30 Min.",
    "Alle Modelle",
    "18 % verwendet",
    "Zurücksetzung Mi., 09:00",
  ].join("\n");

  test("extracts session + weekly percentages", () => {
    const parsed = parseUsageText(sample);
    expect(parsed).not.toBeNull();
    expect(parsed.session.pct).toBe(42);
    expect(parsed.weekly.pct).toBe(18);
  });

  test("parses the session reset duration to minutes", () => {
    const parsed = parseUsageText(sample);
    expect(parsed.session.resetInMinutes).toBe(150); // 2h 30m
  });

  test("English wording is parsed too", () => {
    const en = "Current usage\n7 % used\nResets in 45 min\nAll Models\n3 % used";
    const parsed = parseUsageText(en);
    expect(parsed.session.pct).toBe(7);
    expect(parsed.session.resetInMinutes).toBe(45);
    expect(parsed.weekly.pct).toBe(3);
  });

  test("fewer than two percentages → null (don't write garbage)", () => {
    expect(parseUsageText("42 % verwendet")).toBeNull();
    expect(parseUsageText("no usage here at all")).toBeNull();
  });
});

// 2026-10-01: the manual login window opened while the reaped hidden scraper
// was still shutting down, handed off to that dying Edge and vanished.
describe('openLoginWindow — the login window must stay open', () => {
  const sleep = async () => {};

  test('waits until the old instance released the profile before launching', async () => {
    const calls = [];
    let alive = [true, true, false]; // old instance still up for two polls
    const cdpAlive = async () => { const v = alive.length ? alive.shift() : true; calls.push('cdp:' + v); return v; };
    const launch = async () => { calls.push('launch'); alive = [true]; return 123; };
    expect(await openLoginWindow({ launch, cdpAlive, sleep })).toBe(true);
    expect(calls.indexOf('launch')).toBe(3); // after the three release polls
  });

  test('relaunches once when the window vanishes right after launch', async () => {
    let launches = 0;
    const seq = [false, false, true]; // released · gone after 1st launch · up after 2nd
    const cdpAlive = async () => seq.shift() ?? true;
    const launch = async () => { launches++; return 1; };
    expect(await openLoginWindow({ launch, cdpAlive, sleep })).toBe(true);
    expect(launches).toBe(2);
  });

  test('gives up after two attempts and says so (false)', async () => {
    let launches = 0;
    const cdpAlive = async () => false;
    const launch = async () => { launches++; return 1; };
    expect(await openLoginWindow({ launch, cdpAlive, sleep })).toBe(false);
    expect(launches).toBe(2);
  });
});

// The scraper profile once grew to 2.5 GB (synced extensions, uncapped cache,
// component updates, metrics); a cold launch read ~180 MB and wrote ~100 MB.
describe("buildScraperArgs — lean scraper profile", () => {
  const lean = [
    "--disable-extensions",
    "--disable-sync",
    "--disable-component-update",
    "--disable-background-networking",
  ];

  test.each([false, true])("visible=%s carries every lean switch", (visible) => {
    const args = buildScraperArgs({ visible, url: "https://claude.ai/x", profileDir: "P", port: 1 });
    for (const flag of lean) expect(args).toContain(flag);
    expect(args).toContain("--user-data-dir=P");
    expect(args).toContain("--remote-debugging-port=1");
    expect(args.some(a => /^--disk-cache-size=\d+$/.test(a))).toBe(true);
    expect(args[args.length - 1]).toBe("https://claude.ai/x");
  });

  test("one --disable-features switch only (Chromium honours the last one)", () => {
    const args = buildScraperArgs({});
    const features = args.filter(a => a.startsWith("--disable-features="));
    expect(features).toHaveLength(1);
    expect(features[0]).toContain("msEdgeFeatureOverrides");
    expect(features[0]).toContain("msImplicitSignin");
  });

  test("never headless; window bounds per mode", () => {
    const hidden = buildScraperArgs({ visible: false });
    const shown = buildScraperArgs({ visible: true });
    expect([...hidden, ...shown].some(a => a.startsWith("--headless"))).toBe(false);
    expect(hidden).toContain("--window-position=-32000,-32000");
    expect(shown).toContain("--start-maximized");
    expect(shown).not.toContain("--window-position=-32000,-32000");
  });
});

describe("slimScraperProfile — one-time prune that keeps the login", () => {
  let dir;
  afterEach(() => {
    if (dir) {
      for (const d of [dir, `${dir}.trash`]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ } }
      dir = null;
    }
  });

  function seed() {
    dir = mkdtempSync(join(tmpdir(), "slim-"));
    for (const rel of SCRAPER_PRUNE_DIRS) {
      fs.mkdirSync(join(dir, rel), { recursive: true });
      fs.writeFileSync(join(dir, rel, "blob"), "x");
    }
    for (const keep of ["Network", "Local Storage", "IndexedDB"]) {
      fs.mkdirSync(join(dir, "Default", keep), { recursive: true });
    }
    fs.writeFileSync(join(dir, "Default", "Network", "Cookies"), "c");
    fs.writeFileSync(join(dir, "Default", "Login Data"), "l");
    fs.writeFileSync(join(dir, "Local State"), "{}");
  }

  test("moves bloat to trash, keeps cookies and storage, writes the marker", () => {
    seed();
    const purge = vi.fn();
    expect(slimScraperProfile({ profileDir: dir, purge })).toBe("pruned");
    for (const rel of SCRAPER_PRUNE_DIRS) expect(fs.existsSync(join(dir, rel))).toBe(false);
    expect(fs.readdirSync(`${dir}.trash`)).toHaveLength(SCRAPER_PRUNE_DIRS.length);
    expect(purge).toHaveBeenCalledWith(`${dir}.trash`);
    expect(fs.existsSync(join(dir, "Default", "Network", "Cookies"))).toBe(true);
    expect(fs.existsSync(join(dir, "Default", "Login Data"))).toBe(true);
    expect(fs.existsSync(join(dir, "Default", "Local Storage"))).toBe(true);
    expect(fs.existsSync(join(dir, "Default", "IndexedDB"))).toBe(true);
    expect(fs.existsSync(join(dir, "Local State"))).toBe(true);
    expect(fs.existsSync(join(dir, SCRAPER_SLIM_MARKER))).toBe(true);
  });

  test("runs once: the marker skips the prune, leftover trash is purged again", () => {
    seed();
    slimScraperProfile({ profileDir: dir, purge: () => {} });
    const move = vi.fn();
    const purge = vi.fn();
    fs.mkdirSync(join(dir, "BrowserMetrics"));
    expect(slimScraperProfile({ profileDir: dir, move, purge })).toBe("done");
    expect(move).not.toHaveBeenCalled();
    expect(purge).toHaveBeenCalledTimes(1);
  });

  test("a locked folder leaves no marker so the next launch retries", () => {
    seed();
    const move = vi.fn((from, to) => {
      if (from.endsWith("Cache")) throw new Error("EPERM");
      fs.renameSync(from, to);
    });
    expect(slimScraperProfile({ profileDir: dir, move, purge: () => {} })).toBe("retry");
    expect(fs.existsSync(join(dir, SCRAPER_SLIM_MARKER))).toBe(false);
    expect(fs.existsSync(join(dir, "Default", "Network", "Cookies"))).toBe(true);
  });

  test("no profile yet: nothing to do", () => {
    expect(slimScraperProfile({ profileDir: join(tmpdir(), "slim-missing-" + Date.now()) })).toBe("absent");
  });
});
