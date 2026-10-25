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
 * Usage: api-credit-audit.js [--root DIR] [--max-usd X] [--model M] [--focus "<text>"] [--batch|--no-batch]
 *   Where the channel allows the batch feature (alpha), the audit tries it on
 *   its own: one-shot requests per module pack via the Message Batches API when
 *   batch-policy.js agrees; otherwise (or for unfinished packs) the normal
 *   agent-loop audit runs exactly as before. --no-batch skips the attempt,
 *   --batch forces the policy check where the channel would not try it.
 * Exit codes: those of claude-api-agent.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const agent = require('./claude-api-agent');
const safe = require('./claude-api-safe');
const policy = require('./batch-policy');
const batch = require('./claude-api-batch');
const features = require('../hooks/lib/features');

const DEFAULT_MAX_USD = 5;
const MAX_FOCUS_FILES = 200; // more unfinished files than this are not named one by one in the prompt

function parseArgs(argv) {
  const o = { root: null, maxUsd: DEFAULT_MAX_USD, model: null, focus: null, batch: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') o.root = argv[++i];
    else if (argv[i] === '--max-usd') o.maxUsd = Number(argv[++i]);
    else if (argv[i] === '--model') o.model = argv[++i];
    else if (argv[i] === '--focus') o.focus = argv[++i];
    else if (argv[i] === '--batch') o.batch = true;
    else if (argv[i] === '--no-batch') o.batch = false;
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

const PACK_BYTES = 120000;
const MAX_FILE_BYTES = 40000;
const BATCH_SYSTEM = 'You are a code auditor. You see one module pack of a repository (files with paths). Report only what you verified in the shown code.';

/** Module packs: top-level dirs, split into size-capped bundles. Secret-shaped files and binaries never enter a pack. */
function buildPacks(root, { packBytes = PACK_BYTES } = {}) {
  const groups = new Map();
  for (const rel of agent.walk(root, root, null, 20000)) {
    const top = rel.includes('/') ? rel.split('/')[0] : '(root)';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(rel);
  }
  const packs = [];
  for (const [name, files] of [...groups].sort()) {
    let cur = null;
    const flush = () => { if (cur && cur.files.length) packs.push(cur); cur = null; };
    for (const rel of files) {
      let buf;
      try { buf = fs.readFileSync(path.join(root, rel)); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0) || !buf.length) continue;
      let text = buf.toString('utf8');
      if (text.length > MAX_FILE_BYTES) text = text.slice(0, MAX_FILE_BYTES) + '\n… (truncated)';
      const block = `=== ${rel} ===\n${text}\n`;
      if (cur && cur.bytes + block.length > packBytes) flush();
      if (!cur) cur = { name, files: [], bytes: 0, text: '' };
      cur.files.push(rel); cur.bytes += block.length; cur.text += block;
    }
    flush();
  }
  packs.forEach((p, i) => { p.id = `pack-${i + 1}`; });
  return packs;
}

function packRequest(pack, model, focus) {
  return {
    custom_id: pack.id,
    params: {
      model, max_tokens: 4000,
      system: [{ type: 'text', text: BATCH_SYSTEM + '\n' + auditTask(focus), cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: `Module pack "${pack.name}" (${pack.files.length} files):\n\n${pack.text}\n\nAudit this pack now.` }],
    },
  };
}

function writeReport(root, body, opts) {
  const out = opts.out || ((s) => process.stdout.write(s));
  const day = new Date(opts.now || Date.now()).toISOString().slice(0, 10);
  // A drive root has no basename: name the report after the cleaned path instead.
  const name = path.basename(root) || root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  const report = `# API-credit audit — ${name} (${day})\n\nRoot: \`${root}\`\n\n${body}`;
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

async function runAgentAudit(o, root, cwd, opts, focus) {
  const chunks = [];
  const args = ['--tag', 'audit', '--root', root, '--max-usd', String(o.maxUsd > 0 ? o.maxUsd : DEFAULT_MAX_USD), '--max-turns', '60', '--effort', 'high'];
  if (o.model) args.push('--model', o.model);
  args.push(auditTask(focus));
  const rc = await agent.run(args, { ...opts, cwd, out: (s) => chunks.push(s) });
  return { rc, text: chunks.join('') };
}

async function run(argv, opts = {}) {
  const o = parseArgs(argv);
  const cwd = opts.cwd || process.cwd();
  const root = path.resolve(cwd, o.root || '.');
  const err = opts.err || ((s) => process.stderr.write(s));
  let batchText = '';
  let remainingNote = '';
  let focus = o.focus;

  // No flag: try the batch path wherever the channel allows the feature — the
  // policy still decides; a stable install never gets here and prints nothing.
  const tryBatch = o.batch === null ? features.featureAllowed('batch', opts.featureOpts) : o.batch;
  if (tryBatch) {
    const model = o.model || agent.MODEL_BY_TAG.audit || safe.DEFAULT_MODEL;
    const packs = buildPacks(root);
    const bytes = packs.reduce((s, p) => s + p.bytes, 0);
    const d = policy.decide(
      {
        requests: packs.length, estInputTokens: Math.round(bytes / 4), estOutputTokens: packs.length * 2500, model, unattended: true, cwd,
        monthBudgetUsd: opts.monthBudgetUsd, maxUsd: o.maxUsd > 0 ? o.maxUsd : DEFAULT_MAX_USD, // --max-usd caps the batch path too
      },
      { env: opts.env, home: opts.home, now: opts.now, featureOpts: opts.featureOpts },
    );
    if (!d.useBatch) {
      err(`api-credit-audit: batch skipped (${d.reason}) - running the normal audit\n`);
    } else {
      const res = await batch.runBatch(packs.map((p) => packRequest(p, model, o.focus)), {
        env: opts.env, home: opts.home, cwd, model, tag: 'audit', fetchImpl: opts.fetchImpl, featureOpts: opts.featureOpts, ...(opts.batchOpts || {}),
      });
      const byId = new Map(packs.map((p) => [p.id, p]));
      batchText = res.done.map((r) => `## Pack: ${byId.get(r.custom_id).name} (${byId.get(r.custom_id).files.length} files)\n\n${r.text}\n`).join('\n');
      if (!res.unfinished.length) return writeReport(root, batchText, opts);
      const left = res.unfinished.map((id) => byId.get(id)).filter(Boolean);
      const paths = [...new Set(left.flatMap((p) => p.files))];
      err(`api-credit-audit: ${res.unfinished.length} pack(s) unfinished (${res.reason || 'batch'}) - auditing them via the normal path\n`);
      if (paths.length <= MAX_FOCUS_FILES) {
        focus = `${o.focus ? o.focus + '. ' : ''}ONLY these files and their direct callees: ${paths.join(', ')}`;
        remainingNote = `${paths.length} files of ${left.length} unfinished pack(s), audited file by file.`;
      } else {
        // Too many files to name: no file restriction (nothing is dropped), the unfinished areas lead.
        const areas = [...new Set(left.map((p) => p.name))];
        focus = `${o.focus ? o.focus + '. ' : ''}Start with these top-level areas: ${areas.join(', ')}`;
        remainingNote = `${paths.length} files of ${left.length} unfinished pack(s) (more than ${MAX_FOCUS_FILES}): the normal audit ran over the whole repository, starting with ${areas.join(', ')}.`;
      }
    }
  }

  const r = await runAgentAudit(o, root, cwd, opts, focus);
  if (r.rc !== 0) return batchText ? writeReport(root, `${batchText}\n(normal-path audit of the remaining packs failed — ${remainingNote})\n`, opts) : r.rc;
  if (!remainingNote) return writeReport(root, r.text, opts);
  return writeReport(root, `${batchText ? batchText + '\n' : ''}## Remaining packs (normal path)\n\n_${remainingNote}_\n\n${r.text}`, opts);
}

module.exports = { parseArgs, auditTask, buildPacks, packRequest, run, MAX_FOCUS_FILES };

if (require.main === module) {
  run(process.argv.slice(2)).then((rc) => { process.exitCode = rc; });
}
