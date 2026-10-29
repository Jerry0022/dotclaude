import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parkedConceptPaths } from "./git.js";

// Real temp repo (git.test.js mocks child_process, so this lives apart).
describe("parkedConceptPaths (#952)", () => {
  test("lists concept paths only on a parked autosave ref, naming the ref", () => {
    const dir = mkdtempSync(join(tmpdir(), "parked-"));
    const run = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", windowsHide: true });
    try {
      run("init", "-q", "-b", "main");
      run("config", "user.email", "t@t");
      run("config", "user.name", "t");
      mkdirSync(join(dir, "docs/concepts"), { recursive: true });
      writeFileSync(join(dir, "docs/concepts/kept.html"), "k");
      run("add", ".");
      run("commit", "-qm", "base");
      run("checkout", "-q", "-b", "parked/autosave/s1");
      writeFileSync(join(dir, "docs/concepts/stranded.html"), "s");
      run("add", ".");
      run("commit", "-qm", "park");
      run("checkout", "-q", "main");
      expect(parkedConceptPaths("main", { cwd: dir })).toEqual([
        { ref: "parked/autosave/s1", path: "docs/concepts/stranded.html" },
      ]);
      expect(parkedConceptPaths("main", { cwd: dir }, 0)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no parked refs -> []", () => {
    const dir = mkdtempSync(join(tmpdir(), "parked-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, windowsHide: true });
      expect(parkedConceptPaths("main", { cwd: dir })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
