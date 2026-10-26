import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.redirect.scope.js");
const { outsideTargets, stripHeredocs } = createRequire(import.meta.url)("./pre.redirect.scope.js");

// Fake repo that is not under a temp root, so `..` is a genuine outside path.
const ROOT = path.resolve(os.homedir(), "zz-redirect-scope", "repo").replace(/\\/g, "/");
const outside = (cmd) => outsideTargets(cmd, ROOT, ROOT);

describe("pre.redirect.scope — outsideTargets", () => {
  test.each([
    "npm ci > ../npmci.log 2>&1",
    "next build >> ../../build.log",
    "npm test &> ../x.log",
    "echo hi > ~/notes.txt",
    "npm ci 1> ../a.log",
  ])("warns: %s", (cmd) => {
    expect(outside(cmd).length).toBe(1);
  });

  test.each([
    "npm test > out.log",
    "npm test > ./logs/out.log 2>&1",
    "npm test > /dev/null 2>&1",
    "npm test 2>&1",
    "npm test > NUL",
    `npm test > "${os.tmpdir().replace(/\\/g, "/")}/x.log"`,
    "npm test > /tmp/x.log",
    "npm test > $TMPDIR/x.log",
    "npm test > $LOG",
    `echo "a > ../b" && echo 'c > ../d'`,
    "cat <<'EOF'\nx > ../y.log\nEOF",
    "node a.js 2>/dev/null | grep x",
  ])("stays quiet: %s", (cmd) => {
    expect(outside(cmd)).toEqual([]);
  });

  test("stripHeredocs keeps the command line", () => {
    expect(stripHeredocs("cat <<EOF > a.log\nbody > ../z\nEOF\necho done")).toBe("cat <<EOF > a.log\necho done");
  });
});

describe("pre.redirect.scope — hook process", () => {
  function project() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redirscope-"));
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    return dir;
  }
  function run(dir, command, sid) {
    const payload = JSON.stringify({ cwd: dir, tool_name: "Bash", tool_input: { command }, session_id: sid });
    const env = { ...process.env };
    delete env.CLAUDE_PLUGIN_ROOT;
    const r = spawnSync(process.execPath, [HOOK], { cwd: dir, input: payload, encoding: "utf8", env });
    return { code: r.status, out: r.stdout || "" };
  }

  test("warns once per target, never denies, exit 0", () => {
    const dir = project();
    const sid = `rs-${process.pid}-${Date.now()}`;
    const target = path.resolve(os.homedir(), "zz-redirect-scope-out.log").replace(/\\/g, "/");
    const first = run(dir, `npm ci > ${target}`, sid);
    expect(first.code).toBe(0);
    const ctx = JSON.parse(first.out).hookSpecificOutput;
    expect(ctx.hookEventName).toBe("PreToolUse");
    expect(ctx.additionalContext).toContain("scratchpad");
    expect(run(dir, `npm ci > ${target}`, sid).out).toBe("");
  });

  test("silent for in-repo and garbage input", () => {
    const dir = project();
    expect(run(dir, "npm ci > build.log", "rs-quiet").out).toBe("");
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(0);
  });
});
