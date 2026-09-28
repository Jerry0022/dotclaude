#!/usr/bin/env node
/**
 * @script deploy-parity
 * @version 0.1.0
 * @plugin devops
 * @description Deploy-parity build for /do-ship Step 2.5: build the commit
 *   being shipped the way the deploy host will — its configured build
 *   command, npm lifecycle hooks, a fresh lockfile install, a clean checkout
 *   in a temporary worktree — and report passed / failed / inconclusive /
 *   skipped as one JSON object. Logic: hooks/lib/deploy-parity.js; runbook:
 *   deep-knowledge/deploy-parity.md.
 *
 *   A Bash script rather than a ship MCP tool on purpose: it runs in the
 *   background (the build can take minutes) and works with any MCP server
 *   version a session happens to run.
 *
 *   Usage:
 *     node deploy-parity.js --cwd <repo> [--sha <rev>] [--build-cmd <cmd>]
 *       [--install-cmd <cmd>] [--dir <subdir>] [--timeout-sec <n>]
 *       [--pass-env A,B] [--out <file.json>] [--force]
 *
 *   Settings (devops-config, section `deployParity`): `enabled` (false →
 *   skipped unless --force) and `timeoutSec` (default budget; --timeout-sec
 *   wins). Exit 0 for passed / skipped / inconclusive, 1 for failed, 2 for a
 *   usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const parity = require('../hooks/lib/deploy-parity');
const cfg = require('../hooks/lib/devops-config');

const VALUE_FLAGS = new Set(['--cwd', '--sha', '--build-cmd', '--install-cmd', '--dir', '--timeout-sec', '--pass-env', '--out']);

function parseArgs(argv) {
  const a = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--force') { a.force = true; continue; }
    if (!VALUE_FLAGS.has(k)) throw new Error(`unknown argument "${k}"`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${k} needs a value`);
    a[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  if (a.timeoutSec !== undefined) {
    const n = Number(a.timeoutSec);
    if (!Number.isInteger(n) || n <= 0) throw new Error('--timeout-sec must be a positive integer');
    a.timeoutSec = n;
  }
  a.passEnv = a.passEnv ? a.passEnv.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return a;
}

function emit(result, out) {
  const json = JSON.stringify(result, null, 2);
  if (out) {
    try { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, json + '\n'); } catch { /* stdout still has it */ }
  }
  process.stdout.write(json + '\n');
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`deploy-parity: ${e.message}\n`);
    return 2;
  }
  const cwd = path.resolve(args.cwd || process.cwd());
  const settings = cfg.load(cwd).values.deployParity;
  if (!settings.enabled && !args.force) {
    emit({ status: 'skipped', reason: 'disabled (devops-config deployParity.enabled = false)' }, args.out);
    return 0;
  }
  const result = await parity.runDeployParity({
    cwd,
    sha: args.sha,
    buildCmd: args.buildCmd,
    installCmd: args.installCmd,
    dir: args.dir,
    timeoutSec: args.timeoutSec || settings.timeoutSec,
    passEnv: args.passEnv,
  });
  emit(result, args.out);
  return result.status === 'failed' ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`deploy-parity: ${e && e.stack ? e.stack : e}\n`);
    emit({ status: 'inconclusive', reason: `runner crashed: ${e && e.message}` });
    process.exitCode = 0;
  });
}

module.exports = { parseArgs };
