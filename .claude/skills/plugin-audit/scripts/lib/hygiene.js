'use strict';
/**
 * @module plugin-audit/hygiene
 * @version 0.1.0
 * @description The 8 repo and ship hygiene checks of the plugin audit, same
 *   result shape as integrity.js: unshipped, branches, open-prs, issues,
 *   channel-gap, ci, leftovers, ship-stats. Every `gh` / network failure turns
 *   the check into `skipped` with the error - never a crash, never red.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, git, walk, readText, readJson, cmpSemver, check, timed } = require('./util');
const { mainRoot } = require('./state');

const DAY = 86400000;

/** gh JSON call -> {ok, data} | {ok:false, error}. */
function gh(args, cwd) {
  const r = run('gh', args, { cwd, timeout: 45000 });
  if (!r.ok) return { ok: false, error: (r.error || r.stderr || `exit ${r.code}`).trim().slice(0, 160) };
  try { return { ok: true, data: JSON.parse(r.stdout || 'null') }; } catch { return { ok: false, error: 'gh returned no JSON' }; }
}

const ghSkipped = (id, title, error) => check(id, title, 'skipped', [{ msg: `gh unavailable: ${error}` }]);

function latestAlphaTag(root) {
  const t = git(['tag', '--list', 'alpha/v*', '--sort=-v:refname'], root);
  return t ? t.split('\n')[0] : null;
}

// ------------------------------------------------------------------- 1 unshipped
function unshipped(root) {
  const findings = [];
  let status = 'green';
  const tag = latestAlphaTag(root);
  const version = (readJson(path.join(root, 'plugins/devops/.claude-plugin/plugin.json')) || {}).version;
  if (!tag) return check('unshipped', 'Unshipped work', 'skipped', [{ msg: 'no alpha/v* tag found locally (fetch tags?)' }]);
  const n = git(['rev-list', '--count', `${tag}..origin/main`], root);
  if (n === null) findings.push({ msg: 'origin/main not resolvable - commit count skipped' });
  else if (Number(n) > 0) { status = 'yellow'; findings.push({ msg: `${n} commit(s) on origin/main since ${tag}` }); }
  const tv = tag.replace(/^alpha\/v/, '');
  if (version && tv !== version) { status = 'yellow'; findings.push({ msg: `plugin.json ${version} != latest alpha tag ${tv}` }); }
  const rel = gh(['release', 'view', `v${tv}`, '--json', 'tagName'], root);
  if (!rel.ok) findings.push({ msg: `no GitHub release for v${tv} (${rel.error}) - expected until the version is promoted to stable` });
  return check('unshipped', 'Unshipped work', status, findings, { metrics: { latestAlpha: tv, commitsSince: n === null ? null : Number(n) } });
}

// ------------------------------------------------------------------ 2 branches
function branches(root) {
  const scan = path.join(root, 'plugins/devops/scripts/orphan-scan.js');
  if (!fs.existsSync(scan)) return check('branches', 'Branches / worktrees', 'skipped', [{ msg: 'orphan-scan.js missing' }]);
  const report = path.join(os.tmpdir(), `plugin-audit-orphans-${process.pid}.json`);
  const r = run('node', [scan, '--repo', mainRoot(root), '--no-fetch', '--report', report], { cwd: root, timeout: 240000 });
  const j = readJson(report);
  try { fs.rmSync(report, { force: true }); } catch { /* best effort */ }
  if (!j || !Array.isArray(j.repos)) return check('branches', 'Branches / worktrees', 'skipped', [{ msg: `orphan-scan gave no report (${(r.error || r.stderr).trim().slice(0, 100)})` }]);
  const findings = [];
  let atRisk = 0; let leftovers = 0; let parked = 0;
  for (const repo of j.repos) {
    atRisk += (repo.atRisk || []).length; parked += (repo.parked || []).length;
    leftovers += Array.isArray(repo.landedLeftovers) ? repo.landedLeftovers.length : Number(repo.landedLeftovers || 0);
    for (const a of repo.atRisk || []) findings.push({ msg: `at risk: ${typeof a === 'string' ? a : a.branch || a.path || JSON.stringify(a).slice(0, 100)}` });
  }
  if (leftovers) findings.push({ msg: `${leftovers} landed branch(es)/worktree(s) can be removed (/auto-cleanup)` });
  if (parked) findings.push({ msg: `${parked} parked branch(es)` });
  return check('branches', 'Branches / worktrees', atRisk ? 'yellow' : leftovers > 10 ? 'yellow' : 'green', findings.slice(0, 30), { metrics: { atRisk, leftovers, parked } });
}

// ------------------------------------------------------------------ 3 open PRs
function openPrs(root, now) {
  const r = gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,createdAt,mergeable,isDraft,statusCheckRollup'], root);
  if (!r.ok) return ghSkipped('open-prs', 'Open PRs', r.error);
  const findings = [];
  for (const p of r.data || []) {
    const age = Math.floor((now - new Date(p.createdAt).getTime()) / DAY);
    const failing = (p.statusCheckRollup || []).filter((c) => /FAIL|ERROR/i.test(c.conclusion || c.state || '')).length;
    const flags = [age > 7 ? `${age} days old` : '', p.mergeable === 'CONFLICTING' ? 'conflicting' : '', failing ? `${failing} failing check(s)` : ''].filter(Boolean);
    if (flags.length) findings.push({ msg: `#${p.number} ${p.title.slice(0, 70)}: ${flags.join(', ')}` });
  }
  return check('open-prs', 'Open PRs', findings.length ? 'yellow' : 'green', findings, { metrics: { open: (r.data || []).length } });
}

// -------------------------------------------------------------------- 4 issues
function issues(root, now) {
  const open = gh(['issue', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title,createdAt,labels'], root);
  if (!open.ok) return ghSkipped('issues', 'Issues', open.error);
  const findings = [];
  const aged = (open.data || []).filter((i) => (i.labels || []).some((l) => /bug/i.test(l.name)) && now - new Date(i.createdAt).getTime() > 30 * DAY);
  for (const i of aged.slice(0, 15)) findings.push({ msg: `bug #${i.number} open ${Math.floor((now - new Date(i.createdAt).getTime()) / DAY)} days: ${i.title.slice(0, 70)}` });
  const log = git(['log', 'origin/main', '-300', '--format=%s%n%b'], root) || '';
  const openSet = new Set((open.data || []).map((i) => i.number));
  const stale = new Set();
  for (const m of log.matchAll(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi)) if (openSet.has(Number(m[1]))) stale.add(Number(m[1]));
  for (const n of stale) findings.push({ msg: `#${n} is referenced by "fixes/closes" in a main commit but still open` });
  return check('issues', 'Issues', findings.length ? 'yellow' : 'green', findings, { metrics: { open: openSet.size, agedBugs: aged.length, closedByCommitButOpen: stale.size } });
}

// ---------------------------------------------------------------- 5 channel gap
function channelGap(root, now) {
  const out = git(['for-each-ref', 'refs/tags/alpha', 'refs/tags/beta', 'refs/tags/stable', '--format=%(refname)|%(creatordate:iso-strict)'], root);
  if (out === null) return check('channel-gap', 'Channel gap', 'skipped', [{ msg: 'tags not readable' }]);
  const best = {};
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, date] = line.split('|');
    const m = /refs\/tags\/(alpha|beta|stable)\/v(\d+\.\d+\.\d+)$/.exec(ref);
    if (m && (!best[m[1]] || cmpSemver(m[2], best[m[1]].version) > 0)) best[m[1]] = { version: m[2], date, ageDays: Math.floor((now - new Date(date).getTime()) / DAY) };
  }
  const findings = [];
  let status = 'green';
  for (const k of ['alpha', 'beta', 'stable']) findings.push({ msg: best[k] ? `${k}: v${best[k].version} (${best[k].ageDays} days old)` : `${k}: no tag` });
  if (best.alpha && best.stable) {
    const gap = Number(best.alpha.version.split('.')[1]) - Number(best.stable.version.split('.')[1]);
    if (gap > 15 || best.stable.ageDays > 21) { status = 'yellow'; findings.push({ msg: `stable lags alpha by ${gap} minor versions / ${best.stable.ageDays} days - promotion overdue` }); }
    if (best.stable.ageDays > 60) status = 'red';
  } else status = 'yellow';
  return check('channel-gap', 'Channel gap', status, findings, { metrics: best });
}

// ------------------------------------------------------------------------- 6 CI
function ci(root) {
  const findings = [];
  let status = 'green';
  const runs = gh(['run', 'list', '--branch', 'main', '--limit', '20', '--json', 'conclusion,name,createdAt,url'], root);
  if (runs.ok) {
    const red = (runs.data || []).filter((r) => r.conclusion === 'failure');
    for (const r of red.slice(0, 5)) findings.push({ msg: `red run on main: ${r.name} (${r.createdAt}) ${r.url}` });
    if (red.length) status = 'yellow';
    if ((runs.data || [])[0] && runs.data[0].conclusion === 'failure') status = 'red';
  } else findings.push({ msg: `gh run list unavailable: ${runs.error}` });
  const watchDir = path.join(mainRoot(root), '.claude/.ship-watcher');
  try {
    for (const f of fs.readdirSync(watchDir).filter((n) => n.endsWith('.json'))) {
      const j = readJson(path.join(watchDir, f)) || {};
      if (/fail|error|red/i.test(String(j.status || j.result || j.conclusion || ''))) { findings.push({ msg: `ship-watcher ${f}: ${j.status || j.result || j.conclusion}` }); if (status === 'green') status = 'yellow'; }
    }
  } catch { /* no watcher dir */ }
  const memDir = path.join(os.homedir(), '.claude/projects', path.resolve(mainRoot(root)).replace(/[^A-Za-z0-9]/g, '-'), 'memory');
  try {
    const m = fs.readdirSync(memDir).find((n) => /actions[-_]?minutes/i.test(n));
    if (m) findings.push({ msg: `actions-minutes note present: memory/${m}` });
  } catch { /* none */ }
  return check('ci', 'CI', runs.ok ? status : (status === 'green' ? 'skipped' : status), findings);
}

// ------------------------------------------------------------------ 7 leftovers
function leftovers(root, now) {
  const main = mainRoot(root);
  const findings = [];
  const concepts = path.join(main, 'docs/concepts');
  let openPages = 0;
  try {
    for (const f of fs.readdirSync(concepts).filter((n) => n.endsWith('.html') && !/template-example/.test(n))) {
      const p = path.join(concepts, f);
      if (now - fs.statSync(p).mtimeMs < 7 * DAY) continue;
      if (!/data-closed/.test(readText(p) || '')) { openPages++; if (findings.length < 12) findings.push({ msg: `concept page without closed marker, older than 7 days: ${f}`, file: `docs/concepts/${f}` }); }
    }
  } catch { /* no concepts dir */ }
  const trees = [main];
  try { for (const d of fs.readdirSync(path.join(main, '.claude/worktrees'))) trees.push(path.join(main, '.claude/worktrees', d)); } catch { /* none */ }
  for (const t of trees) {
    for (const n of ['concept-active.json', '.ship-checkpoint', '.ship-in-progress']) {
      const p = path.join(t, '.claude', n);
      try { const age = (now - fs.statSync(p).mtimeMs) / DAY; if (age > 1) findings.push({ msg: `${path.relative(main, p) || p} is ${age.toFixed(1)} days old (stale state)`, file: path.relative(main, p) }); } catch { /* absent */ }
    }
  }
  for (const lock of walk(path.join(main, '.git'), (f) => /\.lock$/.test(f)).slice(0, 5)) findings.push({ msg: `git lock file: ${path.relative(main, lock)}` });
  const stale = path.join(os.homedir(), '.claude/plugins/.mcp-stale.json');
  if (fs.existsSync(stale)) findings.push({ msg: '~/.claude/plugins/.mcp-stale.json present - devops MCP tools stay blocked until the next restart' });
  return check('leftovers', 'Leftovers', findings.length ? 'yellow' : 'green', findings, { metrics: { openConceptPages: openPages } });
}

// ------------------------------------------------------------------ 8 ship stats
function shipStats(root, now, mining) {
  const out = git(['for-each-ref', 'refs/tags/alpha', '--format=%(creatordate:iso-strict)'], root);
  if (out === null) return check('ship-stats', 'Ship statistics', 'skipped', [{ msg: 'tags not readable' }]);
  const weeks = new Array(8).fill(0);
  for (const d of out.split('\n').filter(Boolean)) {
    const w = Math.floor((now - new Date(d).getTime()) / (7 * DAY));
    if (w >= 0 && w < 8) weeks[w]++;
  }
  const findings = [{ msg: `ships per week (newest first, 8 weeks): ${weeks.join(', ')}` }];
  const metrics = { shipsPerWeek: weeks };
  const total = weeks.reduce((a, b) => a + b, 0);
  const gate = mining && mining.benefit && mining.benefit.gateCatches && mining.benefit.gateCatches.byRule;
  if (gate) {
    const blocks = (gate['ship-via-do-ship'] || 0) + (gate['ship-delegation'] || 0) + (gate['run-contract'] || 0);
    metrics.shipGuardRefusals = blocks;
    metrics.blockedShare = blocks + total ? Number((blocks / (blocks + total)).toFixed(3)) : 0;
    findings.push({ msg: `ship guard refusals in the mining window: ${blocks} (blocked share ~${(metrics.blockedShare * 100).toFixed(0)}% of ship attempts; the window differs from the 8-week tag window)` });
  } else findings.push({ msg: 'blocked share not available (no mining data)' });
  return check('ship-stats', 'Ship statistics', 'green', findings, { metrics });
}

/** @param {{root?:string, now?:number, mining?:object}} opts */
async function runHygiene({ root = process.cwd(), now = Date.now(), mining = null } = {}) {
  const defs = [
    ['unshipped', 'Unshipped work', () => unshipped(root)],
    ['branches', 'Branches / worktrees', () => branches(root)],
    ['open-prs', 'Open PRs', () => openPrs(root, now)],
    ['issues', 'Issues', () => issues(root, now)],
    ['channel-gap', 'Channel gap', () => channelGap(root, now)],
    ['ci', 'CI', () => ci(root)],
    ['leftovers', 'Leftovers', () => leftovers(root, now)],
    ['ship-stats', 'Ship statistics', () => shipStats(root, now, mining)],
  ];
  const out = [];
  for (const [id, title, fn] of defs) out.push(await timed(id, title, fn));
  return out;
}

module.exports = { runHygiene, gh };
