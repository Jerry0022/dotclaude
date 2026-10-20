/**
 * @module issue-match
 * @version 0.1.0
 * @plugin devops
 * @description Issue matching shared by the issues MCP server and the
 *   prompt.issue.detect hook, plus the on-disk copy of the open-issue list.
 *
 *   The hook used to tell Claude, on the first prompt of every session
 *   without an issue number, to call match_issues — one tool round trip that
 *   almost never found anything worth asking about. The MCP server now
 *   writes its open-issue list to a per-repo cache file whenever it
 *   refreshes; the hook scores the prompt against it itself and involves
 *   Claude only when an issue matches with confidence ≥ MATCH_ASK_MIN. With
 *   no usable cache (server not run yet, repo without GitHub) the hook falls
 *   back to the old match_issues instruction.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** A match below this is not worth a question to the user. */
const MATCH_ASK_MIN = 0.6;
/** A cache older than this no longer speaks for the open issues. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Shortest query word allowed to match as a substring of an issue word. */
const PARTIAL_MIN_LEN = 4;

/** Lowercase words of 3+ characters, punctuation stripped. */
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** 0–1: the share of query tokens found in the issue's title and labels. */
function scoreIssue(issue, queryTokens) {
  // `type:bug` -> `bug`: the namespace prefix (type/role/module) is not content
  // and would substring-match ordinary words like "typescript".
  const labels = (issue.labels || []).map((l) => String(l).replace(/^[a-z]+:/i, ''));
  const issueText = [issue.title, ...labels].join(' ');
  const issueTokens = new Set(tokenize(issueText));
  if (issueTokens.size === 0 || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    for (const it of issueTokens) {
      // Partial match only one way (query word inside a longer issue word) and
      // only for words long enough to mean something: "debug" must not hit the
      // label "bug", "bug" must not hit "debugging".
      if (it === qt || (qt.length >= PARTIAL_MIN_LEN && it.includes(qt))) { hits++; break; }
    }
  }
  return hits / queryTokens.length;
}

/** Top matches at or above `threshold`, best first. */
function matchIssues(issues, query, { maxResults = 3, threshold = 0.25 } = {}) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  return (issues || [])
    .map((issue) => ({ ...issue, confidence: scoreIssue(issue, queryTokens) }))
    .filter((i) => i.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxResults);
}

/** `git@github.com:o/r.git`, `https://github.com/o/r` → `github.com/o/r`. */
function normalizeRemote(url) {
  return String(url || '').trim()
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[a-z]+:\/\/(?:[^@/]+@)?/i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
}

/** Per-user cache folder — a shared /tmp lets another user pre-plant files. */
function defaultCacheDir(base = os.tmpdir()) {
  let who = 'user';
  try { who = String(process.getuid ? process.getuid() : os.userInfo().username); } catch { /* keep default */ }
  return path.join(base, `dotclaude-${who.replace(/[^a-z0-9._-]/gi, '_')}`);
}

/** One line, no quotes/control characters, capped — issue titles reach Claude's context. */
function sanitizeTitle(title) {
  return String(title == null ? '' : title)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f"'`]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

function sanitizeIssues(issues) {
  return issues.map((i) => ({ ...i, title: sanitizeTitle(i && i.title) }));
}

function cacheFile(remoteUrl, dir = defaultCacheDir()) {
  const key = crypto.createHash('sha1').update(normalizeRemote(remoteUrl)).digest('hex').slice(0, 16);
  return path.join(dir, `dotclaude-issues-cache-${key}.json`);
}

/**
 * POSIX: the cache dir must be a real directory owned by us with no
 * group/other bits — mkdirSync leaves a pre-planted dir untouched, so a
 * predictable /tmp path is only trusted after this check. Windows: per-user
 * temp, not checked.
 */
function cacheDirSafe(dir, { platform = process.platform, uid = process.getuid ? process.getuid() : undefined } = {}) {
  if (platform === 'win32' || uid === undefined) return true;
  try {
    const st = fs.lstatSync(dir);
    return st.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o077) === 0;
  } catch { return false; }
}

function writeCache(remoteUrl, issues, { dir, now = Date.now() } = {}) {
  if (!normalizeRemote(remoteUrl)) return;
  const file = cacheFile(remoteUrl, dir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!cacheDirSafe(path.dirname(file))) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ts: now, remote: normalizeRemote(remoteUrl), issues: sanitizeIssues(issues) }));
  fs.renameSync(tmp, file);
}

/** The cached issue list, or null when missing, unreadable or stale. */
function readCache(remoteUrl, { dir, now = Date.now(), maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  if (!normalizeRemote(remoteUrl)) return null;
  try {
    const file = cacheFile(remoteUrl, dir);
    if (!cacheDirSafe(path.dirname(file))) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.issues) || !(data.ts <= now && now - data.ts <= maxAgeMs)) return null;
    return sanitizeIssues(data.issues);
  } catch { return null; }
}

module.exports = {
  MATCH_ASK_MIN, CACHE_MAX_AGE_MS,
  tokenize, scoreIssue, matchIssues, sanitizeTitle, defaultCacheDir, cacheDirSafe, normalizeRemote, cacheFile, writeCache, readCache,
};
