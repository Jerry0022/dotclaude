#!/usr/bin/env node
/**
 * @module dotclaude-usage-mcp
 * @version 0.2.0
 * @plugin dotclaude-dev-ops
 * @description MCP server exposing a single `get_usage` tool.
 *   Scrapes live usage data from claude.ai via CDP, computes deltas
 *   against the previous scrape, and returns structured JSON +
 *   pre-rendered ASCII usage meter.
 *
 *   No caching — every call triggers a fresh scrape.
 *   usage-live.json is global (cross-session) so deltas work
 *   regardless of which session last scraped.
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const SCRAPER_SCRIPT = join(PLUGIN_ROOT, 'scripts', 'refresh-usage-headless.js');
const USAGE_JSON_PATH = join(homedir(), '.claude', 'usage-live.json');

// ---------------------------------------------------------------------------
// Inline the shared usage-meter renderer (CJS module — import via readFileSync eval)
// We duplicate the pure render functions here to avoid CJS/ESM interop issues.
// The canonical source is scripts/lib/usage-meter.js.
// ---------------------------------------------------------------------------

function renderBar(pct) {
  const filled = Math.round((pct / 100) * 12);
  const empty = 12 - filled;
  return '\u2593'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatDelta(delta) {
  if (delta == null) return ' '.repeat(8);
  if (isNaN(delta)) delta = 0;
  const sign = '+' + delta;
  let marker;
  if (delta >= 6)      marker = '!!';
  else if (delta >= 2) marker = '! ';
  else                 marker = '  ';
  const inner = (sign + '% ' + marker).padEnd(6, ' ');
  return '(' + inner + ')';
}

function formatResetShort(minutes) {
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + h + 'h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + 'h ' + m + 'm';
}

function renderUsageMeter(usageData) {
  if (!usageData || !usageData.session) {
    return '\u26a0 Usage data unavailable';
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const lines = [];

  // 5h window
  const bar5h = renderBar(s.pct);
  const pct5h = String(s.pct).padStart(3, ' ') + '%';
  const reset5h = formatResetShort(s.resetInMinutes);
  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  const arrowPos5h = Math.round(Math.max(0, Math.min(100, elapsed5hPct)) / 100 * 12);
  const pace5h = s.pct - elapsed5hPct;
  const warn5h = pace5h > 10 ? '  \u26a0 Sonnet or new session' : '';

  lines.push('5h  ' + bar5h + '   ' + pct5h + '           \u00b7 Reset ' + reset5h + warn5h);
  lines.push(' '.repeat(4 + arrowPos5h) + '\u2191');
  lines.push('');

  // Weekly window
  if (w) {
    const barWk = renderBar(w.pct);
    const pctWk = String(w.pct).padStart(3, ' ') + '%';
    const resetWk = formatResetShort(w.resetInMinutes);
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    const arrowPosWk = Math.round(Math.max(0, Math.min(100, elapsedWkPct)) / 100 * 12);
    const paceWk = w.pct - elapsedWkPct;
    const warnWk = paceWk > 10 ? '  \u26a0 Sonnet or new session' : '';

    lines.push('Wk  ' + barWk + '   ' + pctWk + '           \u00b7 Reset ' + resetWk + warnWk);
    lines.push(' '.repeat(4 + arrowPosWk) + '\u2191');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CDP scrape orchestration (calls existing refresh-usage-headless.js)
// ---------------------------------------------------------------------------

function readUsageJson() {
  try {
    return JSON.parse(readFileSync(USAGE_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Always scrape fresh data. Compute delta against previous usage-live.json.
 * Returns { success, data, delta5h, deltaWk }.
 */
function refreshUsage() {
  // Read previous data for delta computation (written by any session)
  const previous = readUsageJson();

  // Try CDP scrape with auto-start fallback
  try {
    try {
      execSync(`node "${SCRAPER_SCRIPT}" --check-only`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (checkErr) {
      const exitCode = checkErr.status;
      if (exitCode === 7) {
        execSync(`node "${SCRAPER_SCRIPT}" --auto-start --quiet`, {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (exitCode === 5) {
        execSync(`node "${SCRAPER_SCRIPT}" --activate-cdp --quiet`, {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }

    execSync(`node "${SCRAPER_SCRIPT}" --quiet`, {
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const freshData = readUsageJson();
    if (freshData) {
      // Delta: only if previous data exists
      let delta5h = null;
      let deltaWk = null;
      if (previous?.session) {
        delta5h = (freshData.session?.pct || 0) - (previous.session?.pct || 0);
        deltaWk = (freshData.weekly?.pct || 0) - (previous.weekly?.pct || 0);
      }
      return { success: true, data: freshData, delta5h, deltaWk };
    }
  } catch (err) {
    console.error('[dotclaude-usage-mcp] Scrape failed:', err.message);
  }

  return { success: false, data: null };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dotclaude-usage",
  version: "0.2.0",
});

server.registerTool(
  "get_usage",
  {
    title: "Get Usage",
    description:
      "Fetch live token usage data from claude.ai. Always scrapes fresh data. " +
      "Returns structured usage percentages, reset times, deltas against " +
      "the previous scrape, and a pre-rendered ASCII usage meter. " +
      "Handles CDP fallback chain (auto-start Edge, activate CDP).",
    inputSchema: z.object({}),
  },
  async () => {
    const result = refreshUsage();

    if (!result.success) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            message: "Usage data unavailable — scrape failed.",
            renderedMeter: "\u26a0 Usage data unavailable \u2014 monitoring issue",
          }),
        }],
      };
    }

    const meter = renderUsageMeter(result.data);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          session: result.data.session,
          weekly: result.data.weekly,
          weeklySonnet: result.data.weeklySonnet,
          plan: result.data.plan,
          timestamp: result.data.timestamp,
          delta5h: result.delta5h ?? null,
          deltaWk: result.deltaWk ?? null,
          renderedMeter: meter,
        }),
      }],
    };
  }
);

// Connect and start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[dotclaude-usage-mcp] Server started on stdio");
