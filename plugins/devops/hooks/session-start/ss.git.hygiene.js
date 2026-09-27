#!/usr/bin/env node
/**
 * @hook ss.git.hygiene
 * @version 0.1.0
 * @event SessionStart
 * @plugin devops
 * @description Once a day per repo, the post-ship hygiene also runs without a
 *   ship (#573): repos nobody ships in were never cleaned, and unlanded work
 *   on a `[gone]` branch or a detached session worktree was never mentioned.
 *
 *   The run itself is DETACHED (mcp-server/ship/hygiene-bg.js) — it may call
 *   gh and remove worktrees, far beyond a SessionStart budget. Its result file
 *   is picked up by the NEXT SessionStart in the same repo and shown to the
 *   user once, then deleted. Silent when there is nothing to show.
 *
 *   Throttle and result are keyed by the repo's main checkout, not by
 *   worktree: every session of one repo shares a single daily run.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const THROTTLE_MS = 24 * 3600 * 1000;
const PREFIX = 'dotclaude-devops-hygiene';

const cwd = process.cwd();

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

if (git('rev-parse --is-inside-work-tree') !== 'true') process.exit(0);
// a ship in flight owns the repo's branches — never clean under it
try {
  if (require('../lib/ship-sentinel').isActive(cwd)) process.exit(0);
} catch { /* sentinel unreadable — proceed */ }

let root = cwd;
try { root = require('../lib/devops-config').mainCheckoutRoot(cwd) || cwd; } catch { /* current checkout */ }
const key = crypto.createHash('sha1').update(String(root).toLowerCase()).digest('hex').slice(0, 12);
const throttleFile = path.join(os.tmpdir(), `${PREFIX}-throttle-${key}`);
const resultFile = path.join(os.tmpdir(), `${PREFIX}-result-${key}`);

// 1. Report the previous run, once.
try {
  const raw = fs.readFileSync(resultFile, 'utf8');
  try { fs.unlinkSync(resultFile); } catch { /* consumed anyway */ }
  const { repo, card } = JSON.parse(raw);
  const lines = [];
  if (card && card.tests) lines.push(`- ${card.tests.method}: ${card.tests.result}`);
  if (card && card.risk) lines.push(`- ${card.risk.text}`);
  if (lines.length) {
    process.stdout.write([
      `Repo hygiene (${repo}, daily background run) — show the user this block verbatim, in their language:`,
      ...lines,
      card.risk ? `If the user wants it rescued: ${card.risk.reply}` : '',
    ].filter(Boolean).join('\n') + '\n');
  }
} catch { /* nothing pending */ }

// 2. Start today's run, at most once a day per repo.
try {
  const stat = fs.statSync(throttleFile);
  if (Date.now() - stat.mtimeMs < THROTTLE_MS) process.exit(0);
} catch { /* first run for this repo */ }
try {
  fs.writeFileSync(throttleFile, String(Date.now()));
} catch {
  process.exit(0); // cannot claim the slot → do not spawn
}
try {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../mcp-server/ship/hygiene-bg.js')], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, DEVOPS_HYGIENE_RESULT_FILE: resultFile },
  });
  child.unref();
} catch { /* best effort */ }
process.exit(0);
