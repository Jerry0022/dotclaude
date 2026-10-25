#!/usr/bin/env node
'use strict';
/**
 * @script batch-policy
 * @version 0.1.0
 * @plugin devops
 * @description Decides whether a large, unattended job may take the Message
 *   Batches path (-50 %) instead of the normal one. "No" is a normal answer,
 *   never an error: the caller then finishes the job exactly as before.
 *   Alpha channel only (feature flag "batch"). Docs: deep-knowledge/api-batch.md
 *
 * Usage: batch-policy.js --requests N --est-input-tokens T --est-output-tokens O
 *          [--model M] [--unattended] [--deadline-min 120] [--max-usd X]
 * Exit codes: 0 = use batch, 3 = use the normal path, 126 = feature off.
 */

const { featureAllowed } = require('../hooks/lib/features');
const safe = require('./claude-api-safe');

const MIN_REQUESTS = 5;
const MIN_SAVING_USD = 1;
const MIN_DEADLINE_MS = 30 * 60 * 1000;
const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;

function no(reason, est = {}) {
  return { useBatch: false, reason, estUsd: est.estUsd || 0, estSavingUsd: est.estSavingUsd || 0 };
}

function monthStart(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

/** Remaining month budget in $, or null when none is known. */
function remainingBudget(job, env, { home, now }) {
  const raw = job.monthBudgetUsd !== undefined ? job.monthBudgetUsd : env.DEVOPS_API_MONTH_BUDGET_USD;
  const budget = Number(raw);
  if (raw === undefined || raw === null || raw === '' || !(budget > 0)) return null;
  const spent = safe.usageSummary({ home, since: monthStart(now) }).usd || 0;
  return budget - spent;
}

/**
 * @param {{requests:number, estInputTokens:number, estOutputTokens:number, model?:string,
 *          unattended?:boolean, deadlineMs?:number, monthBudgetUsd?:number, maxUsd?:number, cwd?:string}} job
 * @param {{env?:object, home?:string, now?:number, featureOpts?:object}} ctx
 * @returns {{useBatch:boolean, reason:string, estUsd:number, estSavingUsd:number}}
 *   estUsd = expected cost on the batch path, estSavingUsd = saving vs the normal path.
 */
function decide(job = {}, ctx = {}) {
  try {
    if (!featureAllowed('batch', ctx.featureOpts || {})) return no('R1 feature "batch" is not available on this channel');
    const penv = ctx.env || process.env;
    const home = ctx.home;
    const now = ctx.now || Date.now();
    const model = job.model || safe.DEFAULT_MODEL;
    // Priced per request: size tiers (Haiku >100k) apply to one prompt, never to the job's total.
    const n = job.requests > 0 ? job.requests : 1;
    const normal = n * safe.costOf(model, { input_tokens: (job.estInputTokens || 0) / n, output_tokens: (job.estOutputTokens || 0) / n });
    const est = { estUsd: Math.round(normal / 2 * 100) / 100, estSavingUsd: Math.round(normal / 2 * 100) / 100 };

    const cwd = job.cwd || process.cwd();
    if (penv.DEVOPS_DISABLE_CLAUDE_API === '1' || !safe.loadSwitches({ cwd, home }).enabled) return no('R2 apiCredit.enabled is off', est);
    if (!safe.resolveKey({ env: penv, home })) return no('R2 no API key stored', est);
    const until = safe.activeLimit({ home, now });
    if (until) return no(`R2 API credit limit active until ${until}`, est);
    const remaining = remainingBudget(job, penv, { home, now });
    if (remaining !== null && remaining < est.estUsd) return no(`R2 month budget left $${remaining.toFixed(2)} < estimated $${est.estUsd.toFixed(2)}`, est);
    if (job.maxUsd > 0 && est.estUsd > job.maxUsd) return no(`R2 estimated $${est.estUsd.toFixed(2)} > per-run cap $${job.maxUsd.toFixed(2)}`, est);

    if (job.unattended !== true) return no('R3 interactive caller - batches are for unattended jobs only', est);

    if (!(job.requests >= MIN_REQUESTS)) return no(`R4 only ${job.requests || 0} requests (< ${MIN_REQUESTS})`, est);
    if (!(est.estSavingUsd >= MIN_SAVING_USD)) return no(`R4 estimated saving $${est.estSavingUsd.toFixed(2)} < $${MIN_SAVING_USD}`, est);

    const deadline = job.deadlineMs === undefined ? DEFAULT_DEADLINE_MS : job.deadlineMs;
    if (!(deadline >= MIN_DEADLINE_MS)) return no(`R5 deadline ${Math.round(deadline / 60000)} min < ${MIN_DEADLINE_MS / 60000} min`, est);

    return { useBatch: true, reason: 'all rules hold', ...est };
  } catch (e) {
    return no(`policy error (${e && e.message}) - normal path`);
  }
}

function parseArgs(argv) {
  const o = { requests: 0, estInputTokens: 0, estOutputTokens: 0, unattended: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--requests') o.requests = Number(argv[++i]);
    else if (a === '--est-input-tokens') o.estInputTokens = Number(argv[++i]);
    else if (a === '--est-output-tokens') o.estOutputTokens = Number(argv[++i]);
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--unattended') o.unattended = true;
    else if (a === '--deadline-min') o.deadlineMs = Number(argv[++i]) * 60000;
    else if (a === '--max-usd') o.maxUsd = Number(argv[++i]);
  }
  return o;
}

function main(argv, { out = (s) => process.stdout.write(s), ctx = {} } = {}) {
  if (!featureAllowed('batch', ctx.featureOpts || {})) return 126;
  const d = decide(parseArgs(argv), ctx);
  out(JSON.stringify(d) + '\n');
  return d.useBatch ? 0 : 3;
}

module.exports = { decide, parseArgs, main, MIN_REQUESTS, MIN_SAVING_USD, MIN_DEADLINE_MS, DEFAULT_DEADLINE_MS };

if (require.main === module) {
  if (!featureAllowed('batch')) process.exit(126);
  process.exitCode = main(process.argv.slice(2));
}
