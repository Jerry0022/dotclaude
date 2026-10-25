#!/usr/bin/env node
/**
 * Legacy entry of the former `dotclaude-issues` MCP server. Since the merge into ONE
 * devops server per session (`dotclaude`, mcp-server/index.js) .mcp.json no
 * longer starts it; the file stays one release so install-completeness checks
 * (hooks/lib/cache-rebuild.js MCP_CRITICAL_FILES) and a hand-started copy
 * keep working — it simply boots the combined server.
 */
await import("../index.js");
