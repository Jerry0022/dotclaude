/**
 * @module ship-guard-match
 * @version 0.1.0
 * @description Pure matcher for pre.ship.guard — decides whether a Bash command
 *   is a REAL manual PR create/merge invocation that must go through /devops-ship.
 *
 *   Split out of pre.ship.guard.js so the logic is unit-testable, and to fix the
 *   #198 bonus defect: the old guard tested its patterns against the entire
 *   command string, so it false-positived when "gh pr create" merely appeared
 *   inside quoted text (an issue body, a commit message, a here-string) rather
 *   than as an actual invocation.
 *
 *   Two-stage match:
 *     1. stripQuoted() removes quoted spans (single/double quotes, PowerShell
 *        here-strings, bash heredoc bodies) so embedded prose can't trip it.
 *     2. The patterns are anchored to a command position (start of command or
 *        right after a shell separator) so only real command tokens match, not
 *        arbitrary substrings.
 *
 *   This is a nudge, not a security boundary — over-stripping quotes is fine; the
 *   goal is zero false positives on documentation/quoted text while still
 *   catching the direct `gh pr create …` invocations Claude actually issues.
 */

// A command position: start of string, or immediately after a shell separator
// (newline, ; & | ( ) { }). `&&` / `||` are covered by the single & / | chars.
const BOUNDARY = String.raw`(?:^|[\n;&|(){}])\s*`;

const PATTERNS = [
  new RegExp(BOUNDARY + String.raw`gh\s+pr\s+create\b`),
  new RegExp(BOUNDARY + String.raw`gh\s+pr\s+merge\b`),
  new RegExp(BOUNDARY + String.raw`gh\s+api\s+.*pulls.*\/merge`),
];

/**
 * Remove quoted / here-doc spans so command words inside prose don't match.
 * Order matters: multi-line here-strings and heredocs first (they contain
 * quotes), then plain double- then single-quoted spans.
 *
 * @param {string} s
 * @returns {string}
 */
function stripQuoted(s) {
  let out = s;
  // PowerShell here-strings: @"..."@ and @'...'@ (may span lines)
  out = out.replace(/@"[\s\S]*?"@/g, ' ');
  out = out.replace(/@'[\s\S]*?'@/g, ' ');
  // Bash heredocs: <<['"]?TAG ... \n TAG  (optional <<- dash, quoted/unquoted tag)
  out = out.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?\n[ \t]*\2\b/g, ' ');
  // Remaining double- then single-quoted spans
  out = out.replace(/"[^"]*"/g, ' ');
  out = out.replace(/'[^']*'/g, ' ');
  return out;
}

/**
 * @param {string} cmd  Raw Bash command string from the tool input.
 * @returns {boolean}   true only for a real manual PR create/merge invocation.
 */
function isManualShipCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return false;
  const stripped = stripQuoted(cmd);
  return PATTERNS.some((re) => re.test(stripped));
}

module.exports = { isManualShipCommand, stripQuoted };
