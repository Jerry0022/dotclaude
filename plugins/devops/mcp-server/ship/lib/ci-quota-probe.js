/**
 * @module ci-quota-probe
 * @plugin devops
 * @description Early detection of exhausted GitHub Actions minutes — BEFORE
 *   ship_build picks its test scope and long before ship_release would sit in
 *   `gh pr checks --watch`. Reads the repo's newest workflow runs
 *   (`actions/runs?per_page=5`), their jobs and the failed jobs' annotations,
 *   and classifies them with the exact markers ship_release uses after the
 *   wait (ci-account-limits.js LIMIT_PATTERNS, kind actions-minutes).
 *
 *   exhausted → recordBlock(quotaKey) in the shared CI-quota store: ship_build
 *     then runs the FULL local suite, ship_release skips the long CI wait and
 *     merges only with a green full local run on HEAD's tree.
 *   healthy   → a run newer than a recorded block started normally: the block
 *     is cleared, CI comes back on its own.
 *   unknown   → anything else (gh missing, offline, no runs, API error):
 *     never a block. Fail soft.
 *
 *   The verdict is cached PROBE_TTL_MS (10 min) per account in the same store;
 *   `force` bypasses the cache (the post-early-push re-probe).
 */

import { execFileSync } from "node:child_process";
import { classifyAnnotations } from "./ci-account-limits.js";
import { quotaKey, readRecord, recordBlock, clearRecord, readProbe, writeProbe, MINUTES_KIND } from "./ci-quota.js";

function ghApi(path, cwd) {
  const raw = execFileSync("gh", ["api", path], {
    windowsHide: true, cwd, encoding: "utf8", timeout: 20_000, stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(raw);
}

const FAILED = new Set(["failure", "startup_failure", "cancelled"]);

/**
 * Classify the newest runs. Pure given `api`.
 * @param {(path:string)=>any} api  gh api caller (throws on error)
 * @param {{ branch?: string }} [o] only runs of this head branch (early-push re-probe)
 * @returns {{ status: "exhausted"|"healthy"|"unknown", runId?: number, createdAt?: string, reason?: string }}
 */
export function classifyRuns(api, { branch } = {}) {
  const q = `repos/{owner}/{repo}/actions/runs?per_page=5${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`;
  const runs = (api(q)?.workflow_runs || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  for (const run of runs) {
    if (run.status !== "completed") {
      // A run whose job already has a started step is CI working; queued says nothing yet.
      const jobs = api(`repos/{owner}/{repo}/actions/runs/${run.id}/jobs`)?.jobs || [];
      if (jobs.some((j) => j.status === "in_progress" || (j.steps || []).some((s) => s.status !== "queued"))) {
        return { status: "healthy", runId: run.id, createdAt: run.created_at };
      }
      continue;
    }
    // Only a run that succeeded proves minutes; skipped / neutral / stale /
    // action_required say nothing (an `if:` or path filter, a pending approval).
    if (run.conclusion === "success") return { status: "healthy", runId: run.id, createdAt: run.created_at };
    if (!FAILED.has(run.conclusion)) continue;
    const jobs = api(`repos/{owner}/{repo}/actions/runs/${run.id}/jobs`)?.jobs || [];
    const failed = jobs.filter((j) => FAILED.has(j.conclusion));
    if (!failed.length) continue;
    const kinds = failed.map((j) => {
      try { return classifyAnnotations(api(`repos/{owner}/{repo}/check-runs/${j.id}/annotations`)); } catch { return undefined; }
    });
    // An annotations fetch that failed is no evidence either way — never clear a block on it.
    if (kinds.some((k) => k === undefined)) {
      return { status: "unknown", runId: run.id, createdAt: run.created_at, reason: `run ${run.id}: annotations unreadable` };
    }
    if (kinds.every((k) => k === MINUTES_KIND)) {
      return { status: "exhausted", runId: run.id, createdAt: run.created_at, reason: `run ${run.id}: jobs not started — Actions minutes / spending limit` };
    }
    // A real red job means CI ran: minutes are there.
    return { status: "healthy", runId: run.id, createdAt: run.created_at };
  }
  return { status: "unknown", reason: runs.length ? "no decisive run" : "no runs" };
}

/**
 * Probe, record/clear the block, cache the verdict. Never throws.
 * @param {string} cwd
 * @param {{ api?: Function, force?: boolean, branch?: string, now?: number, file?: string, key?: string }} [o]
 * @returns {{ status: string, cached?: boolean, recorded?: boolean, cleared?: boolean, reason?: string }}
 */
export function probeCiQuota(cwd, o = {}) {
  try {
    if (process.env.DEVOPS_CI_QUOTA_PROBE === "0") return { status: "unknown", reason: "disabled" };
    const now = o.now ?? Date.now();
    const key = o.key ?? quotaKey(cwd);
    if (!key) return { status: "unknown", reason: "no GitHub origin" };
    if (!o.force) {
      const cached = readProbe(key, { now, file: o.file });
      if (cached) return { ...cached, cached: true };
    }
    const api = o.api || ((p) => ghApi(p, cwd));
    let verdict;
    try { verdict = classifyRuns(api, { branch: o.branch }); } catch (e) {
      verdict = { status: "unknown", reason: `probe failed: ${String(e && e.message || e).slice(0, 160)}` };
    }
    const out = { ...verdict };
    if (verdict.status === "exhausted") {
      out.recorded = !!recordBlock(key, { now, file: o.file });
    } else if (verdict.status === "healthy") {
      const rec = readRecord(key, { now, file: o.file });
      // Only a run started AFTER the block was detected proves CI is back.
      if (rec && Date.parse(verdict.createdAt) > Date.parse(rec.detectedAt)) out.cleared = clearRecord(key, { file: o.file });
    }
    writeProbe(key, verdict, { now, file: o.file });
    return out;
  } catch (e) {
    return { status: "unknown", reason: `probe error: ${String(e && e.message || e).slice(0, 160)}` };
  }
}
