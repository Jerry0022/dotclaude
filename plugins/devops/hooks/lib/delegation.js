'use strict';
/**
 * @lib delegation
 * @version 0.1.0
 * @plugin devops
 * @description The kill-switch for the always-on delegation policy
 *   (`deep-knowledge/agent-proactivity.md`). Three modes:
 *     auto — the policy as written (default);
 *     ask  — no proactive spawn: every tier above Inline is offered in one
 *            sentence and runs only on a yes;
 *     off  — no proactive delegation at all, not even the offer.
 *   The switch governs PROACTIVE behaviour only: an explicit run-* skill and
 *   an explicit "with agents" in the prompt always win (they are the user
 *   asking, which the switch never overrides).
 *
 *   Resolution, first hit wins:
 *     1. env DOTCLAUDE_DELEGATION / EVAL_DOTCLAUDE_DELEGATION (eval runs)
 *     2. <project>/.claude/delegation.json   { "mode": "off" | "ask" | "auto" }
 *     3. ~/.claude/delegation.json           same shape, machine-wide
 *     4. auto
 *   A record that exists but is unreadable or names an unknown mode resolves
 *   to `ask` and says so: the user reached for the switch, so silently
 *   staying on `auto` would be wrong, and silently going `off` would hide a
 *   typo behind "the agents just stopped coming".
 *   Hooks only READ the record — the user writes it by hand.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODES = ['auto', 'ask', 'off'];
const REL = path.join('.claude', 'delegation.json');

/** @returns {{mode: string|null, invalid: boolean}} null mode = no record */
function readRecord(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return { mode: null, invalid: false }; }
  try {
    const obj = JSON.parse(raw);
    const mode = obj && typeof obj === 'object' && typeof obj.mode === 'string'
      ? obj.mode.trim().toLowerCase() : '';
    return MODES.includes(mode) ? { mode, invalid: false } : { mode: null, invalid: true };
  } catch { return { mode: null, invalid: true }; }
}

/**
 * @param {{cwd?: string, home?: string, env?: object}} [opts]
 * @returns {{mode: string, source: 'env'|'project'|'global'|'default'|'invalid', scope: 'project'|'global'|null}}
 *   `scope` names the record consulted (also for an invalid one); null for env/default.
 */
function readDelegation({ cwd = process.cwd(), home = os.homedir(), env = process.env } = {}) {
  const fromEnv = (env.DOTCLAUDE_DELEGATION || env.EVAL_DOTCLAUDE_DELEGATION || '').trim().toLowerCase();
  if (MODES.includes(fromEnv)) return { mode: fromEnv, source: 'env', scope: null };

  const p = readRecord(path.join(cwd, REL));
  if (p.mode) return { mode: p.mode, source: 'project', scope: 'project' };
  if (p.invalid) return { mode: 'ask', source: 'invalid', scope: 'project' };

  const g = readRecord(path.join(home, REL));
  if (g.mode) return { mode: g.mode, source: 'global', scope: 'global' };
  if (g.invalid) return { mode: 'ask', source: 'invalid', scope: 'global' };

  return { mode: 'auto', source: 'default', scope: null };
}

const FILE = { project: '.claude/delegation.json', global: '~/.claude/delegation.json' };

/** Where the mode came from, for the SessionStart line. */
function origin(d) {
  if (d.source === 'env') return 'env';
  if (d.source === 'default') return 'default';
  return d.source === 'invalid' ? `${FILE[d.scope]} invalid → ask` : FILE[d.scope];
}

/**
 * The one-line `[delegation] …` state injected at SessionStart. Always
 * present so the mode is visible — and so a user who never heard of the
 * switch learns where it lives.
 */
function delegationLine(d) {
  const what = {
    auto: 'tiers as in the policy',
    ask: 'no proactive spawn — offer any tier above Inline in one sentence, run only on a yes',
    off: 'no proactive delegation, no offers — only an explicit run-* skill or "with agents" in the prompt spawns',
  }[d.mode];
  return `[delegation] ${d.mode} (${origin(d)}) — ${what}. Switch: ${FILE.project} {"mode":"auto"|"ask"|"off"} (project) or ${FILE.global}.`;
}

module.exports = { MODES, REL, readDelegation, delegationLine };
