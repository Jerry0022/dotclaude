/**
 * @module anythingllm-http
 * @version 0.1.0
 * @plugin local-llm
 * @description Minimal HTTP client for AnythingLLM's REST API.
 *   CommonJS, Node builtins only. Consumed by both the SessionStart hook
 *   and the MCP server (via createRequire from ESM).
 *
 *   API endpoints:
 *     GET  /api/ping                         — no auth, health probe
 *     GET  /api/v1/auth                      — Bearer, validates the API key
 *     GET  /api/v1/workspaces                — Bearer, list workspaces
 *     POST /api/v1/workspace/new             — Bearer, create workspace
 *     POST /api/v1/openai/chat/completions   — Bearer, OpenAI-compat completion
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const HEALTH_TIMEOUT_MS = 2000;
const REQUEST_TIMEOUT_MS = 60_000;
const COMPLETION_TIMEOUT_MS = 120_000;

function requestJson({ baseUrl, path, method = 'GET', apiKey, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(path, baseUrl);
    } catch {
      resolve({ ok: false, errorType: 'bad_url', error: `Invalid URL: ${baseUrl}${path}` });
      return;
    }

    const payload = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, errorType: 'timeout', error: `Timeout after ${timeoutMs}ms` });
    });

    req.on('error', (err) => {
      const code = err.code || '';
      let errorType = 'network_unreachable';
      if (code === 'ECONNREFUSED') errorType = 'not_running';
      else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') errorType = 'host_not_found';
      else if (code === 'ETIMEDOUT') errorType = 'timeout';
      resolve({ ok: false, errorType, error: err.message });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function checkHealth(baseUrl) {
  const res = await requestJson({ baseUrl, path: '/api/ping', timeoutMs: HEALTH_TIMEOUT_MS });
  if (res.ok) return { online: true };
  return { online: false, errorType: res.errorType || 'unknown', error: res.error };
}

async function verifyAuth(baseUrl, apiKey) {
  if (!apiKey) return { valid: false, errorType: 'missing_api_key' };
  const res = await requestJson({ baseUrl, path: '/api/v1/auth', apiKey, timeoutMs: HEALTH_TIMEOUT_MS });
  if (res.ok) return { valid: true };
  if (res.status === 401 || res.status === 403) return { valid: false, errorType: 'auth_failed' };
  return { valid: false, errorType: res.errorType || 'unknown', error: res.error };
}

async function getWorkspaces(baseUrl, apiKey) {
  const res = await requestJson({ baseUrl, path: '/api/v1/workspaces', apiKey });
  if (!res.ok) return { ok: false, errorType: res.errorType || 'unknown', error: res.error, status: res.status };
  const list = Array.isArray(res.data?.workspaces) ? res.data.workspaces : [];
  return { ok: true, workspaces: list };
}

async function createWorkspace(baseUrl, apiKey, name) {
  const res = await requestJson({
    baseUrl,
    path: '/api/v1/workspace/new',
    method: 'POST',
    apiKey,
    body: { name },
  });
  if (!res.ok) return { ok: false, errorType: res.errorType || 'unknown', error: res.error, status: res.status };
  return { ok: true, workspace: res.data?.workspace || null };
}

async function chatCompletion(baseUrl, apiKey, { workspaceSlug, messages, temperature = 0.2, maxTokens = 4096 }) {
  const res = await requestJson({
    baseUrl,
    path: '/api/v1/openai/chat/completions',
    method: 'POST',
    apiKey,
    timeoutMs: COMPLETION_TIMEOUT_MS,
    body: {
      model: workspaceSlug,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    },
  });
  if (!res.ok) {
    return { ok: false, errorType: res.errorType || 'http_error', status: res.status, error: res.error || res.data };
  }
  const choice = res.data?.choices?.[0];
  return {
    ok: true,
    content: choice?.message?.content || '',
    finishReason: choice?.finish_reason || 'unknown',
    tokensUsed: res.data?.usage?.total_tokens ?? null,
  };
}

module.exports = {
  checkHealth,
  verifyAuth,
  getWorkspaces,
  createWorkspace,
  chatCompletion,
};
