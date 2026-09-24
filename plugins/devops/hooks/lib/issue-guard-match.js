/**
 * @module issue-guard-match
 * @version 0.3.0
 * @description Pure matcher for pre.issue.guard — decides whether a Bash or
 *   PowerShell command contains a REAL issue write that must instead go
 *   through the setup-issue skill (target name `auto-issue`), the single
 *   owner of every issue write (deep-knowledge/plugin-behavior.md "Issue
 *   Creation & Editing — Always Delegate"). Two write shapes:
 *     - `gh issue create` / `gh issue edit`;
 *     - `gh api …/issues[/N][/labels|/assignees]` that writes: an explicit
 *       `-X`/`--method` POST|PATCH|PUT|DELETE, or — without an explicit
 *       method — any `-f`/`-F`/`--field`/`--raw-field`/`--input` (gh then
 *       sends a POST). `-X GET` with fields is a read.
 *
 *   Line continuations are joined first (`\` + newline in bash, a backtick +
 *   newline in PowerShell), so a multi-line write is one segment.
 *
 *   Two-stage match (as ship-guard-match, #198):
 *     1. maskQuoted() blanks quoted spans, heredocs and here-strings
 *        (offsets preserved), so `gh issue create` merely appearing inside
 *        prose (an issue body, a commit message, a grep pattern) does not
 *        count.
 *     2. The pattern is anchored to a command position — start of the
 *        command or right after a separator (`\n ; & | ( ) { }` and a
 *        backtick) — and tolerates what may sit between that position and
 *        the write: env assignments (`GH_REPO=x`), `env`, `command`, `exec`,
 *        `sudo`, `time`, `nohup`, a path to the binary (`/usr/bin/gh`,
 *        `gh.exe`), gh's global flags (`-R owner/repo`, `--repo=x`) before
 *        or after `issue` / `api`.
 *
 *   Marker: setup-issue appends `# via setup-issue` to every issue write it
 *   runs. The marker only counts on the SAME command segment as the gh call —
 *   the shell comment that ends that very command (before the next
 *   separator or newline). Every write in a command must carry its own
 *   marker. A marker inside quotes never counts. The marker alone is not
 *   enough: pre.issue.guard also requires setup-issue / auto-issue to have
 *   been invoked in the current turn.
 */

const { maskQuoted } = require('./ship-guard-match');

const BOUNDARY = String.raw`(?:^|[\n;&|(){}\x60])[ \t]*`;
const PREFIX = String.raw`(?:(?:env|command|exec|sudo|time|nohup)[ \t]+|[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*`;
const GH = String.raw`(?:[^\s;&|()]*[\\/])?gh(?:\.exe)?`;
/** A flag, optionally with a value that is not itself the next keyword. */
const FLAG = String.raw`[ \t]+-{1,2}[\w-]+(?:=\S*|[ \t]+(?!issue\b|create\b|edit\b|api\b|-)[^\s;&|]+)?`;

const WRITE_RE = new RegExp(
  BOUNDARY + PREFIX + GH + `(?:${FLAG})*` + String.raw`[ \t]+issue` + `(?:${FLAG})*` + String.raw`[ \t]+(create|edit)\b`,
  'gi'
);

/** `gh api` at a command position — the rest of the segment decides. */
const API_RE = new RegExp(BOUNDARY + PREFIX + GH + `(?:${FLAG})*` + String.raw`[ \t]+api\b`, 'gi');

/** An issue (or its labels/assignees) endpoint — not comments, not timeline. */
const API_ISSUE_PATH_RE =
  /(?:^|\s)\/?repos\/[^\s/]+\/[^\s/]+\/issues(?:\/\d+(?:\/(?:labels|assignees)(?:\/[^\s/?]+)?)?)?(?:\?\S*)?(?=\s|$)/i;
const API_METHOD_RE = /(?:^|\s)(?:-X|--method)(?:[ \t]+|=)?([A-Za-z]+)/;
const API_WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const API_FIELD_RE = /(?:^|\s)(?:-[fF]|--field|--raw-field|--input)/;

/** The marker setup-issue appends to every issue write it performs. */
const MARKER_RE = /#\s*via\s+setup-issue\b/i;

/** Separators that end a command segment (after quote masking). */
const SEGMENT_END_RE = /[\n;|&]/;

/**
 * Join line continuations: bash `\` + newline, PowerShell backtick + newline.
 * @param {string} cmd
 */
function joinContinuations(cmd) {
  return cmd.replace(/\\\r?\n/g, '  ').replace(/\x60\r?\n/g, '  ');
}

/**
 * Where the segment starting at `from` ends in the masked command, and the
 * index of its unquoted `#` comment (or -1).
 */
function segmentBounds(masked, from) {
  const rest = masked.slice(from);
  const sep = rest.search(SEGMENT_END_RE);
  const end = sep === -1 ? masked.length : from + sep;
  const hash = masked.slice(from, end).indexOf('#');
  return { end, hash: hash === -1 ? -1 : from + hash };
}

/** Does the segment's own trailing comment carry the marker? */
function segmentMarked(cmd, masked, from) {
  const { hash } = segmentBounds(masked, from);
  if (hash === -1) return false;
  // A comment runs to the end of the line, past `;`/`|` inside it.
  const nl = masked.indexOf('\n', hash);
  const commentEnd = nl === -1 ? cmd.length : nl;
  return MARKER_RE.test(masked.slice(hash, commentEnd));
}

/** Is this `gh api` segment (quotes removed, comment cut) an issue write? */
function isApiIssueWrite(args) {
  if (!API_ISSUE_PATH_RE.test(args)) return false;
  const method = API_METHOD_RE.exec(args);
  if (method) return API_WRITE_METHODS.has(method[1].toUpperCase());
  return API_FIELD_RE.test(args);
}

/**
 * Every real issue write in the command, with whether its own segment
 * carries the marker.
 * @param {string} cmd raw command
 * @returns {{index:number, verb:string, marked:boolean}[]}
 */
function findIssueWrites(cmd) {
  if (!cmd || typeof cmd !== 'string') return [];
  const joined = joinContinuations(cmd);
  const masked = maskQuoted(joined);
  const out = [];
  for (const m of masked.matchAll(WRITE_RE)) {
    out.push({ index: m.index, verb: m[1].toLowerCase(), marked: segmentMarked(joined, masked, m.index + m[0].length) });
  }
  for (const m of masked.matchAll(API_RE)) {
    const from = m.index + m[0].length;
    const { end, hash } = segmentBounds(masked, from);
    const args = joined.slice(from, hash === -1 ? end : hash).replace(/["']/g, '');
    if (!isApiIssueWrite(args)) continue;
    out.push({ index: m.index, verb: 'api', marked: segmentMarked(joined, masked, from) });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * @param {string} cmd raw command
 * @returns {boolean} true for a real issue write (quoted occurrences
 *   excluded), marked or not.
 */
function isRawIssueWriteCommand(cmd) {
  return findIssueWrites(cmd).length > 0;
}

/**
 * Does EVERY issue write in the command carry its own same-segment marker?
 * False when there is no write at all.
 * @param {string} cmd
 * @returns {boolean}
 */
function hasSetupIssueMarker(cmd) {
  const writes = findIssueWrites(cmd);
  return writes.length > 0 && writes.every(w => w.marked);
}

/**
 * A write without its own marker.
 * @param {string} cmd
 * @returns {boolean}
 */
function isUnmarkedIssueWrite(cmd) {
  return findIssueWrites(cmd).some(w => !w.marked);
}

/** GitHub MCP tools that create or edit an issue (`issue_write` in the
 *  current github-mcp-server, `create_issue` / `update_issue` in older ones),
 *  under any connector namespace (`mcp__plugin_github_github__issue_write`). */
const MCP_ISSUE_WRITE_RE = /^mcp__.*github.*__(?:issue_write|create_issue|update_issue)$/i;

function isMcpIssueWriteTool(name) {
  return typeof name === 'string' && MCP_ISSUE_WRITE_RE.test(name);
}

module.exports = {
  findIssueWrites,
  isRawIssueWriteCommand,
  hasSetupIssueMarker,
  isUnmarkedIssueWrite,
  isApiIssueWrite,
  isMcpIssueWriteTool,
  joinContinuations,
  MARKER_RE,
  MCP_ISSUE_WRITE_RE,
};
