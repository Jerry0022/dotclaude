/**
 * @module governor-gate
 * @description local-llm's side of the devops load governor, file-only (no
 *   dependency on the devops plugin):
 *   - check(): before a local completion, read ~/.claude/governor/state.json;
 *     when an app has priority on GPU or RAM, or the 80 % budget is exceeded,
 *     the request is deferred so Claude does the task itself.
 *   - begin()/end(): the in-flight marker the governor's self-loop guard
 *     reads. A COUNTER (not a boolean) so concurrent completions in one
 *     process don't race: the count only reaches 0 after the last one ends.
 *     One file per process (inflight/local-llm/<pid>.json) so several MCP
 *     processes don't clobber each other.
 *   Fail open: no state, a stale heartbeat (> 15 s) or any read error → run.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function home() {
  return process.env.DOTCLAUDE_GOVERNOR_HOME || path.join(os.homedir(), '.claude', 'governor');
}

/** @returns {{defer:boolean, reason?:string}} */
function check(now = Date.now(), staleMs = 15000) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home(), 'state.json'), 'utf8'));
    if (!s || !Number.isFinite(s.heartbeat) || now - s.heartbeat > staleMs) return { defer: false };
    const p = s.pressure || {};
    const prio = (p.priority || []).filter((r) => r === 'gpu' || r === 'ram');
    if (prio.length) return { defer: true, reason: `priority on ${prio.join(',')}${s.priorityBy ? ` (${s.priorityBy})` : ''}` };
    if ((p.over || []).length) return { defer: true, reason: `over budget on ${p.over.join(',')}` };
    return { defer: false };
  } catch { return { defer: false }; }
}

let count = 0;

function write(obj) {
  try {
    const dir = path.join(home(), 'inflight', 'local-llm');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${process.pid}.json`);
    const tmp = `${file}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch { /* fail open */ }
}

function begin(now = Date.now()) { count += 1; write({ count, updatedAt: now }); }
function end(now = Date.now()) { count = Math.max(0, count - 1); write(count > 0 ? { count, updatedAt: now } : { count: 0, endedAt: now }); }

/** Wrap an async body with begin/end even on throw. */
async function during(fn) { begin(); try { return await fn(); } finally { end(); } }

module.exports = { check, begin, end, during, home };
