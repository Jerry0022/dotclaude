#!/usr/bin/env node
/**
 * Integration proof for a multi-agent run. Prints JSON:
 *   { integrationRef, parts[], unlanded[], dirty[], open, removed[] }
 * Usage: node integration-check.js [--cwd <dir>] [--integration <ref>]
 *          [--slug <run-slug>] [--sub <branch|path>[,...]] [--remove [--now]]
 * --integration defaults to the current branch of --cwd. --sub (explicit parts) replaces the
 * discovery (agent-* worktrees + branches carrying the whole slug). --remove
 * deletes landed, clean parts that are --sub-named or carry the whole slug,
 * have own commits, no live/recent session and no ignored files (re-checked,
 * never forced). --now = "just merged, remove now": skips only the >=30 min idle
 * wait (use right after merging a sub-agent branch); landed, clean, own commits,
 * live-session and ignored-file checks all still apply. A worktree lock naming a
 * dead pid is lifted before removing (never forced); a live or pid-less lock keeps
 * the part — `kept` lists every kept part with its reason, `open` names the locked
 * ones. Parts of other runs are listed, never removed. Exit 0 always.
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
      integrationRef = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { windowsHide: true, cwd, encoding: 'utf8' }).trim();
    } catch { integrationRef = 'HEAD'; }
  }
  const sub = arg('sub');
  const subRefs = sub
    ? sub.split(',').filter(Boolean).map((r) => (fs.existsSync(r) && fs.statSync(r).isDirectory() ? { path: r } : r))
    : lib.discoverParts(cwd, { slug: arg('slug'), integrationRef });
  const result = await lib.checkIntegration({ cwd, integrationRef, subRefs });
  const kept = [];
  const removed = process.argv.includes('--remove')
    ? await lib.removeIntegrated({ cwd, integrationRef, result, explicit: Boolean(sub), kept, ...(process.argv.includes('--now') ? { idleMs: 0 } : {}) }) : [];
  process.stdout.write(`${JSON.stringify({ ...result, open: lib.summarize(result, kept), removed, kept }, null, 2)}\n`);
})().catch((e) => {
  process.stdout.write(`${JSON.stringify({ error: String((e && e.message) || e) })}\n`);
});
