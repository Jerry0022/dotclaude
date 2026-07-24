#!/usr/bin/env node
/**
 * autonomous-lockout.js — AFK lockout sentinel shared by autonomous-class
 * orchestrators (backlog-runner today; any future unsupervised runner).
 *
 * When an unsupervised run enters its Post-Confirmation Lockout it `arm`s this
 * sentinel. Sub-skills invoked DURING the lockout — above all /ship —
 * `check` it and, when active, switch every would-be `AskUserQuestion` to a
 * deterministic non-interactive decision (park/block) instead of hanging on a
 * modal that no one is present to answer. The whole point: a night run must
 * never wedge on an interactive prompt buried inside a composed sub-skill.
 *
 * The sentinel is a single well-known file in the project root, so ANY caller
 * and ANY sub-skill agree on it without threading state through prompts:
 *   <project>/AUTONOMOUS-LOCKOUT.flag   → { owner, since }
 *
 * Subcommands (stdout: JSON):
 *   arm [owner]   Create/refresh the sentinel; self-registers it in
 *                 .git/info/exclude so it never surfaces as an untracked change.
 *                 → { ok, active:true, path, owner, since }
 *   check         Report whether a lockout is active in the cwd.
 *                 → { ok, active, owner?, since? }   (exit 0 always)
 *   clear         Remove the sentinel. → { ok, cleared }
 *
 * Cross-platform; no Windows dependency.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCKOUT_FILE = 'AUTONOMOUS-LOCKOUT.flag';

function lockoutPathFor(dir) {
  return path.join(dir, LOCKOUT_FILE);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Read the lockout sentinel for a project dir.
 * @returns {null|{owner:string, since:string|null}} null when absent. A present
 *   but unparseable sentinel resolves to a truthy "unknown" owner — under an AFK
 *   run we fail toward non-interactive, never toward a modal.
 */
function readLockout(dir) {
  const p = lockoutPathFor(dir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { owner: 'unknown', since: null };
  }
}

/**
 * Keep the sentinel invisible to git like the AUTONOMOUS-* and BACKLOG-* artifact
 * family. Best-effort — an exotic git layout must never block arming.
 */
function registerExclude(dir) {
  try {
    const gitDir = execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: dir, encoding: 'utf8' },
    ).trim();
    if (!gitDir) return;
    const excl = path.join(gitDir, 'info', 'exclude');
    fs.mkdirSync(path.dirname(excl), { recursive: true });
    const entry = '/' + LOCKOUT_FILE;
    const cur = fs.existsSync(excl) ? fs.readFileSync(excl, 'utf8') : '';
    if (!cur.split(/\r?\n/).includes(entry)) {
      const sep = cur === '' || cur.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(excl, sep + entry + '\n');
    }
  } catch {
    /* hygiene only — ignore */
  }
}

function runArm(args) {
  const dir = process.cwd();
  const owner = args[0] || 'autonomous';
  const since = new Date().toISOString();
  fs.writeFileSync(lockoutPathFor(dir), JSON.stringify({ owner, since }, null, 2));
  registerExclude(dir);
  out({ ok: true, active: true, path: lockoutPathFor(dir), owner, since });
}

function runCheck() {
  const data = readLockout(process.cwd());
  if (!data) {
    out({ ok: true, active: false });
    return;
  }
  out({ ok: true, active: true, owner: data.owner, since: data.since });
}

function runClear() {
  const p = lockoutPathFor(process.cwd());
  let cleared = false;
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      cleared = true;
    }
  } catch {
    /* ignore */
  }
  out({ ok: true, cleared });
}

if (require.main === module) {
  const [, , subcmd, ...args] = process.argv;
  if (subcmd === 'arm') runArm(args);
  else if (subcmd === 'check') runCheck();
  else if (subcmd === 'clear') runClear();
  else {
    out({ ok: false, error: `Unknown subcommand: ${subcmd || '(empty)'}. Use: arm | check | clear` });
    process.exit(1);
  }
}

module.exports = { lockoutPathFor, readLockout, LOCKOUT_FILE };
