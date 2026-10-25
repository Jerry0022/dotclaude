'use strict';
/**
 * @module hook-telemetry
 * @version 0.2.0
 * @plugin devops
 * @description Fail-safe hook telemetry. Silent hooks never show up in a
 *   transcript, so an audit of hook cost and timeouts was blind for them.
 *   Loaded by lib/plugin-guard.js (the first line of every hook) once the
 *   plugin is known to be enabled; costs two small appends (< 1 ms each).
 *
 *   File: ~/.claude/devops-hook-telemetry.jsonl (env DEVOPS_HOOK_TELEMETRY
 *   overrides the path; `off` disables). Rotated at 1 MB, one `.1` kept.
 *   Two records per run:
 *     start  {ts, id, hook, phase:'start'}
 *     end    {ts, id, hook, phase:'end', event, tool, ms, outcome, chars}
 *   outcome: ok (no output) | output (stdout written) | block (exit 2) |
 *   error (other non-zero exit). A start without an end = the process was
 *   killed (hook timeout). event/tool come from parseHookInput via note().
 *
 *   Dispatcher (hooks/dispatch/dispatch.js): every module runs in a worker
 *   thread of one process; its run id comes from the dispatcher
 *   (workerData.telemetryId) so pid-based ids cannot collide. The dispatcher
 *   writes a module's end record itself when it kills or skips the module:
 *     end    {…, phase:'end', outcome:'timeout'|'skipped', dispatched:true}
 *   killRates() counts both as killed runs. The dispatcher's own run is
 *   named `dispatch:<Event>` (setHook).
 *
 *   Never throws, never writes to stdout/stderr, never changes an exit code.
 *   Skipped under vitest unless the env path is set explicitly (tests of other
 *   hooks must not write the user's real file).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const DIR_EVENT = {
  'pre-tool-use': 'PreToolUse', 'post-tool-use': 'PostToolUse', 'session-start': 'SessionStart', stop: 'Stop',
  'user-prompt-submit': 'UserPromptSubmit', prompt: 'UserPromptSubmit',
};
const state = { on: false, id: null, hook: '', event: '', tool: '', t0: 0, chars: 0 };

function filePath() {
  const env = process.env.DEVOPS_HOOK_TELEMETRY;
  if (env && !/^(off|0|false)$/i.test(env)) return env;
  if (env) return null;
  if (process.env.VITEST) return null;
  return path.join(os.homedir(), '.claude', 'devops-hook-telemetry.jsonl');
}

/** Run id handed in by the dispatcher when this hook runs in its worker. */
function workerId() {
  try {
    const wt = require('worker_threads');
    if (!wt.isMainThread && wt.workerData && typeof wt.workerData.telemetryId === 'string') return wt.workerData.telemetryId;
  } catch { /* no worker_threads */ }
  return null;
}

function append(file, rec) {
  fs.appendFileSync(file, `${JSON.stringify(rec)}\n`);
}

function rotateIfBig(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch { /* none yet, or raced with a parallel hook */ }
}

/** Attach the payload's event and tool to this run's end record. */
function note(hook) {
  if (!state.on || !hook || typeof hook !== 'object') return;
  if (typeof hook.hook_event_name === 'string') state.event = hook.hook_event_name;
  if (typeof hook.tool_name === 'string') state.tool = hook.tool_name;
}

/** Rename this run's hook (the dispatcher: `dispatch:<Event>`). */
function setHook(name) {
  if (typeof name === 'string' && name) state.hook = name;
}

/**
 * Append one record on behalf of another run (the dispatcher's end record of
 * a module it killed or skipped). Fail-safe like everything here.
 */
function record(rec) {
  try {
    const file = filePath();
    if (!file || !rec || typeof rec !== 'object') return;
    append(file, { ts: Date.now(), ...rec });
  } catch { /* fail-safe */ }
}

function start() {
  if (state.on) return;
  try {
    const file = filePath();
    if (!file) return;
    state.hook = path.basename(process.argv[1] || 'unknown', '.js');
    const dir = path.basename(path.dirname(process.argv[1] || ''));
    state.event = DIR_EVENT[dir] || '';
    state.t0 = Date.now();
    state.id = workerId() || `${process.pid}-${state.t0.toString(36)}`;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* exists */ }
    rotateIfBig(file);
    append(file, { ts: state.t0, id: state.id, hook: state.hook, phase: 'start' });
    state.on = true;
    const realWrite = process.stdout.write;
    process.stdout.write = function write(chunk, ...rest) {
      try { state.chars += typeof chunk === 'string' ? chunk.length : (chunk && chunk.length) || 0; } catch { /* count only */ }
      return realWrite.call(this, chunk, ...rest);
    };
    process.on('exit', (code) => {
      try {
        const c = code;
        const outcome = c === 2 ? 'block' : (c ? 'error' : (state.chars ? 'output' : 'ok'));
        append(file, {
          ts: Date.now(), id: state.id, hook: state.hook, phase: 'end', event: state.event, tool: state.tool,
          ms: Date.now() - state.t0, outcome, chars: state.chars,
        });
      } catch { /* telemetry never disturbs a hook */ }
    });
  } catch { /* fail-safe */ }
}

/**
 * Per-hook kill rate over each hook's last `window` runs.
 * A start with no end that is older than `graceMs` counts as killed.
 * @returns {Array<{hook:string, runs:number, killed:number, rate:number}>}
 */
function killRates(file, { window = 200, graceMs = 120000, now = Date.now(), tailBytes = 1024 * 1024 } = {}) {
  let text = '';
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.min(size, tailBytes);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return []; }
  const runs = new Map(); // id -> {hook, ts, ended}
  for (const line of text.split('\n')) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || !r.id || !r.hook) continue;
    if (r.phase === 'start') runs.set(r.id, { hook: r.hook, ts: r.ts, ended: runs.has(r.id) && runs.get(r.id).ended });
    else if (r.phase === 'end') {
      const killed = r.outcome === 'timeout' || r.outcome === 'skipped';
      runs.set(r.id, { hook: r.hook, ts: (runs.get(r.id) || r).ts, ended: !killed, final: killed });
    }
  }
  const byHook = new Map();
  for (const run of [...runs.values()].sort((a, b) => a.ts - b.ts)) {
    if (!run.ended && !run.final && now - run.ts < graceMs) continue; // maybe still running
    if (!byHook.has(run.hook)) byHook.set(run.hook, []);
    byHook.get(run.hook).push(run);
  }
  const out = [];
  for (const [hook, list] of byHook) {
    const last = list.slice(-window);
    const killed = last.filter((r) => !r.ended).length;
    out.push({ hook, runs: last.length, killed, rate: killed / last.length });
  }
  return out;
}

module.exports = { start, note, setHook, record, killRates, filePath, MAX_BYTES };
