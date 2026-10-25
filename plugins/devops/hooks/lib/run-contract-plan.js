'use strict';
/**
 * @module run-contract-plan
 * @version 0.1.0
 * @plugin devops
 * @description Frustrated Mode (alpha): the plan record and the approval
 *   recorder that sit beside the run contract. A plan record names ONE plan
 *   (`id`, `version`, content `hash`) produced by a frustrated analysis; an
 *   approval is recorded against that exact id + hash. Nothing executes
 *   without a recorded approval ("Nur Analyse" is the default: a pending
 *   record is inert). The record has its own 2 h expiry (d16), independent of
 *   the contract's. The plan path never arms a ship step (d9): a plan with a
 *   ship step is rejected unless it comes from a concept close-out.
 *
 *   File: `<project>/.claude/run-contract.plan.json`. Every acting entry
 *   checks the `frustrated-mode` feature first (opts.featureOpts, tests inject
 *   the channel) and returns `{ok:false, disabled:true}` otherwise.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { featureAllowed } = require('./features');
const { projectClaudeDir } = require('./project-root');

const FEATURE = 'frustrated-mode';
const FILE = 'run-contract.plan.json';
const PLAN_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PLAN_BYTES = 16 * 1024;
const STEP_TYPES = Object.freeze(['implement', 'concept', 'learn', 'webguide']);
const SHIP_RE = /^(ship|release|merge|push|deploy)$/i;

const DISABLED = Object.freeze({ ok: false, disabled: true, error: 'not available' });
const planAllowed = (opts) => featureAllowed(FEATURE, (opts && opts.featureOpts) || {});
const planPath = (cwd) => path.join(projectClaudeDir(cwd), FILE);
const nowOf = (opts) => (opts && typeof opts.now === 'number' ? opts.now : Date.now());

function readPlan(cwd) {
  try {
    const p = JSON.parse(fs.readFileSync(planPath(cwd), 'utf8'));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch { return null; }
}

function writePlan(cwd, rec) {
  const file = planPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file);
}

/** Canonical form: keys sorted, strings NFC + whitespace-collapsed. */
function canon(v) {
  if (typeof v === 'string') return v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  }
  return v;
}

function contentOf(plan) {
  const out = { ...plan };
  delete out.id;
  delete out.version;
  return out;
}

/** The hash covers the plan content only — never id, version or timestamps. */
function hashPlan(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(canon(contentOf(plan)))).digest('hex');
}

function newPlanId(now) {
  const d = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
  return `fm-${d}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
}

function shipStep(step) {
  return !!step && (SHIP_RE.test(String(step.type || '')) || step.ship === true || (!!step.payload && step.payload.ship === true));
}

/** Expired records are removed on read; null = no usable record. */
function liveRecord(cwd, now) {
  const rec = readPlan(cwd);
  if (!rec) return null;
  const t = Date.parse(rec.expiresAt);
  if (!Number.isFinite(t) || now >= t) {
    try { fs.unlinkSync(planPath(cwd)); } catch { /* gone */ }
    return null;
  }
  return rec;
}

const view = (r) => ({
  id: r.id, version: r.version, hash: r.hash, short: r.short, state: r.state,
  recordedAt: r.recordedAt, approvedAt: r.approvedAt || null, expiresAt: r.expiresAt,
  fromConceptCloseout: !!r.fromConceptCloseout,
});
const summary = (c) => ({ id: c.id, mode: c.mode, flow: c.flow, armedAt: c.armedAt });

/**
 * Record a pending plan. `plan` = {direction, steps[], out_of_scope?, decisions?, checks?, base?}.
 * A re-record with the same id and new content bumps `version` and drops any approval.
 */
function recordPlan(cwd, plan, o = {}, opts = {}) {
  if (!planAllowed(opts)) return DISABLED;
  const now = nowOf(opts);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, error: 'plan must be a JSON object' };
  if (!Array.isArray(plan.steps) || !plan.steps.length) return { ok: false, error: 'plan needs a non-empty steps[]' };
  const fromConceptCloseout = o.fromConceptCloseout === true;
  for (const s of plan.steps) {
    if (shipStep(s)) {
      if (!fromConceptCloseout) return { ok: false, error: 'a plan with a ship step is rejected — shipping is never part of a frustrated hand-off (only a concept close-out may add it: --from-concept-closeout)' };
    } else if (!s || !STEP_TYPES.includes(s.type)) {
      return { ok: false, error: `step type must be one of ${STEP_TYPES.join('|')}` };
    }
  }
  const content = canon(contentOf(plan));
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_PLAN_BYTES) return { ok: false, error: 'plan exceeds 16 KB — cut it into steps or name an out_of_scope' };
  const hash = hashPlan(plan);
  const prev = liveRecord(cwd, now);
  const id = String(o.id || plan.id || (prev && prev.id) || newPlanId(now));
  const same = !!prev && prev.id === id;
  const unchanged = same && prev.hash === hash;
  const rec = {
    v: 1, id, version: same ? (unchanged ? prev.version : prev.version + 1) : 1,
    hash, short: hash.slice(0, 8), plan: content, fromConceptCloseout,
    state: unchanged && prev.state === 'approved' ? 'approved' : 'pending',
    recordedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
    ...(unchanged && prev.approvedAt ? { approvedAt: prev.approvedAt } : {}),
  };
  try { writePlan(cwd, rec); } catch (e) { return { ok: false, error: `could not write the plan record: ${e.message}` }; }
  return { ok: true, recorded: true, plan: view(rec), display: `${rec.id} v${rec.version} · ${rec.short}` };
}

/**
 * Record the approval of one specific plan. `live` = the contract this
 * approval replaces (or null); `replaceFn(reason)` closes it (d8). Refuses a
 * wrong id/hash, a missing or expired record, a ship plan outside a close-out.
 */
function approvePlan(cwd, sel, { live = null, replaceFn = null } = {}, opts = {}) {
  if (!planAllowed(opts)) return DISABLED;
  const now = nowOf(opts);
  const rec = liveRecord(cwd, now);
  if (!rec) return { ok: false, approved: false, error: 'no pending plan (none recorded, or it expired after 2 h) — approval is void, nothing executes' };
  if (!sel || !sel.id || typeof sel.hash !== 'string') return { ok: false, approved: false, error: 'approve needs --id <plan id> --hash <hash or 8-char short>' };
  const h = sel.hash.toLowerCase();
  if (sel.id !== rec.id || h.length < 8 || !rec.hash.startsWith(h)) {
    return { ok: false, approved: false, error: `plan changed — recorded is ${rec.id} v${rec.version} · ${rec.short}, not ${sel.id} · ${h.slice(0, 8)}; re-ask for approval of the current plan`, plan: view(rec) };
  }
  if (hashPlan(rec.plan) !== rec.hash) return { ok: false, approved: false, error: 'plan record was altered after recording' };
  if (rec.plan.steps.some(shipStep) && !rec.fromConceptCloseout) return { ok: false, approved: false, error: 'ship step without a concept close-out' };
  let replaced = null;
  if (live) {
    replaced = summary(live);
    if (replaceFn) replaceFn(`replaced by approved plan ${rec.id} v${rec.version}`);
  }
  const next = { ...rec, state: 'approved', approvedAt: new Date(now).toISOString(), expiresAt: new Date(now + PLAN_TTL_MS).toISOString() };
  try { writePlan(cwd, next); } catch (e) { return { ok: false, approved: false, error: `could not write the approval: ${e.message}` }; }
  return { ok: true, approved: true, plan: view(next), replaced };
}

function statusPlan(cwd, { live = null } = {}, opts = {}) {
  if (!planAllowed(opts)) return DISABLED;
  const rec = liveRecord(cwd, nowOf(opts));
  const wouldReplace = live ? summary(live) : null;
  return rec
    ? { ok: true, active: true, plan: view(rec), steps: rec.plan.steps.length, wouldReplace }
    : { ok: true, active: false, plan: null, wouldReplace };
}

function clearPlan(cwd, opts = {}) {
  if (!planAllowed(opts)) return DISABLED;
  const had = !!readPlan(cwd);
  try { fs.unlinkSync(planPath(cwd)); } catch { /* already gone */ }
  return { ok: true, cleared: had };
}

module.exports = {
  FEATURE, FILE, PLAN_TTL_MS, MAX_PLAN_BYTES, STEP_TYPES,
  planAllowed, planPath, hashPlan, recordPlan, approvePlan, statusPlan, clearPlan,
};
