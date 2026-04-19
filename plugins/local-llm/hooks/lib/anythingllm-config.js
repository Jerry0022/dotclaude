/**
 * @module anythingllm-config
 * @version 0.1.0
 * @plugin local-llm
 * @description Config resolution for the local-llm plugin.
 *   Layer order (later overrides earlier):
 *     1. plugin defaults  — plugins/local-llm/scripts/config.json
 *     2. project config   — <cwd>/.claude/local-llm/config.json
 *     3. user config      — ~/.claude/local-llm/config.json
 *
 *   The API key is ONLY read from the user layer. Project-level API keys
 *   are ignored to prevent accidental commits. The user config path is
 *   also where the setup skill writes the key.
 *
 *   Model pinning: the plugin sets `chatProvider`/`chatModel` on the
 *   workspace via `POST /api/v1/workspace/{slug}/update`. Primary and
 *   fallback model tags live under `anythingllm.chatModel` and
 *   `anythingllm.fallbackChatModel`. The SessionStart hook probes the
 *   primary, and on failure pins the fallback.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
const USER_CONFIG_DIR = path.join(os.homedir(), '.claude', 'local-llm');
const USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, 'config.json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function deepMerge(base, layer) {
  if (!layer || typeof layer !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(layer)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function resolveConfig() {
  const defaults = readJson(path.join(PLUGIN_ROOT, 'scripts', 'config.json'));
  const project = readJson(path.join(process.cwd(), '.claude', 'local-llm', 'config.json'));
  const user = readJson(USER_CONFIG_PATH);

  let merged = deepMerge(defaults, project);
  merged = deepMerge(merged, user);

  merged.anythingllm = merged.anythingllm || {};
  if (project?.anythingllm?.apiKey) {
    merged.anythingllm.apiKey = user?.anythingllm?.apiKey || '';
  }

  return merged;
}

function saveApiKey(apiKey) {
  try { fs.mkdirSync(USER_CONFIG_DIR, { recursive: true }); } catch { /* ignore */ }
  const existing = readJson(USER_CONFIG_PATH);
  const next = {
    ...existing,
    anythingllm: { ...(existing.anythingllm || {}), apiKey },
  };
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return USER_CONFIG_PATH;
}

function hasApiKey(config) {
  const key = config?.anythingllm?.apiKey;
  return typeof key === 'string' && key.trim().length > 0;
}

module.exports = {
  resolveConfig,
  saveApiKey,
  hasApiKey,
  USER_CONFIG_PATH,
  USER_CONFIG_DIR,
  PLUGIN_ROOT,
};
