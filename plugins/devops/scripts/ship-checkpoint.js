#!/usr/bin/env node
/**
 * @script ship-checkpoint
 * @plugin devops
 * @description CLI over hooks/lib/ship-checkpoint.js for the do-ship skill.
 *   The ship MCP server records the pipeline steps itself; this CLI is for
 *   what only the model knows: the brief of a delegated ship and the
 *   decisions the user made, plus reading the checkpoint on resume.
 *
 *   node ship-checkpoint.js show     --cwd <dir>             → JSON { open, next, summary, checkpoint }
 *   node ship-checkpoint.js brief    --cwd <dir> [--replace] < brief.txt
 *   node ship-checkpoint.js decision --cwd <dir> --question "<q>" --answer "<a>"
 *   node ship-checkpoint.js clear    --cwd <dir>
 */

const lib = require('../hooks/lib/ship-checkpoint');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function readStdin() {
  try { return require('fs').readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  const cmd = process.argv[2];
  const cwd = arg('cwd') || process.cwd();
  let out;
  if (cmd === 'show') {
    const cp = lib.openCheckpoint(cwd);
    out = cp
      ? { open: true, next: lib.nextStep(cp), summary: lib.describeCheckpoint(cp), checkpoint: cp }
      : { open: false };
  } else if (cmd === 'brief') {
    out = { ok: lib.setBrief(cwd, readStdin(), { replace: process.argv.includes('--replace') }) };
  } else if (cmd === 'decision') {
    out = { ok: lib.addDecision(cwd, arg('question'), arg('answer')) };
  } else if (cmd === 'clear') {
    out = { ok: lib.clearCheckpoint(cwd) };
  } else {
    process.stderr.write('usage: ship-checkpoint.js show|brief|decision|clear --cwd <dir>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  if (out.ok === false) process.exit(1);
}

if (require.main === module) main();
