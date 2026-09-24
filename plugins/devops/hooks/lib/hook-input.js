/**
 * @module hook-input
 * @version 0.1.0
 * @description Tolerant parse of a hook's stdin payload. Claude Code sends a
 *   JSON object; anything else — empty input, `null`, a bare string/number,
 *   an array, invalid JSON, a UTF-8 BOM prefix — must make the hook exit 0
 *   silently instead of throwing (a thrown hook surfaces as a hook error in
 *   the user's session). CRLF line endings are valid JSON whitespace already.
 *
 * Usage:
 *   const { parseHookInput } = require('../lib/hook-input');
 *   const hook = parseHookInput(inputData);
 *   if (!hook) process.exit(0);
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

module.exports = { parseHookInput };
