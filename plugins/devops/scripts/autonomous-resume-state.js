#!/usr/bin/env node
/**
 * autonomous-resume-state.js — carry an interrupted autonomous run's do-run
 * answers (ship / strict / flow, plus mode, passes and items) across the
 * interruption, so the resume re-arms the run contract the way the user chose
 * it instead of with the CLI defaults (`ship manual`, not strict).
 *
 * do-run autonomous mode:
 *   - Step 7a, INTERRUPTED status, BEFORE `run-contract.js abort`:
 *       save   → merges `run: {...}` from the live contract into
 *                AUTONOMOUS-RESUME.json (the late-permission / bail protocol
 *                wrote the rest of that file already; a missing file is created)
 *   - Step 0.5 "If resuming":
 *       rearm  → arms a fresh contract from that `run` block. A resume file
 *                without one (written before this script existed) re-arms
 *                with the defaults and says so (`legacy: true`), so the
 *                caller can name the downgrade instead of shipping silently
 *                under a different mode.
 *
 * CLI (stdout: one JSON line; exit 0 ok, 1 nothing to act on / usage):
 *   save  [--cwd <path>] [--file <path>]
 *   rearm [--cwd <path>] [--file <path>] [--session <id>]
 * `--file` defaults to <work-tree root>/AUTONOMOUS-RESUME.json.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('../hooks/lib/run-contract-store');
const { projectRoot } = require('../hooks/lib/project-root');

const RESUME_FILE = 'AUTONOMOUS-RESUME.json';
// The header fields that are the user's do-run answers — everything else in
// the header (id, armedAt, root, closedAt, …) belongs to one contract only.
const RUN_KEYS = Object.freeze(['mode', 'flow', 'ship', 'strict', 'passes', 'items', 'milestones', 'rethink', 'burn', 'presence', 'alsoAudit']);

function resumePath(cwd, file) {
  return typeof file === 'string' && file ? path.resolve(cwd, file) : path.join(projectRoot(cwd), RESUME_FILE);
}

function readJsonObject(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

/** The do-run answers of a contract header, normalised. */
function runOf(header) {
  const h = store.sanitize({ ...header });
  const out = {};
  for (const k of RUN_KEYS) if (h[k] !== undefined) out[k] = h[k];
  return out;
}

/**
 * Merge the live contract's answers into the resume file.
 * @returns {{ok:boolean, file?:string, run?:object, error?:string}}
 */
function save(cwd, opts = {}) {
  const c = store.readContract(cwd, { now: opts.now });
  if (!c) return { ok: false, error: 'no active run contract — save runs before `run-contract.js abort`' };
  const file = resumePath(cwd, opts.file);
  const existing = fs.existsSync(file) ? readJsonObject(file) : {};
  if (!existing) return { ok: false, error: `${file} is not a JSON object — not overwritten` };
  const run = runOf(c);
  try {
    fs.writeFileSync(file, JSON.stringify({ ...existing, run }, null, 2) + '\n');
  } catch (e) {
    return { ok: false, error: `could not write ${file}: ${e.message}` };
  }
  return { ok: true, file, run };
}

/**
 * Arm a fresh contract from the resume file's `run` block. The resumed run is
 * autonomous by definition, so a missing `flow` reads as `autonomous`.
 * @returns {{ok:boolean, contract?:object, legacy?:boolean, error?:string}}
 */
function rearm(cwd, opts = {}) {
  const file = resumePath(cwd, opts.file);
  const data = readJsonObject(file);
  if (!data) return { ok: false, error: `no readable ${file}` };
  const saved = data.run && typeof data.run === 'object' && !Array.isArray(data.run) ? data.run : null;
  const run = saved ? runOf(saved) : {};
  const header = {
    ...run,
    flow: saved && saved.flow ? run.flow : 'autonomous',
    source: 'resume',
    modeFrom: 'resume',
    sessionId: typeof opts.sessionId === 'string' ? opts.sessionId : null,
  };
  const h = store.arm(cwd, header, { now: opts.now });
  if (!h) return { ok: false, error: store.disabled() ? 'run contract disabled (DOTCLAUDE_RUN_CONTRACT=off)' : 'could not write the contract' };
  return saved
    ? { ok: true, contract: h }
    : { ok: true, contract: h, legacy: true, warning: `${RESUME_FILE} holds no run answers — re-armed with ship ${h.ship}, strict ${h.strict}; name this on the card` };
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[a.slice(2)] = next; i++; } else flags[a.slice(2)] = true;
  }
  return flags;
}

function cli(argv, opts = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const flags = parseFlags(args.slice(1));
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : (opts.cwd || process.cwd());
  const write = opts.out || ((o) => process.stdout.write(JSON.stringify(o) + '\n'));
  const file = typeof flags.file === 'string' ? flags.file : undefined;
  let r;
  if (args[0] === 'save') r = save(cwd, { file, now: opts.now });
  else if (args[0] === 'rearm') r = rearm(cwd, { file, now: opts.now, sessionId: typeof flags.session === 'string' ? flags.session : undefined });
  else r = { ok: false, error: 'usage: autonomous-resume-state.js save|rearm [--cwd <path>] [--file <path>] [--session <id>]' };
  write(r);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = cli(process.argv.slice(2));

module.exports = { save, rearm, runOf, cli, RUN_KEYS, RESUME_FILE };
