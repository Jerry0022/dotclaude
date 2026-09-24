#!/usr/bin/env node
/**
 * autonomous-lockout.js — AFK lockout sentinel shared by autonomous-class
 * orchestrators (backlog-runner today; any future unsupervised runner).
 *
 * When an unsupervised run enters its Post-Confirmation Lockout it `arm`s this
 * sentinel. Sub-skills invoked DURING the lockout — above all /do-ship —
 * `check` it and, when active, switch every would-be `AskUserQuestion` to a
 * deterministic non-interactive decision (park/block) instead of hanging on a
 * modal that no one is present to answer. The whole point: a night run must
 * never wedge on an interactive prompt buried inside a composed sub-skill.
 *
 * The sentinel is a single well-known file in the project root, so ANY caller
 * and ANY sub-skill agree on it without threading state through prompts:
 *   <project>/AUTONOMOUS-LOCKOUT.flag   → { owner, since, session }
 *
 * Staleness (TTL): a run that crashes or compacts between `arm` and `clear`
 * would otherwise leave the sentinel behind forever — the trigger router stays
 * muted (prompt.skill.enforce) and every later /do-ship silently takes its
 * non-interactive defaults. So a lockout older than its owner's TTL is STALE:
 * `readLockout` ignores it and removes it (best effort), `check` reports it as
 * `{ active:false, stale:true }`. TTLs (`ttlFor`):
 *   - `do-run` — one composed ship (do-run Step 7): 6 h, the same horizon as
 *     do-ship's `.claude/.ship-queue` stale rule;
 *   - everything else (`backlog-runner`, `autonomous`, unknown/corrupt) — a
 *     whole AFK run: 24 h, the ceiling `autonomous-watchdog.js register`
 *     enforces on an unattended run. A long runner may re-`arm` to refresh
 *     `since`.
 * `since` falls back to the file's mtime when it is missing or unparseable.
 *
 * Subcommands (stdout: JSON):
 *   arm [owner] [--session=<id>]
 *                 Create/refresh the sentinel; self-registers it in
 *                 .git/info/exclude so it never surfaces as an untracked change.
 *                 `session` defaults to $CLAUDE_SESSION_ID / $CLAUDE_CODE_SESSION_ID.
 *                 → { ok, active:true, path, owner, since, session }
 *   check         Report whether a lockout is active in the cwd; a stale one is
 *                 removed and reported.
 *                 → { ok, active, owner?, since?, session?, stale?, removed? }  (exit 0 always)
 *   clear         Remove the sentinel. → { ok, cleared }
 *
 * Cross-platform; no Windows dependency.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LOCKOUT_FILE = 'AUTONOMOUS-LOCKOUT.flag';

const HOUR_MS = 60 * 60 * 1000;
/** One composed ship under the do-run lockout (see header). */
const SHIP_TTL_MS = 6 * HOUR_MS;
/** A whole AFK run — the autonomous-watchdog's 24 h ceiling. */
const RUN_TTL_MS = 24 * HOUR_MS;
const OWNER_TTL_MS = Object.freeze({ 'do-run': SHIP_TTL_MS });

/** TTL of a lockout armed by `owner`. */
function ttlFor(owner) {
  return Object.prototype.hasOwnProperty.call(OWNER_TTL_MS, owner) ? OWNER_TTL_MS[owner] : RUN_TTL_MS;
}

function lockoutPathFor(dir) {
  return path.join(dir, LOCKOUT_FILE);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * Inspect the sentinel without acting on it.
 * @param {string} dir project dir
 * @param {number} [now] epoch ms (tests)
 * @returns {null|{owner:string, since:string|null, session:string|null, ageMs:number|null, stale:boolean}}
 *   null when absent. A present but unparseable sentinel resolves to owner
 *   "unknown" — under an AFK run we fail toward non-interactive, never toward
 *   a modal — and ages by the file's mtime.
 */
function inspectLockout(dir, now = Date.now()) {
  const p = lockoutPathFor(dir);
  let text;
  let mtimeMs = null;
  try {
    text = fs.readFileSync(p, 'utf8');
    mtimeMs = fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!data || typeof data !== 'object') data = {};
  const owner = typeof data.owner === 'string' && data.owner ? data.owner : 'unknown';
  const since = typeof data.since === 'string' ? data.since : null;
  const session = typeof data.session === 'string' && data.session ? data.session : null;
  let t = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(t)) t = mtimeMs;
  const ageMs = Number.isFinite(t) ? Math.max(0, now - t) : null;
  const stale = ageMs !== null && ageMs > ttlFor(owner);
  return { owner, since, session, ageMs, stale };
}

/** Delete the sentinel; true when a file was removed. Never throws. */
function removeLockout(dir) {
  try {
    fs.unlinkSync(lockoutPathFor(dir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the ACTIVE lockout for a project dir. A stale sentinel (older than its
 * owner's TTL) is ignored and removed, so a crashed run cannot mute the router
 * or force non-interactive ships forever.
 * @param {string} dir
 * @param {number} [now] epoch ms (tests)
 * @returns {null|{owner:string, since:string|null, session:string|null}}
 */
function readLockout(dir, now = Date.now()) {
  const info = inspectLockout(dir, now);
  if (!info) return null;
  if (info.stale) {
    removeLockout(dir);
    return null;
  }
  return { owner: info.owner, since: info.since, session: info.session };
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

/** `arm` arguments: `[owner] [--session=<id>]`. */
function parseArmArgs(args, env = process.env) {
  let owner = null;
  let session = null;
  for (const a of args || []) {
    const m = /^--session=(.+)$/.exec(String(a));
    if (m) session = m[1];
    else if (!owner && a) owner = String(a);
  }
  if (!session) session = env.CLAUDE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || null;
  return { owner: owner || 'autonomous', session };
}

function runArm(args) {
  const dir = process.cwd();
  const { owner, session } = parseArmArgs(args);
  const since = new Date().toISOString();
  fs.writeFileSync(lockoutPathFor(dir), JSON.stringify({ owner, since, session }, null, 2));
  registerExclude(dir);
  out({ ok: true, active: true, path: lockoutPathFor(dir), owner, since, session });
}

function runCheck() {
  const dir = process.cwd();
  const info = inspectLockout(dir);
  if (!info) {
    out({ ok: true, active: false });
    return;
  }
  if (info.stale) {
    const removed = removeLockout(dir);
    out({ ok: true, active: false, stale: true, removed, owner: info.owner, since: info.since, session: info.session });
    return;
  }
  out({ ok: true, active: true, owner: info.owner, since: info.since, session: info.session });
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

module.exports = {
  lockoutPathFor,
  readLockout,
  inspectLockout,
  removeLockout,
  parseArmArgs,
  ttlFor,
  LOCKOUT_FILE,
  SHIP_TTL_MS,
  RUN_TTL_MS,
};
