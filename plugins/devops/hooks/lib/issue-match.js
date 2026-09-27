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
  const issueText = [issue.title, ...(issue.labels || [])].join(' ');
  const issueTokens = new Set(tokenize(issueText));
  if (issueTokens.size === 0 || queryTokens.length === 0) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    for (const it of issueTokens) {
      if (it === qt || it.includes(qt) || qt.includes(it)) { hits++; break; }
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

function cacheFile(remoteUrl, dir = os.tmpdir()) {
  const key = crypto.createHash('sha1').update(normalizeRemote(remoteUrl)).digest('hex').slice(0, 16);
  return path.join(dir, `dotclaude-issues-cache-${key}.json`);
}

function writeCache(remoteUrl, issues, { dir, now = Date.now() } = {}) {
  if (!normalizeRemote(remoteUrl)) return;
  const file = cacheFile(remoteUrl, dir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ts: now, remote: normalizeRemote(remoteUrl), issues }));
  fs.renameSync(tmp, file);
}

/** The cached issue list, or null when missing, unreadable or stale. */
function readCache(remoteUrl, { dir, now = Date.now(), maxAgeMs = CACHE_MAX_AGE_MS } = {}) {
  if (!normalizeRemote(remoteUrl)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(remoteUrl, dir), 'utf8'));
    if (!Array.isArray(data.issues) || !(now - data.ts <= maxAgeMs)) return null;
    return data.issues;
  } catch { return null; }
}

module.exports = {
  MATCH_ASK_MIN, CACHE_MAX_AGE_MS,
  tokenize, scoreIssue, matchIssues, normalizeRemote, cacheFile, writeCache, readCache,
};
