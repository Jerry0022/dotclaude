/**
 * @module browsertest-guard
 * @version 0.1.0
 * @description Pure decision logic for the browser-test enforcement gate.
 *   Split out of stop.flow.browsertest.js so the rules can be unit-tested
 *   without mocking stdin or temp files.
 *
 *   The gate forces a browser verification whenever browser-renderable files
 *   changed in a session but no browser tool ran and no verification subagent
 *   was delegated. It mirrors card-guard's block/pass/reset contract.
 *
 *   Inputs: flag state (web-change-pending / browser-verified) + stop_hook_active
 *           + silent.
 *   Output: { action: 'block' | 'pass', reason?, resetFlags }.
 */

// ---------------------------------------------------------------------------
// Web-renderable change detection
// ---------------------------------------------------------------------------

// Markup / style / framework-component files are ALWAYS browser-renderable.
const ALWAYS_WEB_RE = /\.(html?|css|scss|sass|less|vue|svelte|astro|tsx|jsx)$/i;
// Bare scripts count only when they live under a UI source directory.
const SCRIPT_RE = /\.(ts|js|mjs|cjs)$/i;
const UI_DIR_RE = /(^|\/)(src|app|components|pages|views|renderer)\//i;
// Unit/spec files are logic, not a rendered view.
const TEST_FILE_RE = /\.(test|spec)\.[tj]sx?$/i;
// devops-concept artifacts — generated analysis pages, NOT product UI.
// Carve-out per project decision: concept pages never trigger the gate.
const CONCEPT_RE = /(^|\/)docs\/concepts\//i;

/**
 * Does a changed file require browser verification?
 * Normalizes Windows backslashes so a single forward-slash regex set works.
 *
 * @param {string} filePath — path from the Edit/Write tool_input.file_path
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

// ---------------------------------------------------------------------------
// Browser-tool detection (tool_name as reported by PostToolUse)
// ---------------------------------------------------------------------------

const BROWSER_MCP_RE =
  /^mcp__(Claude_in_Chrome__|Claude_Preview__preview_|plugin_playwright_playwright__browser_)/;
// Short-name fallbacks, in case the runtime ever reports the suffix form.
const BROWSER_SHORT_RE =
  /^(preview_(snapshot|screenshot|eval|click|fill|console_logs|inspect|navigate|start|logs|network)|browser_(navigate|snapshot|take_screenshot|click|evaluate|console_messages|network_requests|type|fill_form|wait_for))/;

/**
 * Did a browser tool run? Any Chrome-MCP / Playwright / Preview call counts —
 * if Claude touched the page at all, it verified in a real browser engine.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
function isBrowserTool(toolName) {
  if (!toolName) return false;
  const t = String(toolName);
  return BROWSER_MCP_RE.test(t) || BROWSER_SHORT_RE.test(t);
}

// Subagents that perform their own browser verification. When one is delegated
// we assume the browser check is covered (the main thread cannot observe the
// subagent's inner tool calls).
const VERIFY_AGENTS = new Set(['qa', 'frontend', 'feature', 'gamer', 'designer']);

/**
 * Was browser verification delegated to a verification-capable subagent?
 *
 * @param {string} toolName     — 'Agent' for a subagent spawn
 * @param {string} subagentType — opts.subagent_type from the Agent call
 * @returns {boolean}
 */
function isVerificationDelegation(toolName, subagentType) {
  return toolName === 'Agent' && VERIFY_AGENTS.has(String(subagentType || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * Decide whether the Stop hook should block to force a browser verification.
 *
 * @param {object} s
 * @param {boolean} s.webChangePending — a web-renderable file changed, unverified
 * @param {boolean} s.browserVerified  — a browser tool ran / verify subagent ran
 * @param {boolean} s.stopHookActive   — prior Stop hook already blocked this cycle
 * @param {boolean} [s.silent]         — background tick (cron / autonomous loop)
 * @returns {{ action: 'block' | 'pass', resetFlags: boolean, reason?: string }}
 */
function decideBrowserTest({ webChangePending, browserVerified, stopHookActive, silent }) {
  if (silent) {
    // Background tick — never enforce. Clear our own flags so the next real
    // turn starts clean. (The silent flag itself is owned by stop.flow.guard.)
    return { action: 'pass', resetFlags: true };
  }

  if (stopHookActive) {
    // One-time bypass: if Claude stops again after being blocked, yield and
    // clear the pending flag so we never loop. Mirrors card-guard.
    return { action: 'pass', resetFlags: true };
  }

  if (webChangePending && !browserVerified) {
    return { action: 'block', resetFlags: false, reason: buildBrowserTestReason() };
  }

  return { action: 'pass', resetFlags: true };
}

function buildBrowserTestReason() {
  return [
    '[stop.flow.browsertest] Web-renderable changes were made but no browser verification ran this session.',
    '',
    'Per deep-knowledge/test-strategy.md (Web Tech → Always Browser-Test) this is',
    'mandatory — there is no "browser not needed" exit for web tech. Do this FIRST,',
    'before rendering the completion card:',
    '',
    '1. Make the changed view reachable: dev server (npm run dev) or open the',
    '   file:// URL in Edge for a static page.',
    '2. Verify it via the Claude-in-Chrome extension in Edge (PRIMARY). Fall back to',
    '   Playwright → Preview only if the extension is not connected. Never plain',
    '   Chrome, never computer-use for browser work (see browser-tool-strategy.md).',
    '3. Snapshot the DOM (read_page / browser_snapshot / preview_snapshot) AND read',
    '   console + network errors (read_console_messages + read_network_requests /',
    '   browser_console_messages + browser_network_requests / preview_console_logs).',
    '4. Mocks for missing backends are expected — exercise the changed view, do not',
    '   hit production services.',
    '',
    'Then render the completion card as the LAST action.',
    '',
    'devops-concept pages under docs/concepts/*.html are auto-excluded and never',
    'trigger this gate. To intentionally skip (e.g. non-runtime change with no',
    'startable view): stop again — this gate yields after one block.',
  ].join('\n');
}

module.exports = {
  isWebRenderableChange,
  isBrowserTool,
  isVerificationDelegation,
  decideBrowserTest,
  buildBrowserTestReason,
  VERIFY_AGENTS,
};
