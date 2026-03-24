#!/usr/bin/env node
/**
 * Claude Code Startup Summary
 * Runs on SessionStart — shows compact usage dashboard from cached live data.
 * Also refreshes expensive-files list in config.json (used by precheck-cost.js).
 *
 * Does NOT refresh usage data itself — that is handled by /refresh-usage
 * running as a background agent at session start.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CONFIG_PATH = path.join(CLAUDE_DIR, 'scripts', 'config.json');
const LIVE_USAGE_PATH = path.join(CLAUDE_DIR, 'scripts', 'usage-live.json');

// ── helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch {
    return {
      estimatedLimitTokens: 1000000,
      confirmThresholdPct: 0.02,
      tokensPerByte: 0.25,
      expensiveFiles: [],
      fiveHourLimitTokens: 45000000,
      weeklyLimitTokens: 225000000
    };
  }
}

function saveConfig(cfg) {
  if (!cfg.fiveHourLimitTokens) cfg.fiveHourLimitTokens = 45000000;
  if (!cfg.weeklyLimitTokens) cfg.weeklyLimitTokens = 225000000;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Scan project files for expensive-files list (saved to config for precheck-cost.js) */
function scanProjectFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.git', '.claude', 'out-tsc', 'coverage', 'runtime', '.venv', '__pycache__', 'wheels', 'models', 'logs']);
  const SKIP_EXT = new Set(['.whl', '.exe', '.bin', '.dll', '.so', '.dylib', '.pyc', '.zip', '.tar', '.gz', '.png', '.jpg', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot']);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scanProjectFiles(full, results);
    else {
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const stat = fs.statSync(full);
        results.push({ path: full, size: stat.size, estimatedTokens: Math.ceil(stat.size * 0.25) });
      } catch {}
    }
  }
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────

const cfg = loadConfig();
const cwd = process.cwd();

// 1. Refresh expensive files list (used by precheck-cost.js, not displayed)
const allFiles = scanProjectFiles(cwd);
allFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
cfg.expensiveFiles = allFiles.slice(0, 20).map(f => ({
  path: path.relative(cwd, f.path).replace(/\\/g, '/'),
  estimatedTokens: f.estimatedTokens
}));
saveConfig(cfg);

// 2. Read cached live usage data (written by /refresh-usage background agent)
let liveData = null;
try {
  const raw = JSON.parse(fs.readFileSync(LIVE_USAGE_PATH, 'utf8'));
  if (raw.session && typeof raw.session.pct === 'number') {
    raw._age = Date.now() - new Date(raw.timestamp).getTime();
    liveData = raw;
  }
} catch {}

// 3. Print compact usage summary
const line = '\u2500'.repeat(40);
console.log('');
console.log(line);

if (liveData) {
  const ageMin = Math.max(0, Math.round(liveData._age / 60000));
  const dataSource = ageMin === 0 ? 'LIVE just now' : `LIVE ${ageMin}m ago`;

  const pct5h = liveData.session.pct || 0;
  const pctWeekly = liveData.weekly.pct || 0;
  const pctSonnet = liveData.weeklySonnet?.pct ?? null;

  const reset5hStr = liveData.session.resetInMinutes
    ? `resets in ${formatDuration(liveData.session.resetInMinutes * 60000)}`
    : 'unknown';
  const weeklyResetStr = liveData.weekly.resetDay && liveData.weekly.resetTime
    ? ` \u2014 resets ${liveData.weekly.resetDay} ${liveData.weekly.resetTime}`
    : '';
  const sonnetPart = pctSonnet !== null ? ` | Sonnet: ${Math.round(pctSonnet)}%` : '';

  let status;
  if (pct5h >= 80) status = 'SLOW DOWN \u2014 5h limit near';
  else if (pctWeekly >= 70) status = 'CONSERVE \u2014 weekly >70%';
  else status = 'Budget healthy';

  console.log(`\uD83D\uDCCA USAGE [${dataSource}]`);
  console.log(`5h: ${Math.round(pct5h)}% \u2014 ${reset5hStr}`);
  console.log(`Weekly: ${Math.round(pctWeekly)}%${sonnetPart}${weeklyResetStr}`);
  console.log(`Status: ${status}`);
} else {
  console.log('\uD83D\uDCCA USAGE [no data]');
  console.log('Run /refresh-usage to fetch live data from claude.ai');
}

console.log(line);
console.log('');
