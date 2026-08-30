import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Anti-decay suite for repo modes.
 *
 * The non-git support in this plugin was built once (#150, v0.73.0) and rotted
 * silently: the completion-card wiring was severed by schema drift and the
 * skill-level gates evaporated in a refactor, with nothing failing in between.
 * By v0.135.1 a non-git project got a fabricated "Detached HEAD" warning, and a
 * local repo without a remote could not be edited at all.
 *
 * These tests EXECUTE every SessionStart and UserPromptSubmit hook against two
 * purpose-built repos and assert the claims none of them may make. The hook
 * list is read from disk rather than hard-coded, so a newly added hook is
 * covered the day it lands — that dynamic enumeration is the anti-decay part.
 */

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

// Spawning ~60 node processes; give it real headroom on a loaded machine.
const SUITE_TIMEOUT = 180_000;

let noneDir;      // not a git repo at all
let noRemoteDir;  // git repo, commits, no origin

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeAll(() => {
  noneDir = mkdtempSync(join(tmpdir(), "repomode-none-"));
  writeFileSync(join(noneDir, "a.txt"), "hello\n");

  noRemoteDir = mkdtempSync(join(tmpdir(), "repomode-nrm-"));
  git(["init", "-q", "-b", "main", "."], noRemoteDir);
  git(["config", "user.email", "t@example.com"], noRemoteDir);
  git(["config", "user.name", "Test"], noRemoteDir);
  writeFileSync(join(noRemoteDir, "a.txt"), "one\n");
  git(["add", "."], noRemoteDir);
  git(["commit", "-qm", "c1"], noRemoteDir);
  writeFileSync(join(noRemoteDir, "b.txt"), "two\n");
  git(["add", "."], noRemoteDir);
  git(["commit", "-qm", "c2"], noRemoteDir);
}, SUITE_TIMEOUT);

afterAll(() => {
  for (const d of [noneDir, noRemoteDir]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** Every hook script under one lifecycle directory, discovered at run time. */
function hooksIn(subdir) {
  const dir = join(HOOKS_DIR, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => ({ name: `${subdir}/${f}`, path: join(dir, f) }));
}

/** Run one hook with a JSON payload on stdin; never throws. */
function runHook(hookPath, payload, cwd) {
  const res = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, DEVOPS_SKIP_SELFUPDATE: "1" },
  });
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    status: res.status,
  };
}

const sessionHooks = hooksIn("session-start");
const promptHooks = hooksIn("user-prompt-submit");

describe("mode 'none' — a directory that is not a git repo", () => {
  test("the hook set is non-empty (guards against a silently empty sweep)", () => {
    expect(sessionHooks.length).toBeGreaterThan(5);
    expect(promptHooks.length).toBeGreaterThan(5);
  });

  test.each([...sessionHooks, ...promptHooks])(
    "$name invents no git state",
    ({ path }) => {
      const out = runHook(
        path,
        { session_id: "regr-none", cwd: noneDir, prompt: "hallo", tool_name: "", tool_input: {} },
        noneDir,
      );
      const text = out.stdout + out.stderr;

      // The exact regression: currentBranch() returns null for BOTH "detached
      // HEAD" and "no repo", and the workspace check reported the former.
      expect(text).not.toMatch(/detached head/i);
      // Nothing may claim commits are waiting to be pushed somewhere.
      expect(text).not.toMatch(/unpushed commit/i);
      // No hook may leak a raw git failure to the user.
      expect(text).not.toMatch(/fatal: not a git repository/i);
    },
    SUITE_TIMEOUT,
  );
});

describe("mode 'git-no-remote' — a local repo with commits and no origin", () => {
  test.each([...sessionHooks, ...promptHooks])(
    "$name neither counts unpushed commits nor prescribes an origin",
    ({ path }) => {
      const out = runHook(
        path,
        { session_id: "regr-nrm", cwd: noRemoteDir, prompt: "hallo", tool_name: "", tool_input: {} },
        noRemoteDir,
      );
      const text = out.stdout + out.stderr;

      // `git log --not --remotes` subtracts an empty set without a remote, so
      // EVERY commit in the repo was reported as unpushed, every session.
      expect(text).not.toMatch(/unpushed commit/i);
      // A remedy that names origin cannot be carried out here.
      expect(text).not.toMatch(/git fetch origin/i);
      expect(text).not.toMatch(/origin\/main/);
    },
    SUITE_TIMEOUT,
  );
});

describe("branch guards stay usable without an origin", () => {
  const mainGuard = join(HOOKS_DIR, "pre-tool-use", "pre.main.guard.js");
  const editGuard = join(HOOKS_DIR, "pre-tool-use", "pre.edit.branch.js");

  test("pre.main.guard still blocks writes on main, but suggests an executable fix", () => {
    const out = runHook(
      mainGuard,
      { tool_name: "Bash", cwd: noRemoteDir, tool_input: { command: "git commit -m x" } },
      noRemoteDir,
    );
    // The block itself is correct — branch hygiene does not depend on a remote.
    expect(out.status).toBe(2);
    // ...but the escape hatch must be one the user can actually run.
    expect(out.stderr).toMatch(/git switch -c/);
    expect(out.stderr).not.toMatch(/git fetch origin/);
    expect(out.stderr).not.toMatch(/origin\/main/);
  });

  test("pre.edit.branch likewise", () => {
    const out = runHook(
      editGuard,
      { tool_name: "Edit", cwd: noRemoteDir, tool_input: { file_path: join(noRemoteDir, "a.txt") } },
      noRemoteDir,
    );
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/git switch -c/);
    expect(out.stderr).not.toMatch(/git fetch origin/);
  });

  test("the suggested local fix actually works", () => {
    const probe = mkdtempSync(join(tmpdir(), "repomode-fix-"));
    try {
      git(["init", "-q", "-b", "main", "."], probe);
      git(["config", "user.email", "t@example.com"], probe);
      git(["config", "user.name", "Test"], probe);
      writeFileSync(join(probe, "a.txt"), "x\n");
      git(["add", "."], probe);
      git(["commit", "-qm", "c1"], probe);
      // This is verbatim what the guard now prints.
      git(["switch", "-c", "feat/topic"], probe);
      const branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        cwd: probe, encoding: "utf8",
      }).trim();
      expect(branch).toBe("feat/topic");
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  test("with an origin, the remote-based fix is unchanged", () => {
    git(["remote", "add", "origin", "https://example.invalid/x.git"], noRemoteDir);
    try {
      const out = runHook(
        join(HOOKS_DIR, "pre-tool-use", "pre.main.guard.js"),
        { tool_name: "Bash", cwd: noRemoteDir, tool_input: { command: "git commit -m x" } },
        noRemoteDir,
      );
      expect(out.status).toBe(2);
      expect(out.stderr).toMatch(/git fetch origin && git switch -c <feat\/topic> origin\/main/);
    } finally {
      git(["remote", "remove", "origin"], noRemoteDir);
    }
  });
});

describe("the git-exclude idiom is guarded in every skill that uses it", () => {
  // Outside a repo the command substitution is empty, so the unguarded form
  // resolved to "/info/exclude" and wrote at the FILESYSTEM ROOT.
  const users = [
    "run-autonomous",
    "run-backlog",
    "claude-batch",
  ];

  test.each(users)("%s guards git-common-dir before using it", (skill) => {
    const file = join(HOOKS_DIR, "..", "skills", skill, "SKILL.md");
    const body = readFileSync(file, "utf8");
    expect(body).toMatch(/--git-common-dir/);
    // Never interpolated straight into a path that is then created.
    expect(body).not.toMatch(/x="\$\(git rev-parse --path-format=absolute --git-common-dir\)\/info\/exclude"/);
    // The empty result must be tested before anything is written.
    expect(body).toMatch(/if \[ -n "\$gcd" \]/);
  });

  test("the guarded form is a no-op outside a repo", () => {
    const res = spawnSync(
      "bash",
      ["-c", 'gcd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; if [ -n "$gcd" ]; then echo "WOULD-WRITE ${gcd}/info"; else echo "SKIPPED"; fi'],
      { cwd: noneDir, encoding: "utf8", timeout: 20_000 },
    );
    expect(res.stdout.trim()).toBe("SKIPPED");
  });
});
