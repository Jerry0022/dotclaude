import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cfg = require("./devops-config.js");

const SCRIPT = path.resolve(import.meta.dirname, "..", "..", "scripts", "devops-config.js");

const tmp = [];
function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true });
});

/** A fake clone: main checkout with a `.git` dir and one linked worktree (no git needed). */
function fakeClone() {
  const main = mkTmp("cfg-main-");
  const admin = path.join(main, ".git", "worktrees", "wt");
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(path.join(admin, "commondir"), "../..\n");
  const wt = path.join(main, ".claude", "worktrees", "wt");
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${admin}\n`);
  return { main, wt };
}

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
};

describe("devops-config — resolution project > global > default", () => {
  test("defaults when neither file exists", () => {
    const { main } = fakeClone();
    const { values, sources } = cfg.load(main, { home: mkTmp("cfg-home-") });
    expect(values.cleanup).toEqual({
      autoClean: true, autoCleanGateDays: 30, autoCleanMinAgeDays: 7,
      nudge: true, nudgeThreshold: 50, nudgeCooldownDays: 7,
    });
    expect(sources["cleanup.nudgeThreshold"]).toBe("default");
  });

  test("global beats default, project beats global, per key", () => {
    const { main } = fakeClone();
    const home = mkTmp("cfg-home-");
    write(path.join(home, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: 80, autoClean: false } });
    write(path.join(main, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: 20 } });
    const { values, sources } = cfg.load(main, { home });
    expect(values.cleanup.nudgeThreshold).toBe(20);
    expect(sources["cleanup.nudgeThreshold"]).toBe("project");
    expect(values.cleanup.autoClean).toBe(false);
    expect(sources["cleanup.autoClean"]).toBe("global");
    expect(sources["cleanup.nudge"]).toBe("default");
  });

  test("a linked worktree reads the MAIN checkout's project file, never its own copy", () => {
    const { main, wt } = fakeClone();
    const home = mkTmp("cfg-home-");
    write(path.join(main, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: 33 } });
    write(path.join(wt, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: 99 } });
    expect(cfg.mainCheckoutRoot(wt)).toBe(main);
    expect(cfg.load(wt, { home }).values.cleanup.nudgeThreshold).toBe(33);
  });

  test("an invalid stored value falls through to the next layer; a broken file counts as absent", () => {
    const { main } = fakeClone();
    const home = mkTmp("cfg-home-");
    write(path.join(home, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: 70 } });
    write(path.join(main, ".claude", "devops-config.json"), { cleanup: { nudgeThreshold: -5, autoClean: "no" } });
    const { values } = cfg.load(main, { home });
    expect(values.cleanup.nudgeThreshold).toBe(70);
    expect(values.cleanup.autoClean).toBe(true);
    fs.writeFileSync(path.join(main, ".claude", "devops-config.json"), "{ not json");
    expect(cfg.load(main, { home }).values.cleanup.nudgeThreshold).toBe(70);
  });
});

describe("devops-config — parse, set, unset", () => {
  test.each([
    ["cleanup.autoClean", "ja", true], ["cleanup.autoClean", "off", false], ["cleanup.nudge", "true", true],
    ["cleanup.nudgeThreshold", "80", 80], ["cleanup.nudgeCooldownDays", "0", 0],
  ])("%s = %j → %j", (key, raw, want) => {
    expect(cfg.parseValue(key, raw)).toBe(want);
  });

  test.each([
    ["cleanup.nudgeThreshold", "0"], ["cleanup.nudgeThreshold", "1.5"], ["cleanup.autoClean", "vielleicht"],
    ["cleanup.autoCleanGateDays", "-1"],
  ])("%s = %j is rejected with the valid range", (key, raw) => {
    expect(() => cfg.parseValue(key, raw)).toThrow(/expected/);
  });

  test("an unknown key is rejected and the valid keys are named", () => {
    expect(() => cfg.parseValue("cleanup.treshold", "5")).toThrow(/cleanup\.nudgeThreshold/);
    expect(() => cfg.parseValue("cleanup", "5")).toThrow(/unknown setting/);
  });

  test("set and unset round-trip per scope and keep other keys", () => {
    const { main } = fakeClone();
    const home = mkTmp("cfg-home-");
    cfg.setValue("cleanup.nudgeThreshold", "80", "project", main, { home });
    cfg.setValue("cleanup.autoClean", "aus", "global", main, { home });
    let { values } = cfg.load(main, { home });
    expect(values.cleanup.nudgeThreshold).toBe(80);
    expect(values.cleanup.autoClean).toBe(false);
    expect(cfg.unsetValue("cleanup.nudgeThreshold", "project", main, { home }).removed).toBe(true);
    expect(cfg.unsetValue("cleanup.nudgeThreshold", "project", main, { home }).removed).toBe(false);
    ({ values } = cfg.load(main, { home }));
    expect(values.cleanup.nudgeThreshold).toBe(50);
    expect(values.cleanup.autoClean).toBe(false);
    expect(() => cfg.setValue("cleanup.nudge", "true", "everywhere", main, { home })).toThrow(/scope/);
  });
});

describe("scripts/devops-config.js — the CLI Claude calls", () => {
  const run = (args, env) => execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env },
  });

  test("set needs an explicit scope; with one it writes and list shows the source", () => {
    const { main } = fakeClone();
    const home = mkTmp("cfg-home-");
    const env = { HOME: home, USERPROFILE: home };
    expect(() => run(["set", "cleanup.nudgeThreshold", "80", "--cwd", main], env)).toThrow();
    expect(run(["set", "cleanup.nudgeThreshold", "80", "--project", "--cwd", main], env)).toContain("cleanup.nudgeThreshold = 80");
    const list = run(["list", "--cwd", main], env);
    expect(list).toContain("cleanup.nudgeThreshold = 80  (project; default 50)");
    expect(JSON.parse(run(["list", "--json", "--cwd", main], env)).values.cleanup.nudgeThreshold).toBe(80);
  });

  test("an invalid value exits non-zero with the reason", () => {
    const { main } = fakeClone();
    const home = mkTmp("cfg-home-");
    let err = "";
    try {
      run(["set", "cleanup.nudgeThreshold", "viele", "--global", "--cwd", main], { HOME: home, USERPROFILE: home });
    } catch (e) {
      err = String(e.stderr);
    }
    expect(err).toMatch(/invalid value "viele"/);
  });
});
