import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseArgs } = require("./deploy-parity.js");
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "deploy-parity.js");

describe("scripts/deploy-parity.js — parseArgs", () => {
  test("camel-cases value flags, splits --pass-env, validates the timeout", () => {
    expect(parseArgs(["--cwd", "x", "--build-cmd", "make", "--pass-env", "A, B", "--timeout-sec", "90", "--force"]))
      .toEqual({ cwd: "x", buildCmd: "make", passEnv: ["A", "B"], timeoutSec: 90, force: true });
    expect(() => parseArgs(["--timeout-sec", "0"])).toThrow(/positive integer/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--cwd"])).toThrow(/needs a value/);
  });
});

describe("scripts/deploy-parity.js — CLI", () => {
  let dir;
  const git = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "parity-cli-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(3)\"" } }));
    git(["init", "-q", "-b", "main"]);
    git(["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "a"]);
    git(["add", "-A"]);
    git(["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "b"]);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const run = (...args) => spawnSync(process.execPath, [SCRIPT, "--cwd", dir, ...args], { encoding: "utf8", timeout: 60_000 });

  test("a failed build exits 1, prints JSON and writes --out", () => {
    const out = join(dir, "..", `parity-${Date.now()}.json`);
    const r = run("--install-cmd", "", "--out", out);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: "failed" });
    expect(JSON.parse(readFileSync(out, "utf8")).status).toBe("failed");
    rmSync(out, { force: true });
  }, 60_000);

  test("devops-config deployParity.enabled=false skips unless --force", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "devops-config.json"), JSON.stringify({ deployParity: { enabled: false } }));
    let r = run();
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/disabled/) });
    r = run("--force", "--install-cmd", "");
    expect(r.status).toBe(1);
  }, 60_000);

  test("usage errors exit 2", () => {
    expect(run("--bogus").status).toBe(2);
  });
});
