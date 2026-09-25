#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.27.0
 * @event PostToolUse
 * @plugin devops
 * @description Keeps the completion-card contract in Claude's context: on the
 *   FIRST tool call of every turn it injects the card reminder, so Claude has
 *   the instruction when it finishes — whichever tool the turn starts with.
 *   Everything else it tells Claude is an event, sent only on the call it
 *   happens: a background launch, the first code edit, the 5th code edit
 *   (ship + desktop-testing prompt), a card already rendered this turn.
 *   Edit/Write calls additionally increment the session edit counter.
 *
 *   The text goes out as `hookSpecificOutput.additionalContext`. Plain stdout
 *   of a PostToolUse hook never reaches the model — it only shows in transcript
 *   mode (CONVENTIONS.md). Verified live 2026-09-25 in the Desktop app
 *   (2.1.281) and the CLI (2.1.175): a JSON marker from this hook reached the
 *   model, a plain-stdout marker from the same call did not. Until then every
 *   reminder below had been recorded as `hook_success` and never read. Being
 *   delivered now, it is sent only when it changes something: a reminder after
 *   EVERY call would add its full text to the context each time.
 *   Writes a per-turn "work-happened" flag consumed by stop.flow.guard, plus
 *   the V&V gate flags consumed by stop.flow.browsertest and stop.flow.guard:
 *     - light-pending / light-kind — a code file changed and still owes a Light
 *       check, scoped to the active $TEST_PROFILE class (DOM → browser; runner →
 *       test suite).
 *     - light-verified — set only when an OBSERVABLE matching check ran AND, for
 *       a test runner, the run PASSED (Kern ②). A new qualifying edit clears it
 *       (Kern ③ — order: verification must come after the last change).
 *     - light-red — a test ran but FAILED (does not verify; enriches the gate
 *       reason and the card stamp). "Ran" means the runner's own summary is in
 *       the output: a chained command that dies before the runner (#409) is
 *       'unknown' and touches neither flag.
 *     - validation-pending — any source change owes a validation attestation in
 *       the completion card; a new edit clears a prior validation-attested flag.
 *   Subagent delegation does not satisfy any of these gates, and a subagent
 *   call (payload carries `agent_id`) touches none of the parent's state: no
 *   counter, no work-happened flag, no gate flag is written or cleared.
 *   Only edits inside the session's own work tree owe the gates: a file outside
 *   projectRoot(cwd), or inside a LINKED worktree nested in it (an isolated
 *   agent's .claude/worktrees/agent-*), owes nothing.
 *   Merged work owes them like an edit: after a parent Bash/PowerShell git
 *   merge / pull / cherry-pick / rebase / am / revert, every code file the new
 *   HEAD reflog entries brought in owes exactly what an edit of it owes.
 *
 *   Except after the card itself: the render's result carries its own relay
 *   contract, and the card widget ends the turn — there the generic reminder
 *   ("render … output the markdown VERBATIM") read as "a card still follows"
 *   and produced a line under the widget plus a second, identical card.
 *
 *   Also detects background work started by the current call (a run_in_background
 *   Agent, a Workflow run, a Bash task backgrounded at launch or moved there at
 *   its timeout) from the call's structured tool_response, and injects the
 *   `pending` instruction right away, so a card rendered before those results
 *   arrive declares them instead of being bounced by stop.flow.guard's pending
 *   gate.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { projectRoot, findRepoRoot, samePath } = require('../lib/project-root');
const { isMcpServerAlive } = require('../lib/mcp-heartbeat');
const { NO_OUTPUT_NUDGE_REPLY } = require('../lib/card-guard');
const { getLocale, t } = require('../lib/locale');
const { responseLaunch, labelFor, isConceptInfra } = require('../lib/pending-tasks');
const {
  classifyProfile,
  carveOutsFromProfile,
  domPathsFromProfile,
  resolveVerificationKind,
  isCodeChange,
  isBrowserTool,
  isTestRunnerTool,
  testRunOutcome,
} = require('../lib/browsertest-guard');

// Offline card renderer — the same module that backs the MCP tool, invoked as a
// CLI. Named in the reminder so a session whose MCP servers never connected
// still knows how to produce a card. Forward slashes: the reminder is a Bash
// command line, and Windows paths must survive it.
const OFFLINE_RENDERER = (process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..', '..'))
  .replace(/\\/g, '/') + '/mcp-server/index.js';

/**
 * Read the pinned $TEST_PROFILE for this session (cache written per
 * deep-knowledge/test-plan.md) plus the project's no-runtime static carve-outs
 * (`no_runtime_static_paths` — see #237). Carve-outs merge from BOTH the
 * session profile cache and the project override file, so a consumer project
 * is protected from turn one even before detection ran.
 * Missing / unreadable → 'any' with no carve-outs.
 * @param {string} sessionId
 * @param {string} cwd — project root (hook.cwd)
 * @returns {{ profileClass: 'dom'|'runner'|'any', carveOuts: RegExp[] }}
 */
function readProfileConfig(sessionId, cwd) {
  let profileClass = classifyProfile('');
  let carveOuts = [];
  let domPaths = [];
  try {
    const p = path.join(os.homedir(), '.claude', 'cache', 'devops', `test-profile-${sessionId}.json`);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    profileClass = classifyProfile(json);
    carveOuts = carveOutsFromProfile(json);
    domPaths = domPathsFromProfile(json);
  } catch {}
  try {
    const p = path.join(cwd, '.claude', 'skills', 'devops-test-plan', 'profile.json');
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    carveOuts = carveOuts.concat(carveOutsFromProfile(json));
    domPaths = domPaths.concat(domPathsFromProfile(json));
    // The project override also declares the class when the session cache has
    // not been written yet (detection has not run), so a consumer project is
    // classified correctly from turn one.
    if (profileClass === 'any') profileClass = classifyProfile(json);
  } catch {}
  return { profileClass, carveOuts, domPaths };
}

// Bilingual strings for the desktop-test AskUserQuestion prompt.
// Keys correspond to fields the user sees in Claude Code's question UI.
const DESKTOP_TEST_DICT = {
  en: {
    header: 'Desktop test',
    question: 'Should I take over the desktop to visually test the changes automatically?',
    warning:
      'WARNING: During automated tests the desktop is periodically controlled — ' +
      'mouse and keyboard move on their own. You can keep working, but your work ' +
      'will be briefly interrupted. Games, video calls, or time-critical tasks ' +
      'should NOT run during this window.',
    optYes: 'Yes, take over the desktop',
    optNo: 'No, test manually',
  },
  de: {
    header: 'Desktop-Test',
    question: 'Soll ich den Desktop übernehmen, um die Änderungen automatisch visuell zu testen?',
    warning:
      'WARNUNG: Während der automatischen Tests wird der Desktop periodisch ' +
      'gesteuert — Maus und Tastatur werden automatisch bewegt. Du kannst ' +
      'weiterarbeiten, aber deine Arbeit wird dabei kurzzeitig unterbrochen. ' +
      'Spiele, Videocalls oder zeitkritische Aufgaben sollten in diesem ' +
      'Zeitraum NICHT laufen.',
    optYes: 'Ja, Desktop übernehmen',
    optNo: 'Nein, manuell testen',
  },
};

/** How the reminder names each kind of launched work. */
const LAUNCH_NOUN = {
  agent: 'Background agent',
  task: 'Background task',
  workflow: 'Background workflow',
};

/** The code edit on which the ship nudge and the desktop-testing prompt fire. */
const SHIP_NUDGE_EDITS = 5;

/**
 * Hand text to Claude. A PostToolUse hook reaches the model only through
 * `hookSpecificOutput.additionalContext`; plain stdout lands in the transcript
 * and nowhere else. Nothing to say → no output at all.
 * @param {string[]} lines
 */
function emit(lines) {
  const text = lines.join('\n').trim();
  if (!text) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
  }));
}

const SHIP_RELEASE_TOOL = 'mcp__plugin_devops_dotclaude-ship__ship_release';

/** The Desktop card itself: show_widget (any namespace) with the card-body title. */
function isCardWidgetCall(toolName, toolInput) {
  const widgetTool = toolName === 'show_widget' || toolName.endsWith('__show_widget');
  return widgetTool && !!toolInput && toolInput.title === 'completion_card_body';
}

/**
 * Did a ship_release response report a merge? MCP results arrive as
 * `{ content: [{ type: 'text', text: '<json>' }] }`; tolerate a bare object or
 * string too. `merged` is the field the do-ship skill itself gates on — never
 * `success`, which the skipped shapes (file-only, no-remote) also set.
 */
function shipReleaseMerged(toolResponse) {
  let r = toolResponse;
  try {
    if (r && Array.isArray(r.content)) {
      const text = r.content.filter(c => c && c.type === 'text').map(c => c.text).join('');
      r = JSON.parse(text);
    } else if (typeof r === 'string') {
      r = JSON.parse(r);
    }
  } catch { return false; }
  return !!(r && typeof r === 'object' && r.merged);
}

/** Per-turn flags the completion MCP writes under the `session_id` the MODEL passed. */
const CARD_FLAG_PREFIXES = [
  'dotclaude-devops-card-rendered',
  'dotclaude-devops-validation-attested',
  'dotclaude-devops-pending-attested',
  'dotclaude-devops-card-widget',
];

/**
 * Move the card flags the MCP just wrote under the model-supplied key onto
 * this session's real id. The MCP only knows what the model passes — and the
 * model passes `"self"` (the ccd_session convention), the Desktop
 * `local_…` id, or nothing — while stop.flow.guard reads the harness id,
 * exact match only (#290). Unmoved, every such card counted as "never
 * rendered" and the guard demanded a second one.
 *
 * @param {object} hook — PostToolUse payload of a render_completion_card call
 * @returns {number} how many flags were moved
 */
function adoptCardFlags(hook) {
  const realId = hook.session_id;
  if (!realId) return 0;
  const input = hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {};
  const given = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'unknown';
  if (given === realId || /[\\/]|\.\./.test(given)) return 0;
  let moved = 0;
  for (const prefix of CARD_FLAG_PREFIXES) {
    const from = sessionFile(prefix, given);
    const to = sessionFile(prefix, realId);
    try {
      // The widget HTML is copied, not moved: the tool result names its path
      // as the fallback source for a cut-off widget block.
      if (prefix === 'dotclaude-devops-card-widget') fs.copyFileSync(from, to);
      else fs.renameSync(from, to);
      moved++;
    } catch { /* not written for this card */ }
  }
  return moved;
}

/** A subagent's tool call: the harness sets `agent_id`, but keeps the PARENT's session_id. */
function isSubagentCall(hook) {
  return !!hook && typeof hook.agent_id === 'string' && hook.agent_id !== '';
}

/** Is `child` the directory `parent` or below it? (win32: path.relative ignores case.) */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false; // another drive
  return rel !== '..' && !rel.startsWith('..' + path.sep);
}

/** Is `dir` a LINKED worktree — `.git` a FILE whose gitdir points into a `…/worktrees/…` admin dir? */
function isLinkedWorktree(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    if (!fs.statSync(dotGit).isFile()) return false;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!m) return false;
    return /(^|\/)worktrees\//.test(path.resolve(dir, m[1]).replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

/**
 * Does `file` belong to the session's own work tree? Outside `projectRoot(cwd)`
 * it does not; nor inside a linked worktree nested in it (an isolated agent's
 * `<main checkout>/.claude/worktrees/agent-*`). A submodule or a nested plain
 * repo stays inside. Pure fs walk, no git spawn.
 */
function inOwnWorkTree(file, cwd) {
  if (!file) return true;
  const base = cwd || process.cwd();
  const own = projectRoot(base);
  const abs = path.resolve(base, String(file));
  if (!isInside(abs, own)) return false;
  const nearest = findRepoRoot(path.dirname(abs));
  if (nearest && !samePath(nearest, own) && isInside(nearest, own) && isLinkedWorktree(nearest)) {
    return false;
  }
  return true;
}

const MERGE_CMD_RE = /\bgit\b[\s\S]*\b(?:merge|pull|cherry-pick|rebase|am|revert|commit)\b/;
// `commit (merge)` ends in `)`, where `\b` cannot match — kept outside the \b group.
const MERGE_SUBJECT_RE = /^(?:(?:merge|pull|cherry-pick|rebase|am|revert)\b|commit \(merge\))/;
const MERGE_MAX_AGE_S = 30 * 60;
const GIT_OPTS = { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };

/**
 * Files a merge-like HEAD move of THIS call brought into the checkout.
 *
 * Reads HEAD's reflog rather than ORIG_HEAD: cherry-pick does not reliably set
 * ORIG_HEAD, and after an "Already up to date" merge a stale ORIG_HEAD would
 * re-owe an older merge. A per-session watermark (newest reflog time + entry
 * seen at the previous read, rewritten on every read) keeps one merge from
 * being owed twice; the second line disambiguates entries in the same second.
 *
 * @returns {string[]} absolute paths (unfiltered — the caller applies the gates' rules)
 */
function mergedFiles(cwd, sessionId) {
  const root = projectRoot(cwd || process.cwd());
  let out;
  try {
    out = execFileSync('git', ['reflog', '-n', '200', '--format=%H %gd %gs', '--date=unix', 'HEAD'],
      { ...GIT_OPTS, cwd: root });
  } catch {
    return [];
  }
  const entries = [];
  for (const line of String(out).split(/\r?\n/)) {
    const m = /^([0-9a-f]{7,64}) \S*?@\{(\d+)\} ?(.*)$/.exec(line);
    if (m) entries.push({ line, sha: m[1], time: Number(m[2]), subject: m[3] });
  }
  const wmFile = sessionFile('dotclaude-devops-reflog-seen', sessionId);
  let wmTime = 0, wmLine = '';
  try {
    const [t, l] = fs.readFileSync(wmFile, 'utf8').split('\n');
    wmTime = Number(t) || 0;
    wmLine = l || '';
  } catch { /* absent on the session's first read */ }
  if (entries.length) {
    try { writeSessionFile(wmFile, `${entries[0].time}\n${entries[0].line}`); } catch { /* best effort */ }
  }

  // New = above the entry seen last time; when that entry is gone, newer than its time.
  let seenAt = wmLine ? entries.findIndex(e => e.line === wmLine) : -1;
  if (seenAt < 0) seenAt = entries.findIndex(e => e.time <= wmTime && wmTime > 0);
  const fresh = seenAt < 0 ? entries.length : seenAt;
  const minTime = Math.floor(Date.now() / 1000) - MERGE_MAX_AGE_S;

  let i = 0;
  while (i < fresh && !MERGE_SUBJECT_RE.test(entries[i].subject)) i++;
  const top = i;
  while (i < fresh && MERGE_SUBJECT_RE.test(entries[i].subject) && entries[i].time >= minTime) i++;
  if (i === top || i >= entries.length) return [];
  if (entries[top].time < minTime) return [];
  const before = entries[i].sha;
  const after = entries[top].sha;
  try {
    const names = execFileSync('git', ['diff', '--name-only', before, after], { ...GIT_OPTS, cwd: root });
    return String(names).split(/\r?\n/).filter(Boolean).map(p => path.join(root, p));
  } catch {
    return [];
  }
}

/**
 * Did THIS tool call start background work that outlives the turn?
 * The Stop gate proves it from the transcript (lib/pending-tasks.js); this
 * reads the live tool_response, so the reminder can fire immediately.
 *
 * The response is the tool's structured result, which never carries the
 * launch sentence the model reads: an async Agent is `isAsync` + status
 * "async_launched", a Workflow run status "async_launched" + taskId (with
 * its `workflowName`), a Bash/PowerShell task `backgroundTaskId` — see
 * responseLaunch(). The old text match on JSON.stringify(tool_response)
 * therefore never fired for a real launch; it only fired when an agent's
 * PROMPT quoted the sentence.
 *
 * A backgrounded Bash task that is concept-bridge plumbing (server, keepalive
 * pulser, pickup waker) is reported as kind 'concept-infra': it runs for the
 * whole concept and never yields a result, so it must NOT end up in `pending` —
 * the Stop gate ignores it, and the card carries `concept` instead.
 *
 * @param {object} hook — PostToolUse payload
 * @returns {{ kind: 'agent'|'task'|'workflow'|'concept-infra', name: string }|null}
 */
function detectBackgroundLaunch(hook) {
  const launch = responseLaunch(hook && hook.tool_name, hook && hook.tool_response);
  if (!launch) return null;
  const input = (hook.tool_input && typeof hook.tool_input === 'object') ? hook.tool_input : {};
  if (launch.kind === 'agent') return { kind: 'agent', name: labelFor(input, 'agent') };
  if (launch.kind === 'workflow') {
    // The result's own workflowName outranks what the script literal says.
    const named = launch.name ? { ...input, name: launch.name } : input;
    const text = typeof hook.tool_response === 'string' ? hook.tool_response : '';
    return { kind: 'workflow', name: labelFor(named, 'workflow', text) };
  }
  return { kind: isConceptInfra(input) ? 'concept-infra' : 'task', name: labelFor(input, 'task') };
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { inputData += d; });
process.stdin.on('end', () => {
  let hook;
  try { hook = JSON.parse(inputData); }
  catch { process.exit(0); }

  // Silent turn (cron git-sync, concept bridge poll, autonomous loop tick):
  // skip the completion-card reminder and do not mark work-happened. The real
  // user turn already rendered its card; this background tick must not trigger
  // a second one. Flag is written by prompt.flow.silent-turn and cleared by
  // stop.flow.guard at turn end.
  // Exact match only (issue #290): a neighbouring session's silent-turn flag
  // must not suppress this session's card reminder and light-pending bookkeeping.
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', hook.session_id, { exact: true });
  if (silentResult) process.exit(0);

  // Subagent call: hooks fire for it with the PARENT's session_id, and all
  // that follows is parent-turn bookkeeping (ship flag, card-flag adoption,
  // counters, work-happened, the V&V gate flags, and a reminder PostToolUse
  // stdout never delivers to the model anyway). Observed 2026-09-25: an
  // isolated background agent's Edit inside its own worktree wrote the
  // parent's validation-pending and deleted the validation-attested flag the
  // parent's card had written four minutes earlier — both Stop gates then
  // blocked an unchanged parent checkout. Its passing test run would equally
  // have "verified" the parent, which delegation never may.
  if (isSubagentCall(hook)) process.exit(0);

  const toolName = hook.tool_name || '';
  const isCodeEdit = (toolName === 'Edit' || toolName === 'Write');

  // --- 0. Ship happened this turn? (consumed by stop.flow.guard, #371) ---
  // ship_release reporting `merged` is the one signal that a scheduled task
  // did more than tick — its card is owed even with a clean tree afterwards.
  if (toolName === SHIP_RELEASE_TOOL && shipReleaseMerged(hook.tool_response)) {
    try { writeSessionFile(sessionFile('dotclaude-devops-shipped', hook.session_id), '1'); } catch {}
  }
  if (toolName.endsWith('__render_completion_card')) adoptCardFlags(hook);
  const scheduledTask =
    readSessionFile('dotclaude-devops-scheduled-task', hook.session_id, { exact: true }) !== null;

  // --- 1. Increment edit counter (only for Edit/Write) ---
  let editCount = 0;
  const counterFile = sessionFile('dotclaude-devops-edits', hook.session_id);
  try {
    editCount = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {}

  if (isCodeEdit) {
    editCount++;
    try { writeSessionFile(counterFile, editCount.toString()); } catch {}
  }

  // --- 1b. Increment tool-call counter (all tool calls) ---
  const toolCallFile = sessionFile('dotclaude-devops-toolcalls', hook.session_id);
  let toolCallCount = 0;
  try {
    toolCallCount = parseInt(fs.readFileSync(toolCallFile, 'utf8'), 10) || 0;
  } catch {}
  toolCallCount++;
  try { writeSessionFile(toolCallFile, toolCallCount.toString()); } catch {}

  // --- 1c. Write per-turn work-happened flag (consumed by stop.flow.guard) ---
  // stop.flow.guard deletes it when a turn ends, so the call that CREATES it is
  // the turn's first — the one that carries the card reminder (section 2). The
  // create is exclusive ('wx'), so hooks running side by side for parallel tool
  // calls can never both claim "first".
  const workFile = sessionFile('dotclaude-devops-work-happened', hook.session_id);
  let firstOfTurn = false;
  try {
    fs.writeFileSync(workFile, toolName, { flag: 'wx' });
    firstOfTurn = true;
  } catch {
    try { writeSessionFile(workFile, toolName); } catch {}
  }

  // --- 1d. Write last-activity timestamp (consumed by cache-timeout check) ---
  try {
    const activityFile = sessionFile('dotclaude-devops-last-activity', hook.session_id);
    writeSessionFile(activityFile, Date.now().toString());
  } catch {}

  // --- 1e. Light-verification gate flags (consumed by stop.flow.browsertest) ---
  //   light-pending → a code file changed and still needs a Light check, scoped
  //     to the active $TEST_PROFILE (DOM profiles → web-renderable files only;
  //     runner/unknown profiles → any source file). Docs/markdown/config edits,
  //     *.test/*.spec files, and concept pages never set this.
  //   light-kind   → which Light check is required ('dom' | 'runner' | 'any'),
  //     so the Stop hook can render the right instruction.
  //   light-verified → an OBSERVABLE matching verification ran (browser tool for
  //     DOM, test runner for runner). A subagent delegation does NOT count —
  //     the main thread cannot see inside it (closed loophole, intentional).
  try {
    const { profileClass, carveOuts, domPaths } = readProfileConfig(
      hook.session_id,
      hook.cwd || process.cwd(),
    );
    const unlinkFlag = (prefix) => {
      try { fs.unlinkSync(sessionFile(prefix, hook.session_id)); } catch {}
    };

    // What a change of `editedPath` owes — shared by edits and merged files, so
    // the last file's kind wins exactly like consecutive edits.
    const oweFor = (editedPath) => {
      // Light gate — scoped per FILE, not per profile: under a DOM profile a
      // renderer file owes a browser check while a backend file owes a test run.
      const owedKind = resolveVerificationKind(profileClass, editedPath, { carveOuts, domPaths });
      if (owedKind !== null) {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-pending', hook.session_id),
          String(editedPath),
        );
        writeSessionFile(
          sessionFile('dotclaude-devops-light-kind', hook.session_id),
          owedKind,
        );
        // ③ order — a new qualifying edit invalidates any prior verification,
        // so the Light check must run AFTER this change.
        unlinkFlag('dotclaude-devops-light-verified');
        unlinkFlag('dotclaude-devops-light-red');
      }
      // Validation gate — surface-agnostic: ANY real source change owes a
      // validation attestation in the completion card. A new edit invalidates
      // a prior attestation (order).
      if (isCodeChange(editedPath, carveOuts)) {
        writeSessionFile(
          sessionFile('dotclaude-devops-validation-pending', hook.session_id),
          String(editedPath),
        );
        unlinkFlag('dotclaude-devops-validation-attested');
      }
    };

    // Only the session's own work tree owes: an edit in a sibling checkout or
    // in an isolated agent's nested worktree changes nothing this turn ships.
    if (isCodeEdit) {
      const editedPath = hook.tool_input && hook.tool_input.file_path;
      if (inOwnWorkTree(editedPath, hook.cwd)) oweFor(editedPath);
    }

    const command = hook.tool_input && hook.tool_input.command;

    // Merged work owes like an edit — this is where delegated work lands.
    // Before the verification observation, so `git pull && npm test` passing
    // ends verified.
    if ((toolName === 'Bash' || toolName === 'PowerShell') && command && MERGE_CMD_RE.test(String(command))) {
      for (const file of mergedFiles(hook.cwd, hook.session_id)) {
        if (isCodeChange(file, carveOuts)) oweFor(file);
      }
    }

    // Verification observation. Split browser vs test-runner so the runner path
    // can require a PASSING run (Kern ②). A red run sets light-red and does NOT
    // clear the pending state.
    // Match against the kind actually OWED (written per edited file above), not
    // the profile class — otherwise a backend edit under a DOM profile could
    // never be satisfied by the test run it legitimately requires. Falls back to
    // the profile class when no pending kind was recorded.
    let owedKind = profileClass;
    const kindFlag = readSessionFile('dotclaude-devops-light-kind', hook.session_id, { exact: true });
    if (kindFlag && typeof kindFlag.content === 'string' && kindFlag.content.trim()) {
      owedKind = kindFlag.content.trim();
    }
    const browserSatisfies =
      (owedKind === 'dom' || owedKind === 'any') && isBrowserTool(toolName);
    const runnerSatisfies =
      (owedKind === 'runner' || owedKind === 'any') && isTestRunnerTool(toolName, command);

    if (browserSatisfies) {
      writeSessionFile(
        sessionFile('dotclaude-devops-light-verified', hook.session_id),
        toolName,
      );
    }
    if (runnerSatisfies) {
      // 'unknown' (#409): the command named a runner but exited non-zero
      // without any runner output — a chain that died BEFORE the runner
      // (`python patch.py && npm test`). Neither verified nor red: the flags
      // stay exactly as they were.
      const outcome = testRunOutcome(hook.tool_response);
      if (outcome === 'pass') {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-verified', hook.session_id),
          toolName,
        );
        unlinkFlag('dotclaude-devops-light-red');
      } else if (outcome === 'fail') {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-red', hook.session_id),
          toolName,
        );
      }
    }
  } catch {}

  // --- 2. Tell Claude — as additionalContext, and only what changes something ---
  // Everything below goes through emit(): plain stdout would never reach the
  // model (see header). Delivered text stays in the context for the rest of
  // the session, so the card contract rides on the turn's FIRST call only;
  // every later call sends nothing unless an event happens on it.

  // After the card itself the generic reminder is wrong: it asks for a card
  // that is already there. Observed 2026-09-24 — injected right after the
  // card widget, it read as "the markdown card still follows" and produced a
  // line under the widget, the Stop gate's re-demand, and an identical second
  // card.
  if (isCardWidgetCall(toolName, hook.tool_input)) {
    emit([
      '[completion-flow] Card shown — this is the end of the turn.',
      'Write nothing after it: no summary, no "the card is above", no second card.',
      NO_OUTPUT_NUDGE_REPLY,
    ]);
    return;
  }
  if (toolName.endsWith('__render_completion_card')) {
    emit([
      '[completion-flow] Card rendered — deliver it exactly as its result says (Desktop app: the ' +
      'show_widget call IS the card and the LAST action; terminal: the markdown VERBATIM, last). ' +
      'Render no second card for the same outcome.',
    ]);
    return;
  }

  const lines = [];

  if (readSessionFile('dotclaude-devops-card-rendered', hook.session_id, { exact: true }) !== null) {
    lines.push(
      '[completion-flow] A completion card was already rendered this turn. Render a new one only when the',
      'outcome changed since — then show THAT one; never show the same card twice.',
    );
  }

  // The card contract — once per turn, on its first tool call.
  if (firstOfTurn) {
    // Offline-first when the completion MCP's heartbeat is dead (#371): each
    // failed rung of the ladder costs a turn, so name the working one first.
    const completionDown = !isMcpServerAlive('dotclaude-completion');
    const ladder = completionDown
      ? [
          `The dotclaude-completion MCP server is NOT running (heartbeat dead) — render offline FIRST: node "${OFFLINE_RENDERER}" --render-card <payload.json> (same JSON args, relay stdout verbatim).`,
          'Only if that node call fails, try `mcp__plugin_devops_dotclaude-completion__render_completion_card` directly, then ToolSearch (select:mcp__plugin_devops_dotclaude-completion__render_completion_card).',
        ]
      : [
          'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` directly (already loaded MCP tool).',
          'Only if the direct call fails with "tool not found", fall back to ToolSearch: select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
          `If the MCP server never connected this session (CONNECT_TIMEOUT), render offline instead — never skip the card: node "${OFFLINE_RENDERER}" --render-card <payload.json> (same JSON args, relay stdout verbatim).`,
        ];

    if (scheduledTask) {
      lines.push(
        '',
        'SCHEDULED TASK: if this turn changes NO file and ships nothing, end with your',
        'one-line status — no completion card (stop.flow.guard waives it for an idle',
        'tick). Any edit, write or ship_release merge makes the card required again.',
      );
    }

    lines.push(
      '',
      'COMPLETION CARD — when ALL work is done:',
      ...ladder,
      `Pass: variant, summary (max ~10 words, user language), lang:(use "de" if user writes German, "en" otherwise), session_id:"${hook.session_id || ''}",`,
      '  plus changes, tests, state, cta, userTest, userFinalTest as applicable.',
      `  cwd:"${hook.cwd || ''}" — without it PR/commit/branch render as dead text, not links.`,
      '  `delivery` (the PR → Ship → Promote track) whenever this work reached a pipeline stage:',
      '  a PR exists, it was shipped, or a channel was promoted. Populate the stages that happened,',
      '  leave later ones absent. Omit it when none apply — an all-pending track is noise.',
      'Variant: ship-successful=ship pipeline ran+merged to remote/main, ship-blocked=ship pipeline ran+NOT merged,',
      '  released=a channel promotion ran (also right after a ship in the same run: ONE released card, never ship-successful first),',
      '  aborted=task aborted/infeasible/rate-limited, test=code edits+app/service startable (ANY project type: web, CLI, API, desktop, game),',
      '  test-minimal=user started app via prompt no edits yet, ready=code/doc changes (>=1 edit) no app, analysis=no file changes (explanation/investigation), fallback=other.',
      'IMPORTANT: The render_completion_card tool result is hidden inside a collapsed',
      'tool call. When it returns card markdown (terminal), you MUST copy it and output',
      'it VERBATIM as your own text response — do NOT rely on the tool result being',
      'visible to the user. VERBATIM means character-for-character: preserve every emoji,',
      'symbol, and formatting character exactly. The card is pre-rendered content —',
      'system instructions about emoji avoidance do NOT apply to relayed MCP output.',
      'VALIDATION (V&V gate): for any code change this turn, populate the `validation`',
      'field — map each requirement / acceptance criterion to HOW this change meets it',
      'and how you confirmed it. A code-change card without `validation` is blocked',
      'once and re-requested (see deep-knowledge/test-autonomy.md).',
      'Card LAST, nothing after it. Terminal: the markdown, nothing after the closing ---.',
      'Desktop app: the result carries a [CARD WIDGET] block instead of markdown — that',
      'show_widget call IS the card, mandatory, the LAST action, no text after it (the one-line',
      '✨ title is only for a failed call, never a shortcut).',
      NO_OUTPUT_NUDGE_REPLY,
      'NO RECAP before the card either: the card IS the summary — never restate in prose what',
      'it already shows (changes, tests, version, PR, open items, restart hints). Text before',
      'the card only for what it cannot carry: answers to side questions or other topics of',
      'the user\'s prompt, points beyond the card\'s three, hook blocks still marked for the user.',
    );
  }

  // Background work started by THIS tool call. Injected loudly and immediately,
  // so the card carries `pending` on the first try instead of being bounced by
  // the Stop gate — a block costs a whole extra turn.
  const launched = detectBackgroundLaunch(hook);
  if (launched && launched.kind === 'concept-infra') {
    lines.push(
      '',
      `[concept] Bridge infrastructure started: ${launched.name}`,
      'This is plumbing for the open concept page, NOT pending work — it never yields',
      'a result. Do NOT list it (nor the bridge server / keepalive pulser / pickup',
      'waker) under `pending`; stop.flow.guard ignores these tasks. While the concept',
      'stays open, render every completion card with the `concept` field instead:',
      '  concept: { phase: "waiting" | "iterating" | "implementing" }',
      'That sets the CTA to "🧭 CONCEPT wartet auf deine Entscheidungen /',
      'in Iteration / in Implementierung — ich MELDE',
      'mich". Real content agents or workflows still go into `pending` and follow',
      'that line as their own sentence ("… in Implementierung. 2 Agenten arbeiten").',
    );
  } else if (launched) {
    lines.push(
      '',
      `[pending] ${LAUNCH_NOUN[launched.kind] || 'Background task'} started: ${launched.name}`,
      'It keeps running after you hand the turn back. If you finish this turn before',
      'its result arrives, the completion card MUST carry the `pending` field:',
      `  pending: [{ name: "${launched.name}", kind: "${launched.kind}", doing: "<what it is working on>" }]`,
      'That replaces the CTA of every variant with "⏳ NOCH NICHT FERTIG. … — ich MELDE',
      'mich" — without it the card would tell the user to SHIP or act on a result that',
      'does not exist yet. stop.flow.guard detects open background work and blocks a',
      'card that omits it. Name the agent/workflow/task; NEVER put an internal agentId in the card.',
    );
  }

  // Edit milestones fire on the edit that reaches them — the counter stays at
  // its value on every later call, and "=== 1" / ">= 5" on the count alone
  // repeated the same block after each of them.
  if (isCodeEdit && editCount === 1) {
    lines.push(
      '',
      '[test-autonomy] First code edit this session.',
      'Before any test action: follow deep-knowledge/test-plan.md to pin $TEST_PROFILE.',
      'Then follow the profile tool_chain — do NOT default to computer-use.',
      'For web/renderer changes the PRIMARY browser tool is the Claude-in-Chrome',
      'extension running in Edge (Chrome-MCP); Preview is only the fallback when the',
      'extension is not connected (see deep-knowledge/browser-tool-strategy.md).',
      'Always read console + network errors (read_console_messages +',
      'read_network_requests, or preview_console_logs) alongside the snapshot — a',
      'clean DOM does not prove the absence of runtime errors.',
      'Ask user ONLY at the must-ask triggers listed in $TEST_PROFILE.must_ask_triggers',
      '(see deep-knowledge/test-autonomy.md for the canonical list — 3 triggers total).',
    );
  }

  if (isCodeEdit && editCount === SHIP_NUDGE_EDITS) {
    lines.push(
      '',
      `SHIP: ${editCount} code edits this session. Recommend /do-ship when task is done.`,
    );
    // Desktop-takeover question — only inject if profile lists packaged_electron_final_test as must-ask
    const lang = getLocale(hook.session_id);
    lines.push(
      '',
      `[desktop-testing] ${SHIP_NUDGE_EDITS} code edits reached.`,
      'BEFORE asking user for desktop takeover, check $TEST_PROFILE.must_ask_triggers:',
      '  - If "packaged_electron_final_test" is listed AND the change touched main-process code → ask',
      '  - Otherwise → skip the question entirely, use snapshot/screenshot via the browser tool ($BROWSER_TOOL) instead',
      'If asking, use the existing AskUserQuestion template below:',
      `  Header: "${t('header', lang, DESKTOP_TEST_DICT)}"`,
      `  Question: "${t('question', lang, DESKTOP_TEST_DICT)}"`,
      `  Warning in question: "${t('warning', lang, DESKTOP_TEST_DICT)}"`,
      `  Options: "${t('optYes', lang, DESKTOP_TEST_DICT)}" / "${t('optNo', lang, DESKTOP_TEST_DICT)}"`,
      '  If yes → computer-use visual tests (see deep-knowledge/desktop-testing.md)',
      '  If no → manual userTest steps in completion card',
    );
  }

  // --- 3. Issue status check — with the card contract, once per turn ---
  let trackedIssues = [];
  if (firstOfTurn) {
    try {
      const result = readSessionFile('dotclaude-devops-tracked-issues', hook.session_id);
      if (result) {
        trackedIssues = JSON.parse(result.content);
      }
    } catch {}
  }

  if (Array.isArray(trackedIssues) && trackedIssues.length > 0) {
    const issueList = trackedIssues.map(n => `#${n}`).join(', ');
    lines.push(
      '',
      `[issue-status] Tracked issues this session: ${issueList}`,
      'BEFORE rendering the completion card, evaluate each tracked issue:',
      '1. Read the issue body and acceptance criteria from GitHub (gh issue view N)',
      '2. Compare against the changes made in this session',
      '3. For each issue:',
      '   - If ALL acceptance criteria are met → set status to "Done" on the GitHub project board',
      '   - If NOT fully done → set status to "Todo" on the GitHub project board',
      '     AND post a comment on the issue summarizing:',
      '     • What was completed in this session',
      '     • What remains open',
      'Do this silently — no extra output to the user, just the API calls.',
    );
  }

  emit(lines);
});
