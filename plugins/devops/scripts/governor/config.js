/**
 * @module governor/config
 * @description Paths and configuration of the Claude load governor.
 *   Everything lives under `~/.claude/governor/` (override with
 *   DOTCLAUDE_GOVERNOR_HOME — tests and the smoke use it). The user's
 *   `config.json` is deep-merged over DEFAULTS; a broken file means defaults,
 *   never a throw. `enabled: false` turns the whole feature into a no-op.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MB = 1024 * 1024;

const DEFAULTS = Object.freeze({
  enabled: true,
  notify: true, // OS notifications (newly learned app, starvation, a foreign app hogging a resource ≤ 1/h per app); always logged
  tickMs: 3000, // cadence while a Claude job is tracked
  idleTickMs: 20000, // cadence with no tracked Claude job (process list only, no GPU)
  procScanMs: 15000, // full process scan at most this often; system counters every tick
  heartbeatMs: 5000,
  // A Claude-attributed job is "heavy" after sustainMs over one threshold.
  heavy: { cpuPct: 25, gpuPct: 20, diskBps: 20 * MB, diskOps: 500, ramMB: 1024, sustainMs: 20000, dipMs: 6000, generatorMs: 120000 },
  // "Noticeable load" of a foreign (non-Claude, non-OS) app, per resource. An unknown app's load earns
  // priority only while the system uses >= contendPct of that resource (games/learned apps: always).
  foreign: {
    cpuPct: 10, gpuPct: 10, diskBps: 10 * MB, diskOps: 300, contendPct: 60,
    decayMs: 10 * 60000, learnFullscreenMs: 15000, learnMs: 60000, interactiveIdleMs: 120000,
  },
  // The 80 % rule (always on). Disk = busiest physical disk: active time >= diskActivePct AND slow
  // (latency > diskLatencyMs OR queue > diskQueue), averaged over diskSmoothMs; ok below diskReleasePct
  // or with latency and queue both under half. RAM paging is averaged over ramSmoothMs.
  budget: {
    highPct: 80, lowPct: 65, smoothMs: 10000, escalateMs: 10000, relaxMs: 30000,
    diskActivePct: 95, diskReleasePct: 85, diskLatencyMs: 20, diskQueue: 2, diskSmoothMs: 20000,
    ramFreePct: 15, ramFreeMB: 4096, pagingPerSec: 2500, ramSmoothMs: 30000,
  },
  cap: { cpuPct: 10 },
  // staleMs: state older than this = no watcher (fail open). Must exceed 2 x idleTickMs + the longest tick.
  admission: { defaultMB: 1024, headroomMB: 4096, staleMs: 60000 },
  infraGraceMs: 20000,
  selfLoopMs: 60000,
  starvationMs: 30 * 60000,
  queueExpiryMs: 24 * 3600000,
  foregroundTtlMs: 6 * 3600000,
  // Apps (top-level folder or exe name, case-insensitive substring of the app key).
  alwaysPriority: [],
  neverPriority: [],
  noLearn: [], // extra exe names / app-key substrings that never earn priority from load and are never learned (launchers, browsers and background tools are built in)
  // Local services Claude drives: their load counts as Claude load while a
  // Claude request is in flight or ended < selfLoopMs ago, and they are never
  // learned as priority apps. `inflight` names the marker dir under
  // governor/inflight/<inflight>/ the client writes.
  claudeServices: [
    { names: ['ollama', 'ollama.exe', 'ollama_llama_server', 'ollama_llama_server.exe', 'anythingllm.exe', 'anythingllm', 'llama-server', 'llama-server.exe'], inflight: 'local-llm' },
  ],
  ollamaUrl: 'http://127.0.0.1:11434',
  // Bounded debug log (scripts/governor/log.js): one JSONL file per watcher run.
  log: { keepRuns: 10, maxTotalMB: 20, maxFileMB: 2, hooksMaxMB: 1, dedupeMs: 30000, summaryMs: 60000 },
});

function home() {
  return process.env.DOTCLAUDE_GOVERNOR_HOME || path.join(os.homedir(), '.claude', 'governor');
}

function paths(base = home()) {
  return {
    home: base,
    config: path.join(base, 'config.json'),
    state: path.join(base, 'state.json'),
    learned: path.join(base, 'learned.json'),
    control: path.join(base, 'control.json'),
    lock: path.join(base, 'watcher.lock'),
    handover: path.join(base, 'handover.json'),
    sessions: path.join(base, 'sessions'),
    foreground: path.join(base, 'foreground'),
    inflight: path.join(base, 'inflight'),
    queue: path.join(base, 'queue'),
    logs: path.join(base, 'logs'),
  };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(base[k])) out[k] = merge(base[k], v);
    else if (v !== undefined && v !== null && (base[k] === undefined || typeof v === typeof base[k])) out[k] = v;
  }
  return out;
}

/** @returns {typeof DEFAULTS} merged config; defaults on any read/parse error */
function loadConfig(p = paths()) {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(p.config, 'utf8').replace(/^\uFEFF/, '')); } catch { user = {}; }
  return merge(DEFAULTS, user);
}

const SUPPORTED = new Set(['win32', 'linux', 'darwin']);
function isSupported(platform = process.platform) { return SUPPORTED.has(platform); }

module.exports = { DEFAULTS, MB, home, paths, loadConfig, merge, isSupported };
