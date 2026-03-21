#!/usr/bin/env node
/**
 * Headless Usage Scraper for claude.ai
 *
 * Connects to the user's running Edge browser via Chrome DevTools Protocol (CDP).
 * If Edge isn't running with CDP enabled, restarts it with --remote-debugging-port=9223.
 *
 * Opens a background tab, scrapes usage data, closes the tab — invisible to the user.
 * Reuses the existing Edge session (no auth needed, no Cloudflare block).
 *
 * Usage:
 *   node refresh-usage-headless.js          # scrape via CDP
 *   node refresh-usage-headless.js --quiet  # suppress output
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = path.join(os.homedir(), '.claude', 'scripts');
const USAGE_LIVE_PATH = path.join(SCRIPTS_DIR, 'usage-live.json');
const USAGE_URL = 'https://claude.ai/settings/usage';
const CDP_PORT = 9223;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const isQuiet = process.argv.includes('--quiet');

function log(...args) {
  if (!isQuiet) console.log(...args);
}

function parseUsageText(text) {
  const pctMatches = [...text.matchAll(/(?:\d{1,2}:\d{2})?(\d{1,3}) % (?:verwendet|used)/g)];
  const pcts = pctMatches.map(m => parseInt(m[1]));

  const resetMatch = text.match(
    /(?:Zurücksetzung in|Resets? in)\s+(\d+)\s*(?:Std\.|hr)\.?\s*(\d+)?\s*(?:Min\.|min)?/
  );
  const resetMinutes = resetMatch
    ? (parseInt(resetMatch[1]) || 0) * 60 + (parseInt(resetMatch[2]) || 0)
    : null;

  const weeklyMatch = text.match(
    /(?:Alle Modelle|All Models)[\s\S]*?(?:Zurücksetzung|Reset)\s+(\w+)\.?,?\s*(\d{1,2}:\d{2})/
  );

  if (pcts.length < 2) return null;

  return {
    timestamp: new Date().toISOString(),
    session: { pct: pcts[0], resetInMinutes: resetMinutes },
    weekly: {
      pct: pcts[1],
      resetDay: weeklyMatch ? weeklyMatch[1] + '.' : null,
      resetTime: weeklyMatch ? weeklyMatch[2] : null
    },
    weeklySonnet: pcts[2] != null ? { pct: pcts[2] } : undefined,
    plan: 'Max Plan'
  };
}

/** Check if CDP port is responding */
async function isCDPAvailable() {
  try {
    const res = await fetch(CDP_URL + '/json/version', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ensure Edge is running with CDP enabled. Restarts if needed. */
async function ensureEdgeCDP() {
  if (await isCDPAvailable()) {
    log('CDP already available on port', CDP_PORT);
    return true;
  }

  log('CDP not available — restarting Edge with debug port...');

  // Kill existing Edge (it will restore tabs on restart)
  try {
    execSync('taskkill /F /IM msedge.exe', { stdio: 'ignore' });
  } catch {}

  // Wait for processes to fully exit
  await new Promise(r => setTimeout(r, 3000));

  // Start Edge with CDP flag (detached so it outlives this script)
  const child = spawn(EDGE_EXE, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--restore-last-session'
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  // Wait for Edge to fully start and CDP to become available
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCDPAvailable()) {
      log('Edge started with CDP on port', CDP_PORT);
      return true;
    }
  }

  log('Edge did not start with CDP within 20 seconds');
  return false;
}

async function scrapeViaCDP() {
  let page;
  try {
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5000 });
    log('Connected to Edge via CDP');

    const context = browser.contexts()[0];
    if (!context) {
      log('No browser context found');
      process.exitCode = 1;
      return false;
    }

    page = await context.newPage();
    await page.goto(USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/logout')) {
      log('Not logged in to claude.ai');
      await page.close();
      process.exitCode = 2;
      return false;
    }

    const text = await page.innerText('main', { timeout: 5000 });
    const result = parseUsageText(text);

    if (!result) {
      log('Could not parse usage data from page.');
      await page.close();
      process.exitCode = 3;
      return false;
    }

    fs.writeFileSync(USAGE_LIVE_PATH, JSON.stringify(result, null, 2));
    log('Usage data refreshed:', JSON.stringify(result));

    await page.close();
    return true;
  } catch (err) {
    log('CDP scrape failed:', err.message);
    if (page) await page.close().catch(() => {});
    process.exitCode = 4;
    return false;
  }
}

(async () => {
  if (!(await ensureEdgeCDP())) {
    process.exit(process.exitCode || 5);
  }
  await scrapeViaCDP();
  process.exit(process.exitCode || 0);
})();
