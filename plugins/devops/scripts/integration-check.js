#!/usr/bin/env node
/**
 * Integration proof for a multi-agent run. Prints JSON:
 *   { integrationRef, parts[], unlanded[], dirty[], open, removed[] }
 * Usage: node integration-check.js [--cwd <dir>] [--integration <ref>]
 *          [--slug <run-slug>] [--sub <branch|path>[,...]] [--remove]
 * --integration defaults to the current branch of --cwd. --sub (explicit parts) replaces the
 * discovery (agent-* worktrees + branches carrying the whole slug). --remove
 * deletes landed, clean parts that are --sub-named or carry the whole slug,
 * have own commits, no live/recent session and no ignored files (re-checked,
 * never forced). Parts of other runs are listed, never removed. Exit 0 always.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const lib = require('../hooks/lib/integration-check');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

(async () => {
  const cwd = arg('cwd') || process.cwd();
  let integrationRef = arg('integration');
  if (!integrationRef) {
    try {
      integrationRef = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    } catch { integrationRef = 'HEAD'; }
  }
  const sub = arg('sub');
  const subRefs = sub
    ? sub.split(',').filter(Boolean).map((r) => (fs.existsSync(r) && fs.statSync(r).isDirectory() ? { path: r } : r))
    : lib.discoverParts(cwd, { slug: arg('slug'), integrationRef });
  const result = await lib.checkIntegration({ cwd, integrationRef, subRefs });
  const removed = process.argv.includes('--remove')
    ? await lib.removeIntegrated({ cwd, integrationRef, result, explicit: Boolean(sub) }) : [];
  process.stdout.write(`${JSON.stringify({ ...result, open: lib.summarize(result), removed }, null, 2)}\n`);
})().catch((e) => {
  process.stdout.write(`${JSON.stringify({ error: String((e && e.message) || e) })}\n`);
});
