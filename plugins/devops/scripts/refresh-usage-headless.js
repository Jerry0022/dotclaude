#!/usr/bin/env node
/**
 * @script refresh-usage-headless
 * @version 0.4.0
 * @plugin devops
 *
 * Headless Usage Scraper for claude.ai
 *
 * Spawns a dedicated, isolated Edge instance with its own user-data-dir under
 * ~/.claude/edge-usage-profile — completely independent of the user's main
 * Edge windows/tabs. Scrapes usage via raw CDP WebSocket, then kills only
 * that dedicated instance (by PID tree). The user's main Edge is never
 * touched.
 *
 * Login: the scraper profile starts empty. On first run it needs a one-time
 * visible login to claude.ai; cookies then persist in the scraper profile
 * and subsequent runs are fully headless/invisible.
 *
 * Exit codes:
 *   0 = success
 *   2 = not logged in (visible login window was opened)
 *   3 = parse error
 *   4 = scrape failed
 *   5 = scraper instance could not be launched
 *
 * Flags:
 *   --quiet           suppress debug logs (--summary still prints)
 *   --summary         after success, print formatted usage box
 *   --check-only      report whether the scraper CDP is currently alive (0/5)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Store usage data in ~/.claude — same location regardless of CWD or worktree
const SCRIPTS_DIR = path.join(os.homedir(), '.claude');
const USAGE_LIVE_PATH = path.join(SCRIPTS_DIR, 'usage-live.json');
const SCRAPER_PROFILE_DIR = path.join(SCRIPTS_DIR, 'edge-usage-profile');
const SCRAPER_PID_FILE = path.join(SCRIPTS_DIR, 'edge-usage-scraper.pid');
// Sticky "a visible login window was opened — don't open another" marker. A PID
// is unreliable on Windows (Edge re-execs into a singleton and the launched PID
// dies within seconds), so we guard on an age-bounded marker instead: at most
// ONE visible login window per LOGIN_RETRY_AFTER_MS, cleared the instant a
// scrape succeeds.
const LOGIN_MARKER_FILE = path.join(SCRIPTS_DIR, 'edge-usage-login-pending.json');
const LOGIN_RETRY_AFTER_MS = 30 * 60 * 1000;
// Machine-wide locks so parallel sessions don't each spawn an Edge window.
const LAUNCH_LOCK_FILE = path.join(SCRIPTS_DIR, 'edge-usage-launch.lock');
const LOGIN_LOCK_FILE = path.join(SCRIPTS_DIR, 'edge-usage-login.lock');
const LAUNCH_LOCK_STALE_MS = 60 * 1000;     // a cold launch finishes well under a minute
const LOGIN_LOCK_STALE_MS = 5 * 60 * 1000;  // leave time for the user to finish logging in
// If the cached usage-live.json is fresher than this, skip the Edge launch
// entirely and just print the cached summary. Prevents window-spam when the
// card is rendered in rapid succession.
const FRESH_CACHE_MAX_AGE_SECONDS = 15;
const USAGE_URL = 'https://claude.ai/settings/usage';
const LOGIN_URL = 'https://claude.ai/login';
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

// Platform guard — Edge CDP scraper is Windows-only. Only EXIT when run as the
// main script; when required (e.g. by the unit tests on a Linux CI runner) the
// platform-agnostic exports must stay importable without killing the process.
if (process.platform !== 'win32' && require.main === module) {
  if (!process.argv.includes('--quiet')) {
    console.log('refresh-usage-headless: Edge CDP scraper is Windows-only. Skipping.');
  }
  process.exit(5);
}

const isQuiet = process.argv.includes('--quiet');
const printSummary = process.argv.includes('--summary');
const checkOnly = process.argv.includes('--check-only');

function log(...args) {
  if (!isQuiet) console.log(...args);
}

function parseUsageText(text) {
  const pctMatches = [...text.matchAll(/(?:\d{1,2}:\d{2})?(\d{1,3}) % (?:verwendet|used)/g)];
  const pcts = pctMatches.map(m => parseInt(m[1]));

  // Match session reset: "Zurücksetzung in 2 Std. 30 Min." or just "30 Min." (< 1h left)
  const resetMatch = text.match(
    /(?:Zurücksetzung in|Resets? in)\s+(?:(\d+)\s*(?:Std\.|hr)\.?\s*)?(\d+)\s*(?:Min\.|min)/
  );
  // Fallback: hours-only format "Zurücksetzung in 2 Std." (no minutes)
  const resetMatchHoursOnly = !resetMatch && text.match(
    /(?:Zurücksetzung in|Resets? in)\s+(\d+)\s*(?:Std\.|hr)/
  );
  const resetMinutes = resetMatch
    ? (parseInt(resetMatch[1]) || 0) * 60 + (parseInt(resetMatch[2]) || 0)
    : resetMatchHoursOnly
      ? (parseInt(resetMatchHoursOnly[1]) || 0) * 60
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
  // ("Zurücksetzung in X Std. Y Min." or just "X Min.") instead of day+time.
  // "Alle Modelle" appears FIRST under weekly limits, followed by per-model
  // sections (e.g. "Nur Sonnet"). Take the FIRST duration match after
  // "Alle Modelle" — that's the weekly reset, not a per-model one.
  if (weeklyResetMinutes == null) {
    const afterAllModels = text.match(/(?:Alle Modelle|All Models)([\s\S]*)/);
    if (afterAllModels) {
      const firstDuration = afterAllModels[1].match(
        /(?:Zurücksetzung in|Resets? in)\s+(?:(\d+)\s*(?:Std\.|hr)\.?\s*)?(\d+)\s*(?:Min\.|min)/
      );
      if (firstDuration) {
        weeklyResetMinutes = (parseInt(firstDuration[1]) || 0) * 60 + (parseInt(firstDuration[2]) || 0);
      }
    }
  }
  // Fallback: hours-only format ("Zurücksetzung in X Std." without minutes)
  if (weeklyResetMinutes == null) {
    const afterAllModels = text.match(/(?:Alle Modelle|All Models)([\s\S]*)/);
    if (afterAllModels) {
      const firstHoursDuration = afterAllModels[1].match(
        /(?:Zurücksetzung in|Resets? in)\s+(\d+)\s*(?:Std\.|hr)/
      );
      if (firstHoursDuration) {
        weeklyResetMinutes = (parseInt(firstHoursDuration[1]) || 0) * 60;
      }
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

/**
 * Kill every Edge process that belongs to the dedicated scraper profile.
 *
 * Robust against Edge's bootstrap re-exec on Windows: the PID returned by
 * spawn() is a short-lived launcher that exits seconds after handing off to the
 * real singleton, so `taskkill /PID <stored>` silently no-ops while the real
 * browser lingers — this is what let orphans pile up across parallel sessions
 * (observed: 14 stray CDP instances ≈ 4 GB). Matching the unique
 * --user-data-dir on the LIVE command line kills the ACTUAL instances.
 *
 * Self-skips while a login window is pending so it can never kill the visible
 * window the user is logging in with. Windows-only (the scraper is Windows-only)
 * and never touches the user's main Edge — only this isolated profile.
 */
function reapScraperInstances() {
  if (process.platform !== 'win32') return;
  if (loginPending()) return; // never reap the visible login window mid-login
  const needle = path.basename(SCRAPER_PROFILE_DIR); // 'edge-usage-profile'
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*" + needle + "*' } | " +
    "ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }";
  try {
    execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      timeout: 8000, stdio: 'ignore',
    });
  } catch { /* best-effort reap */ }
}

/**
 * Kill the scraper instance. Fast PID-file path first (bounded by a timeout so a
 * wedged taskkill can't hang the whole refresh under the MCP's 60s budget), then
 * the reliable command-line reap that catches the real browser the stale PID
 * missed. Never touches the user's main Edge.
 */
function killScraperInstance() {
  try {
    const pid = parseInt(fs.readFileSync(SCRAPER_PID_FILE, 'utf8').trim(), 10);
    if (pid > 0) {
      try { execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore', timeout: 5000 }); } catch {}
    }
  } catch {}
  try { fs.unlinkSync(SCRAPER_PID_FILE); } catch {}
  reapScraperInstances();
}

/** Age of a lock file in ms, or Infinity if absent/unreadable. */
function lockAgeMs(lockFile) {
  try { return Date.now() - fs.statSync(lockFile).mtimeMs; } catch { return Infinity; }
}

/**
 * Atomically acquire a machine-wide lock so only ONE parallel session performs
 * a guarded action (cold launch / opening the login window). Uses exclusive
 * create ('wx'), which is atomic at the OS level — no check-then-act race.
 *
 * @param {string} lockFile
 * @param {() => boolean} isStale  reclaim predicate for an abandoned lock
 * @returns {boolean} true if this process won the lock
 */
function acquireLock(lockFile, isStale) {
  try { if (isStale()) fs.unlinkSync(lockFile); } catch {}
  try {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch { return false; }
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile); } catch {}
}

/**
 * Launch a dedicated Edge instance with its own user-data-dir and CDP port.
 * Runs fully isolated from the user's main Edge — separate cookies, separate
 * processes, separate tabs. Main Edge is never touched.
 *
 * @param {{ visible?: boolean, url?: string }} opts
 *   visible: true opens a window (needed for first-time login); false runs headless.
 *   url: initial URL to load.
 * @returns {Promise<number|null>} child PID on success, null on timeout
 */
async function launchScraperInstance({ visible = false, url = USAGE_URL } = {}) {
  try { fs.mkdirSync(SCRAPER_PROFILE_DIR, { recursive: true }); } catch {}

  const args = [
    `--user-data-dir=${SCRAPER_PROFILE_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeFeatureOverrides',
  ];
  if (!visible) {
    // Don't use --headless=new: claude.ai detects it and serves the login page
    // even with valid cookies. Run a real Edge window but off-screen + tiny so
    // it stays invisible. Auth/cookies behave identically to the visible login
    // session.
    args.push(
      '--window-position=-32000,-32000',
      '--window-size=1,1',
      '--disable-gpu',
      '--silent-launch'
    );
  } else {
    // Visible login window. The headless branch above persists off-screen
    // (-32000,-32000) 1x1 bounds into the SHARED scraper profile. Without
    // explicit bounds here, Edge restores those persisted bounds and the login
    // window opens off-screen + 1px — "displaced/hidden" — so the user can
    // never log in and every session keeps spawning more. Force an on-screen,
    // maximized window that overrides the persisted bounds.
    args.push(
      '--start-maximized',
      '--window-position=0,0',
      '--window-size=1280,900'
    );
  }
  args.push(url);

  log(`Launching dedicated scraper instance (${visible ? 'visible' : 'headless'})...`);
  const child = spawn(EDGE_EXE, args, { detached: true, stdio: 'ignore' });
  child.unref();
  try { fs.writeFileSync(SCRAPER_PID_FILE, String(child.pid)); } catch {}

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isCDPAvailable()) {
      log('Scraper CDP ready on port', CDP_PORT);
      return child.pid;
    }
  }
  log('Scraper instance did not become ready within 20 seconds');
  return null;
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
    // Detect logged-out state via URL redirect, OR by the presence of a
    // login button / email input (claude.ai sometimes renders the login UI
    // at /settings/usage without changing the URL).
    let evalData = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      const evalResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const url = window.location.href;
          if (url.includes('/login') || url.includes('/logout')) return JSON.stringify({ notLoggedIn: true });
          // Login UI heuristics — these appear on the public login page
          if (document.querySelector('input[type="email"], input[name="email"]')) return JSON.stringify({ notLoggedIn: true });
          const bodyText = (document.body && document.body.innerText) || '';
          if (/Continue with Google|Mit Google fortfahren|Log in to Claude|Bei Claude anmelden/i.test(bodyText)) {
            return JSON.stringify({ notLoggedIn: true });
          }
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

    // If we never got usage text AND never saw an explicit login signal, the
    // page just failed to render (transient: slow network, busy CPU, DOM still
    // settling). Do NOT assume logged-out here — that misfire is exactly what
    // spawned visible login windows on a perfectly logged-in profile. Let it
    // fall through to a transient scrape failure (code 3): the caller serves
    // cache and retries next turn WITHOUT opening a window. A real logout still
    // surfaces via the explicit url / login-UI checks above (notLoggedIn).
    if (evalData && !evalData.text && !evalData.notLoggedIn) {
      log('Page did not render usage content — treating as transient failure (no login window)');
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

function useCacheOrExit(code) {
  const cacheAge = getCacheAge();
  if (cacheAge >= 0) {
    log(`Falling back to cached data (${cacheAge}m old)`);
    markCached(cacheAge);
    if (printSummary) printUsageSummary();
    process.exit(0);
  }
  process.exit(code);
}

/**
 * A visible login window was opened recently and login hasn't succeeded yet.
 *
 * Age-bounded on purpose: a PID check is unreliable (Edge's launched PID dies
 * within seconds of re-exec, so a tasklist lookup falsely reports "gone" and the
 * old code reopened a window every few minutes). The marker instead guarantees
 * AT MOST one visible window per LOGIN_RETRY_AFTER_MS — and it's cleared the
 * moment any session scrapes successfully, so a real login stops the prompts
 * immediately. A window the user closed without logging in simply allows one
 * retry after the window elapses.
 */
/** Pure: is `marker` still inside the no-reopen retry window relative to nowMs? */
function isMarkerPending(marker, nowMs) {
  if (!marker || !marker.openedAt) return false;
  const opened = Date.parse(marker.openedAt);
  if (Number.isNaN(opened)) return false;
  return (nowMs - opened) < LOGIN_RETRY_AFTER_MS;
}

function loginPending() {
  try {
    return isMarkerPending(JSON.parse(fs.readFileSync(LOGIN_MARKER_FILE, 'utf8')), Date.now());
  } catch { return false; }
}

function writeLoginMarker() {
  try {
    fs.writeFileSync(LOGIN_MARKER_FILE, JSON.stringify({ openedAt: new Date().toISOString() }));
  } catch { /* non-fatal — worst case one extra retry */ }
}

function clearLoginMarker() {
  try { fs.unlinkSync(LOGIN_MARKER_FILE); } catch {}
}

async function main() {
  if (checkOnly) {
    process.exit((await isCDPAvailable()) ? 0 : 5);
  }

  // 15s short-circuit: if cached data is fresh enough, skip Edge entirely.
  // Eliminates window-spam from rapid back-to-back invocations.
  const cacheAgeMin = getCacheAge();
  if (cacheAgeMin >= 0) {
    const ageSec = Math.round((Date.now() - new Date(JSON.parse(fs.readFileSync(USAGE_LIVE_PATH, 'utf8')).timestamp).getTime()) / 1000);
    if (ageSec < FRESH_CACHE_MAX_AGE_SECONDS) {
      log(`Using fresh cache (${ageSec}s old, < ${FRESH_CACHE_MAX_AGE_SECONDS}s threshold)`);
      if (printSummary) printUsageSummary();
      process.exit(0);
    }
  }

  // If CDP is already up, a scraper instance from a previous run is still
  // alive — reuse it silently, no relaunch. Otherwise spawn a fresh
  // dedicated instance (main Edge is never touched either way).
  const cdpAlreadyUp = await isCDPAvailable();

  // A visible login window is pending (opened recently, login not yet
  // confirmed). NEVER cold-launch a competing headless instance against the
  // same profile + CDP port while it's open — that's the singleton/port
  // collision that ghost-spawns processes. If its CDP is up we fall through and
  // scrape THROUGH it: that's precisely how we detect the user finished logging
  // in (the scrape then succeeds and clears the marker below).
  if (loginPending() && !cdpAlreadyUp) {
    log('Login window pending — not launching a competing instance; serving cache');
    useCacheOrExit(2);
    return;
  }

  if (!cdpAlreadyUp) {
    // Machine-wide launch lock: with many parallel sessions, only one process
    // cold-launches the dedicated instance. Losers fall back to cache this turn;
    // once the shared instance is up on the CDP port, every later turn reuses it.
    const wonLaunch = acquireLock(
      LAUNCH_LOCK_FILE,
      () => lockAgeMs(LAUNCH_LOCK_FILE) > LAUNCH_LOCK_STALE_MS
    );
    if (!wonLaunch) {
      log('Another session is launching the scraper — using cache this turn');
      useCacheOrExit(5);
      return;
    }
    // Reap stale PID file + any wedged orphan instances, then launch EXACTLY
    // one. The reap self-skips while a login is pending (guarded above too).
    killScraperInstance();
    const pid = await launchScraperInstance({ visible: false, url: USAGE_URL });
    releaseLock(LAUNCH_LOCK_FILE);
    if (!pid) {
      log('Could not launch scraper instance');
      useCacheOrExit(5);
      return;
    }
  }

  const code = await scrapeViaCDP();

  if (code === 0) {
    // Successful scrape means we're logged in — clear the login marker so
    // nothing reopens a window, and release the login lock for completeness.
    clearLoginMarker();
    releaseLock(LOGIN_LOCK_FILE);
    // Leave the hidden scraper alive for fast reuse on the next invocation.
    // It's a single off-screen msedge.exe with its own isolated profile —
    // no visible window, no interference with the user's main Edge.
    if (printSummary) printUsageSummary();
    process.exit(0);
  }

  if (code === 2) {
    // Genuinely logged out. Open AT MOST one visible window per
    // LOGIN_RETRY_AFTER_MS — and never while one is already pending — so
    // parallel sessions can't stack login windows.
    if (loginPending()) {
      log('LOGIN_REQUIRED: a login window is already pending — not opening another');
      useCacheOrExit(2);
      return;
    }
    // Machine-wide login lock guards the brief open critical-section so two
    // sessions hitting code 2 at the same instant don't both open a window.
    const wonLogin = acquireLock(
      LOGIN_LOCK_FILE,
      () => lockAgeMs(LOGIN_LOCK_FILE) > LOGIN_LOCK_STALE_MS && !loginPending()
    );
    if (!wonLogin) {
      log('LOGIN_REQUIRED: another session is already opening a login window — skipping');
      useCacheOrExit(2);
      return;
    }
    // Reap the hidden scraper FIRST (loginPending is still false here, so the
    // reap runs), then claim the sticky marker BEFORE opening the window — so a
    // concurrent cold-launching session can't reap the visible window during
    // its ~20 s startup. The marker suppresses every further window until a
    // scrape succeeds or LOGIN_RETRY_AFTER_MS passes. Caller (SKILL.md) tells
    // the user inline.
    killScraperInstance();
    try { fs.unlinkSync(SCRAPER_PID_FILE); } catch {}
    writeLoginMarker();
    log('LOGIN_REQUIRED: scraper profile is not logged in to claude.ai');
    await launchScraperInstance({ visible: true, url: LOGIN_URL });
    process.exit(2);
  }

  // Scrape failed (parse/CDP/transient) — reap so the next run relaunches fresh
  // (self-skips if a login is pending), then fall back to cached data.
  killScraperInstance();
  useCacheOrExit(code);
}

if (require.main === module) {
  main().catch((err) => {
    try { log('refresh-usage-headless fatal:', err && err.message); } catch {}
    useCacheOrExit(5);
  });
}

module.exports = {
  parseUsageText,
  isMarkerPending,
  loginPending,
  reapScraperInstances,
  LOGIN_RETRY_AFTER_MS,
  FRESH_CACHE_MAX_AGE_SECONDS,
};
