#!/usr/bin/env node
/**
 * @script burn-plan
 * @version 0.2.2
 * @plugin devops
 * @description The deterministic core of `/do-run burn`. Everything the burn
 *   mode used to ask the model to compute or remember lives here, as code
 *   with tests:
 *
 *   - `offer`         — should Q4 show "Budget verbrennen"? (projected unused budget)
 *   - `plan`          — depth profile, lanes, dynamic reserve and the uplift
 *                       gate against the queue's cost at standard depth
 *   - `init`          — derive the plan and write BURN-STATE.json (v2)
 *   - `gate`          — the per-spawn decision: spawn · wait · hold · pause ·
 *                       finish · stop (reserve, 5-hour window, unknown usage,
 *                       week reset, recalibration, size fit, file conflicts)
 *   - `state <op>`    — every conveyor transition, written atomically
 *   - `resumed`       — continue / switch off / end a burn after a limit stop
 *   - `resume-check`  — what to do with each in-flight task after a hard
 *                       stop (salvage a dirty worktree, continue the agent,
 *                       merge, requeue on its branch, requeue)
 *   - `prune-check`   — may this worktree go? (no unmerged commits AND clean)
 *   - `simulate`      — token-free dry runs of whole burns (scripts/burn-sim.js)
 *
 *   Spend figures are weekly-budget percent. Planning estimates (lane spend
 *   per hour, task cost per size) start as defaults scaled by plan and are
 *   replaced by measured medians from `~/.claude/burn-calibration.json` once a
 *   few runs have recorded samples. Usage is account-wide: other sessions'
 *   spend lands in the same numbers, which only ever makes the estimates
 *   more conservative.
 *
 * CLI (stdout: one JSON object; exit 0 unless noted):
 *   burn-plan.js offer                       [--no-refresh]
 *   burn-plan.js plan   --queue=<json|@file> [--lane-cap=N] [--reserve=N]
 *   burn-plan.js init   --queue=<json|@file> --slug=S --integration-branch=B
 *                       [--session=ID] [--resume-auto=continue|off]
 *                       [--auto-armed=yes|no] [--force]
 *   burn-plan.js gate   [--peek]
 *   burn-plan.js state  start|agent|checkpoint|land|requeue|fail|drain|pause|
 *                       finish|burn-off|resume-policy|resume-cron|integration <id?> [--k=v]
 *   (init and state integration refuse main, master, trunk and every remote's default
 *    branch under any spelling (Main, heads/main, refs/heads/main), the parent of a
 *    sub-branch session, and any branch outside a git repo — unless the session
 *    itself works on that branch)
 *   burn-plan.js resumed --trigger=manual|auto|router --choice=continue|off|end
 *   burn-plan.js resume-check [--apply] [--session=ID]
 *   burn-plan.js prune-check --branch=B [--worktree=W] [--integration=I]   (exit 1 = keep;
 *                       unknown — no branch, unreadable status, a worktree HEAD
 *                       not in I — is keep)
 *   gate, state, resumed, resume-check and init hold <state>.lock while they
 *   read-modify-write the state; --lane-cap (1–16), --reserve (0–50) and
 *   --resume-auto (continue|on|off) are validated — a bad value is an error.
 *   burn-plan.js status
 *   burn-plan.js simulate [--scenario=NAME | --all] [--text]
 *   Common: --state=<path> (default <project root>/BURN-STATE.json),
 *           --no-refresh (never start the headless usage scraper),
 *           --session=ID (default $CLAUDE_CODE_SESSION_ID — the id hooks see).
 *   Env: DEVOPS_BURN_USAGE_FILE, DEVOPS_BURN_CALIBRATION, DEVOPS_BURN_NO_REFRESH=1,
 *        DEVOPS_BURN_NOW (ISO or epoch ms — fixed clock for dry runs).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const {
  STATE_FILE, PREV_STATE_FILE, readStateFile, isOpenRun, tally,
} = require('../hooks/lib/burn-state');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_VERSION = 2;
const RESERVE_PCT = 5;            // weekly % never spent — the floor of the dynamic reserve
const LANE_CAP = 4;               // override via --lane-cap (skill extension knob)
const SESSION_RESERVE_PCT = 8;    // stop spawning at 92 % of the 5-hour window
const MIN_SPENDABLE_PCT = 10;     // below this, depth is capped at `deep`
const MIN_OFFER_PCT = 10;         // Q4 shows the option when ≥ this much would expire unused
const UPLIFT_FLOOR = 1.5;         // budget must be ≥ 1.5× the core queue's cost at standard
const USAGE_FRESH_MIN = 2;        // the gate needs a reading at most this old
const PLAN_USAGE_MAX_AGE_MIN = 10;
const HOLD_LIMIT = 3;             // consecutive unreadable usage checks → drain
const WEEK_HOURS = 168;
const MIN_ELAPSED_FOR_PACE_H = 12;
const TIME_MARGIN = 0.8;          // plan to finish within 80 % of the time left
const ADJUST_COOLDOWN_MIN = 30;
const RECAL_MIN_HOURS = 0.5;
const UNDER_BURN = 0.6;
const OVER_BURN = 1.6;
const RESUME_BUFFER_MIN = 15;     // fire resume crons this long after a window reset
const SESSION_PER_WEEKLY_DEFAULT = 10; // 5-hour-window % per weekly % until measured
const FRESH_WINDOW_PCT = 10;      // a window this empty takes any task
const BLIND_FRACTION = 0.5;       // blind mode spends at most half of what was spendable
const BLIND_SAFETY = 1.5;         // and counts every estimate 1.5×
const MAX_EVENTS = 200;
const MAX_READINGS = 50;
const CALIBRATION_KEEP = 10;
const CALIBRATION_MIN_SAMPLES = 3;

/** Relative weekly capacity per plan — Max 20x has 20× Pro's budget. */
const PLAN_CAPACITY = { Pro: 1, 'Max 5x': 5, 'Max 20x': 20 };
/** Planning defaults at Max 20x, standard depth. Scaled for other plans. */
const DEFAULTS_AT_MAX20 = { laneHourlyPct: 1.5, unitCostPct: 0.2 };
const SIZE_WEIGHT = { S: 1, M: 2.5, L: 5 };
const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
const FILLER_PRIORITIES = new Set(['P3', 'P4', 'P5']);

/**
 * Depth profiles. Effort is not a tool parameter (the Agent tool has none),
 * so what actually changes is the model, the tool-call ceiling and the extra
 * passes. The second QA and the per-task PO review of the first version are
 * gone: QA was redundant, and a PO weighs trade-offs nobody decides while
 * the user is away.
 */
const PROFILES = {
  standard: { depthFactor: 1.0, opusRoles: [], passes: [], toolCalls: '15–30' },
  deep: {
    depthFactor: 1.5,
    opusRoles: ['core', 'frontend', 'ai', 'windows', 'designer'],
    passes: ['redteam'],
    toolCalls: '30–45',
  },
  max: {
    depthFactor: 2.0,
    opusRoles: ['core', 'frontend', 'ai', 'windows', 'designer', 'qa', 'gamer'],
    passes: ['redteam'],
    toolCalls: '45–60',
  },
};
const PROFILE_ORDER = ['standard', 'deep', 'max'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const iso = (ms) => new Date(ms).toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

function median(values) {
  const v = values.filter(isPos).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function toCronExpression(fireAtMs) {
  const d = new Date(fireAtMs);
  return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
}

function localStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Normalize a usage-live.json snapshot. `resetInMinutes` is relative to the
 * snapshot's timestamp, so it is age-corrected here. A cache-served snapshot
 * (`_cached`) is never a reading: acting on it is how a blind gate spends
 * past the reserve.
 * @returns {{ok:true, weeklyUsed, weeklyRemaining, weeklyResetMin, sessionUsed, sessionResetMin, plan, ageMin} | {ok:false, reason}}
 */
function normalizeUsage(raw, nowMs, maxAgeMin = USAGE_FRESH_MIN) {
  if (!raw || typeof raw !== 'object' || !raw.weekly || !raw.session) return { ok: false, reason: 'no-data' };
  if (raw._cached) return { ok: false, reason: `cached${raw._failureReason ? `: ${raw._failureReason}` : ''}` };
  const ts = Date.parse(raw.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'no-timestamp' };
  const ageMin = (nowMs - ts) / 60000;
  if (ageMin < -1) return { ok: false, reason: 'future-dated' };
  if (ageMin > maxAgeMin) return { ok: false, reason: `stale (${Math.round(ageMin)} min)` };
  const wPct = Number(raw.weekly.pct);
  const sPct = Number(raw.session.pct);
  if (!Number.isFinite(wPct) || !Number.isFinite(sPct)) return { ok: false, reason: 'no-percent' };
  const age = Math.max(0, ageMin);
  const wReset = Number(raw.weekly.resetInMinutes);
  const sReset = Number(raw.session.resetInMinutes);
  return {
    ok: true,
    ageMin: round1(age),
    plan: typeof raw.plan === 'string' ? raw.plan : null,
    weeklyUsed: wPct,
    weeklyRemaining: Math.max(0, 100 - wPct),
    weeklyResetMin: Number.isFinite(wReset) ? Math.max(0, wReset - age) : null,
    sessionUsed: sPct,
    sessionResetMin: Number.isFinite(sReset) ? Math.max(0, sReset - age) : null,
  };
}

// ---------------------------------------------------------------------------
// Estimates and calibration
// ---------------------------------------------------------------------------

function planScale(plan) {
  const cap = PLAN_CAPACITY[plan] || PLAN_CAPACITY['Max 5x'];
  return PLAN_CAPACITY['Max 20x'] / cap;
}

/**
 * Planning estimates for a plan: measured medians when at least
 * CALIBRATION_MIN_SAMPLES runs recorded them, else defaults scaled by plan.
 */
function calibrationFor(calibration, plan) {
  const scale = planScale(plan);
  const entry = (calibration && plan && calibration[plan]) || {};
  const lane = Array.isArray(entry.laneHourlyPct) ? entry.laneHourlyPct.filter(isPos).slice(-CALIBRATION_KEEP) : [];
  const unit = Array.isArray(entry.unitCostPct) ? entry.unitCostPct.filter(isPos).slice(-CALIBRATION_KEEP) : [];
  const laneMeasured = lane.length >= CALIBRATION_MIN_SAMPLES;
  const unitMeasured = unit.length >= CALIBRATION_MIN_SAMPLES;
  return {
    plan: plan || null,
    laneHourlyPct: laneMeasured ? median(lane) : DEFAULTS_AT_MAX20.laneHourlyPct * scale,
    unitCostPct: unitMeasured ? median(unit) : DEFAULTS_AT_MAX20.unitCostPct * scale,
    source: {
      laneHourly: laneMeasured ? `measured (${lane.length})` : 'default',
      unitCost: unitMeasured ? `measured (${unit.length})` : 'default',
    },
  };
}

function isFiller(task) {
  return FILLER_PRIORITIES.has(task.priority) || task.source === 'discovery';
}

/** Mechanical and filler tasks never run deeper than standard. */
function taskProfile(task, runProfile) {
  return task.mechanical || isFiller(task) ? 'standard' : runProfile;
}

function taskCost(size, profile, cal) {
  return cal.unitCostPct * (SIZE_WEIGHT[size] || SIZE_WEIGHT.M) * PROFILES[profile].depthFactor;
}

function queueCost(tasks, runProfile, cal) {
  return tasks.reduce((sum, t) => sum + taskCost(t.size, taskProfile(t, runProfile), cal), 0);
}

function laneHourly(profile, cal) {
  return cal.laneHourlyPct * PROFILES[profile].depthFactor;
}

/**
 * The reserve must cover what the lanes still spend after the drain starts:
 * every lane may be one L task deep at the run's profile. A fixed 5 % is
 * overrun by four max lanes finishing at once.
 */
function dynamicReserve(basePct, lanes, profile, cal) {
  return Math.max(basePct, lanes * taskCost('L', profile, cal));
}

function modelOverrides(profile) {
  const out = {};
  for (const role of PROFILES[profile].opusRoles) out[role] = 'opus';
  return out;
}

function sortQueue(queue) {
  const rank = (p) => {
    const i = PRIORITY_ORDER.indexOf(p);
    return i === -1 ? PRIORITY_ORDER.length : i;
  };
  return queue
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t.priority) - rank(b.t.priority) || a.i - b.i)
    .map(({ t }) => t);
}

function normalizeTask(t, i) {
  if (!t || typeof t !== 'object') throw new Error(`queue item ${i} is not an object`);
  const size = ['S', 'M', 'L'].includes(t.size) ? t.size : 'M';
  const priority = PRIORITY_ORDER.includes(t.priority) ? t.priority : 'P2';
  return {
    id: String(t.id || `t${i + 1}`),
    task: String(t.task || t.title || ''),
    size,
    priority,
    mechanical: !!t.mechanical,
    source: t.source || (priority === 'P0' ? 'prompt' : 'issue'),
    files: Array.isArray(t.files) ? t.files.map(String) : [],
    ...(t.branch ? { branch: String(t.branch) } : {}),
  };
}

// ---------------------------------------------------------------------------
// offer — should Q4 show "Budget verbrennen"?
// ---------------------------------------------------------------------------

/**
 * The option is worth showing when, at the user's own pace this week, a
 * meaningful slice of the budget would expire unused. The first version
 * showed it only above 80 % used — exactly where little is left and a normal
 * run uses it anyway.
 */
function offer(usage) {
  if (!usage || !usage.ok) return { offer: false, reason: 'usage-unknown' };
  if (usage.weeklyResetMin == null) return { offer: false, reason: 'no-reset-time' };
  const hoursLeft = usage.weeklyResetMin / 60;
  if (hoursLeft < 1) return { offer: false, reason: 'reset-imminent', hoursUntilReset: round1(hoursLeft) };
  const elapsed = Math.max(MIN_ELAPSED_FOR_PACE_H, WEEK_HOURS - hoursLeft);
  const pace = usage.weeklyUsed / elapsed;
  const projectedSpend = pace * hoursLeft;
  const projectedUnused = Math.max(0, usage.weeklyRemaining - projectedSpend);
  const burnable = projectedUnused - RESERVE_PCT;
  const ok = burnable >= MIN_OFFER_PCT;
  return {
    offer: ok,
    reason: ok ? 'unused-budget' : 'on-pace',
    remainingPct: round1(usage.weeklyRemaining),
    hoursUntilReset: round1(hoursLeft),
    pacePctPerHour: round2(pace),
    projectedUnusedPct: round1(projectedUnused),
    burnablePct: round1(Math.max(0, burnable)),
  };
}

// ---------------------------------------------------------------------------
// plan — depth first, breadth only to fill
// ---------------------------------------------------------------------------

/**
 * Derive the burn plan.
 *
 * 1. Profile: `max`, capped at `deep` when little is spendable, and lowered to
 *    `deep` when the core queue fits the budget at deep but not at max —
 *    finishing the user's tasks beats half of them at maximum depth.
 * 2. Lanes: only as many as it takes to spend the affordable part of the
 *    queue within 80 % of the time left; clamped to the lane cap.
 * 3. Reserve: max(base, lanes × one L task at the profile).
 * 4. Uplift gate: spendable budget ÷ the core queue's cost at standard depth.
 *    Below 1.5 a normal run spends the budget anyway — burn adds nothing.
 */
function derivePlan({ usage, queue, calibration, plan, laneCap = LANE_CAP, reservePct = RESERVE_PCT }) {
  if (!usage || !usage.ok) return { ok: false, reason: 'usage-unknown', detail: usage && usage.reason };
  if (usage.weeklyResetMin == null) return { ok: false, reason: 'no-reset-time' };
  const tasks = (queue || []).map(normalizeTask);
  if (!tasks.length) return { ok: false, reason: 'empty-queue' };
  const hours = usage.weeklyResetMin / 60;
  if (hours < 0.5) return { ok: false, reason: 'reset-imminent', hoursUntilReset: round1(hours) };

  const cal = calibrationFor(calibration, plan || usage.plan);
  const remaining = usage.weeklyRemaining;
  const core = tasks.filter((t) => !isFiller(t));
  const costStandardCore = queueCost(core, 'standard', cal);

  const spendable0 = remaining - reservePct;
  let profile = spendable0 < MIN_SPENDABLE_PCT ? 'deep' : 'max';
  if (profile === 'max' && queueCost(core, 'max', cal) > spendable0 && queueCost(core, 'deep', cal) <= spendable0) {
    profile = 'deep';
  }

  const hoursAvail = hours * TIME_MARGIN;
  let lanes = 1;
  let reserve = reservePct;
  for (let i = 0; i < 3; i++) {
    reserve = dynamicReserve(reservePct, lanes, profile, cal);
    const spendable = remaining - reserve;
    const affordable = Math.max(0, Math.min(queueCost(tasks, profile, cal), spendable));
    const laneHours = affordable / laneHourly(profile, cal);
    lanes = clamp(Math.ceil(laneHours / hoursAvail) || 1, 1, laneCap);
  }
  reserve = dynamicReserve(reservePct, lanes, profile, cal);
  const spendable = remaining - reserve;
  if (spendable <= 0) {
    return { ok: false, reason: 'no-budget', remainingPct: round1(remaining), reservePct: round1(reserve) };
  }

  const costProfile = queueCost(tasks, profile, cal);
  const affordable = Math.max(0, Math.min(costProfile, spendable));
  const uplift = costStandardCore > 0 ? spendable / costStandardCore : Infinity;
  if (uplift < UPLIFT_FLOOR) {
    return {
      ok: false,
      reason: 'no-uplift',
      uplift: round2(uplift),
      costStandardCorePct: round2(costStandardCore),
      spendablePct: round1(spendable),
    };
  }

  const capacityPct = lanes * laneHourly(profile, cal) * hoursAvail;
  return {
    ok: true,
    profile,
    lanes,
    laneCap,
    reservePct: round1(reserve),
    baseReservePct: reservePct,
    remainingPct: round1(remaining),
    spendablePct: round1(spendable),
    hoursUntilReset: round1(hours),
    requiredPerHour: round2(affordable / hoursAvail),
    uplift: Number.isFinite(uplift) ? round2(uplift) : null,
    costStandardCorePct: round2(costStandardCore),
    costProfilePct: round2(costProfile),
    affordablePct: round2(affordable),
    gapPct: round1(Math.max(0, affordable - capacityPct)),
    leftoverPct: round1(Math.max(0, spendable - costProfile)),
    planName: cal.plan,
    estimates: {
      laneHourlyPct: round2(cal.laneHourlyPct),
      unitCostPct: round2(cal.unitCostPct),
      source: cal.source,
    },
    tasks: tasks.length,
    coreTasks: core.length,
  };
}

// ---------------------------------------------------------------------------
// State — pure transitions (each returns a new state)
// ---------------------------------------------------------------------------

function pushEvent(s, nowMs, type, data = {}) {
  s.events = Array.isArray(s.events) ? s.events : [];
  s.events.push({ at: iso(nowMs), type, ...data });
  if (s.events.length > MAX_EVENTS) s.events = s.events.slice(-MAX_EVENTS);
  s.heartbeatAt = iso(nowMs);
}

function newState({ slug, integrationBranch, plan, queue, usage, nowMs, sessionId, resumeAuto = 'continue', autoArmed = false }) {
  if (!plan || !plan.ok) throw new Error(`plan not ok: ${plan && plan.reason}`);
  if (!slug || !integrationBranch) throw new Error('slug and integrationBranch are required');
  const s = {
    version: STATE_VERSION,
    slug,
    integrationBranch,
    status: 'running',
    burn: { active: true },
    profile: plan.profile,
    lanes: plan.lanes,
    laneCap: plan.laneCap,
    reservePct: plan.baseReservePct,
    plan: {
      requiredPerHour: plan.requiredPerHour,
      uplift: plan.uplift,
      reservePct: plan.reservePct,
      remainingAtStart: usage.weeklyRemaining,
      startedAt: iso(nowMs),
      planName: plan.planName,
      estimates: plan.estimates,
    },
    weekResetAt: usage.weeklyResetMin != null ? iso(nowMs + usage.weeklyResetMin * 60000) : null,
    sessionId: sessionId || null,
    resume: { auto: parseResumeAuto(resumeAuto), autoArmed: !!autoArmed, cronFor: null },
    budgetAt: {
      remainingPct: usage.weeklyRemaining,
      sessionPct: usage.sessionUsed,
      checkedAt: iso(nowMs),
      ...(usage.sessionResetMin != null ? { sessionResetAt: iso(nowMs + usage.sessionResetMin * 60000) } : {}),
    },
    readings: [],
    holds: 0,
    lastAdjustAt: null,
    queue: sortQueue((queue || []).map(normalizeTask)),
    inFlight: [],
    done: [],
    failed: [],
    skipped: [],
    drained: false,
    drainReason: null,
    lastResume: null,
    events: [],
  };
  pushEvent(s, nowMs, 'init', { profile: s.profile, lanes: s.lanes, reservePct: plan.reservePct });
  return s;
}

function findIndex(list, id) {
  return list.findIndex((t) => t.id === id);
}

function enterDrain(s, reason, nowMs) {
  if (s.drained) return s;
  s.drained = true;
  s.drainReason = reason;
  if (s.status === 'running' || s.status === 'paused') s.status = 'draining';
  pushEvent(s, nowMs, 'drain', { reason });
  return s;
}

/** Claim a queue item for a lane: it moves to inFlight before the spawn. */
function claimTask(state, id, nowMs, info = {}) {
  const s = clone(state);
  const i = findIndex(s.queue, id);
  if (i === -1) throw new Error(`task ${id} is not queued`);
  const [task] = s.queue.splice(i, 1);
  s.inFlight.push({
    ...task,
    profile: info.profile || taskProfile(task, s.burn && s.burn.active ? s.profile : 'standard'),
    claimedAt: iso(nowMs),
    startRemainingPct: s.budgetAt ? s.budgetAt.remainingPct : null,
    agent: info.agent || null,
    agentId: info.agentId || null,
    sessionId: info.sessionId || s.sessionId || null,
    branch: info.branch || task.branch || null,
    worktree: info.worktree || null,
    checkpoints: 0,
  });
  pushEvent(s, nowMs, 'claim', { id });
  return s;
}

function updateInFlight(state, id, patch, nowMs, eventType) {
  const s = clone(state);
  const i = findIndex(s.inFlight, id);
  if (i === -1) throw new Error(`task ${id} is not in flight`);
  s.inFlight[i] = { ...s.inFlight[i], ...patch };
  pushEvent(s, nowMs, eventType, { id, ...patch });
  return s;
}

function landTask(state, id, { sha, pushed = true }, nowMs) {
  const s = clone(state);
  const i = findIndex(s.inFlight, id);
  if (i === -1) throw new Error(`task ${id} is not in flight`);
  const [task] = s.inFlight.splice(i, 1);
  s.done.push({ ...task, sha: sha || null, pushed: pushed !== false, landedAt: iso(nowMs) });
  pushEvent(s, nowMs, 'land', { id, sha: sha || null });
  return s;
}

function requeueTask(state, id, { branch, note, salvage, excluded } = {}, nowMs) {
  const s = clone(state);
  const i = findIndex(s.inFlight, id);
  if (i === -1) throw new Error(`task ${id} is not in flight`);
  const [task] = s.inFlight.splice(i, 1);
  const back = {
    id: task.id, task: task.task, size: task.size, priority: task.priority,
    mechanical: task.mechanical, source: task.source, files: task.files || [],
    ...(branch || task.branch ? { branch: branch || task.branch } : {}),
    ...(note ? { note } : {}),
    ...(salvage ? { salvage } : {}),
    // Paths the salvage refused as secret-shaped: the requeued task starts
    // without them, so it needs to know rather than find out silently.
    ...(excluded && excluded.length ? { excluded } : {}),
    requeues: (task.requeues || 0) + 1,
  };
  s.queue.unshift(back);
  s.queue = sortQueue(s.queue);
  pushEvent(s, nowMs, 'requeue', { id, branch: back.branch || null, salvage: salvage || null, excluded: back.excluded || null });
  return s;
}

function failTask(state, id, { reason } = {}, nowMs) {
  const s = clone(state);
  const i = findIndex(s.inFlight, id);
  if (i === -1) throw new Error(`task ${id} is not in flight`);
  const [task] = s.inFlight.splice(i, 1);
  s.failed.push({ ...task, reason: reason || null, failedAt: iso(nowMs) });
  pushEvent(s, nowMs, 'fail', { id, reason: reason || null });
  return s;
}

function pauseState(state, { reason, resumeAtMs }, nowMs) {
  const s = clone(state);
  s.status = 'paused';
  s.pause = { reason: reason || 'window', since: iso(nowMs), resumeAt: resumeAtMs ? iso(resumeAtMs) : null };
  pushEvent(s, nowMs, 'pause', s.pause);
  return s;
}

/**
 * Switch the burn off and keep the run: the open core tasks finish at
 * standard depth on one lane; filler (P3–P5, discovery) is dropped — it only
 * existed to spend budget.
 */
function burnOff(state, reason, nowMs) {
  const s = clone(state);
  s.burn = { active: false, offReason: reason || 'user', offAt: iso(nowMs) };
  s.profile = 'standard';
  s.lanes = 1;
  const keep = [];
  for (const t of s.queue) (isFiller(t) ? s.skipped : keep).push(isFiller(t) ? { ...t, skippedReason: 'burn-off' } : t);
  s.queue = keep;
  pushEvent(s, nowMs, 'burn-off', { reason: reason || 'user', skipped: s.skipped.length });
  return s;
}

function finishState(state, status, nowMs) {
  const s = clone(state);
  s.status = 'finished';
  s.result = status || 'COMPLETED';
  s.finishedAt = iso(nowMs);
  pushEvent(s, nowMs, 'finish', { result: s.result });
  return s;
}

/**
 * The F7 answer. `continue` / `on` → continue, `off` → off, absent → the
 * default `continue`; anything else is an error — a typo must not silently
 * arm an automatic burn the user switched off.
 */
function parseResumeAuto(value) {
  if (value === undefined || value === null) return 'continue';
  const v = String(value).trim().toLowerCase();
  if (v === 'continue' || v === 'on') return 'continue';
  if (v === 'off') return 'off';
  throw new Error(`resume policy must be continue|on|off, got "${value}"`);
}

function parseYesNo(name, value) {
  if (value === undefined) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === 'yes') return true;
  if (v === 'no') return false;
  throw new Error(`--${name} must be yes|no, got "${value}"`);
}

/** A numeric CLI knob: absent → fallback; present → a number in range, else an error. */
function parseNumberOpt(name, value, fallback, { min, max, integer = false }) {
  if (value === undefined) return fallback;
  const n = value === true ? NaN : Number(String(value).trim() === '' ? NaN : value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new Error(`--${name} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}, got "${value}"`);
  }
  return n;
}

function setResumePolicy(state, { auto, autoArmed }, nowMs) {
  const s = clone(state);
  s.resume = { ...(s.resume || {}) };
  if (auto !== undefined) s.resume.auto = parseResumeAuto(auto);
  if (autoArmed !== undefined) s.resume.autoArmed = !!autoArmed;
  pushEvent(s, nowMs, 'resume-policy', { auto: s.resume.auto, autoArmed: s.resume.autoArmed });
  return s;
}

// ---------------------------------------------------------------------------
// Recalibration (inside the gate)
// ---------------------------------------------------------------------------

/**
 * Compare the observed weekly spend rate with the plan's required rate and
 * adjust one step at most per cooldown. Depth first: under-burning raises
 * the profile before it adds a lane; over-burning only ever drops lanes.
 */
function recalibrate(s, usage, nowMs) {
  if (!s.burn || !s.burn.active) return null;
  const hours = (nowMs - Date.parse(s.plan.startedAt)) / 3600000;
  if (!(hours >= RECAL_MIN_HOURS)) return null;
  if (s.lastAdjustAt && (nowMs - Date.parse(s.lastAdjustAt)) / 60000 < ADJUST_COOLDOWN_MIN) return null;
  const required = s.plan.requiredPerHour;
  if (!isPos(required)) return null;
  const observed = (s.plan.remainingAtStart - usage.weeklyRemaining) / hours;
  let change = null;
  if (observed < UNDER_BURN * required && s.queue.length > 0) {
    const idx = PROFILE_ORDER.indexOf(s.profile);
    if (idx < PROFILE_ORDER.length - 1 && usage.weeklyRemaining - s.reservePct >= MIN_SPENDABLE_PCT) {
      change = { profile: PROFILE_ORDER[idx + 1] };
    } else if (s.lanes < s.laneCap) {
      change = { lanes: s.lanes + 1 };
    }
  } else if (observed > OVER_BURN * required && s.lanes > 1) {
    change = { lanes: s.lanes - 1 };
  }
  if (!change) return null;
  Object.assign(s, change);
  s.lastAdjustAt = iso(nowMs);
  pushEvent(s, nowMs, 'recalibrate', { observedPerHour: round2(observed), requiredPerHour: required, ...change });
  return change;
}

// ---------------------------------------------------------------------------
// gate — the decision before every spawn
// ---------------------------------------------------------------------------

/** Hours one task occupies a lane, from the same estimates as its cost. */
function taskHours(size, profile, cal) {
  return taskCost(size, profile, cal) / laneHourly(profile, cal);
}

/**
 * 5-hour-window percent one busy lane adds per hour. Measured from the
 * readings of the current window (a drop in `sessionUsed` marks a reset),
 * divided by the lanes that were busy; before there is a measurement, the
 * weekly lane rate times SESSION_PER_WEEKLY_DEFAULT. Account-wide like every
 * usage number, so another session's spend makes it more careful, never less.
 */
function sessionRatePerLane(s, profile, cal) {
  const rs = s.readings || [];
  let start = 0;
  for (let i = rs.length - 1; i > 0; i--) {
    if (rs[i].sessionUsed < rs[i - 1].sessionUsed) { start = i; break; }
  }
  const win = rs.slice(start);
  if (win.length >= 2) {
    const a = win[0];
    const b = win[win.length - 1];
    const hours = (Date.parse(b.at) - Date.parse(a.at)) / 3600000;
    const busy = win.slice(0, -1).reduce((n, r) => n + (r.lanesBusy || 0), 0) / Math.max(1, win.length - 1);
    if (hours >= 0.25 && b.sessionUsed > a.sessionUsed && busy > 0) {
      return { rate: (b.sessionUsed - a.sessionUsed) / hours / busy, source: 'measured' };
    }
  }
  return { rate: laneHourly(profile, cal) * SESSION_PER_WEEKLY_DEFAULT, source: 'default' };
}

/**
 * @returns {{decision:'spawn'|'wait'|'hold'|'pause'|'finish'|'stop', reason?, state, ...}}
 *   `state` is the new state to persist (holds, readings, adjustments,
 *   drain, pause, claim).
 *
 * Order of checks: finished / paused / drained → usage (hold, then blind
 * mode) → week reset → weekly reserve → recalibration → lanes → the next
 * queue item that fits the weekly budget, the 5-hour window (projected over
 * its whole run, with every busy lane) and no busy file. Nothing fits the
 * window → wait for the busy lanes, then pause until the reset (with a
 * resume cron when auto-resume is armed; else the user's next prompt).
 */
function gate(state, usage, nowMs, calibration, { claim = true } = {}) {
  const s = clone(state);
  const cal = calibrationFor(calibration, (s.plan && s.plan.planName) || (usage && usage.plan));
  const out = (decision, extra = {}) => ({
    decision,
    lanes: s.lanes,
    profile: s.profile,
    burnActive: !!(s.burn && s.burn.active),
    inFlight: s.inFlight.length,
    queue: s.queue.length,
    ...extra,
    state: s,
  });
  const drainOut = (reason) => {
    enterDrain(s, reason, nowMs);
    return s.inFlight.length ? out('wait', { reason: 'draining', drainReason: reason }) : out('finish', { reason });
  };
  const burnActive = !!(s.burn && s.burn.active);
  const runProfile = burnActive ? s.profile : 'standard';
  const reserveNow = () => (burnActive ? dynamicReserve(s.reservePct, s.lanes, s.profile, cal) : s.reservePct);
  const busyFiles = new Set(s.inFlight.flatMap((t) => t.files || []));
  const conflicts = (t) => (t.files || []).some((f) => busyFiles.has(f));
  const spawnOut = (pick, profile, extra) => {
    if (claim) Object.assign(s, claimTask(s, pick.id, nowMs, { profile }));
    return out('spawn', {
      task: { id: pick.id, task: pick.task, size: pick.size, priority: pick.priority, branch: pick.branch || null, note: pick.note || null, salvage: pick.salvage || null, excluded: pick.excluded || null },
      taskProfile: profile,
      models: modelOverrides(profile),
      passes: PROFILES[profile].passes,
      toolCalls: PROFILES[profile].toolCalls,
      foreground: s.lanes === 1,
      ...extra,
    });
  };

  if (s.status === 'finished') return out('stop', { reason: 'finished' });
  if (s.status === 'paused') return out('stop', { reason: 'paused' });
  if (s.drained) return s.inFlight.length ? out('wait', { reason: 'draining', drainReason: s.drainReason }) : out('finish', { reason: s.drainReason });

  // --- usage unknown: hold, then a capped blind mode, then drain ---
  if (!usage || !usage.ok) {
    // The week reset needs no reading: the budget being burned is gone.
    if (s.weekResetAt && nowMs >= Date.parse(s.weekResetAt)) return drainOut('week-reset');
    s.holds = (s.holds || 0) + 1;
    pushEvent(s, nowMs, 'hold', { reason: usage && usage.reason, holds: s.holds });
    if (s.holds < HOLD_LIMIT) return out('hold', { reason: 'usage-unknown', detail: usage && usage.reason, holds: s.holds });
    const known = s.budgetAt && typeof s.budgetAt.remainingPct === 'number' ? s.budgetAt.remainingPct : null;
    if (known === null) return drainOut('usage-unknown');
    if (!s.blind) {
      const inFlightCost = s.inFlight.reduce((n, t) => n + taskCost(t.size, t.profile || runProfile, cal), 0);
      s.blind = { since: iso(nowMs), lastKnownRemainingPct: known, estSpentPct: round2(inFlightCost * 0.5) };
      pushEvent(s, nowMs, 'blind', { lastKnownRemainingPct: known });
    }
    // Blind: one lane, half of what was spendable at the last reading, every
    // estimate counted 1.5×. The run keeps landing work without betting the
    // limit on a number nobody can see.
    const allowance = BLIND_FRACTION * (known - reserveNow());
    if (s.inFlight.length >= 1) return out('wait', { reason: 'blind-lane-busy', blind: true });
    const left = allowance - BLIND_SAFETY * s.blind.estSpentPct;
    const fitsBlindBudget = (t) => BLIND_SAFETY * taskCost(t.size, taskProfile(t, runProfile), cal) <= left;
    // The 5-hour window from the last reading: until its known reset the
    // window is the same one, and a task that would overrun it waits for
    // the reset exactly like a sighted gate would.
    const lastWin = s.budgetAt && typeof s.budgetAt.sessionPct === 'number' ? s.budgetAt.sessionPct : null;
    const checkedMs = s.budgetAt && s.budgetAt.checkedAt ? Date.parse(s.budgetAt.checkedAt) : NaN;
    const winResetMs = s.budgetAt && s.budgetAt.sessionResetAt
      ? Date.parse(s.budgetAt.sessionResetAt)
      : (Number.isFinite(checkedMs) ? checkedMs + 5 * 3600000 : NaN);
    const sameWindow = lastWin !== null && !(nowMs >= winResetMs);
    // Running total of every blind task's projected window spend since the
    // last good reading (or since the window itself rolled over while still
    // blind): without it, several blind tasks each fit alone but together
    // overrun the 5-hour cap. The reset happens exactly once per window
    // (tracked by windowResetAt, keyed on winResetMs) — winResetMs itself
    // stays fixed for as long as the run is blind (budgetAt does not move
    // until a sighted reading lands), so re-deriving "is this a new window"
    // from sameWindow alone would otherwise zero the total on every call
    // after the reset instead of accumulating within it.
    if (!sameWindow) {
      if (s.blind.windowResetAt !== winResetMs) {
        s.blind.windowSpentPct = 0;
        s.blind.windowResetAt = winResetMs;
      } else {
        s.blind.windowSpentPct = s.blind.windowSpentPct || 0;
      }
    } else {
      s.blind.windowSpentPct = s.blind.windowSpentPct || 0;
    }
    const { rate: blindRate } = sessionRatePerLane(s, s.profile, cal);
    // Same-window baseline is the last known session %; past a reset the
    // window is unread (blind), so it starts from 0 and windowSpentPct alone
    // tracks what has been spent in it since.
    const winBase = sameWindow ? lastWin : 0;
    const fitsBlindWindow = (t) => winBase + s.blind.windowSpentPct < FRESH_WINDOW_PCT
      || winBase + s.blind.windowSpentPct + BLIND_SAFETY * blindRate * taskHours(t.size, taskProfile(t, runProfile), cal) <= 100 - SESSION_RESERVE_PCT;
    const pick = s.queue.find((t) => !conflicts(t) && fitsBlindBudget(t) && fitsBlindWindow(t));
    if (!pick) {
      if (sameWindow && s.queue.some(fitsBlindBudget) && Number.isFinite(winResetMs)) {
        const resumeAtMs = winResetMs + RESUME_BUFFER_MIN * 60000;
        const armed = !!(s.resume && s.resume.autoArmed);
        Object.assign(s, pauseState(s, { reason: 'window', resumeAtMs }, nowMs));
        return out('pause', {
          reason: 'window', blind: true, windowUsedPct: lastWin,
          resumeAt: iso(resumeAtMs), resumeAtLocal: localStamp(resumeAtMs),
          resumeCron: armed ? toCronExpression(resumeAtMs) : null,
        });
      }
      return drainOut('usage-unknown');
    }
    const profile = taskProfile(pick, runProfile);
    s.blind.estSpentPct = round2(s.blind.estSpentPct + taskCost(pick.size, profile, cal));
    s.blind.windowSpentPct = round2(s.blind.windowSpentPct + BLIND_SAFETY * blindRate * taskHours(pick.size, profile, cal));
    return spawnOut(pick, profile, { blind: true, blindLeftPct: round1(left) });
  }
  s.holds = 0;
  if (s.blind) {
    pushEvent(s, nowMs, 'blind-end', { estSpentPct: s.blind.estSpentPct });
    delete s.blind;
  }
  s.budgetAt = {
    remainingPct: usage.weeklyRemaining,
    sessionPct: usage.sessionUsed,
    checkedAt: iso(nowMs),
    ...(usage.sessionResetMin != null ? { sessionResetAt: iso(nowMs + usage.sessionResetMin * 60000) } : {}),
  };
  s.readings = [...(s.readings || []), {
    at: iso(nowMs), weeklyRemaining: usage.weeklyRemaining, sessionUsed: usage.sessionUsed, lanesBusy: s.inFlight.length,
  }].slice(-MAX_READINGS);

  if (s.weekResetAt && nowMs >= Date.parse(s.weekResetAt)) return drainOut('week-reset');

  const reserve = reserveNow();
  if (usage.weeklyRemaining <= reserve) return drainOut('reserve');

  const adjusted = recalibrate(s, usage, nowMs);

  // A new 5-hour window started since the last resume cron: re-arm, so a
  // hard stop in THIS window is also picked up after its reset.
  let rearm = null;
  if (s.resume && s.resume.autoArmed && usage.sessionResetMin != null) {
    const windowResetMs = nowMs + usage.sessionResetMin * 60000;
    const cronFor = s.resume.cronFor ? Date.parse(s.resume.cronFor) : 0;
    if (Math.abs(windowResetMs - cronFor) > 20 * 60000) {
      const fireMs = windowResetMs + RESUME_BUFFER_MIN * 60000;
      rearm = { cron: toCronExpression(fireMs), fireAtLocal: localStamp(fireMs), windowResetAt: iso(windowResetMs) };
    }
  }
  const common = { adjusted, rearmResumeCron: rearm };

  if (s.inFlight.length >= s.lanes) return out('wait', { reason: 'lanes-full', ...common });
  if (!s.queue.length) {
    return s.inFlight.length ? out('wait', { reason: 'queue-empty', ...common }) : out('finish', { reason: 'queue-empty' });
  }

  const budgetLeft = usage.weeklyRemaining - reserve;
  const windowCap = 100 - SESSION_RESERVE_PCT;
  const { rate, source: rateSource } = sessionRatePerLane(s, s.profile, cal);
  const lanesAfter = s.inFlight.length + 1;
  const projectWindow = (t) => usage.sessionUsed + rate * lanesAfter * taskHours(t.size, taskProfile(t, runProfile), cal);
  const fitsBudget = (t) => taskCost(t.size, taskProfile(t, runProfile), cal) <= budgetLeft;
  // A task bigger than a whole window may start only on a fresh window —
  // otherwise it would wait forever; its hard stop is what salvage is for.
  const fitsWindow = (t) => projectWindow(t) <= windowCap || usage.sessionUsed < FRESH_WINDOW_PCT;

  const pick = s.queue.find((t) => !conflicts(t) && fitsBudget(t) && fitsWindow(t));
  if (pick) {
    const profile = taskProfile(pick, runProfile);
    return spawnOut(pick, profile, {
      reservePct: round1(reserve),
      budgetLeftPct: round1(budgetLeft),
      windowProjectedPct: round1(projectWindow(pick)),
      windowRate: { pctPerLaneHour: round1(rate), source: rateSource },
      ...common,
    });
  }

  const budgetOnly = s.queue.filter((t) => fitsBudget(t));
  if (!budgetOnly.length) {
    if (s.inFlight.length) return out('wait', { reason: 'no-fit', ...common });
    return drainOut('no-fit');
  }
  if (budgetOnly.some(fitsWindow)) return out('wait', { reason: 'file-conflict', ...common });

  // Budget is there, the 5-hour window is not. Always a pause, never an end:
  // the run is resumable after the reset — by the cron when auto-resume is
  // armed, else by the user's own "weiter", which prompt.burn.resume turns
  // into the burn-on/off question.
  if (s.inFlight.length) return out('wait', { reason: 'window', windowUsedPct: usage.sessionUsed, ...common });
  const resumeAtMs = nowMs + ((usage.sessionResetMin != null ? usage.sessionResetMin : 300) + RESUME_BUFFER_MIN) * 60000;
  const armed = !!(s.resume && s.resume.autoArmed);
  Object.assign(s, pauseState(s, { reason: 'window', resumeAtMs }, nowMs));
  return out('pause', {
    reason: 'window',
    windowUsedPct: usage.sessionUsed,
    resumeAt: iso(resumeAtMs),
    resumeAtLocal: localStamp(resumeAtMs),
    resumeCron: armed ? toCronExpression(resumeAtMs) : null,
  });
}

// ---------------------------------------------------------------------------
// resumed — continue, switch off or end after a limit stop
// ---------------------------------------------------------------------------

/**
 * Apply the resume choice. `continue` re-derives profile and lanes from the
 * CURRENT usage (the old window's numbers are stale); when the budget no
 * longer carries a burn, or the week has reset (the budget being burned is
 * gone), it falls back to `off`. `end` drains.
 */
function applyResume(state, { trigger, choice, usage, nowMs, calibration, sessionId }) {
  let s = clone(state);
  const requested = ['continue', 'off', 'end'].includes(choice) ? choice : 'off';
  let applied = requested;
  let why = null;

  if (sessionId) s.sessionId = sessionId;
  if (s.status === 'paused' || s.status === 'draining') s.status = s.drained ? 'draining' : 'running';
  delete s.pause;
  s.holds = 0;

  const weekRolled = s.weekResetAt && nowMs >= Date.parse(s.weekResetAt);
  if (requested === 'continue' && weekRolled) { applied = 'off'; why = 'week-reset'; }

  let plan = null;
  if (applied === 'continue') {
    const pending = [...s.queue, ...s.inFlight];
    plan = derivePlan({
      usage, queue: pending, calibration,
      plan: (s.plan && s.plan.planName) || (usage && usage.plan),
      laneCap: s.laneCap || LANE_CAP, reservePct: s.reservePct || RESERVE_PCT,
    });
    if (!plan.ok) { applied = 'off'; why = plan.reason; }
  }

  if (applied === 'end') {
    enterDrain(s, 'user-ended', nowMs);
  } else if (applied === 'off') {
    if (s.burn && s.burn.active) s = burnOff(s, why ? `resume-${why}` : `resume-${trigger || 'manual'}`, nowMs);
    s.drained = false;
    s.drainReason = null;
    s.status = 'running';
    if (weekRolled && usage && usage.ok && usage.weeklyResetMin != null) {
      s.weekResetAt = iso(nowMs + usage.weeklyResetMin * 60000);
    }
  } else {
    s.burn = { active: true };
    s.profile = plan.profile;
    s.lanes = plan.lanes;
    s.drained = false;
    s.drainReason = null;
    s.status = 'running';
    s.plan = {
      ...s.plan,
      requiredPerHour: plan.requiredPerHour,
      uplift: plan.uplift,
      reservePct: plan.reservePct,
      remainingAtStart: usage.weeklyRemaining,
      startedAt: iso(nowMs),
    };
    s.lastAdjustAt = null;
  }

  s.lastResume = { at: iso(nowMs), trigger: trigger || 'manual', requested, applied, why };
  pushEvent(s, nowMs, 'resumed', s.lastResume);
  return { state: s, applied, requested, why, plan };
}

// ---------------------------------------------------------------------------
// Calibration samples (recorded on finish)
// ---------------------------------------------------------------------------

/**
 * One lane-hour sample and one unit-cost sample per run, normalized to
 * standard depth. Needs ≥ 30 min and ≥ 2 % observed spend, else the integer
 * percent resolution makes the sample noise.
 */
function calibrationSamples(state, finalRemaining, nowMs) {
  if (!state || !state.plan || typeof finalRemaining !== 'number' || !Number.isFinite(finalRemaining)) return null;
  const startedAt = Date.parse(state.plan.startedAt);
  const hours = (nowMs - startedAt) / 3600000;
  const spent = state.plan.remainingAtStart - finalRemaining;
  if (!(hours >= RECAL_MIN_HOURS) || !(spent >= 2)) return null;
  const done = (state.done || []).filter((t) => t.claimedAt && t.landedAt);
  if (!done.length) return null;
  let laneHours = 0;
  let weight = 0;
  let depthWeightedHours = 0;
  for (const t of done) {
    const h = (Date.parse(t.landedAt) - Date.parse(t.claimedAt)) / 3600000;
    const f = (PROFILES[t.profile] || PROFILES.standard).depthFactor;
    if (h > 0) { laneHours += h; depthWeightedHours += h * f; }
    weight += (SIZE_WEIGHT[t.size] || SIZE_WEIGHT.M) * f;
  }
  if (!(laneHours > 0) || !(weight > 0)) return null;
  return {
    laneHourlyPct: round2(spent / depthWeightedHours),
    unitCostPct: round2(spent / weight),
  };
}

function recordCalibration(calibration, plan, sample) {
  const out = clone(calibration || {});
  if (!plan || !sample) return out;
  const entry = out[plan] || {};
  entry.laneHourlyPct = [...(entry.laneHourlyPct || []), sample.laneHourlyPct].slice(-CALIBRATION_KEEP);
  entry.unitCostPct = [...(entry.unitCostPct || []), sample.unitCostPct].slice(-CALIBRATION_KEEP);
  out[plan] = entry;
  return out;
}

// ---------------------------------------------------------------------------
// Git checks — resume-check and prune-check
// ---------------------------------------------------------------------------

/**
 * Every git call is bounded: a hung credential helper, a locked index or a
 * slow hook must not freeze the conveyor, and a big diff must not die with
 * ENOBUFS at Node's 1 MiB default buffer.
 */
const GIT_TIMEOUT_MS = 30_000;
const GIT_COMMIT_TIMEOUT_MS = 120_000; // commit runs the repo's hooks
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(cwd, args, { timeout = GIT_TIMEOUT_MS } = {}) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: GIT_MAX_BUFFER, windowsHide: true,
  }).trim();
}

function tryGit(cwd, args, opts) {
  try { return git(cwd, args, opts); } catch { return null; }
}

/**
 * A branch name as the user or a state file wrote it, reduced to its short
 * form: `refs/heads/main`, `heads/main` and `main` are one branch.
 */
function shortBranch(branch) {
  return String(branch || '').trim().replace(/^refs\/heads\//, '').replace(/^heads\//, '');
}

/**
 * Do two branch names name the same ref? On Windows (and any repo with
 * core.ignorecase) loose refs live on a case-insensitive filesystem, so
 * "Main" resolves to — and writes — main.
 */
function sameBranch(repo, a, b) {
  const x = shortBranch(a);
  const y = shortBranch(b);
  if (x === y) return true;
  const icase = process.platform === 'win32'
    || (repo && tryGit(repo, ['config', '--get', 'core.ignorecase']) === 'true');
  return icase && x.toLowerCase() === y.toLowerCase();
}

/**
 * `main`, `master`, `trunk`, the configured init default and every remote's
 * default branch (read offline from `refs/remotes/<remote>/HEAD`). While the
 * session works on a feature / worktree branch they are reached only through
 * /do-ship — never by a checkpoint, a salvage or the conveyor's merge + push.
 * When the session itself works on one of them (no feature branch, by
 * necessity), that branch IS the session branch and may be written (`mayWrite`).
 */
function protectedBranches(repo) {
  const names = new Set(['main', 'master', 'trunk']);
  if (!repo) return names;
  const init = tryGit(repo, ['config', '--get', 'init.defaultBranch']);
  if (init) names.add(shortBranch(init));
  const heads = tryGit(repo, ['for-each-ref', '--format=%(refname) %(symref)', 'refs/remotes']);
  for (const line of (heads || '').split(/\r?\n/)) {
    const [ref, target] = line.trim().split(' ');
    const m = ref && target && ref.match(/^refs\/remotes\/([^/]+)\/HEAD$/);
    if (m && target.startsWith(`refs/remotes/${m[1]}/`)) names.add(target.slice(`refs/remotes/${m[1]}/`.length));
  }
  return names;
}

/** Protected under any spelling: case variants and ref prefixes included. */
function isProtectedBranch(repo, branch) {
  if (!branch) return false;
  const b = shortBranch(branch).toLowerCase();
  return [...protectedBranches(repo)].some((p) => p.toLowerCase() === b);
}

/** The branch the session's own worktree is on; null outside git or detached. */
function sessionBranch(dir) {
  const b = dir ? tryGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) : null;
  return b && b !== 'HEAD' ? b : null;
}

/**
 * May the burn write to `branch`? Never outside a git repo (no repo, no
 * commits) and never above the session branch: not a protected branch the
 * session does not itself work on, and not the parent of a sub-branch
 * session (`<parent>-<role>` or `<parent>/<role>` → `<parent>`). Any other
 * branch may be written.
 */
function mayWrite(sessionDir, branch) {
  if (!branch || !shortBranch(branch)) return false;
  if (!sessionDir || tryGit(sessionDir, ['rev-parse', '--git-dir']) === null) return false;
  const session = sessionBranch(sessionDir);
  if (session && sameBranch(sessionDir, session, branch)) return true;
  if (isProtectedBranch(sessionDir, branch)) return false;
  if (session) {
    const s = shortBranch(session).toLowerCase();
    const b = shortBranch(branch).toLowerCase();
    if (s.startsWith(`${b}-`) || s.startsWith(`${b}/`)) return false;
  }
  return true;
}

function branchExists(repo, branch) {
  return !!branch && tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null;
}

function commitsAhead(repo, base, branch) {
  if (!branchExists(repo, branch) || !branchExists(repo, base)) return null;
  const n = tryGit(repo, ['rev-list', '--count', `${base}..${branch}`]);
  return n === null ? null : Number(n);
}

function isDirty(worktree) {
  if (!worktree || !fs.existsSync(worktree)) return null;
  const out = tryGit(worktree, ['status', '--porcelain']);
  return out === null ? null : out.length > 0;
}

/** What is actually on disk for one in-flight task. */
function inspectInFlight(entry, { repo, integrationBranch }) {
  const branch = entry.branch || null;
  const ahead = branch ? commitsAhead(repo, integrationBranch, branch) : null;
  const lastSubject = branch && branchExists(repo, branch) ? tryGit(repo, ['log', '-1', '--format=%s', branch]) : null;
  return {
    id: entry.id,
    branch,
    worktree: entry.worktree || null,
    worktreeExists: !!(entry.worktree && fs.existsSync(entry.worktree)),
    commitsAhead: ahead,
    dirty: isDirty(entry.worktree),
    lastSubject,
    wip: !!(lastSubject && /^wip[:(]/i.test(lastSubject)),
    agentId: entry.agentId || null,
    sessionId: entry.sessionId || null,
  };
}

/**
 * Resume action for one in-flight task. Precedence:
 *   dirty worktree → salvage first (commit the uncommitted diff as wip —
 *   the first version's resume looked at commits only and requeued from
 *   scratch, and its prune guard called such a worktree safe to delete);
 *   same session + known agent → continue the agent with its context;
 *   finished commits → merge; wip commits → requeue on the branch;
 *   nothing → requeue.
 */
function classifyInFlight(info, { sessionId } = {}) {
  const salvage = info.dirty === true;
  const ahead = (info.commitsAhead || 0) + (salvage ? 1 : 0);
  const wip = salvage || info.wip;
  let action;
  if (info.agentId && sessionId && info.sessionId === sessionId) action = 'continue-agent';
  else if (ahead > 0 && !wip) action = 'merge';
  else if (ahead > 0) action = 'requeue-with-branch';
  else action = 'requeue';
  return { ...info, salvage, action };
}

/**
 * Secret-shaped paths a salvage never stages. Nobody knows which files a
 * cut-off agent meant, so the salvage takes everything git does not ignore —
 * except these, which stay uncommitted in the worktree
 * (commit-conventions.md § Rules).
 */
const SALVAGE_EXCLUDES = [
  '.env', '.env.*', '*.env', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore', '*.ppk',
  '*.tfvars', '*.tfvars.json', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*',
  'credentials', 'credentials.json', '*.credentials', '*service-account*.json', 'secrets.*',
  '.git-credentials', '.netrc', '_netrc', '.npmrc', '.pypirc', 'token.txt', '*.token',
];

/** Basename glob (`*` only) → case-insensitive RegExp. */
const SALVAGE_EXCLUDE_RES = SALVAGE_EXCLUDES.map((p) => new RegExp(
  `^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i',
));

/** Would the salvage refuse to commit this repo-relative path? */
function isSalvageSecret(rel) {
  const base = String(rel).split(/[\\/]/).pop();
  return SALVAGE_EXCLUDE_RES.some((re) => re.test(base));
}

const firstLine = (err) => String((err && (err.stderr || err.message)) || err).trim().split('\n')[0];

function stagedPaths(worktree) {
  const out = git(worktree, ['diff', '--cached', '--name-only', '--no-renames', '-z']);
  return out.split('\0').filter(Boolean);
}

/** Every changed path in the worktree (tracked + untracked), git-ignored ones aside. */
function dirtyPaths(worktree) {
  const tracked = tryGit(worktree, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']);
  const untracked = tryGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
  const all = [tracked, untracked].filter((s) => s != null).join('\0');
  return [...new Set(all.split('\0').filter(Boolean))];
}

/**
 * Commit a dirty worktree's diff as wip on its own branch. Hooks stay on
 * (no --no-verify): when a pre-commit hook refuses the wip commit, the diff
 * is saved as a patch next to the state file instead.
 *
 * Secret-shaped paths are kept out three ways: the `add` excludes them
 * (case-insensitive — Windows writes `.ENV` and `.env` to one file), a
 * `reset` unstages whatever the cut-off agent had ALREADY staged, and the
 * final staged list is checked again before anything is committed.
 */
function salvageWorktree(info, { stateDir }) {
  const msg = `wip(burn): salvage ${info.id} after a hard stop`;
  const wt = info.worktree;
  const current = tryGit(wt, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!current || current === 'HEAD') return { ok: false, error: 'detached HEAD — not salvaged' };
  if (!mayWrite(stateDir, current)) return { ok: false, error: `on ${current} — never salvaged onto a protected branch above the session branch` };
  // Taken before `add`: the excludes keep secret-shaped paths out of the
  // index entirely, so diffing the final staged set against everything that
  // was dirty is the only way to know what got left behind — including
  // false positives like a real `secrets.ts` or a committed `.npmrc`.
  const before = dirtyPaths(wt);
  const excludes = SALVAGE_EXCLUDES.map((p) => `:(exclude,glob,icase)**/${p}`);
  try {
    git(wt, ['add', '-A', '--', '.', ...excludes]);
  } catch (err) {
    // Nothing is staged reliably after a failed add (a stale index.lock, a
    // timeout): a patch now would be empty or partial. Say so, keep the
    // worktree as it is — it is the only copy.
    return { ok: false, error: `git add failed — nothing salvaged, worktree left as is: ${firstLine(err)}`, excluded: [] };
  }
  let staged;
  try {
    const secrets = stagedPaths(wt).filter(isSalvageSecret);
    if (secrets.length) git(wt, ['reset', '-q', '--', ...secrets.map((f) => `:(literal)${f}`)]);
    staged = stagedPaths(wt);
    const left = staged.filter(isSalvageSecret);
    if (left.length) throw new Error(`secret-shaped path(s) still staged: ${left.join(', ')}`);
  } catch (err) {
    tryGit(wt, ['reset', '-q']);
    return { ok: false, error: `could not unstage secret-shaped files — nothing salvaged: ${firstLine(err)}`, excluded: before };
  }
  const stagedSet = new Set(staged);
  const excluded = before.filter((f) => !stagedSet.has(f));
  if (!staged.length) return { ok: false, error: 'nothing but excluded files to salvage', excluded };
  try {
    git(wt, ['commit', '-q', '-m', msg], { timeout: GIT_COMMIT_TIMEOUT_MS });
    return { ok: true, method: 'commit', sha: git(wt, ['rev-parse', '--short', 'HEAD']), excluded };
  } catch (err) {
    const file = path.join(stateDir, `BURN-SALVAGE-${info.id}.patch`);
    try {
      // --output streams to the file: no pipe buffer for a big diff.
      git(wt, ['diff', '--cached', '--binary', `--output=${file}`, 'HEAD']);
      const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (!bytes) {
        try { fs.unlinkSync(file); } catch { /* never written */ }
        return { ok: false, error: `commit failed and the patch came out empty — nothing salvaged: ${firstLine(err)}`, excluded };
      }
      return { ok: true, method: 'patch', file, bytes, error: firstLine(err), excluded };
    } catch (err2) {
      return { ok: false, error: firstLine(err2), excluded };
    }
  }
}

/**
 * May a burn worktree be removed? Only when its branch has nothing the
 * integration branch lacks AND the worktree holds no uncommitted change.
 * `git merge-base --is-ancestor` alone answered "safe" for a branch without
 * commits whose worktree still held the only copy of an agent's work.
 */
function pruneCheck({ repo, branch, worktree, integrationBranch }) {
  const ahead = branch && integrationBranch ? commitsAhead(repo, integrationBranch, branch) : null;
  const worktreeExists = !!(worktree && fs.existsSync(worktree));
  const dirty = isDirty(worktree);
  const reasons = [];
  if (ahead === null && branch && branchExists(repo, branch)) reasons.push('integration branch unknown — cannot prove merged');
  if (ahead > 0) reasons.push(`${ahead} commit(s) not in ${integrationBranch}`);
  if (dirty === true) reasons.push('uncommitted changes in the worktree');
  // Unknown is never safe: an unreadable status, a worktree HEAD (detached,
  // or on another branch than the recorded one) that the integration branch
  // does not contain, or nothing named at all.
  let headMerged = null;
  if (worktreeExists) {
    if (dirty === null) reasons.push('worktree status unreadable — cannot prove clean');
    const head = tryGit(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    headMerged = !!(head && integrationBranch && branchExists(repo, integrationBranch)
      && tryGit(repo, ['merge-base', '--is-ancestor', head, `refs/heads/${integrationBranch}`]) !== null);
    if (!headMerged) reasons.push(`worktree HEAD ${head ? head.slice(0, 7) : '(unreadable)'} not proven in ${integrationBranch || 'the integration branch'}`);
  } else if (!branch) {
    reasons.push('no --branch and no worktree — nothing to prove merged');
  }
  return { safe: reasons.length === 0, commitsAhead: ahead, dirty, headMerged, reasons };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

const USAGE_FILE = () => process.env.DEVOPS_BURN_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage-live.json');
const CALIBRATION_FILE = () => process.env.DEVOPS_BURN_CALIBRATION || path.join(os.homedir(), '.claude', 'burn-calibration.json');

function nowMs() {
  const fixed = process.env.DEVOPS_BURN_NOW;
  if (fixed) {
    const n = /^\d+$/.test(fixed) ? Number(fixed) : Date.parse(fixed);
    if (Number.isFinite(n)) return n;
  }
  return Date.now();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const LOCK_WAIT_MS = 15_000;
const LOCK_STALE_MS = 60_000;     // a holder dead this long (crash, kill) is taken over

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** True if `pid` names a live process (or one we can't signal but that still exists). */
function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * Run `fn` under an exclusive lock on the state file: read → decide/claim →
 * write is one step. Two parallel `gate` calls (two free lanes, batched tool
 * calls) otherwise read the same queue and claim the same task. The lock is
 * a sibling `<state>.lock` created with 'wx', holding the holder's PID and
 * timestamp. It is taken over once its PID is confirmed dead, or once its
 * PID cannot be read at all (mid-write / corrupt) and it is older than
 * LOCK_STALE_MS — by renaming it aside first (rename is atomic; only one
 * concurrent waiter can win a given name), so two waiters can never both
 * believe they cleared it and both end up holding a lock at once. A LIVE
 * holder is never taken over just for being old — age alone is not a crash
 * signal (a long-running burn is normal) — a waiter behind a live holder
 * instead rides out waitMs and fails loudly.
 */
function withStateLock(file, fn, { waitMs = Math.max(LOCK_WAIT_MS, LOCK_STALE_MS), staleMs = LOCK_STALE_MS } = {}) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + waitMs;
  const giveUpOrRetry = () => {
    if (Date.now() > deadline) throw new Error(`burn state is locked (${lock}) — another burn-plan call is running`);
    sleepMs(25 + Math.floor(Math.random() * 50));
  };
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let stat = null;
      try { stat = fs.statSync(lock); } catch { continue; /* released meanwhile */ }
      const age = Date.now() - stat.mtimeMs;
      let holderPid = NaN;
      try { holderPid = parseInt(fs.readFileSync(lock, 'utf8').trim().split(/\s+/)[0], 10); } catch { /* mid-write, or gone */ }
      const pidKnown = Number.isFinite(holderPid);
      // A live PID is never taken over by age alone; only a dead PID, or an
      // unreadable/unknown one that has also sat past staleMs (a holder that
      // crashed before it could even write its PID).
      const staleByDeadPid = pidKnown && !isPidAlive(holderPid);
      const staleByUnknownPid = !pidKnown && age > staleMs;
      if (staleByDeadPid || staleByUnknownPid) {
        // Rename-first takeover: only the waiter whose rename succeeds
        // proceeds; the rest loop back and retry 'wx' against a lock that no
        // longer exists (or a fresh one the winner just created). A rename
        // that keeps failing (e.g. antivirus/indexer holding the file on
        // Windows) must still respect the deadline and back off between
        // attempts instead of spinning at full CPU.
        const graveyard = `${lock}.stale-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
          fs.renameSync(lock, graveyard);
          try { fs.unlinkSync(graveyard); } catch { /* best-effort cleanup */ }
        } catch { /* another waiter already took it over, the holder released it, or the rename itself failed */ }
        giveUpOrRetry();
        continue;
      }
      giveUpOrRetry();
    }
  }
  const owner = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()} ${owner}\n`);
    fs.closeSync(fd);
    fd = -1;
    return fn();
  } finally {
    if (fd > 0) try { fs.closeSync(fd); } catch { /* closed */ }
    // Only unlink the lock if it still holds our token: a run that took
    // longer than staleMs may have already been taken over by another
    // waiter, whose lock we must not delete out from under them.
    try {
      const held = fs.readFileSync(lock, 'utf8');
      if (held.trim().endsWith(owner)) fs.unlinkSync(lock);
    } catch { /* already gone */ }
  }
}

/** Best-effort headless refresh — never opens a login window, bounded. */
function refreshUsage() {
  try {
    spawnSync(process.execPath, [path.join(__dirname, 'refresh-usage-headless.js'), '--no-login', '--quiet'], {
      cwd: os.tmpdir(), timeout: 90_000, stdio: 'ignore',
    });
  } catch { /* usage stays as last read; the gate copes with stale data */ }
}

function readUsage(opts, maxAgeMin) {
  const noRefresh = opts['no-refresh'] || process.env.DEVOPS_BURN_NO_REFRESH === '1';
  let usage = normalizeUsage(readJson(USAGE_FILE()), nowMs(), maxAgeMin);
  if (!usage.ok && !noRefresh) {
    refreshUsage();
    usage = normalizeUsage(readJson(USAGE_FILE()), nowMs(), maxAgeMin);
  }
  return usage;
}

function resolveStatePath(opts) {
  if (opts.state) return path.resolve(opts.state);
  const { projectRoot } = require('../hooks/lib/project-root');
  return path.join(projectRoot(opts.cwd || process.cwd()), STATE_FILE);
}

/**
 * Keep BURN-* files out of git from the moment the state is written — before
 * autonomous Step 3c registers the same pattern. Best effort, idempotent.
 */
function ensureGitExcluded(dir) {
  try {
    const { gitCommonDir } = require('../hooks/lib/project-root');
    const gcd = gitCommonDir(dir);
    if (!gcd) return;
    const file = path.join(gcd, 'info', 'exclude');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!text.split(/\r?\n/).includes('/BURN-*')) {
      fs.appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}/BURN-*\n`);
    }
  } catch { /* no writable .git: the BURN-* files just stay visible */ }
}

function parseQueueArg(value) {
  if (!value) throw new Error('--queue is required (JSON array or @file)');
  const text = value.startsWith('@') ? fs.readFileSync(value.slice(1), 'utf8') : value;
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('--queue must be a JSON array');
  return parsed;
}

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
    else pos.push(a);
  }
  return { opts, pos };
}

/** This session's id: --session, else the one Claude Code exports to tools. */
function sessionOf(opts) {
  return opts.session || process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
}

function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function withoutState(result) {
  const { state: _state, ...rest } = result;
  return rest;
}

function requireState(file) {
  const s = readStateFile(file);
  if (!s) throw new Error(`no burn state at ${file}`);
  return s;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function cli(argv) {
  const [cmd, ...rest] = argv;
  const { opts, pos } = parseArgs(rest);
  const now = nowMs();

  switch (cmd) {
    case 'offer': {
      print(offer(readUsage(opts, PLAN_USAGE_MAX_AGE_MIN)));
      return 0;
    }
    case 'plan': {
      const knobs = planKnobs(opts);
      const queue = parseQueueArg(opts.queue);
      const usage = readUsage(opts, PLAN_USAGE_MAX_AGE_MIN);
      print(derivePlan({ usage, queue, calibration: readJson(CALIBRATION_FILE()), ...knobs }));
      return 0;
    }
    case 'init': {
      const file = resolveStatePath(opts);
      // Validate every argument before anything is read or written.
      const knobs = planKnobs(opts);
      const resumeAuto = parseResumeAuto(opts['resume-auto']);
      const autoArmed = !!parseYesNo('auto-armed', opts['auto-armed']);
      const queue = parseQueueArg(opts.queue);
      if (!mayWrite(path.dirname(file), opts['integration-branch'])) {
        print({ ok: false, reason: 'integration-branch-protected', branch: opts['integration-branch'] || null });
        return 1;
      }
      const usage = readUsage(opts, PLAN_USAGE_MAX_AGE_MIN);
      const plan = derivePlan({ usage, queue, calibration: readJson(CALIBRATION_FILE()), ...knobs });
      if (!plan.ok) { print({ ok: false, plan }); return 1; }
      return withStateLock(file, () => {
        const existing = readStateFile(file);
        if (existing && isOpenRun(existing) && !opts.force) {
          print({ ok: false, reason: 'open-run-exists', state: file, ...tally(existing) });
          return 1;
        }
        if (existing && fs.existsSync(file)) fs.copyFileSync(file, path.join(path.dirname(file), PREV_STATE_FILE));
        const s = newState({
          slug: opts.slug, integrationBranch: opts['integration-branch'], plan, queue, usage, nowMs: now,
          sessionId: sessionOf(opts), resumeAuto, autoArmed,
        });
        writeJsonAtomic(file, s);
        ensureGitExcluded(path.dirname(file));
        print({ ok: true, state: file, plan });
        return 0;
      });
    }
    case 'gate': {
      const file = resolveStatePath(opts);
      requireState(file);
      // Usage may take a headless refresh — read it before the lock.
      const usage = readUsage(opts, USAGE_FRESH_MIN);
      const calibration = readJson(CALIBRATION_FILE());
      const run = () => {
        const result = gate(requireState(file), usage, now, calibration, { claim: !opts.peek });
        if (!opts.peek) writeJsonAtomic(file, result.state);
        print(withoutState(result));
        return 0;
      };
      return opts.peek ? run() : withStateLock(file, run);
    }
    case 'state': {
      const [op, id] = pos;
      const file = resolveStatePath(opts);
      requireState(file);
      const finishUsage = op === 'finish' ? readUsage(opts, PLAN_USAGE_MAX_AGE_MIN) : null;
      return withStateLock(file, () => stateOp(op, id, file, opts, now, finishUsage));
    }
    case 'resumed': {
      const file = resolveStatePath(opts);
      requireState(file);
      const usage = readUsage(opts, PLAN_USAGE_MAX_AGE_MIN);
      const calibration = readJson(CALIBRATION_FILE());
      return withStateLock(file, () => {
        const r = applyResume(requireState(file), {
          trigger: opts.trigger, choice: opts.choice, usage, nowMs: now, calibration, sessionId: sessionOf(opts),
        });
        writeJsonAtomic(file, r.state);
        print({
          ok: true, requested: r.requested, applied: r.applied, why: r.why,
          burnActive: !!(r.state.burn && r.state.burn.active), profile: r.state.profile, lanes: r.state.lanes,
          skipped: r.state.skipped.length, plan: r.plan, ...tally(r.state),
        });
        return 0;
      });
    }
    case 'resume-check': {
      const file = resolveStatePath(opts);
      const s0 = requireState(file);
      const repo = opts.repo || path.dirname(file);
      const actions = s0.inFlight.map((e) => classifyInFlight(inspectInFlight(e, { repo, integrationBranch: s0.integrationBranch }), { sessionId: sessionOf(opts) }));
      if (!opts.apply) {
        print({ ok: true, applied: false, actions, ...tally(s0) });
        return 0;
      }
      for (const a of actions) {
        // Never salvage in the run's own worktree: that is the integration
        // branch, and a wip commit there would land half a task.
        const own = a.worktree && path.resolve(a.worktree).toLowerCase() === path.dirname(file).toLowerCase();
        if (a.salvage && a.worktreeExists && !own) a.salvaged = salvageWorktree(a, { stateDir: path.dirname(file) });
        else if (a.salvage && own) a.salvaged = { ok: false, error: 'integration worktree — not salvaged' };
      }
      // Salvage runs git (hooks, commits) — outside the lock; the requeues
      // are one short read-modify-write against the state as it is now.
      return withStateLock(file, () => {
        let s = requireState(file);
        for (const a of actions) {
          if ((a.action === 'requeue' || a.action === 'requeue-with-branch') && s.inFlight.some((t) => t.id === a.id)) {
            s = requeueTask(s, a.id, {
              branch: a.action === 'requeue-with-branch' ? a.branch : undefined,
              salvage: a.salvaged && a.salvaged.method === 'patch' ? a.salvaged.file : undefined,
              excluded: a.salvaged && a.salvaged.excluded,
              note: 'after a hard stop',
            }, now);
            a.applied = true;
          }
        }
        writeJsonAtomic(file, s);
        print({ ok: true, applied: true, actions, ...tally(s) });
        return 0;
      });
    }
    case 'prune-check': {
      const file = opts.state ? path.resolve(opts.state) : null;
      const s = file ? readStateFile(file) : null;
      const repo = opts.repo || (file ? path.dirname(file) : process.cwd());
      const r = pruneCheck({
        repo, branch: typeof opts.branch === 'string' ? opts.branch : null,
        worktree: typeof opts.worktree === 'string' ? opts.worktree : null,
        integrationBranch: opts.integration || (s && s.integrationBranch),
      });
      print(r);
      return r.safe ? 0 : 1;
    }
    case 'status': {
      const file = resolveStatePath(opts);
      const s = readStateFile(file);
      if (!s) { print({ exists: false }); return 0; }
      print({
        exists: true, open: isOpenRun(s), status: s.status || null, burnActive: !!(s.burn ? s.burn.active : true),
        profile: s.profile, lanes: s.lanes, resume: s.resume || null, pause: s.pause || null,
        drainReason: s.drainReason || null, lastResume: s.lastResume || null, heartbeatAt: s.heartbeatAt || null, ...tally(s),
      });
      return 0;
    }
    case 'simulate': {
      const sim = require('./burn-sim');
      const names = opts.all || !opts.scenario ? Object.keys(sim.SCENARIOS) : [opts.scenario];
      const results = names.map((n) => sim.runScenario(n));
      if (opts.text) process.stdout.write(results.map(sim.formatResult).join('\n\n') + '\n');
      else print(results.map((r) => ({ name: r.name, outcome: r.outcome })));
      return 0;
    }
    default:
      process.stderr.write('usage: burn-plan.js offer|plan|init|gate|state|resumed|resume-check|prune-check|status|simulate …\n');
      return 2;
  }
}

/** --lane-cap (1–16 lanes) and --reserve (0–50 % of the week), validated. */
function planKnobs(opts) {
  return {
    laneCap: parseNumberOpt('lane-cap', opts['lane-cap'], LANE_CAP, { min: 1, max: 16, integer: true }),
    reservePct: parseNumberOpt('reserve', opts.reserve, RESERVE_PCT, { min: 0, max: 50 }),
  };
}

/** One `state <op>` transition; runs under the state lock. */
function stateOp(op, id, file, opts, now, finishUsage) {
      let s = requireState(file);
      switch (op) {
        case 'start':
        case 'agent': {
          const patch = {};
          for (const k of ['agent', 'branch', 'worktree']) if (opts[k]) patch[k] = opts[k];
          if (opts['agent-id']) patch.agentId = opts['agent-id'];
          const sid = sessionOf(opts);
          if (sid) patch.sessionId = sid;
          if (s.queue.some((t) => t.id === id)) s = claimTask(s, id, now, patch);
          else s = updateInFlight(s, id, patch, now, 'agent');
          break;
        }
        case 'checkpoint': {
          const cur = s.inFlight.find((t) => t.id === id);
          s = updateInFlight(s, id, { checkpoints: ((cur && cur.checkpoints) || 0) + 1, lastCheckpointAt: iso(now), ...(opts.sha ? { lastCheckpointSha: opts.sha } : {}) }, now, 'checkpoint');
          break;
        }
        case 'land': s = landTask(s, id, { sha: opts.sha, pushed: opts.pushed !== 'false' }, now); break;
        case 'requeue': s = requeueTask(s, id, { branch: opts.branch, note: opts.note, salvage: opts.salvage }, now); break;
        case 'fail': s = failTask(s, id, { reason: opts.reason }, now); break;
        case 'drain': s = clone(s); enterDrain(s, opts.reason || 'manual', now); break;
        case 'pause': s = pauseState(s, { reason: opts.reason, resumeAtMs: opts['resume-at'] ? Date.parse(opts['resume-at']) : null }, now); break;
        case 'burn-off': s = burnOff(s, opts.reason || 'user', now); break;
        case 'resume-policy': s = setResumePolicy(s, { auto: opts.auto, autoArmed: parseYesNo('auto-armed', opts['auto-armed']) }, now); break;
        case 'integration': {
          if (!opts.branch) throw new Error('state integration needs --branch=<branch>');
          if (!mayWrite(path.dirname(file), opts.branch)) {
            print({ ok: false, reason: 'integration-branch-protected', branch: opts.branch });
            return 1;
          }
          s = clone(s);
          s.integrationBranch = opts.branch;
          pushEvent(s, now, 'integration', { branch: opts.branch });
          break;
        }
        case 'resume-cron': {
          s = clone(s);
          s.resume = { ...(s.resume || {}), cronFor: opts.for || null, cronJob: opts.job || null };
          pushEvent(s, now, 'resume-cron', { for: s.resume.cronFor });
          break;
        }
        case 'finish': {
          const usage = finishUsage || { ok: false };
          const sample = usage.ok ? calibrationSamples(s, usage.weeklyRemaining, now) : null;
          if (sample) {
            const planName = (s.plan && s.plan.planName) || usage.plan;
            writeJsonAtomic(CALIBRATION_FILE(), recordCalibration(readJson(CALIBRATION_FILE()), planName, sample));
          }
          s = finishState(s, opts.status, now);
          writeJsonAtomic(file, s);
          print({ ok: true, op, result: s.result, calibration: sample, ...tally(s) });
          return 0;
        }
        default:
          throw new Error(`unknown state op: ${op}`);
      }
      writeJsonAtomic(file, s);
      print({ ok: true, op, id: id || null, status: s.status, burnActive: !!(s.burn && s.burn.active), profile: s.profile, lanes: s.lanes, ...tally(s) });
      return 0;
}


module.exports = {
  STATE_VERSION, RESERVE_PCT, LANE_CAP, SESSION_RESERVE_PCT, MIN_SPENDABLE_PCT, MIN_OFFER_PCT,
  UPLIFT_FLOOR, USAGE_FRESH_MIN, HOLD_LIMIT, SESSION_PER_WEEKLY_DEFAULT, BLIND_FRACTION, BLIND_SAFETY, PROFILES, PROFILE_ORDER, SIZE_WEIGHT, PLAN_CAPACITY,
  DEFAULTS_AT_MAX20, RESUME_BUFFER_MIN,
  normalizeUsage, calibrationFor, isFiller, taskProfile, taskCost, queueCost, laneHourly,
  dynamicReserve, modelOverrides, taskHours, sessionRatePerLane, sortQueue, normalizeTask, offer, derivePlan,
  newState, claimTask, updateInFlight, landTask, requeueTask, failTask, pauseState, burnOff,
  finishState, setResumePolicy, enterDrain, recalibrate, gate, applyResume,
  calibrationSamples, recordCalibration,
  inspectInFlight, classifyInFlight, salvageWorktree, pruneCheck, SALVAGE_EXCLUDES, isSalvageSecret,
  protectedBranches, isProtectedBranch, sessionBranch, mayWrite, shortBranch, sameBranch,
  parseResumeAuto, parseNumberOpt, withStateLock, GIT_TIMEOUT_MS, GIT_MAX_BUFFER,
  toCronExpression, cli,
};

if (require.main === module) {
  let code;
  try {
    code = cli(process.argv.slice(2));
  } catch (err) {
    print({ ok: false, error: String(err && err.message ? err.message : err) });
    code = 1;
  }
  process.exitCode = code;
}
