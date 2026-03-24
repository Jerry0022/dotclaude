#!/usr/bin/env node
/**
 * Claude Code Startup — Expensive Files Scanner
 * Runs on SessionStart — refreshes expensive-files list in config.json (used by precheck-cost.js).
 *
 * Usage display is NOT handled here — Claude reads usage-live.json directly
 * and outputs the summary as visible chat text (not hidden in collapsed hook output).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CONFIG_PATH = path.join(CLAUDE_DIR, 'scripts', 'config.json');
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

// Usage display has been moved out of this hook — Claude reads usage-live.json
// and outputs the summary directly as chat text (visible without expanding).
// See CLAUDE.md §Session Startup for details.
