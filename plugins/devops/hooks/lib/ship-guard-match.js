/**
 * @module ship-guard-match
 * @version 0.3.0
 * @description Pure matcher for pre.ship.guard — decides whether a Bash command
 *   is a REAL manual PR create/merge invocation that must go through /do-ship.
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
  return replaceQuoted(s, () => ' ');
}

/**
 * Like stripQuoted, but each removed span becomes the same number of spaces,
 * so offsets in the result are offsets in the original command.
 * @param {string} s
 * @returns {string}
 */
function maskQuoted(s) {
  return replaceQuoted(s, (m) => ' '.repeat(m.length));
}

/**
 * Like maskQuoted, but each removed span becomes underscores, so a quoted
 * argument (`git -C "my dir" commit`) stays one non-space token and the git
 * option matcher can step over it. Offsets are preserved.
 * @param {string} s
 * @returns {string}
 */
function maskQuotedToken(s) {
  return replaceQuoted(s, (m) => '_'.repeat(m.length));
}

// The global options git takes before its subcommand: `-C <dir>`, `-c k=v`,
// `--git-dir[=]<p>`, `--work-tree[=]<p>`, `--no-pager` and friends. Leading
// `VAR=value` assignments are a command prefix as well.
const ENV_PREFIX = String.raw`(?:[A-Za-z_]\w*=\S*\s+)*`;
const GIT_GLOBAL_OPTS = String.raw`(?:\s+(?:-C\s+\S+|-c\s+\S+|--(?:git-dir|work-tree|namespace)(?:=\S+|\s+\S+)|--no-pager|--paginate|-p|--bare|--no-replace-objects|--literal-pathspecs))*`;
/** The end of a subcommand word: whitespace, a separator, or the end. */
const WORD_END = String.raw`(?=[\s;&|(){}]|$)`;

/**
 * A regex for a real `git … <subcommand…>` invocation at a command position —
 * chained (`a && git commit`), with global options (`git -C . commit`,
 * `git -c k=v commit`) or env prefixes. Run it on maskQuotedToken() output.
 * @param {string} rest regex source for the subcommand and what follows
 * @returns {RegExp}
 */
function gitCommandRe(rest) {
  return new RegExp(BOUNDARY + ENV_PREFIX + String.raw`git(?:\.exe)?` + GIT_GLOBAL_OPTS + String.raw`\s+` + rest, 'm');
}

/**
 * Does `cmd` invoke git with one of the subcommand patterns? Quoted text,
 * heredoc bodies and here-strings never match.
 * @param {string} cmd
 * @param {RegExp[]} res built by gitCommandRe
 * @returns {boolean}
 */
function matchesGitCommand(cmd, res) {
  if (!cmd || typeof cmd !== 'string') return false;
  const masked = maskQuotedToken(cmd);
  return res.some((re) => re.test(masked));
}

function replaceQuoted(s, fill) {
  let out = s;
  // PowerShell here-strings: @"..."@ and @'...'@ (may span lines)
  out = out.replace(/@"[\s\S]*?"@/g, fill);
  out = out.replace(/@'[\s\S]*?'@/g, fill);
  // Bash heredocs: <<['"]?TAG ... \n TAG  (optional <<- dash, quoted/unquoted tag)
  out = out.replace(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[\s\S]*?\n[ \t]*\2\b/g, fill);
  // Remaining double- then single-quoted spans
  out = out.replace(/"[^"]*"/g, fill);
  out = out.replace(/'[^']*'/g, fill);
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

// Options `git push` may carry in a pure remote-branch delete. Anything else
// (--force, --mirror, --all, --prune, --tags, -u ...) makes the push a real one.
const DELETE_SAFE_OPTS = new Set(['-d', '--delete', '-q', '--quiet', '-v', '--verbose', '-n', '--dry-run', '--no-verify', '--porcelain']);
// A token with shell syntax (substitution, redirect, subshell, leftover quote,
// glob) cannot be read as a plain ref name.
const SHELL_SYNTAX = /[$`<>(){}'"*?\\]/;
// Remote names and ref specs are an allowlist, not a denylist: anything else
// (`,` `@` `[` `~` `!` `#` `%` …) may be read differently by bash, PowerShell
// or git and never counts as a plain name.
const PLAIN_SPEC = /^:?[A-Za-z0-9._/-]+$/;

/**
 * The remote refs a command deletes, when EVERY `git push` in it is a pure
 * delete (`git push <remote> --delete|-d <ref>...` or `git push <remote> :<ref>...`).
 * null when a push in it does anything else, a token is not a plain ref name,
 * or there is no push. Refs are returned without `refs/heads/` / `heads/` and
 * the leading `:`; fully quoted refs are unquoted. A ref in another namespace
 * (`refs/tags/…`, `refs/remotes/…`) makes it null.
 * @param {string} cmd
 * @returns {string[]|null}
 */
function remoteDeleteRefs(cmd) {
  const t = remoteDeleteTargets(cmd);
  return t ? t.refs : null;
}

/**
 * remoteDeleteRefs plus the remotes the deletes go to.
 * @param {string} cmd
 * @returns {{remotes: string[], refs: string[]}|null}
 */
function remoteDeleteTargets(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  const masked = maskQuotedToken(cmd);
  const pushRe = gitCommandRe(String.raw`push` + WORD_END);
  const refs = [];
  const remotes = new Set();
  let pushes = 0;
  // Split at shell separators; offsets stay aligned with the original command.
  const sep = /&&|\|\||[;|&\n]/g;
  let start = 0;
  const segments = [];
  for (let m; (m = sep.exec(masked)); start = m.index + m[0].length) segments.push([start, m.index]);
  segments.push([start, masked.length]);
  for (const [a, b] of segments) {
    const seg = masked.slice(a, b);
    const hit = pushRe.exec(seg);
    if (!hit) continue;
    pushes++;
    const tokens = [];
    const tokRe = /\S+/g;
    tokRe.lastIndex = hit.index + hit[0].length;
    for (let t; (t = tokRe.exec(seg));) {
      tokens.push(cmd.slice(a + t.index, a + t.index + t[0].length).replace(/^(['"])(.*)\1$/, '$2'));
    }
    let del = false;
    const pos = [];
    for (const t of tokens) {
      if (SHELL_SYNTAX.test(t)) return null;
      if (t.startsWith('-')) {
        if (!DELETE_SAFE_OPTS.has(t)) return null;
        if (t === '-d' || t === '--delete') del = true;
      } else if (PLAIN_SPEC.test(t)) pos.push(t);
      else return null;
    }
    if (pos.length < 2 || pos[0].startsWith(':')) return null; // remote + at least one ref
    remotes.add(pos[0]);
    for (const spec of pos.slice(1)) {
      if (!del && !spec.startsWith(':')) return null;
      // git DWIMs `heads/main` to refs/heads/main as well
      const name = spec.replace(/^:/, '').replace(/^(?:refs\/)?heads\//, '');
      if (!name || name.includes(':') || name.startsWith('refs/')) return null;
      refs.push(name);
    }
  }
  return pushes ? { remotes: [...remotes], refs } : null;
}

module.exports = {
  isManualShipCommand, stripQuoted, maskQuoted, maskQuotedToken,
  BOUNDARY, WORD_END, gitCommandRe, matchesGitCommand, remoteDeleteRefs, remoteDeleteTargets,
};
