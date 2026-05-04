/**
 * @module anythingllm-tier-cache
 * @version 0.1.0
 * @plugin local-llm
 * @description Persistent benchmark cache for the local model's coding tier.
 *
 *   File: ~/.claude/cache/local-llm-benchmark.json
 *   Schema:
 *     {
 *       "schemaVersion": 1,
 *       "model":   "qwen3-vl:8b",       // active workspace chatModel at run time
 *       "ranAt":   "2026-05-04T...Z",
 *       "tier":    "high" | "medium" | "low",
 *       "score":   0..1,
 *       "tests":   [ { name, passed, latencyMs } ]
 *     }
 *
 *   Validity:
 *     - cache.model must equal the current workspace.chatModel
 *     - cache.ranAt must be < 90 days old
 *     - schemaVersion must match
 *   Otherwise the cache is treated as missing and the caller should trigger
 *   a fresh background benchmark.
 *
 *   In-progress runs leave a sentinel `<file>.running` so concurrent sessions
 *   don't all spawn benchmarks for the same model.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache');
const CACHE_PATH = path.join(CACHE_DIR, 'local-llm-benchmark.json');
const RUNNING_PATH = `${CACHE_PATH}.running`;
const SCHEMA_VERSION = 1;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const RUNNING_STALE_MS = 30 * 60 * 1000; // older than 30min → considered crashed

const VALID_TIERS = new Set(['low', 'medium', 'high']);

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== SCHEMA_VERSION) return null;
    if (typeof data.model !== 'string' || !data.model) return null;
    if (typeof data.ranAt !== 'string' || !Number.isFinite(Date.parse(data.ranAt))) return null;
    if (!VALID_TIERS.has(data.tier)) return null;
    const score = Number(data.score);
    if (!Number.isFinite(score)) return null;
    return { ...data, score };
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    ...entry,
  };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  clearRunning();
  return CACHE_PATH;
}

function isValid(cache, currentModel) {
  if (!cache) return false;
  if (!cache.model || cache.model !== currentModel) return false;
  const ranAt = Date.parse(cache.ranAt);
  if (!Number.isFinite(ranAt)) return false;
  if (Date.now() - ranAt > MAX_AGE_MS) return false;
  return true;
}

function isRunning() {
  try {
    const stat = fs.statSync(RUNNING_PATH);
    if (Date.now() - stat.mtimeMs > RUNNING_STALE_MS) {
      clearRunning();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function markRunning(model) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
  try {
    fs.writeFileSync(RUNNING_PATH, JSON.stringify({ model, startedAt: new Date().toISOString() }), 'utf8');
  } catch { /* ignore */ }
}

function clearRunning() {
  try { fs.unlinkSync(RUNNING_PATH); } catch { /* ignore */ }
}

module.exports = {
  CACHE_PATH,
  RUNNING_PATH,
  SCHEMA_VERSION,
  MAX_AGE_MS,
  readCache,
  writeCache,
  isValid,
  isRunning,
  markRunning,
  clearRunning,
};
