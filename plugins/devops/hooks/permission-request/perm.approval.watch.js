#!/usr/bin/env node
/**
 * @hook perm.approval.watch
 * @version 0.1.0
 * @event PermissionRequest
 * @plugin devops
 * @description The second half of perm.approval.flag: stays in the
 *   background (`asyncRewake`) until the waiting call is answered — its entry
 *   in lib/approval-wait.js is dropped by post.approval.clear /
 *   substop.approval.clear — and then, once no other dialog of the session
 *   waits, wakes the main thread with the ⏳ head back
 *   (`👉 ➜ 🤖 Team ┃ X` → `⏳ ➜ 🤖 Team ┃ X`). Silent when the title no longer
 *   carries the approval head (a card or a rename won meanwhile), for a
 *   main-thread prompt, and past its deadline (the hook timeout kills it
 *   anyway). Fail-open.
 */

require('../lib/plugin-guard');

const W = require('../lib/approval-wait');

const POLL_MS = 1000;
/**
 * A safety net only: the entry expires after MAX_AGE_MS (55 min) and then
 * counts as answered, so the watch restores ⏳ before this. Below the
 * manifest timeout (3600 s), so the hook ends on its own.
 */
const DEADLINE_MS = W.MAX_AGE_MS + 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} hook PermissionRequest payload
 * @param {{ pollMs?: number, deadlineMs?: number }} [opts] test seam
 * @returns {Promise<{block: string}|null>}
 */
async function main(hook, { pollMs = POLL_MS, deadlineMs = DEADLINE_MS } = {}) {
  const entry = W.record(hook);
  if (!entry) return null;
  const end = Date.now() + deadlineMs;
  while (W.isWaiting(hook.session_id, entry)) {
    if (Date.now() >= end) return null;
    await sleep(pollMs);
  }
  if (W.readEntries(hook.session_id).length) return null;
  const transcript = W.mainTranscript(hook);
  const { readCurrentTitle } = require('../lib/session-title');
  const next = require('../lib/title-scheme').approvalRestoredTitle(readCurrentTitle(transcript));
  if (!next) return null;
  const tail = require('../lib/agent-card-relay').readTail(transcript);
  if (W.isMainIdle(tail)) W.markWake(hook.session_id);
  return { block: W.restoreText(next) };
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', async () => {
    let reply = null;
    try {
      const hook = require('../lib/hook-input').parseHookInput(raw);
      if (hook) reply = await main(hook);
    } catch {
      reply = null; // fail open
    }
    if (reply && reply.block) {
      process.stderr.write(`${reply.block}\n`);
      process.exitCode = 2;
    }
  });
}

module.exports = { main };
