/**
 * @module block-prompt
 * @version 0.1.0
 * @description Block a UserPromptSubmit prompt with one message as the only
 *   text in the harness's panel. Shared by prompt.batch.collect and
 *   prompt.flow.open-url (#958).
 *
 *   JSON `decision: "block"` instead of exit 2: on exit 2 the harness prefixes
 *   the message with `[<hook command>]:` — the full plugin path — and appends
 *   the plugin attribution and an `Original prompt:` block, which buried the
 *   one line that matters. With JSON the panel is its fixed header plus
 *   `reason`; `suppressOriginalPrompt` drops the prompt block.
 */

'use strict';

const fs = require('fs');

/** The verdict line blockPrompt writes. */
function blockVerdict(message) {
  return `${JSON.stringify({
    decision: 'block',
    reason: message,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true },
  })}\n`;
}

/**
 * Write the verdict and exit 0. Written synchronously: the verdict lives on
 * stdout, and a JSON line cut off by the exit would read as plain context and
 * let the prompt through.
 */
function blockPrompt(message) {
  fs.writeSync(1, blockVerdict(message));
  process.exit(0);
}

module.exports = { blockPrompt, blockVerdict };
