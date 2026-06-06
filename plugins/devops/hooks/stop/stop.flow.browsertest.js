#!/usr/bin/env node
/**
 * @hook stop.flow.browsertest
 * @version 0.2.0
 * @event Stop
 * @plugin devops
 * @description Light-verification enforcement gate. Blocks the turn when a CODE
 *   file changed this session but the matching Light check never ran:
 *   DOM-surface profiles need a browser tool (Claude-in-Chrome in Edge /
 *   Playwright / Preview); runner profiles need a test run (npm test / pytest /
 *   …). Per test-autonomy.md the Light check is mandatory; Full (computer-use /
 *   packaged app) stays opt-in and is NOT enforced here. A subagent delegation
 *   does NOT satisfy the gate — verification must be observable in the main
 *   thread. Flags are written by post.flow.completion; docs/markdown/config and
 *   devops-concept pages are excluded there. Decision logic lives in
 *   lib/browsertest-guard.js (pure, unit-tested).
 *
 *   Runs BEFORE stop.flow.guard so the "verify first" instruction is delivered
 *   before the completion-card gate. Yields after one block (stop_hook_active)
 *   so it can never loop.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { readSessionFile } = require('../lib/session-id');
const { decideLightTest } = require('../lib/browsertest-guard');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  const pendingResult = readSessionFile('dotclaude-devops-light-pending', sessionId);
  const verifiedResult = readSessionFile('dotclaude-devops-light-verified', sessionId);
  const kindResult = readSessionFile('dotclaude-devops-light-kind', sessionId);
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId);

  const decision = decideLightTest({
    pending: pendingResult !== null,
    verified: verifiedResult !== null,
    stopHookActive: hook.stop_hook_active === true,
    silent: silentResult !== null,
    kind: (kindResult && kindResult.content) || 'any',
  });

  if (decision.resetFlags) {
    // Only clear our own gate flags. The silent flag is owned by
    // stop.flow.guard — never delete it here, or the card gate would treat a
    // background tick as a real turn.
    if (pendingResult) try { fs.unlinkSync(pendingResult.filePath); } catch {}
    if (verifiedResult) try { fs.unlinkSync(verifiedResult.filePath); } catch {}
    if (kindResult) try { fs.unlinkSync(kindResult.filePath); } catch {}
  }

  if (decision.action === 'block') {
    // Claude Code interprets JSON stdout for Stop hooks:
    //   { decision: "block", reason: "..." } → blocks stop, feeds reason to Claude
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: decision.reason,
    }));
  }
  // else: pass silently

  process.exit(0);
});
