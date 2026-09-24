import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Spawns the real hook; the full suite runs many files in parallel.
vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.mcp.health.js");
const TOOL = "mcp__plugin_devops_dotclaude-completion__render_completion_card";

// Temp project with the plugin enabled (plugin-guard) and a private tmpdir, so
// no real server on this machine answers for the test. HOME points at the
// project too, so a real ~/.claude/plugins/.mcp-stale.json cannot interfere.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-health-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  return dir;
}

function run(dir) {
  const tmp = path.join(dir, ".tmp");
  return spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({ tool_name: TOOL, session_id: "s", cwd: dir }),
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: dir, USERPROFILE: dir },
  });
}

const deadPid = () => spawnSync(process.execPath, ["-e", "0"]).pid;

describe("pre.mcp.health — per-process heartbeats", () => {
  test("a live server of any session passes, even when the legacy file names a dead one", () => {
    const dir = project();
    const tmp = path.join(dir, ".tmp");
    fs.writeFileSync(path.join(tmp, `dotclaude-mcp-dotclaude-completion-${process.pid}.pid`), String(process.pid));
    fs.writeFileSync(path.join(tmp, "dotclaude-mcp-dotclaude-completion.pid"), String(deadPid()));
    expect(run(dir).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("no heartbeat file at all passes (server never registered)", () => {
    const dir = project();
    expect(run(dir).status).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("only dead servers → blocks and removes every dead file", () => {
    const dir = project();
    const tmp = path.join(dir, ".tmp");
    const pid = deadPid();
    const own = path.join(tmp, `dotclaude-mcp-dotclaude-completion-${pid}.pid`);
    const legacy = path.join(tmp, "dotclaude-mcp-dotclaude-completion.pid");
    fs.writeFileSync(own, String(pid));
    fs.writeFileSync(legacy, String(pid));
    const res = run(dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/MCP SERVER DOWN/);
    expect(fs.existsSync(own)).toBe(false);
    expect(fs.existsSync(legacy)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
