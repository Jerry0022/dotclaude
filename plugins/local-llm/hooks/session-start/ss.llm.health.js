#!/usr/bin/env node
/**
 * @hook ss.llm.health
 * @version 0.2.0
 * @event SessionStart
 * @plugin local-llm
 * @description AnythingLLM health probe + non-blocking auto-setup.
 *
 *   State machine (first match wins):
 *     1. needs_api_key     — no API key in user config
 *     2. not_installed     — AnythingLLM binary not found on disk
 *     3. starting          — binary found, process absent or API not yet up;
 *                             launch detached, return immediately
 *     4. network_blocked   — process running but HTTP unreachable past timeout
 *     5. auth_failed       — /api/v1/auth returned 401/403
 *     6. configuring       — API reachable, workspace missing; create async
 *     7. ready             — API reachable, workspace present → tool enabled
 *
 *   The hook NEVER blocks the prompt for long-running work. Model loading,
 *   workspace creation, and first-time app launches run async in the
 *   background; the current session continues and picks up the new state on
 *   the next SessionStart.
 *
 *   Stdout → injected into Claude's context as system instructions.
 *   Stderr → shown collapsed under the hook output.
 */

'use strict';

require('../lib/plugin-guard');

const http = require('../lib/anythingllm-http');
const lifecycle = require('../lib/anythingllm-lifecycle');
const { resolveConfig, hasApiKey, USER_CONFIG_PATH } = require('../lib/anythingllm-config');

const CONFIG = resolveConfig();
const BASE_URL = CONFIG.anythingllm?.baseUrl || 'http://localhost:3001';
const WORKSPACE_SLUG = CONFIG.anythingllm?.workspaceSlug || 'claude-code';
const WORKSPACE_NAME = CONFIG.anythingllm?.workspaceName || 'Claude Code';
const AUTO_LAUNCH = CONFIG.anythingllm?.autoLaunch !== false;
const API_KEY = CONFIG.anythingllm?.apiKey || '';

function emit(phase, instructions) {
  process.stdout.write(`[local-llm] phase: ${phase}\n${instructions}\n`);
}

function disabledHint(reason) {
  return (
    `[local-llm] ${reason}\n` +
    `Delegation to local_generate is UNAVAILABLE this session. ` +
    `Continue normally — this does not block your current work.\n`
  );
}

function readyInstructions() {
  return (
    `[local-llm] Local LLM is ready via mcp__plugin_local-llm_dotclaude-local-llm__local_generate.\n` +
    `Backend: AnythingLLM @ ${BASE_URL}, workspace "${WORKSPACE_SLUG}".\n` +
    `\n` +
    `Quick rules — delegate to local_generate ONLY when ALL are true:\n` +
    `  1. Mechanical code generation (boilerplate, DTOs, test files, CRUD, type defs)\n` +
    `  2. Complete, unambiguous spec writable (signature + types + behavior)\n` +
    `  3. Output > 20 lines (below that, writing directly is faster)\n` +
    `  4. No cross-file reasoning, debugging, security, or architecture work\n` +
    `  5. Output will be reviewed before use\n` +
    `NEVER delegate complex reasoning, debugging, refactoring, or ambiguous tasks.\n`
  );
}

(async () => {
  if (!hasApiKey(CONFIG)) {
    emit('needs_api_key', disabledHint(
      `No AnythingLLM API key configured. Run the skill "local-llm-setup" to enter one. ` +
      `Key is saved to ${USER_CONFIG_PATH} (user-global, outside any git repo).`
    ));
    return;
  }

  const install = lifecycle.detectInstallation();
  const processRunning = lifecycle.isProcessRunning();
  const health = await http.checkHealth(BASE_URL);

  if (health.online) {
    const auth = await http.verifyAuth(BASE_URL, API_KEY);
    if (!auth.valid) {
      if (auth.errorType === 'auth_failed') {
        emit('auth_failed', disabledHint(
          `AnythingLLM rejected the API key (401/403). Run "local-llm-setup" to replace it.`
        ));
      } else {
        emit('network_blocked', disabledHint(
          `Auth probe failed: ${auth.error || auth.errorType}. Check AnythingLLM network settings.`
        ));
      }
      return;
    }

    const ws = await http.getWorkspaces(BASE_URL, API_KEY);
    if (!ws.ok) {
      emit('network_blocked', disabledHint(
        `Workspace list failed (status ${ws.status || 'n/a'}): ${ws.error || ws.errorType}`
      ));
      return;
    }

    const exists = ws.workspaces.some((w) => w.slug === WORKSPACE_SLUG);
    if (exists) {
      emit('ready', readyInstructions());
      return;
    }

    http.createWorkspace(BASE_URL, API_KEY, WORKSPACE_NAME).catch(() => { /* fire and forget */ });
    emit('configuring', disabledHint(
      `AnythingLLM is reachable but workspace "${WORKSPACE_SLUG}" is missing. ` +
      `Creation started in the background — available on next SessionStart.`
    ));
    return;
  }

  if (!install.installed) {
    emit('not_installed', disabledHint(
      `AnythingLLM Desktop is not installed. Download: ${lifecycle.DOWNLOAD_URL}\n` +
      `After install, start it once, generate an API key in Settings → Developer API, ` +
      `then run the skill "local-llm-setup".`
    ));
    return;
  }

  if (processRunning) {
    emit('network_blocked', disabledHint(
      `AnythingLLM process is running but /api/ping is unreachable at ${BASE_URL}. ` +
      `Enable network access in AnythingLLM Settings → API, or check the port.`
    ));
    return;
  }

  if (AUTO_LAUNCH) {
    const result = lifecycle.launch(install.path);
    if (result.ok) {
      emit('starting', disabledHint(
        `AnythingLLM was not running — launched detached (pid ${result.pid}). ` +
        `Available on next SessionStart once it has fully started.`
      ));
    } else {
      emit('not_running', disabledHint(
        `AnythingLLM is installed at ${install.path} but could not be launched: ${result.error}. ` +
        `Start it manually.`
      ));
    }
  } else {
    emit('not_running', disabledHint(
      `AnythingLLM is installed but not running, and autoLaunch is disabled. ` +
      `Start the app manually.`
    ));
  }
})();
