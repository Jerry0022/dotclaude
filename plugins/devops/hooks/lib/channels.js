/**
 * @module hooks/lib/channels
 * @description CJS twin of mcp-server/ship/lib/channels.js — pure helpers for
 *   the alpha/beta/stable ring model plus the consumer-side channel pin.
 *   Hooks are standalone CommonJS scripts and cannot import the ESM original;
 *   keep the two files in sync (spec: docs/superpowers/specs/
 *   2026-07-11-tag-channel-system-design.md).
 *
 *   The channel pin lives in `~/.claude/plugins/.channels.json` — a
 *   plugin-owned sidecar OUTSIDE the marketplace clones and OUTSIDE
 *   installed_plugins.json: clones get reset/cleaned by the pin sequence, and
 *   Claude Code's native tooling may rewrite the registry and strip unknown
 *   fields (spec §5.1/R3). One channel per MARKETPLACE — a single clone
 *   cannot serve two plugins on different channels.
 */

const fs = require('fs');
const path = require('path');

const CHANNELS = ['alpha', 'beta', 'stable'];

// Strict x.y.z — prerelease suffixes are deliberately NOT channel carriers.
const TAG_RE = /^(?:refs\/tags\/)?(?:(alpha|beta|stable)\/)?v(\d+)\.(\d+)\.(\d+)(?:\^\{\})?$/;

function parseChannelTag(ref) {
  const m = TAG_RE.exec(ref);
  if (!m) return null;
  return { channel: m[1] || 'bare', version: `${m[2]}.${m[3]}.${m[4]}` };
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function visibleChannels(pin) {
  const idx = CHANNELS.indexOf(pin);
  const start = idx === -1 ? CHANNELS.length - 1 : idx;
  return [...CHANNELS.slice(start), 'bare'];
}

/**
 * Resolve the highest version among tags visible to `pin`. Numeric-parse
 * resolver — cross-prefix refname sorting is forbidden (spec §5.2/R9).
 * On a version tie the non-bare tag wins.
 */
function latestVisible(tagNames, pin) {
  const visible = new Set(visibleChannels(pin));
  let best = null;
  for (const name of tagNames) {
    const parsed = parseChannelTag(name);
    if (!parsed || !visible.has(parsed.channel)) continue;
    const cleanTag = name.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    if (!best) {
      best = { tag: cleanTag, version: parsed.version, channel: parsed.channel };
      continue;
    }
    const cmp = compareVersions(parsed.version, best.version);
    if (cmp > 0 || (cmp === 0 && best.channel === 'bare' && parsed.channel !== 'bare')) {
      best = { tag: cleanTag, version: parsed.version, channel: parsed.channel };
    }
  }
  return best;
}

/**
 * Read the channel pin for a marketplace from `<pluginsDir>/.channels.json`.
 * Missing file, unreadable JSON, or an unknown channel value all degrade to
 * the safest ring: stable.
 */
function readChannelPin(pluginsDir, marketplace) {
  try {
    const raw = fs.readFileSync(path.join(pluginsDir, '.channels.json'), 'utf8');
    const pin = JSON.parse(raw)[marketplace];
    return CHANNELS.includes(pin) ? pin : 'stable';
  } catch {
    return 'stable';
  }
}

module.exports = { CHANNELS, parseChannelTag, compareVersions, visibleChannels, latestVisible, readChannelPin };
