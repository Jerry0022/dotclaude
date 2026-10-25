#!/usr/bin/env node
'use strict';
/**
 * @module deferred-worker
 * @version 0.1.0
 * @plugin devops
 * @description Detached half of lib/deferred-results: runs a hook script with
 *   DEVOPS_DEFERRED_PHASE=bg and the original stdin payload, and stores its
 *   stdout as the session's deferred result. stderr is dropped (informational).
 *   A failing or timed-out script stores nothing (fail open).
 *
 *   CLI: node deferred-worker.js '<json payload>'
 *   payload: { name, script, args?, input?, cwd?, sessionId?, timeoutMs? }
 */

const { spawnSync } = require('child_process');
const results = require('./deferred-results');

function run(p) {
  const r = spawnSync(process.execPath, [p.script, ...(p.args || [])], {
    cwd: p.cwd || process.cwd(),
    input: p.input || '',
    encoding: 'utf8',
    windowsHide: true,
    timeout: p.timeoutMs || 180000,
    env: { ...process.env, DEVOPS_DEFERRED_PHASE: 'bg' },
  });
  if (r.status !== 0 || !r.stdout) return false;
  return results.write(p.sessionId, p.name, r.stdout);
}

module.exports = { run };

if (require.main === module) {
  let p = null;
  try { p = JSON.parse(process.argv[2] || ''); } catch { /* none */ }
  if (p && p.script && p.name) { try { run(p); } catch { /* fail open */ } }
}
