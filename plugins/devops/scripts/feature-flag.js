#!/usr/bin/env node
'use strict';
/**
 * @script feature-flag
 * @version 0.1.0
 * @plugin devops
 * @description Channel feature flags (hooks/lib/features.js) from the shell.
 *
 *   node feature-flag.js check <name>   exit 0 allowed, 126 not allowed on this channel
 *   node feature-flag.js list           JSON { channel, marketplace, registry, features: [{ name, minChannel, summary, allowed }] }
 *
 *   Exit codes: 0 ok/allowed · 2 usage error · 126 not allowed (the plugin's
 *   "switched off" rc, same as scripts/claude-api-safe.js). Never a network call.
 */

const features = require('../hooks/lib/features');

const RC = Object.freeze({ OK: 0, USAGE: 2, DISABLED: 126 });

function main(argv) {
  const [cmd, name] = argv;
  if (cmd === 'check') {
    if (!name) {
      process.stderr.write('usage: feature-flag.js check <name>\n');
      return RC.USAGE;
    }
    const allowed = features.featureAllowed(name);
    process.stdout.write(`${name}: ${allowed ? 'allowed' : 'not available'} on channel ${features.currentChannel()}\n`);
    return allowed ? RC.OK : RC.DISABLED;
  }
  if (cmd === 'list') {
    const reg = features.readRegistry();
    const out = {
      channel: features.currentChannel(),
      marketplace: features.marketplaceName(),
      registry: reg.ok ? (reg.missing ? 'missing' : 'ok') : 'corrupt',
      features: features.listFeatures().map(f => ({
        name: f.name, minChannel: f.minChannel, summary: f.summary, allowed: f.allowed,
      })),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return RC.OK;
  }
  process.stderr.write('usage: feature-flag.js check <name> | list\n');
  return RC.USAGE;
}

if (require.main === module) {
  let rc;
  try { rc = main(process.argv.slice(2)); } catch { rc = RC.DISABLED; } // fail closed
  process.exitCode = rc;
}

module.exports = { main, RC };
