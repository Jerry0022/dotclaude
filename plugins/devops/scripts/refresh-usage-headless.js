#!/usr/bin/env node
/**
 * @script refresh-usage-headless
 * @version 0.1.0
 * @plugin devops
 *
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
 *   --auto-start      start Edge with CDP only if no Edge process is running (non-destructive)
 *   --check-only      only check if CDP is available, exit 0 or 5
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Store usage data in ~/.claude — same location regardless of CWD or worktree
const SCRIPTS_DIR = path.join(os.homedir(), '.claude');
const USAGE_LIVE_PATH = path.join(SCRIPTS_DIR, 'usage-live.json');
const USAGE_URL = 'https://claude.ai/settings/usage';
const CDP_PORT = 9223;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const EDGE_EXE = findEdgeExecutable();

/** Locate Edge executable across common install paths and registry. */
function findEdgeExecutable() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  // Registry fallback
  try {
    const reg = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe" /ve',
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const match = reg.match(/REG_SZ\s+(.+)/);
    if (match) {
      const regPath = match[1].trim();
      try { if (fs.statSync(regPath).isFile()) return regPath; } catch {}
    }
  } catch {}
  // Last resort — hope it's on PATH
  return 'msedge.exe';
}

// Platform guard — Edge CDP scraper is Windows-only
if (process.platform !== 'win32') {
  if (!process.argv.includes('--quiet')) {
    console.log('refresh-usage-headless: Edge CDP scraper is Windows-only. Skipping.');
  }
  process.exit(5);
}

const isQuiet = process.argv.includes('--quiet');
const printSummary = process.argv.includes('--summary');
const activateCDP = process.argv.includes('--activate-cdp');
const autoStart = process.argv.includes('--auto-start');
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

  // Compute weekly reset in minutes from resetDay + resetTime
  let weeklyResetMinutes = null;
  if (weeklyMatch) {
    const dayAbbrev = (weeklyMatch[1] || '').replace(/\.$/, '').toLowerCase();
    const dayMap = { so: 0, su: 0, mo: 1, di: 2, tu: 2, mi: 3, we: 3, do: 4, th: 4, fr: 5, sa: 6 };
    const targetDow = dayMap[dayAbbrev];
    if (targetDow != null && weeklyMatch[2]) {
      const [hh, mm] = weeklyMatch[2].split(':').map(Number);
      const now = new Date();
      const nowDow = now.getDay();
      let daysUntil = (targetDow - nowDow + 7) % 7;
      if (daysUntil === 0) {
        // Same day — check if reset time is still ahead
        const resetTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm).getTime();
        if (now.getTime() >= resetTodayMs) daysUntil = 7; // already passed today → next week
      }
      const resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil, hh, mm);
      weeklyResetMinutes = Math.round((resetDate.getTime() - now.getTime()) / 60000);
    }
  }

  // Fallback: when weekly reset is < 24h away, claude.ai shows duration format
  // ("Zurücksetzung in X Std. Y Min.") instead of day+time format
  if (weeklyResetMinutes == null) {
    const weeklyDurationMatch = text.match(
      /(?:Alle Modelle|All Models)[\s\S]*?(?:Zurücksetzung in|Resets? in)\s+(\d+)\s*(?:Std\.|hr)\.?\s*(\d+)?\s*(?:Min\.|min)?/
    );
    if (weeklyDurationMatch) {
      weeklyResetMinutes = (parseInt(weeklyDurationMatch[1]) || 0) * 60 + (parseInt(weeklyDurationMatch[2]) || 0);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    session: { pct: pcts[0], resetInMinutes: resetMinutes },
    weekly: {
      pct: pcts[1],
      resetDay: weeklyMatch ? weeklyMatch[1] + '.' : null,
      resetTime: weeklyMatch ? weeklyMatch[2] : null,
      resetInMinutes: weeklyResetMinutes
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

/** Check if any Edge process is currently running. */
function isEdgeRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq msedge.exe" /NH', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return out.includes('msedge.exe');
  } catch { return false; }
}

/** Start Edge with CDP — only when no Edge process is running. Non-destructive. */
async function autoStartEdgeWithCDP() {
  if (isEdgeRunning()) {
    log('Edge is running without CDP — auto-start skipped (would need restart)');
    return false;
  }

  log('Edge not running — starting with CDP on port', CDP_PORT, '...');
  const child = spawn(EDGE_EXE, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCDPAvailable()) {
      log('Edge auto-started with CDP on port', CDP_PORT);
      return true;
    }
  }

  log('Edge auto-start failed within 15 seconds');
  return false;
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

    // Wait for page to load — poll until content appears or timeout
    let evalData = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      const evalResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/logout')) return JSON.stringify({ notLoggedIn: true });
          const main = document.querySelector('main');
          if (!main) return JSON.stringify({ noMain: true });
          const text = main.innerText;
          // Check if usage data has actually loaded (contains percentage text)
          if (!/\\d+\\s*%\\s*(?:verwendet|used)/i.test(text)) return JSON.stringify({ notReady: true });
          return JSON.stringify({ text });
        })()`,
        returnByValue: true
      }, sessionId);
      evalData = JSON.parse(evalResult.result?.value || '{}');
      if (evalData.notLoggedIn || evalData.text) break;
      log(`Page not ready yet (attempt ${attempt + 1}/12)...`);
    }

    // Close the background target
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    targetId = null;
    cdp.close();

    if (!evalData) evalData = {};

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

function formatWeeklyDuration(totalMinutes) {
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const m = totalMinutes % 60;
    return m > 0 ? `${totalHours}h ${m}m` : `${totalHours}h`;
  }
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
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
  const weeklyResetStr = data.weekly?.resetInMinutes
    ? ` \u2014 resets in ${formatWeeklyDuration(data.weekly.resetInMinutes)}`
    : data.weekly?.resetDay && data.weekly?.resetTime
      ? ` \u2014 resets ${data.weekly.resetDay} ${data.weekly.resetTime}`
      : '';
  const sonnetPart = pctSonnet !== null ? ` | Sonnet: ${Math.round(pctSonnet)}%` : '';

  let status;
  if (pct5h >= 80) status = 'SLOW DOWN \u2014 5h limit near';
  else if (pctWeekly >= 70) status = 'CONSERVE \u2014 weekly >70%';
  else status = 'Budget healthy';

  const isCached = data._cached === true;
  const cacheLabel = isCached ? `CACHED ${data._ageMinutes}m ago` : 'LIVE just now';

  const line = '\u2500'.repeat(40);
  console.log(line);
  console.log(`\uD83D\uDCCA USAGE [${cacheLabel}]`);
  console.log(`5h: ${Math.round(pct5h)}% \u2014 ${reset5hStr}`);
  console.log(`Weekly: ${Math.round(pctWeekly)}%${sonnetPart}${weeklyResetStr}`);
  console.log(`Status: ${status}`);
  console.log(line);
}

/** Check if cached usage-live.json exists and has data. Returns age in minutes or -1. */
function getCacheAge() {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_LIVE_PATH, 'utf8'));
    if (!data.timestamp) return -1;
    return Math.round((Date.now() - new Date(data.timestamp).getTime()) / 60000);
  } catch { return -1; }
}

/** Mark cached data with age info so the caller knows it's stale. */
function markCached(ageMin) {
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_LIVE_PATH, 'utf8'));
    data._cached = true;
    data._ageMinutes = ageMin;
    fs.writeFileSync(USAGE_LIVE_PATH, JSON.stringify(data, null, 2));
  } catch {}
}

(async () => {
  const cdpReady = await isCDPAvailable();

  if (checkOnly) {
    // Extended check: also report whether Edge is running (exit 7 = not running at all)
    if (cdpReady) process.exit(0);
    process.exit(isEdgeRunning() ? 5 : 7);
  }

  if (!cdpReady) {
    if (autoStart) {
      // Non-destructive: only start Edge if it's not running at all
      if (!(await autoStartEdgeWithCDP())) {
        // Auto-start failed or Edge is running without CDP — fall back to cache
        const cacheAge = getCacheAge();
        if (cacheAge >= 0) {
          log(`Using cached data (${cacheAge}m old) — Edge auto-start not possible`);
          markCached(cacheAge);
          if (printSummary) printUsageSummary();
          process.exit(0);
        }
        process.exit(5);
      }
    } else if (activateCDP) {
      // Destructive: restart Edge (requires user consent)
      if (!(await restartEdgeWithCDP())) process.exit(6);
    } else {
      log('CDP not available on port', CDP_PORT);
      process.exit(5);
    }
  }

  const code = await scrapeViaCDP();
  if (code === 0) {
    if (printSummary) printUsageSummary();
    process.exit(0);
  }

  // Scrape failed — try cache as last resort
  const cacheAge = getCacheAge();
  if (cacheAge >= 0) {
    log(`Scrape failed (code ${code}), using cached data (${cacheAge}m old)`);
    markCached(cacheAge);
    if (printSummary) printUsageSummary();
    process.exit(0);
  }
  process.exit(code);
})();
