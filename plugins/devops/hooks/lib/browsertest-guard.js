/**
 * @module browsertest-guard
 * @version 0.2.0
 * @description Pure decision logic for the Light-verification enforcement gate.
 *   Split out of stop.flow.browsertest.js so the rules can be unit-tested
 *   without mocking stdin or temp files.
 *
 *   The gate forces a Light verification whenever a CODE file changed in a
 *   session but the matching Light check never ran:
 *     - DOM-surface profiles (web-*, electron-ow, …) → a browser tool must run
 *       (Claude-in-Chrome in Edge / Playwright / Preview).
 *     - Runner profiles (cli-node, lib, generic, …) → a test runner must run
 *       (npm test / vitest / jest / pytest / go test / …).
 *     - Unknown / unpinned profile → either satisfies.
 *
 *   Per deep-knowledge/test-autonomy.md the Light check is mandatory and
 *   autonomous; Full (computer-use / packaged-app launch) stays opt-in and is
 *   NOT enforced here. Delegating to a subagent does NOT satisfy the gate —
 *   verification must be observable in the main thread (closed loophole).
 *
 *   Inputs: flag state (light-pending / light-verified / kind) + stop_hook_active
 *           + silent.
 *   Output: { action: 'block' | 'pass', reason?, resetFlags }.
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
// devops-concept artifacts — generated analysis pages, NOT product UI.
const CONCEPT_RE = /(^|\/)docs\/concepts\//i;

/**
 * Does a changed file require BROWSER verification (DOM surface)?
 * @param {string} filePath
 * @returns {boolean}
 */
function isWebRenderableChange(filePath) {
  if (!filePath) return false;
  const p = String(filePath).replace(/\\/g, '/');
  if (CONCEPT_RE.test(p)) return false;     // devops-concept carve-out
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
 * @returns {boolean}
 */
function isCodeChange(filePath) {
  if (!filePath) return false;
  const p = String(filePath).replace(/\\/g, '/');
  if (CONCEPT_RE.test(p)) return false;
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
 * @returns {boolean}
 */
function needsLightVerification(profileClass, filePath) {
  if (profileClass === 'dom') return isWebRenderableChange(filePath);
  return isCodeChange(filePath); // 'runner' and 'any' → any source file
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
// Decision
// ---------------------------------------------------------------------------

/**
 * Decide whether the Stop hook should block to force a Light verification.
 *
 * @param {object} s
 * @param {boolean} s.pending        — a code file changed, Light check still owed
 * @param {boolean} s.verified       — a matching Light verification ran
 * @param {boolean} s.stopHookActive — prior Stop hook already blocked this cycle
 * @param {boolean} [s.silent]       — background tick (cron / autonomous loop)
 * @param {'dom'|'runner'|'any'} [s.kind] — required verification kind (for reason)
 * @returns {{ action: 'block' | 'pass', resetFlags: boolean, reason?: string }}
 */
function decideLightTest({ pending, verified, stopHookActive, silent, kind }) {
  if (silent) {
    // Background tick — never enforce. Clear our own flags so the next real
    // turn starts clean. (The silent flag itself is owned by stop.flow.guard.)
    return { action: 'pass', resetFlags: true };
  }

  if (stopHookActive) {
    // One-time bypass: if Claude stops again after being blocked, yield and
    // clear the pending flag so we never loop.
    return { action: 'pass', resetFlags: true };
  }

  if (pending && !verified) {
    return { action: 'block', resetFlags: false, reason: buildLightTestReason(kind) };
  }

  return { action: 'pass', resetFlags: true };
}

// ---------------------------------------------------------------------------
// Reason text
// ---------------------------------------------------------------------------

const FOOTER = [
  '',
  'A subagent delegation does NOT satisfy this gate — verification must be',
  'observable in THIS thread (a browser or test-runner tool call). If a subagent',
  'did the testing, re-run a quick observable check or surface its evidence.',
  '',
  'Auto-excluded: docs/markdown/config edits, *.test/*.spec files, and',
  'devops-concept pages under docs/concepts/*.html. To intentionally skip',
  '(non-runtime change, no startable surface): stop again — this gate yields',
  'after one block.',
];

function domReason() {
  return [
    '[stop.flow.browsertest] Web-renderable changes were made but no browser verification ran this session.',
    '',
    'Per deep-knowledge/test-autonomy.md (DOM surface → Light = browser snapshot)',
    'this is mandatory for web tech. Do this FIRST, before the completion card:',
    '',
    '1. Make the changed view reachable: dev server (npm run dev) or a file:// URL in Edge.',
    '2. Verify via the Claude-in-Chrome extension in Edge (PRIMARY). Fall back to',
    '   Playwright → Preview only if the extension is not connected. Never plain Chrome,',
    '   never computer-use for browser work (see browser-tool-strategy.md).',
    '3. Snapshot the DOM (read_page / browser_snapshot / preview_snapshot) AND read',
    '   console + network errors (read_console_messages + read_network_requests /',
    '   browser_console_messages + browser_network_requests / preview_console_logs).',
    '4. Mocks for missing backends are expected — exercise the changed view.',
  ];
}

function runnerReason() {
  return [
    '[stop.flow.browsertest] Code changed but no test run was observed this session.',
    '',
    'Per deep-knowledge/test-autonomy.md (non-DOM surface → Light = run the test',
    'suite) this is mandatory. Do this FIRST, before the completion card:',
    '',
    '1. Run the project test suite: npm test (or vitest / jest / pytest / go test / …).',
    '2. For a CLI, also exercise the changed command path once and read its output.',
    '3. Fix failures before finishing.',
  ];
}

function anyReason() {
  return [
    '[stop.flow.browsertest] Code changed but no Light verification ran this session,',
    'and no $TEST_PROFILE is pinned.',
    '',
    'Do this FIRST, before the completion card:',
    '',
    '1. Invoke /devops-test-plan to pin the profile.',
    '2. Then run the matching Light check: a browser snapshot for a web/DOM surface,',
    '   or the test suite (npm test / pytest / …) otherwise.',
  ];
}

/**
 * Build the block reason for a given verification kind.
 * @param {'dom'|'runner'|'any'} [kind]
 * @returns {string}
 */
function buildLightTestReason(kind) {
  let body;
  if (kind === 'dom') body = domReason();
  else if (kind === 'runner') body = runnerReason();
  else body = anyReason();
  return body.concat(['', 'Then render the completion card as the LAST action.'], FOOTER).join('\n');
}

module.exports = {
  isWebRenderableChange,
  isCodeChange,
  classifyProfile,
  needsLightVerification,
  isBrowserTool,
  isTestRunnerTool,
  isLightVerification,
  decideLightTest,
  buildLightTestReason,
};
