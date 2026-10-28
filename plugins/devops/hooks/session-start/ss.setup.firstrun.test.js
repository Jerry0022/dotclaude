import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..", "..");
const { build } = require("./ss.setup.firstrun.js");
const setup = require("../lib/devops-setup.js");

const tmp = [];
const mkHome = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "setup-fr-"));
  tmp.push(d);
  return d;
};
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true });
});
const ok = { missing: [], winget: [] };

describe("ss.setup.firstrun offer", () => {
  test("first startup offers once, then never again", () => {
    const home = mkHome();
    const first = build({ source: "startup", home, env: {}, prereqs: ok });
    expect(first).toContain("devops:auto-setup");
    expect(first).toContain("devops setup");
    expect(fs.existsSync(setup.markerPath(home))).toBe(true);
    expect(build({ source: "startup", home, env: {}, prereqs: ok })).toBeNull();
  });

  test("resume / clear / compact never offer and never write the marker", () => {
    const home = mkHome();
    for (const source of ["resume", "clear", "compact"]) {
      expect(build({ source, home, env: {}, prereqs: ok })).toBeNull();
    }
    expect(fs.existsSync(setup.markerPath(home))).toBe(false);
  });

  test("CI and the opt-out env stay silent", () => {
    const home = mkHome();
    expect(build({ source: "startup", home, env: { CI: "1" }, prereqs: ok })).toBeNull();
    expect(build({ source: "startup", home, env: { DEVOPS_NO_SETUP_OFFER: "1" }, prereqs: ok })).toBeNull();
  });

  test("missing prerequisites name the winget commands and the restart, every session", () => {
    const home = mkHome();
    setup.recordOffer(home);
    const pre = { missing: ["git", "git-bash"], winget: ["winget install Git.Git"] };
    for (const source of ["startup", "resume"]) {
      const ctx = build({ source, home, env: {}, prereqs: pre });
      expect(ctx).toContain("winget install Git.Git");
      expect(ctx).toMatch(/restart/i);
    }
  });
});

describe("checkPrereqs", () => {
  const gitOk = () => ({ status: 0 });
  const gitMissing = () => ({ status: null, error: new Error("ENOENT") });
  test("all present", () => {
    const r = setup.checkPrereqs({ platform: "win32", env: { ProgramFiles: "C:\\P" }, exists: () => true, run: gitOk });
    expect(r.missing).toEqual([]);
  });
  test("no git on Windows: git + git-bash, one winget line", () => {
    const r = setup.checkPrereqs({ platform: "win32", env: {}, exists: () => false, run: gitMissing });
    expect(r.missing).toEqual(["git", "git-bash"]);
    expect(r.winget).toEqual(["winget install Git.Git"]);
  });
  test("Git Bash is not required off Windows", () => {
    const r = setup.checkPrereqs({ platform: "linux", env: {}, exists: () => false, run: gitOk });
    expect(r.missing).toEqual([]);
  });
  test("old node is reported with its winget command", () => {
    const r = setup.checkPrereqs({ platform: "linux", env: {}, run: gitOk, nodeVersion: "16.20.0" });
    expect(r.missing).toEqual(["node"]);
    expect(r.winget).toEqual(["winget install OpenJS.NodeJS.LTS"]);
  });
});

describe("setup writers", () => {
  test("language keeps other keys and rejects unknown codes", () => {
    const home = mkHome();
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), '{"theme":"dark"}');
    setup.setLanguage("de", home);
    const s = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    expect(s).toEqual({ theme: "dark", language: "german" });
    expect(() => setup.setLanguage("xx", home)).toThrow();
  });

  test("an unparseable settings.json is refused, not overwritten", () => {
    const home = mkHome();
    fs.mkdirSync(path.join(home, ".claude"));
    const f = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(f, "{ broken");
    expect(() => setup.setLanguage("en", home)).toThrow();
    expect(fs.readFileSync(f, "utf8")).toBe("{ broken");
  });

  test("quiet installs the template, selects it, keeps a customized copy", () => {
    const home = mkHome();
    const r = setup.installQuiet(pluginRoot, home);
    expect(r.copied).toBe(true);
    const settings = () => JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    expect(settings().outputStyle).toBe("Quiet");
    fs.writeFileSync(r.file, "mine");
    const again = setup.installQuiet(pluginRoot, home);
    expect(again.keptCustom).toBe(true);
    expect(fs.readFileSync(r.file, "utf8")).toBe("mine");
  });

  test("delegation writes a record lib/delegation.js accepts", () => {
    const home = mkHome();
    const r = setup.setDelegation("ask", { scope: "global", home });
    expect(JSON.parse(fs.readFileSync(r.file, "utf8"))).toEqual({ mode: "ask" });
    expect(() => setup.setDelegation("bogus", { home })).toThrow();
  });
});

describe("auto-setup skill text", () => {
  const text = fs.readFileSync(path.join(pluginRoot, "skills", "auto-setup", "SKILL.md"), "utf8");
  test("covers every topic and both always/choice phrasings in both languages", () => {
    for (const s of ["Quiet", "get_usage", "api-credits.md", "delegation", "language", "Gilt dann immer", "Applies always", "Hängt von deiner Wahl ab", "Depends on your choice"]) {
      expect(text).toContain(s);
    }
  });
  test("writes only through the scripts, never by hand", () => {
    expect(text).toContain("scripts/devops-setup.js");
    expect(text).toContain("devops-config.js");
  });
});
