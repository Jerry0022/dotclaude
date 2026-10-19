/**
 * @module ship/lib/ci-quota
 * @description Machine-wide memory of an exhausted GitHub Actions quota (#752).
 *
 * When the minutes / spending limit are used up, checks fail within seconds with
 * zero steps and a billing annotation. Without a shared record every session
 * rediscovers that on its own and asks the user again. The record lives in
 * `~/.claude/devops-ci-quota.json` (override: env DEVOPS_CI_QUOTA_FILE, or the
 * `file` option), keyed by `owner/repo`, so all sessions and worktrees agree.
 *
 * Safety: a record is only ever created from the billing signature (every failed
 * check has zero steps AND a billing annotation) — never from a real red check.
 * It expires at the reset date (unknown → 1st of next month, UTC) and is dropped
 * as soon as a check on the repo runs for real again. The user's decision is
 * stored only on an explicit answer and can be revoked.
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";

export const DECISIONS = ["skip-checks", "wait"];

const BILLING_RE = /payments?\b[^.]*\bfailed|spending limit/i;

export function storePath(file) {
  return file || process.env.DEVOPS_CI_QUOTA_FILE || join(homedir(), ".claude", "devops-ci-quota.json");
}

/** `owner/repo` (lower-case) from the origin remote, or null. */
export function repoKey(cwd, { remoteUrl } = {}) {
  let url = remoteUrl;
  if (url === undefined) {
    try {
      url = execFileSync("git", ["remote", "get-url", "origin"], {
        cwd, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch { return null; }
  }
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url || "");
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** Billing signature of ONE job: it never started a step and the annotation names the payment/limit. */
export function isBillingBlock({ steps, annotations } = {}) {
  if (!Array.isArray(steps) || steps.length > 0) return false;
  return (annotations || []).some((a) => BILLING_RE.test(typeof a === "string" ? a : `${a?.message || ""} ${a?.title || ""}`));
}

/** 1st of the next month 00:00 UTC (the documented fallback when the reset date is unknown). */
export function nextMonthResetUtc(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function load(file) {
  try {
    const data = JSON.parse(readFileSync(storePath(file), "utf8"));
    return data && typeof data.repos === "object" && data.repos ? data : { version: 1, repos: {} };
  } catch { return { version: 1, repos: {} }; }
}

function save(data, file) {
  const p = storePath(file);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, p);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

/** Active record for the repo, or null. An expired record is removed on the way. */
export function readRecord(key, { now = Date.now(), file } = {}) {
  if (!key) return null;
  const data = load(file);
  const rec = data.repos[key];
  if (!rec) return null;
  if (!rec.resetAt || Date.parse(rec.resetAt) <= now) {
    delete data.repos[key];
    try { save(data, file); } catch { /* read-only home — still report expired */ }
    return null;
  }
  return { key, ...rec };
}

/** Record (or refresh) a detected block; an existing decision is kept. */
export function recordBlock(key, { now = Date.now(), file, resetAt } = {}) {
  if (!key) return null;
  const data = load(file);
  const prev = data.repos[key];
  data.repos[key] = {
    detectedAt: prev?.detectedAt || new Date(now).toISOString(),
    resetAt: resetAt || nextMonthResetUtc(now),
    ...(prev?.decision ? { decision: prev.decision } : {}),
  };
  save(data, file);
  return { key, ...data.repos[key] };
}

/** Store the user's explicit answer. Only meaningful while a block is recorded; returns null otherwise. */
export function setDecision(key, value, { now = Date.now(), file } = {}) {
  if (!DECISIONS.includes(value)) throw new Error(`decision must be one of ${DECISIONS.join(", ")}`);
  const rec = readRecord(key, { now, file });
  if (!rec) return null;
  const data = load(file);
  data.repos[key].decision = { value, decidedAt: new Date(now).toISOString() };
  save(data, file);
  return { key, ...data.repos[key] };
}

/** Forget the user's decision; the detected block stays until it expires or checks run again. */
export function revokeDecision(key, { file } = {}) {
  if (!key) return false;
  const data = load(file);
  if (!data.repos[key]?.decision) return false;
  delete data.repos[key].decision;
  save(data, file);
  return true;
}

/** Drop the whole record (checks ran with steps again). */
export function clearRecord(key, { file } = {}) {
  if (!key) return false;
  const data = load(file);
  if (!data.repos[key]) return false;
  delete data.repos[key];
  save(data, file);
  return true;
}

function ghApiDefault(path, { cwd } = {}) {
  return JSON.parse(execFileSync("gh", ["api", path], {
    cwd: cwd || process.cwd(), encoding: "utf8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"],
  }));
}

/**
 * True only when EVERY failed check shows the billing signature (zero steps +
 * billing annotation). One real red check, an unreadable job or a missing job
 * id makes the answer false — fail-closed, the failure stays a failure.
 */
export function probeBillingBlock(failed, opts, { ghApi = ghApiDefault } = {}) {
  if (!Array.isArray(failed) || failed.length === 0) return false;
  for (const c of failed) {
    const id = /\/job\/(\d+)|check-runs?\/(\d+)/.exec(c?.link || "");
    const jobId = id && (id[1] || id[2]);
    if (!jobId) return false;
    try {
      const job = ghApi(`repos/{owner}/{repo}/actions/jobs/${jobId}`, opts);
      const ann = ghApi(`repos/{owner}/{repo}/check-runs/${jobId}/annotations`, opts);
      if (!isBillingBlock({ steps: job?.steps, annotations: Array.isArray(ann) ? ann : [] })) return false;
    } catch { return false; }
  }
  return true;
}

/** Compact, JSON-safe view for ship tool results. */
export function describeRecord(rec) {
  if (!rec) return null;
  return {
    repo: rec.key,
    detectedAt: rec.detectedAt,
    resetAt: rec.resetAt,
    decision: rec.decision?.value || null,
    decidedAt: rec.decision?.decidedAt || null,
  };
}
