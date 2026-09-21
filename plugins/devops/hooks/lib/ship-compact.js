/**
 * @module ship-compact
 * @version 0.1.0
 * @plugin devops
 * @description The "careful compact before /ship" advice, shared by
 *   `prompt.ship.detect` (which emits it instead of the Skill('ship')
 *   instruction) and its test.
 *
 *   Why: a /ship runs ~16 API calls, each re-reading the WHOLE context, and
 *   it runs at the end of a session when that context is largest. Measured
 *   over 10 sessions (2026-09-21): Ø 434 k tokens per ship call, ~24 % of
 *   the session's tokens for a step that produces ~10 k output tokens.
 *   Nothing in Claude Code lets a hook or skill trigger a compaction — only
 *   the user can, with `/compact [focus]`. So the best a hook can do is
 *   measure, stop BEFORE the pipeline pays, and hand the user the exact
 *   command. One extra prompt from the user; the ship then runs on a
 *   context a fraction of the size.
 *
 *   Careful by design: the advice only fires above a threshold, never for a
 *   ship an orchestrator invokes through the Skill tool (those are not user
 *   prompts), and `--no-compact` on the prompt skips it for one ship.
 *   Threshold: `DOTCLAUDE_SHIP_COMPACT_THRESHOLD` (tokens; `0` disables),
 *   default 200 k — a compaction of a 200 k context costs one full read and
 *   saves ~15.
 */

const { formatTokens } = require('./context-size');

const DEFAULT_THRESHOLD = 200_000;

/** `/ship --no-compact`, `ship it --no-compact` — one-shot opt-out. */
const NO_COMPACT = /(^|\s)--no-compact\b/i;

/** The compaction focus. It names what the user asked to keep (2026-09-21:
 *  "insbesondere die Prompts, Intentionen und Probleme") plus what the ship
 *  itself needs to re-enter cleanly. */
const COMPACT_FOCUS = 'Ship steht an. Behalte: die Prompts und Absichten des Users im Wortlaut, '
  + 'aufgetretene Probleme und ihre Lösungen, Branch und Worktree, geänderte Dateien, '
  + 'Test-Kommando, offene Punkte. Verwirf: Tool-Outputs und Zwischenstände.';

/**
 * Threshold in tokens; 0 = disabled.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function threshold(env = process.env) {
  const raw = env.DOTCLAUDE_SHIP_COMPACT_THRESHOLD;
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

/**
 * Rough cost of one ship on the given context: ~16 calls that each re-read it.
 * @param {number} tokens
 * @returns {string} "≈ 7 M"
 */
function shipCostEstimate(tokens) {
  const m = (tokens * 16) / 1_000_000;
  return m >= 10 ? `≈ ${Math.round(m)} M` : `≈ ${m.toFixed(1)} M`;
}

/**
 * The advice block, or null when the ship should just run.
 * @param {{ tokens: number|null, prompt: string, env?: NodeJS.ProcessEnv }} o
 * @returns {string|null}
 */
function shipCompactAdvice({ tokens, prompt, env = process.env }) {
  const limit = threshold(env);
  if (!limit || tokens == null || tokens < limit) return null;
  if (NO_COMPACT.test(prompt || '')) return null;
  const size = formatTokens(tokens);
  return [
    `[ship-compact] Context is ${size} tokens (threshold ${formatTokens(limit)}). A /ship on this context`,
    `re-reads it ~16 times (${shipCostEstimate(tokens)} tokens, almost all cache reads) for ~10 k tokens of output.`,
    'Do NOT start the ship pipeline on this prompt: no ship skill, no ship_preflight, no git/gh',
    'command — even if the ship skill is already loaded in this turn. No hook or skill can trigger a compaction —',
    'the user has to. Show the user this block verbatim, then end the turn (no completion card needed:',
    'nothing ran):',
    '',
    `Kontext: ${size} Tokens — ein Ship darauf kostet ${shipCostEstimate(tokens)} Tokens. Erst kompaktieren, dann erneut shippen:`,
    '',
    `/compact ${COMPACT_FOCUS}`,
    '',
    'Danach: `/ship` — oder jetzt ohne Kompaktierung: `/ship --no-compact`',
  ].join('\n');
}

module.exports = { DEFAULT_THRESHOLD, NO_COMPACT, COMPACT_FOCUS, threshold, shipCostEstimate, shipCompactAdvice };
