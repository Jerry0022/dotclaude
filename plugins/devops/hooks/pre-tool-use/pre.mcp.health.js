#!/usr/bin/env node
/**
 * @hook pre.mcp.health
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @description Detects dead MCP servers before tool calls fail cryptically.
 *   Each MCP server writes a PID file on startup (via mcp-server/lib/heartbeat.js).
 *   This hook checks if the PID is still alive. If not, it blocks with a clear
 *   message telling the user to start a new session.
 *
 *   Typical cause: hard PC shutdown (Stop-Computer -Force) kills MCP processes,
 *   but the resumed conversation still references them.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');

const PREFIX = 'dotclaude-mcp-';

// Map tool-name prefixes to MCP server names
const SERVER_MAP = {
  'dotclaude-completion': 'dotclaude-completion',
  'dotclaude-ship':       'dotclaude-ship',
  'dotclaude-issues':     'dotclaude-issues',
};

function pidFileFor(serverName) {
  return path.join(os.tmpdir(), `${PREFIX}${serverName}.pid`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no kill
    return true;
  } catch (err) {
    // EPERM = process exists but we lack permission → alive
    if (err.code === 'EPERM') return true;
    return false;
  }
}

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

  const pidFile = pidFileFor(serverName);

  // No PID file → server never registered (old version or first run) — pass through
  if (!fs.existsSync(pidFile)) process.exit(0);

  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  } catch {
    process.exit(0);
  }

  if (!pid || isNaN(pid)) process.exit(0);

  // PID alive → server is running, all good
  if (isProcessAlive(pid)) process.exit(0);

  // Dead server detected — block and warn
  const W = 54;
  const line = '─'.repeat(W);
  console.error('');
  console.error(`⚠️  MCP SERVER DOWN — ${serverName}`);
  console.error(line);
  console.error(`PID ${pid} is no longer running.`);
  console.error(`The server died (likely due to a hard PC shutdown).`);
  console.error('');
  console.error('Fix: Start a new Claude Code session.');
  console.error('MCP servers are started on session init and cannot');
  console.error('be restarted mid-conversation.');
  console.error(line);

  // Clean up stale PID file so the message doesn't repeat after user
  // starts a new session (the new server will write a fresh one)
  try { fs.unlinkSync(pidFile); } catch { /* ignore */ }

  process.exit(2);
});
