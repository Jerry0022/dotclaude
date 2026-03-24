#!/usr/bin/env node
/**
 * Headless Usage Scraper for claude.ai
 *
 * Connects to the user's running Edge browser via Chrome DevTools Protocol (CDP).
 * Opens a background tab, scrapes usage data, closes the tab — invisible to the user.
 * Uses raw WebSocket CDP protocol (no Playwright for scraping) to avoid Edge focus stealing.
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
 *   --quiet           suppress output (debug logs only; --summary still prints)
 *   --summary         after successful scrape, print formatted usage box to stdout
 *   --activate-cdp    restart Edge with CDP flag (visible, one-time)
 *   --check-only      only check if CDP is available, exit 0 or 5
 */

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
const printSummary = process.argv.includes('--summary');
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

/**
 * Raw CDP WebSocket helper.
 * Sends commands to the browser or a specific target session — fully invisible.
 */
function createCDPConnection(wsUrl) {
  // Use Node 22+ built-in WebSocket, or fallback to ws package
  const WS = globalThis.WebSocket || require('ws');
  const ws = new WS(wsUrl);
  let msgId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  function send(method, params = {}, sessionId) {
    const id = msgId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, {
        resolve: (r) => { clearTimeout(timeout); resolve(r); },
        reject: (e) => { clearTimeout(timeout); reject(e); }
      });
      ws.send(JSON.stringify(msg));
    });
  }

  function close() {
    ws.close();
  }

  return { ready, send, close };
}

async function scrapeViaCDP() {
  let cdp;
  let targetId;
  try {
    // Get browser WebSocket endpoint
    const versionRes = await fetch(CDP_URL + '/json/version');
    const { webSocketDebuggerUrl } = await versionRes.json();
    log('Connecting to', webSocketDebuggerUrl);

    cdp = createCDPConnection(webSocketDebuggerUrl);
    await cdp.ready;
    log('Connected to Edge via raw CDP WebSocket');

    // Create background target — this is the key: background:true prevents focus steal
    const { targetId: tid } = await cdp.send('Target.createTarget', {
      url: USAGE_URL,
      background: true
    });
    targetId = tid;
    log('Background target created:', targetId);

    // Attach to the target to get a session for sending commands
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true
    });
    log('Attached to target, sessionId:', sessionId);

    // Wait for page to load
    await new Promise(r => setTimeout(r, 5000));

    // Evaluate JS in the target session to extract usage data
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const url = window.location.href;
        if (url.includes('/login') || url.includes('/logout')) return JSON.stringify({ notLoggedIn: true });
        const main = document.querySelector('main');
        if (!main) return JSON.stringify({ noMain: true });
        return JSON.stringify({ text: main.innerText });
      })()`,
      returnByValue: true
    }, sessionId);

    // Close the background target
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    targetId = null;
    cdp.close();

    const evalData = JSON.parse(evalResult.result?.value || '{}');

    if (evalData.notLoggedIn) {
      log('Not logged in to claude.ai');
      return 2;
    }

    if (evalData.noMain || !evalData.text) {
      log('Could not find main element on page');
      return 3;
    }

    const parsed = parseUsageText(evalData.text);
    if (!parsed) {
      log('Could not parse usage data from page.');
      return 3;
    }

    fs.writeFileSync(USAGE_LIVE_PATH, JSON.stringify(parsed, null, 2));
    log('Usage data refreshed:', JSON.stringify(parsed));

    return 0;
  } catch (err) {
    log('CDP scrape failed:', err.message);
    if (targetId && cdp) {
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    if (cdp) cdp.close();
    return 4;
  }
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function printUsageSummary() {
  let data;
  try { data = JSON.parse(fs.readFileSync(USAGE_LIVE_PATH, 'utf8')); }
  catch { return; }

  const pct5h = data.session?.pct || 0;
  const pctWeekly = data.weekly?.pct || 0;
  const pctSonnet = data.weeklySonnet?.pct ?? null;

  const reset5hStr = data.session?.resetInMinutes
    ? `resets in ${formatDuration(data.session.resetInMinutes * 60000)}`
    : 'unknown';
  const weeklyResetStr = data.weekly?.resetDay && data.weekly?.resetTime
    ? ` \u2014 resets ${data.weekly.resetDay} ${data.weekly.resetTime}`
    : '';
  const sonnetPart = pctSonnet !== null ? ` | Sonnet: ${Math.round(pctSonnet)}%` : '';

  let status;
  if (pct5h >= 80) status = 'SLOW DOWN \u2014 5h limit near';
  else if (pctWeekly >= 70) status = 'CONSERVE \u2014 weekly >70%';
  else status = 'Budget healthy';

  const line = '\u2500'.repeat(40);
  console.log(line);
  console.log(`\uD83D\uDCCA USAGE [LIVE just now]`);
  console.log(`5h: ${Math.round(pct5h)}% \u2014 ${reset5hStr}`);
  console.log(`Weekly: ${Math.round(pctWeekly)}%${sonnetPart}${weeklyResetStr}`);
  console.log(`Status: ${status}`);
  console.log(line);
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
  if (code === 0 && printSummary) printUsageSummary();
  process.exit(code);
})();
