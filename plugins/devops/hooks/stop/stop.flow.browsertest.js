#!/usr/bin/env node
/**
 * @hook stop.flow.browsertest
 * @version 0.1.0
 * @event Stop
 * @plugin devops
 * @description Browser-test enforcement gate. Blocks the turn when a
 *   browser-renderable file changed this session but no browser tool ran
 *   (Claude-in-Chrome in Edge / Playwright / Preview) and no verification
 *   subagent was delegated. Flags are written by post.flow.completion;
 *   devops-concept pages (docs/concepts/*.html) are excluded there. Decision
 *   logic lives in lib/browsertest-guard.js (pure, unit-tested).
 *
 *   Runs BEFORE stop.flow.guard so the "verify in the browser" instruction is
 *   delivered before the completion-card gate. Yields after one block
 *   (stop_hook_active) so it can never loop.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { readSessionFile } = require('../lib/session-id');
const { decideBrowserTest } = require('../lib/browsertest-guard');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  const pendingResult = readSessionFile('dotclaude-devops-web-change-pending', sessionId);
  const verifiedResult = readSessionFile('dotclaude-devops-browser-verified', sessionId);
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId);

  const decision = decideBrowserTest({
    webChangePending: pendingResult !== null,
    browserVerified: verifiedResult !== null,
    stopHookActive: hook.stop_hook_active === true,
    silent: silentResult !== null,
  });

  if (decision.resetFlags) {
    // Only clear our own gate flags. The silent flag is owned by
    // stop.flow.guard — never delete it here, or the card gate would treat a
    // background tick as a real turn.
    if (pendingResult) try { fs.unlinkSync(pendingResult.filePath); } catch {}
    if (verifiedResult) try { fs.unlinkSync(verifiedResult.filePath); } catch {}
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
