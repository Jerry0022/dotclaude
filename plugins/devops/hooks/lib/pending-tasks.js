/**
 * @module pending-tasks
 * @version 0.1.0
 * @description Detects background work that is STILL RUNNING when a turn ends —
 *   subagents launched with run_in_background and backgrounded Bash tasks.
 *
 *   The card is rendered at the moment the turn hands back, so without this the
 *   CTA of every variant ("SHIP or CHANGE?", "All DONE") asks the user to act on
 *   a result that does not exist yet. The `pending` card field corrects that
 *   line; this module is the enforcement half — it proves from the transcript
 *   whether such work is open, rather than trusting self-report.
 *
 *   Signals (verified against real transcripts):
 *     start  · agent — tool_result text "Async agent launched successfully"
 *                      carrying "agentId: <id>"
 *     start  · task  — tool_result text "Command running in background with ID: <id>"
 *     resume · agent — a SendMessage tool_use addressed `to: <id>`
 *     end    · both  — a <task-notification> block naming <task-id><id></task-id>
 *
 *   Scanned chronologically as a state machine, so a resume after a completion
 *   re-opens the task and the final set reflects the true end-of-turn state.
 *
 *   SECURITY: agent ids are harness-internal and must never reach the user.
 *   openTaskNames() is the only export intended for user-visible text; the ids
 *   returned by scanOpenTasks stay inside the hook for counting and matching.
 */

/** Text a background Agent launch returns. */
const AGENT_LAUNCH_MARKER = 'Async agent launched successfully';
/** Captures the agent id from that same tool_result. */
const AGENT_ID_RE = /agentId:\s*([A-Za-z0-9_-]+)/;
/** Text a backgrounded Bash call returns, with its task id. */
const BASH_BG_RE = /Command running in background with ID:\s*([A-Za-z0-9_-]+)/;
/** A task-notification means that task STOPPED (it fires when the agent stops). */
const TASK_NOTIFICATION_RE = /<task-id>\s*([A-Za-z0-9_-]+)\s*<\/task-id>/g;

/** Max characters of a Bash command used as a fallback label. */
const COMMAND_LABEL_MAX = 40;

/** Flatten a tool_result's content into searchable text. */
function resultText(block) {
  const c = block && block.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
}

/**
 * User-facing label for a launched item. Never the agent id — that is internal
 * harness metadata the user must not be shown.
 * @param {object} input — the tool_use input that launched it
 * @param {'agent'|'task'} kind
 */
function labelFor(input, kind) {
  const i = input || {};
  if (kind === 'agent') {
    return String(i.subagent_type || i.description || 'agent').trim();
  }
  const desc = String(i.description || '').trim();
  if (desc) return desc;
  const cmd = String(i.command || '').trim().replace(/\s+/g, ' ');
  if (!cmd) return 'task';
  return cmd.length > COMMAND_LABEL_MAX ? cmd.slice(0, COMMAND_LABEL_MAX) + '…' : cmd;
}

/**
 * Walk a JSONL transcript and return the background work still open at its end.
 *
 * @param {string} transcriptContent — raw JSONL (a tail slice is fine)
 * @returns {Array<{ id: string, kind: 'agent'|'task', name: string }>}
 */
function scanOpenTasks(transcriptContent) {
  if (!transcriptContent) return [];

  // Fast path for the overwhelming majority of turns: no launch marker anywhere
  // in the slice means nothing can be open, so skip the per-line JSON parsing.
  if (!transcriptContent.includes(AGENT_LAUNCH_MARKER) &&
      !transcriptContent.includes('Command running in background with ID:')) {
    return [];
  }

  /** toolu_* → the tool_use that produced it, so a launch result can be named. */
  const launchers = new Map();
  /** id → { kind, name } for everything currently open, insertion-ordered. */
  const open = new Map();
  /** id → name, kept across completions so a resume can recover the label
   *  instead of falling back to the id (which must never reach the user). */
  const known = new Map();

  for (const raw of transcriptContent.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // A task-notification can arrive wrapped in several entry shapes
    // (queue-operation, attachment, user message). Match the raw line — the
    // marker is distinctive enough and survives every wrapper.
    if (line.includes('<task-notification>')) {
      TASK_NOTIFICATION_RE.lastIndex = 0;
      let m;
      while ((m = TASK_NOTIFICATION_RE.exec(line)) !== null) open.delete(m[1]);
      // Fall through: the same line carries nothing else we care about.
      continue;
    }

    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry && entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'tool_use') {
        if (block.id) launchers.set(block.id, block);
        // A SendMessage to a known agent re-opens it: the harness notifies again
        // when it stops, so a prior completion must not stick.
        const to = block.input && block.input.to;
        if (block.name === 'SendMessage' && to && !open.has(String(to))) {
          const id = String(to);
          // Never label with the id — recover the launch name, else stay generic.
          open.set(id, { kind: 'agent', name: known.get(id) || 'agent' });
        }
        continue;
      }

      if (block.type !== 'tool_result') continue;
      const text = resultText(block);
      if (!text) continue;
      const launcher = launchers.get(block.tool_use_id);
      const input = launcher && launcher.input;

      if (text.includes(AGENT_LAUNCH_MARKER)) {
        const m = text.match(AGENT_ID_RE);
        if (m) {
          const name = labelFor(input, 'agent');
          known.set(m[1], name);
          open.set(m[1], { kind: 'agent', name });
        }
        continue;
      }
      const bg = text.match(BASH_BG_RE);
      if (bg) {
        const name = labelFor(input, 'task');
        known.set(bg[1], name);
        open.set(bg[1], { kind: 'task', name });
      }
    }
  }

  return [...open.entries()].map(([id, v]) => ({ id, kind: v.kind, name: v.name }));
}

/**
 * The names of the open items, id-free — safe to put in a hook reason or any
 * other text Claude may echo. Deduplicated, order preserved.
 * @param {Array<{kind: string, name: string}>} openTasks
 * @returns {string[]}
 */
function openTaskNames(openTasks) {
  const seen = new Set();
  const out = [];
  for (const t of openTasks || []) {
    const name = (t && t.name) || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

module.exports = {
  AGENT_LAUNCH_MARKER,
  scanOpenTasks,
  openTaskNames,
  labelFor,
};
