#!/usr/bin/env node
'use strict';
/**
 * @script claude-api-batch
 * @version 0.1.0
 * @plugin devops
 * @description Message Batches API client (-50 % on input and output) for
 *   large unattended one-shot jobs. Never blocks: runBatch() cancels at the
 *   deadline and hands every request it did not finish back to the caller,
 *   which runs them on the normal path. Any error means "all unfinished",
 *   never a throw. Alpha channel only (feature flag "batch").
 *   Docs: deep-knowledge/api-batch.md. Whether a job qualifies: batch-policy.js.
 *
 * Usage: claude-api-batch.js <requests.json> [--deadline-min 120]
 *   requests.json = [{ "custom_id": "...", "params": { model, max_tokens, messages, ... } }]
 *   Prints { done, unfinished } as JSON.
 * Exit codes: 0 = ran (inspect `unfinished`), 126 = feature off or apiCredit off, 127 = no key.
 */

const fs = require('fs');
const { featureAllowed } = require('../hooks/lib/features');
const safe = require('./claude-api-safe');

const BASE_URL = 'https://api.anthropic.com/v1/messages/batches';
const DEFAULT_DEADLINE_MS = 2 * 60 * 60 * 1000;
const FIRST_POLL_MS = 30 * 1000;
const MAX_POLL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60 * 1000;
// After a cancel the batch sits in `canceling` until the in-flight requests
// finish (they are billed either way). Wait up to this long for `ended` so
// their results are salvaged instead of paid a second time on the normal path.
const CANCEL_DRAIN_MS = 10 * 60 * 1000;
const CANCEL_FIRST_POLL_MS = 10 * 1000;
const RESULTS_HOST = 'api.anthropic.com';

/** results_url from the API, or null when it does not point at the API host (the key goes with the request). */
function trustedResultsUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' && url.hostname === RESULTS_HOST ? url.href : null;
  } catch {
    return null;
  }
}

const allowed = (o = {}) => featureAllowed('batch', o.featureOpts || {});

async function call(method, url, { key, body, fetchImpl = globalThis.fetch, text = false }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch { /* non-JSON */ }
      return { ok: false, status: res.status, message: msg };
    }
    return { ok: true, data: text ? await res.text() : await res.json() };
  } catch (e) {
    return { ok: false, status: 0, message: e && e.message ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<{ok:boolean, id?:string, message?:string}>} */
async function submit(requests, opts = {}) {
  if (!allowed(opts)) return { ok: false, message: 'batch feature off' };
  const r = await call('POST', BASE_URL, { ...opts, body: { requests } });
  if (!r.ok) return { ok: false, status: r.status, message: r.message };
  return r.data && r.data.id ? { ok: true, id: r.data.id } : { ok: false, message: 'no batch id in response' };
}

/** @returns {Promise<{ok:boolean, ended?:boolean, resultsUrl?:string, status?:string, message?:string}>} */
async function poll(id, opts = {}) {
  if (!allowed(opts)) return { ok: false, message: 'batch feature off' };
  const r = await call('GET', `${BASE_URL}/${encodeURIComponent(id)}`, opts);
  if (!r.ok) return { ok: false, status: r.status, message: r.message };
  const d = r.data || {};
  return { ok: true, ended: d.processing_status === 'ended', status: d.processing_status, resultsUrl: d.results_url || null, counts: d.request_counts };
}

/** Parses the results JSONL. @returns {Promise<{ok:boolean, done?:object[], failed?:string[], message?:string}>} */
async function collect(id, resultsUrl, opts = {}) {
  if (!allowed(opts)) return { ok: false, message: 'batch feature off' };
  const r = await call('GET', trustedResultsUrl(resultsUrl) || `${BASE_URL}/${encodeURIComponent(id)}/results`, { ...opts, text: true });
  if (!r.ok) return { ok: false, status: r.status, message: r.message };
  const done = [];
  const failed = [];
  for (const line of String(r.data).split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.result && row.result.type === 'succeeded' && row.result.message) {
      const m = row.result.message;
      done.push({ custom_id: row.custom_id, text: safe.textOf(m), usage: m.usage || {}, model: m.model });
    } else if (row.custom_id) failed.push(row.custom_id);
  }
  return { ok: true, done, failed };
}

async function cancel(id, opts = {}) {
  if (!allowed(opts)) return { ok: false, message: 'batch feature off' };
  const r = await call('POST', `${BASE_URL}/${encodeURIComponent(id)}/cancel`, opts);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}

/**
 * Submit, poll with backoff, collect. At the deadline (or after 5 failed
 * polls): cancel, wait up to `cancelDrainMs` (default 10 min) for `ended`,
 * salvage every request that has a result, return the rest as unfinished.
 * Never throws.
 * @param {{custom_id:string, params:object}[]} requests
 * @param {{deadlineMs?:number, key?:string, env?:object, home?:string, cwd?:string, model?:string, fetchImpl?:Function,
 *          sleep?:Function, now?:Function, firstPollMs?:number, cancelDrainMs?:number, featureOpts?:object}} opts
 * @returns {Promise<{done:object[], unfinished:string[], reason?:string}>}
 */
async function runBatch(requests, opts = {}) {
  const ids = (requests || []).map((r) => r.custom_id);
  const allUnfinished = (reason) => ({ done: [], unfinished: ids, reason });
  try {
    if (!allowed(opts)) return allUnfinished('batch feature off');
    if (!ids.length) return { done: [], unfinished: [] };
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now || Date.now;
    const key = opts.key || (safe.resolveKey({ env: opts.env || process.env, home: opts.home }) || {}).key;
    if (!key) return allUnfinished('no API key');
    const call0 = { key, fetchImpl: opts.fetchImpl, featureOpts: opts.featureOpts };
    const deadline = now() + (opts.deadlineMs > 0 ? opts.deadlineMs : DEFAULT_DEADLINE_MS);

    const sub = await submit(requests, call0);
    if (!sub.ok) {
      if (sub.status === 402 || safe_limit(sub.message)) safe.storeLimit({ home: opts.home, reason: sub.message });
      return allUnfinished(`submit failed: ${sub.message}`);
    }

    let wait = opts.firstPollMs || FIRST_POLL_MS;
    let resultsUrl = null;
    let ended = false;
    let timedOut = false;
    let failures = 0;
    for (;;) {
      const left = deadline - now();
      if (left <= 0) { timedOut = true; break; }
      await sleep(Math.min(wait, left));
      const p = await poll(sub.id, call0);
      if (p.ok) {
        failures = 0;
        if (p.ended) { ended = true; resultsUrl = p.resultsUrl; break; }
      } else if (++failures >= 5) {
        await cancel(sub.id, call0);
        const salvaged = await drainCanceled(sub.id, call0, { sleep, now, drainMs: opts.cancelDrainMs });
        return finish(requests, salvaged, opts, `poll failed: ${p.message}`);
      }
      wait = Math.min(Math.round(wait * 1.5), MAX_POLL_MS);
    }

    if (timedOut) {
      await cancel(sub.id, call0);
      const salvaged = await drainCanceled(sub.id, call0, { sleep, now, drainMs: opts.cancelDrainMs });
      return finish(requests, salvaged, opts, 'deadline reached - batch canceled');
    }
    const res = await collect(sub.id, resultsUrl, call0);
    if (!res.ok) return finish(requests, [], opts, `collect failed: ${res.message}`);
    return finish(requests, res.done, opts, ended ? 'ended' : '');
  } catch (e) {
    return allUnfinished(`unexpected error: ${e && e.message}`);
  }
}

function safe_limit(msg) {
  return /credit balance is too low|usage limits|spend limit/i.test(String(msg || ''));
}

/**
 * After a cancel: poll (bounded, with backoff) until the batch reports `ended`,
 * then collect what finished. Every request with a result is salvaged — it was
 * billed and must never run again on the normal path. Returns [] when the
 * batch does not end within `drainMs` or a call fails. Never throws.
 */
async function drainCanceled(id, call0, { sleep, now, drainMs } = {}) {
  try {
    const until = now() + (drainMs > 0 ? drainMs : CANCEL_DRAIN_MS);
    let wait = CANCEL_FIRST_POLL_MS;
    for (;;) {
      const p = await poll(id, call0);
      if (p.ok && p.ended) {
        const res = await collect(id, p.resultsUrl, call0);
        return res.ok ? res.done : [];
      }
      const left = until - now();
      if (left <= 0) return [];
      await sleep(Math.min(wait, left));
      wait = Math.min(Math.round(wait * 1.5), MAX_POLL_MS);
    }
  } catch {
    return [];
  }
}

/** Logs one usage line and shapes the return value. */
function finish(requests, doneAll, opts, reason) {
  const want = new Set(requests.map((r) => r.custom_id));
  const done = doneAll.filter((d) => want.has(d.custom_id));
  const got = new Set(done.map((d) => d.custom_id));
  const unfinished = requests.map((r) => r.custom_id).filter((id) => !got.has(id));
  try {
    let usage = {};
    let normal = 0;
    let parts = {};
    // Priced per request with that request's own model: the Haiku >100k tier
    // applies per prompt, never to the summed usage of the whole batch.
    for (const d of done) {
      const m = d.model || opts.model;
      usage = safe.addUsage(usage, d.usage);
      normal += safe.costOf(m, d.usage);
      parts = safe.addParts(parts, safe.costParts(m, d.usage));
    }
    const models = [...new Set(done.map((d) => d.model || opts.model).filter(Boolean))];
    safe.logUsage({
      home: opts.home, tool: 'batch', tag: opts.tag || 'batch', cwd: opts.cwd,
      model: models.length > 1 ? 'mixed' : (models[0] || opts.model),
      usage, usd: normal, parts: done.length ? parts : null, rc: unfinished.length ? 1 : 0, batch: true,
      extra: { done: done.length, unfinished: unfinished.length },
    });
  } catch { /* logging never fails a batch */ }
  return { done, unfinished, reason };
}

module.exports = { submit, poll, collect, cancel, runBatch, trustedResultsUrl, BASE_URL, CANCEL_DRAIN_MS };

if (require.main === module) {
  (async () => {
    if (!allowed()) { process.exitCode = 126; return; }
    const argv = process.argv.slice(2);
    const file = argv.find((a) => !a.startsWith('--'));
    const di = argv.indexOf('--deadline-min');
    const cwd = process.cwd();
    if (!safe.loadSwitches({ cwd }).enabled || process.env.DEVOPS_DISABLE_CLAUDE_API === '1') { process.exitCode = 126; return; }
    if (!safe.resolveKey({ env: process.env })) { process.exitCode = 127; return; }
    let requests = [];
    try { requests = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.stderr.write('claude-api-batch: cannot read requests file\n'); process.exitCode = 1; return; }
    const r = await runBatch(requests, { deadlineMs: di > -1 ? Number(argv[di + 1]) * 60000 : undefined, cwd });
    process.stdout.write(JSON.stringify(r) + '\n');
  })();
}
