/**
 * @module ship-delegate
 * @version 1.3.0
 * @plugin devops
 * @description The "ship in a fresh-context subagent" instruction, shared by
 *   `prompt.ship.detect` (which emits it instead of the plain
 *   Skill('devops:do-ship') mandate) and its test.
 *
 *   Why: a /do-ship runs ~25 API calls, each re-reading the WHOLE context, and
 *   it runs at the end of a session when that context is largest. Measured
 *   over 10 sessions (2026-09-21): Ø 434 k tokens per ship call, ~24 % of
 *   the session's tokens for a step that produces ~10 k output tokens.
 *   No hook or skill can compact the context, so the old answer (v0.4 of the
 *   former lib/ship-compact.js) stopped the ship and made the user type
 *   `/compact` plus a new ship prompt. The pipeline does not need the
 *   conversation, only a brief of it: the main session writes that brief
 *   once and a general-purpose subagent runs do-ship on a fresh context
 *   (`--delegated`, skills/do-ship/modes/delegated.md). The user types
 *   nothing extra; the main session shows the card the subagent rendered.
 *
 *   Measured on the first 7 delegated ships (2026-09-27/28): the subagent
 *   starts at 72–75 k, grows to 150–195 k and makes 20–39 calls (Ø ~27).
 *   Cost-weighted (cache read 0.1, 1 h cache write 2.0, output 5) the ships
 *   took 8.3 M against ≈ 13.1 M inline: −45 to −55 % at ≥ 400 k, only −13 %
 *   at ~225 k, and +28 % at 115 k. Break-even sits near 170 k.
 *
 *   - Threshold `DOTCLAUDE_SHIP_DELEGATE_THRESHOLD` (tokens; `0` disables;
 *     the old `DOTCLAUDE_SHIP_COMPACT_THRESHOLD` is still read as a
 *     fallback), default 250 k: a clear margin above break-even, so a
 *     delegated ship never costs more than the inline one would have.
 *   - `--inline` (or the old `--no-compact`) keeps one ship in the main
 *     context.
 *   - Never for a promotion-only run (`promotionOnly`): ~4 calls, not ~25.
 *   - Two entry points share this decision: `prompt.ship.detect` for a ship
 *     prompt, `pre.ship.delegate` for a do-ship the model starts through the
 *     Skill tool (concept finalize, `/do-run backlog`, an autonomous ship) —
 *     before that guard, half of the large-context ships ran inline that way.
 *   - `--card-data` (#712): a ship inside an /auto-concept finalize. The
 *     subagent hands back the card DATA instead of a rendered card, and the
 *     caller renders it after its own close-out (Step 6a: bridge, pulser and
 *     waker stopped), so the last card shows the closed concept, never a
 *     frozen "concept open" widget with a dead localhost link.
 */

const { formatTokens } = require('./context-size');

const DEFAULT_THRESHOLD = 250_000;

/** What a fresh subagent carries on its first ship call: system prompt,
 *  tool schemas, the skill and the brief (measured 72–75 k). */
const SUBAGENT_FLOOR = 75_000;

/** API calls of one ship (measured 20–39, Ø ~27). */
const SHIP_CALLS = 25;

/** A 1 h cache write costs as much as ~20 cache reads (2.0 vs 0.1). */
const CACHE_WRITE_READS = 20;

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
 * What delegating saves on one ship, in cache-read tokens: inline re-reads
 * the main context on every call; delegated, the subagent re-reads its own
 * floor instead, writes that floor to the cache once (≈ 20 reads' worth),
 * and the main session still reads its context twice to show the card.
 * @param {number} tokens
 * @returns {string} "≈ 5.3 M"
 */
function shipSavingEstimate(tokens) {
  const saved = (SHIP_CALLS - 2) * tokens - SHIP_CALLS * SUBAGENT_FLOOR - CACHE_WRITE_READS * SUBAGENT_FLOOR;
  const m = Math.max(0, saved) / 1_000_000;
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

/** `--card-data`: the delegated ship returns card data, the caller renders. */
const CARD_DATA = /(^|\s)--card-data\b/i;

/**
 * Whether the delegated ship hands back card data instead of a rendered card
 * (#712). Only the explicit `--card-data` the /auto-concept finalize passes
 * counts: a state file alone also exists for a paused, stale or
 * close-out-only concept (#693), whose ship must not trigger a close-out.
 * @param {{ args?: string }} o
 * @returns {boolean}
 */
function wantsCardData({ args = '' } = {}) {
  return CARD_DATA.test(String(args || ''));
}

/** `--delegated` (the subagent itself) and `--resume` (Pre-Step R, which
 *  ss.ship.resume also reloads mid-turn after a compaction) are never
 *  redirected by the Skill-call guard. */
const OWN_RUN = /(^|\s)--(delegated|resume)\b/i;

/**
 * What a do-ship Skill call's args say about promotion: `promote`, `beta`
 * or `stable` as a leading word, plus a named version. A named version is
 * promotion-only by definition; a channel alone is promotion-only only when
 * nothing is unshipped (the caller checks git).
 * @param {string} args
 * @returns {{ promote: boolean, version: string|null }}
 */
function promotionOfArgs(args) {
  const s = String(args || '');
  const promote = /^\s*(promote|beta|stable)\b/i.test(s);
  const v = promote ? s.match(/\b\d+\.\d+\.\d+\b/) : null;
  return { promote, version: v ? v[0] : null };
}

/**
 * Whether a do-ship the model starts through the Skill tool in the MAIN
 * session has to go to a subagent instead (pre.ship.delegate).
 * @param {{ skill: string, args?: string, tokens: number|null, promotionOnly?: boolean, env?: NodeJS.ProcessEnv }} o
 * @returns {boolean}
 */
function shouldDelegateSkillCall({ skill, args = '', tokens, promotionOnly = false, env = process.env }) {
  if (!/(^|:)do-ship$/.test(String(skill || ''))) return false;
  if (OWN_RUN.test(args)) return false;
  return shouldDelegate({ tokens, prompt: args, promotionOnly, env });
}

/**
 * Whether an Agent spawn that starts a delegated ship would cost more than
 * the inline ship: the main context is known and below the threshold. A
 * resume and an unknown size (right after a compaction) always pass.
 * @param {{ prompt: string, tokens: number|null, env?: NodeJS.ProcessEnv }} o
 * @returns {boolean}
 */
function delegatedSpawnTooSmall({ prompt, tokens, env = process.env }) {
  const p = String(prompt || '');
  if (!/devops:do-ship/.test(p) || !/--delegated\b/.test(p) || /--resume\b/.test(p)) return false;
  const limit = threshold(env);
  return Boolean(limit) && tokens != null && tokens < limit;
}

/**
 * The instruction block that replaces the inline ship mandate.
 * @param {{ tokens: number, skillArgs?: string, pluginRoot: string, env?: NodeJS.ProcessEnv }} o
 *   skillArgs — the do-ship argument the inline mandate would have passed
 *   ("stable", "promote 0.193.0", …); `--delegated` is prepended.
 * @returns {string}
 */
function shipDelegateInstruction({ tokens, skillArgs = '', pluginRoot, sessionId = '', cardData = false, env = process.env }) {
  const rest = cardData && !CARD_DATA.test(skillArgs) ? ['--card-data', skillArgs] : [skillArgs];
  const args = ['--delegated', ...rest].filter(Boolean).join(' ');
  const mode = `${String(pluginRoot).replace(/\\/g, '/')}/skills/do-ship/modes/delegated.md`;
  return [
    `[ship-delegate] Context is ${formatTokens(tokens)} tokens (threshold ${formatTokens(threshold(env))}). The ship runs in a`,
    `fresh-context subagent instead of here: it saves ${shipSavingEstimate(tokens)} cache-read tokens (its own cache write counted) and the user types nothing extra.`,
    'Do NOT run the pipeline in this context: no ship_* call, no git push/merge — even if the do-ship skill is already loaded.',
    '',
    '1. If this session still has its OWN background agents or commands running, ask the user first (wait / ship anyway / cancel).',
    '2. Write the brief from this conversation — the subagent sees nothing else:',
    '   intent (the user\'s key prompts, verbatim) · what changed, as ≤ 3 functional changes (area → description) ·',
    '   findings and decisions with their why (root causes, rejected alternatives — they feed PR body and CHANGELOG) ·',
    '   tests that ran + results · validation (requirement → how met → how confirmed) · open points · issue refs ·',
    '   anything the ship must know (bump hint, risks, files not to commit). The subagent reads the diff itself —',
    '   the brief carries what the diff cannot: the why.',
    ...spawnAndDeliver({ args, sessionId, description: 'Ship im Subagenten', brief: true, cardData }),
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
 *
 * `cardData` (#712, an /auto-concept finalize): the subagent stops before
 * the render and hands back the card input; the caller finishes its
 * close-out first, then renders, then runs the post-render extension steps
 * the subagent deferred (`afterRender`, e.g. the plugin self-sync).
 * @param {{ args: string, sessionId: string, description: string, brief: boolean, cardData?: boolean }} o
 * @returns {string[]}
 */
function spawnAndDeliver({ args, sessionId, description, brief, cardData = false }) {
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
    ...(cardData ? [
      '   { "status": "done", "cardData", "afterRender", "exitWorktree" } (--card-data, the concept finalize ship) → NOT rendered yet.',
      '     cardData.variant ship-successful (or another shipped variant): first finish the /auto-concept close-out',
      '     (part D and Step 6a: bridge, pulser and waker stopped, state file gone). ship-blocked: NO part D, the concept',
      '     stays open. Then call render_completion_card with cardData verbatim (before ExitWorktree, its cwd must exist),',
      '     show it per the render result (title step included) as the LAST card, run the afterRender steps, and only',
      '     then, if exitWorktree is true, ExitWorktree({ action: "remove" }). A failed close-out still renders.',
      '     The subagent also stored this payload in .claude/.ship-carddata-<session_id>.json (a compaction cannot lose it;',
      '     the render consumes it). Lost the reply? Render from that file, never from memory.',
    ] : []),
    '   { "status": "done", "titlePrefix", "widgetFile" | "markdown", "widgetTitle", "exitWorktree" } → the card is already rendered.',
    '     exitWorktree true: ExitWorktree({ action: "remove" }) first. Set the session title to titlePrefix + the title',
    '     without its old devops prefix. Desktop: Read widgetFile and call show_widget ONCE with title = widgetTitle',
    '     verbatim ("completion_card_body", never a title of your own) and widget_code = the file content verbatim,',
    '     as the LAST action; terminal: output markdown verbatim. No text of your own, no second render_completion_card.',
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
    'The session title stays "⏳ 🚀 Shipping – " and the turn ends with the ship\'s own card (Released / Blocked).',
  ].filter(Boolean).join('\n');
}

module.exports = {
  DEFAULT_THRESHOLD, SUBAGENT_FLOOR, SHIP_CALLS, INLINE,
  threshold, shipSavingEstimate, shouldDelegate, shipDelegateInstruction, shipResumeInstruction,
  promotionOfArgs, shouldDelegateSkillCall, delegatedSpawnTooSmall, wantsCardData, CARD_DATA,
};
