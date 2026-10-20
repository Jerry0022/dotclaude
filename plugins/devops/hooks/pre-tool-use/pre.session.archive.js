#!/usr/bin/env node
/**
 * @hook pre.session.archive
 * @version 0.2.0
 * @event PreToolUse
 * @plugin devops
 * @description Only the post-ship hand-over archives this session (#632).
 *   Denies mcp__ccd_session_mgmt__archive_session on the calling session
 *   ("self", no id, or this session's own id) unless post.flow.completion
 *   released the call after a merged ship card (lib/session-archive-gate.js),
 *   or the user's own latest prompt asks for an archive. A latest prompt that
 *   refuses it ("nicht archivieren", "don't archive", "behalten", "keep the
 *   session", "Session offen lassen") blocks even a released hand-over.
 *   Archiving another session by its explicit id is untouched. Exit 2 =
 *   block, reason on stderr.
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

/**
 * The user's latest prompt refuses the archive (de + en): "nicht archivieren",
 * "bitte nicht archiviert lassen", "don't archive", "do not archive",
 * "behalten", "keep the session", "Session offen lassen". It wins over both
 * the request above and the released hand-over — "archiv" alone matched
 * "bitte NICHT archivieren" (audit row 8).
 */
const USER_REFUSES_ARCHIVE = new RegExp([
  String.raw`\b(?:nicht|nie|kein(?:e|en)?)\s+(?:\w+\s+){0,2}archiv\w*`,
  String.raw`\b(?:don'?t|do\s+not|never|no)\s+(?:\w+\s+){0,2}archiv\w*`,
  String.raw`\bbehalte\w*`,
  String.raw`\bkeep\s+(?:the\s+|this\s+)?(?:session|chat|conversation)\b`,
  String.raw`\b(?:session|chat)\s+(?:\w+\s+){0,2}offen\s+(?:lassen|halten|bleiben)\b`,
  String.raw`\boffen\s+lassen\b`,
].join('|'), 'i');

/** 'ask' | 'refuse' | null — what the user's latest prompt says about archiving. */
function userArchiveIntent(hook) {
  try {
    const transcript = transcriptTools.safeReadTranscript(hook.transcript_path, transcriptTools.TRANSCRIPT_TAIL_BYTES);
    const text = promptTools.lastUserPromptText(transcript) || '';
    if (USER_REFUSES_ARCHIVE.test(text)) return 'refuse';
    return USER_ASKS_ARCHIVE.test(text) ? 'ask' : null;
  } catch {
    return null;
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
  const intent = userArchiveIntent(hook);
  if (intent === 'refuse') {
    process.stderr.write(
      '[devops] archive_session on this session is blocked: the user\'s latest prompt says not to ' +
      'archive it (keep the session open). Do not retry; end the response without text.\n'
    );
    process.exit(2);
  }
  if (gate.isReleased(hook.session_id) || intent === 'ask') process.exit(0);
  process.stderr.write(
    '[devops] archive_session on this session is not released: only a merged ship card ' +
    '(its hook hands the call over) or the user\'s own request archives it. Do not retry; ' +
    'end the response without text.\n'
  );
  process.exit(2);
});
