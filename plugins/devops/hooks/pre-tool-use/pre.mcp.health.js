#!/usr/bin/env node
/**
 * @hook pre.mcp.health
 * @version 0.3.0
 * @event PreToolUse
 * @plugin devops
 * @description Detects dead or stale MCP servers before tool calls fail cryptically.
 *   Each MCP server process writes its own PID file on startup (via
 *   mcp-server/lib/heartbeat.js); lib/mcp-heartbeat.js reads them all.
 *   This hook checks two conditions in order:
 *
 *   1. Stale-after-update: ss.plugin.update writes ~/.claude/plugins/.mcp-stale.json
 *      when a plugin's installPath moves (real version upgrade). If that sentinel
 *      is newer than the server's PID file, the running MCP process is pointing at
 *      deleted files → block with a restart message.
 *
 *   2. Dead process: heartbeat files exist but none names a running process
 *      (typical cause: hard PC shutdown). Block with a restart message and clean
 *      up the stale files. One live server of any session is enough to pass —
 *      a neighbour's exited server is no reason to block this one.
 *
 *   If the PID file is newer than the sentinel, the server was respawned after
 *   the update — the sentinel is cleared so subsequent calls pass through.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { heartbeatState } = require('../lib/mcp-heartbeat');

const home = process.env.HOME || process.env.USERPROFILE || '';
const sentinelFile = path.join(home, '.claude', 'plugins', '.mcp-stale.json');

// Map tool-name prefixes to MCP server names
const SERVER_MAP = {
  'dotclaude-completion': 'dotclaude-completion',
  'dotclaude-ship':       'dotclaude-ship',
  'dotclaude-issues':     'dotclaude-issues',
};

function resolveServer(toolName) {
  // tool names look like: mcp__plugin_devops_dotclaude-ship__ship_build
  // extract the server key between "plugin_devops_" and the next "__"
  const match = toolName.match(/plugin_devops_([a-z0-9-]+)__/);
  if (!match) return null;
  const key = match[1];
  return SERVER_MAP[key] || null;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const toolName = hook.tool_name || '';
  const serverName = resolveServer(toolName);
  if (!serverName) process.exit(0);

  const hb = heartbeatState(serverName);
  // The newest LIVE server — one respawned after the upgrade clears the sentinel.
  const pidMtime = hb.latestLiveMtimeMs;

  // Stale-after-update check: if the sentinel is newer than the PID file, the
  // running MCP process was spawned before the plugin upgrade wiped its
  // installPath. If the PID file is newer-or-equal (>= handles same-millisecond
  // writes on fast disks), the server was respawned after the upgrade — clear
  // the sentinel so future calls pass through.
  //
  // Corrupt/unparseable sentinels are deleted rather than treated as hard
  // blocks; otherwise a truncated file would wedge every MCP call until the
  // user removed it manually.
  if (fs.existsSync(sentinelFile)) {
    let sentinel = null;
    let sentinelCorrupt = false;
    try { sentinel = JSON.parse(fs.readFileSync(sentinelFile, 'utf8')); }
    catch { sentinelCorrupt = true; }

    if (sentinelCorrupt) {
      try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
    } else {
      const sentinelMtime = fs.statSync(sentinelFile).mtimeMs;
      const affectsThisServer = sentinel?.plugins?.some(p => p.name === 'devops') ?? true;

      if (affectsThisServer) {
        if (pidMtime >= sentinelMtime && pidMtime > 0) {
          // Server was respawned after the upgrade — safe. Drop the sentinel.
          try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
        } else {
          const upgrades = (sentinel?.plugins || [])
            .map(p => `${p.name} ${p.from} → ${p.to}`)
            .join(', ') || 'plugin';
          const W = 60;
          const line = '─'.repeat(W);
          console.error('');
          console.error(`⚠️  MCP SERVER STALE — ${serverName}`);
          console.error(line);
          console.error(`Plugin upgraded this session: ${upgrades}.`);
          console.error('The running MCP process was spawned from the old');
          console.error('installPath, which has been replaced. File reads will');
          console.error('fail or return stale data.');
          console.error('');
          console.error('Fix: Start a new Claude Code session. MCP servers are');
          console.error('only spawned on session init — they cannot be');
          console.error('reconnected mid-conversation.');
          console.error(line);
          process.exit(2);
        }
      }
    }
  }

  // No heartbeat file → server never registered (old version or first run) — pass through
  if (!hb.any) process.exit(0);

  // Any live server → running, all good
  if (hb.alive.length > 0) process.exit(0);

  // Dead server detected — block and warn
  const W = 54;
  const line = '─'.repeat(W);
  console.error('');
  console.error(`⚠️  MCP SERVER DOWN — ${serverName}`);
  console.error(line);
  console.error(`PID ${hb.dead.map(d => d.pid).filter(Boolean).join(', ') || '?'} no longer running.`);
  console.error(`The server died (likely due to a hard PC shutdown).`);
  console.error('');
  console.error('Fix: Start a new Claude Code session.');
  console.error('MCP servers are started on session init and cannot');
  console.error('be restarted mid-conversation.');
  console.error(line);

  // Clean up the stale PID files so the message doesn't repeat after the user
  // starts a new session (the new server will write a fresh one)
  for (const d of hb.dead) { try { fs.unlinkSync(d.file); } catch { /* ignore */ } }

  process.exit(2);
});
