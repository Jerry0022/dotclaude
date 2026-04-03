#!/usr/bin/env node
/**
 * @module dotclaude-issues-mcp
 * @version 0.1.0
 * @plugin dotclaude-dev-ops
 * @description MCP server for heuristic issue matching.
 *   - Caches open GitHub issues in background (refreshes every 60s)
 *   - Exposes `match_issues` tool for fuzzy matching user prompts
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { tokenize, scoreIssue } from "./matching.js";

// ---------------------------------------------------------------------------
// Issue cache
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 60_000;
let issueCache = [];
let lastRefresh = 0;

function fetchIssues() {
  try {
    const raw = execSync(
      'gh issue list --state open --json number,title,labels --limit 100',
      { encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const issues = JSON.parse(raw);
    issueCache = issues.map(i => ({
      number: i.number,
      title: i.title,
      labels: (i.labels || []).map(l => l.name),
    }));
    lastRefresh = Date.now();
    process.stderr.write(`[issues-mcp] Cached ${issueCache.length} open issues\n`);
  } catch (e) {
    process.stderr.write(`[issues-mcp] Failed to fetch issues: ${e.message}\n`);
    // Keep stale cache if available
  }
}

function ensureCache() {
  if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
    fetchIssues();
  }
}

/**
 * Match a user prompt against cached issues.
 * Returns top matches above threshold, sorted by confidence.
 */
function matchIssues(query, maxResults = 3, threshold = 0.25) {
  ensureCache();

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = issueCache
    .map(issue => ({ ...issue, confidence: scoreIssue(issue, queryTokens) }))
    .filter(i => i.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);

  return scored;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dotclaude-issues",
  version: "0.1.0",
});

server.registerTool(
  "match_issues",
  {
    title: "Match Issues",
    description:
      "Fuzzy-match a user prompt against open GitHub issues. " +
      "Returns top matching issues with confidence scores. " +
      "Use this when no explicit issue number (#N) was found in the user's message " +
      "to heuristically detect which issue the user might be working on.",
    inputSchema: z.object({
      query: z.string().describe("The user's prompt text to match against open issues"),
      max_results: z.number().default(3).describe("Max number of matches to return"),
      threshold: z.number().default(0.25).describe("Minimum confidence threshold (0-1)"),
    }),
  },
  async ({ query, max_results, threshold }) => {
    try {
      const matches = matchIssues(query, max_results, threshold);
      const result = {
        matches,
        cached_issues: issueCache.length,
        cache_age_s: Math.round((Date.now() - lastRefresh) / 1000),
      };
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

// Initial fetch on startup
fetchIssues();

// Background refresh
setInterval(fetchIssues, REFRESH_INTERVAL_MS);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
