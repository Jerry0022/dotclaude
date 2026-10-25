'use strict';
/**
 * @module plugin-audit/integrity
 * @version 0.1.0
 * @description The 12 integrity checks of the plugin audit. Every check
 *   returns { id, title, status: green|yellow|red|skipped, findings:[{msg,
 *   file?, line?}], durationMs } and never throws (a crash becomes `skipped`).
 *     tests-lint, generated, manifest, references, wiring, mcp-boot,
 *     install-parity, eval-coverage, cc-currency (filled by the research
 *     agent), deps, stale-knowledge, size-trend.
 *   Rules produce the findings; no model is involved here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, git, walk, readText, readJson, rel, cmpSemver, check, timed } = require('./util');
const { frontmatter } = require('./footprint');

const MAX_FINDINGS = 40;

function cap(findings, total) {
  if (findings.length <= MAX_FINDINGS) return findings;
  return [...findings.slice(0, MAX_FINDINGS), { msg: `... ${findings.length - MAX_FINDINGS} more (${total || findings.length} total)` }];
}

function plugins(root) {
  try { return fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
}

function mdFiles(root) {
  return walk(path.join(root, 'plugins'), (p) => p.endsWith('.md') && !/[\\/](evals)[\\/]/.test(p));
}

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// ---------------------------------------------------------------- 1 tests+lint
function testsLint(root, { skipTests }) {
  if (skipTests) return check('tests-lint', 'Tests + Lint', 'skipped', [{ msg: 'skipped by --skip-tests' }]);
  const findings = [];
  const lint = run('npm', ['run', 'lint'], { cwd: root, timeout: 300000 });
  const test = run('npm', ['test'], { cwd: root, timeout: 900000 });
  if (!lint.ok) findings.push({ msg: `npm run lint failed (exit ${lint.code}): ${(lint.stdout + lint.stderr).trim().split('\n').slice(-6).join(' | ')}` });
  if (!test.ok) findings.push({ msg: `npm test failed (exit ${test.code}${test.error ? ', ' + test.error : ''}): ${(test.stdout + test.stderr).trim().split('\n').slice(-6).join(' | ')}` });
  const r = check('tests-lint', 'Tests + Lint', findings.length ? 'red' : 'green', findings);
  r.metrics = { lintMs: lint.ms, testMs: test.ms };
  return r;
}

// ------------------------------------------------------------------ 2 generated
function generated(root) {
  const findings = [];
  const node = (args) => run('node', args, { cwd: root, timeout: 120000 });
  const dev = path.join(root, 'plugins/devops');
  if (!fs.existsSync(dev)) return check('generated', 'Generated artefacts current', 'skipped', [{ msg: 'plugins/devops missing' }]);
  const readme = node(['plugins/devops/scripts/gen-readme-sections.mjs', '--check', root]);
  if (!readme.ok) findings.push({ msg: 'README / architecture marker blocks are stale (gen-readme-sections --check)', file: 'README.md' });
  const trig = node(['plugins/devops/scripts/gen-trigger-evals.js', '--check']);
  if (!trig.ok) findings.push({ msg: 'evals/triggers differs from cases.json (gen-trigger-evals --check)', file: 'plugins/devops/evals/triggers' });
  // gen-dk-index and gen-project-map have no check mode: generate into a copy and compare.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-audit-dk-'));
  try {
    const dk = path.join(dev, 'deep-knowledge');
    for (const f of fs.readdirSync(dk)) if (f.endsWith('.md')) fs.copyFileSync(path.join(dk, f), path.join(tmp, f));
    const g = node(['plugins/devops/scripts/gen-dk-index.mjs', tmp]);
    const a = readText(path.join(tmp, 'INDEX.md')); const b = readText(path.join(dk, 'INDEX.md'));
    if (!g.ok || a === null) findings.push({ msg: 'gen-dk-index could not run on a copy', file: 'plugins/devops/deep-knowledge/INDEX.md' });
    else if (a !== b) findings.push({ msg: 'deep-knowledge/INDEX.md is stale (regeneration differs)', file: 'plugins/devops/deep-knowledge/INDEX.md' });
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  const r = check('generated', 'Generated artefacts current', findings.length ? 'red' : 'green', findings);
  r.notes = ['gen-project-map has no check mode and is not verified'];
  return r;
}

// ------------------------------------------------------------------- 3 manifest
function manifest(root) {
  const findings = [];
  const versions = {};
  for (const p of plugins(root)) {
    const j = readJson(path.join(root, 'plugins', p, '.claude-plugin/plugin.json'));
    if (j && j.version) versions[p] = j.version;
  }
  const mk = readJson(path.join(root, '.claude-plugin/marketplace.json'), {});
  for (const e of mk.plugins || []) {
    if (versions[e.name] && e.version !== versions[e.name]) findings.push({ msg: `marketplace.json lists ${e.name} ${e.version}, plugin.json says ${versions[e.name]}`, file: '.claude-plugin/marketplace.json' });
  }
  const dev = versions.devops;
  if (mk.metadata && dev && mk.metadata.version !== dev) findings.push({ msg: `marketplace metadata.version ${mk.metadata.version} != devops ${dev}`, file: '.claude-plugin/marketplace.json' });
  const cl = readText(path.join(root, 'CHANGELOG.md')) || '';
  const top = /^## \[(\d+\.\d+\.\d+)\]/m.exec(cl);
  if (top && dev && top[1] !== dev) findings.push({ msg: `CHANGELOG top entry ${top[1]} != plugin.json ${dev}`, file: 'CHANGELOG.md', line: lineOf(cl, top.index) });
  let status = findings.length ? 'red' : 'green';
  const ls = run('git', ['ls-remote', '--tags', 'origin'], { cwd: root, timeout: 30000 });
  const channels = {};
  if (!ls.ok) {
    findings.push({ msg: `git ls-remote --tags origin failed: ${(ls.error || ls.stderr).trim().slice(0, 120)} - tag checks skipped` });
    if (status === 'green') status = 'yellow';
  } else {
    const best = { alpha: null, beta: null, stable: null, bare: null };
    for (const line of ls.stdout.split('\n')) {
      const m = /refs\/tags\/(?:(alpha|beta|stable)\/)?v(\d+\.\d+\.\d+)$/.exec(line.trim());
      if (!m) continue;
      const k = m[1] || 'bare';
      if (!best[k] || cmpSemver(m[2], best[k]) > 0) best[k] = m[2];
    }
    Object.assign(channels, best);
    if (dev && best.alpha && cmpSemver(dev, best.alpha) > 0) { findings.push({ msg: `plugin.json ${dev} is ahead of the newest alpha tag ${best.alpha} (unreleased)` }); if (status === 'green') status = 'yellow'; }
    if (dev && best.alpha && cmpSemver(dev, best.alpha) < 0) { findings.push({ msg: `plugin.json ${dev} is BEHIND the newest alpha tag ${best.alpha} (stale checkout - sync with origin/main and rerun)` }); if (status === 'green') status = 'yellow'; }
    if (best.stable && best.bare && best.stable !== best.bare) { findings.push({ msg: `stable tag ${best.stable} != bare alias ${best.bare}` }); if (status === 'green') status = 'yellow'; }
    for (const [hi, lo] of [['alpha', 'beta'], ['beta', 'stable']]) {
      if (best[hi] && best[lo] && cmpSemver(best[lo], best[hi]) > 0) { findings.push({ msg: `${lo} tag ${best[lo]} is newer than ${hi} ${best[hi]} (channel order broken)` }); status = 'red'; }
    }
  }
  const r = check('manifest', 'Manifest / version / tags', status, findings);
  r.metrics = { versions, channels };
  return r;
}

// ----------------------------------------------------------------- 4 references
function checkReferences(root) {
  const findings = [];
  const skillNames = new Set(); const agentNames = new Set();
  for (const p of plugins(root)) {
    try { fs.readdirSync(path.join(root, 'plugins', p, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).forEach((d) => skillNames.add(d.name)); } catch { /* none */ }
    try { fs.readdirSync(path.join(root, 'plugins', p, 'agents')).filter((f) => f.endsWith('.md')).forEach((f) => agentNames.add(f.replace(/\.md$/, ''))); } catch { /* none */ }
  }
  let legacy = new Set();
  let skillNamesLib = null;
  try { skillNamesLib = require(path.join(root, 'plugins/devops/hooks/lib/skill-names.js')); } catch { /* optional */ }
  if (skillNamesLib) {
    legacy = new Set([...Object.keys(skillNamesLib.RENAMED || {}), ...Object.keys(skillNamesLib.FOLDED || {})]);
    for (const [k, v] of Object.entries(skillNamesLib.RENAMED || {})) if (!skillNames.has(v)) findings.push({ msg: `skill-names RENAMED ${k} -> ${v}: target skill does not exist`, file: 'plugins/devops/hooks/lib/skill-names.js' });
    for (const [k, v] of Object.entries(skillNamesLib.FOLDED || {})) if (!skillNames.has(v.skill)) findings.push({ msg: `skill-names FOLDED ${k} -> ${v.skill}: target skill does not exist`, file: 'plugins/devops/hooks/lib/skill-names.js' });
  }
  for (const f of mdFiles(root)) {
    const text = readText(f) || '';
    const relf = rel(root, f);
    const pm = /^plugins\/([^/]+)\//.exec(relf);
    const pluginDir = pm ? path.join(root, 'plugins', pm[1]) : root;
    const scanned = text.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '));
    for (const m of scanned.matchAll(/\{PLUGIN_ROOT\}\/([A-Za-z0-9_./@-]+)/g)) {
      const p = m[1].replace(/[.,;:)]+$/, '');
      if (/[<*{$]|YYYY|NN/.test(p) || !p.includes('/') && !/\.\w+$/.test(p)) continue;
      if (!fs.existsSync(path.join(pluginDir, p))) findings.push({ msg: `{PLUGIN_ROOT}/${p} does not exist`, file: relf, line: lineOf(scanned, m.index) });
    }
    for (const m of scanned.matchAll(/\]\(([^)\s#]+?)(?:#[^)\s]*)?\)/g)) {
      const l = m[1];
      if (/^(https?:|mailto:|\/|[A-Za-z]:|<|\{)/.test(l) || !/\.md$/.test(l)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(f), l))) findings.push({ msg: `relative link ${l} does not resolve`, file: relf, line: lineOf(scanned, m.index) });
    }
    for (const m of scanned.matchAll(/(?<![:\w-])(?<!<!--)(devops|local-llm):([a-z][a-z0-9-]+)\b(?!:)/g)) {
      const n = m[2];
      if (skillNames.has(n) || agentNames.has(n) || legacy.has(n)) continue;
      if (/^(mcp|plugin)/.test(n)) continue;
      findings.push({ msg: `${m[1]}:${n} names no skill or agent`, file: relf, line: lineOf(scanned, m.index) });
    }
  }
  return findings;
}

function references(root) {
  const f = checkReferences(root);
  const status = f.length === 0 ? 'green' : f.length > 10 ? 'red' : 'yellow';
  return check('references', 'Reference integrity', status, cap(f, f.length), { metrics: { total: f.length } });
}

// --------------------------------------------------------------------- 5 wiring
function wiring(root) {
  const findings = [];
  const registered = new Set();
  for (const p of plugins(root)) {
    const base = path.join(root, 'plugins', p);
    // hooks.json plus the dispatcher manifest (the per-hook roster behind it)
    const cfgs = [readJson(path.join(base, 'hooks/hooks.json')), readJson(path.join(base, 'hooks/dispatch/manifest.json'))].filter((c) => c && c.hooks);
    for (const groups of cfgs.flatMap((c) => Object.values(c.hooks))) {
      for (const g of groups) {
        for (const h of g.hooks || []) {
          const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/.exec(h.command || '');
          if (!m) continue;
          registered.add(path.join(base, m[1]));
          if (!fs.existsSync(path.join(base, m[1]))) findings.push({ msg: `hooks.json registers ${m[1]} but the file is missing`, file: rel(root, path.join(base, 'hooks/hooks.json')) });
        }
      }
    }
  }
  const textFiles = walk(root, (p) => /\.(js|mjs|md|json|py|sh|html)$/.test(p) && !/\.test\.js$/.test(p) && !/(^|\/)(\.claude\/worktrees|docs\/concepts|__fixtures__)\//.test(rel(root, p)) &&!/CHANGELOG\.md$/.test(p));
  const cache = new Map();
  const content = (f) => { if (!cache.has(f)) cache.set(f, readText(f) || ''); return cache.get(f); };
  const referencedElsewhere = (file) => {
    const stem = path.basename(file).replace(/\.[^.]+$/, '');
    const base = path.basename(file);
    for (const f of textFiles) {
      if (f === file) continue;
      const c = content(f);
      if (c.includes(base) || c.includes(`/${stem}'`) || c.includes(`/${stem}"`) || c.includes(`./${stem}`) || c.includes(`'${stem}'`)) return true;
    }
    return false;
  };
  for (const p of plugins(root)) {
    const base = path.join(root, 'plugins', p);
    const hookFiles = walk(path.join(base, 'hooks'), (f) => /\.(js|mjs)$/.test(f) && !/\.test\.js$/.test(f) && !/[\\/]lib[\\/]/.test(f));
    for (const f of hookFiles) if (!registered.has(f) && !referencedElsewhere(f)) findings.push({ msg: 'hook file is neither registered in hooks.json nor referenced anywhere (orphan candidate)', file: rel(root, f) });
    const scripts = walk(path.join(base, 'scripts'), (f) => /\.(js|mjs|py|sh)$/.test(f) && !/\.test\.js$/.test(f) && path.dirname(f) === path.join(base, 'scripts'));
    for (const f of scripts) if (!referencedElsewhere(f)) findings.push({ msg: 'script is referenced nowhere else (orphan candidate)', file: rel(root, f) });
  }
  const missing = findings.filter((f) => /missing/.test(f.msg)).length;
  return check('wiring', 'Hook / script wiring', missing ? 'red' : findings.length ? 'yellow' : 'green', cap(findings, findings.length));
}

// ------------------------------------------------------------------- 6 mcp-boot
function mcpBoot(root) {
  const probe = path.join(root, 'plugins/devops/scripts/mcp-boot-probe.js');
  if (!fs.existsSync(probe)) return check('mcp-boot', 'MCP boot probe', 'skipped', [{ msg: 'mcp-boot-probe.js missing' }]);
  if (!fs.existsSync(path.join(root, 'plugins/devops/mcp-server/node_modules'))) {
    return check('mcp-boot', 'MCP boot probe', 'skipped', [{ msg: 'no node_modules next to the MCP servers in this checkout; the probe would create a junction into it (unsafe in worktrees)' }]);
  }
  const r = run('node', [probe, '--budget-ms', '5000'], { cwd: root, timeout: 180000 });
  const findings = [];
  for (const line of r.stdout.split('\n')) {
    try { const j = JSON.parse(line); if (!j.ok) findings.push({ msg: `server ${j.server} failed or exceeded the budget (${j.ms} ms${j.error ? ', ' + j.error : ''})` }); } catch { /* not a result line */ }
  }
  if (!r.ok && !findings.length) findings.push({ msg: `probe exited ${r.code}: ${(r.stderr || r.error || '').trim().slice(0, 160)}` });
  return check('mcp-boot', 'MCP boot probe', findings.length ? 'red' : 'green', findings);
}

// -------------------------------------------------------------- 7 install-parity
function installParity(root) {
  const findings = [];
  let status = 'green';
  const script = path.join(root, 'plugins/devops/scripts/deploy-parity.js');
  if (fs.existsSync(script)) {
    const tmp = path.join(os.tmpdir(), `plugin-audit-parity-${process.pid}.json`);
    const parityTrees = () => (git(['worktree', 'list', '--porcelain'], root) || '').split('\n').filter((l) => l.startsWith('worktree ') && /devops-parity-/.test(l)).map((l) => l.slice(9));
    const before = new Set(parityTrees());
    const r = run('node', [script, '--cwd', root, '--out', tmp, '--timeout-sec', '240'], { cwd: root, timeout: 300000 });
    // deploy-parity leaves its (locked, already deleted) temp worktree registered: drop only the ones this run created.
    for (const t of parityTrees()) if (!before.has(t)) { git(['worktree', 'unlock', t], root); git(['worktree', 'remove', '--force', t], root); }
    git(['worktree', 'prune'], root);
    const j = readJson(tmp) || (() => { try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return null; } })();
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    const st = j && (j.status || j.result);
    if (st === 'failed') { status = 'red'; findings.push({ msg: `deploy-parity build failed: ${String(j.reason || j.summary || '').slice(0, 160)}` }); }
    else if (st === 'inconclusive') { status = 'yellow'; findings.push({ msg: `deploy-parity inconclusive: ${String(j.reason || (j.outputTail || '').slice(-160))}` }); }
    else if (st === 'skipped') findings.push({ msg: `deploy-parity skipped (${j.reason || 'disabled in devops-config'})` });
    else if (!st) { status = 'yellow'; findings.push({ msg: `deploy-parity gave no result (exit ${r.code})` }); }
  }
  const cacheBase = path.join(os.homedir(), '.claude/plugins/cache/dotclaude/devops');
  let installed = [];
  try { installed = fs.readdirSync(cacheBase).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(cmpSemver); } catch { /* not installed */ }
  const src = (readJson(path.join(root, 'plugins/devops/.claude-plugin/plugin.json')) || {}).version;
  if (installed.length && src) {
    const newest = installed[installed.length - 1];
    if (cmpSemver(newest, src) < 0) { findings.push({ msg: `installed cache has devops ${newest}, source is ${src} (expected on the stable pin until promotion)` }); if (status === 'green') status = 'yellow'; }
  }
  return check('install-parity', 'Install / deploy parity', status, findings);
}

// --------------------------------------------------------------- 8 eval-coverage
function evalCoverage(root) {
  const findings = [];
  const skills = path.join(root, 'plugins/devops/skills');
  let names = [];
  try { names = fs.readdirSync(skills, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return check('eval-coverage', 'Eval coverage', 'skipped', [{ msg: 'no devops skills dir' }]); }
  for (const n of names) if (!fs.existsSync(path.join(root, 'plugins/devops/evals/skills', n))) findings.push({ msg: `skill ${n} has no evals/skills/${n}`, file: `plugins/devops/skills/${n}/SKILL.md` });
  return check('eval-coverage', 'Eval coverage', findings.length ? 'yellow' : 'green', findings, { metrics: { skills: names.length, uncovered: findings.length } });
}

// ---------------------------------------------------------------- 9 cc-currency
function ccCurrency() {
  return check('cc-currency', 'Claude Code currency', 'skipped', [{ msg: 'filled by research agent' }]);
}

// ---------------------------------------------------------------------- 10 deps
function deps(root) {
  const findings = [];
  let status = 'green';
  const netErr = (r) => /ENOTFOUND|ECONN|EAI_AGAIN|network|ETIMEDOUT|timeout|registry/i.test(`${r.stderr}${r.error || ''}`);
  const out = run('npm', ['outdated', '--json'], { cwd: root, timeout: 120000 });
  if (!out.stdout.trim() && (out.error || netErr(out))) { status = 'yellow'; findings.push({ msg: `npm outdated unavailable: ${(out.error || out.stderr).trim().slice(0, 120)}` }); }
  else {
    try {
      const o = JSON.parse(out.stdout || '{}');
      for (const [name, v] of Object.entries(o)) {
        const major = v.current && v.latest && String(v.current).split('.')[0] !== String(v.latest).split('.')[0];
        if (major) { findings.push({ msg: `${name} ${v.current} -> ${v.latest} (major behind)`, file: 'package.json' }); status = 'yellow'; }
      }
    } catch { /* ignore unparsable */ }
  }
  const aud = run('npm', ['audit', '--json'], { cwd: root, timeout: 120000 });
  try {
    const a = JSON.parse(aud.stdout || '{}');
    const sev = (a.metadata && a.metadata.vulnerabilities) || {};
    if (a.error) { if (status === 'green') status = 'yellow'; findings.push({ msg: `npm audit unavailable: ${String(a.error.summary || a.error.code).slice(0, 120)}` }); }
    else {
      const hi = (sev.high || 0) + (sev.critical || 0);
      const lo = (sev.moderate || 0) + (sev.low || 0);
      if (hi) { status = 'red'; findings.push({ msg: `npm audit: ${hi} high/critical vulnerabilities` }); }
      else if (lo) { if (status === 'green') status = 'yellow'; findings.push({ msg: `npm audit: ${lo} moderate/low vulnerabilities` }); }
    }
  } catch { if (status === 'green') status = 'yellow'; findings.push({ msg: `npm audit gave no JSON (${(aud.error || aud.stderr).trim().slice(0, 100)})` }); }
  return check('deps', 'Dependencies', status, findings);
}

// ------------------------------------------------------------ 11 stale-knowledge
function extractPaths(text) {
  const out = [];
  for (const m of text.matchAll(/`([A-Za-z0-9_.@/-]+\/[A-Za-z0-9_.@/-]*\.(?:js|mjs|md|json|py|sh))`/g)) {
    const p = m[1];
    if (/YYYY|NN|^\.|^(?:attachments|docs)\//.test(p)) continue;
    out.push({ p, index: m.index });
  }
  return out;
}

function memoryDir(root) {
  const mangled = path.resolve(root).replace(/[^A-Za-z0-9]/g, '-');
  return path.join(os.homedir(), '.claude/projects', mangled, 'memory');
}

function staleKnowledge(root, { memoryRoot } = {}) {
  const findings = [];
  const bases = [root, ...plugins(root).map((p) => path.join(root, 'plugins', p)), path.join(root, 'plugins/devops/hooks'), path.join(os.homedir(), '.claude')];
  const extra = ['skills', 'scripts', 'mcp-server', 'hooks/lib'].flatMap((d) => plugins(root).map((pl) => path.join(root, 'plugins', pl, d)));
  const exists = (p, dir) => {
    const up = []; for (let d = dir; d.length >= root.length; d = path.dirname(d)) up.push(d);
    return [...up, ...bases, ...extra].some((b) => fs.existsSync(path.join(b, p)));
  };
  const scan = (f, label) => {
    const text = readText(f) || '';
    const scanned = text.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '));
    for (const { p, index } of extractPaths(scanned)) {
      if (!exists(p, path.dirname(f))) findings.push({ msg: `dead file reference \`${p}\``, file: label, line: lineOf(scanned, index) });
    }
  };
  const dks = walk(path.join(root, 'plugins'), (f) => f.endsWith('.md') && /[\\/](deep-knowledge|skills)[\\/]/.test(f) && !/[\\/]evals[\\/]/.test(f));
  for (const f of dks) scan(f, rel(root, f));
  const mem = memoryRoot || memoryDir(root);
  let memFiles = [];
  try { memFiles = fs.readdirSync(mem).filter((n) => n.endsWith('.md')); } catch { /* no memory dir */ }
  for (const n of memFiles) scan(path.join(mem, n), `memory/${n}`);
  const status = findings.length === 0 ? 'green' : findings.length > 15 ? 'red' : 'yellow';
  return check('stale-knowledge', 'Stale knowledge', status, cap(findings, findings.length), { metrics: { total: findings.length, docs: dks.length, memoryFiles: memFiles.length } });
}

// ------------------------------------------------------------------ 12 size-trend
function sizeMetrics(root) {
  const group = (files) => files.reduce((a, f) => {
    const t = readText(f) || '';
    a.bytes += Buffer.byteLength(t); a.lines += t.split('\n').length; a.files++;
    return a;
  }, { files: 0, bytes: 0, lines: 0 });
  const all = (re, filter = () => true) => plugins(root).flatMap((p) => walk(path.join(root, 'plugins', p), (f) => re.test(f) && filter(f)));
  return {
    skills: group(all(/[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/)),
    hooks: group(all(/[\\/]hooks[\\/].+\.(js|mjs)$/, (f) => !/\.test\.js$/.test(f))),
    deepKnowledge: group(all(/[\\/]deep-knowledge[\\/].+\.md$/)),
  };
}

function sizeTrend(root, { previousSizes }) {
  const now = sizeMetrics(root);
  const findings = [];
  let status = 'green';
  if (!previousSizes) findings.push({ msg: 'no previous audit - baseline recorded' });
  else {
    for (const k of Object.keys(now)) {
      const prev = previousSizes[k]; if (!prev || !prev.bytes) continue;
      const growth = (now[k].bytes - prev.bytes) / prev.bytes;
      if (growth > 0.1) { status = 'yellow'; findings.push({ msg: `${k} grew ${(growth * 100).toFixed(1)}% since the last audit (${prev.bytes} -> ${now[k].bytes} bytes)` }); }
    }
  }
  return check('size-trend', 'Size trend', status, findings, { metrics: { sizes: now } });
}

/**
 * Run all 12 checks.
 * @param {{root?:string, skipTests?:boolean, previousSizes?:object, only?:string[], memoryRoot?:string}} opts
 */
async function runIntegrity({ root = process.cwd(), skipTests = false, previousSizes = null, only, memoryRoot } = {}) {
  const defs = [
    ['tests-lint', 'Tests + Lint', () => testsLint(root, { skipTests })],
    ['generated', 'Generated artefacts current', () => generated(root)],
    ['manifest', 'Manifest / version / tags', () => manifest(root)],
    ['references', 'Reference integrity', () => references(root)],
    ['wiring', 'Hook / script wiring', () => wiring(root)],
    ['mcp-boot', 'MCP boot probe', () => mcpBoot(root)],
    ['install-parity', 'Install / deploy parity', () => installParity(root)],
    ['eval-coverage', 'Eval coverage', () => evalCoverage(root)],
    ['cc-currency', 'Claude Code currency', () => ccCurrency()],
    ['deps', 'Dependencies', () => deps(root)],
    ['stale-knowledge', 'Stale knowledge', () => staleKnowledge(root, { memoryRoot })],
    ['size-trend', 'Size trend', () => sizeTrend(root, { previousSizes })],
  ];
  const out = [];
  for (const [id, title, fn] of defs) {
    if (only && !only.includes(id)) continue;
    out.push(await timed(id, title, fn));
  }
  return out;
}

module.exports = { runIntegrity, checkReferences, references, staleKnowledge, sizeMetrics, sizeTrend, wiring, manifest, frontmatter, git };
