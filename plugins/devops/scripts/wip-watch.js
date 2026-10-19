#!/usr/bin/env node
'use strict';
/**
 * @script wip-watch
 * @version 0.1.0
 * @plugin devops
 * @description Opt-in weekly WIP watch (default OFF). A pure-node job — no
 *   `claude` invocation, zero model tokens — scans the git repos under the
 *   configured roots for work that exists nowhere else: local branches whose
 *   content is not in the default branch, dirty worktrees, old stashes and
 *   broken worktrees. It writes ~/.claude/wip-watch/report.json and shows ONE
 *   desktop notification that carries the prompt to paste into Claude
 *   ("WIP-Report aufräumen"); the auto-cleanup skill then works the report.
 *   It only REPORTS: nothing is deleted, pruned, fetched or pushed. The only
 *   network call is the optional bounded `gh pr list` (merged PR heads).
 *
 *   Notify-worthy = holds un-landed work or broken state: a branch whose
 *   content is not in main (incl. `review`: could not be inspected), a dirty
 *   worktree (untouched for at least the 1-day active-session grace), a
 *   stash older than 30 days, a broken worktree. Branches whose content is
 *   already in main are listed (action `delete`) but never notify on their
 *   own. Dedupe: notify only when a notify-worthy finding id is new compared
 *   with the last notified set; zero findings reset that set.
 *
 *   Runbook: deep-knowledge/wip-watch.md.
 *
 * Usage:
 *   wip-watch.js run                          scheduled entry: scan, report, notify; silent; exit 0
 *   wip-watch.js scan [--json]                scan + write report, print it; never notifies
 *   wip-watch.js enable [--roots a,b] [--day sun]   config + weekly job (10:00)
 *   wip-watch.js disable                      config off + remove the job
 *   wip-watch.js status
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const cfg = require('../hooks/lib/devops-config');
const { contentInBase } = require('./lib/content-landed');
const scheduler = require('./lib/scheduler');
const desktop = require('./lib/desktop-notify');

const JOB = 'wip-watch';
const JOB_TIME = '10:00';
const PROMPT = 'WIP-Report aufräumen';
const GIT_TIMEOUT = 15_000;
const GH_TIMEOUT = 20_000;
const DAY_MS = 86_400_000;
const STASH_MIN_DAYS = 30;
const ACTIVE_GRACE_DAYS = 1;
const FAR_BEHIND = 50;
const MAX_STATS = 300;

/* ------------------------------------------------------------------ helpers */

function nowMs(io) {
  return typeof io.now === 'function' ? io.now() : (typeof io.now === 'number' ? io.now : Date.now());
}

function homeOf(io) {
  return io.home || os.homedir();
}

function dirOf(io) {
  return path.join(homeOf(io), '.claude', 'wip-watch');
}

/** One git call: argument array, timeout, no prompts. Never throws. */
function git(cwd, args) {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout: GIT_TIMEOUT, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: r.status === 0 && !r.error, status: r.status, out: r.stdout || '' };
}

function norm(p) {
  return path.resolve(p).replace(/\\/g, '/');
}

function hash(...parts) {
  return crypto.createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 12);
}

function expandHome(p, home) {
  const v = String(p).trim();
  if (v === '~') return home;
  if (v.startsWith('~/') || v.startsWith('~\\')) return path.join(home, v.slice(2));
  return v;
}

function isMainCheckout(dir) {
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory();
  } catch {
    return false;
  }
}

/** Main-checkout repos: each root itself and its direct children. */
function discoverRepos(roots, home) {
  const seen = new Set();
  const out = [];
  const add = (dir) => {
    let key;
    try { key = fs.realpathSync(dir); } catch { return; }
    if (seen.has(key) || !isMainCheckout(dir)) return;
    seen.add(key);
    out.push(norm(dir));
  };
  for (const r of roots) {
    const root = expandHome(r, home);
    add(root);
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) add(path.join(root, e.name));
    }
  }
  return out;
}

/** {name, ref} of the existing remote default branch ref, or null. */
function defaultBase(repo) {
  const sym = git(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  const m = sym.ok && /^refs\/remotes\/origin\/(.+)$/.exec(sym.out.trim());
  const cands = m ? [m[1]] : [];
  cands.push('main', 'master');
  for (const name of cands) {
    if (git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}^{commit}`]).ok) {
      return { name, ref: `refs/remotes/origin/${name}` };
    }
  }
  return null;
}

/** Merged-PR heads via gh (optional, bounded); null when unavailable. */
function ghMergedHeads(repo, defaultBranch) {
  const r = spawnSync('gh', ['pr', 'list', '--state', 'merged', '--limit', '1000',
    '--json', 'headRefName,headRefOid,baseRefName'], {
    cwd: repo, encoding: 'utf8', timeout: GH_TIMEOUT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0) return null;
  let list;
  try { list = JSON.parse(r.stdout); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const bySha = new Set();
  const byName = new Map();
  for (const pr of list) {
    if (!pr || pr.baseRefName !== defaultBranch || !pr.headRefOid) continue;
    bySha.add(pr.headRefOid);
    if (pr.headRefName) byName.set(pr.headRefName, [...(byName.get(pr.headRefName) || []), pr.headRefOid]);
  }
  return { bySha, byName };
}

function parseWorktrees(text) {
  const list = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const wt = {};
    for (const line of block.split(/\r?\n/)) {
      const sp = line.indexOf(' ');
      const key = sp === -1 ? line : line.slice(0, sp);
      const val = sp === -1 ? true : line.slice(sp + 1);
      if (key === 'worktree') wt.path = val;
      else if (key === 'HEAD') wt.head = val;
      else if (key === 'branch') wt.branch = val;
      else if (key === 'bare') wt.bare = true;
      else if (key === 'prunable') wt.prunable = val;
    }
    if (wt.path) list.push(wt);
  }
  return list;
}

/** Last activity (ms) of a dirty worktree: newest mtime of its dirty paths, else HEAD's commit time. */
function lastActivity(wtPath, headTimeMs) {
  const st = git(wtPath, ['status', '--porcelain', '-z']);
  const parts = st.out.split('\0').filter(Boolean);
  let newest = 0;
  let n = 0;
  for (let i = 0; i < parts.length && n < MAX_STATS; i++) {
    const e = parts[i];
    const x = e[0];
    const rel = e.slice(3);
    if (x === 'R' || x === 'C') i++; // next entry is the rename source
    n++;
    try { newest = Math.max(newest, fs.statSync(path.join(wtPath, rel)).mtimeMs); } catch { /* deleted */ }
  }
  return newest || headTimeMs;
}

/* --------------------------------------------------------------- repo scan */

/**
 * Findings of one repo.
 * @param {string} repo main checkout
 * @param {object} io {now, fetchMerged}
 * @param {{discardAfterWeeks:number, farBehind?:number}} opts
 */
function scanRepo(repo, io, opts) {
  const now = nowMs(io);
  const farBehind = opts.farBehind || FAR_BEHIND;
  const discardDays = opts.discardAfterWeeks * 7;
  const base = defaultBase(repo);
  const result = { path: repo, defaultBranch: base ? base.name : null, findings: [] };
  const push = (f) => {
    const id = hash(repo, f.kind, f.branch || f.worktree || f.stash || '', f.tip || '');
    const { tip, ...rest } = f;
    result.findings.push({ id, ...rest });
  };
  const counts = (ref) => {
    if (!base) return { ahead: 0, behind: 0 };
    const r = git(repo, ['rev-list', '--left-right', '--count', `${base.ref}...${ref}`]);
    const m = r.ok && /^(\d+)\s+(\d+)/.exec(r.out.trim());
    return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : { ahead: 0, behind: 0 };
  };

  const wtList = git(repo, ['worktree', 'list', '--porcelain']);
  const worktrees = wtList.ok ? parseWorktrees(wtList.out) : [];
  const live = worktrees.filter((w) => !w.bare && !w.prunable && fs.existsSync(w.path));
  const checkedOut = new Set(live.map((w) => w.branch).filter(Boolean));

  // (d) broken worktrees, (b) dirty worktrees
  for (const w of worktrees) {
    if (w.bare) continue;
    const wtPath = norm(w.path);
    if (w.prunable || !fs.existsSync(w.path)) {
      push({
        kind: 'worktree-broken', worktree: wtPath, branch: w.branch ? w.branch.replace(/^refs\/heads\//, '') : undefined,
        ahead: 0, behind: 0, ageDays: 0, landed: false,
        suggestion: { action: 'prune', reason: 'worktree directory is gone — git worktree prune' }, tip: w.head || '',
      });
      continue;
    }
    const st = git(w.path, ['status', '--porcelain']);
    if (!st.ok) {
      push({
        kind: 'worktree-dirty', worktree: wtPath, ahead: 0, behind: 0, ageDays: 0, landed: false,
        suggestion: { action: 'review', reason: 'git status failed — inspect by hand' }, tip: w.head || '',
      });
      continue;
    }
    if (!st.out.trim()) continue;
    const headTime = Number(git(w.path, ['log', '-1', '--format=%ct', 'HEAD']).out.trim()) * 1000 || now;
    const ageDays = Math.max(0, (now - lastActivity(w.path, headTime)) / DAY_MS);
    if (ageDays < ACTIVE_GRACE_DAYS) continue; // likely a running session
    const c = counts('HEAD');
    const stale = ageDays > discardDays;
    push({
      kind: 'worktree-dirty', worktree: wtPath, branch: w.branch ? w.branch.replace(/^refs\/heads\//, '') : undefined,
      ...c, ageDays: Math.round(ageDays * 10) / 10, landed: false,
      suggestion: stale
        ? { action: 'discard', reason: `uncommitted changes untouched for ${Math.floor(ageDays / 7)} weeks` }
        : { action: 'commit', reason: 'uncommitted changes — commit and secure them' },
      tip: w.head || '',
    });
  }

  // (a) branches
  if (base) {
    const refs = git(repo, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(upstream)%09%(upstream:track)%09%(committerdate:unix)', 'refs/heads']);
    let merged; // lazy: fetched once, only when a branch needs it
    const getMerged = () => {
      if (merged === undefined) {
        try { merged = (io.fetchMerged || ghMergedHeads)(repo, base.name) || null; } catch { merged = null; }
      }
      return merged;
    };
    const gitForLanded = (args) => {
      const r = git(repo, ['--literal-pathspecs', ...args]);
      return { ok: r.ok, out: r.out, status: r.status };
    };
    for (const line of refs.out.split('\n').filter(Boolean)) {
      const [ref, sha, upstream, track, ct] = line.split('\t');
      const branch = ref.replace(/^refs\/heads\//, '');
      const gone = /gone/.test(track || '');
      const ageDays = Math.max(0, (now - Number(ct) * 1000) / DAY_MS);
      let unpushed = false;
      if (upstream && !gone) {
        const u = git(repo, ['rev-list', '--count', `${upstream}..${sha}`]);
        unpushed = !u.ok || Number(u.out.trim()) > 0; // fail closed
        if (!unpushed) continue; // fully on its remote
      }
      const isAncestor = git(repo, ['merge-base', '--is-ancestor', sha, base.ref]);
      let landed = isAncestor.ok;
      let uninspectable = false;
      if (!landed && isAncestor.status !== 1) uninspectable = true;
      if (!landed && !uninspectable) {
        const m = getMerged();
        if (m && m.bySha && m.bySha.has(sha)) landed = true;
        // local tip behind its own merged PR head — the same rule ship_hygiene uses
        for (const head of (!landed && m && m.byName && m.byName.get(branch)) || []) {
          if (git(repo, ['merge-base', '--is-ancestor', sha, head]).ok) { landed = true; break; }
        }
      }
      if (!landed && !uninspectable) {
        const cl = contentInBase(repo, sha, base.ref, { git: gitForLanded });
        landed = cl.landed;
        if (!landed && ['missing-ref', 'no-merge-base', 'diff-failed', 'too-many-files'].includes(cl.reason)) uninspectable = true;
      }
      const c = counts(sha);
      const common = { kind: 'branch', branch, ...c, ageDays: Math.round(ageDays * 10) / 10, tip: sha };
      if (landed) {
        if (checkedOut.has(ref)) continue; // live session branch: untouchable, nothing to clean
        push({ ...common, landed: true, suggestion: { action: 'delete', reason: `content already in ${base.name}` } });
        continue;
      }
      if (uninspectable) {
        push({ ...common, landed: false, suggestion: { action: 'review', reason: 'could not be inspected — check by hand' } });
        continue;
      }
      const mt = git(repo, ['merge-tree', '--write-tree', base.ref, sha]);
      let suggestion;
      if (!mt.ok && mt.status !== 1) {
        suggestion = { action: 'review', reason: 'merge check unavailable — check by hand' };
      } else if (!mt.ok) {
        suggestion = { action: 'reimplement', reason: `conflicts with ${base.name} — reimplement on current ${base.name}` };
      } else if (c.behind >= farBehind) {
        suggestion = { action: 'reimplement', reason: `${c.behind} commits behind ${base.name} — reimplement on current ${base.name}` };
      } else {
        suggestion = { action: 'push-pr', reason: `${c.ahead} commit(s) ahead, rebases cleanly — push and open a PR` };
      }
      push({ ...common, landed: false, suggestion });
    }
  }

  // (c) old stashes
  const sl = git(repo, ['stash', 'list', '--format=%gd%x09%ct%x09%H']);
  for (const line of sl.out.split('\n').filter(Boolean)) {
    const [name, ct, sha] = line.split('\t');
    const ageDays = (now - Number(ct) * 1000) / DAY_MS;
    if (!(ageDays > STASH_MIN_DAYS)) continue;
    push({
      kind: 'stash', stash: name, ahead: 0, behind: 0, ageDays: Math.round(ageDays * 10) / 10, landed: false,
      suggestion: ageDays > discardDays
        ? { action: 'stash-drop', reason: `stash older than ${opts.discardAfterWeeks} weeks` }
        : { action: 'stash-branch', reason: 'old stash — secure it as a branch' },
      tip: sha || '',
    });
  }
  return result;
}

/** Holds un-landed work or broken state. */
function isNotifyWorthy(f) {
  return !f.landed;
}

function fingerprintOf(ids) {
  return hash(...[...ids].sort());
}

/**
 * Scan every repo under the roots; builds the report object.
 * @param {object} io {home, now, fetchMerged}
 * @param {{roots?:string[], discardAfterWeeks?:number}} [override]
 */
function scanAll(io = {}, override = {}) {
  const home = homeOf(io);
  const conf = cfg.load(home, { home }).values.wipWatch;
  const roots = override.roots || conf.roots;
  const discardAfterWeeks = override.discardAfterWeeks || conf.discardAfterWeeks;
  const repos = [];
  for (const repo of discoverRepos(roots, home)) {
    try {
      const r = scanRepo(repo, io, { discardAfterWeeks, farBehind: io.farBehind });
      if (r.findings.length) repos.push(r);
    } catch { /* an unreadable repo never stops the run */ }
  }
  const ids = repos.flatMap((r) => r.findings.filter(isNotifyWorthy).map((f) => f.id));
  return {
    version: 1,
    generatedAt: new Date(nowMs(io)).toISOString(),
    roots: roots.map((r) => expandHome(r, home)),
    repos,
    fingerprint: fingerprintOf(ids),
  };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function worthyIds(report) {
  return report.repos.flatMap((r) => r.findings.filter(isNotifyWorthy).map((f) => f.id));
}

/**
 * Scheduled entry: scan, write the report, notify once per new finding.
 * @returns {{ran:boolean, notified:boolean, report?:object}}
 */
function run(io = {}) {
  const home = homeOf(io);
  if (!cfg.load(home, { home }).values.wipWatch.enabled) return { ran: false, notified: false };
  const report = scanAll(io);
  const dir = dirOf(io);
  const reportFile = path.join(dir, 'report.json');
  writeJson(reportFile, report);

  const stateFile = path.join(dir, 'state.json');
  const prev = readJson(stateFile);
  const known = new Set(prev && Array.isArray(prev.notifiedIds) ? prev.notifiedIds : []);
  const ids = worthyIds(report);
  if (ids.length === 0) {
    writeJson(stateFile, { version: 1, notifiedIds: [], fingerprint: report.fingerprint });
    return { ran: true, notified: false, report };
  }
  const hasNew = ids.some((id) => !known.has(id));
  if (!hasNew) {
    writeJson(stateFile, { version: 1, notifiedIds: ids, fingerprint: report.fingerprint, notifiedAt: prev && prev.notifiedAt });
    return { ran: true, notified: false, report };
  }
  const nRepos = report.repos.filter((r) => r.findings.some(isNotifyWorthy)).length;
  const msg = {
    title: 'WIP-Wächter',
    body: `${ids.length} offene WIP-Funde in ${nRepos} Repo(s). Sag Claude: ${PROMPT} (Report: ${reportFile})`,
  };
  const shown = (io.notify || desktop.notify)(msg);
  if (shown) {
    writeJson(stateFile, { version: 1, notifiedIds: ids, fingerprint: report.fingerprint, notifiedAt: new Date(nowMs(io)).toISOString() });
  } // not shown: keep the old set so the next run tries again
  return { ran: true, notified: !!shown, report };
}

/** Scan + write the report; never notifies, never touches the dedupe state. */
function scan(io = {}) {
  const report = scanAll(io);
  writeJson(path.join(dirOf(io), 'report.json'), report);
  return report;
}

function enable(io = {}, args = {}) {
  const home = homeOf(io);
  try {
    if (args.roots) cfg.setValue('wipWatch.roots', args.roots, 'global', home, { home });
    if (args.day) cfg.setValue('wipWatch.day', args.day, 'global', home, { home });
    const day = cfg.load(home, { home }).values.wipWatch.day;
    const job = scheduler.registerJob({
      name: JOB, schedule: { kind: 'weekly', day, time: JOB_TIME },
      command: scheduler.launcherCommand({
        name: JOB, script: 'scripts/wip-watch.js', args: ['run'], home, pluginRoot: path.resolve(__dirname, '..'),
      }),
    }, { platform: io.platform, run: io.run });
    if (!job.ok) return { ok: false, detail: `job registration failed: ${job.detail}` };
    cfg.setValue('wipWatch.enabled', true, 'global', home, { home });
    return { ok: true, detail: `enabled — weekly ${day} ${JOB_TIME} (${job.method})` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

function disable(io = {}) {
  const home = homeOf(io);
  try {
    cfg.setValue('wipWatch.enabled', false, 'global', home, { home });
    const job = scheduler.unregisterJob(JOB, { platform: io.platform, run: io.run });
    return { ok: job.ok, detail: job.ok ? 'disabled — job removed' : `config off, job removal failed: ${job.detail}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

function status(io = {}) {
  const home = homeOf(io);
  const c = cfg.load(home, { home }).values.wipWatch;
  const rep = readJson(path.join(dirOf(io), 'report.json'));
  return {
    enabled: c.enabled, roots: c.roots, day: c.day, discardAfterWeeks: c.discardAfterWeeks,
    jobRegistered: scheduler.isRegistered(JOB, { platform: io.platform, run: io.run }),
    lastReport: rep ? { generatedAt: rep.generatedAt, findings: rep.repos.reduce((n, r) => n + r.findings.length, 0) } : null,
  };
}

/* --------------------------------------------------------------------- CLI */

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

function main(argv = process.argv.slice(2), io = {}) {
  const cmd = argv[0];
  const say = io.out || ((s) => process.stdout.write(`${s}\n`));
  if (cmd === 'run') {
    try { run(io); } catch { /* silent by contract */ }
    return 0;
  }
  if (cmd === 'scan') {
    const report = scan(io);
    if (argv.includes('--json')) say(JSON.stringify(report, null, 2));
    else {
      for (const r of report.repos) {
        say(r.path);
        for (const f of r.findings) say(`  [${f.suggestion.action}] ${f.kind} ${f.branch || f.worktree || f.stash || ''} — ${f.suggestion.reason}`);
      }
      if (!report.repos.length) say('nothing found');
    }
    return 0;
  }
  if (cmd === 'enable') {
    const r = enable(io, { roots: flag(argv, '--roots'), day: flag(argv, '--day') });
    say(r.detail);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'disable') {
    const r = disable(io);
    say(r.detail);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'status') {
    say(JSON.stringify(status(io), null, 2));
    return 0;
  }
  say('usage: wip-watch.js run | scan [--json] | enable [--roots a,b] [--day sun] | disable | status');
  return 2;
}

module.exports = {
  PROMPT, JOB, JOB_TIME, FAR_BEHIND, STASH_MIN_DAYS,
  discoverRepos, scanRepo, scanAll, isNotifyWorthy, fingerprintOf,
  run, scan, enable, disable, status, main,
};

if (require.main === module) process.exit(main());
