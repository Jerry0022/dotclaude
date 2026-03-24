#!/usr/bin/env node
/**
 * Headless Usage Scraper for claude.ai
 *
 * Connects to the user's running Edge browser via Chrome DevTools Protocol (CDP).
 * Opens a background tab, scrapes usage data, closes the tab — invisible to the user.
 * Reuses the existing Edge session (no auth needed, no Cloudflare block).
 *
 * Exit codes:
 *   0 = success
 *   1 = no browser context
 *   2 = not logged in
 *   3 = parse error
 *   4 = scrape failed
 *   5 = CDP not available (Edge not running with --remote-debugging-port)
 *   6 = Edge restart requested but failed
 *
 * Flags:
 *   --quiet           suppress output
 *   --activate-cdp    restart Edge with CDP flag (visible, one-time)
 *   --check-only      only check if CDP is available, exit 0 or 5
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
const activateCDP = process.argv.includes('--activate-cdp');
const checkOnly = process.argv.includes('--check-only');

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

async function isCDPAvailable() {
  try {
    const res = await fetch(CDP_URL + '/json/version', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

/** Restart Edge with CDP flag. Visible to user — use only with explicit consent. */
async function restartEdgeWithCDP() {
  log('Restarting Edge with CDP on port', CDP_PORT, '...');

  try { execSync('taskkill /F /IM msedge.exe', { stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 3000));

  const child = spawn(EDGE_EXE, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--restore-last-session'
  ], { detached: true, stdio: 'ignore' });
  child.unref();

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
    if (!context) { log('No browser context found'); return 1; }

    page = await context.newPage();
    await page.goto(USAGE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('/login') || url.includes('/logout')) {
      log('Not logged in to claude.ai');
      await page.close();
      return 2;
    }

    const text = await page.innerText('main', { timeout: 5000 });
    const result = parseUsageText(text);

    if (!result) {
      log('Could not parse usage data from page.');
      await page.close();
      return 3;
    }

    fs.writeFileSync(USAGE_LIVE_PATH, JSON.stringify(result, null, 2));
    log('Usage data refreshed:', JSON.stringify(result));

    await page.close();
    return 0;
  } catch (err) {
    log('CDP scrape failed:', err.message);
    if (page) await page.close().catch(() => {});
    return 4;
  }
}

(async () => {
  const cdpReady = await isCDPAvailable();

  if (checkOnly) {
    process.exit(cdpReady ? 0 : 5);
  }

  if (!cdpReady) {
    if (activateCDP) {
      if (!(await restartEdgeWithCDP())) process.exit(6);
    } else {
      log('CDP not available on port', CDP_PORT);
      process.exit(5);
    }
  }

  const code = await scrapeViaCDP();
  process.exit(code);
})();
