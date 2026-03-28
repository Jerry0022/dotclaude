#!/usr/bin/env node
/**
 * @hook ss.tokens.scan
 * @version 0.1.0
 * @event SessionStart
 * @plugin dotclaude-dev-ops
 * @description Scan project for expensive files and update config for the
 *   pre.tokens.guard hook. Identifies the top 20 largest source files.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const CONFIG_DIR = path.join(cwd, '.claude');
const CONFIG_PATH = path.join(CONFIG_DIR, 'token-config.json');

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
    return {
      estimatedLimitTokens: 1000000,
      confirmThresholdPct: 0.02,
      tokensPerByte: 0.25,
      expensiveFiles: [],
    };
  }
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
const allFiles = scanFiles(cwd);
allFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);

cfg.expensiveFiles = allFiles.slice(0, 20).map(f => ({
  path: f.path,
  estimatedTokens: f.estimatedTokens,
}));

saveConfig(cfg);

const topFile = cfg.expensiveFiles[0];
if (topFile) {
  process.stderr.write(
    `[ss.tokens.scan] Scanned ${allFiles.length} files. ` +
    `Largest: ${topFile.path} (~${topFile.estimatedTokens.toLocaleString()} tokens)\n`
  );
}
