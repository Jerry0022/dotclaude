/**
 * @module dotclaude-issues-tools
 * @version 0.3.0
 * @plugin devops
 * @description Issue-matching tool group of the single devops MCP server
 *   (`dotclaude`, mcp-server/index.js) — until 0.2.0 its own server
 *   (`dotclaude-issues`). registerIssueTools() adds `match_issues`; the
 *   server calls startIssueWarmup() after connect.
 *   - Caches open GitHub issues lazily (on demand, 5 min staleness window)
 *   - Exposes `match_issues` tool for fuzzy matching user prompts
 *
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 *
 *   BOOT DISCIPLINE (#324): nothing runs before `server.connect(transport)`.
 *   The eager `gh issue list` used to sit at module top level, so the process
 *   burned up to 15 s of a 30 s connect budget before the transport existed —
 *   under SessionStart load that alone produced CONNECT_TIMEOUT. The warm-up
 *   fetch now happens AFTER connect, off the critical path, and is `execFile`
 *   based so it never blocks the event loop that carries the JSON-RPC wire.
 */

import { execFile } from "node:child_process";
import { tokenize, scoreIssue, resolveCwd, normalizeCwd, lruGet, matchIssuesShape, ISSUE_LIST_LIMIT } from "./matching.js";
import { createRequire } from "node:module";

// The hook side reads this copy (prompt.issue.detect scores the first prompt
// itself and asks Claude only on a real hit — hooks/lib/issue-match.js).
const { writeCache } = createRequire(import.meta.url)("../../hooks/lib/issue-match.js");

// ---------------------------------------------------------------------------
// Issue cache
// ---------------------------------------------------------------------------

// Staleness window of a project's cache. Refresh is on demand (ensureCache on
// match_issues): no background polling, so an idle session spawns no `gh`.
const REFRESH_INTERVAL_MS = 5 * 60_000;
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
      { windowsHide: true, encoding: "utf8", timeout: FETCH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, cwd },
      (err, stdout) => {
        if (err) {
          process.stderr.write(`[issues-mcp] Failed to fetch issues: ${err.message}\n`);
          // Keep stale cache if available. lastRefresh stays put so the next
          // call retries instead of trusting an empty cache for the refresh window.
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
  execFile("git", ["config", "--get", "remote.origin.url"], { windowsHide: true, encoding: "utf8", timeout: 5_000, cwd }, (err, url) => {
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
// Registration (called by mcp-server/index.js)
// ---------------------------------------------------------------------------

/** Add `match_issues` to the shared server. `z` is the server's zod instance. */
export function registerIssueTools(server, z) {
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
}

/**
 * Warm the cache once after connect — fire-and-forget, errors already
 * swallowed to stderr inside fetchIssues(). Later refreshes are on demand
 * (ensureCache). The timer is unref'd so it never keeps the process alive.
 * Only projects we know a directory for are fetched: CLAUDE_PROJECT_DIR at
 * warm-up, every cwd seen by match_issues on demand.
 */
export function startIssueWarmup() {
  const warmCwd = normalizeCwd(resolveCwd(undefined));
  if (warmCwd) setTimeout(() => { fetchIssues(warmCwd); }, WARMUP_DELAY_MS).unref();
}
