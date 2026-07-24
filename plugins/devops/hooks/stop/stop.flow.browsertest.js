#!/usr/bin/env node
/**
 * @hook stop.flow.browsertest
 * @version 0.3.0
 * @event Stop
 * @plugin devops
 * @description Light-verification enforcement gate (the "V" of the V&V gate).
 *   Blocks the turn when a CODE file changed this session but the matching Light
 *   check never ran — or ran RED:
 *   DOM-surface profiles need a browser tool (Claude-in-Chrome in Edge /
 *   Playwright / Preview); runner profiles need a test run that PASSES (npm test
 *   / pytest / …). Per test-autonomy.md the Light check is mandatory; Full
 *   (computer-use / packaged app) stays opt-in and is NOT enforced here. A
 *   subagent delegation does NOT satisfy the gate — verification must be
 *   observable in the main thread.
 *
 *   Hardening:
 *     - Escalation: blocks up to BLOCK_CAP times (tracked via light-blockcount)
 *       instead of once. An explicit `SKIP-VERIFICATION: <reason>` token in the
 *       response yields early; otherwise it blocks to the cap, then yields and
 *       records a visible skip (light-skipped) so the completion card can stamp
 *       ⚠ UNVERIFIED. Never wedges the session.
 *     - Green-not-just-ran (②) and order (③) are enforced by the writer
 *       (post.flow.completion): the verified flag is only set on a passing run
 *       and is cleared whenever a new qualifying edit lands.
 *
 *   Flags are written by post.flow.completion; docs/markdown/config and
 *   concept pages are excluded there. Decision logic lives in
 *   lib/browsertest-guard.js (pure, unit-tested).
 *
 *   Runs BEFORE stop.flow.guard so the "verify first" instruction is delivered
 *   before the completion-card gate.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { decideLightTest, hasSkipJustification } = require('../lib/browsertest-guard');
const { safeReadTranscript, lastAssistantText } = require('../lib/card-guard');

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
  const redResult = readSessionFile('dotclaude-devops-light-red', sessionId);
  const kindResult = readSessionFile('dotclaude-devops-light-kind', sessionId);
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId);
  const blockCountResult = readSessionFile('dotclaude-devops-light-blockcount', sessionId);

  const blockCount = blockCountResult ? (parseInt(blockCountResult.content, 10) || 0) : 0;

  // Explicit skip token — read only when needed (verification still owed) to
  // avoid touching the transcript on the common pass path.
  let skipJustified = false;
  if (pendingResult && !verifiedResult && !silentResult) {
    const transcript = safeReadTranscript(hook.transcript_path);
    skipJustified = hasSkipJustification(lastAssistantText(transcript));
  }

  const decision = decideLightTest({
    pending: pendingResult !== null,
    verified: verifiedResult !== null,
    red: redResult !== null,
    stopHookActive: hook.stop_hook_active === true,
    silent: silentResult !== null,
    kind: (kindResult && kindResult.content) || 'any',
    blockCount,
    skipJustified,
  });

  if (decision.incrementBlock) {
    try {
      writeSessionFile(
        sessionFile('dotclaude-devops-light-blockcount', sessionId),
        String(blockCount + 1),
      );
    } catch { /* ignore */ }
  }

  // Note on the visible-skip stamp (⚠ UNVERIFIED): it is NOT driven from here.
  // A skip is only yielded at THIS Stop, but the completion card was already
  // rendered just before it — so a flag written now would arrive too late. The
  // card instead derives the stamp itself at render time from the same
  // light-pending / light-verified flags (pending && !verified ⇒ finishing
  // unverified). decision.markSkipped therefore needs no persistence here.

  if (decision.resetFlags) {
    // Only clear our own gate flags. The silent flag is owned by
    // stop.flow.guard — never delete it here, or the card gate would treat a
    // background tick as a real turn. light-skipped is also owned by
    // stop.flow.guard (it must outlive this reset to reach the card).
    if (pendingResult) try { fs.unlinkSync(pendingResult.filePath); } catch {}
    if (verifiedResult) try { fs.unlinkSync(verifiedResult.filePath); } catch {}
    if (redResult) try { fs.unlinkSync(redResult.filePath); } catch {}
    if (kindResult) try { fs.unlinkSync(kindResult.filePath); } catch {}
    if (blockCountResult) try { fs.unlinkSync(blockCountResult.filePath); } catch {}
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
