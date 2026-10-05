#!/usr/bin/env node
/**
 * @hook pre.session.archive
 * @version 0.1.0
 * @event PreToolUse
 * @plugin devops
 * @description Only the post-ship hand-over archives this session (#632).
 *   Denies mcp__ccd_session_mgmt__archive_session on the calling session
 *   ("self", no id, or this session's own id) unless post.flow.completion
 *   released the call after a merged ship card (lib/session-archive-gate.js),
 *   or the user's own latest prompt asks for an archive. Archiving another
 *   session by its explicit id is untouched. Exit 2 = block, reason on stderr.
 */

let gate, transcriptTools, promptTools;
try {
  require('../lib/plugin-guard');
  gate = require('../lib/session-archive-gate');
  transcriptTools = require('../lib/card-guard');
  promptTools = require('../lib/skill-invocations');
} catch {
  process.exit(0);
}

/** The user's latest prompt asks to archive (de + en) — whole words only. */
const USER_ASKS_ARCHIVE = /\barchiv(?:e|iere|ieren|ing)?\b/i;

function userAskedForArchive(hook) {
  try {
    const transcript = transcriptTools.safeReadTranscript(hook.transcript_path, transcriptTools.TRANSCRIPT_TAIL_BYTES);
    return USER_ASKS_ARCHIVE.test(promptTools.lastUserPromptText(transcript) || '');
  } catch {
    return false;
  }
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); } catch { process.exit(0); }
  if (!hook || !gate.ARCHIVE_TOOL_RE.test(hook.tool_name || '')) process.exit(0);
  if (!gate.targetsSelf(hook.tool_input, hook.session_id)) process.exit(0);
  if (gate.isReleased(hook.session_id) || userAskedForArchive(hook)) process.exit(0);
  process.stderr.write(
    '[devops] archive_session on this session is not released: only a merged ship card ' +
    '(its hook hands the call over) or the user\'s own request archives it. Do not retry; ' +
    'end the response without text.\n'
  );
  process.exit(2);
});
