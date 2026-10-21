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
 * Detection is NOT done here: ci-account-limits.js (#768) is the single detector.
 * A record is only ever created when it reports kind "actions-minutes" for every
 * failed check (see MINUTES_KIND) — never from a real red check or an artifact
 * quota hit (the latter resets on its own schedule and does not stop jobs).
 * It expires at the reset date (unknown → 1st of next month, UTC) and is dropped
 * as soon as a check on the repo runs for real again. The user's decision is
 * stored only on an explicit answer and can be revoked.
 *
 * The decision lives apart from the block (`decisions[key]`) and is valid for
 * DECISION_TTL_MS (7 days) from the answer, across all sessions: the block can
 * clear and come back within that window without a new question. After the
 * window the next minutes block asks again (interactive ships) — see
 * release-results.md § Account-limited CI.
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";

export const DECISIONS = ["skip-checks", "wait"];

/** The only ci-account-limits kind that is recorded: it stops every job of the account. */
export const MINUTES_KIND = "actions-minutes";

/** How long a user's answer (skip-checks / wait) stays valid for the project. */
export const DECISION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function storePath(file) {
  return file || process.env.DEVOPS_CI_QUOTA_FILE || join(homedir(), ".claude", "devops-ci-quota.json");
}

/** `owner/repo` (lower-case) from the origin remote, or null. */
export function repoKey(cwd, { remoteUrl } = {}) {
  let url = remoteUrl;
  if (url === undefined) {
    try {
      url = execFileSync("git", ["remote", "get-url", "origin"], { windowsHide: true,
        cwd, encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch { return null; }
  }
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url || "");
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/** 1st of the next month 00:00 UTC (the documented fallback when the reset date is unknown). */
export function nextMonthResetUtc(now = Date.now()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function load(file) {
  let data;
  try { data = JSON.parse(readFileSync(storePath(file), "utf8")); } catch { data = null; }
  if (!data || typeof data.repos !== "object" || !data.repos) data = { version: 1, repos: {} };
  if (typeof data.decisions !== "object" || !data.decisions) data.decisions = {};
  // Pre-TTL stores kept the decision inside the block record — move it out.
  for (const [key, rec] of Object.entries(data.repos)) {
    if (rec && rec.decision) {
      if (!data.decisions[key]) data.decisions[key] = rec.decision;
      delete rec.decision;
    }
  }
  return data;
}

/** The decision's expiry; a missing/garbled decidedAt expires at once. */
function decisionExpiresAt(dec) {
  const t = Date.parse(dec?.decidedAt);
  return Number.isFinite(t) ? t + DECISION_TTL_MS : NaN;
}

/** Active (≤ 7 days) decision for the key, or null. Mutates `data` when expired; returns [decision, changed]. */
function activeDecision(data, key, now) {
  const dec = data.decisions[key];
  if (!dec) return [null, false];
  if (!(decisionExpiresAt(dec) > now)) { delete data.decisions[key]; return [null, true]; }
  return [{ ...dec, expiresAt: new Date(decisionExpiresAt(dec)).toISOString() }, false];
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
  // `!(… > now)`: a garbled `resetAt` (NaN) expires too, instead of never.
  if (!(Date.parse(rec.resetAt) > now)) {
    delete data.repos[key];
    try { save(data, file); } catch { /* read-only home — still report expired */ }
    return null;
  }
  const [decision, changed] = activeDecision(data, key, now);
  if (changed) { try { save(data, file); } catch { /* still report it expired */ } }
  return { key, ...rec, ...(decision ? { decision } : {}) };
}

/** Record (or refresh) a detected block; a still-valid decision (≤ 7 days) applies to it. */
export function recordBlock(key, { now = Date.now(), file, resetAt } = {}) {
  if (!key) return null;
  const data = load(file);
  const prev = data.repos[key];
  data.repos[key] = {
    detectedAt: prev?.detectedAt || new Date(now).toISOString(),
    resetAt: resetAt || nextMonthResetUtc(now),
  };
  const [decision] = activeDecision(data, key, now);
  save(data, file);
  return { key, ...data.repos[key], ...(decision ? { decision } : {}) };
}

/** Store the user's explicit answer. Only meaningful while a block is recorded; returns null otherwise. */
export function setDecision(key, value, { now = Date.now(), file } = {}) {
  if (!DECISIONS.includes(value)) throw new Error(`decision must be one of ${DECISIONS.join(", ")}`);
  const rec = readRecord(key, { now, file });
  if (!rec) return null;
  const data = load(file);
  if (!data.repos[key]) return null; // cleared by another session in between
  data.decisions[key] = { value, decidedAt: new Date(now).toISOString() };
  save(data, file);
  return { key, ...data.repos[key], decision: { ...data.decisions[key], expiresAt: new Date(now + DECISION_TTL_MS).toISOString() } };
}

/** Forget the user's decision; the detected block stays until it expires or checks run again. */
export function revokeDecision(key, { file } = {}) {
  if (!key) return false;
  const data = load(file);
  if (!data.decisions[key]) return false;
  delete data.decisions[key];
  save(data, file);
  return true;
}

/** Drop the block (checks ran with steps again). The user's answer keeps its 7-day validity. */
export function clearRecord(key, { file } = {}) {
  if (!key) return false;
  const data = load(file);
  if (!data.repos[key]) return false;
  delete data.repos[key];
  save(data, file);
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
    decisionExpiresAt: rec.decision?.expiresAt || null,
  };
}
