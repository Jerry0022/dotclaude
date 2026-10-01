#!/usr/bin/env node
/**
 * @hook stop.flow.browsertest
 * @version 0.6.0
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
 *       instead of once. A conscious skip yields early: the completion card
 *       records `verification: { skipped, reason }` in light-skipped (#612) —
 *       or, on a turn without a card, a `SKIP-VERIFICATION: <reason>` token in
 *       the response. Otherwise it blocks to the cap, then yields; the card
 *       stamps ⚠ UNVERIFIED from the same flags. Never wedges the session.
 *     - Green-not-just-ran (②) and order (③) are enforced by the writer
 *       (post.flow.completion): the verified flag is only set on a passing run
 *       and is cleared whenever a new qualifying edit lands.
 *     - A test run in the BACKGROUND verifies nothing at launch. Its outcome is
 *       settled here at the latest, from its task-notification (lib/light-bgrun),
 *       before the flags are read; while it is still running the gate does not
 *       block (BG_RUN_MAX_MS at most) and keeps every flag for the Stop that
 *       sees its result.
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
const { decideLightTest, hasSkipJustification, LIGHT_SKIPPED_FLAG } = require('../lib/browsertest-guard');
const { safeReadTranscript, lastAssistantText, PENDING_TAIL_BYTES } = require('../lib/card-guard');
const { BGRUN_FLAG, settleRecordedRuns } = require('../lib/light-bgrun');
const { scanOpenTasks } = require('../lib/pending-tasks');

/** Agent roles that only read, review or research — they never move the tree. */
const READ_ONLY_AGENT_RE = /(^|:)(research|scout|qa|redteam|po|gamer|rethinker|Explore|Plan|claude-code-guide|codex-rescue|scan-\w+|explore)$/i;

/** A background agent or workflow that may still change files is running. */
function implementersRunning(transcript) {
  if (!transcript) return false;
  return scanOpenTasks(transcript).some(t =>
    t.kind === 'workflow' || (t.kind === 'agent' && !READ_ONLY_AGENT_RE.test(String(t.name || ''))));
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  // Every flag here is read EXACT (issue #290). This gate blocks on them and
  // unlinks them on reset — a glob fallback would let it fire on a concurrent
  // session's state and then delete that session's still-owed pending flag.
  const EXACT = { exact: true };
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId, EXACT);

  // A background test run whose notification arrived after the last tool call
  // settles here — before the flags below are read, so its verdict counts at
  // this Stop. One still running keeps the gate from blocking instead.
  let inFlight = false;
  if (!silentResult) {
    try { inFlight = settleRecordedRuns(sessionId, hook.transcript_path).running > 0; } catch { /* unreadable: no in-flight exemption */ }
  }

  const pendingResult = readSessionFile('dotclaude-devops-light-pending', sessionId, EXACT);
  const verifiedResult = readSessionFile('dotclaude-devops-light-verified', sessionId, EXACT);
  const redResult = readSessionFile('dotclaude-devops-light-red', sessionId, EXACT);
  const kindResult = readSessionFile('dotclaude-devops-light-kind', sessionId, EXACT);
  const blockCountResult = readSessionFile('dotclaude-devops-light-blockcount', sessionId, EXACT);
  const bgRunResult = readSessionFile(BGRUN_FLAG, sessionId, EXACT);
  // A skip the completion card recorded (#612) — written at render time, so it
  // is already here when this Stop runs after the card.
  const cardSkipResult = readSessionFile(LIGHT_SKIPPED_FLAG, sessionId, EXACT);

  const blockCount = blockCountResult ? (parseInt(blockCountResult.content, 10) || 0) : 0;

  // Explicit skip — the card's recorded one, else the prose token. The token is
  // read only when needed (verification still owed) to avoid touching the
  // transcript on the common pass path.
  let skipJustified = false;
  if (pendingResult && !verifiedResult && !silentResult) {
    skipJustified = cardSkipResult !== null
      || hasSkipJustification(lastAssistantText(safeReadTranscript(hook.transcript_path)));
    // Background agents that may still change files: verifying now would
    // test a tree that is about to move, and the forced turn only produced
    // SKIP-VERIFICATION replies. Defer like an in-flight test run — every
    // flag stays, and the Stop after their results enforces the check.
    if (!inFlight) {
      try { inFlight = implementersRunning(safeReadTranscript(hook.transcript_path, PENDING_TAIL_BYTES)); }
      catch { /* unreadable: enforce as usual */ }
    }
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
    inFlight,
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
  // unverified), and carries a deliberate skip's reason from its own
  // `verification` field. decision.markSkipped therefore needs no persistence.

  if (decision.resetFlags) {
    // Only clear our own gate flags. The silent flag is owned by
    // stop.flow.guard — never delete it here, or the card gate would treat a
    // background tick as a real turn. light-skipped belongs to the cycle it
    // justified: the next owed check needs its own card-recorded skip.
    if (pendingResult) try { fs.unlinkSync(pendingResult.filePath); } catch {}
    if (verifiedResult) try { fs.unlinkSync(verifiedResult.filePath); } catch {}
    if (redResult) try { fs.unlinkSync(redResult.filePath); } catch {}
    if (kindResult) try { fs.unlinkSync(kindResult.filePath); } catch {}
    if (blockCountResult) try { fs.unlinkSync(blockCountResult.filePath); } catch {}
    if (bgRunResult) try { fs.unlinkSync(bgRunResult.filePath); } catch { /* already gone */ }
    if (cardSkipResult) try { fs.unlinkSync(cardSkipResult.filePath); } catch { /* already gone */ }
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
