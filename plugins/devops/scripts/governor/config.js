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
  notify: true, // OS notifications (newly learned app, starvation); always logged
  tickMs: 3000, // cadence while a Claude job is tracked
  idleTickMs: 20000, // cadence with no tracked Claude job (process list only, no GPU)
  heartbeatMs: 5000,
  // A Claude-attributed job is "heavy" after sustainMs over one threshold.
  heavy: { cpuPct: 25, gpuPct: 20, diskBps: 20 * MB, ramMB: 1024, sustainMs: 20000, dipMs: 6000, generatorMs: 120000 },
  // "Noticeable load" of a foreign (non-Claude, non-OS) app, per resource.
  foreign: {
    cpuPct: 10, gpuPct: 10, diskBps: 10 * MB,
    decayMs: 10 * 60000, learnFullscreenMs: 15000, learnMs: 60000, interactiveIdleMs: 120000,
  },
  // The 80 % rule (always on).
  budget: {
    highPct: 80, lowPct: 65, smoothMs: 10000, escalateMs: 10000, relaxMs: 30000,
    diskLatencyFactor: 4, diskQueue: 1, ramFreePct: 15, ramFreeMB: 4096, pagingPerSec: 2500,
    baselineMs: 60000, minBaselineMs: 0.3,
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
  noLearn: [], // extra exe names never learned as priority (launchers/browsers are built in)
  // Local services Claude drives: their load counts as Claude load while a
  // Claude request is in flight or ended < selfLoopMs ago, and they are never
  // learned as priority apps. `inflight` names the marker dir under
  // governor/inflight/<inflight>/ the client writes.
  claudeServices: [
    { names: ['ollama', 'ollama.exe', 'ollama_llama_server', 'ollama_llama_server.exe', 'anythingllm.exe', 'anythingllm', 'llama-server', 'llama-server.exe'], inflight: 'local-llm' },
  ],
  ollamaUrl: 'http://127.0.0.1:11434',
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
    log: path.join(base, 'logs', 'governor.log'),
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
