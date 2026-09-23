import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

// An exhausted Codex usage limit used to cost every later ship the full Codex
// wait: each run hit the same wall until the announced reset. codex-limit.js
// stores the reset time per user; codex-safe.sh skips Codex (rc 75) until it
// passes, the first call after it runs Codex again, `--reset-limit` clears it
// early.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-limit-"));
const STATE = path.join(dir, "codex-limit.json");
process.env.CODEX_LIMIT_FILE = STATE;
const require = createRequire(import.meta.url);
const lim = require("./codex-limit.js");

const SAFE = path.join(__dirname, "codex-safe.sh");
const LIMIT_JS = path.join(__dirname, "codex-limit.js");

beforeEach(() => { try { fs.unlinkSync(STATE); } catch { /* none */ } });
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

describe("findLimitLine — only real Codex error lines count", () => {
  test("detects the Codex usage-limit error, with or without timestamp/ANSI", () => {
    expect(lim.findLimitLine("ERROR: You've hit your usage limit. Try again later.")).toMatch(/usage limit/);
    expect(lim.findLimitLine("[2026-09-22T10:00:00] \x1b[31mERROR:\x1b[0m You've hit your usage limit or try again at 3:04 PM.")).toMatch(/3:04 PM/);
    expect(lim.findLimitLine("stream error: You've hit your usage limit")).not.toBeNull();
  });

  test("ignores the echoed prompt — diff lines and prose that merely mention a usage limit", () => {
    const echoed = [
      "user",
      "Review this diff:",
      "+  if (/usage limit/.test(line)) return line;",
      "+ERROR: You've hit your usage limit or try again at 3:04 PM.",
      " // stores the usage limit per user",
      "The usage limit is stored in ~/.claude.",
    ].join("\n");
    expect(lim.findLimitLine(echoed)).toBeNull();
  });
});

describe("parseResetAt", () => {
  const now = new Date(2026, 8, 22, 10, 0, 0);

  test("full date form: 'try again at Oct 11th, 2026 3:04 PM.'", () => {
    expect(lim.parseResetAt("… or try again at Oct 11th, 2026 3:04 PM.", now)).toEqual(new Date(2026, 9, 11, 15, 4));
  });

  test("time-only form means today, or tomorrow once the time is past", () => {
    expect(lim.parseResetAt("try again at 3:04 PM.", now)).toEqual(new Date(2026, 8, 22, 15, 4));
    expect(lim.parseResetAt("try again at 9:30 AM.", now)).toEqual(new Date(2026, 8, 23, 9, 30));
    expect(lim.parseResetAt("try again at 12:15 AM.", now)).toEqual(new Date(2026, 8, 23, 0, 15));
  });

  test("duration form: 'try again in 2 days 3 hours 5 minutes'", () => {
    const ms = ((2 * 24 + 3) * 60 + 5) * 60e3;
    expect(lim.parseResetAt("try again in 2 days 3 hours 5 minutes.", now)).toEqual(new Date(now.getTime() + ms));
  });

  test("no announced time → null", () => {
    expect(lim.parseResetAt("try again later.", now)).toBeNull();
  });
});

describe("state lifecycle", () => {
  test("record → active until reset → expired entry clears itself", () => {
    const now = new Date(2026, 8, 22, 10, 0, 0);
    const s = lim.recordFromText("ERROR: You've hit your usage limit or try again at Oct 11th, 2026 3:04 PM.", now);
    expect(s.resetAt).toEqual(new Date(2026, 9, 11, 15, 4));
    expect(s.resetKnown).toBe(true);
    expect(lim.activeLimit(new Date(2026, 9, 1))).not.toBeNull();
    expect(lim.activeLimit(new Date(2026, 9, 11, 15, 5))).toBeNull();
    expect(fs.existsSync(STATE)).toBe(false);
  });

  test("no reset time announced → one-hour retry window", () => {
    const now = new Date(2026, 8, 22, 10, 0, 0);
    const s = lim.recordFromText("ERROR: You've hit your usage limit. Try again later.", now);
    expect(s.resetKnown).toBe(false);
    expect(s.resetAt.getTime() - now.getTime()).toBe(3600e3);
  });

  test("output without a limit error stores nothing", () => {
    expect(lim.recordFromText("ERROR: 401 Unauthorized")).toBeNull();
    expect(fs.existsSync(STATE)).toBe(false);
  });

  test("an unreadable state file never blocks Codex", () => {
    fs.writeFileSync(STATE, "{broken");
    expect(lim.activeLimit()).toBeNull();
    expect(fs.existsSync(STATE)).toBe(false);
  });
});

// ── codex-safe.sh end to end with a fake `codex` ──────────────────────────
const bashOk = (() => {
  const r = spawnSync("bash", ["-c", "command -v timeout && command -v node"], { encoding: "utf8" });
  return r.status === 0 && !/system32/i.test(r.stdout);
})();

const fakeBin = path.join(dir, "bin");
fs.mkdirSync(fakeBin, { recursive: true });
const writeFakeCodex = (body) => {
  const f = path.join(fakeBin, "codex");
  fs.writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(f, 0o755);
};
const runSafe = (args = ["review this"], extraEnv = {}) => {
  const sep = process.platform === "win32" ? ";" : ":";
  return spawnSync("bash", [SAFE, ...args], {
    encoding: "utf8",
    input: "",
    timeout: 30000,
    env: { ...process.env, CODEX_LIMIT_FILE: STATE, PATH: `${fakeBin}${sep}${process.env.PATH}`, ...extraEnv },
  });
};

describe.skipIf(!bashOk)("codex-safe.sh — usage limit is remembered", () => {
  test("a limit that hangs Codex is caught live, stored, rc 75 well before the ceiling", () => {
    const future = new Date(Date.now() + 5 * 86400e3);
    const mon = future.toLocaleString("en-US", { month: "short" });
    writeFakeCodex(`echo "ERROR: You've hit your usage limit or try again at ${mon} ${future.getDate()}th, ${future.getFullYear()} 3:04 PM." >&2\nsleep 60`);
    const t0 = Date.now();
    const r = runSafe(["review"], { CODEX_SAFE_TIMEOUT: "40" });
    expect(r.status).toBe(75);
    expect(Date.now() - t0).toBeLessThan(20000);
    expect(r.stderr).toMatch(/skipping Codex until/);
    expect(JSON.parse(fs.readFileSync(STATE, "utf8")).resetKnown).toBe(true);
  }, 30000);

  test("a stored limit skips Codex instantly without invoking it", () => {
    lim.recordFromText("ERROR: You've hit your usage limit or try again in 2 days.");
    writeFakeCodex(`touch "${path.join(dir, "invoked").replace(/\\/g, "/")}"; echo ok`);
    const r = runSafe();
    expect(r.status).toBe(75);
    expect(r.stderr).toMatch(/usage limit active until/);
    expect(fs.existsSync(path.join(dir, "invoked"))).toBe(false);
  });

  test("after the reset time Codex runs again and the entry is gone", () => {
    fs.writeFileSync(STATE, JSON.stringify({ resetAt: new Date(Date.now() - 60e3).toISOString() }));
    writeFakeCodex("echo clean");
    const r = runSafe();
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("clean");
    expect(fs.existsSync(STATE)).toBe(false);
  });

  test("--reset-limit clears a stored limit early (plan bought)", () => {
    lim.recordFromText("ERROR: You've hit your usage limit or try again in 2 days.");
    const r = runSafe(["--reset-limit"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/cleared/);
    expect(fs.existsSync(STATE)).toBe(false);
  });

  test("other Codex errors keep their rc and store nothing", () => {
    writeFakeCodex('echo "ERROR: 401 Unauthorized" >&2; exit 3');
    const r = runSafe();
    expect(r.status).toBe(3);
    expect(fs.existsSync(STATE)).toBe(false);
  });

  test("stdin is forwarded to Codex (the `-` prompt form)", () => {
    writeFakeCodex("cat");
    const sep = process.platform === "win32" ? ";" : ":";
    const r = spawnSync("bash", [SAFE, "-"], {
      encoding: "utf8",
      input: "prompt via stdin",
      env: { ...process.env, CODEX_LIMIT_FILE: STATE, PATH: `${fakeBin}${sep}${process.env.PATH}` },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("prompt via stdin");
  });
});

test("CLI: status and check agree", () => {
  const env = { ...process.env, CODEX_LIMIT_FILE: STATE };
  expect(spawnSync("node", [LIMIT_JS, "check"], { env }).status).toBe(1);
  lim.recordFromText("ERROR: You've hit your usage limit or try again in 3 hours.");
  expect(spawnSync("node", [LIMIT_JS, "check"], { env }).status).toBe(0);
  expect(spawnSync("node", [LIMIT_JS, "status"], { env, encoding: "utf8" }).stdout).toMatch(/active until/);
});
