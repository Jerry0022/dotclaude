import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.project.setup.js");
const { run } = require("./post.project.setup.js");

const tmp = [];
function mkTmp(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true });
});

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

/** Project dir whose settings enable the plugin (plugin-guard) for spawned runs. */
function project() {
  const dir = mkTmp("post-project-setup-");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

function runHook(dir, { command, sessionId = "s1", extraEnv = {} } = {}) {
  const tmpDir = mkTmp("post-project-setup-tmp-");
  const home = mkTmp("post-project-setup-home-");
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      cwd: dir,
    }),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmpDir, TEMP: tmpDir, TMP: tmpDir, HOME: home, USERPROFILE: home, ...extraEnv },
  });
  return { ...res, home };
}

describe("post.project.setup — unit: run() on an in-process payload", () => {
  test("ignores non-shell tools", () => {
    expect(run(JSON.stringify({ tool_name: "Write", tool_input: { command: "git init" } }))).toBe("");
  });

  test("ignores a command without git init", () => {
    expect(run(JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" }, cwd: "/tmp" }))).toBe("");
  });

  test("unusable stdin never throws", () => {
    expect(run("not json")).toBe("");
    expect(run("")).toBe("");
  });
});

describe("post.project.setup — e2e: git init mid-session triggers the same offer as ss.project.setup", () => {
  test("`git init` in a fresh folder writes the exclude block and offers setup once", () => {
    const dir = project();
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");

    const first = runHook(dir, { command: "git init" });
    expect(first.status).toBe(0);
    const out = JSON.parse(first.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(out.hookSpecificOutput.additionalContext).toContain("New repository");
    expect(out.hookSpecificOutput.additionalContext).toContain("no commit yet");

    const exclude = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("devops");

    const statePath = path.join(first.home, ".claude", "devops-project-setup.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    expect(Object.keys(state.offered)).toHaveLength(1);

    // A repeated `git init` in the same clone (same HOME) does not offer again.
    const second = runHook(dir, { command: "git init", extraEnv: { HOME: first.home, USERPROFILE: first.home } });
    expect(second.stdout.trim()).toBe("");
  });

  test("`git -C <dir> init` targets the named directory, not the session cwd", () => {
    const outer = project();
    const sub = path.join(outer, "sub");
    fs.mkdirSync(sub, { recursive: true });
    git(sub, "init", "-q", "-b", "main");

    const res = runHook(outer, { command: `git -C sub init` });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.additionalContext).toContain(sub.replace(/\\/g, "/"));
    expect(fs.existsSync(path.join(sub, ".git", "info", "exclude"))).toBe(true);
    expect(fs.existsSync(path.join(outer, ".git"))).toBe(false);
  });

  test("re-init of an established repo (has a commit and .gitignore) gets no offer", () => {
    const dir = project();
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");

    const res = runHook(dir, { command: "git init" });
    expect(res.stdout.trim()).toBe("");
  });

  test("a command without git init produces no output at all", () => {
    const dir = project();
    const res = runHook(dir, { command: "npm test" });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });
});
