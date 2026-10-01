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
      const names = active.map((k) => k.replace('plugin:devops:', '')).join(', ');
      process.stdout.write(
        `[mcp-failcache] Another session's connect timeout had blocked the devops MCP servers (${names}) machine-wide; the block is cleared now.\n` +
          'Show the user verbatim if the devops tools (ship, completion card, issues) are missing in this session: ' +
          '"Die devops-Server waren durch einen Timeout in einer anderen Session gesperrt — Sperre ist aufgehoben, ein Neustart dieser Session holt sie zurück."\n'
      );
    }
  }
} catch {
  // Never block session start.
}

process.exit(0);
