#!/usr/bin/env node
/**
 * @hook pre.ship.delegate
 * @version 0.3.0
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
 *   - Agent spawn that runs do-ship without `--delegated` / `--resume` →
 *     refused once with the delegated instruction; a retry carrying
 *     `--delegated` passes (stateless, #892). An accepted delegated spawn gets
 *     context asking the parent to set the Shipping title first.
 *   - `--card-data` in the args (an /auto-concept finalize ship passes it
 *     itself) → the instruction keeps it: the subagent returns card data and
 *     the caller renders after its close-out (#712). Never inferred from a
 *     state file: a paused, stale or close-out-only concept is no finalize.
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
    const tokens = currentContextTokens(hook.transcript_path);
    if (D.bareShipSpawn(prompt)) {
      return {
        block: [
          '[pre.ship.delegate] Refused: this subagent would run do-ship without the delegated protocol (no brief, no card contract, no Shipping title).',
          D.shipDelegateInstruction({
            tokens: tokens || 0, skillArgs: '', pluginRoot: PLUGIN_ROOT, sessionId: hook.session_id || '',
          }),
          'A retry must carry `--delegated` in the do-ship args; a bare repeat is refused again.',
        ].join('\n'),
      };
    }
    if (!D.mentionsShip(prompt)) return null;
    if (D.delegatedSpawnTooSmall({ prompt, tokens })) return { block: tooSmallText(tokens, D.threshold(), formatTokens) };
    if (/--delegated\b/.test(prompt) && !/--resume\b/.test(prompt)) return { context: titleText() };
    return null;
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
      D.shipDelegateInstruction({
        tokens, skillArgs: args, pluginRoot: PLUGIN_ROOT, sessionId: hook.session_id || '',
        cardData: D.wantsCardData({ args }),
      }),
      `Only when the user explicitly asked for this ship to stay here: repeat the Skill call with "--inline" added to its args.`,
    ].join('\n'),
  };
}

/** The parent session owns the title; the hook can only ask for it, before the spawn result. */
function titleText() {
  const { SHIPPING_PREFIX } = require('../lib/title-scheme');
  return [
    `[pre.ship.delegate] Delegated ship accepted. In THIS message, before the spawn result arrives, set the session title to`,
    `"${SHIPPING_PREFIX}" + the current title without its old devops prefix. The completion card sets the final prefix afterwards.`,
  ].join('\n');
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
