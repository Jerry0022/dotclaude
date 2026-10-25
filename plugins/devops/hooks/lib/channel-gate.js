'use strict';
/**
 * @module hooks/lib/channel-gate
 * @description One fail-closed rule for features that ship in every channel
 *   but may only be visible/usable on some (e.g. alpha-only). Sits on top of
 *   `channels.js` and the consumer pin sidecar `~/.claude/plugins/.channels.json`.
 *
 *   - The pin is read at CALL time, never cached: the same commit is promoted
 *     alpha -> beta -> stable, so files are identical and only the pin differs.
 *   - Fail-closed: a feature is enabled only when the pin is listed for it.
 *     Missing/corrupt/unknown pin, unknown feature id, or ANY thrown error
 *     -> disabled.
 *   - Disabled = silent no-op. Callers must treat a gated skill exactly like
 *     an unknown skill: no hint, no "not available" message.
 *
 *   Inventory of entry points: deep-knowledge/channel-gating.md.
 */

const os = require('os');
const path = require('path');
const { readChannelPin } = require('./channels');

/** Marketplace the pin sidecar is keyed by. */
const MARKETPLACE = 'dotclaude';

/** feature id -> channels it is enabled on. */
const GATED_FEATURES = Object.freeze({
  'frustrated-mode': Object.freeze(['alpha']),
});

/**
 * skill name -> feature id. Empty until the skill itself lands (its own
 * issue adds the entry here); a skill listed here is hidden from the router
 * on every channel the feature is not enabled on.
 */
const GATED_SKILLS = Object.freeze({});

/** Default reader: the real sidecar. Degrades to 'stable' on any problem. */
function defaultPinReader() {
  return readChannelPin(path.join(os.homedir(), '.claude', 'plugins'), MARKETPLACE);
}

/**
 * @param {string} featureId
 * @param {{pinReader?:()=>string, features?:Record<string,string[]>}} [opts]
 * @returns {boolean} true only when the current pin is listed for the feature
 */
function isFeatureEnabled(featureId, opts = {}) {
  try {
    const features = opts.features || GATED_FEATURES;
    if (typeof featureId !== 'string' || !Object.prototype.hasOwnProperty.call(features, featureId)) return false;
    const allowed = features[featureId];
    if (!Array.isArray(allowed)) return false;
    const pin = (opts.pinReader || defaultPinReader)();
    return typeof pin === 'string' && allowed.includes(pin);
  } catch {
    return false;
  }
}

/**
 * Is the skill usable/visible? Ungated skills: always true (no pin read).
 * @param {string} skill
 * @param {{gatedSkills?:Record<string,string>}} [opts] plus isFeatureEnabled opts
 */
function isSkillEnabled(skill, opts = {}) {
  const gated = opts.gatedSkills || GATED_SKILLS;
  if (typeof skill !== 'string' || !Object.prototype.hasOwnProperty.call(gated, skill)) return true;
  return isFeatureEnabled(gated[skill], opts);
}

/**
 * Copy of a `loadAllSkills`-shaped map without the gated skills that are
 * disabled. Never throws; returns the input untouched when nothing is gated.
 */
function filterSkills(skills, opts = {}) {
  if (!skills || typeof skills !== 'object') return skills;
  const gated = opts.gatedSkills || GATED_SKILLS;
  if (!Object.keys(skills).some(n => Object.prototype.hasOwnProperty.call(gated, n))) return skills;
  const out = {};
  for (const [name, meta] of Object.entries(skills)) {
    if (isSkillEnabled(name, opts)) out[name] = meta;
  }
  return out;
}

module.exports = { MARKETPLACE, GATED_FEATURES, GATED_SKILLS, isFeatureEnabled, isSkillEnabled, filterSkills };
