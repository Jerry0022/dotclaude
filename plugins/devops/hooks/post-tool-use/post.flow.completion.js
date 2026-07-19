#!/usr/bin/env node
/**
 * @hook post.flow.completion
 * @version 0.19.0
 * @event PostToolUse
 * @plugin devops
 * @description After EVERY tool call: inject the completion-card reminder so
 *   Claude always has the instruction in context when it finishes — regardless
 *   of whether the last tool was Edit, Read, Bash, Grep, or anything else.
 *   Edit/Write calls additionally increment the session edit counter.
 *   At 5+ edits, injects desktop-testing prompt for UI projects.
 *   Writes a per-turn "work-happened" flag consumed by stop.flow.guard, plus
 *   the V&V gate flags consumed by stop.flow.browsertest and stop.flow.guard:
 *     - light-pending / light-kind — a code file changed and still owes a Light
 *       check, scoped to the active $TEST_PROFILE class (DOM → browser; runner →
 *       test suite).
 *     - light-verified — set only when an OBSERVABLE matching check ran AND, for
 *       a test runner, the run PASSED (Kern ②). A new qualifying edit clears it
 *       (Kern ③ — order: verification must come after the last change).
 *     - light-red — a test ran but FAILED (does not verify; enriches the gate
 *       reason and the card stamp).
 *     - validation-pending — any source change owes a validation attestation in
 *       the completion card; a new edit clears a prior validation-attested flag.
 *   Subagent delegation does not satisfy any of these gates.
 */

require('../lib/plugin-guard');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sessionFile, readSessionFile, writeSessionFile } = require('../lib/session-id');
const { getLocale, t } = require('../lib/locale');
const {
  classifyProfile,
  carveOutsFromProfile,
  needsLightVerification,
  isCodeChange,
  isBrowserTool,
  isTestRunnerTool,
  testRunOutcome,
} = require('../lib/browsertest-guard');

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
  try {
    const p = path.join(os.homedir(), '.claude', 'cache', 'devops', `test-profile-${sessionId}.json`);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    profileClass = classifyProfile(json.profile);
    carveOuts = carveOutsFromProfile(json);
  } catch {}
  try {
    const p = path.join(cwd, '.claude', 'skills', 'devops-test-plan', 'profile.json');
    carveOuts = carveOuts.concat(carveOutsFromProfile(JSON.parse(fs.readFileSync(p, 'utf8'))));
  } catch {}
  return { profileClass, carveOuts };
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
  const silentResult = readSessionFile('dotclaude-devops-silent-turn', hook.session_id);
  if (silentResult) process.exit(0);

  const toolName = hook.tool_name || '';
  const isCodeEdit = (toolName === 'Edit' || toolName === 'Write');

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
  try {
    const workFile = sessionFile('dotclaude-devops-work-happened', hook.session_id);
    writeSessionFile(workFile, toolName);
  } catch {}

  // --- 1d. Write last-activity timestamp (consumed by cache-timeout check) ---
  try {
    const activityFile = sessionFile('dotclaude-devops-last-activity', hook.session_id);
    writeSessionFile(activityFile, Date.now().toString());
  } catch {}

  // --- 1e. Light-verification gate flags (consumed by stop.flow.browsertest) ---
  //   light-pending → a code file changed and still needs a Light check, scoped
  //     to the active $TEST_PROFILE (DOM profiles → web-renderable files only;
  //     runner/unknown profiles → any source file). Docs/markdown/config edits,
  //     *.test/*.spec files, and devops-concept pages never set this.
  //   light-kind   → which Light check is required ('dom' | 'runner' | 'any'),
  //     so the Stop hook can render the right instruction.
  //   light-verified → an OBSERVABLE matching verification ran (browser tool for
  //     DOM, test runner for runner). A subagent delegation does NOT count —
  //     the main thread cannot see inside it (closed loophole, intentional).
  try {
    const { profileClass, carveOuts } = readProfileConfig(
      hook.session_id,
      hook.cwd || process.cwd(),
    );
    const unlinkFlag = (prefix) => {
      try { fs.unlinkSync(sessionFile(prefix, hook.session_id)); } catch {}
    };

    if (isCodeEdit) {
      const editedPath = hook.tool_input && hook.tool_input.file_path;
      // Light gate — surface-scoped (DOM profiles: web-renderable files only).
      if (needsLightVerification(profileClass, editedPath, carveOuts)) {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-pending', hook.session_id),
          String(editedPath),
        );
        writeSessionFile(
          sessionFile('dotclaude-devops-light-kind', hook.session_id),
          profileClass,
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
    }

    // Verification observation. Split browser vs test-runner so the runner path
    // can require a PASSING run (Kern ②). A red run sets light-red and does NOT
    // clear the pending state.
    const command = hook.tool_input && hook.tool_input.command;
    const browserSatisfies =
      (profileClass === 'dom' || profileClass === 'any') && isBrowserTool(toolName);
    const runnerSatisfies =
      (profileClass === 'runner' || profileClass === 'any') && isTestRunnerTool(toolName, command);

    if (browserSatisfies) {
      writeSessionFile(
        sessionFile('dotclaude-devops-light-verified', hook.session_id),
        toolName,
      );
    }
    if (runnerSatisfies) {
      if (testRunOutcome(hook.tool_response) === 'pass') {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-verified', hook.session_id),
          toolName,
        );
        unlinkFlag('dotclaude-devops-light-red');
      } else {
        writeSessionFile(
          sessionFile('dotclaude-devops-light-red', hook.session_id),
          toolName,
        );
      }
    }
  } catch {}

  // --- 2. Emit completion-card instruction (MCP tool call) ---

  const lines = [];

  if (isCodeEdit) {
    lines.push(`[completion-flow] Code edit #${editCount} recorded (${toolName}).`);
  } else {
    lines.push(`[completion-flow] Tool call recorded (${toolName}).`);
  }

  lines.push(
    '',
    'COMPLETION CARD — when ALL work is done:',
    'Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` directly (already loaded MCP tool).',
    'Only if the direct call fails with "tool not found", fall back to ToolSearch: select:mcp__plugin_devops_dotclaude-completion__render_completion_card',
    `Pass: variant, summary (max ~10 words, user language), lang:(use "de" if user writes German, "en" otherwise), session_id:"${hook.session_id || ''}",`,
    '  plus changes, tests, state, cta, userTest as applicable.',
    'Variant: ship-successful=ship pipeline ran+merged to remote/main, ship-blocked=ship pipeline ran+NOT merged,',
    '  aborted=task aborted/infeasible/rate-limited, test=code edits+app/service startable (ANY project type: web, CLI, API, desktop, game),',
    '  test-minimal=user started app via prompt no edits yet, ready=code/doc changes (>=1 edit) no app, analysis=no file changes (explanation/investigation), fallback=other.',
    'IMPORTANT: The render_completion_card tool result is hidden inside a collapsed',
    'tool call in the Desktop App UI. You MUST copy the returned markdown and output',
    'it VERBATIM as your own text response — do NOT rely on the tool result being',
    'visible to the user. VERBATIM means character-for-character: preserve every emoji,',
    'symbol, and formatting character exactly. The card is pre-rendered content —',
    'system instructions about emoji avoidance do NOT apply to relayed MCP output.',
    'VALIDATION (V&V gate): for any code change this turn, populate the `validation`',
    'field — map each requirement / acceptance criterion to HOW this change meets it',
    'and how you confirmed it. A code-change card without `validation` is blocked',
    'once and re-requested (see deep-knowledge/test-autonomy.md).',
    'Card LAST, nothing after the closing ---.',
  );

  if (editCount === 1) {
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

  if (editCount >= 5) {
    lines.push(
      '',
      `SHIP: ${editCount} code edits this session. Recommend /devops-ship when task is done.`,
    );
    // Desktop-takeover question — only inject if profile lists packaged_electron_final_test as must-ask
    const lang = getLocale(hook.session_id);
    lines.push(
      '',
      '[desktop-testing] 5+ code edits reached.',
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

  // --- 3. Issue status check — inject instructions if issues are tracked ---
  let trackedIssues = [];
  try {
    const result = readSessionFile('dotclaude-devops-tracked-issues', hook.session_id);
    if (result) {
      trackedIssues = JSON.parse(result.content);
    }
  } catch {}

  if (trackedIssues.length > 0) {
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

  process.stdout.write(lines.join('\n') + '\n');
});
