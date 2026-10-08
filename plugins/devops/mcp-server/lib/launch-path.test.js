import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLaunchPath } from "./launch-path.js";

const dirs = [];
function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "launch-path-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("detectLaunchPath (#680)", () => {
  test("no cwd → null", () => {
    expect(detectLaunchPath(undefined)).toBeNull();
    expect(detectLaunchPath(null)).toBeNull();
    expect(detectLaunchPath("")).toBeNull();
  });

  test("a missing directory → null, never throws", () => {
    expect(detectLaunchPath(join(tmpdir(), "launch-path-does-not-exist-680"))).toBeNull();
  });

  test("an empty project → null", () => {
    expect(detectLaunchPath(project())).toBeNull();
  });

  test(".claude/launch.json with a configuration", () => {
    expect(detectLaunchPath(project({ ".claude/launch.json": { version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "npm" }] } }))).toBe("launch.json");
  });

  test(".claude/launch.json without configurations or malformed → not a launch path", () => {
    expect(detectLaunchPath(project({ ".claude/launch.json": { configurations: [] } }))).toBeNull();
    expect(detectLaunchPath(project({ ".claude/launch.json": { version: "0.0.1" } }))).toBeNull();
    expect(detectLaunchPath(project({ ".claude/launch.json": "{ not json" }))).toBeNull();
  });

  test("scripts/run-local.* in any extension", () => {
    expect(detectLaunchPath(project({ "scripts/run-local.ps1": "echo" }))).toBe("run-local");
    expect(detectLaunchPath(project({ "scripts/run-local.sh": "echo" }))).toBe("run-local");
    expect(detectLaunchPath(project({ "scripts/run-localish.sh": "echo", "scripts/build.sh": "echo" }))).toBeNull();
  });

  test("package.json dev or start script", () => {
    expect(detectLaunchPath(project({ "package.json": { scripts: { dev: "vite" } } }))).toBe("npm-dev");
    expect(detectLaunchPath(project({ "package.json": { scripts: { start: "node ." } } }))).toBe("npm-start");
    expect(detectLaunchPath(project({ "package.json": { scripts: { test: "vitest", build: "tsc" } } }))).toBeNull();
    expect(detectLaunchPath(project({ "package.json": { scripts: { dev: "  " } } }))).toBeNull();
    expect(detectLaunchPath(project({ "package.json": "{ broken" }))).toBeNull();
  });

  test("launch.json wins over package.json", () => {
    expect(detectLaunchPath(project({
      ".claude/launch.json": { configurations: [{ name: "a" }] },
      "package.json": { scripts: { dev: "vite" } },
    }))).toBe("launch.json");
  });
});
