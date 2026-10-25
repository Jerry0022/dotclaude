'use strict';
/**
 * @module features
 * @version 0.1.0
 * @plugin devops
 * @description Channel feature flags. Every release ships to all channels;
 *   a feature registered in `<pluginRoot>/features.json` with
 *   `minChannel: "alpha"` is offered only to consumers pinned to alpha, one
 *   with `"beta"` to alpha and beta pins. Stable pins see none of them —
 *   neither the docs (ss.knowledge.index, prompt.knowledge.dispatch) nor the
 *   scripts (which exit 126 at start) nor the skill aliases.
 *
 *   Fails CLOSED everywhere, never throws:
 *   - unknown feature name → not allowed;
 *   - registry present but unreadable/corrupt → no feature allowed, and every
 *     `deep-knowledge/*.md` / `scripts/*.js` / `skills/*` path that appears
 *     anywhere in the raw text counts as gated;
 *   - invalid `minChannel` → treated as `alpha` (the strictest);
 *   - channel pin missing/unreadable → `stable` (lib/channels.readChannelPin).
 *
 *   Developer rules (registering, gating, the context budget):
 *   docs/dev/feature-flags.md in the source repo (not shipped).
 *
 *   `opts` (all optional, for tests and callers that know better):
 *   `pluginRoot` (default: two levels above this file), `home` (default
 *   HOME/USERPROFILE/os.homedir()), `pluginsDir` (default
 *   `<home>/.claude/plugins`), `marketplace` (default: derived, see
 *   `marketplaceName`), `channel` (skip the pin lookup entirely).
 *   Results are cached per process and per option set; `_resetCache()` for tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Rank per channel: a pin sees every feature whose minChannel rank is <= its own. */
const RANK = Object.freeze({ stable: 0, beta: 1, alpha: 2 });
const GATE_CHANNELS = Object.freeze(['alpha', 'beta']);
const DEFAULT_MARKETPLACE = 'dotclaude';
const PLUGIN_NAME = 'devops';

const cache = new Map();

function homeDir(opts) {
  if (opts.home) return opts.home;
  return process.env.HOME || process.env.USERPROFILE || safe(() => os.homedir(), '');
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function pluginRootOf(opts) {
  return opts.pluginRoot || path.resolve(__dirname, '..', '..');
}

/** Normalize a registry path: forward slashes, no leading `./` or `/`. */
function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/^(?:\.\/|\/)+/, '');
}

/**
 * The marketplace the devops plugin was installed from:
 * opts.marketplace → `.../cache/<mp>/devops/...` in the plugin root path →
 * the first `devops@<mp>` key in installed_plugins.json → 'dotclaude'.
 */
function marketplaceName(opts = {}) {
  if (opts.marketplace) return String(opts.marketplace);
  const root = norm(pluginRootOf(opts));
  const m = root.match(/(?:^|\/)cache\/([^/]+)\/devops(?:\/|$)/);
  if (m) return m[1];
  const pluginsDir = opts.pluginsDir || path.join(homeDir(opts), '.claude', 'plugins');
  const fromRegistry = safe(() => {
    const reg = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8'));
    const keys = Object.keys((reg && reg.plugins) || reg || {});
    const key = keys.find(k => k.startsWith(`${PLUGIN_NAME}@`));
    return key ? key.slice(PLUGIN_NAME.length + 1) : null;
  }, null);
  return fromRegistry || DEFAULT_MARKETPLACE;
}

/** 'alpha' | 'beta' | 'stable' — never throws, anything odd is 'stable'. */
function currentChannel(opts = {}) {
  try {
    if (opts.channel !== undefined) return RANK[opts.channel] !== undefined ? opts.channel : 'stable';
    const pluginsDir = opts.pluginsDir || path.join(homeDir(opts), '.claude', 'plugins');
    const key = `channel|${pluginsDir}|${marketplaceName({ ...opts, pluginsDir })}`;
    if (cache.has(key)) return cache.get(key);
    const { readChannelPin } = require('./channels');
    const pin = readChannelPin(pluginsDir, marketplaceName({ ...opts, pluginsDir }));
    const channel = RANK[pin] !== undefined ? pin : 'stable';
    cache.set(key, channel);
    return channel;
  } catch {
    return 'stable';
  }
}

/**
 * Parse the registry. Returns { ok, features: {name: {minChannel, summary, docs, scripts, skills}}, rawPaths }.
 * ok=false with rawPaths filled when the file exists but is not a valid registry.
 */
function readRegistry(opts = {}) {
  const file = path.join(pluginRootOf(opts), 'features.json');
  const key = `registry|${file}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  let raw = null;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { /* missing: nothing registered */ }
  if (raw === null) {
    result = { ok: true, missing: true, features: {}, rawPaths: [] };
  } else {
    try {
      const parsed = JSON.parse(raw);
      const src = parsed && parsed.features;
      if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('no features object');
      const features = {};
      for (const [name, e] of Object.entries(src)) {
        const entry = e && typeof e === 'object' ? e : {};
        const list = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x).map(norm) : []);
        features[name] = {
          minChannel: GATE_CHANNELS.includes(entry.minChannel) ? entry.minChannel : 'alpha',
          summary: typeof entry.summary === 'string' ? entry.summary : '',
          docs: list(entry.docs),
          scripts: list(entry.scripts),
          skills: list(entry.skills),
        };
      }
      result = { ok: true, missing: false, features, rawPaths: [] };
    } catch {
      // Corrupt: we cannot know which feature owns what — gate every path
      // the text mentions, allow nothing.
      const rawPaths = [...new Set(
        [...raw.matchAll(/(?:deep-knowledge\/[\w.-]+\.md|scripts\/[\w./-]+\.js|skills\/[\w-]+)/g)].map(m => m[0]),
      )];
      result = { ok: false, missing: false, features: {}, rawPaths };
    }
  }
  cache.set(key, result);
  return result;
}

function allowedFor(minChannel, channel) {
  return (RANK[channel] || 0) >= (RANK[minChannel] !== undefined ? RANK[minChannel] : RANK.alpha);
}

/** true only when `name` is registered and the current channel reaches its minChannel. */
function featureAllowed(name, opts = {}) {
  try {
    const reg = readRegistry(opts);
    if (!reg.ok) return false;
    if (!Object.prototype.hasOwnProperty.call(reg.features, name)) return false;
    return allowedFor(reg.features[name].minChannel, currentChannel(opts));
  } catch {
    return false;
  }
}

/** [{ name, minChannel, summary, docs, scripts, skills, allowed }] — [] when the registry is unusable. */
function listFeatures(opts = {}) {
  try {
    const reg = readRegistry(opts);
    const channel = currentChannel(opts);
    return Object.entries(reg.features).map(([name, f]) => ({
      name, ...f, docs: [...f.docs], scripts: [...f.scripts], skills: [...f.skills],
      allowed: reg.ok && allowedFor(f.minChannel, channel),
    }));
  } catch {
    return [];
  }
}

function gatedPaths(kind, prefix, opts) {
  const out = new Set();
  try {
    const reg = readRegistry(opts);
    if (!reg.ok) {
      for (const p of reg.rawPaths) if (p.startsWith(prefix)) out.add(p);
      return out;
    }
    const channel = currentChannel(opts);
    for (const f of Object.values(reg.features)) {
      if (allowedFor(f.minChannel, channel)) continue;
      for (const p of f[kind]) out.add(p);
    }
  } catch { /* a failed read gates nothing more than the corrupt-path scan */ }
  return out;
}

/** Set of doc paths (relative to the plugin root, e.g. 'deep-knowledge/api-batch.md') NOT allowed now. */
function gatedDocs(opts = {}) {
  return gatedPaths('docs', 'deep-knowledge/', opts);
}

/** Set of skill dirs (e.g. 'skills/foo') NOT allowed now (optional `skills` registry field). */
function gatedSkills(opts = {}) {
  return gatedPaths('skills', 'skills/', opts);
}

/** True when the deep-knowledge file name (e.g. 'api-batch.md') is gated now. */
function docGated(file, opts = {}) {
  const f = norm(file);
  const rel = f.startsWith('deep-knowledge/') ? f : `deep-knowledge/${f}`;
  return gatedDocs(opts).has(rel);
}

/**
 * Allowed gated docs: [{ file: 'deep-knowledge/x.md', summary }] for features
 * the current channel may use — the index hook lists these (they are never in
 * INDEX.md, which every channel reads).
 */
function allowedFeatureDocs(opts = {}) {
  return listFeatures(opts).filter(f => f.allowed)
    .flatMap(f => f.docs.map(file => ({ feature: f.name, file, summary: f.summary })));
}

function _resetCache() { cache.clear(); }

module.exports = {
  RANK,
  currentChannel,
  marketplaceName,
  readRegistry,
  featureAllowed,
  listFeatures,
  gatedDocs,
  gatedSkills,
  docGated,
  allowedFeatureDocs,
  _resetCache,
};
