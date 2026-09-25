#!/usr/bin/env node
/**
 * @script burn-sim
 * @version 0.1.0
 * @plugin devops
 * @description Token-free dry runs of whole `/do-run burn` runs. A synthetic
 *   account (weekly budget, rolling 5-hour window, other sessions spending in
 *   parallel, a usage scraper that can go blind) drives the REAL decision code
 *   of scripts/burn-plan.js — derivePlan, gate, the state transitions,
 *   applyResume and the resume-check classification — tick by tick.
 *
 *   Every scenario runs twice:
 *   - `current` — the burn as specified before this change (depth-before-
 *     breadth, #335), assumed to be followed faithfully: per-task landing,
 *     fixed 5 % reserve, no 5-hour guard, acting on whatever usage number is
 *     cached, "commit before returning", a resume that looks at commits only,
 *     a burn that silently keeps burning after a limit stop, an uplift gate
 *     that never refuses, filler at full depth with PO review + second QA;
 *   - `new`     — this implementation.
 *
 *   Nothing here is a token forecast. The account model uses the same
 *   planning estimates as burn-plan.js (optionally skewed by `trueCost`),
 *   so the comparison is about decisions — who loses work, who over-spends,
 *   who asks — not about absolute percent.
 *
 * Usage: node burn-plan.js simulate [--scenario=NAME | --all] [--text]
 */

'use strict';

const bp = require('./burn-plan');

const TICK_MIN = 5;
const WINDOW_MIN = 300;
const WEEK_MIN = 7 * 24 * 60;
const BASE_MS = Date.parse('2026-09-21T06:00:00.000Z');
const CHECKPOINT_EVERY_MIN = 10;     // new: wip commit at least this often
const RAMP_FRACTION = 0.15;          // a fresh agent on a wip branch re-reads first
const LEGACY_DEPTH = { standard: 1.0, deep: 1.8, max: 2.6 };
const LEGACY_RESERVE_PCT = 5;
const LEGACY_BASE_PCT_PER_LANE_HOUR = 1.5;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const core = (id, size, priority = 'P2', extra = {}) => ({ id, task: `${id} (${size})`, size, priority, source: priority === 'P0' ? 'prompt' : 'issue', ...extra });
const filler = (id, size = 'S') => ({ id, task: `${id} filler`, size, priority: 'P4', source: 'discovery' });

const SCENARIOS = {
  'happy-path': {
    description: 'Enough budget and time, one lane. Everything the user asked for lands; nothing is lost.',
    plan: 'Max 20x',
    start: { weeklyUsed: 70, weeklyResetMin: 20 * 60, sessionUsed: 10, sessionResetMin: 200 },
    sessionPerWeekly: 6,
    queue: [core('p0', 'M', 'P0'), core('i1', 'M'), core('i2', 'M'), core('i3', 'L')],
    resume: { auto: 'continue', autoArmed: true },
    maxMin: 24 * 60,
  },
  'five-hour-window': {
    description: 'The 5-hour window runs out long before the weekly budget. Old: a hard stop mid-task, one resume, then stuck in the next window. New: pause at 92 %, resume after each reset.',
    plan: 'Max 20x',
    start: { weeklyUsed: 55, weeklyResetMin: 30 * 60, sessionUsed: 40, sessionResetMin: 240 },
    sessionPerWeekly: 12,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'L'), core('i3', 'L'), core('i4', 'M'), core('i5', 'M'), core('i6', 'M'), core('i7', 'M')],
    resume: { auto: 'continue', autoArmed: true },
    maxMin: 30 * 60,
  },
  'weekly-stop-other-session': {
    description: 'Another session spends 17 % of the week in one go while the burn runs; the weekly limit hits mid-task. Later the user nudges after the weekly reset.',
    plan: 'Max 20x',
    start: { weeklyUsed: 82, weeklyResetMin: 10 * 60, sessionUsed: 5, sessionResetMin: 280 },
    sessionPerWeekly: 4,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'M'), core('i3', 'M')],
    external: [{ atMin: 25, weeklyPct: 17, sessionPct: 10 }],
    resume: { auto: 'continue', autoArmed: false },
    afterStop: { manualAtMin: 11 * 60, choice: 'continue' },
    maxMin: 16 * 60,
  },
  'usage-blind': {
    description: 'The usage scraper goes blind (logged out, cache served) 30 minutes in. Old: keeps spawning on a frozen number until the limit. New: holds, then drains.',
    plan: 'Max 20x',
    start: { weeklyUsed: 78, weeklyResetMin: 40 * 60, sessionUsed: 5, sessionResetMin: 290 },
    sessionPerWeekly: 3,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'L'), core('i3', 'L'), core('i4', 'L'), core('i5', 'L'), core('i6', 'L'), core('i7', 'L'), core('i8', 'L'), core('i9', 'L')],
    usageBlindFromMin: 30,
    resume: { auto: 'continue', autoArmed: false },
    maxMin: 40 * 60,
  },
  'multi-lane-drain': {
    description: 'Lots of budget, little time, four lanes of L tasks — and tasks really cost 30 % more than estimated. Old: fixed 5 % reserve, the lanes still in flight overrun it and the limit hits during the drain. New: the reserve covers every busy lane and the over-burn drops lanes.',
    plan: 'Max 20x',
    start: { weeklyUsed: 50, weeklyResetMin: 3.5 * 60, sessionUsed: 0, sessionResetMin: 300 },
    sessionPerWeekly: 1,
    queue: Array.from({ length: 16 }, (_, i) => core(i === 0 ? 'p0' : `i${i}`, 'L', i === 0 ? 'P0' : 'P2')),
    laneCap: 4,
    trueCost: 1.3, // the estimates were 30 % too optimistic
    resume: { auto: 'continue', autoArmed: false },
    maxMin: 6 * 60,
  },
  'manual-resume-after-limit': {
    description: 'Work in another session empties the 5-hour window and stops the burn; no auto-resume was chosen. The user comes back after the reset and types "weiter". Old: the burn silently keeps burning. New: asks; the default switches the burn off.',
    plan: 'Max 20x',
    start: { weeklyUsed: 60, weeklyResetMin: 40 * 60, sessionUsed: 55, sessionResetMin: 260 },
    sessionPerWeekly: 12,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'M'), filler('f1'), filler('f2'), filler('f3'), filler('f4'), filler('f5', 'M')],
    // The user works in another session meanwhile; that is what empties the window.
    external: [{ atMin: 55, weeklyPct: 3, sessionPct: 40 }],
    resume: { auto: 'continue', autoArmed: false },
    afterStop: { manualAtMin: 7 * 60, choice: 'off' },
    maxMin: 30 * 60,
  },
  'window-pause-manual': {
    description: 'The 5-hour window fills up and no auto-resume was chosen. Old: a hard stop mid-task. New: a pause before the window runs out; hours later the user types "weiter", is asked, and the default switches the burn off.',
    plan: 'Max 20x',
    start: { weeklyUsed: 55, weeklyResetMin: 30 * 60, sessionUsed: 40, sessionResetMin: 240 },
    sessionPerWeekly: 12,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'L'), filler('f1'), filler('f2', 'M')],
    resume: { auto: 'continue', autoArmed: false },
    afterStop: { manualAtMin: 6 * 60, choice: 'off' },
    maxMin: 30 * 60,
  },
  'auto-resume-burn-off': {
    description: 'Auto-resume is armed, but the user answered "Burn abschalten" for it (F7). After the window pause the run continues without burn: filler dropped, standard depth.',
    plan: 'Max 20x',
    start: { weeklyUsed: 60, weeklyResetMin: 40 * 60, sessionUsed: 60, sessionResetMin: 200 },
    sessionPerWeekly: 12,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'M'), filler('f1'), filler('f2'), filler('f3', 'M')],
    resume: { auto: 'off', autoArmed: true },
    maxMin: 30 * 60,
  },
  'no-uplift': {
    description: 'Little budget, a big queue: a normal run spends it anyway. Old: the uplift gate cannot fire, the burn starts. New: refuses and says so.',
    plan: 'Max 20x',
    start: { weeklyUsed: 88, weeklyResetMin: 20 * 60, sessionUsed: 5, sessionResetMin: 280 },
    sessionPerWeekly: 4,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'L'), core('i3', 'L'), core('i4', 'L'), core('i5', 'L'), core('i6', 'L'), core('i7', 'L'), core('i8', 'L')],
    resume: { auto: 'continue', autoArmed: false },
    maxMin: 20 * 60,
  },
  'filler-heavy': {
    description: 'One real task plus eight discovery fillers. Old: fillers run at full depth. New: fillers stay at standard depth, the user\'s task gets the depth.',
    plan: 'Max 20x',
    start: { weeklyUsed: 70, weeklyResetMin: 20 * 60, sessionUsed: 5, sessionResetMin: 290 },
    sessionPerWeekly: 4,
    queue: [core('p0', 'L', 'P0'), ...Array.from({ length: 8 }, (_, i) => filler(`f${i + 1}`, i % 3 === 0 ? 'M' : 'S'))],
    resume: { auto: 'continue', autoArmed: false },
    maxMin: 20 * 60,
  },
  'agent-cannot-continue': {
    description: 'Like the weekly stop, but the cut-off agent cannot be continued (new session / SendMessage fails): its salvaged wip branch is picked up by a fresh agent that re-reads first.',
    plan: 'Max 20x',
    start: { weeklyUsed: 82, weeklyResetMin: 10 * 60, sessionUsed: 5, sessionResetMin: 280 },
    sessionPerWeekly: 4,
    queue: [core('p0', 'L', 'P0'), core('i1', 'L'), core('i2', 'M')],
    external: [{ atMin: 25, weeklyPct: 17, sessionPct: 10 }],
    agentContinueWorks: false,
    resume: { auto: 'continue', autoArmed: false },
    afterStop: { manualAtMin: 11 * 60, choice: 'off' },
    maxMin: 16 * 60,
  },
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function durationMin(size, cal) {
  return Math.max(TICK_MIN, Math.round((bp.SIZE_WEIGHT[size] * 60 * cal.unitCostPct) / cal.laneHourlyPct));
}

/** Legacy (#335) plan: max profile, lanes from required rate, fixed reserve. */
function legacyPlan(usage, laneCap) {
  const spendable = usage.weeklyRemaining - LEGACY_RESERVE_PCT;
  const hours = usage.weeklyResetMin / 60;
  const profile = spendable < 10 ? 'deep' : 'max';
  const required = spendable / hours;
  const lanes = Math.max(1, Math.min(laneCap, Math.ceil(required / (LEGACY_BASE_PCT_PER_LANE_HOUR * LEGACY_DEPTH[profile]))));
  return { profile, lanes };
}

function simulate(sc, protocol) {
  const isNew = protocol === 'new';
  const cal = bp.calibrationFor(null, sc.plan);
  const trueCost = sc.trueCost || 1;
  const laneCap = sc.laneCap || bp.LANE_CAP;
  const acct = {
    weeklyUsed: sc.start.weeklyUsed,
    sessionUsed: sc.start.sessionUsed,
    sessionEnd: sc.start.sessionResetMin,
    weekEnd: sc.start.weeklyResetMin,
  };
  const timeline = [];
  const log = (t, msg) => timeline.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}  ${msg}`);
  const metrics = {
    landed: [], lostWorkMin: 0, rampMin: 0, hardStops: 0, stopsDuringDrain: 0, pauses: 0,
    questions: 0, spentPct: 0, fillerSpentPct: 0, minRemainingPct: 100 - acct.weeklyUsed,
    endReason: null, endAtMin: null, burnActiveAtEnd: null, refused: null, resumes: [],
  };

  // Frozen number a blind scraper keeps serving.
  let blindSnapshot = null;
  const usageAt = (t) => {
    const raw = {
      timestamp: new Date(BASE_MS + t * 60000).toISOString(),
      plan: sc.plan,
      weekly: { pct: Math.min(100, Math.round(acct.weeklyUsed)), resetInMinutes: acct.weekEnd - t },
      session: { pct: Math.min(100, Math.round(acct.sessionUsed)), resetInMinutes: acct.sessionEnd - t },
    };
    if (sc.usageBlindFromMin != null && t >= sc.usageBlindFromMin) {
      if (!blindSnapshot) blindSnapshot = { ...raw, _cached: true, _failureReason: 'scraper profile not logged in' };
      return blindSnapshot;
    }
    return raw;
  };
  // Legacy acts on whatever the file holds — a cached number is a number.
  const legacyRemaining = (t) => 100 - usageAt(t).weekly.pct;

  const nowOf = (t) => BASE_MS + t * 60000;
  const u0 = bp.normalizeUsage(usageAt(0), nowOf(0), 10);

  // --- plan ---
  let state = null;
  let legacy = null;
  if (isNew) {
    const plan = bp.derivePlan({ usage: u0, queue: sc.queue, plan: sc.plan, laneCap });
    if (!plan.ok) {
      metrics.refused = plan.reason;
      metrics.endReason = `refused: ${plan.reason}`;
      log(0, `plan refused (${plan.reason}${plan.uplift != null ? `, uplift ${plan.uplift}×` : ''}) — a normal run is the better tool`);
      return { timeline, metrics };
    }
    state = bp.newState({
      slug: 'sim', integrationBranch: 'burn/sim', plan, queue: sc.queue, usage: u0, nowMs: nowOf(0),
      sessionId: 'S1', resumeAuto: sc.resume.auto, autoArmed: sc.resume.autoArmed,
    });
    log(0, `plan: profile ${plan.profile}, ${plan.lanes} lane(s), reserve ${plan.reservePct} %, uplift ${plan.uplift}×`);
  } else {
    const lp = legacyPlan(u0, laneCap);
    legacy = { profile: lp.profile, lanes: lp.lanes, queue: sc.queue.map((q) => ({ ...q })), draining: false, cronFiredOnce: false };
    log(0, `plan: profile ${lp.profile}, ${lp.lanes} lane(s), reserve ${LEGACY_RESERVE_PCT} % (fixed)`);
  }

  /** Runtime of in-flight tasks: work on disk vs committed, agent context. */
  const running = new Map();
  const progress = new Map(); // id → committed minutes carried over after a requeue
  let mode = 'run';           // run | stopped | paused | done
  let pauseResumeAt = null;
  let autoResumeAt = sc.resume.autoArmed ? acct.sessionEnd + bp.RESUME_BUFFER_MIN : null;

  const depthOf = (profile) => (isNew ? bp.PROFILES[profile].depthFactor : LEGACY_DEPTH[profile]);
  const isFillerTask = (t) => bp.isFiller(t);

  const startTask = (t, task, profile) => {
    const total = durationMin(task.size, cal);
    const carried = progress.get(task.id) || 0;
    const ramp = carried > 0 && !running.has(task.id) ? Math.round(total * RAMP_FRACTION) : 0;
    metrics.rampMin += ramp;
    running.set(task.id, { task, profile, total: total + ramp, done: carried, committed: carried, filler: isFillerTask(task) });
    log(t, `spawn ${task.id} (${task.size}, ${profile}${carried ? `, resumes ${carried} min of wip` : ''})`);
  };

  const hardStop = (t) => {
    mode = 'stopped';
    metrics.hardStops++;
    const draining = isNew ? state.drained : legacy.draining;
    if (draining) metrics.stopsDuringDrain++;
    log(t, `HARD STOP — ${acct.weeklyUsed >= 100 ? 'weekly' : '5-hour'} limit hit with ${running.size} task(s) in flight${draining ? ' (during the drain)' : ''}`);
  };

  const resumeNew = (t, trigger, choice) => {
    const usage = bp.normalizeUsage(usageAt(t), nowOf(t), 10);
    const r = bp.applyResume(state, { trigger, choice, usage, nowMs: nowOf(t), sessionId: 'S1' });
    state = r.state;
    metrics.resumes.push({ atMin: t, trigger, requested: r.requested, applied: r.applied, why: r.why });
    log(t, `resume (${trigger}): asked ${r.requested} → ${r.applied}${r.why ? ` (${r.why})` : ''}; burn ${state.burn.active ? `on, ${state.profile} × ${state.lanes}` : 'off'}`);
    // resume-check: the files on disk survived; salvage them as wip.
    for (const [id, rt] of running) {
      const info = { id, dirty: rt.done > rt.committed, commitsAhead: rt.committed > 0 ? 1 : 0, wip: true, agentId: 'A-' + id, sessionId: 'S1' };
      const cls = bp.classifyInFlight(info, { sessionId: sc.agentContinueWorks === false ? 'S2' : 'S1' });
      rt.committed = rt.done; // salvage commit
      if (cls.action === 'continue-agent') {
        log(t, `  ${id}: salvage + continue the agent with its context`);
      } else {
        progress.set(id, rt.committed);
        running.delete(id);
        state = bp.requeueTask(state, id, { branch: `burn/sim-${id}`, note: 'after a hard stop' }, nowOf(t));
        log(t, `  ${id}: salvage + requeue on its wip branch`);
      }
    }
    mode = 'run';
  };

  const resumeLegacy = (t) => {
    // Resume checks commits only; "commit before returning" left none.
    for (const [id, rt] of running) {
      metrics.lostWorkMin += rt.done;
      legacy.queue.unshift({ ...rt.task });
      log(t, `  ${id}: no commits → requeued from scratch (${rt.done} min of work discarded)`);
    }
    running.clear();
    metrics.resumes.push({ atMin: t, trigger: 'silent', requested: 'continue', applied: 'continue' });
    log(t, `resume: burn continues silently (${legacy.profile} × ${legacy.lanes}) — nobody was asked`);
    mode = 'run';
  };

  for (let t = 0; t <= sc.maxMin; t += TICK_MIN) {
    // --- the world ---
    for (const e of sc.external || []) {
      if (e.atMin === t) {
        acct.weeklyUsed = Math.min(100, acct.weeklyUsed + e.weeklyPct);
        acct.sessionUsed = Math.min(100, acct.sessionUsed + (e.sessionPct || 0));
        log(t, `another session spends ${e.weeklyPct} % of the week`);
      }
    }
    if (t >= acct.sessionEnd) { acct.sessionUsed = 0; acct.sessionEnd += WINDOW_MIN; }
    if (t >= acct.weekEnd) { acct.weeklyUsed = 0; acct.weekEnd += WEEK_MIN; log(t, 'weekly reset'); }
    const limited = () => acct.weeklyUsed >= 100 || acct.sessionUsed >= 100;
    if (mode === 'run' && limited()) hardStop(t);

    // --- waking up ---
    if (mode === 'stopped' && !limited()) {
      const manual = sc.afterStop && sc.afterStop.manualAtMin != null && t >= sc.afterStop.manualAtMin && !metrics.resumes.some((r) => r.trigger === 'manual');
      const auto = autoResumeAt != null && t >= autoResumeAt;
      if (isNew && (manual || auto)) {
        if (manual) metrics.questions++;
        const trigger = manual ? 'manual' : 'auto';
        const choice = manual ? (sc.afterStop.choice || 'off') : state.resume.auto;
        if (manual) log(t, 'user types "weiter" → prompt.burn.resume asks: Burn abschalten / Burn fortsetzen / Run beenden');
        autoResumeAt = null;
        resumeNew(t, trigger, choice);
      } else if (!isNew && (manual || (auto && !legacy.cronFiredOnce))) {
        if (auto) legacy.cronFiredOnce = true; // one-shot AUTONOMOUS_RESUME cron
        autoResumeAt = null;
        resumeLegacy(t);
      }
    }
    if (mode === 'paused' && t >= pauseResumeAt && !limited()) {
      if (state.resume.autoArmed) {
        metrics.pauses++;
        resumeNew(t, 'auto', state.resume.auto);
      } else if (sc.afterStop && sc.afterStop.manualAtMin != null && t >= sc.afterStop.manualAtMin) {
        // no cron: the run waits for the user; their "weiter" is asked
        metrics.pauses++;
        metrics.questions++;
        log(t, 'user types "weiter" → prompt.burn.resume asks: Burn abschalten / Burn fortsetzen / Run beenden');
        resumeNew(t, 'manual', sc.afterStop.choice || 'off');
      }
    }
    if (mode !== 'run') continue;

    // --- lanes work ---
    let spent = 0;
    for (const [id, rt] of running) {
      rt.done = Math.min(rt.total, rt.done + TICK_MIN);
      if (isNew) rt.committed = Math.floor(rt.done / CHECKPOINT_EVERY_MIN) * CHECKPOINT_EVERY_MIN;
      const pct = (cal.laneHourlyPct * depthOf(rt.profile) * trueCost * TICK_MIN) / 60;
      spent += pct;
      if (rt.filler) metrics.fillerSpentPct += pct;
      if (rt.done >= rt.total) {
        running.delete(id);
        progress.delete(id);
        metrics.landed.push({ id, filler: rt.filler, profile: rt.profile, atMin: t });
        if (isNew) state = bp.landTask(state, id, { sha: `sha-${id}` }, nowOf(t));
        log(t, `land ${id}`);
      }
    }
    acct.weeklyUsed = Math.min(100, acct.weeklyUsed + spent);
    acct.sessionUsed = Math.min(100, acct.sessionUsed + spent * sc.sessionPerWeekly);
    metrics.spentPct += spent;
    metrics.minRemainingPct = Math.min(metrics.minRemainingPct, 100 - acct.weeklyUsed);
    if (limited()) { hardStop(t); continue; }

    // --- decisions ---
    if (isNew) {
      for (let guard = 0; guard < laneCap + 1; guard++) {
        const usage = bp.normalizeUsage(usageAt(t), nowOf(t), bp.USAGE_FRESH_MIN);
        const g = bp.gate(state, usage, nowOf(t), null, { claim: true });
        state = g.state;
        if (g.rearmResumeCron && state.resume.autoArmed) {
          state.resume.cronFor = g.rearmResumeCron.windowResetAt;
          autoResumeAt = acct.sessionEnd + bp.RESUME_BUFFER_MIN;
        }
        if (g.decision === 'spawn') { startTask(t, g.task, g.taskProfile); continue; }
        if (g.decision === 'hold') { log(t, `hold — usage unknown (${g.holds}/${bp.HOLD_LIMIT})`); break; }
        if (g.decision === 'pause') {
          mode = 'paused';
          pauseResumeAt = acct.sessionEnd + bp.RESUME_BUFFER_MIN;
          log(t, `pause — 5-hour window at ${Math.round(acct.sessionUsed)} %, resume after its reset`);
          break;
        }
        if (g.decision === 'finish') {
          mode = 'done';
          metrics.endReason = g.reason;
          metrics.endAtMin = t;
          log(t, `finish (${g.reason})`);
          break;
        }
        if (g.decision === 'wait' && g.reason === 'draining' && guard === 0 && state.drained && !metrics._drainLogged) {
          metrics._drainLogged = true;
          log(t, `drain (${g.drainReason}) — no new spawns, ${running.size} lane(s) finishing`);
        }
        break;
      }
    } else {
      if (!legacy.draining && legacyRemaining(t) <= LEGACY_RESERVE_PCT) {
        legacy.draining = true;
        log(t, `drain (reserve ${LEGACY_RESERVE_PCT} %) — ${running.size} lane(s) finishing`);
      }
      if (!legacy.draining) {
        while (running.size < legacy.lanes && legacy.queue.length) {
          const task = legacy.queue.shift();
          const profile = task.mechanical ? 'standard' : legacy.profile;
          startTask(t, task, profile);
        }
      }
      if (!running.size && (legacy.draining || !legacy.queue.length)) {
        mode = 'done';
        metrics.endReason = legacy.draining ? 'reserve' : 'queue-empty';
        metrics.endAtMin = t;
        log(t, `finish (${metrics.endReason})`);
      }
    }
    if (mode === 'done') break;
  }

  if (!metrics.endReason) {
    metrics.endReason = mode === 'stopped' ? 'stuck after a hard stop' : mode === 'paused' ? 'paused' : 'time-out';
    metrics.endAtMin = sc.maxMin;
    for (const rt of running.values()) if (mode === 'stopped' && !isNew) metrics.lostWorkMin += rt.done;
  }
  metrics.burnActiveAtEnd = isNew ? !!state.burn.active : true;
  metrics.spentPct = Math.round(metrics.spentPct * 10) / 10;
  metrics.fillerSpentPct = Math.round(metrics.fillerSpentPct * 10) / 10;
  metrics.minRemainingPct = Math.round(metrics.minRemainingPct * 10) / 10;
  delete metrics._drainLogged;
  return { timeline, metrics, state };
}

function summarize(metrics, sc) {
  const coreIds = sc.queue.filter((q) => !bp.isFiller(q)).map((q) => q.id);
  return {
    landedCore: metrics.landed.filter((l) => !l.filler).length,
    coreTasks: coreIds.length,
    landedFiller: metrics.landed.filter((l) => l.filler).length,
    lostWorkMin: metrics.lostWorkMin,
    rampMin: metrics.rampMin,
    hardStops: metrics.hardStops,
    stopsDuringDrain: metrics.stopsDuringDrain,
    pauses: metrics.pauses,
    questions: metrics.questions,
    spentPct: metrics.spentPct,
    fillerSpentPct: metrics.fillerSpentPct,
    minRemainingPct: metrics.minRemainingPct,
    endReason: metrics.endReason,
    burnActiveAtEnd: metrics.burnActiveAtEnd,
    refused: metrics.refused,
    resumes: metrics.resumes,
  };
}

function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`unknown scenario: ${name} (known: ${Object.keys(SCENARIOS).join(', ')})`);
  const current = simulate(sc, 'current');
  const next = simulate(sc, 'new');
  return {
    name,
    description: sc.description,
    outcome: { current: summarize(current.metrics, sc), new: summarize(next.metrics, sc) },
    timeline: { current: current.timeline, new: next.timeline },
    finalState: next.state || null,
  };
}

function formatResult(r) {
  const row = (label, o) => `  ${label.padEnd(8)} core ${o.landedCore}/${o.coreTasks} · filler ${o.landedFiller} · lost ${o.lostWorkMin} min · hard stops ${o.hardStops}${o.stopsDuringDrain ? ` (${o.stopsDuringDrain} in drain)` : ''} · questions ${o.questions} · spent ${o.spentPct} % · end: ${o.endReason}`;
  return [
    `■ ${r.name}`,
    `  ${r.description}`,
    row('current', r.outcome.current),
    row('new', r.outcome.new),
    '  new timeline:',
    ...r.timeline.new.map((l) => `    ${l}`),
  ].join('\n');
}

if (require.main === module) {
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(SCENARIOS);
  process.stdout.write(names.map((n) => formatResult(runScenario(n))).join('\n\n') + '\n');
}

module.exports = { SCENARIOS, simulate, runScenario, formatResult, durationMin, legacyPlan };
