#!/usr/bin/env node
/**
 * Scrape claude.ai/settings/usage for real rate limit data.
 *
 * This script is NOT meant to run standalone from a hook (can't access browser session).
 * Instead, Claude Code calls this logic via the Chrome extension during a session,
 * and this file just serves as the output format reference + manual fallback.
 *
 * The actual scraping happens inside Claude Code using the Claude-in-Chrome MCP tools
 * and writes results to usage-live.json. The startup-summary.js reads that file.
 *
 * Output format (usage-live.json):
 * {
 *   "timestamp": "2026-03-19T17:30:00.000Z",
 *   "session": { "pct": 5, "resetInMinutes": 290 },
 *   "weekly": { "pct": 13, "resetDay": "Di", "resetTime": "12:00" },
 *   "weeklySonnet": { "pct": 8 },
 *   "plan": "Max Plan"
 * }
 */

// If run directly, just show current cached data
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUTPUT_PATH = path.join(os.homedir(), '.claude', 'scripts', 'usage-live.json');

try {
  const data = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const age = Date.now() - new Date(data.timestamp).getTime();
  const ageMin = Math.round(age / 60000);
  console.log(`Last scraped: ${ageMin} minutes ago`);
  console.log(JSON.stringify(data, null, 2));
  if (ageMin > 60) {
    console.log('\nData is stale (>60 min). Claude Code will refresh on next session start.');
  }
} catch {
  console.log('No cached usage data. Claude Code will scrape on next session start.');
}
