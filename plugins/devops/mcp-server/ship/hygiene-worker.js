#!/usr/bin/env node
/**
 * @module dotclaude-hygiene-worker
 * @plugin devops
 * @description Detached half of ship_hygiene (trigger "ship"): the removal that
 *   used to block the ship's completion card. Spawned by lib/hygiene.js
 *   `startHygieneWorker` with one JSON argument `{ cwd, stateKey, settings, statePath? }`.
 *   Runs the same plan + executeAutoClean (all safety gates) in-process via
 *   runHygiene({ sync: true }) and records the result in the hygiene state
 *   (lastAutoClean, damaged, sizes). The nudge and stale-PR lookups already
 *   ran in the ship call, so they are switched off here. One worker per repo
 *   (lock in the git common dir, stale after 30 min). Silent; never throws.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { runHygiene, acquireWorkerLock, releaseWorkerLock } from "./lib/hygiene.js";

export function runWorker(job, run = runHygiene) {
  if (!job || !job.cwd || !job.settings) return { ran: false, reason: "bad-job" };
  if (!acquireWorkerLock(job.cwd)) return { ran: false, reason: "locked" };
  try {
    run({
      cwd: job.cwd, trigger: "ship", sync: true, settings: { ...job.settings, nudge: false },
      stateKey: job.stateKey, statePath: job.statePath || undefined,
      fetchOwnPrs: () => null,
    });
    return { ran: true };
  } catch {
    return { ran: false, reason: "error" };
  } finally {
    releaseWorkerLock(job.cwd);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { runWorker(JSON.parse(process.argv[2] || "null")); } catch { /* silent */ }
}
