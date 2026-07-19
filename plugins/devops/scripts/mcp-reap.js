#!/usr/bin/env node
/**
 * @script mcp-reap
 * @version 0.1.0
 * @plugin devops
 * @description Thin CLI wrapper around hooks/lib/mcp-reaper.js. Scans for
 *   orphaned Claude Desktop MCP server child processes (dead-parent +
 *   MCP-signature match) and reports them. SAFE DEFAULT: dry-run — nothing
 *   is ever terminated unless --apply (or --kill) is passed explicitly.
 *   Intended callers: the SessionStart hook and a scheduled task.
 *
 *   Usage:
 *     node scripts/mcp-reap.js               # dry-run, human summary
 *     node scripts/mcp-reap.js --json         # dry-run, JSON output
 *     node scripts/mcp-reap.js --apply        # actually terminate candidates
 *     node scripts/mcp-reap.js --apply --json
 */

'use strict';

const path = require('path');
const { reap } = require(path.join(__dirname, '..', 'hooks', 'lib', 'mcp-reaper.js'));

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{apply: boolean, json: boolean}}
 */
function parseArgs(argv) {
  const args = new Set(argv);
  return {
    apply: args.has('--apply') || args.has('--kill'),
    json: args.has('--json'),
  };
}

function formatMb(mb) {
  return `${Number(mb).toLocaleString(undefined, { maximumFractionDigits: 0 })} MB`;
}

function printHuman(result, apply) {
  const mode = apply ? 'APPLY (processes terminated)' : 'DRY-RUN (nothing terminated)';
  process.stdout.write(`mcp-reap — mode: ${mode}\n`);
  process.stdout.write(`  scanned:    ${result.scanned}\n`);
  process.stdout.write(`  candidates: ${result.candidates.length}\n`);
  for (const c of result.candidates) {
    process.stdout.write(`    pid ${c.pid} (dead ppid ${c.ppid}) ${c.name}\n`);
  }
  if (apply) {
    process.stdout.write(`  killed:     ${result.killed.length}\n`);
    if (result.errors.length) {
      process.stdout.write(`  errors:     ${result.errors.length}\n`);
      for (const e of result.errors) {
        process.stdout.write(`    pid ${e.pid} [${e.stage}]: ${e.error}\n`);
      }
    }
  }
  process.stdout.write(`  freed estimate: ~${formatMb(result.freedEstimateMb)}\n`);
}

async function main() {
  const { apply, json } = parseArgs(process.argv.slice(2));
  const result = await reap({ dryRun: !apply });

  if (json) {
    process.stdout.write(JSON.stringify({ ...result, dryRun: !apply }) + '\n');
    return;
  }
  printHuman(result, apply);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`mcp-reap failed: ${err && err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, formatMb };
