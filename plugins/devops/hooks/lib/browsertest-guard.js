/**
 * @module browsertest-guard
 * @version 0.4.0
 * @description Pure decision logic for the Light-verification enforcement gate
 *   (the "V" in the V&V gate). Split out of stop.flow.browsertest.js so the
 *   rules can be unit-tested without mocking stdin or temp files.
 *
 *   The gate forces a Light verification whenever a CODE file changed in a
 *   session but the matching Light check never ran (or ran RED):
 *     - DOM-surface profiles (web-*, electron-ow, …) → a browser tool must run
 *       (Claude-in-Chrome in Edge / Playwright / Preview).
 *     - Runner profiles (cli-node, lib, generic, …) → a test runner must run
 *       AND pass (a red run does NOT satisfy — Kern ②).
 *     - Unknown / unpinned profile → either satisfies.
 *
 *   Per deep-knowledge/test-autonomy.md the Light check is mandatory and
 *   autonomous; Full (computer-use / packaged-app launch) stays opt-in and is
 *   NOT enforced here. Delegating to a subagent does NOT satisfy the gate —
 *   verification must be observable in the main thread (closed loophole).
 *
 *   Hardening (V&V concept):
 *     ② green-not-just-ran — a test run only verifies when it passed; the
 *        outcome is read best-effort from the PostToolUse tool_response.
 *     ③ order — a new qualifying edit invalidates a prior verification (the
 *        verified flag is cleared by post.flow.completion on the next edit), so
 *        verification must come AFTER the last code change.
 *     Escalation — the gate blocks up to CAP times instead of once. An early
 *        skip requires an explicit `SKIP-VERIFICATION: <reason>` token in the
 *        response; otherwise the gate keeps blocking until the cap, then yields
 *        (never wedges) and records a visible skip.
 *
 *   Inputs: flag state (light-pending / light-verified / red / kind) +
 *           stop_hook_active + silent + blockCount + skipJustified.
 *   Output: { action, reason?, resetFlags, incrementBlock?, markSkipped? }.
 */

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

// Markup / style / framework-component files are ALWAYS browser-renderable.
const ALWAYS_WEB_RE = /\.(html?|css|scss|sass|less|vue|svelte|astro|tsx|jsx)$/i;
// Bare scripts count as renderable only when they live under a UI source dir.
const SCRIPT_RE = /\.(ts|js|mjs|cjs)$/i;
const UI_DIR_RE = /(^|\/)(src|app|components|pages|views|renderer)\//i;
// Any source-code file (broader than web) — what a runner profile must verify.
const CODE_EXT_RE =
  /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?|css|scss|sass|less|py|go|rs|java|rb|php|cs|cpp|cc|c|h|hpp|swift|kt|kts|dart|ex|exs|scala|clj|lua|sh)$/i;
// Unit/spec files are logic, not a rendered view — and they ARE the test.
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/i;
// concept artifacts — generated analysis pages, NOT product UI.
const CONCEPT_RE = /(^|\/)docs\/concepts\//i;

/**
 * Compile project-configured carve-out patterns (no-runtime static paths that
 * must never trip the V&V gate — same effect as the built-in docs/concepts/
 * carve-out) into regexes. Supported pattern forms, matched at any path-segment
 * boundary of the (slash-normalized) file path:
 *   "ideas"        → the directory and everything below it
 *   "ideas/"       → same
 *   "ideas/**"     → same (explicit glob)
 *   "drafts/*.html"→ direct children of drafts/ with .html extension
 * `*` stays within one segment, `**` crosses segments. Anything that is not a
 * non-empty string is skipped; a non-array input yields no carve-outs.
 *
 * @param {string[]} patterns
 * @returns {RegExp[]}
 */
function compileCarveOuts(patterns) {
  if (!Array.isArray(patterns)) return [];
  const out = [];
  for (const raw of patterns) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    // Bare dir / trailing slash → whole subtree.
    if (p.endsWith('/')) p += '**';
    else if (!/[*.]/.test(p.split('/').pop())) p += '/**';
    // Split on '**' first so single-star handling cannot touch it: each
    // segment gets regex-escaped and '*' becomes one-path-segment, then the
    // segments are joined with the cross-segment '.*'.
    const rx = p
      .split('**')
      .map(seg => seg.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('.*');
    try {
      out.push(new RegExp('(^|/)' + rx + '$', 'i'));
    } catch { /* skip unparsable pattern */ }
  }
  return out;
}

/**
 * Extract + compile carve-outs from a parsed test-plan profile object
 * (field `no_runtime_static_paths`). Malformed input → [].
 * @param {*} profileJson
 * @returns {RegExp[]}
 */
function carveOutsFromProfile(profileJson) {
  if (!profileJson || typeof profileJson !== 'object') return [];
  return compileCarveOuts(profileJson.no_runtime_static_paths);
}

/**
 * Is the path inside any configured carve-out?
 * @param {string} normalizedPath — forward-slash path
 * @param {RegExp[]} [carveOuts]
 * @returns {boolean}
 */
function isCarvedOut(normalizedPath, carveOuts) {
  if (!Array.isArray(carveOuts) || carveOuts.length === 0) return false;
  return carveOuts.some(re => re.test(normalizedPath));
}

/** Max times the gate blocks for the same owed verification before yielding. */
const BLOCK_CAP = 2;

/**
 * Does a changed file require BROWSER verification (DOM surface)?
 * @param {string} filePath
 * @param {RegExp[]} [carveOuts] — compiled project carve-outs (compileCarveOuts)
 * @returns {boolean}
 */
function isWebRenderableChange(filePath, carveOuts) {
  if (!filePath) return false;
  const p = String(filePath).replace(/\\/g, '/');
  if (CONCEPT_RE.test(p)) return false;     // concept carve-out
  if (isCarvedOut(p, carveOuts)) return false; // project no-runtime carve-out
  if (TEST_FILE_RE.test(p)) return false;   // *.test / *.spec — not a view
  if (ALWAYS_WEB_RE.test(p)) return true;   // html/css/vue/svelte/astro/tsx/jsx
  if (SCRIPT_RE.test(p) && UI_DIR_RE.test(p)) return true; // src/-scoped ts/js
  return false;
}

/**
 * Is the change a source-code file that warrants Light verification at all?
 * Excludes docs, config, lockfiles, images (not in CODE_EXT), plus the concept
 * carve-out and *.test/*.spec files. This is the Option-A scope: pure
 * doc/markdown/config edits never trigger the gate.
 *
 * @param {string} filePath
 * @param {RegExp[]} [carveOuts] — compiled project carve-outs (compileCarveOuts)
 * @returns {boolean}
 */
function isCodeChange(filePath, carveOuts) {
  if (!filePath) return false;
  const p = String(filePath).replace(/\\/g, '/');
  if (CONCEPT_RE.test(p)) return false;
  if (isCarvedOut(p, carveOuts)) return false;
  if (TEST_FILE_RE.test(p)) return false;
  return CODE_EXT_RE.test(p);
}

// ---------------------------------------------------------------------------
// Profile classification — which Light check does this profile require?
// ---------------------------------------------------------------------------

/**
 * Map a $TEST_PROFILE name to the kind of Light verification it needs.
 *   'dom'    → browser snapshot (web / electron renderer / tauri / pwa)
 *   'runner' → test suite (cli, lib, generic, backend, language runtimes)
 *   'any'    → unknown / unpinned → either satisfies
 * @param {string} name
 * @returns {'dom'|'runner'|'any'}
 */
function classifyProfile(name) {
  const p = String(name || '').toLowerCase();
  if (!p) return 'any';
  if (/(^|[-_])?(web|angular|vite|electron|tauri|renderer|pwa|svelte|nuxt|next|capacitor|cordova|ionic)/.test(p)) {
    return 'dom';
  }
  if (/(^|[-_])?(cli|lib|node|generic|api|backend|service|worker|python|go|rust|java)/.test(p)) {
    return 'runner';
  }
  return 'any';
}

/**
 * Does this file change make a Light verification pending, given the profile?
 * @param {'dom'|'runner'|'any'} profileClass
 * @param {string} filePath
 * @param {RegExp[]} [carveOuts] — compiled project carve-outs (compileCarveOuts)
 * @returns {boolean}
 */
function needsLightVerification(profileClass, filePath, carveOuts) {
  if (profileClass === 'dom') return isWebRenderableChange(filePath, carveOuts);
  return isCodeChange(filePath, carveOuts); // 'runner' and 'any' → any source file
}

// ---------------------------------------------------------------------------
// Verification detection (tool_name / command as reported by PostToolUse)
// ---------------------------------------------------------------------------

const BROWSER_MCP_RE =
  /^mcp__(Claude_in_Chrome__|Claude_Preview__preview_|plugin_playwright_playwright__browser_)/;
const BROWSER_SHORT_RE =
  /^(preview_(snapshot|screenshot|eval|click|fill|console_logs|inspect|navigate|start|logs|network)|browser_(navigate|snapshot|take_screenshot|click|evaluate|console_messages|network_requests|type|fill_form|wait_for))/;

/**
 * Did a browser tool run? Any Chrome-MCP / Playwright / Preview call counts.
 * @param {string} toolName
 * @returns {boolean}
 */
function isBrowserTool(toolName) {
  if (!toolName) return false;
  const t = String(toolName);
  return BROWSER_MCP_RE.test(t) || BROWSER_SHORT_RE.test(t);
}

// Test-runner invocations in a Bash command. Anchored so "npm install" etc. do
// not match; "npm run test:unit" matches via the word boundary after "test".
const TEST_RUNNER_RE =
  /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|\bnpm\s+t\b|\b(vitest|jest|mocha|ava|jasmine|pytest|rspec|phpunit|nose2)\b|\bpython\s+-m\s+(pytest|unittest)\b|\bgo\s+test\b|\bcargo\s+test\b|\bdotnet\s+test\b|\b(mvn|gradle|gradlew)\s+(test|verify|check)\b|\bnpx\s+(vitest|jest|mocha|playwright\s+test)\b|\bplaywright\s+test\b/i;

/**
 * Did a test runner run? Only shell tools count (Bash on *nix, PowerShell on
 * Windows — this plugin targets Windows, so both must be recognised).
 * @param {string} toolName
 * @param {string} command — hook.tool_input.command
 * @returns {boolean}
 */
function isTestRunnerTool(toolName, command) {
  if (toolName !== 'Bash' && toolName !== 'PowerShell') return false;
  if (!command) return false;
  return TEST_RUNNER_RE.test(String(command));
}

/**
 * Did an appropriate Light verification run for this profile class?
 * NOTE: this only answers "did the right KIND of tool run". Whether a test run
 * actually PASSED is a separate question — see testRunOutcome / Kern ②. The
 * writer (post.flow.completion) combines both: it only sets the verified flag
 * for a runner check when the run also passed.
 * @param {'dom'|'runner'|'any'} profileClass
 * @param {string} toolName
 * @param {string} [command]
 * @returns {boolean}
 */
function isLightVerification(profileClass, toolName, command) {
  const browser = isBrowserTool(toolName);
  const runner = isTestRunnerTool(toolName, command);
  if (profileClass === 'dom') return browser;
  if (profileClass === 'runner') return runner;
  return browser || runner; // 'any'
}

// ---------------------------------------------------------------------------
// Run outcome — best-effort pass/fail of a test run (Kern ②)
// ---------------------------------------------------------------------------

// Strong, unambiguous failure signals in test-runner output. Conservative on
// purpose: anything not matching stays a pass, so a green run we cannot parse is
// never falsely blocked. Only obvious red runs are caught.
const FAIL_TEXT_RE =
  /\b\d+\s+fail(?:ed|ing|ures?)\b|\bFAIL\b|✗|✖|\bfailures=[1-9]\b|\bAssertionError\b|\bFAILURES!\b|\bFAILED\s*\(/i;
// Counter-signal: "0 failed" / "0 failures" / "failures=0" must NOT count.
const ZERO_FAIL_RE = /\b0\s+fail(?:ed|ures?)\b|\bfailures=0\b/i;

/**
 * Pull a usable text blob + numeric exit hint out of a PostToolUse tool_response,
 * whose exact shape varies by Claude Code version. Defensive on every field.
 * @param {*} toolResponse
 * @returns {{ text: string, exitCode: (number|null), interrupted: boolean }}
 */
function normalizeToolResponse(toolResponse) {
  let text = '';
  let exitCode = null;
  let interrupted = false;
  if (toolResponse == null) return { text, exitCode, interrupted };
  if (typeof toolResponse === 'string') return { text: toolResponse, exitCode, interrupted };
  if (typeof toolResponse === 'object') {
    const r = toolResponse;
    for (const k of ['exit_code', 'exitCode', 'code', 'returnCode', 'status']) {
      if (typeof r[k] === 'number') { exitCode = r[k]; break; }
    }
    if (r.interrupted === true) interrupted = true;
    for (const k of ['stdout', 'stderr', 'output', 'text', 'result']) {
      if (typeof r[k] === 'string') text += '\n' + r[k];
    }
    // content may be a plain string or an array of { type, text } blocks.
    if (typeof r.content === 'string') text += '\n' + r.content;
    if (Array.isArray(r.content)) {
      for (const b of r.content) {
        if (b && typeof b.text === 'string') text += '\n' + b.text;
      }
    }
    if (!text) { try { text = JSON.stringify(r); } catch { /* ignore */ } }
  }
  return { text, exitCode, interrupted };
}

/**
 * Best-effort outcome of a test run from its PostToolUse response.
 * 'fail' only on strong signals (numeric non-zero exit, interrupted, or an
 * unambiguous failure summary). Everything else → 'pass', so a green run we
 * cannot parse is never falsely blocked. A zero exit code is authoritative.
 * @param {*} toolResponse
 * @returns {'pass'|'fail'}
 */
function testRunOutcome(toolResponse) {
  const { text, exitCode, interrupted } = normalizeToolResponse(toolResponse);
  if (typeof exitCode === 'number') return exitCode === 0 ? 'pass' : 'fail';
  if (interrupted) return 'fail';
  if (text && FAIL_TEXT_RE.test(text) && !ZERO_FAIL_RE.test(text)) return 'fail';
  return 'pass';
}

// ---------------------------------------------------------------------------
// Explicit skip token (Escalation)
// ---------------------------------------------------------------------------

// Claude must write this token (with a reason) to consciously skip verification
// before the block cap is reached — e.g. genuinely no startable surface here.
const SKIP_TOKEN_RE = /\bSKIP[- ]?VERIFICATION\b\s*[-:]\s*\S/i;

/**
 * Did the response contain an explicit, reasoned skip token?
 * @param {string} text — last assistant message text
 * @returns {boolean}
 */
function hasSkipJustification(text) {
  if (!text) return false;
  return SKIP_TOKEN_RE.test(String(text));
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * Decide whether the Stop hook should block to force a Light verification.
 *
 * @param {object} s
 * @param {boolean} s.pending        — a code file changed, Light check still owed
 * @param {boolean} s.verified       — a matching Light verification ran AND passed
 * @param {boolean} [s.red]          — a test ran this turn but FAILED (enriches reason)
 * @param {boolean} s.stopHookActive — prior Stop hook already blocked this cycle
 * @param {boolean} [s.silent]       — background tick (cron / autonomous loop)
 * @param {'dom'|'runner'|'any'} [s.kind] — required verification kind (for reason)
 * @param {number}  [s.blockCount]   — how many times this gate already blocked
 * @param {boolean} [s.skipJustified]— response carries an explicit SKIP-VERIFICATION token
 * @returns {{ action:'block'|'pass', resetFlags:boolean, reason?:string,
 *            incrementBlock?:boolean, markSkipped?:boolean }}
 */
function decideLightTest({
  pending, verified, red, stopHookActive, silent, kind,
  blockCount = 0, skipJustified = false,
}) {
  if (silent) {
    // Background tick — never enforce. Clear our own flags so the next real
    // turn starts clean. (The silent flag itself is owned by stop.flow.guard.)
    return { action: 'pass', resetFlags: true };
  }

  const owed = pending && !verified;
  if (!owed) {
    // Verification satisfied (or nothing owed) — pass and clear gate flags.
    return { action: 'pass', resetFlags: true };
  }

  // --- verification is still owed ---

  if (skipJustified) {
    // Conscious, reasoned skip — yield and record it so the card stays honest.
    return { action: 'pass', resetFlags: true, markSkipped: true };
  }

  if (blockCount >= BLOCK_CAP) {
    // Hard cap reached — never wedge the session. Yield, but record the skip.
    return { action: 'pass', resetFlags: true, markSkipped: true };
  }

  if (stopHookActive && blockCount === 0) {
    // Safety net: a Stop is already active but our counter never advanced
    // (flag write failed). Degrade to the legacy one-block behaviour rather
    // than risk a loop — yield and record the skip.
    return { action: 'pass', resetFlags: true, markSkipped: true };
  }

  return {
    action: 'block',
    resetFlags: false,
    incrementBlock: true,
    reason: buildLightTestReason(kind, { escalated: blockCount >= 1, red: red === true }),
  };
}

// ---------------------------------------------------------------------------
// Reason text
// ---------------------------------------------------------------------------

function escFooter(escalated) {
  const lead = escalated
    ? [
        '',
        'ESCALATED — this gate already asked once. It blocks up to ' + BLOCK_CAP +
          ' times, then yields.',
      ]
    : [];
  return lead.concat([
    '',
    'A subagent delegation does NOT satisfy this gate — verification must be',
    'observable in THIS thread (a browser or test-runner tool call). If a subagent',
    'did the testing, re-run a quick observable check or surface its evidence.',
    '',
    'Auto-excluded: docs/markdown/config edits, *.test/*.spec files,',
    'concept pages under docs/concepts/*.html, and any path listed in',
    'no_runtime_static_paths of .claude/skills/devops-test-plan/profile.json.',
    '',
    'To CONSCIOUSLY skip (genuinely no startable surface / non-runtime change):',
    'put a line `SKIP-VERIFICATION: <one-line reason>` in your response. The skip',
    'is then recorded and shown on the completion card as ⚠ UNVERIFIED — it is not',
    'silent. Without that token the gate keeps blocking until it yields after ' +
      BLOCK_CAP + ' blocks.',
  ]);
}

function domReason() {
  return [
    '[stop.flow.browsertest] Web-renderable changes were made but no browser verification ran this session.',
    '',
    'Per deep-knowledge/test-autonomy.md (DOM surface → Light = browser snapshot)',
    'this is mandatory for web tech. Do this FIRST, before the completion card:',
    '',
    '1. Make the changed view reachable: dev server (npm run dev) or a file:// URL in Edge.',
    '2. Verify via Chrome-MCP (Edge) when the extension is connected; otherwise via',
    '   Claude Preview (PRIMARY for the localhost app), then Playwright. Never plain Chrome,',
    '   never computer-use for browser work (see browser-tool-strategy.md).',
    '3. Snapshot the DOM (read_page / browser_snapshot / preview_snapshot) AND read',
    '   console + network errors (read_console_messages + read_network_requests /',
    '   browser_console_messages + browser_network_requests / preview_console_logs).',
    '4. Mocks for missing backends are expected — exercise the changed view.',
  ];
}

function runnerReason(red) {
  const head = red
    ? [
        '[stop.flow.browsertest] A test ran this session but FAILED — a red run does not verify.',
        '',
        'Fix the failure, then re-run the suite green. Do this FIRST, before the completion card:',
      ]
    : [
        '[stop.flow.browsertest] Code changed but no passing test run was observed this session.',
        '',
        'Per deep-knowledge/test-autonomy.md (non-DOM surface → Light = run the test',
        'suite) this is mandatory. Do this FIRST, before the completion card:',
      ];
  return head.concat([
    '',
    '1. Run the project test suite: npm test (or vitest / jest / pytest / go test / …).',
    '2. The run must PASS — a failing run does not satisfy this gate.',
    '3. For a CLI, also exercise the changed command path once and read its output.',
  ]);
}

function anyReason() {
  return [
    '[stop.flow.browsertest] Code changed but no Light verification ran this session,',
    'and no $TEST_PROFILE is pinned.',
    '',
    'Do this FIRST, before the completion card:',
    '',
    '1. Follow deep-knowledge/test-plan.md to detect + pin the profile.',
    '2. Then run the matching Light check: a browser snapshot for a web/DOM surface,',
    '   or the test suite (npm test / pytest / …) otherwise — and it must pass.',
  ];
}

/**
 * Build the block reason for a given verification kind.
 * @param {'dom'|'runner'|'any'} [kind]
 * @param {{ escalated?: boolean, red?: boolean }} [opts]
 * @returns {string}
 */
function buildLightTestReason(kind, opts = {}) {
  let body;
  if (kind === 'dom') body = domReason();
  else if (kind === 'runner') body = runnerReason(opts.red === true);
  else body = anyReason();
  return body
    .concat(['', 'Then render the completion card as the LAST action.'], escFooter(opts.escalated === true))
    .join('\n');
}

module.exports = {
  BLOCK_CAP,
  isWebRenderableChange,
  isCodeChange,
  classifyProfile,
  compileCarveOuts,
  carveOutsFromProfile,
  needsLightVerification,
  isBrowserTool,
  isTestRunnerTool,
  isLightVerification,
  normalizeToolResponse,
  testRunOutcome,
  hasSkipJustification,
  decideLightTest,
  buildLightTestReason,
};
