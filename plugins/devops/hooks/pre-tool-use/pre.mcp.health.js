#!/usr/bin/env node
/**
 * @hook pre.mcp.health
 * @version 0.3.1
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
 *      This check tolerates a known false-pass: heartbeats are not scoped to a
 *      session, so a neighbour session's freshly-respawned server can make this
 *      session's own (still-stale) server look fine for one call. What it must
 *      NOT do is turn that into a permanent false-pass — so unlike earlier
 *      versions, it never deletes the shared sentinel file. Every call
 *      re-evaluates PID-file mtime against the sentinel fresh; once no
 *      respawned server is left live, the block reliably reappears. Cleanup of
 *      the sentinel file itself is ss.plugin.update's job (next session start).
 *
 *   2. Dead process: heartbeat files exist but none names a running process
 *      (typical cause: hard PC shutdown). Block with a restart message and clean
 *      up the stale files. One live server of any session is enough to pass —
 *      a neighbour's exited server is no reason to block this one.
 *
 *      A live older-version server (pre-0.3.0 heartbeat.js, or the #93
 *      window where the completion server registered no heartbeat at all)
 *      writes nothing here. If some OTHER session's server of the same name
 *      was hard-killed, its per-process file lingers dead on disk with no
 *      relation to this session at all — every PID reads dead, yet a live
 *      server is answering the actual tool call. A single stray per-process
 *      file cannot be told apart from a genuine same-session crash, so this
 *      hook requires corroboration from the shared legacy PID file
 *      (`dotclaude-mcp-<name>.pid`, overwritten by whichever server started
 *      most recently machine-wide, of any session) before blocking: only
 *      when THAT most-recently-started server is also dead do we call it
 *      DOWN. Dead per-process evidence without a dead legacy file is treated
 *      as inconclusive leftover — fail open with a warning instead of
 *      blocking a live pre-0.3.0 server.
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

/**
 * Reads the stale-update sentinel, if any. Corrupt/unparseable sentinels are
 * deleted rather than treated as hard blocks; otherwise a truncated file
 * would wedge every MCP call until the user removed it manually.
 * @returns {{ mtimeMs: number, affectsThisServer: boolean, upgrades: string } | null}
 */
function readSentinel() {
  if (!fs.existsSync(sentinelFile)) return null;
  let sentinel = null;
  try { sentinel = JSON.parse(fs.readFileSync(sentinelFile, 'utf8')); }
  catch {
    try { fs.unlinkSync(sentinelFile); } catch { /* ignore */ }
    return null;
  }
  const mtimeMs = fs.statSync(sentinelFile).mtimeMs;
  const affectsThisServer = sentinel?.plugins?.some(p => p.name === 'devops') ?? true;
  const upgrades = (sentinel?.plugins || [])
    .map(p => `${p.name} ${p.from} → ${p.to}`)
    .join(', ') || 'plugin';
  return { mtimeMs, affectsThisServer, upgrades };
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
  // The newest LIVE server — one respawned after the upgrade is enough to pass.
  const pidMtime = hb.latestLiveMtimeMs;

  const sentinel = readSentinel();

  // Stale-after-update check: if the sentinel is newer than the PID file, the
  // running MCP process was spawned before the plugin upgrade wiped its
  // installPath. If the PID file is newer-or-equal (>= handles same-millisecond
  // writes on fast disks), a server was respawned after the upgrade — pass
  // through. The sentinel file itself is never deleted here (see header):
  // that respawn evidence is re-derived fresh on every call, so the block
  // still fires once no respawned server is left live.
  if (sentinel && sentinel.affectsThisServer) {
    if (!(pidMtime >= sentinel.mtimeMs && pidMtime > 0)) {
      const W = 60;
      const line = '─'.repeat(W);
      console.error('');
      console.error(`⚠️  MCP SERVER STALE — ${serverName}`);
      console.error(line);
      console.error(`Plugin upgraded this session: ${sentinel.upgrades}.`);
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

  // No heartbeat file → server never registered (old version or first run) — pass through
  if (!hb.any) process.exit(0);

  // Any live server → running, all good
  if (hb.alive.length > 0) process.exit(0);

  // All heartbeat evidence is dead. Require the shared legacy PID file (the
  // most-recently-started server of this name, of any session) to also be
  // dead before calling it DOWN — a lone dead per-process file with no
  // legacy corroboration can't be told apart from another session's
  // hard-killed server and is not proof that THIS session's (possibly
  // pre-0.3.0, never-registering) server is down. Fail open instead.
  const legacyDead = hb.dead.some(d => d.legacy);
  if (!legacyDead) {
    console.error('');
    console.error(`⚠️  MCP heartbeat inconclusive for ${serverName} — only a`);
    console.error('stray per-process file is dead, with no corroborating');
    console.error('legacy heartbeat. Likely another session\'s leftover.');
    console.error('Not blocking.');
    process.exit(0);
  }

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
