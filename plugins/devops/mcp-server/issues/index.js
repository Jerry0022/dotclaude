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
import { tokenize, scoreIssue, resolveCwd, normalizeCwd, lruGet, matchIssuesShape, ISSUE_LIST_LIMIT } from "./matching.js";
import { createRequire } from "node:module";

// The hook side reads this copy (prompt.issue.detect scores the first prompt
// itself and asks Claude only on a real hit — hooks/lib/issue-match.js).
const { writeCache } = createRequire(import.meta.url)("../../hooks/lib/issue-match.js");

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

// One cache per project directory: the server process runs in the plugin
// folder, so every gh/git call must be pointed at the user's project via cwd.
/** @type {Map<string, {issues: object[], lastRefresh: number, inFlight: Promise<void>|null, truncated: boolean}>} */
const caches = new Map();
const NO_CWD = "\0";

// Keys are normalizeCwd() output (or NO_CWD); the Map is capped LRU so the
// refresh interval never fans out over an unbounded set of directories.
function cacheFor(cwd) {
  return lruGet(caches, cwd || NO_CWD, () => ({ issues: [], lastRefresh: 0, inFlight: null, truncated: false }));
}

/**
 * Refresh the issue cache of one project. Asynchronous on purpose: an
 * `execSync` here blocks the event loop for its whole timeout, which would
 * stall the JSON-RPC wire (and, before #324, the `initialize` handshake).
 *
 * Never rejects — a failed fetch keeps the previous (stale) cache.
 * Concurrent calls for one project share one in-flight `gh` process.
 *
 * @param {string|undefined} cwd project directory (undefined = server cwd)
 * @returns {Promise<void>}
 */
function fetchIssues(cwd) {
  const c = cacheFor(cwd);
  if (c.inFlight) return c.inFlight;
  c.inFlight = new Promise((resolve) => {
    execFile(
      "gh",
      ["issue", "list", "--state", "open", "--json", "number,title,labels", "--limit", String(ISSUE_LIST_LIMIT)],
      { encoding: "utf8", timeout: FETCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, cwd },
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
          c.issues = issues.map((i) => ({
            number: i.number,
            title: i.title,
            labels: (i.labels || []).map((l) => l.name),
          }));
          c.truncated = c.issues.length >= ISSUE_LIST_LIMIT;
          c.lastRefresh = Date.now();
          process.stderr.write(`[issues-mcp] Cached ${c.issues.length} open issues\n`);
          persistCache(c.issues, cwd);
        } catch (e) {
          process.stderr.write(`[issues-mcp] Unparsable issue list: ${e.message}\n`);
        }
        resolve();
      },
    );
  }).finally(() => {
    c.inFlight = null;
  });
  return c.inFlight;
}

/** Write the list for the hook, keyed by the project's origin. Best effort. */
function persistCache(issues, cwd) {
  execFile("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", timeout: 5_000, cwd }, (err, url) => {
    if (err || !url) return;
    try { writeCache(url, issues); } catch (e) { process.stderr.write(`[issues-mcp] cache write failed: ${e.message}\n`); }
  });
}

async function ensureCache(cwd) {
  if (Date.now() - cacheFor(cwd).lastRefresh > REFRESH_INTERVAL_MS) {
    await fetchIssues(cwd);
  }
}

/**
 * Match a user prompt against the cached issues of one project.
 * Returns top matches above threshold, sorted by confidence.
 */
async function matchIssues(query, maxResults = 3, threshold = 0.25, cwd) {
  await ensureCache(cwd);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  return cacheFor(cwd).issues
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
    inputSchema: z.object(matchIssuesShape),
  },
  async ({ query, max_results, threshold, cwd }) => {
    try {
      const raw = resolveCwd(cwd);
      const dir = raw === undefined ? undefined : normalizeCwd(raw);
      if (dir === null) throw new Error(`cwd is not an existing directory: ${raw}`);
      const matches = await matchIssues(query, max_results, threshold, dir);
      const c = cacheFor(dir);
      const result = {
        matches,
        cached_issues: c.issues.length,
        // true: the open-issue list hit the fetch limit, older issues are unmatched
        truncated: c.truncated,
        cache_age_s: c.lastRefresh ? Math.round((Date.now() - c.lastRefresh) / 1000) : null,
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
// The server runs in the plugin folder, so only projects we know a directory
// for are fetched: CLAUDE_PROJECT_DIR at warm-up, every cwd seen by
// match_issues on the interval.
const warmCwd = normalizeCwd(resolveCwd(undefined));
if (warmCwd) setTimeout(() => { fetchIssues(warmCwd); }, WARMUP_DELAY_MS).unref();
setInterval(() => {
  // Snapshot: fetchIssues -> cacheFor re-inserts the key (LRU touch), which a
  // live Map iterator would visit again. Order is kept, so eviction is too.
  for (const key of [...caches.keys()]) if (key !== NO_CWD) fetchIssues(key);
}, REFRESH_INTERVAL_MS).unref();
