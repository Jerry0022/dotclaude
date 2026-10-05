/**
 * @module governor/adapters/fake
 * @description In-memory adapter for testing the watcher without an OS helper.
 *   Records apply/release/attach calls and simulates applied throttles so a
 *   test can assert orphan reversal, key-based release and failed-release
 *   handling. Sampling is driven by a queue of raw snapshots.
 */
'use strict';

function createFakeAdapter(opts = {}) {
  const calls = [];
  const applied = new Map(); // key -> {level, pids}
  let started = false;
  const failRelease = opts.failRelease || (() => false);
  const adapter = {
    name: 'fake',
    calls,
    applied,
    samples: opts.samples ? [...opts.samples] : [], // the current snapshot(s); tests reassign between ticks
    selfPids: [process.pid],
    get alive() { return started; },
    async start() { started = true; calls.push(['start']); },
    async stop() { started = false; calls.push(['stop']); },
    async sample(o) { calls.push(['sample', o]); return adapter.samples.length > 1 ? adapter.samples.shift() : adapter.samples[0]; },
    async attach(sessionId, pids) { calls.push(['attach', sessionId, pids.map((p) => p.pid)]); return { assigned: pids.length }; },
    async apply(key, level, pids) { calls.push(['apply', key, level, pids.map((p) => p.pid)]); applied.set(key, { level, pids }); },
    async release(key, pids) {
      calls.push(['release', key, (pids || []).map((p) => p.pid)]);
      if (failRelease(key)) throw new Error('release failed');
      applied.delete(key);
      return true;
    },
    async notify(title, text) { calls.push(['notify', title, text]); return { shown: true }; },
  };
  return adapter;
}

module.exports = { createFakeAdapter };
