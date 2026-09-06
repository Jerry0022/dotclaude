/**
 * @module pending-tasks
 * @version 0.3.0
 * @description Detects background work that is STILL RUNNING when a turn ends —
 *   subagents launched with run_in_background, backgrounded Bash tasks, and
 *   whole Workflow runs (which fan out to agents of their own).
 *
 *   INFRASTRUCTURE IS NOT WORK. The concept skill keeps three detached Bash
 *   tasks alive for as long as a concept page is open — the bridge server, the
 *   keepalive pulser and the pickup waker. They produce no result the user is
 *   waiting for; they ARE the waiting. Counting them turned every concept card
 *   into "3 Tasks laufen — ich MELDE mich", which names plumbing instead of the
 *   one true statement (waiting for decisions / working on the next iteration /
 *   implementing). isConceptInfra() recognizes them by the script they run or
 *   the role their description names, and scanOpenTasks never opens them.
 *
 *   The card is rendered at the moment the turn hands back, so without this the
 *   CTA of every variant ("SHIP or CHANGE?", "All DONE") asks the user to act on
 *   a result that does not exist yet. The `pending` card field corrects that
 *   line; this module is the enforcement half — it proves from the transcript
 *   whether such work is open, rather than trusting self-report.
 *
 *   Signals (verified against real transcripts):
 *     start  · agent    — tool_result text "Async agent launched successfully"
 *                         carrying "agentId: <id>"
 *     start  · task     — tool_result "Command running in background with ID: <id>"
 *     start  · workflow — tool_result "Workflow launched in background. Task ID: <id>"
 *     resume · agent    — a SendMessage tool_use addressed `to: <id>`
 *     end    · all      — a <task-notification> block naming <task-id><id></task-id>
 *
 *   Scanned chronologically as a state machine, so a resume after a completion
 *   re-opens the task and the final set reflects the true end-of-turn state.
 *
 *   QUOTED TEXT IS NOT AN EVENT. A Grep hit on this very file, a Read of a
 *   transcript, a script that prints a launch line — all put the marker shapes
 *   into the slice verbatim, and a phantom item nothing can ever close blocks
 *   every later card in the session. Three guards, verified against a real
 *   transcript that had produced two such phantoms:
 *     - a launch counts only from a tool that can announce THAT kind of launch
 *       (LAUNCH_TOOLS is bound per marker, not shared),
 *     - and only when the announcement IS the result rather than a line inside
 *       one (announces() — the discriminator Bash needs, since Bash may both
 *       announce its own task and print somebody else's),
 *     - a completion counts only when the notification is a real transcript
 *       entry rather than the payload of a tool_result (notificationText()).
 *
 *   SECURITY: agent ids are harness-internal and must never reach the user.
 *   openTaskNames() is the only export intended for user-visible text; the ids
 *   returned by scanOpenTasks stay inside the hook for counting and matching.
 *   Labels are sanitized at the single choke point (labelFor): they originate
 *   from model-authored text (a workflow's meta.name, an agent description) and
 *   are interpolated into a card line, into the Stop hook's `reason` — which
 *   Claude reads AS INSTRUCTIONS — and into a JSON example.
 */

/** Text a background Agent launch returns. */
const AGENT_LAUNCH_MARKER = 'Async agent launched successfully';
/** Captures the agent id from that same tool_result. */
const AGENT_ID_RE = /agentId:\s*([A-Za-z0-9_-]+)/;
/** Text a backgrounded Bash call returns, with its task id. */
const BASH_LAUNCH_MARKER = 'Command running in background with ID:';
const BASH_BG_RE = /Command running in background with ID:\s*([A-Za-z0-9_-]+)/;
/** Text a Workflow launch returns — workflows are always backgrounded. */
const WORKFLOW_LAUNCH_MARKER = 'Workflow launched in background.';
const WORKFLOW_BG_RE = /Workflow launched in background\. Task ID:\s*([A-Za-z0-9_-]+)/;
/** The one-line description the workflow launch echoes back. */
const WORKFLOW_SUMMARY_RE = /^Summary:\s*(.+)$/m;
/** A task-notification means that task STOPPED (it fires when the agent stops). */
const TASK_NOTIFICATION_RE = /<task-id>\s*([A-Za-z0-9_-]+)\s*<\/task-id>/g;

/**
 * Which tool can announce which kind of launch. Bound PER MARKER, not as one
 * shared allow-list: Bash legitimately reports its own backgrounded task, but a
 * Bash command that prints a transcript, a test fixture or this file's own
 * source also emits the agent and workflow markers verbatim — and that is
 * quoted text, not an event. Observed for real: one `sed` of the test fixture
 * opened a phantom agent that no notification could ever close, which blocks
 * every later card in the session.
 *
 * An unknown launcher (its tool_use sits before the tail slice) stays trusted:
 * missing a real launch is worse than the rare false positive that costs.
 */
const LAUNCH_TOOLS = {
  agent: new Set(['Agent', 'Task', 'Skill']),
  workflow: new Set(['Workflow']),
  task: new Set(['Bash', 'PowerShell']),
};

/** True when this launcher may announce a launch of that kind. */
function canLaunch(launcher, kind) {
  return !launcher || (LAUNCH_TOOLS[kind] || new Set()).has(launcher.name);
}

/**
 * The second half of "quoted text is not an event", and the only guard that
 * catches the case the launcher binding cannot: Bash may legitimately announce
 * its own backgrounded task, so a Bash command that PRINTS the very same
 * sentence — a `sed` of the test fixture below, a `cat` of a transcript —
 * passes the binding. The harness writes its announcement as the WHOLE result,
 * with the marker at position 0; a command's stdout carries it somewhere inside
 * a larger body. Verified against every launch shape in the local transcripts.
 */
function announces(text, marker) {
  return text.trimStart().startsWith(marker);
}

/**
 * The concept bridge's own background tasks — matched on the script the command
 * runs (the durable signal) or on the role the launch description names (the
 * shape the skill prescribes when the script path is resolved inside the
 * command through a shell variable and never appears literally).
 */
const CONCEPT_INFRA_RE =
  /concept-server\.py|concept-watch\.js|concept[- ]bridge|keepalive pulser|pickup waker|concept[- ]watch/i;

/**
 * True when a Bash launch is concept-bridge infrastructure rather than work.
 * @param {object} input — the Bash tool_use input ({ command, description })
 */
function isConceptInfra(input) {
  const i = input || {};
  return CONCEPT_INFRA_RE.test(String(i.command || ''))
    || CONCEPT_INFRA_RE.test(String(i.description || ''));
}

/** Max characters of a Bash command used as a fallback label. */
const COMMAND_LABEL_MAX = 40;
/** Max characters of any user-visible label. */
const LABEL_MAX = 48;

/**
 * `export const meta = { name: 'x' }` — a workflow script's own short name.
 * Anchored to the meta literal and window-bounded: a bare /name:/ would happily
 * match an agent label defined earlier in the same script.
 */
const META_NAME_RE = /export\s+const\s+meta\s*=\s*\{[\s\S]{0,400}?\bname\s*:\s*(['"`])([^'"`\n]{1,80})\1/;

/** Flatten a tool_result's content into searchable text. */
function resultText(block) {
  const c = block && block.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
}

/**
 * Make a label safe for every place it lands: an inline code span in the card,
 * the Stop hook `reason` Claude reads as instructions, and a double-quoted JSON
 * example. Structural characters are removed rather than escaped — a label is a
 * name, and no real agent type or workflow slug contains them.
 */
function sanitizeLabel(s) {
  return String(s == null ? '' : s)
    .split('')
    .map(ch => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? ' ' : ch))
    .join('')
    .replace(/[`|<>"\\]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, LABEL_MAX)
    .trim();
}

/**
 * A workflow's short name, in descending order of how well it identifies the
 * run to the user. Verified against real launches: the tool input carries
 * either an inline `script` (multi-KB source whose mandatory meta literal holds
 * the name) or a `scriptPath` of the shape `<name>-wf_<id>.js`; a saved
 * workflow is selected by `name`.
 *
 * @param {object} input — the Workflow tool_use input
 * @param {string} text — the launch tool_result, for the Summary fallback
 */
function workflowName(input, text) {
  const i = input || {};
  const saved = String(i.name || '').trim();
  if (saved) return saved;

  const m = String(i.script || '').match(META_NAME_RE);
  if (m) return m[2];

  const p = String(i.scriptPath || '').trim();
  if (p) {
    const base = p.split(/[\\/]/).pop()
      .replace(/\.[cm]?[jt]s$/, '')
      .replace(/-wf_[A-Za-z0-9_-]+$/, '');
    if (base) return base;
  }

  const s = String(text || '').match(WORKFLOW_SUMMARY_RE);
  return s ? s[1] : '';
}

/**
 * User-facing label for a launched item. Never the agent id — that is internal
 * harness metadata the user must not be shown.
 * @param {object} input — the tool_use input that launched it
 * @param {'agent'|'task'|'workflow'} kind
 * @param {string} [text] — the launch tool_result, used by the workflow fallback
 */
function labelFor(input, kind, text) {
  const i = input || {};
  if (kind === 'agent') {
    return sanitizeLabel(i.subagent_type || i.description || 'agent') || 'agent';
  }
  if (kind === 'workflow') {
    return sanitizeLabel(workflowName(i, text)) || 'workflow';
  }
  const desc = sanitizeLabel(i.description);
  if (desc) return desc;
  const cmd = sanitizeLabel(String(i.command || '').replace(/\s+/g, ' '));
  if (!cmd) return 'task';
  return cmd.length > COMMAND_LABEL_MAX ? cmd.slice(0, COMMAND_LABEL_MAX) + '…' : cmd;
}

/**
 * The text of a line that genuinely IS a task-notification, or '' when the line
 * merely quotes one.
 *
 * Real notifications arrive as queue-operation / attachment / system entries or
 * as a plain-string user message — never as the payload of a tool_result, and
 * never inside an assistant message. Measured over every local transcript: of
 * 5875 notification occurrences, the only ones inside tool_result or assistant
 * text were quotations (grep output, a model repeating one back).
 *
 * @param {string} line — one raw JSONL line known to contain the marker
 */
function notificationText(line) {
  let entry;
  // A truncated first line cannot be parsed — fall back to the raw text rather
  // than losing a real completion at the slice boundary.
  try { entry = JSON.parse(line); } catch { return line; }
  if (!entry || entry.type === 'assistant') return '';
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return line;
  const kept = content.filter(b => !(b && b.type === 'tool_result'));
  const text = JSON.stringify(kept);
  return text.includes('<task-notification>') ? text : '';
}

/**
 * Walk a JSONL transcript and return the background work still open at its end.
 *
 * @param {string} transcriptContent — raw JSONL (a tail slice is fine)
 * @returns {Array<{ id: string, kind: 'agent'|'task'|'workflow', name: string }>}
 */
function scanOpenTasks(transcriptContent) {
  if (!transcriptContent) return [];

  // Fast path for the overwhelming majority of turns: no launch marker anywhere
  // in the slice means nothing can be open, so skip the per-line JSON parsing.
  if (!transcriptContent.includes(AGENT_LAUNCH_MARKER) &&
      !transcriptContent.includes(BASH_LAUNCH_MARKER) &&
      !transcriptContent.includes(WORKFLOW_LAUNCH_MARKER)) {
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
    // marker is distinctive enough and survives every wrapper — but only once
    // the line is confirmed to BE a notification rather than to quote one.
    if (line.includes('<task-notification>')) {
      const notif = notificationText(line);
      if (notif) {
        TASK_NOTIFICATION_RE.lastIndex = 0;
        let m;
        while ((m = TASK_NOTIFICATION_RE.exec(notif)) !== null) open.delete(m[1]);
        // A real notification carries nothing else we care about.
        continue;
      }
      // Only quoted: keep going — the same line is an ordinary transcript entry
      // whose tool calls still have to be scanned.
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

      if (announces(text, AGENT_LAUNCH_MARKER) && canLaunch(launcher, 'agent')) {
        const m = text.match(AGENT_ID_RE);
        if (m) {
          const name = labelFor(input, 'agent');
          known.set(m[1], name);
          open.set(m[1], { kind: 'agent', name });
        }
        continue;
      }
      const wf = canLaunch(launcher, 'workflow')
        && announces(text, WORKFLOW_LAUNCH_MARKER) && text.match(WORKFLOW_BG_RE);
      if (wf) {
        const name = labelFor(input, 'workflow', text);
        known.set(wf[1], name);
        open.set(wf[1], { kind: 'workflow', name });
        continue;
      }
      const bg = canLaunch(launcher, 'task')
        && announces(text, BASH_LAUNCH_MARKER) && text.match(BASH_BG_RE);
      if (bg) {
        // Concept bridge plumbing (server / pulser / waker) runs for the whole
        // concept session and yields no result — it is never "still running work".
        if (isConceptInfra(input)) continue;
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
  BASH_LAUNCH_MARKER,
  WORKFLOW_LAUNCH_MARKER,
  LAUNCH_TOOLS,
  canLaunch,
  announces,
  isConceptInfra,
  scanOpenTasks,
  openTaskNames,
  labelFor,
  sanitizeLabel,
};
