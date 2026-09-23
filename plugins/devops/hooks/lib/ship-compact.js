/**
 * @module ship-compact
 * @version 0.3.0
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
 *   Careful by design, because every advice costs the user a prompt:
 *   - Threshold `DOTCLAUDE_SHIP_COMPACT_THRESHOLD` (tokens; `0` disables),
 *     default 350 k. A compacted session does not drop to zero — system
 *     prompt, tools and summary leave ~100 k (measured 103–113 k after three
 *     compactions, 2026-09-22) — so the saving is (context − ~100 k) × 16.
 *     At the old 200 k default ~70 % of all ships were stopped for a saving
 *     as small as ~1.6 M cache reads; at 350 k it is ~1/3 of ships, each
 *     saving ≥ 4 M.
 *   - Never twice in a row: a ship prompt right after an advice is the
 *     user's informed answer and runs (`advisedBefore`). Asking again only
 *     made the user compact twice and then type `--no-compact` anyway.
 *   - Never for a ship an orchestrator invokes through the Skill tool
 *     (those are not user prompts), `--no-compact` skips it for one ship.
 *
 *   The advice ends in a completion card (`compact` field, 2026-09-23) that
 *   spells out the `/compact` command. On Desktop its one button "Ohne
 *   Kompaktieren shippen" prefills `ship --no-compact` (a card button can only
 *   prefill the composer, never send). A "Kompaktieren" button was tried and
 *   dropped: the host refuses any prefill starting with "/", leading space or not.
 */

const { formatTokens } = require('./context-size');

const DEFAULT_THRESHOLD = 350_000;

/** What a compacted session still carries: system prompt, tool schemas,
 *  summary, preserved tail. Measured 103–113 k (2026-09-22). */
const POST_COMPACT_FLOOR = 100_000;

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
 * What compacting first saves on one ship: the context above the
 * post-compact floor, re-read ~16 times.
 * @param {number} tokens
 * @returns {string} "≈ 5.3 M"
 */
function shipSavingEstimate(tokens) {
  return shipCostEstimate(Math.max(0, tokens - POST_COMPACT_FLOOR));
}

/**
 * The advice block, or null when the ship should just run.
 * @param {{ tokens: number|null, prompt: string, advisedBefore?: boolean, env?: NodeJS.ProcessEnv }} o
 *   advisedBefore — the previous ship prompt of this session already got the
 *   advice; this one is the user's answer and runs.
 * @returns {string|null}
 */
function shipCompactAdvice({ tokens, prompt, advisedBefore = false, env = process.env }) {
  const limit = threshold(env);
  if (!limit || tokens == null || tokens < limit) return null;
  if (advisedBefore) return null;
  if (NO_COMPACT.test(prompt || '')) return null;
  const size = formatTokens(tokens);
  return [
    `[ship-compact] Context is ${size} tokens (threshold ${formatTokens(limit)}). A /ship on this context`,
    `re-reads it ~16 times (${shipCostEstimate(tokens)} tokens, almost all cache reads) for ~10 k tokens of output.`,
    'Do NOT start the ship pipeline on this prompt: no ship skill, no ship_preflight, no git/gh',
    'command — even if the ship skill is already loaded in this turn. No hook or skill can trigger a compaction —',
    'the user has to. End the turn with the completion card and nothing else — render_completion_card with:',
    '',
    `  variant: "ship-blocked", summary: "Ship angehalten — Kontext erst kompaktieren", compact: { tokens: ${tokens} }`,
    '',
    'plus lang, cwd and session_id as always. The card carries the saving, the full /compact command as text',
    'and, on Desktop, one button "Ohne Kompaktieren shippen" (puts "ship --no-compact" into the input box).',
    'Relay it like every card; no text of your own.',
  ].join('\n');
}

module.exports = {
  DEFAULT_THRESHOLD, POST_COMPACT_FLOOR, NO_COMPACT, COMPACT_FOCUS,
  threshold, shipCostEstimate, shipSavingEstimate, shipCompactAdvice,
};
