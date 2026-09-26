import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

  test("a lone dead per-process file with no legacy corroboration fails open (another session's leftover)", () => {
    const dir = project();
    const tmp = path.join(dir, ".tmp");
    const pid = deadPid();
    const leftover = path.join(tmp, `dotclaude-mcp-dotclaude-completion-${pid}.pid`);
    fs.writeFileSync(leftover, String(pid));
    // No legacy file at all — this is exactly the shape a hard-killed
    // NEWER-version server from a different session leaves behind while an
    // older, never-heartbeating completion server (pre-0.3.0 / #93) is still
    // alive and serving this session's calls.
    const res = run(dir);
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/inconclusive/i);
    // Fails open without deleting evidence that may still matter elsewhere.
    expect(fs.existsSync(leftover)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a dead legacy file alone (no per-process file) still blocks as DOWN", () => {
    const dir = project();
    const tmp = path.join(dir, ".tmp");
    const pid = deadPid();
    const legacy = path.join(tmp, "dotclaude-mcp-dotclaude-completion.pid");
    fs.writeFileSync(legacy, String(pid));
    const res = run(dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/MCP SERVER DOWN/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Stale-after-update sentinel (finding 14a): a shared, cross-session
// heartbeat state must not let one session's evidence permanently silence
// another session's stale block.
// ---------------------------------------------------------------------------

function writeSentinel(dir, mtime) {
  const pluginsDir = path.join(dir, ".claude", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const file = path.join(pluginsDir, ".mcp-stale.json");
  fs.writeFileSync(file, JSON.stringify({ plugins: [{ name: "devops", from: "0.1.0", to: "0.2.0" }] }));
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe("pre.mcp.health — stale-after-update sentinel", () => {
  test("a respawned server passes but the shared sentinel is not deleted, so the block reappears once no live respawn is left", () => {
    const dir = project();
    const tmp = path.join(dir, ".tmp");
    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);
    const sentinel = writeSentinel(dir, before);
    const own = path.join(tmp, `dotclaude-mcp-dotclaude-completion-${process.pid}.pid`);
    fs.writeFileSync(own, String(process.pid));
    fs.utimesSync(own, after, after);

    // A live server newer than the sentinel passes this call...
    const first = run(dir);
    expect(first.status).toBe(0);
    // ...and must NOT delete the sentinel out from under other sessions.
    expect(fs.existsSync(sentinel)).toBe(true);

    // Once that respawn is no longer live evidence (server now dead, no
    // other live PID exists), the very same sentinel blocks again.
    const pid = deadPid();
    fs.writeFileSync(own, String(pid));
    const second = run(dir);
    expect(second.status).toBe(2);
    expect(second.stderr).toMatch(/MCP SERVER STALE/);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a malformed sentinel is deleted and does not block", () => {
    const dir = project();
    const pluginsDir = path.join(dir, ".claude", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    const file = path.join(pluginsDir, ".mcp-stale.json");
    fs.writeFileSync(file, "{not json");
    const res = run(dir);
    expect(res.status).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a sentinel naming only another plugin does not block and is kept", () => {
    const dir = project();
    const pluginsDir = path.join(dir, ".claude", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    const file = path.join(pluginsDir, ".mcp-stale.json");
    fs.writeFileSync(file, JSON.stringify({ plugins: [{ name: "local-llm", from: "0.1.0", to: "0.2.0" }] }));
    const res = run(dir);
    expect(res.status).toBe(0);
    expect(fs.existsSync(file)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a sentinel with no `plugins` key counts as devops and blocks when no newer server is alive", () => {
    const dir = project();
    const pluginsDir = path.join(dir, ".claude", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    const file = path.join(pluginsDir, ".mcp-stale.json");
    fs.writeFileSync(file, JSON.stringify({}));
    const res = run(dir);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/MCP SERVER STALE/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
