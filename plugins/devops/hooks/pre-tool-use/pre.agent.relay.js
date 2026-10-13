#!/usr/bin/env node
/**
 * @hook pre.agent.relay
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @matcher (all tools)
 * @description Holds back the first tool call after an agent launch whose
 *   card (pre.agent.announce) the user never saw, and hands Claude the card
 *   to show first (lib/agent-card-relay.js). Only 12 % of the cards reached
 *   the user when relaying was left to the instruction alone.
 *
 *   Once per launch — the retry passes even if the card is still missing.
 *   Never touches a parallel sibling of the spawn (same assistant message),
 *   a show_widget call (a relay route itself), a subagent's calls, or a call
 *   the transcript cannot place. Fail-open: any error lets the call through.
 *
 *   Stands aside on a model whose mid-turn text comes back as progress
 *   updates (lib/agent-card-relay.js `progressUpdates`): the card written
 *   before the next tool call reaches the user only as a rephrased summary,
 *   so holding the call back changes nothing. stop.agent.relay still asks
 *   for the card at the turn end, where the final text stays verbatim.
 */

require('../lib/plugin-guard');

const relay = require('../lib/agent-card-relay');

const PASS_TOOLS = /(^|__)(show_widget|read_me)$/;

function main(hook) {
  if (hook.agent_id) return null;
  if (PASS_TOOLS.test(String(hook.tool_name || ''))) return null;
  const text = relay.readTail(hook.transcript_path);
  if (!text.includes(relay.CARD_PREFIX)) return null;
  if (relay.progressUpdates(text)) return null;
  const msgId = relay.messageIdOf(text, hook.tool_use_id);
  if (!msgId) return null;
  const launch = relay.launchToNudge(text, hook.session_id, { skipMsgId: msgId });
  if (!launch) return null;
  relay.markNagged(hook.session_id, launch.covers);
  return { block: relay.nudgeText(launch) };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PreToolUse' });
  } catch {
    // fail open
  }
}

module.exports = { main };
