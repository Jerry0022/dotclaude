#!/usr/bin/env node
/**
 * @script claude-ignore
 * @version 0.1.0
 * @plugin devops
 * @description The canonical `.claude` ignore block of a repo
 *   (hooks/lib/runtime-ignores.js) from the command line.
 *
 *     check   [repo] [--json]  deviations of .gitignore / .git/info/exclude; exit 1 on an issue
 *     migrate [repo]           one current block in .gitignore, duplicates and the old block gone,
 *                              the Claude lines removed from .git/info/exclude — idempotent
 *     env-example [repo]       .env.example (key NAMES only) next to every .env / .env.* file,
 *                              <name>.example.json (values blanked) next to every *.local.json
 *
 *   Pure fs plus one `git rev-parse` per call. Never prints a secret value.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ri = require('../hooks/lib/runtime-ignores');

function gitPaths(repo) {
  const out = execFileSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], {
    cwd: repo, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().split(/\r?\n/);
  const root = path.resolve(out[0]);
  const common = path.resolve(root, out[1]);
  return { root, gitignore: path.join(root, '.gitignore'), exclude: path.join(common, 'info', 'exclude') };
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

/** Keep the file's own line endings when rewriting it. */
function writeLike(file, oldText, next) {
  const crlf = typeof oldText === 'string' && oldText.includes('\r\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crlf ? next.replace(/\n/g, '\r\n') : next);
}

/**
 * @param {string} repo any path inside the work tree
 * @returns {{root:string, ok:boolean, issues:object[], policy:object[]}}
 */
function checkRepo(repo) {
  const p = gitPaths(repo);
  return { root: p.root, ...ri.check({ gitignore: read(p.gitignore), exclude: read(p.exclude) }) };
}

/**
 * @returns {{root:string, gitignore:{changed:boolean, removed:string[]}, exclude:{changed:boolean, removed:string[]}}}
 */
function migrateRepo(repo) {
  const p = gitPaths(repo);
  const gi = read(p.gitignore);
  const m = ri.migrateGitignore(gi || '');
  const giChanged = m.text !== (gi || '').replace(/\r\n/g, '\n');
  if (giChanged) writeLike(p.gitignore, gi, m.text);
  const ex = read(p.exclude);
  let exOut = { changed: false, removed: [] };
  if (ex !== null) {
    const s = ri.stripExclude(ex);
    if (s.removed.length) {
      writeLike(p.exclude, ex, s.text);
      exOut = { changed: true, removed: s.removed };
    }
  }
  return { root: p.root, gitignore: { changed: giChanged, removed: m.removed }, exclude: exOut };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', 'vendor', '.venv']);

/** Secret-bearing files under `root` (bounded walk). */
function findSecretFiles(root, maxDepth = 4) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.claude')) walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      if (/^\.env(\..+)?$/.test(e.name) && !/\.example$|\.sample$|\.template$/.test(e.name)) out.push({ kind: 'dotenv', file: full });
      else if (/\.local\.json$/.test(e.name) && e.name !== 'settings.local.json') out.push({ kind: 'json', file: full });
      else if (/^environment\.local\.ts$/.test(e.name)) out.push({ kind: 'ts', file: full });
    }
  };
  walk(root, 0);
  return out;
}

/** KEY names of a dotenv text, in order, deduplicated. */
function dotenvKeys(text) {
  const keys = [];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/** The JSON value with every leaf blanked — structure and key names only. */
function blankJson(v) {
  if (Array.isArray(v)) return v.length ? [blankJson(v[0])] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankJson(x)]));
  if (typeof v === 'number') return 0;
  if (typeof v === 'boolean') return false;
  return v === null ? null : '';
}

/**
 * Write the example files. An existing `.env.example` keeps its lines; only
 * missing key names are appended. Never copies a value.
 * @returns {{written:string[], skipped:{file:string, reason:string}[]}}
 */
function writeEnvExamples(repo) {
  const root = gitPaths(repo).root;
  const written = [];
  const skipped = [];
  const byDir = new Map();
  for (const f of findSecretFiles(root)) {
    if (f.kind === 'dotenv') {
      const dir = path.dirname(f.file);
      if (!byDir.has(dir)) byDir.set(dir, []);
      for (const k of dotenvKeys(read(f.file) || '')) if (!byDir.get(dir).includes(k)) byDir.get(dir).push(k);
    } else if (f.kind === 'json') {
      const target = f.file.replace(/\.local\.json$/, '.example.json');
      if (fs.existsSync(target)) { skipped.push({ file: target, reason: 'exists' }); continue; }
      let data;
      try { data = JSON.parse(read(f.file)); } catch { skipped.push({ file: f.file, reason: 'not valid JSON' }); continue; }
      fs.writeFileSync(target, JSON.stringify(blankJson(data), null, 2) + '\n');
      written.push(target);
    } else {
      skipped.push({ file: f.file, reason: 'TypeScript — create environment.example.ts by hand (key names, empty values)' });
    }
  }
  for (const [dir, keys] of byDir) {
    if (!keys.length) continue;
    const target = path.join(dir, '.env.example');
    const old = read(target);
    const have = dotenvKeys(old || '');
    const missing = keys.filter((k) => !have.includes(k));
    if (!missing.length) continue;
    const head = old ? old.replace(/\s*$/, '\n') : '# Copy to .env and fill in. Key names only — never commit values.\n';
    fs.writeFileSync(target, head + missing.map((k) => `${k}=`).join('\n') + '\n');
    written.push(target);
  }
  return { written, skipped };
}

function main(argv) {
  const json = argv.includes('--json');
  const [cmd, repoArg] = argv.filter((a) => !a.startsWith('--'));
  const repo = path.resolve(repoArg || process.cwd());
  try {
    if (cmd === 'check') {
      const r = checkRepo(repo);
      if (json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      else {
        process.stdout.write(r.ok ? `[claude-ignore] OK — ${r.root}\n` : r.issues.map((i) => `[claude-ignore] ${i.code}: ${i.detail}`).join('\n') + '\n');
        for (const d of r.policy) process.stdout.write(`[claude-ignore] info: "${d.line}" ignores ${d.path}, which the policy versions\n`);
      }
      return r.ok ? 0 : 1;
    }
    if (cmd === 'migrate') {
      const r = migrateRepo(repo);
      if (json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      else {
        process.stdout.write(`[claude-ignore] .gitignore ${r.gitignore.changed ? `updated (${r.gitignore.removed.length} old line(s) folded into the block)` : 'already current'}\n`);
        process.stdout.write(`[claude-ignore] .git/info/exclude ${r.exclude.changed ? `cleaned (${r.exclude.removed.length} Claude line(s) removed)` : 'has no Claude lines'}\n`);
      }
      return 0;
    }
    if (cmd === 'env-example') {
      const r = writeEnvExamples(repo);
      if (json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
      else {
        for (const f of r.written) process.stdout.write(`[claude-ignore] wrote ${f}\n`);
        for (const s of r.skipped) process.stdout.write(`[claude-ignore] skipped ${s.file}: ${s.reason}\n`);
        if (!r.written.length && !r.skipped.length) process.stdout.write('[claude-ignore] no secret files found\n');
      }
      return 0;
    }
    process.stderr.write('usage: claude-ignore.js check|migrate|env-example [repo] [--json]\n');
    return 2;
  } catch (e) {
    process.stderr.write(`[claude-ignore] ${e.message.split('\n')[0]}\n`);
    return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { checkRepo, migrateRepo, writeEnvExamples, dotenvKeys, blankJson, findSecretFiles, main };
