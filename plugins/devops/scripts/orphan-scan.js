#!/usr/bin/env node
/**
 * @script orphan-scan
 * @version 0.1.0
 * @plugin devops
 * @description Machine-wide orphan scan. Post-ship hygiene only looks at the
 *   repo that was just shipped; this scans EVERY git repo under a root and
 *   writes ~/.claude/orphan-report.json:
 *     { generatedAt, root, repos: [{ path, atRisk[], parked[], stashes,
 *       landedLeftovers, offline }] }
 *   atRisk   = unlanded/partial work without PR or live session, and
 *              worktrees with real uncommitted changes (hygiene.js classifyUnits)
 *   parked   = deliberately set-aside unlanded branches (park-register.js);
 *              older than 30 days they carry a nudge
 *   landedLeftovers = landed branches/worktrees hygiene may remove
 *   The SessionStart hook ss.orphan.nudge reads the report (no git calls).
 *
 *   Read-only except `git fetch --prune` (timeout, offline-tolerant) and the
 *   report file. `--clean-landed` additionally removes LANDED leftovers via
 *   the existing safe removal (executeAutoClean), regardless of the age/count
 *   gates; dry-run unless `--apply`. Live-session worktrees, the current
 *   worktree and anything not landed are never touched.
 *
 *   Usage:
 *     node scripts/orphan-scan.js [--root <dir>] [--repo <path>] [--no-fetch] [--json]
 *     node scripts/orphan-scan.js --clean-landed [--repo <path>] [--apply]
 *   --report <file> overrides the report path (tests).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const parkRegister = require('../hooks/lib/park-register');

const FETCH_TIMEOUT = 60_000;
const GIT_TIMEOUT = 15_000;

function gitOut(args, cwd, timeout = GIT_TIMEOUT) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function defaultReportPath() {
  return path.join(os.homedir(), '.claude', 'orphan-report.json');
}

/** Main checkout of the repo containing `cwd` (via git-common-dir), or null. */
function mainCheckoutOf(cwd) {
  const common = gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!common) return null;
  return path.basename(common) === '.git' ? path.dirname(common) : null;
}

/**
 * Every distinct repo (by git-common-dir) among `root` and its direct
 * children. Linked worktrees collapse onto their main checkout.
 * @returns {string[]} main checkout paths
 */
function findRepos(root) {
  const seen = new Set();
  const out = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { /* unreadable root */ }
  for (const dir of [root, ...names.map((n) => path.join(root, n))]) {
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory() || !fs.existsSync(path.join(dir, '.git'))) continue;
    const main = mainCheckoutOf(dir);
    if (!main) continue;
    const key = process.platform === 'win32' ? main.toLowerCase() : main;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(main);
  }
  return out;
}

function fetchPrune(repo) {
  try {
    execFileSync('git', ['fetch', '--prune', '--quiet'], {
      cwd: repo, timeout: FETCH_TIMEOUT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return true;
  } catch {
    return false; // offline or no remote — classify with what is local
  }
}

let hygienePromise = null;
function loadHygiene() {
  if (!hygienePromise) {
    hygienePromise = import(pathToFileURL(path.join(__dirname, '..', 'mcp-server', 'ship', 'lib', 'hygiene.js')).href);
  }
  return hygienePromise;
}

/**
 * Classify one repo, read-only.
 * @param {string} repo  main checkout
 * @param {{fetch?:boolean, now?:number, projectsDir?:string|null, fetchMerged?:Function, fetchOpen?:Function}} [opts]
 */
async function scanOne(repo, opts = {}) {
  const hy = await loadHygiene();
  const now = opts.now ?? Date.now();
  if (opts.fetch !== false) fetchPrune(repo);
  const scan = hy.scanRepo(repo, now);
  if (!scan) return null;
  // the worktree this process runs in is never a leftover
  const self = gitOut(['rev-parse', '--show-toplevel'], process.cwd());
  if (self) scan.units = scan.units.filter((u) => !(u.kind === 'worktree' && hy.normPath(u.path) === hy.normPath(self)));
  const projectsDir = opts.projectsDir === undefined ? hy.defaultProjectsDir() : opts.projectsDir;
  const cls = hy.classifyUnits(scan, { cwd: repo, projectsDir, fetchMerged: opts.fetchMerged, fetchOpen: opts.fetchOpen });

  const parked = [];
  for (const p of parkRegister.listParked(repo, now)) {
    const landing = hy.landingState(p.sha, p.branch, cls.ctx);
    // landed branches are never parked: they are leftovers hygiene removes
    if (landing.state === 'landed') continue;
    parked.push({
      branch: p.branch, legacy: p.legacy, ageDays: p.ageDays, reason: p.reason, date: p.date,
      state: landing.state, ...(p.stale ? { nudge: parkRegister.NUDGE } : {}),
    });
  }
  return {
    scan, cls,
    entry: {
      path: repo,
      atRisk: cls.atRisk.map((r) => ({
        kind: r.kind, branch: r.branch || null, path: r.path || null, commits: r.commits,
        state: r.state, filesIn: r.filesIn, filesTotal: r.filesTotal, pushed: r.pushed, dirty: r.dirty,
      })),
      parked,
      stashes: parkRegister.listStashes(repo, now).length,
      landedLeftovers: cls.removable.length,
      offline: cls.merged === null,
    },
  };
}

/** Dry-run or apply the safe removal of landed leftovers in one repo. */
async function cleanLanded(repo, { apply, now = Date.now(), projectsDir, fetch: doFetch, fetchMerged, fetchOpen } = {}) {
  const hy = await loadHygiene();
  const r = await scanOne(repo, { fetch: doFetch, now, projectsDir, fetchMerged, fetchOpen });
  if (!r) return { repo, removed: [], skipped: [], would: [] };
  const remove = r.cls.removable.map((u) => ({ ...u, trigger: 'orphan-scan' }));
  const would = remove.map((u) => (u.kind === 'worktree' ? { kind: 'worktree', path: u.path, branch: u.branch } : { kind: 'branch', name: u.branch }));
  if (!apply) return { repo, removed: [], skipped: [], would };
  const done = hy.executeAutoClean({ remove }, r.scan, {
    cwd: repo, projectsDir: projectsDir === undefined ? hy.defaultProjectsDir() : projectsDir, remotes: false,
  });
  return { repo, removed: done.removed, skipped: done.skipped, would };
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function parseArgs(argv) {
  const a = { cleanLanded: false, apply: false, fetch: true, json: false, root: null, repo: null, report: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--clean-landed') a.cleanLanded = true;
    else if (v === '--apply') a.apply = true;
    else if (v === '--no-fetch') a.fetch = false;
    else if (v === '--json') a.json = true;
    else if (v === '--root') a.root = argv[++i];
    else if (v === '--repo') a.repo = argv[++i];
    else if (v === '--report') a.report = argv[++i];
  }
  return a;
}

async function main(argv) {
  const args = parseArgs(argv);
  const here = mainCheckoutOf(process.cwd());
  const root = path.resolve(args.root || (here ? path.dirname(here) : process.cwd()));
  const repos = args.repo ? [mainCheckoutOf(path.resolve(args.repo)) || path.resolve(args.repo)] : findRepos(root);

  if (args.cleanLanded) {
    const results = [];
    for (const repo of repos) results.push(await cleanLanded(repo, { apply: args.apply, fetch: args.fetch }));
    if (args.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    } else {
      for (const r of results) {
        if (!r.would.length) continue;
        process.stdout.write(`${r.repo}\n`);
        for (const w of r.would) process.stdout.write(`  ${args.apply ? 'remove' : 'would remove'} ${w.kind} ${w.path || w.name}${w.branch ? ` [${w.branch}]` : ''}\n`);
        for (const s of r.skipped) process.stdout.write(`  skipped ${s.kind} ${s.path || s.name}: ${s.reason}\n`);
      }
      if (!args.apply) process.stdout.write('(dry run — pass --apply to delete)\n');
    }
    return 0;
  }

  const entries = [];
  for (const repo of repos) {
    try {
      const r = await scanOne(repo, { fetch: args.fetch });
      if (r) entries.push(r.entry);
    } catch { /* one broken repo never stops the scan */ }
  }
  const report = { generatedAt: new Date().toISOString(), root, repos: entries };
  writeReport(args.report || defaultReportPath(), report);
  if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    for (const e of entries) {
      if (e.atRisk.length || e.parked.length || e.stashes) {
        process.stdout.write(`${e.path}: ${e.atRisk.length} at risk, ${e.parked.length} parked, ${e.stashes} stashes, ${e.landedLeftovers} landed leftovers\n`);
      }
    }
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), () => process.exit(0));
}

module.exports = { findRepos, mainCheckoutOf, scanOne, cleanLanded, parseArgs, defaultReportPath };
