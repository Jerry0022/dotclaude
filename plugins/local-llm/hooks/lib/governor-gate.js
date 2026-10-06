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
 *   Fail open: no state, a stale heartbeat (> 60 s; the governor ticks every
 *   20 s when idle) or any read error → run.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function home() {
  return process.env.DOTCLAUDE_GOVERNOR_HOME || path.join(os.homedir(), '.claude', 'governor');
}

/**
 * One event line in the governor's bounded log (same format as devops'
 * scripts/governor/log.js; no cross-plugin require): the live watcher's run
 * file when named in a fresh state, else logs/hooks.jsonl (rotated at 1 MB).
 */
function logEvent(ev, fields, state, now = Date.now()) {
  try {
    const logs = path.join(home(), 'logs');
    fs.mkdirSync(logs, { recursive: true });
    let file = path.join(logs, 'hooks.jsonl');
    if (state && state.logFile && /^run-[\w.-]+\.jsonl$/.test(state.logFile) && fs.existsSync(path.join(logs, state.logFile))) file = path.join(logs, state.logFile);
    else { try { if (fs.statSync(file).size >= 1024 * 1024) fs.renameSync(file, path.join(logs, 'hooks.1.jsonl')); } catch {} }
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date(now).toISOString(), src: 'local-llm', ev, ...fields })}\n`);
  } catch { /* never throw */ }
}

/** @returns {{defer:boolean, reason?:string}} */
function check(now = Date.now(), staleMs = 60000) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home(), 'state.json'), 'utf8'));
    if (!s || !Number.isFinite(s.heartbeat) || now - s.heartbeat > staleMs) return { defer: false };
    const p = s.pressure || {};
    const prio = (p.priority || []).filter((r) => r === 'gpu' || r === 'ram');
    let reason = null;
    if (prio.length) reason = `priority on ${prio.join(',')}${s.priorityBy ? ` (${s.priorityBy})` : ''}`;
    else if ((p.over || []).length) reason = `over budget on ${p.over.join(',')}`;
    if (!reason) return { defer: false };
    logEvent('llm-defer', { reason }, s, now);
    return { defer: true, reason };
  } catch { return { defer: false }; }
}

let count = 0;
const models = new Set(); // models that appeared in Ollama while a Claude request ran — the only ones the governor unloads

/** Names of models Ollama has loaded right now; [] when Ollama is absent (1 s timeout). */
function loadedModels(baseUrl = 'http://127.0.0.1:11434') {
  return new Promise((resolve) => {
    try {
      const http = require('http');
      const r = http.get(new URL('/api/ps', baseUrl), { timeout: 1000 }, (res) => {
        let d = ''; res.on('data', (c) => { d += c; });
        res.on('end', () => { try { resolve((JSON.parse(d).models || []).map((m) => m.name)); } catch { resolve([]); } });
      });
      r.on('error', () => resolve([])); r.on('timeout', () => { r.destroy(); resolve([]); });
    } catch { resolve([]); }
  });
}

function write(obj) {
  if (models.size) obj.models = [...models];
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

/**
 * Wrap an async body with begin/end even on throw; models that newly appear in
 * Ollama during it are recorded as Claude-loaded. `list` is a test seam.
 */
async function during(fn, list = loadedModels) {
  const before = new Set(await list());
  begin();
  try { return await fn(); } finally {
    for (const m of await list()) if (!before.has(m)) models.add(m);
    end();
  }
}

module.exports = { check, begin, end, during, loadedModels, logEvent, home };
