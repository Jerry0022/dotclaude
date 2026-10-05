/**
 * @module governor-gate
 * @description local-llm's side of the devops load governor, file-only (no
 *   dependency on the devops plugin):
 *   - check(): before a local completion, read ~/.claude/governor/state.json;
 *     when an app has priority on GPU or RAM, or the 80 % budget is exceeded,
 *     the request is deferred so Claude does the task itself.
 *   - mark(): the in-flight marker the governor's self-loop guard reads — the
 *     backend's load counts as Claude's while a request runs or ended < 60 s ago.
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

function mark(active, now = Date.now()) {
  try {
    const dir = path.join(home(), 'inflight');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'local-llm.json');
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(active ? { active: true, startedAt: now } : { active: false, endedAt: now }));
    fs.renameSync(tmp, file);
  } catch { /* fail open */ }
}

module.exports = { check, mark, home };
