#!/usr/bin/env node
'use strict';
/**
 * @script api-credit-audit
 * @version 0.1.0
 * @plugin devops
 * @description Month-end "use it or lose it" audit: spends part of the plan's
 *   expiring API credit on a read-only code audit of one repo via
 *   claude-api-agent.js and writes the findings to
 *   ~/.claude/devops-audits/<repo>-<YYYY-MM-DD>.md. Changes nothing in the
 *   repo — the report is input for a later in-session fix pass.
 *   Runbook: deep-knowledge/api-credits.md § Month-end audit.
 *
 * Usage: api-credit-audit.js [--root DIR] [--max-usd X] [--model M] [--focus "<text>"]
 * Exit codes: those of claude-api-agent.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const agent = require('./claude-api-agent');

const DEFAULT_MAX_USD = 5;

function parseArgs(argv) {
  const o = { root: null, maxUsd: DEFAULT_MAX_USD, model: null, focus: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') o.root = argv[++i];
    else if (argv[i] === '--max-usd') o.maxUsd = Number(argv[++i]);
    else if (argv[i] === '--model') o.model = argv[++i];
    else if (argv[i] === '--focus') o.focus = argv[++i];
  }
  return o;
}

function auditTask(focus) {
  return [
    'Audit this repository for real problems a maintainer would want fixed. Look for: correctness bugs,',
    'security issues (hard-coded secrets — name file:line only, never quote the value —, injection, unsafe file/process handling), error handling that swallows failures,',
    'dead or duplicated code, and docs that contradict the code.',
    focus ? `Focus especially on: ${focus}.` : '',
    'Start from the README and the entry points, then follow the code. Skip generated files and vendored code.',
    'Report at most 15 findings, most severe first, as a Markdown list. Each finding: severity (high/medium/low),',
    'file:line, what is wrong, why it matters, and the fix in one sentence. Only report what you verified in the code.',
  ].filter(Boolean).join(' ');
}

async function run(argv, opts = {}) {
  const o = parseArgs(argv);
  const cwd = opts.cwd || process.cwd();
  const root = path.resolve(cwd, o.root || '.');
  const chunks = [];
  const args = ['--tag', 'audit', '--root', root, '--max-usd', String(o.maxUsd > 0 ? o.maxUsd : DEFAULT_MAX_USD), '--max-turns', '60', '--effort', 'high'];
  if (o.model) args.push('--model', o.model);
  args.push(auditTask(o.focus));
  const rc = await agent.run(args, { ...opts, cwd, out: (s) => chunks.push(s) });
  if (rc !== 0) return rc;

  const out = opts.out || ((s) => process.stdout.write(s));
  const day = new Date(opts.now || Date.now()).toISOString().slice(0, 10);
  // A drive root has no basename: name the report after the cleaned path instead.
  const name = path.basename(root) || root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  const report = `# API-credit audit — ${name} (${day})\n\nRoot: \`${root}\`\n\n${chunks.join('')}`;
  try {
    const dir = path.join(opts.home || os.homedir(), '.claude', 'devops-audits');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}-${day}.md`);
    fs.writeFileSync(file, report);
    out(`audit report → ${file}\n`);
    return 0;
  } catch (e) {
    // The report is paid for: never lose it to a write error.
    out(report);
    (opts.err || ((s) => process.stderr.write(s)))(`api-credit-audit: could not write the report (${e.message}), printed above\n`);
    return 1;
  }
}

module.exports = { parseArgs, auditTask, run };

if (require.main === module) {
  run(process.argv.slice(2)).then((rc) => { process.exitCode = rc; });
}
