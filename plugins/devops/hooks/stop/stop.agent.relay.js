#!/usr/bin/env node
/**
 * @hook stop.agent.relay
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Blocks the turn end once when an agent launch of this turn
 *   never showed its card (lib/agent-card-relay.js) — the case
 *   pre.agent.relay cannot catch because no tool call followed the launch.
 *
 *   Never blocks: on stop_hook_active (loop guard), inside a subagent, after
 *   the completion card was delivered this turn (a block would put the agent
 *   card under it — the card render is a tool call, so pre.agent.relay has
 *   already had its chance), or for a launch that was nudged once already.
 */

require('../lib/plugin-guard');

const relay = require('../lib/agent-card-relay');
const { cardDelivered, showWidgetCalledThisTurn } = require('../lib/card-guard');

function main(hook) {
  if (hook.stop_hook_active || hook.agent_id) return null;
  const text = relay.readTail(hook.transcript_path);
  if (!text.includes(relay.CARD_PREFIX)) return null;
  if (cardDelivered(text) || showWidgetCalledThisTurn(text)) return null;
  const launch = relay.launchToNudge(text, hook.session_id);
  if (!launch) return null;
  relay.markNagged(hook.session_id, launch.covers);
  return { block: relay.nudgeText(launch, { atStop: true }) };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'Stop' });
  } catch {
    // fail open
  }
}

module.exports = { main };
