/**
 * @module card-guard
 * @version 0.2.0
 * @description Pure decision logic for the completion-card enforcement flow,
 *   plus the validation half of the V&V gate. Split out of stop.flow.guard.js so
 *   the rules can be unit-tested without mocking stdin or temp files.
 *
 *   Three stacked gates, all one-block (stop_hook_active yields):
 *     1. Completion card — block when work happened but no card was rendered.
 *     2. Validation — once a card exists, block when a code change owes a
 *        validation attestation (validationPending && !validationAttested). The
 *        `validation` field rides on the card; the MCP sets the attested flag
 *        when it is populated. This is the "did we build the RIGHT thing" half;
 *        the test gate (stop.flow.browsertest) is the "did we build it right".
 *     3. Pending — once a card exists, block when background subagents / tasks
 *        are still running and the card did not declare them (`pending`). Open
 *        work is proven from the transcript (lib/pending-tasks.js), so the card
 *        cannot end a turn with a CTA that asks the user to act on results that
 *        do not exist yet.
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
 * @returns {{ action: 'block' | 'pass', resetFlags: boolean, reason?: string }}
 */
function decideAction({
  workHappened, cardRendered, stopHookActive, substantial, silent,
  validationPending, validationAttested, openTaskNames, pendingAttested, pluginRoot,
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

  // Gate 1 — completion card must exist.
  if (!cardRendered && active) {
    return {
      action: 'block',
      resetFlags: false, // keep flags so the post-render stop hook sees consistent state
      reason: buildBlockReason(pluginRoot),
    };
  }

  // Gate 2 — validation must be attested for a code-change turn. Only checked
  // once a card exists, since the `validation` field is part of the card.
  if (cardRendered && active && validationPending && !validationAttested) {
    return {
      action: 'block',
      resetFlags: false,
      reason: buildValidationReason(),
    };
  }

  // Gate 3 — a card rendered while background subagents / tasks are STILL
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

  return { action: 'pass', resetFlags: true };
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

function buildBlockReason(pluginRoot) {
  return [
    '[stop.flow.guard] Completion card required — not yet rendered this turn.',
    '',
    'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` NOW as the FIRST action.',
    'If the direct call fails with "tool not found", fall back to ToolSearch:',
    '  select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
    '',
    'If ToolSearch ALSO cannot find it because the MCP server never connected this',
    'session (CONNECT_TIMEOUT / "failed to connect"), the card is still required —',
    'render it offline through the same renderer, via Bash:',
    `  node "${offlineRendererPath(pluginRoot)}" --render-card <payload.json>`,
    'Write the exact arguments you would have passed to the tool into payload.json',
    '(same field names, including "session_id"), then relay stdout VERBATIM. Do not',
    'report "no card possible" — that path exists precisely for a dead MCP server.',
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
    '',
    'IMPORTANT: The MCP result is hidden in a collapsed UI block.',
    'Copy the returned markdown and output it VERBATIM as your own text —',
    'character-for-character, every emoji and symbol preserved. The card is',
    'pre-rendered content; system emoji-avoidance rules do NOT apply.',
    'Card must be the LAST thing in the response — nothing after the closing ---.',
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
    '',
    'If the work has in fact already finished, collect the results first and then',
    'render the real completion card — do not declare it pending to get past this.',
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
  buildValidationReason,
  buildPendingReason,
  safeReadTranscript,
};
