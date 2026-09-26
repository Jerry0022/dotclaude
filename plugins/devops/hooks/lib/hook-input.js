/**
 * @module hook-input
 * @version 0.2.0
 * @description Tolerant parse of a hook's stdin payload. Claude Code sends a
 *   JSON object; anything else — empty input, `null`, a bare string/number,
 *   an array, invalid JSON, a UTF-8 BOM prefix — must make the hook exit 0
 *   silently instead of throwing (a thrown hook surfaces as a hook error in
 *   the user's session). CRLF line endings are valid JSON whitespace already.
 *
 *   runHook() is the one stdin runner built on it (harden scan 2026-09-26):
 *   pre.run.contract, post.run.contract, post.agent.nudge and
 *   post.flow.completion each read stdin their own way — process.exit vs
 *   process.exitCode, raw JSON.parse vs parseHookInput.
 *
 * Usage:
 *   const { parseHookInput } = require('../lib/hook-input');
 *   const hook = parseHookInput(inputData);
 *   if (!hook) process.exit(0);
 *
 *   // a whole hook file: main(hook) returns its reply (see runHook); the
 *   // try keeps a lib that fails to load from surfacing as a hook failure
 *   if (require.main === module) {
 *     try { require('../lib/hook-input').runHook(main, { event: 'PostToolUse' }); } catch {}
 *   }
 */

/**
 * @param {string} raw stdin text
 * @returns {object|null} the payload object, or null when unusable
 */
function parseHookInput(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * The additionalContext envelope — for a PostToolUse hook the only stdout
 * that reaches the model (CONVENTIONS.md § Output Channels).
 * @param {string} event the hookEventName (`PreToolUse`, `PostToolUse`, …)
 * @param {string} text
 * @returns {string} serialized JSON
 */
function contextOutput(event, text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
}

/**
 * Writes a main() reply and returns the exit code it stands for.
 * @returns {0|2}
 */
function deliver(reply, event) {
  if (reply && typeof reply === 'object') {
    if (typeof reply.block === 'string') {
      process.stderr.write(`${reply.block}\n`);
      return 2;
    }
    if (typeof reply.context === 'string' && reply.context) {
      process.stdout.write(`${contextOutput(event, reply.context)}\n`);
    }
    return 0;
  }
  if (typeof reply === 'string' && reply) process.stdout.write(reply);
  return 0;
}

/**
 * Run a hook file's main() against its stdin payload.
 *
 * Reads stdin to its end and parses it with parseHookInput() — an unusable
 * payload ends the hook with no output and exit 0, before main() runs.
 * main(hook)'s return value is the hook's whole reply:
 *   { block: text }    → text on stderr, exit 2 (the tool call is refused)
 *   { context: text }  → contextOutput(event, text) on stdout, exit 0 (an
 *                        empty text writes nothing)
 *   a non-empty string → written to stdout as is (an already-serialized
 *                        reply, e.g. `{"continue":false,…}`), exit 0
 *   anything else      → no output, exit 0
 * A throw inside main() never surfaces as a hook failure: no output, exit 0
 * (a write that throws fails open the same way).
 * The code goes to process.exitCode, never process.exit(), so the process
 * ends only after what was written has drained.
 *
 * @param {(hook: object) => ({block: string}|{context: string}|string|null|undefined)} main
 * @param {{event: string}} opts `event` names the envelope a `{context}` reply goes out in
 */
function runHook(main, { event } = {}) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let reply = null;
    try {
      const hook = parseHookInput(raw);
      if (hook) reply = main(hook);
    } catch {
      reply = null; // an internal error never surfaces as a hook failure
    }
    try {
      process.exitCode = deliver(reply, event);
    } catch {
      process.exitCode = 0; // a failed write fails open, like a throw in main()
    }
  });
}

module.exports = { parseHookInput, contextOutput, runHook };
