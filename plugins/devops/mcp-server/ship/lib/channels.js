/**
 * @module ship/lib/channels
 * @description Pure helpers for the alpha/beta/stable ring model
 *   (spec: docs/superpowers/specs/2026-07-11-tag-channel-system-design.md).
 *   Channel identity lives ONLY in the tag namespace (`alpha/vX.Y.Z`,
 *   `beta/vX.Y.Z`, `stable/vX.Y.Z`, bare `vX.Y.Z` = stable alias) — version
 *   files stay channel-free so promotion is a pure re-tag of the same SHA.
 *
 *   CJS twin: plugins/devops/hooks/lib/channels.js (hooks are standalone
 *   CommonJS scripts and cannot import this ESM module — keep both in sync).
 */

export const CHANNELS = ["alpha", "beta", "stable"];

// Strict x.y.z — prerelease suffixes are deliberately NOT channel carriers.
const TAG_RE = /^(?:refs\/tags\/)?(?:(alpha|beta|stable)\/)?v(\d+)\.(\d+)\.(\d+)(?:\^\{\})?$/;

/**
 * Parse a tag name (or full ref) into { channel, version }.
 * Bare `vX.Y.Z` tags report channel "bare" (stable alias).
 * Returns null for anything outside the channel tag grammar.
 */
export function parseChannelTag(ref) {
  const m = TAG_RE.exec(ref);
  if (!m) return null;
  return { channel: m[1] || "bare", version: `${m[2]}.${m[3]}.${m[4]}` };
}

/** Numeric x.y.z comparison — never lexicographic (0.9.0 < 0.10.0). */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Channels visible to a pin: own channel plus every more-stable one.
 * Bare tags are always included (pre-channel releases are stable).
 * Unknown pins degrade to the safest ring (stable).
 */
export function visibleChannels(pin) {
  const idx = CHANNELS.indexOf(pin);
  const start = idx === -1 ? CHANNELS.length - 1 : idx;
  return [...CHANNELS.slice(start), "bare"];
}

/**
 * Resolve the highest version among tags visible to `pin`.
 * MUST stay a numeric-parse resolver — sorting refnames across channel
 * prefixes (git for-each-ref --sort=v:refname over a cross-prefix glob)
 * ranks the prefix above the version and is forbidden (spec §5.2 / R9).
 * On a version tie the more specific (non-bare) tag wins so the resolved
 * ref names its channel explicitly.
 */
export function latestVisible(tagNames, pin) {
  const visible = new Set(visibleChannels(pin));
  let best = null;
  for (const name of tagNames) {
    const parsed = parseChannelTag(name);
    if (!parsed || !visible.has(parsed.channel)) continue;
    const cleanTag = name.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    if (!best) {
      best = { tag: cleanTag, version: parsed.version, channel: parsed.channel };
      continue;
    }
    const cmp = compareVersions(parsed.version, best.version);
    if (cmp > 0 || (cmp === 0 && best.channel === "bare" && parsed.channel !== "bare")) {
      best = { tag: cleanTag, version: parsed.version, channel: parsed.channel };
    }
  }
  return best;
}
