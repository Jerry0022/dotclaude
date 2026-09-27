/**
 * @module issues/matching
 * @description Pure fuzzy-matching utilities for issue search — the same
 *   code the prompt.issue.detect hook runs (hooks/lib/issue-match.js).
 */

import { createRequire } from "node:module";

const shared = createRequire(import.meta.url)("../../hooks/lib/issue-match.js");

export const tokenize = shared.tokenize;
export const scoreIssue = shared.scoreIssue;
