/**
 * @module card-guard
 * @version 0.5.1
 * @description Pure decision logic for the completion-card enforcement flow,
 *   plus the validation half of the V&V gate. Split out of stop.flow.guard.js so
 *   the rules can be unit-tested without mocking stdin or temp files.
 *
 *   Stacked gates, all one-block (stop_hook_active yields):
 *     1. Completion card — block when work happened but no card was rendered.
 *     2. Notification-turn duplicate (design § 5.5) — once a card exists on a
 *        notification turn (background-task notification / wake-up / cron
 *        tick, no user prompt), block a second card identical to the last one
 *        (same variant + build-id + evidence row) — reported once.
 *     3. Card content (design § 5.1-5.3) — once a card exists: the title may
 *        not carry a status word, the `›` result lines are capped at three and
 *        may not name a file/hook as their subject, and the numbered points
 *        are capped at three unless the heading carries `+N weitere`.
 *     4. Validation — once a card exists, block when a code change owes a
 *        validation attestation (validationPending && !validationAttested). The
 *        `validation` field rides on the card; the MCP sets the attested flag
 *        when it is populated. This is the "did we build the RIGHT thing" half;
 *        the test gate (stop.flow.browsertest) is the "did we build it right".
 *     5. Pending — once a card exists, block when background subagents / tasks
 *        are still running and the card did not declare them (`pending`). Open
 *        work is proven from the transcript (lib/pending-tasks.js), so the card
 *        cannot end a turn with a CTA that asks the user to act on results that
 *        do not exist yet. The concept bridge's own tasks (server, keepalive
 *        pulser, pickup waker) are infrastructure and never count — a concept
 *        that is merely open renders `concept: { phase }`, not `pending`.
 *
 *   Two narrow exemptions sit in front of Gate 1:
 *     - (#371) a scheduled-task session (prompt wrapped in `<scheduled-task …>`)
 *       whose turn changed no file and shipped nothing passes with its one-line
 *       status — the idle tick of a gated cron routine is ~10 s of work and
 *       used to pay 4-5 turns for a card whose only content was "nothing
 *       happened". ALL THREE conditions are required; a scheduled task that
 *       edits or ships owes the card like any turn.
 *     - (design § 5.5) a notification turn (background-task notification,
 *       wake-up or cron tick, no user prompt) carries no card obligation at
 *       all when nothing changed (tree clean, nothing shipped).
 *
 *   Line budget (design § 2.4 / § 5.4) is reported, never enforced by cutting —
 *   the renderer is the one that trims. `lineBudgetReport` returns a `warning`
 *   surfaced on an otherwise passing decision.
 *
 *   Inputs: flag state (work/card/validation/pending) + transcript + stop_hook_active.
 *   Output: { action: 'block' | 'pass', reason?, resetFlags }.
 */

const fs = require('fs');

/** Minimum assistant-text chars to count a chat-only turn as "substantial". */
const SUBSTANTIAL_CHARS = 400;

/** Distinctive marker the completion-card template prints around the title. */
const CARD_MARKER = '\u2728\u2728\u2728';

/**
 * Extract concatenated text from the last assistant message in a JSONL
 * transcript. Non-text blocks and malformed lines are skipped silently.
 * Returns '' if no assistant message found.
 */
function lastAssistantText(transcriptContent) {
  if (!transcriptContent) return '';
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const chunks = [];
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        chunks.push(block.text);
      }
    }
    return chunks.join('');
  }
  return '';
}

function lastAssistantTextLength(transcriptContent) {
  return lastAssistantText(transcriptContent).length;
}

function isSubstantialAnswer(transcriptContent, threshold = SUBSTANTIAL_CHARS) {
  return lastAssistantTextLength(transcriptContent) >= threshold;
}

/**
 * Backup detection: did the last assistant message already contain a
 * completion card? Triggered when the card-rendered flag write fails
 * (e.g. tmp-file I/O error) but Claude did output the card text.
 * Matches the distinctive ✨✨✨ title marker — unlikely to collide with
 * regular prose.
 */
function lastAssistantContainsCard(transcriptContent) {
  return lastAssistantText(transcriptContent).includes(CARD_MARKER);
}

// ---------------------------------------------------------------------------
// Card content gates (design § 5.1 - § 5.4)
// ---------------------------------------------------------------------------

/** Title status words the card-guard rejects (design § 5.1) — status belongs
 *  in the decision heading, never the title. Matches whole words/phrases and
 *  a bare agent count ("3 Agenten" / "3 agents"). */
const TITLE_STATUS_WORD_RE =
  /\b(läuft|laufen|wartet|pending|noch nicht|running|waiting|\d+\s*Agenten?|\d+\s*agents?)\b/i;

/** Extract the title text between the two ✨✨✨ markers, or null if absent. */
function extractCardTitle(cardText) {
  if (!cardText) return null;
  const re = new RegExp(`${CARD_MARKER}\\s*(.*?)\\s*${CARD_MARKER}`);
  const m = cardText.match(re);
  return m ? m[1].trim() : null;
}

/** The matched status word/phrase if the title carries one, else null. */
function titleStatusWordViolation(title) {
  if (!title) return null;
  const m = title.match(TITLE_STATUS_WORD_RE);
  return m ? m[0] : null;
}

/** Every `› ` result line, text only (marker stripped, trimmed). */
function extractResultLines(cardText) {
  if (!cardText) return [];
  return cardText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('› '))
    .map(l => l.slice(2).trim());
}

/** First token looks like a path (`foo.js`) or a hook name (`ss.`, `post.`,
 *  `prompt.`, `stop.` prefix) — design § 5.2 forbids naming these as the
 *  subject of a result line. */
const RESULT_LINE_SUBJECT_RE = /^(?:\S*\.(?:js|md|ts|json)\b|(?:ss|post|prompt|stop)\.\S+)/;

/** Reason string if the result lines violate § 5.2, else null. */
function resultLinesViolation(lines) {
  if (!Array.isArray(lines)) return null;
  if (lines.length > 3) {
    return `${lines.length} result lines — max 3 (design § 5.2); a 4th becomes "+1 weitere" on the last line, never dropped silently.`;
  }
  for (const line of lines) {
    const firstToken = line.split(/\s+/)[0] || '';
    if (RESULT_LINE_SUBJECT_RE.test(firstToken)) {
      return `result line names a file/hook as its subject: "${firstToken}" — name the effect for the user instead (design § 5.2).`;
    }
  }
  return null;
}

/** Numbered points (`1. …`) anywhere in the decision block (after the last
 *  `## ` heading, or the whole card when no heading is present). */
function extractPoints(cardText) {
  if (!cardText) return [];
  const headingMatch = cardText.match(/^##\s+.*$/m);
  const body = headingMatch ? cardText.slice(cardText.indexOf(headingMatch[0])) : cardText;
  return body
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^\d+\.\s/.test(l));
}

/** Reason string if the points violate § 5.3 (more than 3 without the
 *  heading carrying "+N weitere"), else null. */
function pointsViolation(points, heading) {
  if (!Array.isArray(points) || points.length <= 3) return null;
  if (/\+\d+\s+weitere/.test(heading || '')) return null;
  return `${points.length} points — max 3 on the card (design § 5.3); more only as "+N weitere" in the heading.`;
}

/** Rendered-line budget: 14 rows on Desktop, 24 in the terminal (design
 *  § 2.4 / § 5.4). Counts non-blank lines of the card text — the guard only
 *  REPORTS overflow, it never cuts; the renderer decides what to trim
 *  (evidence details → context line → pipeline names, never result lines,
 *  points or the heading). */
const LINE_BUDGET = Object.freeze({ desktop: 14, terminal: 24 });

function cardLineCount(cardText) {
  if (!cardText) return 0;
  return cardText.split('\n').filter(l => l.trim().length > 0).length;
}

function lineBudgetReport(cardText, { desktop = false } = {}) {
  const limit = desktop ? LINE_BUDGET.desktop : LINE_BUDGET.terminal;
  const count = cardLineCount(cardText);
  return { limit, count, overflow: count > limit };
}

/**
 * Signature used to detect a duplicate card on a notification turn (design
 * § 5.5): same decision heading, same build-id, same evidence row. Returns
 * null when the card text carries none of these (nothing to compare).
 */
function cardSignature(cardText) {
  if (!cardText) return null;
  const heading = (cardText.match(/^##\s+.*$/m) || [])[0] || '';
  const build = (cardText.match(/Build\s+(\S+)/) || [])[1] || '';
  const evidence = (cardText.match(/^[✓✗◐].*$/m) || [])[0] || '';
  if (heading || build || evidence) {
    return JSON.stringify({ heading: heading.trim(), build, evidence: evidence.trim() });
  }
  // Desktop (design § 4): the body lives in the widget, the markdown is the
  // ✨ title line alone — the title is then the only field to compare on.
  const title = extractCardTitle(cardText);
  return title ? JSON.stringify({ title }) : null;
}

/** True when a notification turn's new card is identical (by signature) to
 *  the previous one — design § 5.5 blocks the second one. */
function isDuplicateNotificationCard(prevSignature, currSignature) {
  return Boolean(prevSignature) && Boolean(currSignature) && prevSignature === currSignature;
}

/**
 * True when the turn's last USER-role transcript entry is a background-task
 * completion notification (`<task-notification>`, the same marker
 * lib/pending-tasks.js scans for) rather than something the user typed —
 * design § 5.5's "background-task notification" case. Scans backward so a
 * notification followed later by the user's own message is not mistaken for
 * the trigger of THIS turn.
 */
function lastUserEntryIsNotification(transcriptContent) {
  if (!transcriptContent) return false;
  const lines = transcriptContent.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (entry.type !== 'user') continue;
    const content = entry.message && entry.message.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('');
    }
    return text.includes('<task-notification>');
  }
  return false;
}

/**
 * Decide whether the Stop hook should block the turn to force a completion card.
 *
 * @param {object} s
 * @param {boolean} s.workHappened   — tool call(s) ran this turn
 * @param {boolean} s.cardRendered   — render_completion_card was invoked
 * @param {boolean} s.stopHookActive — prior Stop hook already blocked this cycle
 * @param {boolean} s.substantial    — last assistant turn had substantial prose
 * @param {boolean} [s.silent]       — turn was triggered by cron/autonomous loop,
 *                                     not the user. Never enforce the card.
 * @param {boolean} [s.validationPending]  — a code change owes a validation attestation
 * @param {boolean} [s.validationAttested] — the card was rendered with a `validation` field
 * @param {string[]} [s.openTaskNames] — background subagents / tasks still running at
 *                                     turn end (names only — ids stay internal)
 * @param {boolean} [s.pendingAttested] — the card was rendered with a `pending` field
 * @param {string}  [s.pluginRoot]   — active install root, so the block reason can name
 *                                     the offline renderer path for this install
 * @param {boolean} [s.scheduledTask] — the turn's prompt was a `<scheduled-task …>` wrapper
 * @param {boolean} [s.treeClean]     — no file changed this turn (git status empty / zero edits)
 * @param {boolean} [s.shipped]       — ship_release merged something this turn
 * @param {boolean} [s.completionMcpDown] — the completion MCP heartbeat is dead, so the
 *                                     offline renderer is the FIRST instruction, not the third
 * @param {boolean} [s.notificationTurn] — this turn started from a background-task
 *                                     notification, a wake-up or a cron tick, with no
 *                                     user prompt (design § 5.5)
 * @param {string}  [s.cardText]      — the rendered card's markdown (last assistant text),
 *                                     used for the content gates (title / result lines /
 *                                     points) and the notification-turn duplicate check
 * @param {string}  [s.prevCardSignature] — signature of the previous notification-turn card
 *                                     (see `cardSignature`), stored by the caller
 * @param {boolean} [s.desktopClient]  — render target for the line-budget report (14 rows
 *                                     Desktop / 24 terminal); defaults to terminal
 * @returns {{ action: 'block' | 'pass', resetFlags: boolean, reason?: string, exempt?: string,
 *             warning?: string, newCardSignature?: string|null }}
 */
function decideAction({
  workHappened, cardRendered, stopHookActive, substantial, silent,
  validationPending, validationAttested, openTaskNames, pendingAttested, pluginRoot,
  scheduledTask, treeClean, shipped, completionMcpDown,
  notificationTurn, cardText, prevCardSignature, desktopClient,
}) {
  if (silent) {
    // Background tick (cron git-sync, concept bridge poll, autonomous loop).
    // The real user turn already rendered its card — forcing another here
    // produces duplicates. Reset all flags so the next real turn starts clean.
    return { action: 'pass', resetFlags: true };
  }

  if (stopHookActive) {
    // Never block twice in a row — prevents infinite loops even if a flag
    // write fails. Covers BOTH the card and validation gates: each enforces
    // once per turn. Flags are reset so the next turn starts clean.
    return { action: 'pass', resetFlags: true };
  }

  const active = workHappened || substantial;

  // Scheduled-task idle tick (#371): no file changed, nothing shipped, the
  // prompt was the scheduler's — the status line the routine printed IS the
  // report. Narrow on purpose: any edit or ship falls through to Gate 1.
  if (scheduledTask && !cardRendered && treeClean === true && !shipped) {
    return { action: 'pass', resetFlags: true, exempt: 'scheduled-task-idle' };
  }

  // Notification-turn exemption (design § 5.5): a turn started by a
  // background-task notification, wake-up or cron tick, with no user prompt,
  // carries no card obligation at all when nothing changed.
  if (notificationTurn && !cardRendered && treeClean === true && !shipped) {
    return { action: 'pass', resetFlags: true, exempt: 'notification-no-change' };
  }

  // Gate 1 — completion card must exist.
  if (!cardRendered && active) {
    return {
      action: 'block',
      resetFlags: false, // keep flags so the post-render stop hook sees consistent state
      reason: buildBlockReason(pluginRoot, { completionMcpDown }),
    };
  }

  // Gate 2 — notification-turn duplicate (design § 5.5): a second card
  // identical (heading + build-id + evidence row) to the last notification
  // card is blocked once.
  let newCardSignature;
  if (notificationTurn && cardRendered && cardText) {
    newCardSignature = cardSignature(cardText);
    if (isDuplicateNotificationCard(prevCardSignature, newCardSignature)) {
      return {
        action: 'block',
        resetFlags: false,
        reason: buildDuplicateCardReason(),
      };
    }
  }

  // Gate 3 — card content quality (design § 5.1 - § 5.3): title status
  // words, result-line count/subject, points count. Only checked once a card
  // exists and its text is available.
  if (cardRendered && cardText) {
    const title = extractCardTitle(cardText);
    const statusWord = titleStatusWordViolation(title);
    if (statusWord) {
      return { action: 'block', resetFlags: false, reason: buildTitleStatusWordReason(statusWord) };
    }

    const resultLines = extractResultLines(cardText);
    const resultViolation = resultLinesViolation(resultLines);
    if (resultViolation) {
      return { action: 'block', resetFlags: false, reason: buildResultLinesReason(resultViolation) };
    }

    const heading = (cardText.match(/^##\s+.*$/m) || [])[0] || '';
    const points = extractPoints(cardText);
    const pointViolation = pointsViolation(points, heading);
    if (pointViolation) {
      return { action: 'block', resetFlags: false, reason: buildPointsReason(pointViolation) };
    }
  }

  // Gate 4 — validation must be attested for a code-change turn. Only checked
  // once a card exists, since the `validation` field is part of the card.
  if (cardRendered && active && validationPending && !validationAttested) {
    return {
      action: 'block',
      resetFlags: false,
      reason: buildValidationReason(),
    };
  }

  // Gate 5 — a card rendered while background subagents / tasks are STILL
  // running must declare them. Without `pending`, the card's CTA asks the user
  // to act ("SHIP or CHANGE?", "All DONE") on results that do not exist yet.
  // Detected from the transcript, not self-reported, so the gate cannot be
  // talked out of. Independent of `active`: launching an agent is itself work.
  const open = openTaskNames || [];
  if (cardRendered && open.length > 0 && !pendingAttested) {
    return {
      action: 'block',
      resetFlags: false,
      reason: buildPendingReason(open),
    };
  }

  // Line budget (design § 2.4 / § 5.4) — reported, never enforced here.
  let warning;
  if (cardRendered && cardText) {
    const budget = lineBudgetReport(cardText, { desktop: Boolean(desktopClient) });
    if (budget.overflow) {
      warning = `[card-guard] Card is ${budget.count} lines, budget is ${budget.limit} — trim evidence details → context line → pipeline names first; never result lines, points or the heading.`;
    }
  }

  return { action: 'pass', resetFlags: true, ...(warning ? { warning } : {}), ...(newCardSignature !== undefined ? { newCardSignature } : {}) };
}

/**
 * Path of the offline card renderer for this install, in a form Bash accepts on
 * Windows too (forward slashes). Falls back to the env placeholder when the
 * caller could not resolve a root — a named variable still beats no instruction.
 */
function offlineRendererPath(pluginRoot) {
  const root = pluginRoot ? String(pluginRoot).replace(/\\/g, '/') : '$CLAUDE_PLUGIN_ROOT';
  return `${root}/mcp-server/index.js`;
}

/**
 * The three ways to render the card, in the order the caller should try them.
 * Default: direct MCP call → ToolSearch → offline renderer. When the completion
 * MCP's heartbeat is dead (`completionMcpDown`), the offline renderer comes
 * FIRST — each failed rung costs a whole turn, and a session whose server never
 * connected used to burn two of them before reaching the one that works (#371).
 */
/**
 * Field shapes for the offline path (#396). The agent reaches the CLI exactly
 * when the tool schema is NOT in context, so "same field names" alone left
 * the shapes to a guess — and the obvious guess for `changes` (a string per
 * line) rendered an empty Changes block. Mirrors CARD_FIELD_REFERENCE in
 * mcp-server/lib/card-input.js; card-input.test.js pins the two equal.
 */
const CARD_FIELD_REFERENCE =
  'Shapes: changes: [{ area, description }] · tests: [{ method, result }] · ' +
  'validation: [{ requirement, status: met|partial|unmet, evidence }] · ' +
  'userFinalTest: [string | { action, afterDeployment }] · open: [string] · ' +
  'pending: [{ name, kind: agent|task|workflow, doing }] · state / cta / delivery: objects.';

/**
 * The variant contract for the offline path (#406): the enum and what a
 * `ship-successful` payload must carry. A ship card rendered offline with
 * `variant: "ship"` produced a generic DONE card that the user had to question;
 * the CLI now exits 2 on it, and this line is what keeps the agent from
 * guessing in the first place. Mirrors CARD_VARIANT_REFERENCE in
 * mcp-server/lib/card-input.js; card-input.test.js pins the two equal.
 */
const CARD_VARIANT_REFERENCE =
  'Variants: ship-successful|ready|released|ship-blocked|test|test-minimal|analysis|aborted|fallback|ready-files · ' +
  'a shipped PR is "ship-successful" (never "ship") and requires ' +
  'state: { pushed: true, merged: "main", pr: { number, title }, commit }, cta: { vOld, vNew, bump }, ' +
  'delivery: { pr, ship: { version, base } }.';

function renderLadderLines(pluginRoot, { completionMcpDown } = {}) {
  const offline = [
    `  node "${offlineRendererPath(pluginRoot)}" --render-card <payload.json>`,
    'Write the exact arguments you would have passed to the tool into payload.json',
    '(same field names, including "session_id"), then relay stdout VERBATIM. Do not',
    'report "no card possible" — that path exists precisely for a dead MCP server.',
    'stderr carries the [SESSION TITLE] block: follow it (rename the session) before',
    'relaying the card, exactly as on the tool path — never relay it as output.',
    CARD_FIELD_REFERENCE,
    CARD_VARIANT_REFERENCE,
    'A payload off these shapes, an unknown variant, or a ship-successful without the',
    'merge proof exits 2 with the issues on stderr — fix the payload or fall back to',
    'the tool; never relay a card with an empty Changes block or a generic DONE card',
    'in place of the SHIPPED one.',
  ];
  if (completionMcpDown) {
    return [
      'The dotclaude-completion MCP server is NOT running (heartbeat dead) — do not',
      'try the tool first. Render the card offline through the same renderer, via',
      'Bash, as the FIRST action:',
      ...offline,
      '',
      'Only if that node call itself fails, try the tool',
      '`mcp__plugin_devops_dotclaude-completion__render_completion_card` directly,',
      'then ToolSearch (select:mcp__plugin_devops_dotclaude-completion__render_completion_card).',
    ];
  }
  return [
    'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW as the FIRST action.',
    'If the direct call fails with "tool not found", fall back to ToolSearch:',
    '  select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
    '',
    'If ToolSearch ALSO cannot find it because the MCP server never connected this',
    'session (CONNECT_TIMEOUT / "failed to connect"), the card is still required —',
    'render it offline through the same renderer, via Bash:',
    ...offline,
  ];
}

function buildBlockReason(pluginRoot, opts = {}) {
  return [
    '[stop.flow.guard] Completion card required — not yet rendered this turn.',
    '',
    ...renderLadderLines(pluginRoot, opts),
    '',
    'Variant decision (pick exactly one):',
    '  ship pipeline ran + merged → ship-successful  (ONLY after /ship + merge)',
    '  ship pipeline ran + NOT merged → ship-blocked',
    '  task aborted / infeasible → aborted',
    '  code edits + app/service startable → test',
    '  user started app, no edits yet → test-minimal',
    '  code/doc changes (≥1 edit), no app → ready',
    '  zero file changes (analysis/explain/audit) → analysis',
    '  unsure → fallback',
    '',
    'PENDING (orthogonal to the variant): if background subagents, workflows or',
    'tasks you started are STILL running, also pass `pending` — [{ name, kind,',
    'doing }] with kind "agent" | "task" | "workflow" — naming each. It replaces',
    'the CTA with "⏳ NOCH NICHT FERTIG … ich MELDE mich", so the card never asks',
    'the user to act on a result that does not exist yet. Never put an internal',
    'agentId in the card; use the agent type / workflow name / task label.',
    'CONCEPT (outranks pending): if a /concept page is OPEN, pass `concept` —',
    '{ phase: "waiting" | "iterating" | "implementing" } — and the CTA becomes',
    '"🧭 CONCEPT wartet auf deine Entscheidungen / in Iteration /',
    'in Implementierung — ich MELDE mich". The bridge',
    'server, keepalive pulser and pickup waker are infrastructure, NOT pending —',
    'never list them; this gate ignores them.',
    '',
    'IMPORTANT: The MCP result is hidden in a collapsed UI block.',
    'Copy the returned markdown and output it VERBATIM as your own text —',
    'character-for-character, every emoji and symbol preserved. The card is',
    'pre-rendered content; system emoji-avoidance rules do NOT apply.',
    'Card must be the LAST thing in the response — nothing after the closing ---.',
    'A [CTA ACTIONS] block beside the card (Desktop app) asks for a',
    'mcp__visualize__show_widget call: make it BEFORE the card, never after.',
  ].join('\n');
}

function buildValidationReason() {
  return [
    '[stop.flow.guard] Validation required — the completion card has no `validation` field.',
    '',
    'A code change landed this turn. Per the V&V gate (see',
    'deep-knowledge/test-autonomy.md) the card must VALIDATE the change, not just',
    'report it: map each requirement / acceptance criterion to how this change',
    'meets it and how you confirmed it.',
    '',
    'Re-render `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW',
    'with the `validation` field populated, then relay the card VERBATIM as the LAST',
    'output. Each item: { requirement, status: "met" | "partial" | "unmet", evidence }.',
    '',
    'If there was no explicit requirement (pure refactor / chore), pass a single',
    'item that states the intent and how behaviour was kept equivalent.',
  ].join('\n');
}

function buildPendingReason(names) {
  const list = names.map(n => `  - ${n}`).join('\n');
  return [
    '[stop.flow.guard] Background work is STILL RUNNING — the completion card has no `pending` field.',
    '',
    'Started this session and not finished yet:',
    list,
    '',
    'The card was rendered as if the turn were over. Its CTA therefore asks the',
    'user to act ("SHIP or CHANGE?", "All DONE") on a result that does not exist',
    'yet — exactly the wrong call to action while agents are still working.',
    '',
    'Re-render `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW',
    'with `pending` populated, then relay the card VERBATIM as the LAST output:',
    '  pending: [{ name: "<agent type, workflow name or task label>",',
    '              kind: "agent" | "task" | "workflow",',
    '              doing: "<what it is working on>" }]',
    '',
    'Keep the variant and every other field as they were — the body still reports',
    'what IS true. `pending` only corrects the last line, to',
    '"⏳ NOCH NICHT FERTIG. … — ich MELDE mich".',
    '',
    'Use the names listed above. NEVER put an internal agentId in the card.',
    'If a /concept page is open, ALSO pass `concept: { phase }` — the concept CTA',
    'then appends this work as its own sentence ("… in Implementierung. 2 Agenten arbeiten") instead of the',
    'generic "NOCH NICHT FERTIG".',
    '',
    'If the work has in fact already finished, collect the results first and then',
    'render the real completion card — do not declare it pending to get past this.',
  ].join('\n');
}

function buildTitleStatusWordReason(word) {
  return [
    '[stop.flow.guard] Title carries a status word — the completion card must be re-rendered.',
    '',
    `Found "${word}" in the title. Status ("läuft", "wartet", "pending", "noch nicht",`,
    'agent counts, …) belongs in the decision heading, never the title (design § 5.1 /',
    'completion-card-design.md § 2.1). The title is the outcome of the turn — when',
    'something was NOT achieved, say so in plain words ("… — Resume-Pfad noch offen"),',
    'never with a status word.',
    '',
    'Re-render `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW',
    'with a corrected title, then relay the card VERBATIM as the LAST output.',
  ].join('\n');
}

function buildResultLinesReason(detail) {
  return [
    '[stop.flow.guard] Result lines violate the card format — the completion card must be re-rendered.',
    '',
    detail,
    '',
    'Re-render `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW',
    'with the `›` result lines fixed, then relay the card VERBATIM as the LAST output.',
  ].join('\n');
}

function buildPointsReason(detail) {
  return [
    '[stop.flow.guard] Decision points violate the card format — the completion card must be re-rendered.',
    '',
    detail,
    '',
    'Re-render `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW',
    'with the points list fixed, then relay the card VERBATIM as the LAST output.',
  ].join('\n');
}

function buildDuplicateCardReason() {
  return [
    '[stop.flow.guard] Duplicate card on a notification turn — nothing changed since the last one.',
    '',
    'This turn started from a background-task notification, a wake-up or a cron tick',
    '(design § 5.5), and the card just rendered is identical (same heading, build-id',
    'and evidence row) to the previous one. A notification turn carries no card',
    'obligation when nothing changed — the output style for this turn is silence,',
    'not a repeated card.',
    '',
    'If something DID in fact change since the last card, re-render',
    '`mcp__plugin_devops_dotclaude-completion__render_completion_card` with the new',
    'state and relay it VERBATIM. Otherwise end the turn with no output.',
  ].join('\n');
}

/** Cap transcript bytes read into memory — we only need the last assistant message. */
const TRANSCRIPT_TAIL_BYTES = 200 * 1024; // 200 KB

/**
 * Wider slice used when the pending gate also has to scan the transcript. A
 * background agent can be launched many tool calls before the turn ends, so the
 * 200 KB tail that suffices for "last assistant message" can miss its launch
 * marker — and a missed launch is a false "all done", the exact bug the gate
 * exists to prevent. scanOpenTasks short-circuits when no marker is present, so
 * the wider read costs a file read and nothing else on ordinary turns.
 */
const PENDING_TAIL_BYTES = 1024 * 1024; // 1 MB

/**
 * Safely read a transcript file — returns '' on any error so decideAction
 * treats it as a non-substantial chat turn.
 *
 * Only reads the last TRANSCRIPT_TAIL_BYTES of the file. Since each JSONL
 * line is one message and we scan backwards for the LAST assistant entry,
 * a truncated first line at the buffer boundary is harmless — malformed
 * JSON lines are already skipped by lastAssistantText.
 */
function safeReadTranscript(transcriptPath, tailBytes = TRANSCRIPT_TAIL_BYTES) {
  if (!transcriptPath) return '';
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

module.exports = {
  CARD_FIELD_REFERENCE,
  CARD_VARIANT_REFERENCE,
  SUBSTANTIAL_CHARS,
  CARD_MARKER,
  TRANSCRIPT_TAIL_BYTES,
  PENDING_TAIL_BYTES,
  lastAssistantText,
  lastAssistantTextLength,
  isSubstantialAnswer,
  lastAssistantContainsCard,
  decideAction,
  buildBlockReason,
  renderLadderLines,
  offlineRendererPath,
  buildValidationReason,
  buildPendingReason,
  safeReadTranscript,
  TITLE_STATUS_WORD_RE,
  extractCardTitle,
  titleStatusWordViolation,
  extractResultLines,
  resultLinesViolation,
  extractPoints,
  pointsViolation,
  LINE_BUDGET,
  cardLineCount,
  lineBudgetReport,
  cardSignature,
  isDuplicateNotificationCard,
  lastUserEntryIsNotification,
  buildTitleStatusWordReason,
  buildResultLinesReason,
  buildPointsReason,
  buildDuplicateCardReason,
};
