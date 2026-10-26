#!/usr/bin/env node
'use strict';
/**
 * @script plugin-audit/audit
 * @version 0.2.0
 * @description Deterministic collection of the plugin audit (0 model tokens):
 *   static footprint, transcript mining, 12 integrity checks, 8 hygiene
 *   checks, net cost/benefit estimate. Writes <out>/results.json and prints one
 *   summary line. Exit 0 unless the arguments are invalid (exit 2).
 *
 *   Usage:
 *     audit.js [--out DIR] [--skip-tests] [--days N] [--trigger manual|ship]
 *              [--root DIR] [--projects-dir DIR] [--state-dir DIR]
 *     audit.js --record --in DIR     step 5: append history.json, write
 *                                    last.json, clear a matching report-pending.json
 *
 *   `--trigger ship` additionally writes report-pending.json into the state
 *   dir: if no live session opens the report, the next session does. It also
 *   prints the next step as an instruction after the summary line: the
 *   ship's background task reaches the session as a task notification, and
 *   on 0.320.0 that session only OFFERED the report as an open point instead
 *   of opening it (2026-10-26) — the report must open without a question.
 */

const fs = require('fs');
const path = require('path');
const { git, readJson } = require('./lib/util');
const state = require('./lib/state');
const { collect } = require('./lib/footprint');
const { mine } = require('./lib/mining');
const { runIntegrity, sizeMetrics } = require('./lib/integrity');
const { runHygiene } = require('./lib/hygiene');

const UNCERTAINTY = 'Schätzung: Transkripte enthalten keine Plugin-Version; Zuordnung über Zeitfenster; Nutzen nur über Stellvertreter-Metriken';

function parseArgs(argv) {
  const a = { skipTests: false, trigger: 'manual', record: false };
  const val = new Set(['--out', '--days', '--trigger', '--root', '--projects-dir', '--state-dir', '--in']);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--skip-tests') a.skipTests = true;
    else if (k === '--record') a.record = true;
    else if (val.has(k)) {
      if (argv[i + 1] === undefined) return { error: `${k} needs a value` };
      a[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else return { error: `unknown argument ${k}` };
  }
  if (a.days !== undefined && !(Number(a.days) > 0)) return { error: '--days must be a positive number' };
  if (!['manual', 'ship'].includes(a.trigger)) return { error: '--trigger must be manual or ship' };
  return a;
}

function tally(list) {
  const t = { green: 0, yellow: 0, red: 0, skipped: 0 };
  for (const c of list) t[c.status] = (t[c.status] || 0) + 1;
  return t;
}

/**
 * Cost = plugin text measured in the transcripts (the static footprint is already
 * part of it, so it is only the fallback when no session was mined); benefit =
 * the delegation price saving, the one benefit proxy that is a token figure.
 * Without savings-log estimates cost and benefit are NOT comparable: `estimate`
 * stays null instead of a net number that would only subtract the measurable half
 * of the benefit from the whole cost. With estimated guard/local-llm savings in
 * the window (and mined sessions for the cost) they are added and `comparable` is true.
 */
function netEstimate(footprint, mining) {
  const sessions = mining.totals.sessions;
  const staticPerSession = footprint.components.filter((c) => !/measured/.test(c.name)).reduce((n, c) => n + c.tokens, 0);
  const injected = mining.totals.pluginInContextTokens;
  const costTokens = sessions > 0 ? injected : staticPerSession;
  const benefitTokens = mining.benefit.delegation.savedOpusEquivalentTokens;
  // Labelled estimates from the savings log (same mining window as the cost).
  // Gate catches (blocks) stay frequencies and are never added.
  const tg = mining.benefit.tokenGuard;
  const ll = mining.benefit.localLlm;
  const guardEst = tg && tg.estimated ? Number(tg.avoidedEstimate) || 0 : 0;
  const llmEst = ll && ll.estimated ? Number(ll.estTokens) || 0 : 0;
  const hasEstimates = (tg && tg.estimated) || (ll && ll.estimated);
  const base = {
    costTokens, benefitTokens,
    breakdown: { staticPerSession, sessions, injectedInTranscripts: injected, delegationSavedOpusEquivalent: benefitTokens },
    uncertainty: UNCERTAINTY,
  };
  if (!hasEstimates || sessions <= 0) return { ...base, estimate: null, comparable: false };
  const estimatedBenefitTokens = guardEst + llmEst;
  const total = benefitTokens + estimatedBenefitTokens;
  return {
    ...base, benefitTokens: total, estimate: total - costTokens, comparable: true,
    breakdown: { ...base.breakdown, estimatedBenefitTokens, tokenGuardAvoidedEstimate: guardEst, localLlmEstTokens: llmEst },
  };
}

async function collectAll(a) {
  const root = path.resolve(a.root || git(['rev-parse', '--show-toplevel'], process.cwd()) || process.cwd());
  const dir = state.stateDir(root, a.stateDir);
  const last = state.readLast(dir);
  const history = state.readHistory(dir);
  const prev = history[history.length - 1];
  const version = (readJson(path.join(root, 'plugins/devops/.claude-plugin/plugin.json')) || {}).version || 'unknown';
  const out = path.resolve(a.out || state.newRunDir(dir, version));
  fs.mkdirSync(out, { recursive: true });
  const now = Date.now();

  const footprint = collect({ root });
  const mining = await mine({ root, projectsDir: a.projectsDir, since: a.days ? undefined : (last && last.ranAt), days: a.days ? Number(a.days) : 30, now });
  const integrity = await runIntegrity({ root, skipTests: a.skipTests, previousSizes: prev && prev.sizes });
  const hygiene = await runHygiene({ root, now, mining });
  const net = netEstimate(footprint, mining);
  const results = { version, ranAt: new Date(now).toISOString(), trigger: a.trigger, previousAudit: last ? { version: last.version, ranAt: last.ranAt } : null, footprint, mining, benefit: mining.benefit, integrity, hygiene, net };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  if (a.trigger === 'ship') state.writePending(dir, { dir: out, version, createdAt: results.ranAt });
  return { results, out };
}

function summaryLine(r, out) {
  const i = tally(r.integrity); const h = tally(r.hygiene);
  const fmt = (t) => `${t.green}g/${t.yellow}y/${t.red}r/${t.skipped}s`;
  return `plugin-audit: v${r.version} | footprint ~${r.footprint.totalTokens} tok | integrity ${fmt(i)} | hygiene ${fmt(h)} | cost ~${r.net.costTokens} tok / ${r.net.comparable ? `benefit incl. estimates ~${r.net.benefitTokens} tok (net ~${r.net.estimate} tok, estimate)` : `measured benefit ~${r.net.benefitTokens} tok (not comparable)`} | ${out}`;
}

/**
 * The instruction a ship-triggered run prints after its summary line: open
 * the report now (SKILL.md steps 2–5), never ask first.
 */
function nextStepLine(out) {
  return `[plugin-audit] Next, in this session, WITHOUT asking: run .claude/skills/plugin-audit/SKILL.md steps 2-5 for ${out} ` +
    '(currency agent, synthesis agent, report.js, open the concept page via auto-concept Step 3, then --record). ' +
    'Never put it on the card as an open point or offer — the decade audit opens on its own.';
}

/** Step 5: record the finished run (after cc-currency merge + report). */
function record(a) {
  if (!a.in) return { error: '--record needs --in DIR' };
  const dir = state.stateDir(a.root || process.cwd(), a.stateDir);
  const results = readJson(path.join(path.resolve(a.in), 'results.json'));
  if (!results) return { error: `no results.json in ${a.in}` };
  const sugg = readJson(path.join(path.resolve(a.in), 'suggestions.json'), null);
  const summary = {
    version: results.version, ranAt: results.ranAt, trigger: results.trigger, dir: path.resolve(a.in),
    footprintTokens: results.footprint.totalTokens, costTokens: results.net.costTokens, benefitTokens: results.net.benefitTokens, estimate: results.net.estimate,
    integrity: tally(results.integrity), hygiene: tally(results.hygiene),
    suggestions: sugg && Array.isArray(sugg.suggestions) ? sugg.suggestions.length : 0,
    ccVersion: ((results.integrity.find((c) => c.id === 'cc-currency') || {}).metrics || {}).ccVersion || null,
    sizes: ((results.integrity.find((c) => c.id === 'size-trend') || {}).metrics || {}).sizes || null,
  };
  state.appendHistory(dir, summary);
  state.writeLast(dir, { version: results.version, trigger: results.trigger, ranAt: results.ranAt });
  const pending = path.join(dir, 'report-pending.json');
  const p = readJson(pending);
  if (p && path.resolve(p.dir) === path.resolve(a.in)) fs.rmSync(pending, { force: true });
  return { summary };
}

async function main(argv) {
  const a = parseArgs(argv);
  if (a.error) { process.stderr.write(`plugin-audit: ${a.error}\n`); return 2; }
  if (a.record) {
    const r = record(a);
    if (r.error) { process.stderr.write(`plugin-audit: ${r.error}\n`); return 2; }
    process.stdout.write(`plugin-audit: recorded v${r.summary.version} (${r.summary.ranAt})\n`);
    return 0;
  }
  const { results, out } = await collectAll(a);
  process.stdout.write(`${summaryLine(results, out)}\n`);
  if (a.trigger === 'ship') process.stdout.write(`${nextStepLine(out)}\n`);
  return 0;
}

module.exports = { parseArgs, netEstimate, summaryLine, nextStepLine, tally, record, collectAll, sizeMetrics, UNCERTAINTY };
if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`plugin-audit: ${e && e.stack || e}\n`); process.exitCode = 0; });
