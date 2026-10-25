#!/usr/bin/env node
/**
 * @hook pre.agent.relay
 * @version 0.2.0
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

const PASS_TOOLS = /(^|__)(show_widget|read_me)$/;
const CARD_PREFIX = 'Agent card';
const TAIL_BYTES = 512 * 1024;
// The in-flight message's text may not be in the transcript yet when
// PreToolUse fires: re-read once before holding the call back.
const RECHECK_MS = 250;

/** Fast path: does the transcript tail mention an announced card at all? */
function tailHasCard(transcriptPath) {
  if (!transcriptPath) return false;
  const fs = require('fs');
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, size - start, start);
    return buf.includes(CARD_PREFIX);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function pause(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ }
}

function evaluate(relay, hook) {
  const text = relay.readTail(hook.transcript_path);
  if (!text.includes(relay.CARD_PREFIX)) return null;
  if (relay.progressUpdates(text)) return null;
  const msgId = relay.messageIdOf(text, hook.tool_use_id);
  if (!msgId) return null;
  return relay.launchToNudge(text, hook.session_id, { skipMsgId: msgId });
}

function main(hook, deps = {}) {
  if (hook.agent_id) return null;
  if (PASS_TOOLS.test(String(hook.tool_name || ''))) return null;
  if (!tailHasCard(hook.transcript_path)) return null; // no heavy require
  const relay = require('../lib/agent-card-relay');
  let launch = evaluate(relay, hook);
  if (!launch) return null;
  (deps.pause || pause)(RECHECK_MS);
  launch = evaluate(relay, hook);
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
