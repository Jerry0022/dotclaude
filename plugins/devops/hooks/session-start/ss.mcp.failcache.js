#!/usr/bin/env node
/**
 * @hook ss.mcp.failcache
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Clear the plugin's entries from Claude Code's machine-wide MCP
 *   failure cache, so one session's start-up timeout does not take the devops
 *   servers away from every session that starts in the next 15 minutes.
 *
 *   Claude Code keys connect failures by server name in
 *   ~/.claude/mcp-needs-auth-cache.json and skips that server everywhere for
 *   15 min ("Skipping connection (recent failure cached …)"), with no
 *   in-session reconnect. The plugin's servers are stdio and never need auth,
 *   so their entries are only harm: removed here, every other server's entry
 *   stays (lib/mcp-failure-cache.js).
 *
 *   Runs concurrently with the MCP boot, so it cannot rescue the session it
 *   runs in when the CLI already skipped — it rescues the next start. When an
 *   entry was still inside the window, it tells the user that one restart
 *   brings the servers back.
 *
 *   Boot Discipline (CONVENTIONS.md): one small file read, no network, no
 *   subprocess; any throw is swallowed and the hook exits 0.
 */

require('../lib/plugin-guard');

try {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    const { clearPluginEntries, cacheFile } = require('../lib/mcp-failure-cache');
    const { active } = clearPluginEntries(cacheFile(home));
    if (active.length) {
      const root = (process.env.CLAUDE_PLUGIN_ROOT || require('path').resolve(__dirname, '..', '..')).split(require('path').sep).join('/');
      const names = active.map((k) => k.replace('plugin:devops:', '')).join(', ');
      // This hook races the MCP boot, so an active entry almost always means
      // THIS session already skipped the servers — and nothing reconnects them
      // in-session. Said once at the start, not discovered hours later at the
      // ship (2026-10-03: a finished ship stalled on "restart needed").
      process.stdout.write(
        `[mcp-failcache] Another session's connect timeout had blocked the devops MCP servers (${names}) machine-wide; the block is cleared for the next start, but this session most likely started without them.\n` +
          'In your FIRST reply, before any other work, tell the user in one line (in their language): ' +
          '"Die devops-Server (Ship, Completion-Card, Issues) sind in dieser Session durch einen Timeout in einer anderen Session gesperrt — ich nutze die Offline-Wege; ein Neustart holt sie zurück."\n' +
          'For the rest of the session use the offline entry points, never a manual ship: ' +
          `card: node "${root}/mcp-server/index.js" --render-card <payload.json> · ` +
          `ship pipeline: node "${root}/mcp-server/ship/cli.js" <tool> <params.json> ` +
          '(deep-knowledge/mcp-deferred-tools.md § When the connect is skipped).\n'
      );
    }
  }
} catch {
  // Never block session start.
}

process.exit(0);
