#!/usr/bin/env node
/**
 * @script check-local-llm
 * @version 0.1.0
 * @plugin devops
 * @description Single-call status probe for the local-llm plugin. Prints
 *   one JSON line to stdout so implementation agents can decide whether
 *   to delegate mechanical code generation.
 *
 *   Output shapes (stdout, single line):
 *     {"ready":true,"tool":"local_generate","workspace":"<slug>"}
 *     {"ready":false,"phase":"needs_api_key"|"not_installed"|...,"hint":"..."}
 *     {"ready":false,"phase":"error","hint":"..."}
 *
 *   The result is cached on disk for 30 seconds so parallel agents hitting
 *   this script do not all probe AnythingLLM simultaneously. Cache path:
 *   <tmpdir>/dotclaude-local-llm-check.json
 *
 *   Exit code is always 0 — agents rely on the JSON, not the exit code.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CACHE_PATH = path.join(os.tmpdir(), 'dotclaude-local-llm-check.json');
const CACHE_TTL_MS = 30_000;

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj.ts === 'number' && Date.now() - obj.ts < CACHE_TTL_MS && obj.result) {
      return obj.result;
    }
  } catch { /* miss */ }
  return null;
}

function writeCache(result) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), result }), 'utf8');
  } catch { /* ignore */ }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(0);
}

(async () => {
  const cached = readCache();
  if (cached) emit(cached);

  const libDir = resolveLocalLlmLib();
  if (!libDir) {
    const result = { ready: false, phase: 'not_installed', hint: 'local-llm plugin not found on disk.' };
    writeCache(result);
    emit(result);
  }

  let http, config;
  try {
    http = require(path.join(libDir, 'anythingllm-http.js'));
    config = require(path.join(libDir, 'anythingllm-config.js'));
  } catch (err) {
    const result = { ready: false, phase: 'error', hint: `local-llm lib load failed: ${err.message}` };
    writeCache(result);
    emit(result);
  }

  const cfg = config.resolveConfig();
  if (!config.hasApiKey(cfg)) {
    const result = { ready: false, phase: 'needs_api_key', hint: 'Run the local-llm-setup skill.' };
    writeCache(result);
    emit(result);
  }

  const baseUrl = cfg.anythingllm?.baseUrl || 'http://localhost:3001';
  const workspaceSlug = cfg.anythingllm?.workspaceSlug || 'claude-code';
  const apiKey = cfg.anythingllm?.apiKey;

  const health = await http.checkHealth(baseUrl);
  if (!health.online) {
    const result = { ready: false, phase: health.errorType === 'not_running' ? 'not_running' : 'network_blocked', hint: `AnythingLLM at ${baseUrl} not reachable: ${health.errorType}` };
    writeCache(result);
    emit(result);
  }

  const auth = await http.verifyAuth(baseUrl, apiKey);
  if (!auth.valid) {
    const result = { ready: false, phase: auth.errorType === 'auth_failed' ? 'auth_failed' : 'network_blocked', hint: `AnythingLLM auth failed: ${auth.error || auth.errorType}` };
    writeCache(result);
    emit(result);
  }

  const ws = await http.getWorkspaces(baseUrl, apiKey);
  if (!ws.ok) {
    const result = { ready: false, phase: 'network_blocked', hint: `Workspace list failed: ${ws.error || ws.errorType}` };
    writeCache(result);
    emit(result);
  }

  const exists = ws.workspaces.some((w) => w.slug === workspaceSlug);
  if (!exists) {
    const result = { ready: false, phase: 'configuring', hint: `Workspace "${workspaceSlug}" missing. Will auto-create on next SessionStart.` };
    writeCache(result);
    emit(result);
  }

  const result = { ready: true, tool: 'local_generate', workspace: workspaceSlug };
  writeCache(result);
  emit(result);
})().catch((err) => {
  emit({ ready: false, phase: 'error', hint: err.message });
});

function resolveLocalLlmLib() {
  const sourceRepo = path.resolve(__dirname, '..', '..', 'local-llm', 'hooks', 'lib');
  if (fs.existsSync(path.join(sourceRepo, 'anythingllm-http.js'))) return sourceRepo;

  const installedRoot = path.resolve(os.homedir(), '.claude', 'plugins', 'cache', 'dotclaude', 'local-llm');
  if (!fs.existsSync(installedRoot)) return null;

  try {
    const versions = fs.readdirSync(installedRoot).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
    versions.sort((a, b) => {
      const [a1, a2, a3] = a.split('.').map(Number);
      const [b1, b2, b3] = b.split('.').map(Number);
      return (b1 - a1) || (b2 - a2) || (b3 - a3);
    });
    for (const v of versions) {
      const libDir = path.join(installedRoot, v, 'hooks', 'lib');
      if (fs.existsSync(path.join(libDir, 'anythingllm-http.js'))) return libDir;
    }
  } catch { /* ignore */ }
  return null;
}
