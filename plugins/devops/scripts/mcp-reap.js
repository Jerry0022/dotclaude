#!/usr/bin/env node
/**
 * @script mcp-reap
 * @version 0.3.0
 * @plugin devops
 * @description Thin CLI wrapper around hooks/lib/mcp-reaper.js. Scans for
 *   orphaned Claude Desktop MCP server child processes — MCP-signature
 *   match, dead parent, AND outside the live-Claude census/self-subtree/
 *   own-process guards (see mcp-reaper.js header) — and reports them.
 *   Windows only; a documented no-op elsewhere. SAFE DEFAULT: dry-run —
 *   nothing is ever terminated unless --apply (or --kill) is passed
 *   explicitly. Intended callers: ss.mcp.reap.js (SessionStart) and
 *   stop.mcp.reap.js (Stop, cooldown-gated) — both spawn this CLI detached
 *   with stdio:'ignore', so stdout/--json output never reaches anyone.
 *
 *   Every run also persists its result to a temp status file
 *   (dotclaude-mcp-reap-status.json in os.tmpdir()) regardless of --json,
 *   so a detached/backgrounded invocation still leaves an inspectable
 *   trail for a later "what did it reap?" — same pattern as
 *   hooks/session-start/ss.mcp.verify.js's status file.
 *
 *   Usage:
 *     node scripts/mcp-reap.js               # dry-run, human summary
 *     node scripts/mcp-reap.js --json         # dry-run, JSON output
 *     node scripts/mcp-reap.js --apply        # actually terminate candidates
 *     node scripts/mcp-reap.js --apply --json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { reap } = require(path.join(__dirname, '..', 'hooks', 'lib', 'mcp-reaper.js'));

const STATUS_FILE = path.join(os.tmpdir(), 'dotclaude-mcp-reap-status.json');

/**
 * Best-effort persistence of the last run's result, so a detached invocation
 * (stdio:'ignore' from the SessionStart/Stop hooks) still leaves a trail.
 * Never throws — diagnostics only, must not affect the CLI's exit behavior.
 * @param {object} result
 * @param {boolean} dryRun
 */
function writeStatusFile(result, dryRun) {
  try {
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify({ ...result, dryRun, ranAt: new Date().toISOString() }, null, 2)
    );
  } catch {
    // Non-fatal — diagnostics only.
  }
}

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
    if (result.skipped.length) {
      process.stdout.write(`  skipped (TOCTOU re-check failed): ${result.skipped.length}\n`);
      for (const s of result.skipped) {
        process.stdout.write(`    pid ${s.pid} [${s.stage}]: ${s.reason}\n`);
      }
    }
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

  writeStatusFile(result, !apply);

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
