import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  bumpKind, versionOnlyOverlap, resolveVersionConflicts, rebaseVersionFiles,
} from "./version-rebase.js";

/** core.autocrlf checks files out with CRLF on Windows. */
const lf = (s) => s.replace(/\r\n/g, "\n");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

describe("version-rebase — pure helpers", () => {
  test("bumpKind", () => {
    expect(bumpKind("0.222.0", "0.223.0")).toBe("minor");
    expect(bumpKind("0.222.0", "0.222.1")).toBe("patch");
    expect(bumpKind("0.222.0", "1.0.0")).toBe("major");
    expect(bumpKind("0.222.0", "0.222.0")).toBe("none");
  });

  test("versionOnlyOverlap", () => {
    expect(versionOnlyOverlap([])).toBe(true);
    expect(versionOnlyOverlap(["CHANGELOG.md", "README.md", ".claude-plugin/marketplace.json", "plugins/x/.claude-plugin/plugin.json"])).toBe(true);
    expect(versionOnlyOverlap(["CHANGELOG.md", "src/app.js"])).toBe(false);
  });

  test("a hunk that differs only in version numbers takes the base's side", () => {
    const c = ['{', '<<<<<<< HEAD', '  "version": "0.223.0"', '||||||| base', '  "version": "0.222.0"', '=======', '  "version": "0.223.0"', '>>>>>>> ours', '}'].join("\n");
    expect(resolveVersionConflicts(c, "plugin.json")).toBe('{\n  "version": "0.223.0"\n}');
  });

  test("two new CHANGELOG entries: ours on top of the base's", () => {
    const c = ["# Changelog", "", "<<<<<<< HEAD", "## [0.223.0] — theirs", "- a", "", "||||||| base", "=======", "## [0.223.0] — ours", "- b", "", ">>>>>>> ours", "## [0.222.0]"].join("\n");
    const r = resolveVersionConflicts(c, "CHANGELOG.md");
    expect(r).toBe(["# Changelog", "", "## [0.223.0] — ours", "- b", "", "## [0.223.0] — theirs", "- a", "", "## [0.222.0]"].join("\n"));
  });

  test("any other hunk is refused", () => {
    const readme = ["<<<<<<< HEAD", "- 12 hooks", "||||||| base", "- 11 hooks", "=======", "- 10 hooks and a new line", ">>>>>>> ours"].join("\n");
    expect(resolveVersionConflicts(readme, "README.md")).toBeNull();
    const changelogEdit = ["<<<<<<< HEAD", "- fixed x", "||||||| base", "- x", "=======", "- fixed y", ">>>>>>> ours"].join("\n");
    expect(resolveVersionConflicts(changelogEdit, "CHANGELOG.md")).toBeNull();
  });

  test("a JSON result that does not parse is refused", () => {
    const c = ['{', '<<<<<<< HEAD', '  "version": "1.0.0",', '||||||| base', '=======', '  "version": "1.0.1"', '>>>>>>> ours', '}'].join("\n");
    expect(resolveVersionConflicts(c, "package.json")).toBeNull();
  });
});

/**
 * Two ships from the same main: `theirs` lands first (0.1.0 → 0.2.0), then
 * `ours` (also 0.1.0 → 0.2.0) finds main moved.
 */
describe("version-rebase — two parallel ships in a real repo", () => {
  let root;
  let origin;
  let work;

  const pkg = (v) => JSON.stringify({ name: "demo", version: v }, null, 2) + "\n";
  const readme = (v, extra = "") => `# Demo\n\n**Version: ${v}**\n${extra}`;
  const changelog = (entries) => `# Changelog\n\n${entries.join("\n")}`;

  function commitAll(cwd, msg) { git(cwd, "add", "-A"); git(cwd, "commit", "-q", "-m", msg); }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vrebase-"));
    origin = join(root, "origin.git");
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    const seed = join(root, "seed");
    git(root, "clone", "-q", origin, seed);
    for (const c of [seed]) { git(c, "config", "user.email", "t@t"); git(c, "config", "user.name", "t"); }
    writeFileSync(join(seed, "package.json"), pkg("0.1.0"));
    writeFileSync(join(seed, "README.md"), readme("0.1.0"));
    writeFileSync(join(seed, "CHANGELOG.md"), changelog(["## [0.1.0]\n- start\n"]));
    writeFileSync(join(seed, "a.js"), "export const a = 1;\n");
    commitAll(seed, "init");
    git(seed, "push", "-q", "origin", "main");

    work = join(root, "work");
    git(root, "clone", "-q", origin, work);
    git(work, "config", "user.email", "t@t"); git(work, "config", "user.name", "t");
    git(work, "checkout", "-q", "-b", "feat/ours");
    writeFileSync(join(work, "b.js"), "export const b = 2;\n");
    writeFileSync(join(work, "package.json"), pkg("0.2.0"));
    writeFileSync(join(work, "README.md"), readme("0.2.0"));
    writeFileSync(join(work, "CHANGELOG.md"), changelog(["## [0.2.0]\n- ours: b\n", "## [0.1.0]\n- start\n"]));
    commitAll(work, "feat: b + release 0.2.0");

    // theirs lands on main first, same bump
    writeFileSync(join(seed, "c.js"), "export const c = 3;\n");
    writeFileSync(join(seed, "package.json"), pkg("0.2.0"));
    writeFileSync(join(seed, "README.md"), readme("0.2.0"));
    writeFileSync(join(seed, "CHANGELOG.md"), changelog(["## [0.2.0]\n- theirs: c\n", "## [0.1.0]\n- start\n"]));
    commitAll(seed, "feat: c + release 0.2.0");
    git(seed, "push", "-q", "origin", "main");
    git(work, "fetch", "-q", "origin", "main");
  });

  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ } });

  test("rebases, keeps both entries, bumps to 0.3.0", () => {
    const r = rebaseVersionFiles({ upstream: "origin/main", cwd: work });
    expect(r).toMatchObject({ ok: true, from: "0.2.0", to: "0.3.0", bump: "minor" });
    // Identical bumps merge on their own; only the two CHANGELOG entries collide.
    expect(r.resolved).toEqual(["CHANGELOG.md"]);
    expect(JSON.parse(readFileSync(join(work, "package.json"), "utf8")).version).toBe("0.3.0");
    expect(readFileSync(join(work, "README.md"), "utf8")).toContain("**Version: 0.3.0**");
    const cl = lf(readFileSync(join(work, "CHANGELOG.md"), "utf8"));
    expect(cl.indexOf("## [0.3.0]\n- ours: b")).toBeGreaterThan(-1);
    expect(cl.indexOf("## [0.3.0]")).toBeLessThan(cl.indexOf("## [0.2.0]\n- theirs: c"));
    expect(cl).not.toMatch(/<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|/);
    // Both sides' code is there, and the branch contains main.
    expect(readFileSync(join(work, "b.js"), "utf8")).toContain("b = 2");
    expect(readFileSync(join(work, "c.js"), "utf8")).toContain("c = 3");
    expect(git(work, "rev-list", "--count", "HEAD..origin/main")).toBe("0");
    expect(git(work, "status", "--porcelain")).toBe("");
  });

  test("different bumps on each side: the version files collide too and are resolved", () => {
    const seed = join(root, "seed");
    git(seed, "reset", "-q", "--hard", "HEAD~1");
    writeFileSync(join(seed, "c.js"), "export const c = 3;\n");
    writeFileSync(join(seed, "package.json"), pkg("0.1.1"));
    writeFileSync(join(seed, "README.md"), readme("0.1.1"));
    writeFileSync(join(seed, "CHANGELOG.md"), changelog(["## [0.1.1]\n- theirs: c\n", "## [0.1.0]\n- start\n"]));
    commitAll(seed, "fix: c + release 0.1.1");
    git(seed, "push", "-q", "--force", "origin", "main");
    git(work, "fetch", "-q", "origin", "main");
    const r = rebaseVersionFiles({ upstream: "origin/main", cwd: work });
    expect(r).toMatchObject({ ok: true, from: "0.2.0", to: "0.2.0", bump: "minor" });
    expect(r.resolved.sort()).toEqual(["CHANGELOG.md", "README.md", "package.json"]);
    expect(JSON.parse(readFileSync(join(work, "package.json"), "utf8")).version).toBe("0.2.0");
    const cl = lf(readFileSync(join(work, "CHANGELOG.md"), "utf8"));
    expect(cl.indexOf("## [0.2.0]\n- ours: b")).toBeGreaterThan(-1);
    expect(cl.indexOf("## [0.2.0]\n- ours: b")).toBeLessThan(cl.indexOf("## [0.1.1]\n- theirs: c"));
    expect(git(work, "status", "--porcelain")).toBe("");
  });

  test("a real code conflict is refused and the branch is left exactly as it was", () => {
    // Both sides edit a.js differently.
    writeFileSync(join(work, "a.js"), "export const a = 10;\n");
    commitAll(work, "ours edits a");
    const seed = join(root, "seed");
    writeFileSync(join(seed, "a.js"), "export const a = 20;\n");
    commitAll(seed, "theirs edits a");
    git(seed, "push", "-q", "origin", "main");
    git(work, "fetch", "-q", "origin", "main");
    const before = git(work, "rev-parse", "HEAD");
    const r = rebaseVersionFiles({ upstream: "origin/main", cwd: work });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("code-conflict");
    expect(r.files).toEqual(["a.js"]);
    expect(git(work, "rev-parse", "HEAD")).toBe(before);
    expect(git(work, "status", "--porcelain")).toBe("");
  });

  test("a README hunk that is more than a version is refused, branch restored", () => {
    writeFileSync(join(work, "README.md"), readme("0.2.0", "\n- ours: hook list\n"));
    commitAll(work, "ours readme");
    const seed = join(root, "seed");
    writeFileSync(join(seed, "README.md"), readme("0.2.0", "\n- theirs: other list\n"));
    commitAll(seed, "theirs readme");
    git(seed, "push", "-q", "origin", "main");
    git(work, "fetch", "-q", "origin", "main");
    const before = git(work, "rev-parse", "HEAD");
    const r = rebaseVersionFiles({ upstream: "origin/main", cwd: work });
    expect(r).toMatchObject({ ok: false, reason: "non-version-hunk", files: ["README.md"] });
    expect(git(work, "rev-parse", "HEAD")).toBe(before);
  });

  test("a dirty tree is never touched", () => {
    writeFileSync(join(work, "b.js"), "dirty\n");
    expect(rebaseVersionFiles({ upstream: "origin/main", cwd: work })).toEqual({ ok: false, reason: "dirty-tree" });
    expect(readFileSync(join(work, "b.js"), "utf8")).toBe("dirty\n");
  });
});
