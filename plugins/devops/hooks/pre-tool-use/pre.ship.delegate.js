#!/usr/bin/env node
/**
 * @hook pre.ship.delegate
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher Skill|Agent
 * @description Keeps the ship-delegation threshold where the model starts a
 *   ship itself. `prompt.ship.detect` only sees user prompts, so a do-ship
 *   reached through the Skill tool (concept finalize, `/do-run backlog`, an
 *   autonomous ship after a background agent) ran inline in contexts of up to
 *   951 k — half of the large-context ships measured on 2026-09-27/28.
 *   - Skill do-ship in the main session, context ≥ threshold, not
 *     `--delegated` / `--resume` / `--inline`, not promotion-only →
 *     refused with the `[ship-delegate]` instruction (lib/ship-delegate.js).
 *   - Agent spawn of a `--delegated` ship while the known main context is
 *     below the threshold → refused: there the subagent's fresh context and
 *     its cache write cost more than the inline ship (+28 % measured at 115 k).
 *   Silent inside a subagent, on an unknown context size and on any error.
 */

require('../lib/plugin-guard');

const path = require('path');

/** The installed plugin root, for the delegated mode's doc path. */
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

function main(hook) {
  if (hook.agent_id) return null;
  const tool = hook.tool_name;
  if (tool !== 'Skill' && tool !== 'Agent') return null;
  const D = require('../lib/ship-delegate');
  const { currentContextTokens, formatTokens } = require('../lib/context-size');
  const input = hook.tool_input || {};

  if (tool === 'Agent') {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!/devops:do-ship/.test(prompt)) return null;
    const tokens = currentContextTokens(hook.transcript_path);
    if (!D.delegatedSpawnTooSmall({ prompt, tokens })) return null;
    return { block: tooSmallText(tokens, D.threshold(), formatTokens) };
  }

  const skill = String(input.skill || input.name || '');
  if (!/(^|:)do-ship$/.test(skill)) return null;
  const args = String(input.args || '');
  const tokens = currentContextTokens(hook.transcript_path);
  // Cheap checks first; the git probe for "nothing unshipped" runs last.
  if (!D.shouldDelegateSkillCall({ skill, args, tokens })) return null;
  const promo = D.promotionOfArgs(args);
  if (promo.promote) {
    const { hasUnshippedWork } = require('../lib/ship-unshipped');
    if (promo.version || !hasUnshippedWork(hook.cwd || process.cwd())) return null;
  }
  return {
    block: [
      `[pre.ship.delegate] Refused: this do-ship would run inline in a ${formatTokens(tokens)}-token context.`,
      D.shipDelegateInstruction({ tokens, skillArgs: args, pluginRoot: PLUGIN_ROOT, sessionId: hook.session_id || '' }),
      `Only when the user explicitly asked for this ship to stay here: repeat the Skill call with "--inline" added to its args.`,
    ].join('\n'),
  };
}

function tooSmallText(tokens, limit, formatTokens) {
  return [
    `[pre.ship.delegate] Refused: the main context is ${formatTokens(tokens)} tokens, below the delegation threshold of ${formatTokens(limit)}.`,
    "Here a delegated ship costs more than the inline one: the subagent starts a fresh ~75 k context and writes it to the cache.",
    'Run Skill("devops:do-ship") in this session instead, with the same args minus --delegated. Do not spawn the ship agent.',
  ].join('\n');
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
