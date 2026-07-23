#!/usr/bin/env node
/**
 * @hook ss.mcp.verify
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Verify every MCP server declared in this plugin's .mcp.json has
 *   its entry file present in the active install root, and surface a per-server
 *   diagnostic when one is missing.
 *
 *   Closes the visibility gap from issue #198: the dotclaude-ship server was
 *   silently absent (an incomplete cache sync dropped mcp-server/ship/index.js)
 *   while its sibling dotclaude-completion was fine, so /devops-ship deadlocked
 *   with no signal that the server never registered.
 *
 *   Signal choice — file presence, not live PID:
 *     MCP servers are spawned by the Claude Code runtime and may not have started
 *     yet when SessionStart hooks run, so a heartbeat-liveness probe here would be
 *     racy. Entry-file presence under CLAUDE_PLUGIN_ROOT (the exact copy the
 *     runtime reads .mcp.json from) deterministically predicts whether a server
 *     CAN register. A missing file ⇒ that server will not appear this session.
 *
 *   Output: silent (exit 0, no output) when all servers are intact — no green-tick
 *   noise every session. When one is missing, writes a per-server block to stdout
 *   for Claude to relay verbatim. A machine-readable last-run status is always
 *   written to a temp file for post-hoc debugging.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { expectedServers, serverEntryExists } = require('../lib/mcp-status');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');

const servers = expectedServers(PLUGIN_ROOT);
if (servers.length === 0) process.exit(0); // no .mcp.json / no servers declared

const results = servers.map((s) => ({
  name: s.name,
  entry: s.entry,
  rel: s.entry ? path.relative(PLUGIN_ROOT, s.entry) : '(no entry in .mcp.json)',
  ok: serverEntryExists(s.entry),
}));

// Always write a last-run status file — cheap, silent, inspectable when a user
// later asks "why was the ship server missing?".
try {
  fs.writeFileSync(
    path.join(os.tmpdir(), 'dotclaude-mcp-verify.json'),
    JSON.stringify({ pluginRoot: PLUGIN_ROOT, servers: results }, null, 2),
  );
} catch {
  // Non-fatal — diagnostics only.
}

const broken = results.filter((r) => !r.ok);
if (broken.length === 0) process.exit(0);

const out = [];
out.push('MCP server verification (devops) — show the user this block as-is:');
out.push('');
out.push('⚠️  **MCP server(s) missing from this session**');
out.push('');
out.push('Declared in the plugin but the entry file is absent from the active install');
out.push('— these servers will NOT register, so their tools are unavailable:');
out.push('');
for (const r of broken) {
  const note = r.name === 'dotclaude-ship' ? '  (/devops-ship pipeline unavailable)' : '';
  out.push(`- **${r.name}** → missing \`${r.rel}\`${note}`);
}
out.push('');
out.push('Likely cause: an incomplete plugin-cache sync dropped the file (claude-code#14061 / #190).');
out.push('Fix: **restart Claude Code** — ss.plugin.update self-heals the cache on the next session');
out.push('start. If it persists after a restart, run `/devops-auto-update` to rebuild the cache.');

process.stdout.write(out.join('\n'));
