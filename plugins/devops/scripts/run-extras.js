#!/usr/bin/env node
'use strict';
if (require.main === module && !require('../hooks/lib/features').featureAllowed('frustrated-mode')) {
  process.stderr.write('frustrated-mode: not available on this channel\n');
  process.exit(126);
}
/**
 * @script run-extras
 * @feature frustrated-mode (alpha)
 * @description Channel-gated extras for `/do-run`, decided in code so the
 *   router never has to remember a condition:
 *
 *   node run-extras.js q4 [--session <id>]
 *     -> {"extra":null} or {"extra":{id,label,description,wins:true}}: the
 *        extra Q4 option. Shown only when the feature is allowed on this
 *        channel AND this session is flagged right now. Session id: --session,
 *        else $CLAUDE_CODE_SESSION_ID / $CLAUDE_SESSION_ID; none -> not shown.
 *   node run-extras.js from <name>
 *     -> {"known":true,"doc","section"} for a hand-off preset name this channel
 *        knows (the doc to read), else {"known":false}. Unknown -> ignore it.
 *   node run-extras.js handoff --plan <id>@<short> [--cwd <dir>]
 *     -> {"ok":true,...} when that plan is approved, unexpired and matches
 *        id + hash; else {"ok":false,"error"} and exit 1 (the run must stop).
 *
 *   Exit: 0 ok, 1 refused, 2 usage, 126 not available on this channel.
 *   Reads state only; writes nothing.
 */

const FEATURE = 'frustrated-mode';
const DOC = 'deep-knowledge/frustrated-mode.md';

const EXTRA = Object.freeze({
  id: 'analyze-first',
  label: 'Erst analysieren',
  description: 'Ursachen klären, Plan vorschlagen, nichts umsetzen. Gewinnt gegen andere Haken.',
  wins: true,
  doc: 'deep-knowledge/frustrated-mode.md',
  section: 'do-run option',
});

/** The extra Q4 option for this session, or null. Never throws. */
function q4Extra(sessionId, opts = {}) {
  try {
    const features = require('../hooks/lib/features');
    if (!features.featureAllowed(FEATURE, opts)) return null;
    const { isSessionFlagged } = require('../hooks/lib/frustration-state');
    return isSessionFlagged(sessionId, { file: opts.stateFile, nowMs: opts.nowMs }) ? { ...EXTRA } : null;
  } catch { return null; }
}

/** `fm-…@3f9a1c2e` -> {id, short} or null. */
function parsePlanRef(ref) {
  const m = /^(fm-[A-Za-z0-9-]+)@([0-9a-fA-F]{8,64})$/.exec(String(ref || '').trim());
  return m ? { id: m[1], short: m[2].toLowerCase() } : null;
}

/**
 * Is the referenced plan approved, unexpired and exactly the one named?
 * Verifies through the recorder's own status (which drops expired records).
 */
function checkHandoff(ref, cwd, opts = {}) {
  const sel = parsePlanRef(ref);
  if (!sel) return { ok: false, error: 'plan reference must look like fm-<id>@<hash8> — nothing runs' };
  let st;
  try {
    st = require('../hooks/lib/run-contract-plan').statusPlan(cwd, {}, opts);
  } catch (e) { return { ok: false, error: `plan status failed: ${e.message} — nothing runs` }; }
  if (!st || st.disabled || st.ok === false) return { ok: false, error: 'plan status unavailable — nothing runs' };
  const p = st.plan;
  if (!st.active || !p) return { ok: false, error: 'no plan record (none, or it expired after 2 h) — nothing runs' };
  if (p.id !== sel.id || !String(p.hash || '').startsWith(sel.short)) {
    return { ok: false, error: `plan changed — recorded is ${p.id} · ${p.short}, not ${sel.id} · ${sel.short.slice(0, 8)}; ask for approval again`, plan: p };
  }
  if (p.state !== 'approved') return { ok: false, error: `plan ${p.id} is ${p.state}, not approved — nothing runs`, plan: p };
  const exp = Date.parse(p.expiresAt);
  if (!Number.isFinite(exp) || exp <= (opts.now || Date.now())) return { ok: false, error: `approval of ${p.id} expired — nothing runs`, plan: p };
  return { ok: true, plan: p, steps: st.steps, doc: DOC };
}

const PRESETS = Object.freeze({ frustrated: { doc: DOC, section: 'Hand-off' } });

/** Hand-off preset lookup for `--from=<name>`; only where the feature is allowed. */
function fromPreset(name, opts = {}) {
  try {
    if (!require('../hooks/lib/features').featureAllowed(FEATURE, opts)) return { known: false };
    const p = Object.prototype.hasOwnProperty.call(PRESETS, name) ? PRESETS[name] : null;
    return p ? { known: true, ...p } : { known: false };
  } catch { return { known: false }; }
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const [cmd] = argv;
  if (cmd === 'q4') {
    const sid = arg(argv, '--session') || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
    process.stdout.write(`${JSON.stringify({ extra: q4Extra(sid) })}\n`);
    return 0;
  }
  if (cmd === 'from') {
    process.stdout.write(`${JSON.stringify(fromPreset(String(argv[1] || '')))}
`);
    return 0;
  }
  if (cmd === 'handoff') {
    const ref = arg(argv, '--plan');
    if (!ref) { process.stderr.write('usage: run-extras.js handoff --plan <id>@<short> [--cwd <dir>]\n'); return 2; }
    const out = checkHandoff(ref, arg(argv, '--cwd') || process.cwd());
    process.stdout.write(`${JSON.stringify(out)}\n`);
    return out.ok ? 0 : 1;
  }
  process.stderr.write('usage: run-extras.js q4 [--session <id>] | from <name> | handoff --plan <id>@<short> [--cwd <dir>]\n');
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { q4Extra, fromPreset, parsePlanRef, checkHandoff, EXTRA, DOC, FEATURE };
