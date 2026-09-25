'use strict';
/**
 * @module run-contract-cli
 * @version 0.3.1
 * @plugin devops
 * @description Run-contract CLI: `status | skip | park | done | abort |
 *   batch-clear | arm`. Split out of run-contract.js (AUD-016) —
 *   run-contract.js stays the facade and the CLI entry point (its
 *   `require.main` guard still calls this module's `cli()`).
 *
 *   AUD-010: `status` / `done` measure qa through lib/run-contract-qa.js's
 *   measureQa() — the same helper pre.run.contract.js's gate uses — instead
 *   of evaluating obligations against an empty ctx.
 */

const {
  disabled, contractPath, batchHandoffPath, readContract, arm, record, close,
  clearBatchHandoff, eventsOf, readJson, nowOf,
} = require('./run-contract-store');
const { segments, openObligations, short } = require('./run-contract-obligations');
// AUD-010: `status` / `done` used to evaluate obligations against an empty
// ctx — qa was never measured there, so `done` could close a run while qa
// was owed. measureQa() is the same helper pre.run.contract.js's gate uses.
const { measureQa } = require('./run-contract-qa');
// R13: share the gate's 15 s git-chain ceiling instead of measureQa()'s own
// 5 s gitBudget() default — `status` / `done` must not see `qa: null` from a
// budget the live pre-gate would not have run out of.
const { TOTAL_GIT_BUDGET_MS } = require('./git-timeout');

const OBLIGATIONS = Object.freeze(['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine', 'triage']);

function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; } else flags[key] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

/**
 * CLI entry. Commands: status · skip <ob> [--item N] --reason "<why>" ·
 * done [--reason] · abort --reason · arm --mode --flow --ship --passes [--strict] [--items].
 * @returns {number} 0 success, 1 usage error / nothing to act on
 */
// H-D14: one small handler per command. Each gets the parsed call
// `{pos, flags, cwd, now, reason, write, fail}` and returns the exit code.
// The outputs and usage texts are exactly what block messages point Claude at.
const CLI_COMMANDS = {
  status({ cwd, now, write }) {
    const c = readContract(cwd, { now });
    if (!c) { write({ ok: true, active: false, disabled: disabled(), path: contractPath(cwd) }); return 0; }
    const evs = eventsOf(cwd, c);
    const segs = segments(c, evs);
    // AUD-010: measured exactly like the gate — an unknown count (git
    // failure / expired budget) reports as `qa: null` here, "QA ?" on the card.
    const codeFilesChanged = measureQa(cwd, 'release', undefined, { totalMs: TOTAL_GIT_BUDGET_MS });
    write({
      ok: true, active: true, contract: c, segment: segs.length, events: evs.length,
      qa: codeFilesChanged, open: openObligations(c, evs, 'release', { codeFilesChanged }),
    });
    return 0;
  },
  skip({ pos, flags, cwd, now, reason, write, fail }) {
    const ob = pos[1];
    if (!ob || !OBLIGATIONS.includes(ob)) return fail(`usage: skip <${OBLIGATIONS.join('|')}> [--item N] --reason "<why>"`);
    if (!reason) return fail('skip needs --reason "<why>"');
    const item = flags.item !== undefined && flags.item !== true ? String(flags.item).replace(/^#/, '') : undefined;
    if (ob === 'refine' && !item) return fail('skip refine needs --item <N>');
    const ev = record(cwd, { k: 'skip', ob, reason: short(reason, 200), ...(item ? { item } : {}) }, { now });
    if (!ev) return fail('no active run contract');
    write({ ok: true, skipped: ob, item: item || null, reason: ev.reason });
    return 0;
  },
  done({ cwd, now, reason, write, fail }) {
    const c = readContract(cwd, { now });
    // R2 (red-team round 2 Q10): a defensive cleanup `done` (no active
    // contract at all) has nothing to refuse and nothing to close — it must
    // not exit 1. Only a contract that EXISTS and stays open (refused below)
    // keeps the non-zero exit; `ok:true` and exit 1 together used to mislead
    // a caller reading only the exit code into believing the run failed.
    if (!c) {
      write({ ok: true, closed: false, reason: 'no active contract' });
      return 0;
    }
    // AUD-010: measured before deciding — `done` must not close a run while
    // qa is owed just because nobody ever asked git for the diff.
    const codeFilesChanged = c ? measureQa(cwd, 'card', undefined, { totalMs: TOTAL_GIT_BUDGET_MS }) : null;
    const open = c ? openObligations(c, eventsOf(cwd, c), 'card', { codeFilesChanged }) : [];
    if (open.length) {
      const names = open.map(o => (o.item ? `${o.ob} #${o.item}` : o.ob)).join(', ');
      if (!reason) {
        return fail(`open obligations: ${names} — run them, skip <ob> --reason "<why>", or done --reason "<why>" (closes as aborted, card shows ✗)`);
      }
      const h = close(cwd, reason, { aborted: true, now });
      write({ ok: true, closed: !!h, aborted: true, open: names, id: h ? h.id : null });
      // R13: `closed: false` must not report success — a caller (or script)
      // reading only the exit code would otherwise believe the run ended.
      return h ? 0 : 1;
    }
    const h = close(cwd, reason || 'done', { now });
    write({ ok: true, closed: !!h, id: h ? h.id : null });
    return h ? 0 : 1;
  },
  park({ pos, cwd, now, reason, write, fail }) {
    const item = pos[1] ? String(pos[1]).replace(/^#/, '') : '';
    if (!item) return fail('usage: park <item> --reason "<why>"');
    if (!reason) return fail('park needs --reason "<why>"');
    const ev = record(cwd, { k: 'park', item, reason: short(reason, 200) }, { now });
    if (!ev) return fail('no active run contract');
    write({ ok: true, parked: item, reason: ev.reason });
    return 0;
  },
  abort({ cwd, now, reason, write, fail }) {
    if (!reason) return fail('abort needs --reason "<status>: <why>"');
    const h = close(cwd, reason, { aborted: true, now });
    if (!h) return fail('no active run contract');
    write({ ok: true, aborted: true, id: h.id, reason });
    return 0;
  },
  'batch-clear'({ cwd, reason, write, fail }) {
    if (!reason) return fail('batch-clear needs --reason "<why>"');
    const had = !!readJson(batchHandoffPath(cwd));
    clearBatchHandoff(cwd);
    write({ ok: true, cleared: had, reason: short(reason, 200) });
    return 0;
  },
  arm({ flags, cwd, now, write, fail }) {
    const mode = flags.mode === undefined ? 'prompt' : flags.mode;
    const flow = flags.flow === undefined ? 'interactive' : flags.flow;
    const ship = flags.ship === undefined ? 'manual' : flags.ship;
    if (!['prompt', 'backlog', 'audit'].includes(mode)) return fail('--mode prompt|backlog|audit');
    if (!['interactive', 'autonomous'].includes(flow)) return fail('--flow interactive|autonomous');
    if (!['auto', 'manual'].includes(ship)) return fail('--ship auto|manual');
    let passes = ['harden', 'polish'];
    if (flags.passes !== undefined) {
      const raw = flags.passes === true ? '' : String(flags.passes);
      passes = /^(none|keine|)$/i.test(raw) ? [] : raw.split(',').map(s => s.trim().toLowerCase());
      if (passes.some(p => p !== 'harden' && p !== 'polish')) return fail('--passes harden,polish|none');
    }
    const items = typeof flags.items === 'string' ? flags.items.split(',') : [];
    const sessionId = typeof flags.session === 'string' ? flags.session : null;
    const h = arm(cwd, { source: 'cli', mode, modeFrom: 'cli', flow, ship, passes, strict: flags.strict === true || flags.strict === 'on', items, sessionId }, { now });
    if (!h) return fail(disabled() ? 'run contract disabled (DOTCLAUDE_RUN_CONTRACT=off)' : 'could not write the contract');
    write({ ok: true, armed: true, contract: h });
    return 0;
  },
};

const CLI_USAGE = 'usage: run-contract.js status | skip <ob> [--item N] --reason "<why>" | park <item> --reason "<why>" | done [--reason "<why>"] | abort --reason "<why>" | batch-clear --reason "<why>" | arm --mode <m> --flow <f> --ship <s> --passes <p> [--strict] [--items 1,2] [--session <id>] [--cwd <path>]';

function cli(argv, opts = {}) {
  const { pos, flags } = parseArgv(Array.isArray(argv) ? argv : []);
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : (opts.cwd || process.cwd());
  const write = opts.out || ((o) => process.stdout.write(JSON.stringify(o) + '\n'));
  const fail = (error) => { write({ ok: false, error }); return 1; };
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  const handler = Object.prototype.hasOwnProperty.call(CLI_COMMANDS, pos[0]) ? CLI_COMMANDS[pos[0]] : null;
  if (!handler) return fail(CLI_USAGE);
  return handler({ pos, flags, cwd, now: nowOf(opts), reason, write, fail });
}

module.exports = { cli, CLI_COMMANDS, CLI_USAGE, OBLIGATIONS };
