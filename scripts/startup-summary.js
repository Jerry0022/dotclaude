#!/usr/bin/env node
/**
 * Claude Code Startup Summary
 * Runs on SessionStart — shows:
 * - 5h rolling window usage (account-wide)
 * - Weekly rolling window usage (account-wide)
 * - Top expensive prompts
 * - Recent session history (persisted)
 * - Expensive files to avoid
 *
 * Limits are estimated from local .jsonl session files.
 * Configure plan limits in config.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'scripts', 'config.json');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HISTORY_PATH = path.join(os.homedir(), '.claude', 'scripts', 'session-history.json');
const LIVE_USAGE_PATH = path.join(os.homedir(), '.claude', 'scripts', 'usage-live.json');

const HOUR_MS = 3600000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const WEEK_MS = 7 * 24 * HOUR_MS;
const LIVE_DATA_MAX_AGE_MS = 60 * 60000; // 60 minutes

// ── helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch {
    return {
      estimatedLimitTokens: 1000000,
      confirmThresholdPct: 0.02,
      tokensPerByte: 0.25,
      sessionsToAnalyze: 5,
      expensiveFiles: [],
      // Plan limits (configure for your plan)
      fiveHourLimitTokens: 45000000,
      weeklyLimitTokens: 225000000
    };
  }
}

function saveConfig(cfg) {
  // Ensure limit fields exist with defaults
  if (!cfg.fiveHourLimitTokens) cfg.fiveHourLimitTokens = 45000000;
  if (!cfg.weeklyLimitTokens) cfg.weeklyLimitTokens = 225000000;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); }
  catch { return { sessions: [] }; }
}

function saveHistory(history) {
  try { fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2)); } catch {}
}

/** Load live usage data scraped from claude.ai (if recent enough) */
function loadLiveUsage() {
  try {
    const data = JSON.parse(fs.readFileSync(LIVE_USAGE_PATH, 'utf8'));
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age <= LIVE_DATA_MAX_AGE_MS && data.session && typeof data.session.pct === 'number') {
      data._age = age;
      data._source = 'live';
      return data;
    }
  } catch {}
  return null;
}

/** Convert path to Claude's project hash: normalize to /, then replace : and / with - */
function cwdToProjectHash(cwd) {
  return cwd.replace(/\\/g, '/').split('').map(c => /[:/]/.test(c) ? '-' : c).join('');
}

/**
 * Find ALL .jsonl session files across ALL projects (for global rate limit tracking).
 * Includes subagent files.
 */
function findAllGlobalSessions() {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const results = [];

  function scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        scanDir(full);
      } else if (e.name.endsWith('.jsonl')) {
        try {
          results.push({ file: full, mtime: fs.statSync(full).mtimeMs });
        } catch {}
      }
    }
  }

  scanDir(projectsDir);
  return results;
}

/**
 * Find the N most recent session .jsonl files for the current project (including worktrees + subagents).
 */
function findProjectSessions(projectHash, n) {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const allSessionFiles = [];
  let dirs;
  try { dirs = fs.readdirSync(projectsDir); } catch { return []; }

  for (const d of dirs) {
    if (d !== projectHash && !d.startsWith(projectHash + '-')) continue;
    const dirPath = path.join(projectsDir, d);

    function scanDir(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scanDir(full);
        } else if (e.name.endsWith('.jsonl')) {
          try {
            allSessionFiles.push({ file: full, mtime: fs.statSync(full).mtimeMs });
          } catch {}
        }
      }
    }
    scanDir(dirPath);
  }

  return allSessionFiles
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n)
    .map(f => f.file);
}

/** Quick token count from a .jsonl — only counts totals, no prompt parsing (fast) */
function quickTokenCount(filePath) {
  let totalTokens = 0;
  let cacheReadTokens = 0;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === 'assistant' && msg.message?.usage) {
        const u = msg.message.usage;
        totalTokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        cacheReadTokens += (u.cache_read_input_tokens || 0);
      }
    }
  } catch {}
  return { totalTokens, cacheReadTokens };
}

/** Full parse of a session .jsonl — includes prompt extraction */
function parseSession(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let totalInputTokens = 0;
  const prompts = [];
  let lastUserText = null;
  let pendingAssistantTokens = 0;

  for (const line of lines) {
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }

    if (msg.type === 'user') {
      if (lastUserText !== null && pendingAssistantTokens > 0) {
        prompts.push({ text: lastUserText, tokens: pendingAssistantTokens });
      }
      const content = msg.message?.content;
      if (typeof content === 'string' && content.trim()) {
        lastUserText = content.trim().slice(0, 80).replace(/\n/g, ' ');
      } else if (Array.isArray(content)) {
        const textPart = content.find(c => c.type === 'text' && c.text && c.text.trim());
        if (textPart) {
          lastUserText = textPart.text.trim().slice(0, 80).replace(/\n/g, ' ');
        } else {
          const toolResult = content.find(c => c.type === 'tool_result');
          lastUserText = toolResult ? `[tool result]` : '[system]';
        }
      } else {
        lastUserText = null;
      }
      pendingAssistantTokens = 0;
    }

    if (msg.type === 'assistant' && msg.message?.usage) {
      const u = msg.message.usage;
      const msgTokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
      totalTokens += msgTokens;
      totalInputTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      cacheReadTokens += (u.cache_read_input_tokens || 0);
      pendingAssistantTokens += msgTokens;
    }
  }
  if (lastUserText !== null && pendingAssistantTokens > 0) {
    prompts.push({ text: lastUserText, tokens: pendingAssistantTokens });
  }

  return { totalTokens, cacheReadTokens, totalInputTokens, prompts };
}

function inferReason(text) {
  const t = text.toLowerCase();
  if (/explore|analyze|analyse|scan|understand|codebase|repo|repository/.test(t)) return 'codebase exploration';
  if (/create|write|skill|command/.test(t)) return 'multiple Write operations';
  if (/install|npm ci|npm install|dependencies/.test(t)) return 'dependency installation';
  if (/fix|bug|debug|error|freeze|hang/.test(t)) return 'debugging + file reads';
  if (/plan|design|architect|sprint/.test(t)) return 'planning + context loading';
  if (/github|project|milestone|label|issue|pr\b/.test(t)) return 'GitHub API operations';
  if (/review|check|validate/.test(t)) return 'code review / validation';
  if (/test|spec|e2e/.test(t)) return 'test execution';
  return 'large context accumulation';
}

function scanProjectFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.angular', '.git', '.claude', 'out-tsc', 'coverage', 'runtime', '.venv', '__pycache__', 'wheels', 'models', 'logs']);
  const SKIP_EXT = new Set(['.whl', '.exe', '.bin', '.dll', '.so', '.dylib', '.pyc', '.zip', '.tar', '.gz', '.png', '.jpg', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot']);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanProjectFiles(fullPath, results);
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        results.push({ path: fullPath, size: stat.size, estimatedTokens: Math.ceil(stat.size * 0.25) });
      } catch {}
    }
  }
  return results;
}

function bar(pct, width = 20) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const filled = Math.round(clamped / 100 * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── main ─────────────────────────────────────────────────────────────────────

const cfg = loadConfig();
const cwd = process.cwd();
const now = Date.now();

// 1. Resolve project root
let projectRoot = cwd;
const worktreeMatch = cwd.replace(/\\/g, '/').match(/^(.+?)\/\.claude\/worktrees\//);
if (worktreeMatch) projectRoot = worktreeMatch[1];

// 2. Refresh expensive files list
const allFiles = scanProjectFiles(cwd);
allFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
const top20 = allFiles.slice(0, 20).map(f => ({
  path: path.relative(cwd, f.path).replace(/\\/g, '/'),
  estimatedTokens: f.estimatedTokens
}));
cfg.expensiveFiles = top20;
saveConfig(cfg);

// 3. Global rate limit: scan ALL sessions across ALL projects
const allGlobalFiles = findAllGlobalSessions();
let tokens5h = 0, tokens7d = 0, cache5h = 0, cache7d = 0;
let oldest5hFile = now;

for (const { file, mtime } of allGlobalFiles) {
  const age = now - mtime;
  if (age <= FIVE_HOURS_MS) {
    const { totalTokens, cacheReadTokens } = quickTokenCount(file);
    tokens5h += totalTokens;
    cache5h += cacheReadTokens;
    if (mtime < oldest5hFile) oldest5hFile = mtime;
  }
  if (age <= WEEK_MS) {
    const { totalTokens, cacheReadTokens } = quickTokenCount(file);
    tokens7d += totalTokens;
    cache7d += cacheReadTokens;
  }
}

// 4. Project-level sessions (for expensive prompts + history)
const projectHash = cwdToProjectHash(projectRoot);
const sessionFiles = findProjectSessions(projectHash, cfg.sessionsToAnalyze || 5);

let totalTokensProject = 0;
let totalCacheProject = 0;
let totalInputProject = 0;
const allPrompts = [];
const sessionSummaries = [];

for (const sf of sessionFiles) {
  try {
    const { totalTokens, cacheReadTokens, totalInputTokens, prompts } = parseSession(sf);
    totalTokensProject += totalTokens;
    totalCacheProject += cacheReadTokens;
    totalInputProject += totalInputTokens;
    allPrompts.push(...prompts);

    const sessionId = path.basename(sf, '.jsonl');
    const mtime = fs.statSync(sf).mtimeMs;
    sessionSummaries.push({
      id: sessionId,
      file: sf,
      date: new Date(mtime).toISOString(),
      totalTokens,
      cacheReadTokens,
      totalInputTokens,
      topPrompt: prompts.sort((a, b) => b.tokens - a.tokens)[0] || null
    });
  } catch {}
}

// 5. Persist session history
const history = loadHistory();
const existingIds = new Set(history.sessions.map(s => s.id));
for (const s of sessionSummaries) {
  if (!existingIds.has(s.id)) {
    history.sessions.push(s);
    existingIds.add(s.id);
  } else {
    const idx = history.sessions.findIndex(h => h.id === s.id);
    if (idx >= 0) history.sessions[idx] = s;
  }
}
history.sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
history.sessions = history.sessions.slice(0, 30);
saveHistory(history);

// 6. Load live usage data (scraped from claude.ai) or fall back to local estimates
const liveData = loadLiveUsage();

let pct5h, pctWeekly, pctSonnet, reset5hStr, weeklyResetStr, dataSource;

if (liveData) {
  pct5h = liveData.session.pct || 0;
  pctWeekly = liveData.weekly.pct || 0;
  pctSonnet = liveData.weeklySonnet?.pct;
  reset5hStr = liveData.session.resetInMinutes
    ? `resets in ${formatDuration(liveData.session.resetInMinutes * 60000)}`
    : 'unknown';
  weeklyResetStr = liveData.weekly.resetDay && liveData.weekly.resetTime
    ? `resets ${liveData.weekly.resetDay} ${liveData.weekly.resetTime}`
    : '';
  const ageMin = Math.round(liveData._age / 60000);
  dataSource = `LIVE (${ageMin}m ago)`;
} else {
  // Fallback: local estimate from .jsonl files
  const limit5h = cfg.fiveHourLimitTokens;
  const limitWeekly = cfg.weeklyLimitTokens;
  pct5h = Math.min((tokens5h / limit5h) * 100, 100);
  pctWeekly = Math.min((tokens7d / limitWeekly) * 100, 100);
  pctSonnet = null;
  const reset5h = new Date(oldest5hFile + FIVE_HOURS_MS);
  reset5hStr = tokens5h > 0
    ? `resets in ${formatDuration(Math.max(0, reset5h.getTime() - now))}`
    : 'no usage yet';
  weeklyResetStr = '';
  dataSource = 'LOCAL ESTIMATE';
}

// Compute pace from local data regardless of source
const elapsed5hMs = Math.max(now - oldest5hFile, 60000);
const tokensPerHour = Math.round(tokens5h / (elapsed5hMs / HOUR_MS));
const sustainableRate = Math.round(cfg.fiveHourLimitTokens / 5);
const paceStatus = tokensPerHour <= sustainableRate * 1.1 ? 'OK' : tokensPerHour <= sustainableRate * 1.5 ? 'HIGH' : 'CRITICAL';

allPrompts.sort((a, b) => b.tokens - a.tokens);
const top3 = allPrompts.slice(0, 3);

const threshold = Math.round(cfg.estimatedLimitTokens * cfg.confirmThresholdPct).toLocaleString('en-US');

// Per-session context window
const cacheEff = totalInputProject > 0
  ? Math.round((totalCacheProject / (totalInputProject + totalCacheProject)) * 100)
  : 0;

// 7. Print
const W = 64;
const sep = '\u2550'.repeat(W);

function pad(text) {
  const vis = text.replace(/[\u2728\u26A0\u2705\u2611\u2610\u{1F4A1}\u{1F4CA}\u{1F525}\u{1F7E2}\u{1F7E1}]/gu, 'XX');
  const needed = W - 4 - vis.length;
  return `\u2551  ${text}${' '.repeat(Math.max(0, needed))}\u2551`;
}

console.log('');
console.log(`\u2554${sep}\u2557`);
console.log(pad(`CLAUDE USAGE DASHBOARD  [${dataSource}]`));
console.log(`\u2560${sep}\u2563`);

// 5h window
const warn5h = pct5h >= 80 ? ' << SLOW DOWN' : '';
console.log(pad(`5h WINDOW   ${bar(pct5h)}  ${String(Math.round(pct5h)).padStart(3)}%${warn5h}`));
console.log(pad(`  ${reset5hStr}   Pace: ${formatTokens(tokensPerHour)}/h [${paceStatus}]`));

console.log(`\u2560${sep}\u2563`);

// Weekly window
const warnWeekly = pctWeekly >= 80 ? ' << CONSERVE' : '';
console.log(pad(`WEEKLY      ${bar(pctWeekly)}  ${String(Math.round(pctWeekly)).padStart(3)}%${warnWeekly}`));
if (pctSonnet !== null) {
  console.log(pad(`  Sonnet:   ${bar(pctSonnet)}  ${String(Math.round(pctSonnet)).padStart(3)}%`));
}
if (weeklyResetStr) {
  console.log(pad(`  ${weeklyResetStr}`));
}

console.log(`\u2560${sep}\u2563`);
console.log(pad(`SESSION  Cache: ${cacheEff}%   Window: ${formatTokens(cfg.estimatedLimitTokens)}   Threshold: ${threshold}t`));

console.log(`\u2560${sep}\u2563`);

// Top expensive prompts
console.log(pad(`TOP 3 EXPENSIVE PROMPTS (last ${sessionFiles.length} project sessions)`));
if (top3.length === 0) {
  console.log(pad('  No session data found yet.'));
} else {
  top3.forEach((p, i) => {
    const tokStr = formatTokens(p.tokens);
    const maxLen = W - 4 - 4 - tokStr.length - 5;
    const t = p.text.length > maxLen ? p.text.slice(0, maxLen - 1) + '\u2026' : p.text;
    console.log(pad(`  ${i + 1}. ${tokStr.padEnd(6)} "${t}"`));
  });
}

console.log(`\u2560${sep}\u2563`);

// Recent sessions
const recentHistory = history.sessions.filter(s => !s.file.includes('/subagents/')).slice(0, 3);
if (recentHistory.length > 0) {
  console.log(pad('RECENT SESSIONS'));
  for (const s of recentHistory) {
    const d = new Date(s.date);
    const dateStr = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tok = formatTokens(s.totalTokens).padStart(6);
    const prompt = s.topPrompt ? s.topPrompt.text.slice(0, 28) : '(no data)';
    console.log(pad(`  ${dateStr}  ${tok}  "${prompt}\u2026"`));
  }
  console.log(`\u2560${sep}\u2563`);
}

// Expensive files
console.log(pad(`AVOID THESE FILES (>${threshold} tokens):`));
top20.slice(0, 5).forEach(f => {
  const tok = `${Math.round(f.estimatedTokens / 1000)}K`;
  const maxLen = W - 4 - tok.length - 6;
  const p = f.path.length > maxLen ? '\u2026' + f.path.slice(-(maxLen - 1)) : f.path;
  console.log(pad(`  \u2022 ${p}  ${tok}`));
});
console.log(pad(`  (${allFiles.length} files scanned)`));

console.log(`\u2560${sep}\u2563`);

// Advice line based on current state
if (pct5h >= 80) {
  console.log(pad('>> 5h limit near — ask before token-heavy ops'));
} else if (pctWeekly >= 70) {
  console.log(pad('>> Weekly budget >70% — prefer targeted over broad ops'));
} else {
  console.log(pad('>> Budget healthy — proceed normally'));
}

// Stale data warning
if (!liveData) {
  console.log(pad('>> Run /refresh-usage to scrape live data from claude.ai'));
}

console.log(`\u255A${sep}\u255D`);
console.log('');
