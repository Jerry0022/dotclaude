#!/usr/bin/env node
/**
 * @module dotclaude-ship-mcp
 * @version 0.1.0
 * @plugin devops
 * @description MCP server with five ship pipeline tools:
 *   - ship_preflight    — pre-flight safety checks
 *   - ship_build        — build, lint, test, build-ID
 *   - ship_version_bump — bump + verify all version files
 *   - ship_release      — commit, push, PR, merge, tag, release
 *   - ship_cleanup      — delete branch, prune worktrees
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register as registerHeartbeat } from "../lib/heartbeat.js";

import { schema as preflightSchema, handler as preflightHandler } from "./tools/preflight.js";
import { schema as buildSchema, handler as buildHandler } from "./tools/build.js";
import { schema as versionBumpSchema, handler as versionBumpHandler } from "./tools/version-bump.js";
import { schema as releaseSchema, handler as releaseHandler } from "./tools/release.js";
import { schema as cleanupSchema, handler as cleanupHandler } from "./tools/cleanup.js";

const server = new McpServer({
  name: "dotclaude-ship",
  version: "0.1.0",
});

function registerTool(name, title, description, schema, handler) {
  server.registerTool(
    name,
    { title, description, inputSchema: schema },
    async (params) => {
      try {
        const result = await handler(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: true, message: e.message }) }],
          isError: true,
        };
      }
    }
  );
}

registerTool(
  "ship_preflight",
  "Ship Pre-Flight",
  "Run pre-flight safety checks: clean tree, commits ahead, pushed, version consistency, worktree detection. " +
  "Returns structured check results. Call this FIRST in the ship pipeline.",
  preflightSchema,
  preflightHandler,
);

registerTool(
  "ship_build",
  "Ship Build",
  "Build the project, run lint and tests, compute build-ID. " +
  "Auto-detects available scripts from package.json — only runs what exists. " +
  "Returns success/failure with step details. Use buildIdOnly=true to skip build and only hash.",
  buildSchema,
  buildHandler,
);

registerTool(
  "ship_version_bump",
  "Ship Version Bump",
  "Bump version in all project files (plugin.json/package.json, README, marketplace.json). " +
  "Verifies all files match after bump. CHANGELOG must be updated separately by Claude before calling this.",
  versionBumpSchema,
  versionBumpHandler,
);

registerTool(
  "ship_release",
  "Ship Release",
  "Commit, push, create PR, squash-merge, tag, and create GitHub release. " +
  "Handles the full git + GitHub flow deterministically. Returns PR number, merge sha, tag status.",
  releaseSchema,
  releaseHandler,
);

registerTool(
  "ship_cleanup",
  "Ship Cleanup",
  "Delete shipped feature branch (local + remote if lingering), prune worktrees and remotes. " +
  "IMPORTANT: If in a worktree, Claude must call ExitWorktree BEFORE this tool.",
  cleanupSchema,
  cleanupHandler,
);

// Connect and start
const transport = new StdioServerTransport();
await server.connect(transport);
registerHeartbeat("dotclaude-ship");
console.error("[dotclaude-ship-mcp] Server started on stdio");
