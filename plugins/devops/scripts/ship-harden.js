#!/usr/bin/env node
/**
 * @script ship-harden
 * @plugin devops
 * @description The ship path of /auto-harden (skills/auto-harden/SKILL.md
 *   § Ship path) as a deterministic script. /do-ship ran it through the
 *   Skill tool, which loaded the whole 23 KB auto-harden skill into every
 *   ship's context — re-read on each of the ~16 calls of a ship — for a
 *   pass that is seven regexes over the added lines. Same checks, same
 *   mechanical fixes, same result shape; no model judgement involved.
 *
 *   node ship-harden.js --base=<branch> [--cwd=<path>] [--strict] [--dry-run] [files…]
 *
 *   Prints one JSON object:
 *     { applicable, reason?, fixed: [{id,file,line,change}],
 *       findings: [{id,file,line,detail}], skipped: [...] }
 *   H3 (secret-shaped literal) findings come first. Exit code is always 0 —
 *   a finding is never a gate.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_FILES = 40;
const SKIP_PATH_RE = /(^|\/)(node_modules|vendor|dist|build|coverage|graphify-out)\/|\.min\.(js|css)$|(^|\/)package-lock\.json$|(^|\/)CHANGELOG\.md$/;
const TEST_FILE_RE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/|(^|\/)test_[^/]*\.py$|_test\.py$/;
const CODE_FILE_RE = /\.([cm]?[jt]sx?|py|vue|svelte|astro)$/;

/**
 * The line with its string literals emptied — a check on code structure must
 * not fire on a fixture string (`"describe.only(…)"` in a test of this very
 * check, a regex source naming TODO). Quotes stay so positions keep a shape.
 */
function codeOf(text) {
  return text.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '$1$1').replace(/\/(?![/*])(?:\\.|[^/\\\n])+\/[gimsuy]*/g, '/r/');
}

/** The comment part of a line (after //, #, or inside /* … *\/), strings removed first. */
function commentOf(text) {
  const code = codeOf(text);
  const m = code.match(/(\/\/|#|\/\*|^\s*\*)(.*)$/);
  return m ? m[2] : '';
}

const CHECKS = [
  {
    id: 'H1', testOnly: true, on: 'code',
    re: /(\b(?:describe|it|test|context|suite)\.only\s*\()|(\bf(?:it|describe)\s*\()/,
    detail: 'focused test left in — it silently disables the rest of the suite',
    fix: (line) => line.replace(/\b(describe|it|test|context|suite)\.only(\s*\()/, '$1$2').replace(/\bf(it|describe)(\s*\()/, '$1$2'),
  },
  {
    id: 'H2', codeOnly: true, on: 'code',
    re: /^\s*debugger;?\s*$/,
    detail: '`debugger;` statement',
    fix: () => null, // delete the line
  },
  {
    id: 'H3',
    re: /((api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"\s]{16,})|-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    detail: 'secret-shaped literal — check before it ships',
  },
  {
    id: 'H4', codeOnly: true, on: 'code',
    re: /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}|except\s*(\w+\s*)?:\s*pass\b/,
    detail: 'empty catch without a comment — the intent is unknown',
  },
  {
    id: 'H5', testOnly: true, on: 'code',
    re: /\b(describe|it|test)\.skip\s*\(|\bx(it|describe)\s*\(|@pytest\.mark\.skip/,
    detail: 'new skipped test',
  },
  {
    id: 'H7', on: 'comment',
    re: /\b(TODO|FIXME|XXX|HACK)\b/,
    detail: 'new TODO/FIXME/XXX/HACK',
  },
];

function parseArgs(argv) {
  const out = { base: 'main', cwd: process.cwd(), strict: false, dryRun: false, files: [] };
  for (const a of argv) {
    if (a.startsWith('--base=')) out.base = a.slice(7);
    else if (a.startsWith('--cwd=')) out.cwd = a.slice(6);
    else if (a === '--strict') out.strict = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--invoked-by=ship') { /* the caller's own marker */ }
    else out.files.push(a);
  }
  return out;
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

/** Added lines per file from a unified diff with -U0: { file → [{ line, text }] }. */
function addedLines(diffText, into = new Map()) {
  let file = null;
  let next = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)(?:,(\d+))?/);
      next = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      if (!into.has(file)) into.set(file, []);
      const list = into.get(file);
      if (!list.some((l) => l.line === next)) list.push({ line: next, text: raw.slice(1).replace(/\r$/, '') });
      next++;
    }
  }
  return into;
}

function run(opts) {
  const { base, cwd, strict, dryRun } = opts;
  const scope = opts.files.map((f) => f.replace(/\\/g, '/'));
  const pathspec = scope.length ? ['--', ...scope] : [];
  const added = new Map();
  addedLines(git(cwd, ['diff', '-U0', '--no-color', `origin/${base}...HEAD`, ...pathspec]), added);
  addedLines(git(cwd, ['diff', '-U0', '--no-color', 'HEAD', ...pathspec]), added);

  for (const f of [...added.keys()]) if (SKIP_PATH_RE.test(f)) added.delete(f);
  if (added.size === 0) return { applicable: false, reason: 'empty diff', fixed: [], findings: [], skipped: [] };

  const skipped = [];
  let files = [...added.keys()];
  if (files.length > MAX_FILES) {
    files.sort((a, b) => added.get(b).length - added.get(a).length);
    skipped.push(`${files.length - MAX_FILES} files (budget)`);
    files = files.slice(0, MAX_FILES);
  }

  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim() || cwd;
  const findings = [];
  const fixes = [];
  for (const file of files) {
    const isTest = TEST_FILE_RE.test(file);
    const isCode = CODE_FILE_RE.test(file);
    for (const { line, text } of added.get(file)) {
      for (const c of CHECKS) {
        if (c.testOnly && !isTest) continue;
        if (c.codeOnly && !isCode) continue;
        const subject = c.on === 'code' ? codeOf(text) : c.on === 'comment' ? commentOf(text) : text;
        if (!c.re.test(subject)) continue;
        if (c.fix && !strict) fixes.push({ id: c.id, file, line, text, fix: c.fix });
        else findings.push({ id: c.id, file, line, detail: c.detail });
      }
    }
    // H6 — a timer or listener added without its cleanup anywhere in the file.
    const body = added.get(file).map((l) => codeOf(l.text)).join('\n');
    if (isCode) {
      let content = '';
      try { content = fs.readFileSync(path.join(root, file), 'utf8'); } catch { /* deleted */ }
      if (/\bsetInterval\s*\(/.test(body) && !/\bclearInterval\s*\(/.test(content)) {
        findings.push({ id: 'H6', file, line: lineOf(added.get(file), /\bsetInterval\s*\(/), detail: 'setInterval without clearInterval in the file' });
      }
      if (/\baddEventListener\s*\(/.test(body) && !/\bremoveEventListener\s*\(/.test(content)) {
        findings.push({ id: 'H6', file, line: lineOf(added.get(file), /\baddEventListener\s*\(/), detail: 'addEventListener without removeEventListener in the file' });
      }
    }
  }

  const fixed = [];
  if (!dryRun) {
    const byFile = new Map();
    for (const f of fixes) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f); }
    for (const [file, list] of byFile) {
      const abs = path.join(root, file);
      let content;
      try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      const lines = content.split(/\r?\n/);
      // Bottom-up so a deleted line never shifts the next fix.
      for (const f of list.sort((a, b) => b.line - a.line)) {
        const idx = f.line - 1;
        if (lines[idx] === undefined || lines[idx].replace(/\r$/, '') !== f.text) {
          findings.push({ id: f.id, file, line: f.line, detail: 'line moved since the diff — not fixed' });
          continue;
        }
        const next = f.fix(lines[idx]);
        if (next === null) { lines.splice(idx, 1); fixed.push({ id: f.id, file, line: f.line, change: 'deleted the line' }); }
        else if (next !== lines[idx]) { lines[idx] = next; fixed.push({ id: f.id, file, line: f.line, change: `→ ${next.trim()}` }); }
      }
      fs.writeFileSync(abs, lines.join(eol));
    }
  } else {
    for (const f of fixes) findings.push({ id: f.id, file: f.file, line: f.line, detail: 'mechanical fix available (dry run)' });
  }

  // H3 first, then by id.
  findings.sort((a, b) => (a.id === 'H3' ? -1 : b.id === 'H3' ? 1 : a.id.localeCompare(b.id)));
  return { applicable: true, fixed, findings, skipped };
}

function lineOf(lines, re) {
  const hit = lines.find((l) => re.test(l.text));
  return hit ? hit.line : null;
}

if (require.main === module) {
  let result;
  try { result = run(parseArgs(process.argv.slice(2))); }
  catch (e) { result = { applicable: false, reason: `error: ${e.message}`, fixed: [], findings: [], skipped: [] }; }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { run, parseArgs, addedLines, codeOf, commentOf, CHECKS };
