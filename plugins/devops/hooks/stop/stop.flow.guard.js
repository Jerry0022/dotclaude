#!/usr/bin/env node
/**
 * @hook stop.flow.guard
 * @version 0.7.0
 * @event Stop
 * @plugin devops
 * @description Per-turn completion card + validation enforcement (the validation
 *   half of the V&V gate). Fires when Claude finishes a response turn.
 *   Logic lives in lib/card-guard.js (pure functions, unit-tested).
 *
 *   Block (JSON `{decision:"block"}` on stdout) when, and this is not already a
 *   blocked stop cycle (stop_hook_active=false):
 *     1. no card rendered AND (tool calls happened OR substantial prose), OR
 *        a card was rendered but never relayed — the ✨ marker is missing from
 *        the last assistant text (#449), OR
 *        a Desktop card owed its widget call and show_widget never ran (#451), OR
 *     2. a notification turn (see below) re-rendered a card identical to the
 *        previous one (design § 5.5), OR
 *     3. a card exists but its title carries a status word, its `›` result
 *        lines exceed three or name a file/hook, or its points exceed three
 *        without "+N weitere" in the heading (design § 5.1-5.3), OR
 *     4. a card exists but a code change owes validation
 *        (validation-pending set, validation-attested not), OR
 *     5. a card exists but background subagents / tasks are still running and
 *        the card did not declare them (`pending` field, pending-attested not).
 *        Open work is read from the transcript, not from a flag — completions
 *        arrive as task-notifications, which no tool hook ever sees.
 *
 *   Pass (silent exit 0) otherwise — flags are reset so the next turn is
 *   evaluated independently. A passing turn whose card exceeds the rendered-
 *   line budget (14 Desktop / 24 terminal, design § 2.4 / § 5.4) still passes;
 *   the overflow is only reported (stderr), never enforced here.
 *
 *   Scheduled-task exemption (#371): when the turn's prompt was a
 *   `<scheduled-task …>` wrapper (flag from prompt.flow.silent-turn), the tree
 *   is clean and ship_release merged nothing this turn (flag from
 *   post.flow.completion), the routine's one-line status suffices — no card.
 *
 *   Notification-turn exemption (design § 5.5): when the turn's last user-role
 *   transcript entry is a `<task-notification>` (a background subagent / task
 *   stopping, no user prompt), and the tree is clean and nothing shipped, no
 *   card is owed at all. When a card DOES render on such a turn, its signature
 *   (heading + build-id + evidence row) is compared to the previous
 *   notification card's — an identical repeat is blocked once.
 *
 *   Offline-first (#371): when the completion MCP's heartbeat is dead, the
 *   block reason lists the offline renderer FIRST instead of third.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const { readSessionFile, sessionFile, writeSessionFile } = require('../lib/session-id');
const {
  decideAction,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  lastAssistantCardText,
  lastAssistantText,
  lastUserEntryIsNotification,
  safeReadTranscript,
  showWidgetCalledThisTurn,
  PENDING_TAIL_BYTES,
} = require('../lib/card-guard');
const { scanOpenTasks, openTaskNames } = require('../lib/pending-tasks');
const { isMcpServerAlive } = require('../lib/mcp-heartbeat');
const { releaseOnce } = require('../lib/run-once');
const { execFileSync } = require('child_process');

/**
 * Did this turn change any file? `git status --porcelain` is the truth when
 * the project is a repo (it also sees Bash-driven writes, which the Edit/Write
 * counter misses); outside a repo — or when git itself fails — fall back to the
 * session's Edit/Write counter being zero. Returns null when neither signal is
 * available, which the guard treats as "not clean" (card required).
 */
function isTreeClean(cwd, sessionId) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: cwd || process.cwd(), encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length === 0;
  } catch {}
  const edits = readSessionFile('dotclaude-devops-edits', sessionId, { exact: true });
  if (edits === null) return true;
  const n = parseInt(String(edits.content || '').trim(), 10);
  return Number.isFinite(n) ? n === 0 : null;
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  const sessionId = hook.session_id;

  // Enforcement flags — exact match only, never the glob fallback (issue #290):
  // this gate blocks the stop on them, so a neighbouring session's file must not
  // be able to answer for this one in either direction.
  const EXACT = { exact: true };
  const workResult = readSessionFile('dotclaude-devops-work-happened', sessionId, EXACT);
  const cardResult = readSessionFile('dotclaude-devops-card-rendered', sessionId, EXACT);
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', sessionId, EXACT);
  const valPendingResult = readSessionFile('dotclaude-devops-validation-pending', sessionId, EXACT);
  const valAttestedResult = readSessionFile('dotclaude-devops-validation-attested', sessionId, EXACT);
  const pendAttestedResult = readSessionFile('dotclaude-devops-pending-attested', sessionId, EXACT);
  const scheduledResult = readSessionFile('dotclaude-devops-scheduled-task', sessionId, EXACT);
  const shippedResult = readSessionFile('dotclaude-devops-shipped', sessionId, EXACT);
  // Written by the completion MCP next to a Desktop card render (#451): the
  // widget HTML, so its presence means "show_widget is owed this turn".
  const widgetResult = readSessionFile('dotclaude-devops-card-widget', sessionId, EXACT);
  // Signature of the last notification-turn card (design § 5.5) — persists
  // ACROSS turns (not cleared by resetFlags) so the next notification turn
  // can be compared against it.
  const notifSigResult = readSessionFile('dotclaude-devops-notification-card-sig', sessionId, EXACT);

  const workHappened = workResult !== null;
  const flagCardRendered = cardResult !== null;
  const silent = silentResult !== null;
  const validationPending = valPendingResult !== null;
  const validationAttested = valAttestedResult !== null;
  const pendingAttested = pendAttestedResult !== null;
  const stopHookActive = hook.stop_hook_active === true;
  const scheduledTask = scheduledResult !== null;
  const shipped = shippedResult !== null;
  const prevCardSignature = notifSigResult ? String(notifSigResult.content || '').trim() || null : null;

  // Scan the transcript unless this is a silent tick. It answers several questions:
  //  - did the last assistant message already carry a card / substantial prose
  //    (backup for a failed flag write, plus the chat-only heuristic),
  //  - is background work still running (Gate 5), which no flag can tell us —
  //    completions arrive as task-notifications, not as tool calls, and
  //  - did THIS turn start from a task-notification rather than a user prompt
  //    (design § 5.5) — the last user-role transcript entry names it.
  // The wider PENDING slice is used so an agent launched early in a long turn
  // is still seen; scanOpenTasks short-circuits when no launch marker is there.
  const transcript = silent ? '' : safeReadTranscript(hook.transcript_path, PENDING_TAIL_BYTES);
  const substantial = isSubstantialAnswer(transcript);
  const openTasks = silent ? [] : openTaskNames(scanOpenTasks(transcript));
  const notificationTurn = !silent && lastUserEntryIsNotification(transcript);
  // The marker in the last assistant text proves the card was RELAYED, not
  // just rendered (#449). It also backs up a failed flag write: marker alone
  // still counts as rendered. An unreadable transcript leaves it undefined so
  // the relay gate stays out of the way instead of blocking blind.
  const cardRelayed = (silent || !transcript) ? undefined : lastAssistantContainsCard(transcript);
  const cardRendered = flagCardRendered || cardRelayed === true;
  const cardText = (!silent && cardRendered) ? lastAssistantCardText(transcript) : '';
  const widgetFile = widgetResult ? String(widgetResult.filePath).replace(/\\/g, '/') : '';
  const widgetCalled = (widgetFile && transcript) ? showWidgetCalledThisTurn(transcript) : undefined;
  // Both probes are only needed on the paths that read them: the tree check
  // shells out to git, the heartbeat stats a PID file — skip both on silent ticks.
  const treeClean = (!silent && (scheduledTask || notificationTurn)) ? isTreeClean(hook.cwd, sessionId) : null;
  const completionMcpDown = silent ? false : !isMcpServerAlive('dotclaude-completion');

  // The sidebar prefix belongs to the turn that just ended (📦 Ready, 🧪 Test,
  // 🚀 Shipped, …). The next real prompt starts new work, so hand the wrench
  // token back to prompt.flow.title-work (its ONCE_KEY) on EVERY non-silent
  // turn end — card or no card. Releasing only after a card (until 0.183.9)
  // let one card-less answer after a ship pin `🚀 Shipped – ` on the title for
  // the rest of the session: every later prompt found the token taken, never
  // marked ⏳, and the next card's outcome was the only thing that could move
  // it. Observed 2026-09-21 — "Shipped" while the session was mid-implementation.
  if (!silent) releaseOnce('prompt-title-work', sessionId);

  const decision = decideAction({
    workHappened,
    cardRendered,
    stopHookActive,
    substantial,
    silent,
    validationPending,
    validationAttested,
    openTaskNames: openTasks,
    pendingAttested,
    // Active install root — the block reason names the offline renderer under it
    // for the case where the MCP server never connected this session.
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..'),
    scheduledTask,
    treeClean,
    shipped,
    completionMcpDown,
    notificationTurn,
    cardText,
    prevCardSignature,
    cardRelayed,
    widgetFile,
    widgetCalled,
  });

  if (decision.resetFlags) {
    if (workResult) try { fs.unlinkSync(workResult.filePath); } catch {}
    if (cardResult) try { fs.unlinkSync(cardResult.filePath); } catch {}
    if (silentResult) try { fs.unlinkSync(silentResult.filePath); } catch {}
    // Validation flags are owned by this gate — clear them at a clean turn end.
    if (valPendingResult) try { fs.unlinkSync(valPendingResult.filePath); } catch {}
    if (valAttestedResult) try { fs.unlinkSync(valAttestedResult.filePath); } catch {}
    // Same for the pending attestation: it attests THIS turn's card, so the next
    // turn must re-declare any work that is still running.
    if (pendAttestedResult) try { fs.unlinkSync(pendAttestedResult.filePath); } catch {}
    // Per-turn signals for the scheduled-task exemption — the next tick must
    // prove "no ship, scheduler prompt" again on its own.
    if (scheduledResult) try { fs.unlinkSync(scheduledResult.filePath); } catch {}
    if (shippedResult) try { fs.unlinkSync(shippedResult.filePath); } catch {}
    // The widget file is per-turn too; a block keeps it so the retry can Read it.
    if (widgetResult) try { fs.unlinkSync(widgetResult.filePath); } catch {}
  }

  // Persist the notification-card signature ACROSS turns (independent of
  // resetFlags) so the next notification turn can detect a duplicate. Only
  // touched when this turn actually computed one.
  if (decision.newCardSignature !== undefined) {
    try {
      const sigFile = sessionFile('dotclaude-devops-notification-card-sig', sessionId);
      if (decision.newCardSignature) writeSessionFile(sigFile, decision.newCardSignature);
      else if (notifSigResult) fs.unlinkSync(notifSigResult.filePath);
    } catch {}
  }

  // Line-budget overflow (design § 2.4 / § 5.4) is reported, never enforced —
  // surface it on stderr so it is visible without blocking the turn.
  if (decision.warning) {
    try { process.stderr.write(decision.warning + '\n'); } catch {}
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
