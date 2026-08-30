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

/**
 * Of those, the ones that could possibly say something about git.
 *
 * Executing ALL of them in both modes meant ~60 node spawns, each also running
 * git. Alongside the other git-heavy suites that saturated the machine and made
 * UNRELATED tests time out — the suite guarding against decay was destabilising
 * the run it belongs to.
 *
 * A hook that never mentions git cannot invent git state, so skipping it loses
 * no coverage. The set is still derived at run time, and `covers every hook that
 * touches git` below fails if a newly added git-touching hook is missed — so the
 * anti-decay property survives the cost reduction.
 */
function touchesGit(hook) {
  return /\bgit\b/.test(readFileSync(hook.path, "utf8"));
}

/**
 * Hooks excluded from the sweep, each for a stated reason. Keep this list
 * empty unless a hook genuinely cannot make a claim about the CONSUMER repo.
 *
 * ss.plugin.update operates on the plugin's OWN marketplace clone under
 * ~/.claude/plugins, never on the passed cwd, so it cannot invent git state for
 * the project being worked on. It also performs a real network fetch, which
 * made it by far the slowest and most contended spawn in this suite — enough to
 * time out unrelated git suites running in parallel.
 */
const EXEMPT = new Map([
  ["session-start/ss.plugin.update.js", "operates on the plugin's own install, not the consumer repo; network-bound"],
]);

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

const allHooks = [...hooksIn("session-start"), ...hooksIn("user-prompt-submit")];
const gitHooks = allHooks.filter((h) => touchesGit(h) && !EXEMPT.has(h.name));

describe("coverage", () => {
  test("the sweep is non-empty (guards against a silently empty run)", () => {
    expect(allHooks.length).toBeGreaterThan(10);
    expect(gitHooks.length).toBeGreaterThan(3);
  });

  test("covers every git-touching hook that is not explicitly exempt", () => {
    // The anti-decay contract: a hook added later that mentions git is picked
    // up here automatically. Dropping one requires adding it to EXEMPT with a
    // reason — silence is not an option.
    const executed = new Set(gitHooks.map((h) => h.name));
    const missed = allHooks
      .filter(touchesGit)
      .filter((h) => !executed.has(h.name) && !EXEMPT.has(h.name));
    expect(missed.map((h) => h.name)).toEqual([]);
  });

  test("every exemption names a hook that still exists", () => {
    // A stale exemption would silently shrink coverage after a rename.
    const known = new Set(allHooks.map((h) => h.name));
    expect([...EXEMPT.keys()].filter((n) => !known.has(n))).toEqual([]);
  });
});

describe("mode 'none' — a directory that is not a git repo", () => {
  test.each(gitHooks)(
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
  test.each(gitHooks)(
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

  // The condition the guard keys on, asserted directly rather than through a
  // shell: `bash` is not reliably on PATH everywhere this suite runs (it is
  // absent in the ship pipeline's build step), and spawning a missing binary
  // yields an undefined stdout rather than a useful failure.
  function gitCommonDir(cwd) {
    try {
      return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
        cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000,
      }).trim();
    } catch {
      return "";
    }
  }

  test("outside a repo the substitution is empty, so the guard skips", () => {
    // Empty is precisely what made the unguarded `x="$(...)/info/exclude"`
    // resolve to "/info/exclude" and write at the filesystem root.
    expect(gitCommonDir(noneDir)).toBe("");
  });

  test("inside a repo it resolves, so the guard still writes", () => {
    const gcd = gitCommonDir(noRemoteDir);
    expect(gcd).not.toBe("");
    expect(gcd).toMatch(/\.git$/);
  });
});
