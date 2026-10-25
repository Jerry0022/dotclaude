#!/usr/bin/env node
'use strict';
/**
 * @hook dispatch
 * @version 0.1.1
 * @event SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop
 * @plugin devops
 * @description One process per hook event. `node dispatch.js <Event>` is the
 *   only command hooks.json registers per event; it reads the roster in
 *   hooks/dispatch/manifest.json (the former hooks.json, same shape), picks
 *   the modules whose matcher Claude Code would have matched, runs each and
 *   folds their replies into one (dispatch/merge.js). Before: ~17 node starts
 *   per Bash call and ~25 per SessionStart; now one per event (2 per Bash
 *   call: PreToolUse + PostToolUse).
 *
 *   Decisions (the user's constraint: no loss of determinism or quality):
 *
 *   1. Combined output — see the merge table in dispatch/merge.js. Every
 *      module runs; a block never short-circuits the rest, because separate
 *      hooks all ran too (their side effects — run-contract bookkeeping,
 *      markers, telemetry — must still happen). The block wins: any exit 2 →
 *      the dispatcher exits 2 with every block text on stderr; JSON verdicts
 *      combine deny > defer > ask > allow; every additionalContext and
 *      systemMessage is kept, in manifest order. The exit-2 message prefix
 *      Claude Code adds names the dispatcher command instead of the hook file.
 *
 *   2. Matchers — dispatch/matcher.js ports Claude Code's matcher function
 *      (exact lists, unanchored RegExp, legacy tool aliases). hooks.json is
 *      GENERATED from the manifest (dispatch/build-hooks-json.js): one entry
 *      per event whose matcher is the union of the module matchers (omitted
 *      when any module matches everything). manifest.test.js fails when
 *      hooks.json drifts from the manifest. Edit matchers in the manifest,
 *      then run `node plugins/devops/hooks/dispatch/build-hooks-json.js`.
 *
 *   3. Isolation — each module runs in its own worker thread
 *      (dispatch/worker-boot.js): fresh module registry, own process.exit /
 *      exitCode / env copy, captured stdout/stderr, stdin fed the payload,
 *      fd-0 reads and fd-1/2 writeSync shimmed. Modules run in LANES
 *      (dispatch/lanes.js → lanes.json): lanes run in parallel, like the
 *      separate processes did; inside a lane modules run one at a time in
 *      manifest order (the next worker is created while the current one
 *      runs). Two modules share a lane when both reach a lib that names its
 *      temp file by the pid alone (`<file>.${process.pid}.tmp`) — threads of
 *      one process share that pid and could interleave writes into one temp
 *      file. Without lanes.json every module runs in one sequential lane. A
 *      module that cannot run in
 *      a worker gets `"isolate": "process"` (child process, run alongside) or
 *      `"dispatch": false` (stays its own hooks.json entry). Today: none.
 *
 *   4. Time budget — a module's budget is its own manifest timeout (60 s when
 *      unset), counted from its start; the event's budget is the largest
 *      module timeout, counted from this process's start; the dispatcher
 *      entry's hooks.json timeout is that plus HEADROOM_S, so Claude Code
 *      never kills the dispatcher while it merges. A module over its budget is
 *      terminated (worker.terminate() also stops a busy loop), one with less
 *      than MIN_START_MS of event budget left is skipped; both contribute
 *      nothing and get a telemetry record. That is exactly what a timed-out
 *      hook was before: Claude Code treats a killed hook as a non-blocking
 *      error, so EVERY gate fails open on a timeout today — `onFailure` in
 *      the manifest is not a Claude Code field (absent from the 2.1.270
 *      binary) and stays plugin metadata. A module that crashes or exits 1
 *      fails open the same way (its JSON stdout is still honoured, as Claude
 *      Code does).
 *
 *   5. Telemetry — lib/hook-telemetry.js: each module's own start/end records
 *      as before (run id from the dispatcher), plus `dispatch:<Event>` for
 *      the dispatcher run and timeout/skipped end records written here.
 *
 *   6. Opt-out — DEVOPS_HOOK_DISPATCH=0 (or off/false) runs every module as
 *      its own `node <file>` child process, all in parallel, each with its
 *      own timeout — the old process model, merged by the same rules.
 */

const path = require('path');
const fs = require('fs');

const { matches, queryFor } = require('./matcher');
const { mergeResults } = require('./merge');

const HOOKS_DIR = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.resolve(HOOKS_DIR, '..');
const MANIFEST = path.join(__dirname, 'manifest.json');
const LANES = path.join(__dirname, 'lanes.json');
const DEFAULT_TIMEOUT_S = 60;
const HEADROOM_S = 5;
const MIN_START_MS = 250;

function telemetry() {
  try { return require('../lib/hook-telemetry'); } catch { return null; }
}

function dispatchDisabled(env = process.env) {
  return /^(0|off|false|no)$/i.test(String(env.DEVOPS_HOOK_DISPATCH || '').trim());
}

/** `node "${CLAUDE_PLUGIN_ROOT}/hooks/x/y.js"` → absolute path, or null. */
function moduleFile(command, pluginRoot = PLUGIN_ROOT) {
  const m = /\$\{CLAUDE_PLUGIN_ROOT\}[\\/]([^"']+?\.(?:c?js|mjs))/.exec(String(command || ''));
  return m ? path.join(pluginRoot, m[1]) : null;
}

function loadManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** dispatch/lanes.json, or null when missing/unreadable (→ one sequential lane). */
function loadLanes(file = LANES) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' && j.lanes && typeof j.lanes === 'object' ? j.lanes : null;
  } catch { return null; }
}

/**
 * Group the selected modules (indices) into lanes. A module the lane table
 * does not know — or no table at all — joins one shared sequential lane.
 * @param {Array<{name:string}>} modules
 * @param {string[][]|undefined} eventLanes
 * @returns {number[][]}
 */
function laneGroups(modules, eventLanes) {
  const laneOf = new Map();
  (Array.isArray(eventLanes) ? eventLanes : []).forEach((names, li) => {
    for (const n of names) if (!laneOf.has(n)) laneOf.set(n, li);
  });
  const groups = new Map();
  modules.forEach((m, i) => {
    const key = laneOf.has(m.name) ? `l${laneOf.get(m.name)}` : 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups.values()];
}

/**
 * Every module the manifest registers for an event, in manifest order.
 * @returns {Array<{name:string, file:string, command:string, matcher?:string, timeoutS:number, isolate:string, dispatch:boolean, onFailure?:string}>}
 */
function eventModules(manifest, event, pluginRoot = PLUGIN_ROOT) {
  const groups = (manifest && manifest.hooks && manifest.hooks[event]) || [];
  const out = [];
  for (const g of groups) {
    for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
      const file = moduleFile(h.command, pluginRoot);
      if (!file) continue;
      out.push({
        name: path.basename(file).replace(/\.(c?js|mjs)$/, ''),
        file,
        command: h.command,
        matcher: g.matcher,
        timeoutS: typeof h.timeout === 'number' && h.timeout > 0 ? h.timeout : DEFAULT_TIMEOUT_S,
        isolate: h.isolate === 'process' ? 'process' : 'worker',
        dispatch: h.dispatch !== false,
        onFailure: h.onFailure,
      });
    }
  }
  return out;
}

/** The event's budget in seconds: its largest module timeout. */
function eventBudgetS(modules) {
  return modules.reduce((m, x) => Math.max(m, x.timeoutS), 0) || DEFAULT_TIMEOUT_S;
}

function selectModules(manifest, event, payload, pluginRoot = PLUGIN_ROOT) {
  const query = queryFor(event, payload);
  return eventModules(manifest, event, pluginRoot).filter((m) => m.dispatch && matches(query, m.matcher));
}

function collect(stream, sink) {
  if (stream) stream.on('data', (d) => { sink.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))); });
}

function newId(name, i) {
  return `${process.pid}-${Date.now().toString(36)}-${i}-${name}`;
}

/** Create a worker for `mod`, waiting for `go`. */
function prepareWorker(mod, raw, telemetryId) {
  const { Worker } = require('worker_threads');
  const out = [];
  const err = [];
  const worker = new Worker(path.join(__dirname, 'worker-boot.js'), {
    workerData: { file: mod.file, payload: raw, wait: true, telemetryId },
    stdout: true,
    stderr: true,
    env: { ...process.env },
  });
  collect(worker.stdout, out);
  collect(worker.stderr, err);
  const exited = new Promise((resolve) => {
    let error = null;
    worker.on('error', (e) => { error = e; });
    worker.on('exit', (code) => setImmediate(() => resolve({ code, error })));
  });
  return { worker, out, err, exited };
}

/**
 * Run one prepared worker to completion or its deadline.
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean, ms:number}>}
 */
async function runPrepared(prep, raw, budgetMs) {
  const t0 = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; prep.worker.terminate().catch(() => {}); }, Math.max(1, budgetMs));
  prep.worker.postMessage('go');
  const { code, error } = await prep.exited;
  clearTimeout(timer);
  let stderr = Buffer.concat(prep.err).toString('utf8');
  if (error && !timedOut) stderr += `${error && error.stack ? error.stack : String(error)}\n`;
  return {
    code: timedOut ? 1 : (error ? 1 : (code || 0)),
    stdout: timedOut ? '' : Buffer.concat(prep.out).toString('utf8'),
    stderr: timedOut ? '' : stderr,
    timedOut,
    ms: Date.now() - t0,
  };
}

/** Run one module as its own `node <file>` process (the old model). */
function runProcess(mod, raw, budgetMs) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = [];
    const err = [];
    let timedOut = false;
    let child;
    try {
      child = spawn(process.execPath, [mod.file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env });
    } catch (e) {
      resolve({ code: 1, stdout: '', stderr: String(e && e.message), timedOut: false, ms: 0 });
      return;
    }
    collect(child.stdout, out);
    collect(child.stderr, err);
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* gone */ } }, Math.max(1, budgetMs));
    child.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 1 : (code === null ? 1 : code),
        stdout: timedOut ? '' : Buffer.concat(out).toString('utf8'),
        stderr: timedOut ? '' : Buffer.concat(err).toString('utf8'),
        timedOut,
        ms: Date.now() - t0,
      });
    });
    try { child.stdin.on('error', () => {}); child.stdin.end(raw); } catch { /* closed */ }
  });
}

/**
 * Run the selected modules and merge.
 * @param {{event:string, raw:string, modules:Array, budgetS:number, startedAt?:number, processMode?:boolean, tele?:object, lanes?:string[][]}} o
 * @returns {Promise<{code:number, stdout:string, stderr:string, results:Array}>}
 */
async function runEvent(o) {
  const startedAt = o.startedAt || Date.now();
  const eventDeadline = startedAt + o.budgetS * 1000;
  const tele = o.tele === undefined ? telemetry() : o.tele;
  const results = new Array(o.modules.length);
  const left = () => eventDeadline - Date.now();
  const note = (mod, r, id) => {
    if (!tele || !(r.timedOut || r.skipped)) return;
    tele.record({ id, hook: mod.name, phase: 'end', event: o.event, ms: r.ms || 0, outcome: r.timedOut ? 'timeout' : 'skipped', chars: 0, dispatched: true });
  };
  const budgetFor = (mod) => Math.min(mod.timeoutS * 1000, left());

  // process-isolated modules (or all, when dispatch is off): parallel, like separate hooks
  const procIdx = o.modules.map((m, i) => (o.processMode || m.isolate === 'process' ? i : -1)).filter((i) => i >= 0);
  const procRuns = procIdx.map((i) => runProcess(o.modules[i], o.raw, budgetFor(o.modules[i])).then((r) => {
    // No dispatcher end record: the child writes its own start under its own
    // id, and a start without an end already counts as a killed run.
    results[i] = { name: o.modules[i].name, ...r };
  }));

  const workerIdx = o.modules.map((_, i) => i).filter((i) => !procIdx.includes(i));
  const lanes = laneGroups(workerIdx.map((i) => o.modules[i]), o.lanes).map((g) => g.map((k) => workerIdx[k]));
  const runLane = async (lane) => {
    let next = null;
    for (let k = 0; k < lane.length; k++) {
      const i = lane[k];
      const mod = o.modules[i];
      // A worker prepared ahead already carries its run id: the end record
      // must use the same one, or one kill counts twice.
      const ahead = next && next.i === i ? next : null;
      const id = ahead ? ahead.id : newId(mod.name, i);
      const prep = ahead ? ahead.prep : null;
      next = null;
      if (left() < MIN_START_MS) {
        if (prep) prep.worker.terminate().catch(() => {});
        results[i] = { name: mod.name, code: 0, stdout: '', stderr: '', skipped: true, ms: 0 };
        note(mod, results[i], id);
        continue;
      }
      try {
        const p = prep || prepareWorker(mod, o.raw, id);
        const j = lane[k + 1];
        if (j !== undefined) {
          const jid = newId(o.modules[j].name, j);
          try { next = { i: j, id: jid, prep: prepareWorker(o.modules[j], o.raw, jid) }; } catch { next = null; }
        }
        results[i] = { name: mod.name, ...(await runPrepared(p, o.raw, budgetFor(mod))) };
      } catch (e) {
        results[i] = { name: mod.name, code: 1, stdout: '', stderr: String(e && e.message), ms: 0 };
      }
      note(mod, results[i], id);
    }
    if (next) next.prep.worker.terminate().catch(() => {});
  };
  await Promise.all(lanes.map(runLane));
  await Promise.all(procRuns);
  const merged = mergeResults(o.event, results);
  return { ...merged, results };
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    const chunks = [];
    process.stdin.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function main() {
  const startedAt = Date.now() - Math.round(process.uptime() * 1000);
  const event = String(process.argv[2] || '');
  const tele = telemetry();
  if (tele) tele.setHook(`dispatch:${event}`);
  const raw = await readStdin();
  let payload = null;
  try { payload = require('../lib/hook-input').parseHookInput(raw); } catch { /* matcher falls back to all */ }
  let manifest;
  try { manifest = loadManifest(); } catch { return { code: 0, stdout: '', stderr: '' }; }
  const all = eventModules(manifest, event).filter((m) => m.dispatch);
  if (!all.length) return { code: 0, stdout: '', stderr: '' };
  const modules = selectModules(manifest, event, payload);
  if (!modules.length) return { code: 0, stdout: '', stderr: '' };
  const lanes = loadLanes();
  return runEvent({ event, raw, modules, budgetS: eventBudgetS(all), startedAt, processMode: dispatchDisabled(), tele, lanes: lanes ? lanes[event] : undefined });
}

if (require.main === module) {
  require('../lib/plugin-guard'); // exits 0 when the plugin is off for this project
  main().then((r) => {
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.stdout) process.stdout.write(r.stdout);
    // exitCode, not exit(): the process ends once both pipes drained; the
    // unref'd timer only fires if a stray handle keeps the loop alive
    process.exitCode = r.code || 0;
    setTimeout(() => process.exit(r.code || 0), 2000).unref();
  }, () => { process.exitCode = 0; }); // the dispatcher itself fails open
}

module.exports = {
  moduleFile, loadManifest, loadLanes, laneGroups, eventModules, eventBudgetS, selectModules, runEvent, dispatchDisabled,
  DEFAULT_TIMEOUT_S, HEADROOM_S, MIN_START_MS, MANIFEST,
};
