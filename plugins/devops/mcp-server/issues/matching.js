/**
 * @module issues/matching
 * @description Pure fuzzy-matching utilities for issue search.
 */

/**
 * Tokenize text into lowercase words, strip common noise.
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9äöüß-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Score an issue against query tokens.
 * Returns 0-1 confidence based on token overlap with title + labels.
 */
export function scoreIssue(issue, queryTokens) {
  const issueText = [issue.title, ...issue.labels].join(" ");
  const issueTokens = new Set(tokenize(issueText));

  if (issueTokens.size === 0 || queryTokens.length === 0) return 0;

  let hits = 0;
  for (const qt of queryTokens) {
    for (const it of issueTokens) {
      if (it === qt || it.includes(qt) || qt.includes(it)) {
        hits++;
        break;
      }
    }
  }

  return hits / queryTokens.length;
}
