/**
 * @module ship/lib/channel-state
 * @description Ring-channel state from ONE `git ls-remote --tags origin` listing:
 *   the latest version per channel and how far beta/stable lag behind alpha.
 *   ship_release returns this so the completion card's promotion-gap nudge needs
 *   no git call of its own (a model-run ls-remote hung 650-1280 s several times).
 */

import { parseChannelTag, compareVersions } from "./channels.js";

/**
 * @param {string} out  `git ls-remote --tags origin` output
 * @returns {{ alpha: string|null, beta: string|null, stable: string|null, alphaVersions: string[] }}
 *   latest bare version (no "v") per channel; a bare `vX.Y.Z` tag counts as stable.
 */
export function parseChannelState(out) {
  const best = { alpha: null, beta: null, stable: null };
  const alphaVersions = new Set();
  for (const line of (out || "").split("\n")) {
    const ref = line.trim().split(/\s+/)[1];
    if (!ref) continue;
    const parsed = parseChannelTag(ref);
    if (!parsed) continue;
    const ch = parsed.channel === "bare" ? "stable" : parsed.channel;
    if (ch === "alpha") alphaVersions.add(parsed.version);
    if (!best[ch] || compareVersions(parsed.version, best[ch]) > 0) best[ch] = parsed.version;
  }
  return { ...best, alphaVersions: [...alphaVersions].sort(compareVersions) };
}

/**
 * Lag of a channel behind alpha: how many alpha versions it has not received,
 * and the age in days of the oldest of them. `ageOf(version)` returns the epoch
 * ms of that alpha tag or null (tags not fetched locally) — then days is null.
 */
export function channelLag(state, channel, { ageOf = () => null, now = Date.now() } = {}) {
  if (!state.alpha) return { versions: 0, days: null };
  const floor = state[channel];
  const pending = state.alphaVersions.filter((v) => !floor || compareVersions(v, floor) > 0);
  if (!pending.length) return { versions: 0, days: 0 };
  const t = ageOf(pending[0]);
  return { versions: pending.length, days: Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null };
}

/** The `channels` / `betaLag` / `stableLag` fields of a release result. */
export function channelFields(out, opts) {
  const state = parseChannelState(out);
  return {
    channels: { alpha: state.alpha, beta: state.beta, stable: state.stable },
    betaLag: channelLag(state, "beta", opts),
    stableLag: channelLag(state, "stable", opts),
  };
}
