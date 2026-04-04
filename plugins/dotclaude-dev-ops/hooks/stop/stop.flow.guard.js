#!/usr/bin/env node
/**
 * @hook stop.flow.guard
 * @version 0.1.0
 * @event Stop
 * @plugin dotclaude-dev-ops
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
      'Resolve the tool via ToolSearch: select:mcp__plugin_dotclaude-dev-ops_dotclaude-completion__render_completion_card',
      'Then call `render_completion_card` MCP tool NOW as the FIRST thing — before any other output.',
      'IMPORTANT: The tool result is hidden in a collapsed UI element. You MUST copy the',
      'returned markdown and output it VERBATIM as your own text — the user cannot see tool results.',
      'Use variant "fallback" if unsure which variant fits. Every completed task gets a card.',
    ].join('\n') + '\n');
  }
  // else: silent — no stdout
});
