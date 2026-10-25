#!/usr/bin/env node
/**
 * @hook perm.approval.flag
 * @version 0.1.0
 * @event PermissionRequest
 * @plugin devops
 * @description A background agent stopped at a tool permission dialog: puts
 *   the 👉 in the title's status slot (`⏳ ➜ 🤖 Team ┃ X` → `👉 ➜ 🤖 Team ┃ X`,
 *   activity kept) by waking the main thread — registered with `asyncRewake`,
 *   so exit 2 + stderr wakes Claude even while the session idles, and the
 *   dialog never waits for this hook. Records the waiting call
 *   (lib/approval-wait.js); perm.approval.watch restores the ⏳ once it is
 *   answered. Main-thread prompts, a title with no Solo/Team/Testing ⏳ head
 *   (ship, concept, batch, outcome) and an unknown title (no Desktop app) stay
 *   silent. Never decides the permission. Fail-open.
 */

require('../lib/plugin-guard');

const W = require('../lib/approval-wait');

function main(hook) {
  if (!W.record(hook)) return null;
  const transcript = W.mainTranscript(hook);
  const { readCurrentTitle } = require('../lib/session-title');
  const next = require('../lib/title-scheme').approvalTitle(readCurrentTitle(transcript));
  if (!next) return null;
  const tail = require('../lib/agent-card-relay').readTail(transcript);
  if (W.isMainIdle(tail)) W.markWake(hook.session_id);
  return { block: W.waitText(next) };
}

if (require.main === module) {
  try {
    require('../lib/hook-input').runHook(main, { event: 'PermissionRequest' });
  } catch {
    // fail open
  }
}

module.exports = { main };
