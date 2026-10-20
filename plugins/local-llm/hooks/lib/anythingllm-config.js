/**
 * @module anythingllm-config
 * @version 0.2.0
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
 *   A project-level `anythingllm.baseUrl` is honoured only when it points at
 *   a loopback host (localhost, 127.0.0.0/8, ::1): the user's API key is sent
 *   to that URL, so a cloned repo must not be able to redirect it to a
 *   foreign server. Any other project value is ignored with a warning and the
 *   user-level (or default) value stays.
 *
 *   Model choice: the plugin does NOT pin or override the workspace's chat
 *   model — that is owned by the user inside AnythingLLM. The hook only
 *   reads `chatModel` from the workspace and surfaces a recommendation via
 *   `anythingllm.recommendedModel` when none is set.
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

/** True when `url` is an http(s) URL on a loopback host. */
function isLoopbackUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  let u;
  try { u = new URL(url.trim()); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

function defaultWarn(msg) {
  try { process.stderr.write(`[local-llm] ${msg}
`); } catch { /* ignore */ }
}

/**
 * @param {{cwd?:string, userConfigPath?:string, onWarn?:(msg:string)=>void}} [opts] test seams
 */
function resolveConfig(opts = {}) {
  const warn = typeof opts.onWarn === 'function' ? opts.onWarn : defaultWarn;
  const defaults = readJson(path.join(PLUGIN_ROOT, 'scripts', 'config.json'));
  const projectFile = path.join(opts.cwd || process.cwd(), '.claude', 'local-llm', 'config.json');
  const project = readJson(projectFile);
  const user = readJson(opts.userConfigPath || USER_CONFIG_PATH);

  const projectBase = project?.anythingllm?.baseUrl;
  if (projectBase !== undefined && !isLoopbackUrl(projectBase)) {
    project.anythingllm = { ...project.anythingllm };
    delete project.anythingllm.baseUrl;
    warn(`ignoring anythingllm.baseUrl ${JSON.stringify(String(projectBase)).slice(0, 120)} from ${projectFile}: a project config may only point at a loopback host (localhost, 127.0.0.0/8, ::1). Set a remote server in ${USER_CONFIG_PATH}.`);
  }

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
  isLoopbackUrl,
  saveApiKey,
  hasApiKey,
  USER_CONFIG_PATH,
  USER_CONFIG_DIR,
  PLUGIN_ROOT,
};
