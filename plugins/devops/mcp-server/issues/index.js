#!/usr/bin/env node
/**
 * @module dotclaude-issues-mcp
 * @version 0.2.0
 * @plugin devops
 * @description MCP server for heuristic issue matching.
 *   - Caches open GitHub issues lazily (refreshes every 60s)
 *   - Exposes `match_issues` tool for fuzzy matching user prompts
 *   - Exposes `health_check` for boot diagnostics
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 *
 *   BOOT DISCIPLINE (#324): nothing runs before `server.connect(transport)`.
 *   The eager `gh issue list` used to sit at module top level, so the process
 *   burned up to 15 s of a 30 s connect budget before the transport existed —
 *   under SessionStart load that alone produced CONNECT_TIMEOUT. The warm-up
 *   fetch now happens AFTER connect, off the critical path, and is `execFile`
 *   based so it never blocks the event loop that carries the JSON-RPC wire.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { register as registerHeartbeat } from "../lib/heartbeat.js";
import { tokenize, scoreIssue } from "./matching.js";

const SERVER_NAME = "dotclaude-issues";
const SERVER_VERSION = "0.2.0";

// ---------------------------------------------------------------------------
// Issue cache
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
// Delay of the post-connect warm-up fetch. The client sends `initialize`
// immediately after the transport comes up; spawning `gh` in the same tick
// competes with answering it. A short breather keeps the handshake first.
const WARMUP_DELAY_MS = 2_000;

let issueCache = [];
let lastRefresh = 0;
let inFlight = null;

/**
 * Refresh the issue cache. Asynchronous on purpose: an `execSync` here blocks
 * the event loop for its whole timeout, which would stall the JSON-RPC wire
 * (and, before #324, the `initialize` handshake itself).
 *
 * Never rejects — a failed fetch keeps the previous (stale) cache.
 * Concurrent calls share one in-flight `gh` process.
 *
 * @returns {Promise<void>}
 */
function fetchIssues() {
  if (inFlight) return inFlight;
  inFlight = new Promise((resolve) => {
    execFile(
      "gh",
      ["issue", "list", "--state", "open", "--json", "number,title,labels", "--limit", "100"],
      { encoding: "utf8", timeout: FETCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          process.stderr.write(`[issues-mcp] Failed to fetch issues: ${err.message}\n`);
          // Keep stale cache if available. lastRefresh stays put so the next
          // call retries instead of trusting an empty cache for 60 s.
          resolve();
          return;
        }
        try {
          const issues = JSON.parse(stdout);
          issueCache = issues.map((i) => ({
            number: i.number,
            title: i.title,
            labels: (i.labels || []).map((l) => l.name),
          }));
          lastRefresh = Date.now();
          process.stderr.write(`[issues-mcp] Cached ${issueCache.length} open issues\n`);
        } catch (e) {
          process.stderr.write(`[issues-mcp] Unparsable issue list: ${e.message}\n`);
        }
        resolve();
      },
    );
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function ensureCache() {
  if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
    await fetchIssues();
  }
}

/**
 * Match a user prompt against cached issues.
 * Returns top matches above threshold, sorted by confidence.
 */
async function matchIssues(query, maxResults = 3, threshold = 0.25) {
  await ensureCache();

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return issueCache
    .map((issue) => ({ ...issue, confidence: scoreIssue(issue, queryTokens) }))
    .filter((i) => i.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

let bootMs = null;

server.registerTool(
  "health_check",
  {
    title: "Health Check",
    description:
      "Boot diagnostics for this MCP server: which build answered, from which " +
      "working directory, and how long it took from process start to a live " +
      "stdio transport. Use when diagnosing MCP CONNECT_TIMEOUT at session start.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        server: SERVER_NAME,
        version: SERVER_VERSION,
        cwd: process.cwd(),
        bootMs,
        node: process.version,
        depsResolved: true,
      }, null, 2),
    }],
  }),
);

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
      const matches = await matchIssues(query, max_results, threshold);
      const result = {
        matches,
        cached_issues: issueCache.length,
        cache_age_s: lastRefresh ? Math.round((Date.now() - lastRefresh) / 1000) : null,
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
  },
);

// ---------------------------------------------------------------------------
// Start — connect FIRST, then everything else
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (e) {
  // A hung server is worse than an absent one: Claude Code waits out the full
  // connect window before it gives up. Fail loud and fast instead.
  process.stderr.write(`[${SERVER_NAME}-mcp] connect failed: ${e && e.message}\n`);
  process.exit(1);
}
bootMs = Math.round(process.uptime() * 1000);
registerHeartbeat(SERVER_NAME);
console.error(`[${SERVER_NAME}-mcp] Server started on stdio (boot ${bootMs}ms)`);

// Warm the cache and keep it fresh — fire-and-forget, errors already swallowed
// to stderr inside fetchIssues(). Both timers are unref'd so they never keep
// the process alive on their own.
setTimeout(() => { fetchIssues(); }, WARMUP_DELAY_MS).unref();
setInterval(() => { fetchIssues(); }, REFRESH_INTERVAL_MS).unref();
