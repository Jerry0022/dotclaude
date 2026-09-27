/**
 * @module ship-delegate
 * @version 1.0.0
 * @plugin devops
 * @description The "ship in a fresh-context subagent" instruction, shared by
 *   `prompt.ship.detect` (which emits it instead of the plain
 *   Skill('devops:do-ship') mandate) and its test.
 *
 *   Why: a /do-ship runs ~16 API calls, each re-reading the WHOLE context, and
 *   it runs at the end of a session when that context is largest. Measured
 *   over 10 sessions (2026-09-21): Ø 434 k tokens per ship call, ~24 % of
 *   the session's tokens for a step that produces ~10 k output tokens.
 *   No hook or skill can compact the context, so the old answer (v0.4 of the
 *   former lib/ship-compact.js) stopped the ship and made the user type
 *   `/compact` plus a new ship prompt. The pipeline does not need the
 *   conversation, only a brief of it: the main session writes that brief
 *   once and a general-purpose subagent runs do-ship on a fresh context
 *   (`--delegated`, skills/do-ship/modes/delegated.md). The user types
 *   nothing extra; the main session renders the card from the payload the
 *   subagent returns.
 *
 *   - Threshold `DOTCLAUDE_SHIP_DELEGATE_THRESHOLD` (tokens; `0` disables;
 *     the old `DOTCLAUDE_SHIP_COMPACT_THRESHOLD` is still read as a
 *     fallback), default 200 k. Delegating costs no user prompt, so the bar
 *     is lower than the old stop's 350 k: a subagent starts at roughly
 *     50 k (system prompt, tool schemas, brief), so at 200 k one ship
 *     already saves ≈ 2.4 M cache reads.
 *   - `--inline` (or the old `--no-compact`) keeps one ship in the main
 *     context.
 *   - Never for a promotion-only run (`promotionOnly`): ~4 calls, not ~16.
 *   - Only user prompts reach the hook, so an orchestrator's Skill-tool ship
 *     (`/do-run backlog`, auto-cleanup) always runs where it was invoked.
 */

const { formatTokens } = require('./context-size');

const DEFAULT_THRESHOLD = 200_000;

/** What a fresh subagent carries before its first ship call: system prompt,
 *  tool schemas, the skill and the brief. */
const SUBAGENT_FLOOR = 50_000;

/** `/do-ship --inline`, `ship it --no-compact` — one-shot opt-out. */
const INLINE = /(^|\s)--(inline|no-compact)\b/i;

/**
 * Threshold in tokens; 0 = disabled.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function threshold(env = process.env) {
  const raw = env.DOTCLAUDE_SHIP_DELEGATE_THRESHOLD || env.DOTCLAUDE_SHIP_COMPACT_THRESHOLD;
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THRESHOLD;
}

/**
 * What delegating saves on one ship: the context above the subagent's own
 * floor, re-read ~16 times.
 * @param {number} tokens
 * @returns {string} "≈ 5.3 M"
 */
function shipSavingEstimate(tokens) {
  const m = (Math.max(0, tokens - SUBAGENT_FLOOR) * 16) / 1_000_000;
  return m >= 10 ? `≈ ${Math.round(m)} M` : `≈ ${m.toFixed(1)} M`;
}

/**
 * Whether this ship prompt goes to a subagent.
 * @param {{ tokens: number|null, prompt: string, promotionOnly?: boolean, env?: NodeJS.ProcessEnv }} o
 * @returns {boolean}
 */
function shouldDelegate({ tokens, prompt, promotionOnly = false, env = process.env }) {
  const limit = threshold(env);
  if (!limit || tokens == null || tokens < limit) return false;
  if (promotionOnly) return false;
  return !INLINE.test(prompt || '');
}

/**
 * The instruction block that replaces the inline ship mandate.
 * @param {{ tokens: number, skillArgs?: string, pluginRoot: string, env?: NodeJS.ProcessEnv }} o
 *   skillArgs — the do-ship argument the inline mandate would have passed
 *   ("stable", "promote 0.193.0", …); `--delegated` is prepended.
 * @returns {string}
 */
function shipDelegateInstruction({ tokens, skillArgs = '', pluginRoot, sessionId = '', env = process.env }) {
  const args = ['--delegated', skillArgs].filter(Boolean).join(' ');
  const mode = `${String(pluginRoot).replace(/\\/g, '/')}/skills/do-ship/modes/delegated.md`;
  return [
    `[ship-delegate] Context is ${formatTokens(tokens)} tokens (threshold ${formatTokens(threshold(env))}). The ship runs in a`,
    `fresh-context subagent instead of here: it saves ${shipSavingEstimate(tokens)} cache-read tokens and the user types nothing extra.`,
    'Do NOT run the pipeline in this context: no ship_* call, no git push/merge — even if the do-ship skill is already loaded.',
    '',
    '1. If this session still has its OWN background agents or commands running, ask the user first (wait / ship anyway / cancel).',
    '2. Write the brief from this conversation — the subagent sees nothing else:',
    '   intent (the user\'s key prompts, verbatim) · what changed, as ≤ 3 functional changes (area → description) ·',
    '   findings and decisions with their why (root causes, rejected alternatives — they feed PR body and CHANGELOG) ·',
    '   tests that ran + results · validation (requirement → how met → how confirmed) · open points · issue refs ·',
    '   anything the ship must know (bump hint, risks, files not to commit). The subagent reads the diff itself —',
    '   the brief carries what the diff cannot: the why.',
    ...spawnAndDeliver({ args, sessionId, description: 'Ship im Subagenten', brief: true }),
    `Details (read only on trouble): ${mode}`,
  ].join('\n');
}

/**
 * Steps 3–4 of the delegate / resume instruction: flags, spawn, decisions,
 * delivery. The subagent renders the card itself, with THIS session's id,
 * and the parent only shows it: a project ship extension may run a finalizer
 * right after the render that marks the plugin's MCP servers stale (the
 * dotclaude plugin self-sync), so a render left to the parent would be
 * blocked. That is the same order the inline pipeline keeps.
 * @param {{ args: string, sessionId: string, description: string, brief: boolean }} o
 * @returns {string[]}
 */
function spawnAndDeliver({ args, sessionId, description, brief }) {
  const sid = sessionId || '<this session_id>';
  const briefPart = brief ? '\\nBrief:\\n<brief>' : '';
  return [
    '3. Flags only you can set — the subagent never sees this conversation: add --keep when the user announced',
    '   follow-up work in this branch (do-ship Step 5a signals), --no-watch when the user asked for no deploy watcher.',
    `   Agent({ subagent_type: "general-purpose", model: "<this session's model family: opus|sonnet|fable>", run_in_background: false, description: "${description}",`,
    `     prompt: 'Use Skill("devops:do-ship") with args "${args}". session_id: ${sid}. lang: <the user language>.${briefPart}' })`,
    '4. Relay the agent card of the spawn verbatim first (pre.agent.relay holds the next tool call until it is shown).',
    '   The agent ends with ONE fenced json block:',
    '   { "status": "decision", "question", "options", "recommended" } → AskUserQuestion, then SendMessage the answer',
    '     to the same agent and wait for its next result.',
    '   { "status": "done", "titlePrefix", "widgetFile" | "markdown", "exitWorktree" } → the card is already rendered.',
    '     exitWorktree true: ExitWorktree({ action: "remove" }) first. Set the session title to titlePrefix + the title',
    '     without its old devops prefix. Desktop: Read widgetFile and pass its content verbatim to show_widget',
    '     (title "completion_card_body") as the LAST action; terminal: output markdown verbatim. No text of your own,',
    '     no second render_completion_card.',
    "   No JSON block or a failed agent: render a ship-blocked card yourself that names the agent's last words.",
  ];
}

/**
 * The mandate for a prompt that resumes an interrupted ship
 * (lib/ship-resume.js): pick up at the step that did not finish, delegated
 * when the context is large, never from scratch.
 * @param {{ resume: { checkpoint: object, next: string, summary: string }, delegate: boolean, pluginRoot: string, now?: number }} o
 * @returns {string}
 */
function shipResumeInstruction({ resume, delegate, pluginRoot, sessionId = '', now = Date.now() }) {
  const cp = resume.checkpoint;
  const ageMin = typeof cp.updatedAt === 'number' ? Math.max(0, Math.round((now - cp.updatedAt) / 60000)) : null;
  const root = String(pluginRoot).replace(/\\/g, '/');
  const decisions = Array.isArray(cp.decisions) && cp.decisions.length
    ? `Decisions the user already made (never ask them again): ${cp.decisions.map((d) => `"${d.question}" → ${d.answer}`).join('; ')}.`
    : '';
  const how = delegate
    ? [
      `Resume it in a fresh-context subagent.${cp.brief ? ' The brief is stored in the ship checkpoint — do not write a new one.' : ' No brief is stored yet — write one from this conversation: intent verbatim · ≤ 3 functional changes · findings and decisions with their why · tests · validation · open points · issue refs · risks.'}`,
      ...spawnAndDeliver({ args: '--delegated --resume', sessionId, description: 'Ship fortsetzen', brief: !cp.brief }),
      `Details: ${root}/skills/do-ship/modes/delegated.md`,
    ].filter(Boolean)
    : ['MANDATORY: Use Skill("devops:do-ship") with args "--resume".'];
  return [
    `[ship-resume] An interrupted /do-ship of branch ${cp.branch || '?'} is waiting here${ageMin == null ? '' : ` (last step ${ageMin} min ago)`}.`,
    `Progress: ${resume.summary}`,
    'This prompt continues it. Do NOT start the ship over and do NOT rebuild context from the conversation:',
    'the checkpoint and git/gh are the truth. Steps marked ✓ are never repeated (no second bump, PR or tag).',
    ...how,
    decisions,
    'The session title stays "🚀 Shipping – " and the turn ends with the ship\'s own card (Shipped / Blocked).',
  ].filter(Boolean).join('\n');
}

module.exports = {
  DEFAULT_THRESHOLD, SUBAGENT_FLOOR, INLINE,
  threshold, shipSavingEstimate, shouldDelegate, shipDelegateInstruction, shipResumeInstruction,
};
