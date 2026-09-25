import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { detectGitInitTargets } = require("./git-init-detect.js");

const CWD = process.platform === "win32" ? "C:\\work\\proj" : "/work/proj";
const join = (...parts) => require("node:path").resolve(...parts);

describe("git-init-detect — finds git init invocations in a shell command", () => {
  test("plain `git init` targets cwd", () => {
    expect(detectGitInitTargets("git init", CWD)).toEqual([CWD]);
  });

  test("`git init <dir>` targets cwd/<dir>", () => {
    expect(detectGitInitTargets("git init sub", CWD)).toEqual([join(CWD, "sub")]);
  });

  test("`git -C <dir> init` targets <dir>", () => {
    expect(detectGitInitTargets("git -C sub init", CWD)).toEqual([join(CWD, "sub")]);
  });

  test("`git -C <dir> init <sub>` combines both", () => {
    expect(detectGitInitTargets("git -C a init b", CWD)).toEqual([join(CWD, "a", "b")]);
  });

  test("an absolute -C directory is used as-is", () => {
    const abs = process.platform === "win32" ? "C:\\elsewhere" : "/elsewhere";
    expect(detectGitInitTargets(`git -C ${abs} init`, CWD)).toEqual([abs]);
  });

  test("chained with && after another command", () => {
    expect(detectGitInitTargets("mkdir sub && git -C sub init", CWD)).toEqual([join(CWD, "sub")]);
  });

  test("wrapped in env/sudo/time", () => {
    expect(detectGitInitTargets("sudo git init", CWD)).toEqual([CWD]);
    expect(detectGitInitTargets("env FOO=bar git init", CWD)).toEqual([CWD]);
  });

  test("flags after init are skipped when picking the target arg", () => {
    expect(detectGitInitTargets("git init --bare sub", CWD)).toEqual([join(CWD, "sub")]);
    expect(detectGitInitTargets("git init -q", CWD)).toEqual([CWD]);
  });

  test("no match: unrelated git subcommand, or init as a non-git word", () => {
    expect(detectGitInitTargets("git status", CWD)).toEqual([]);
    expect(detectGitInitTargets("npm run init", CWD)).toEqual([]);
    expect(detectGitInitTargets("", CWD)).toEqual([]);
    expect(detectGitInitTargets(undefined, CWD)).toEqual([]);
  });

  test("two git init calls in one command both resolve, de-duplicated", () => {
    expect(detectGitInitTargets("git -C a init && git -C a init", CWD)).toEqual([join(CWD, "a")]);
    expect(detectGitInitTargets("git -C a init && git -C b init", CWD)).toEqual([join(CWD, "a"), join(CWD, "b")]);
  });
});
