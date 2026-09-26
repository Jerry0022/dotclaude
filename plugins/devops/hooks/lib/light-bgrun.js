/**
 * @module light-bgrun
 * @version 0.1.0
 * @description Test runs the harness runs in the BACKGROUND — launched with
 *   run_in_background, or moved there when they outlived their timeout (#530).
 *   Their PostToolUse response is the launch report, not the run, so it never
 *   verifies (browsertest-guard testRunOutcome → 'unknown'). The run is
 *   recorded here instead (flag light-bgrun, `<taskId> <launchedAtMs>` per
 *   line) and settled once its <task-notification> is in the transcript: the
 *   exit code from the notification, the runner summary from the tail of its
 *   output file (backgroundRunOutcome). A pass writes light-verified and clears
 *   light-red, a red run writes light-red — what a foreground run writes.
 *
 *   post.flow.completion records the launch, drops the record on a qualifying
 *   edit (③ order: a run launched before the change tested the old code) and
 *   settles on every later call, so the card of the turn the result arrives in
 *   already sees it. stop.flow.browsertest settles before it decides, and does
 *   not block while a run is still in flight (BG_RUN_MAX_MS at most).
 */

const fs = require('fs');
const { sessionFile, readSessionFile, writeSessionFile } = require('./session-id');
const { taskEnds } = require('./pending-tasks');
const { safeReadTranscript, PENDING_TAIL_BYTES } = require('./card-guard');
const {
  parseBackgroundRuns,
  formatBackgroundRuns,
  settleBackgroundRuns,
} = require('./browsertest-guard');

const BGRUN_FLAG = 'dotclaude-devops-light-bgrun';
/** The runner's summary closes its output, so its tail is enough to read. */
const OUTPUT_TAIL_BYTES = 256 * 1024;
/** Runs kept on record — a session backgrounds a handful at most. */
const MAX_RECORDED = 8;
/** Read EXACT (issue #290): a neighbour session's run must never settle this one. */
const EXACT = { exact: true };

/**
 * Record a test run the harness backgrounded. A task is recorded once; past
 * MAX_RECORDED the oldest record gives way.
 * @param {string} sessionId
 * @param {string} taskId
 * @param {number} [now] — epoch ms
 */
function recordBackgroundRun(sessionId, taskId, now = Date.now()) {
  const flag = readSessionFile(BGRUN_FLAG, sessionId, EXACT);
  const runs = parseBackgroundRuns(flag && flag.content).filter(r => r.id !== taskId);
  runs.push({ id: taskId, at: now });
  writeSessionFile(sessionFile(BGRUN_FLAG, sessionId), formatBackgroundRuns(runs.slice(-MAX_RECORDED)));
}

/**
 * Settle the recorded runs whose notification is in the transcript by now,
 * write what they found, and keep the rest on record. Reads nothing when no
 * run is recorded — the common case on every tool call.
 * @param {string} sessionId
 * @param {string} transcriptPath
 * @param {number} [now] — epoch ms
 * @returns {{ running: number }} — recorded runs still in flight
 */
function settleRecordedRuns(sessionId, transcriptPath, now = Date.now()) {
  const flag = readSessionFile(BGRUN_FLAG, sessionId, EXACT);
  if (!flag) return { running: 0 };
  const runs = parseBackgroundRuns(flag.content);
  const ends = taskEnds(safeReadTranscript(transcriptPath, PENDING_TAIL_BYTES));
  const readOutput = file => safeReadTranscript(file, OUTPUT_TAIL_BYTES);
  const { outcomes, running } = settleBackgroundRuns(runs, ends, readOutput, now);

  if (outcomes.includes('pass')) {
    writeSessionFile(sessionFile('dotclaude-devops-light-verified', sessionId), 'background run');
    try { fs.unlinkSync(sessionFile('dotclaude-devops-light-red', sessionId)); } catch {}
  } else if (outcomes.includes('fail')) {
    writeSessionFile(sessionFile('dotclaude-devops-light-red', sessionId), 'background run');
  }

  if (running.length === 0) {
    try { fs.unlinkSync(flag.filePath); } catch {}
  } else if (running.length !== runs.length) {
    writeSessionFile(flag.filePath, formatBackgroundRuns(running));
  }
  return { running: running.length };
}

module.exports = {
  BGRUN_FLAG,
  OUTPUT_TAIL_BYTES,
  MAX_RECORDED,
  recordBackgroundRun,
  settleRecordedRuns,
};
