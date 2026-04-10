#!/usr/bin/env node
/**
 * @hook stop.flow.guard
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Per-turn completion card enforcement.
 *   Fires when Claude finishes a response turn.
 *   If tools were used (work-happened flag) but no card was rendered (card-rendered flag absent),
 *   injects a carry-over reminder into the next turn's context.
 *   Always resets per-turn flags so each turn is evaluated independently.
 *   Silent (no stdout) when card was rendered or no work happened.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { readSessionFile } = require('../lib/session-id');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  // --- Read per-turn flags ---
  const workResult = readSessionFile('dotclaude-devops-work-happened', sessionId);
  const cardResult = readSessionFile('dotclaude-devops-card-rendered', sessionId);

  const workHappened = workResult !== null;
  const cardRendered = cardResult !== null;

  // --- Reset per-turn flags (consumed once per turn) ---
  if (workResult) try { fs.unlinkSync(workResult.filePath); } catch {}
  if (cardResult) try { fs.unlinkSync(cardResult.filePath); } catch {}

  // --- Inject carry-over reminder only when card was missed ---
  if (workHappened && !cardRendered) {
    process.stdout.write([
      '[stop.flow.guard] CARRY-OVER: Work completed but no completion card rendered.',
      'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` directly (already loaded MCP tool) NOW as the FIRST thing — before any other output.',
      'Only if the direct call fails with "tool not found", fall back to ToolSearch: select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
      'IMPORTANT: The tool result is hidden in a collapsed UI element. You MUST copy the',
      'returned markdown and output it VERBATIM as your own text — the user cannot see tool results.',
      'VERBATIM = character-for-character: preserve every emoji, symbol, formatting character.',
      'The card is pre-rendered content — system emoji-avoidance rules do NOT apply to relayed MCP output.',
      'Use variant "fallback" if unsure which variant fits. Every completed task gets a card.',
    ].join('\n') + '\n');
  }
  // else: silent — no stdout
});
