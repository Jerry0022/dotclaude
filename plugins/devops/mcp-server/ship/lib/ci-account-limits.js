/**
 * @module ship/lib/ci-account-limits
 * @description Tell a red CI check caused by a GitHub ACCOUNT limit apart from
 * a real failure.
 *
 * Two account-wide limits turn checks red without any defect in the code:
 *   - Actions minutes / spending limit / billing lock: the job is never
 *     started and fails within seconds ("The job was not started because …").
 *   - Artifact storage quota: every test passes, then `upload-artifact` fails
 *     ("Artifact storage quota has been hit").
 * The pre-merge checks gate used to read both as "checks failed", so a ship
 * blocked on CI that could not run — and every retry blocked again until the
 * quota reset. Classifying them lets the pipeline fall back to the local
 * quality gate instead of waiting on a limit the code cannot fix.
 *
 * A check counts as account-limited only when EVERY failure annotation on it
 * matches a limit pattern. A test failure always adds its own "Process
 * completed with exit code 1" annotation, so a real failure never slips
 * through as a limit.
 */

import { execFileSync } from "node:child_process";

export const LIMIT_PATTERNS = [
  {
    kind: "actions-minutes",
    re: /job was not started because|spending limit|account payments have failed|account is locked due to a billing|included minutes/i,
  },
  {
    kind: "artifact-quota",
    re: /artifact storage quota has been hit/i,
  },
];

/**
 * Classify one check's annotations.
 * @param {Array<{annotation_level?: string, message?: string}>} annotations
 * @returns {string|null} the limit kind, or null when the check failed for
 *   any other reason (or carries no failure annotation at all).
 */
export function classifyAnnotations(annotations) {
  const failures = (annotations || []).filter((a) => a?.annotation_level === "failure");
  if (failures.length === 0) return null;
  let kind = null;
  for (const a of failures) {
    const hit = LIMIT_PATTERNS.find((p) => p.re.test(a.message || ""));
    if (!hit) return null;
    // A minutes lock outranks a quota hit: it stops every job, not one step.
    if (!kind || hit.kind === "actions-minutes") kind = hit.kind;
  }
  return kind;
}

/** Job id from a check link (`…/actions/runs/<run>/job/<job>`). */
export function jobIdFromLink(link) {
  const m = /\/job\/(\d+)/.exec(String(link || ""));
  return m ? m[1] : null;
}

function defaultFetchAnnotations(jobId, opts) {
  const raw = execFileSync(
    "gh",
    ["api", `repos/{owner}/{repo}/check-runs/${jobId}/annotations`],
    { windowsHide: true, cwd: opts?.cwd || process.cwd(), encoding: "utf8", timeout: 20_000, stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(raw);
}

/**
 * Decide whether a set of failed checks failed ONLY because of account
 * limits. Never throws: an unreadable annotation makes that check "real", so
 * the gate stays fail-closed.
 *
 * @param {Array<{name?: string, workflow?: string, link?: string}>} failed
 * @returns {{ limited: boolean, kinds: string[], checks: Array<{name: string, kind: string|null}> }}
 */
export function classifyFailedChecks(failed, opts = {}, { fetchAnnotations = defaultFetchAnnotations } = {}) {
  const checks = (failed || []).map((c) => {
    const name = c.name || c.workflow || "check";
    const jobId = jobIdFromLink(c.link);
    if (!jobId) return { name, kind: null };
    try {
      return { name, kind: classifyAnnotations(fetchAnnotations(jobId, opts)) };
    } catch {
      return { name, kind: null };
    }
  });
  const limited = checks.length > 0 && checks.every((c) => c.kind);
  const kinds = [...new Set(checks.map((c) => c.kind).filter(Boolean))];
  return { limited, kinds, checks };
}
