#!/usr/bin/env node
/**
 * @hook ss.tokens.scan
 * @version 0.2.0
 * @event SessionStart
 * @plugin devops
 * @description Scan project for expensive files and update config for the
 *   pre.tokens.guard hook. Detects the user's Claude plan and writes
 *   plan-specific thresholds. Identifies the top 20 largest source files.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');

const cwd = process.cwd();
const CONFIG_DIR = path.join(cwd, '.claude');
const CONFIG_PATH = path.join(CONFIG_DIR, 'token-config.json');

const PLAN_DEFAULTS = require('../lib/plan-defaults');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.angular', '.git', '.claude', 'out-tsc',
  'coverage', 'runtime', '.venv', '__pycache__', 'wheels', 'models',
  'logs', '.next', '.nuxt', 'target', 'bin', 'obj', 'vendor', 'build',
]);

const SKIP_EXT = new Set([
  '.whl', '.exe', '.bin', '.dll', '.so', '.dylib', '.pyc',
  '.zip', '.tar', '.gz', '.png', '.jpg', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.lock', '.map',
]);

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { tokensPerByte: 0.25, expensiveFiles: [] };
  }
}

/**
 * Detect the Claude plan from available sources.
 *   1. CLAUDE_PLUGIN_CONFIG_claude_plan env var (set by Claude Code plugin system)
 *   2. Existing plan field in token-config.json (persisted from previous session)
 *   3. Plugin settings in global or project settings.json
 *   4. Default: max_20 (matches plugin.json default)
 */
function detectPlan(existingCfg) {
  const envPlan = process.env.CLAUDE_PLUGIN_CONFIG_claude_plan;
  if (envPlan && PLAN_DEFAULTS[envPlan]) return envPlan;

  if (existingCfg.plan && PLAN_DEFAULTS[existingCfg.plan]) return existingCfg.plan;

  // Check plugin config in settings.json
  const settingsPaths = [
    path.join(cwd, '.claude', 'settings.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  for (const sp of settingsPaths) {
    try {
      const settings = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const pluginCfg = settings.enabledPlugins?.['devops@dotclaude'] || settings.enabledPlugins?.['dotclaude-dev-ops@dotclaude-dev-ops'];
      if (pluginCfg?.config?.claude_plan && PLAN_DEFAULTS[pluginCfg.config.claude_plan]) {
        return pluginCfg.config.claude_plan;
      }
    } catch {}
  }

  return 'max_20';
}

function saveConfig(cfg) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch {}
}

function scanFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanFiles(full, results);
    } else {
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const stat = fs.statSync(full);
        results.push({
          path: path.relative(cwd, full).replace(/\\/g, '/'),
          size: stat.size,
          estimatedTokens: Math.ceil(stat.size * 0.25),
        });
      } catch {}
    }
  }
  return results;
}

// Cooldown: skip if token-config.json was updated < 10 min ago
const COOLDOWN_MS = 10 * 60 * 1000;
try {
  const stat = fs.statSync(CONFIG_PATH);
  if (Date.now() - stat.mtimeMs < COOLDOWN_MS) process.exit(0);
} catch {}

// Main
const cfg = loadConfig();
const plan = detectPlan(cfg);
const planDefaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.max_20;

const allFiles = scanFiles(cwd);
allFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);

cfg.plan = plan;
cfg.estimatedLimitTokens = planDefaults.estimatedLimitTokens;
cfg.confirmThresholdPct = planDefaults.confirmThresholdPct;
cfg.tokensPerByte = 0.25;
cfg.expensiveFiles = allFiles.slice(0, 20).map(f => ({
  path: f.path,
  estimatedTokens: f.estimatedTokens,
}));

saveConfig(cfg);

const threshold = Math.round(planDefaults.estimatedLimitTokens * planDefaults.confirmThresholdPct);
const topFile = cfg.expensiveFiles[0];
if (topFile) {
  process.stderr.write(
    `[ss.tokens.scan] plan=${plan} threshold=${threshold.toLocaleString()} tokens ` +
    `(${(planDefaults.confirmThresholdPct * 100).toFixed(0)}% of 200K). ` +
    `Scanned ${allFiles.length} files. ` +
    `Largest: ${topFile.path} (~${topFile.estimatedTokens.toLocaleString()} tokens)\n`
  );
}
