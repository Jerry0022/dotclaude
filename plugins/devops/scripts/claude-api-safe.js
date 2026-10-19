#!/usr/bin/env node
'use strict';
/**
 * @script claude-api-safe
 * @version 0.2.0
 * @plugin devops
 * @description Opt-in, hard-timeout wrapper that runs ONE advisory prompt on
 *   the Claude API (Messages API) with the API key of the user's linked Claude
 *   Console org — so it draws on the monthly API credit of a Max/Team plan
 *   instead of the plan's usage limits. The counterpart of codex-safe.sh:
 *   same exit-code contract, same "never block the workflow" rule.
 *
 *   Claude Code itself is never touched: the key lives in its own variable
 *   (DEVOPS_ANTHROPIC_API_KEY, env or ~/.claude/devops-api.env) and is passed
 *   only to this process's HTTPS request. ANTHROPIC_API_KEY is never read or
 *   written — exporting that would flip the whole session onto API billing,
 *   which the credit does not cover ("Credit balance too low").
 *
 *   Runbook: deep-knowledge/api-credits.md.
 *
 * Usage:
 *   claude-api-safe.js "<prompt>"
 *   echo "$PROMPT" | claude-api-safe.js -
 *   claude-api-safe.js --model claude-sonnet-5-5 --max-tokens 4000 "<prompt>"
 *   claude-api-safe.js --status        effective switches + key presence (never the key)
 *   claude-api-safe.js --reset-limit   forget a stored "credit exhausted" marker
 *
 * Environment:
 *   CLAUDE_API_SAFE_TIMEOUT   seconds (default 180)
 *   CLAUDE_API_SAFE_MODEL     model id (default claude-opus-5-5)
 *   DEVOPS_DISABLE_CLAUDE_API "1" → skip (exit 126) whatever the config says
 *   DEVOPS_ANTHROPIC_API_KEY  the key (else read from ~/.claude/devops-api.env)
 *
 * Exit codes:
 *   0    result text on stdout
 *   75   credit exhausted / workspace spend limit reached — stored, later
 *        calls skip at once until the marker expires; continue on the plan
 *   124  timeout — continue without the result
 *   126  disabled (apiCredit.enabled false, or DEVOPS_DISABLE_CLAUDE_API=1)
 *   127  no key stored — continue; offer the web guide (apiCredit.webGuide)
 *   1    any other error (invalid key, network, API error) — stderr, continue
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY_VAR = 'DEVOPS_ANTHROPIC_API_KEY';
const ENV_FILE = 'devops-api.env';
const LIMIT_FILE = 'claude-api-limit.json';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_TIMEOUT_S = 180;
const DEFAULT_MAX_TOKENS = 8000;
// Credits refresh per billing cycle, whose date we do not know — retry after
// half a day instead of hammering an empty balance on every call.
const LIMIT_TTL_MS = 12 * 60 * 60 * 1000;

const RC = Object.freeze({ OK: 0, ERROR: 1, LIMIT: 75, TIMEOUT: 124, DISABLED: 126, NO_KEY: 127 });

// "Your credit balance is too low to access the Anthropic API" and the
// workspace spend-limit 400 ("You have reached your specified workspace API
// usage limits") — both mean: no credit left for this caller.
const LIMIT_RE = /credit balance is too low|usage limits|spend limit/i;

function claudeDir(home) {
  return path.join(home || os.homedir(), '.claude');
}

/** Parse KEY=value lines of a dotenv-style file (quotes stripped). */
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/**
 * The API key and where it came from, or null. Only DEVOPS_ANTHROPIC_API_KEY
 * counts — never ANTHROPIC_API_KEY.
 * @returns {{key:string, source:'env'|'file'}|null}
 */
function resolveKey({ env = process.env, home } = {}) {
  if (env[KEY_VAR] && env[KEY_VAR].trim()) return { key: env[KEY_VAR].trim(), source: 'env' };
  try {
    const parsed = parseEnvFile(fs.readFileSync(path.join(claudeDir(home), ENV_FILE), 'utf8'));
    if (parsed[KEY_VAR] && parsed[KEY_VAR].trim()) return { key: parsed[KEY_VAR].trim(), source: 'file' };
  } catch { /* no file */ }
  return null;
}

/** Effective apiCredit switches for `cwd` (project > global > default). */
function loadSwitches({ cwd, home } = {}) {
  try {
    const cfg = require('../hooks/lib/devops-config');
    const { values } = cfg.load(cwd || process.cwd(), home ? { home } : {});
    return { enabled: values.apiCredit.enabled === true, webGuide: values.apiCredit.webGuide === true };
  } catch {
    return { enabled: false, webGuide: false };
  }
}

function limitPath(home) {
  return path.join(claudeDir(home), LIMIT_FILE);
}

/** ISO time until which calls are skipped, or null. Expired markers are removed. */
function activeLimit({ home, now = Date.now() } = {}) {
  const file = limitPath(home);
  try {
    const { until } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (until && Date.parse(until) > now) return until;
    fs.rmSync(file, { force: true });
  } catch { /* none */ }
  return null;
}

function storeLimit({ home, now = Date.now(), reason = '' } = {}) {
  const until = new Date(now + LIMIT_TTL_MS).toISOString();
  try {
    fs.mkdirSync(claudeDir(home), { recursive: true });
    fs.writeFileSync(limitPath(home), JSON.stringify({ until, reason: String(reason).slice(0, 200) }) + '\n');
  } catch { /* best effort */ }
  return until;
}

function resetLimit({ home } = {}) {
  fs.rmSync(limitPath(home), { force: true });
}

function parseArgs(argv) {
  const opts = { model: null, maxTokens: null, prompt: null, mode: 'run' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--status') opts.mode = 'status';
    else if (a === '--reset-limit') opts.mode = 'reset';
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--max-tokens') opts.maxTokens = Number(argv[++i]);
    else if (opts.prompt === null) opts.prompt = a;
  }
  return opts;
}

/**
 * One raw POST /v1/messages with an arbitrary request body — shared by this
 * wrapper and claude-api-agent.js (zero-dependency plugin scripts: raw fetch,
 * no SDK install). Maps failures onto the RC contract.
 * @returns {Promise<{rc:number, body?:object, message?:string}>}
 */
async function postMessages({ key, body, timeoutMs, fetchImpl = globalThis.fetch }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    const errMsg = json && json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
    if (!res.ok) {
      if (LIMIT_RE.test(errMsg) || res.status === 402) return { rc: RC.LIMIT, message: errMsg };
      if (res.status === 401) return { rc: RC.ERROR, message: `invalid API key (${errMsg})` };
      return { rc: RC.ERROR, message: errMsg };
    }
    return { rc: RC.OK, body: json || {} };
  } catch (err) {
    if (err && err.name === 'AbortError') return { rc: RC.TIMEOUT, message: `timed out after ${Math.round(timeoutMs / 1000)} s` };
    return { rc: RC.ERROR, message: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The text blocks of a Messages API response, joined. */
function textOf(body) {
  return (body && Array.isArray(body.content) ? body.content : [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * One Messages API call.
 * @returns {Promise<{rc:number, text?:string, message?:string, usage?:object}>}
 */
async function callApi({ key, prompt, model, maxTokens, timeoutMs, fetchImpl = globalThis.fetch }) {
  const r = await postMessages({
    key, timeoutMs, fetchImpl,
    body: { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
  });
  if (r.rc !== RC.OK) return r;
  return { rc: RC.OK, text: textOf(r.body), usage: r.body.usage };
}

/**
 * The SessionStart `[api-credit] …` line, or null while the switch is off
 * (no noise for users who never opted in). Tells the session where the
 * credit-first route is and whether it can run at all. Kept short and
 * root-free ({PLUGIN_ROOT} is resolved by the line above it): the whole
 * SessionStart payload must stay under the harness preview limit.
 */
function sessionLine({ cwd, home, env = process.env } = {}) {
  const sw = loadSwitches({ cwd, home });
  if (!sw.enabled || env.DEVOPS_DISABLE_CLAUDE_API === '1') return null;
  if (!resolveKey({ env, home })) {
    return `[api-credit] on · no key stored — side work stays on the plan${sw.webGuide ? '; offer the one-time Console web guide (deep-knowledge/api-credits.md § The key)' : ''}.`;
  }
  const until = activeLimit({ home });
  if (until) return `[api-credit] on · credit exhausted until ${until} — side work stays on the plan.`;
  return '[api-credit] on · key ✓ — read-only scout/research/review: API credit FIRST via {PLUGIN_ROOT}/scripts/claude-api-agent.js; rc≠0 → Agent tool. See api-credits.md';
}

/**
 * The whole CLI as a function — returns the exit code, writes via `out`/`err`.
 */
async function run(argv, {
  env = process.env, home, cwd, now = Date.now(), fetchImpl, readStdin,
  out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s),
} = {}) {
  const opts = parseArgs(argv);

  if (opts.mode === 'reset') {
    resetLimit({ home });
    out('claude-api-safe: limit marker cleared\n');
    return RC.OK;
  }

  const switches = loadSwitches({ cwd, home });
  const keyInfo = resolveKey({ env, home });

  if (opts.mode === 'status') {
    out(JSON.stringify({
      enabled: switches.enabled,
      webGuide: switches.webGuide,
      keyPresent: Boolean(keyInfo),
      keySource: keyInfo ? keyInfo.source : null,
      keyFile: path.join(claudeDir(home), ENV_FILE),
      limitUntil: activeLimit({ home, now }),
    }) + '\n');
    return RC.OK;
  }

  if (env.DEVOPS_DISABLE_CLAUDE_API === '1' || !switches.enabled) {
    err('claude-api-safe: apiCredit.enabled is off — skipping.\n');
    return RC.DISABLED;
  }
  if (!keyInfo) {
    err(`claude-api-safe: no ${KEY_VAR} stored — skipping.${switches.webGuide ? ' Offer the one-time web guide (deep-knowledge/api-credits.md).' : ''}\n`);
    return RC.NO_KEY;
  }
  const until = activeLimit({ home, now });
  if (until) {
    err(`claude-api-safe: API credit exhausted — skipped until ${until} (reset early: claude-api-safe.js --reset-limit).\n`);
    return RC.LIMIT;
  }

  let prompt = opts.prompt;
  if (prompt === '-' || prompt === null) prompt = readStdin ? readStdin() : fs.readFileSync(0, 'utf8');
  if (!prompt || !prompt.trim()) {
    err('claude-api-safe: empty prompt\n');
    return RC.ERROR;
  }

  const timeoutS = Number(env.CLAUDE_API_SAFE_TIMEOUT) > 0 ? Number(env.CLAUDE_API_SAFE_TIMEOUT) : DEFAULT_TIMEOUT_S;
  const result = await callApi({
    key: keyInfo.key,
    prompt,
    model: opts.model || env.CLAUDE_API_SAFE_MODEL || DEFAULT_MODEL,
    maxTokens: Number.isInteger(opts.maxTokens) && opts.maxTokens > 0 ? opts.maxTokens : DEFAULT_MAX_TOKENS,
    timeoutMs: timeoutS * 1000,
    fetchImpl,
  });

  if (result.rc === RC.OK) {
    out(result.text.endsWith('\n') ? result.text : result.text + '\n');
    if (result.usage) err(`claude-api-safe: ${result.usage.input_tokens || 0} in / ${result.usage.output_tokens || 0} out tokens on API credit\n`);
    return RC.OK;
  }
  if (result.rc === RC.LIMIT) {
    const stored = storeLimit({ home, now, reason: result.message });
    err(`claude-api-safe: API credit exhausted (${result.message}) — skipped until ${stored}.\n`);
    return RC.LIMIT;
  }
  err(`claude-api-safe: ${result.message}\n`);
  return result.rc;
}

module.exports = {
  RC, KEY_VAR, ENV_FILE, LIMIT_FILE, DEFAULT_MODEL,
  parseEnvFile, resolveKey, loadSwitches, activeLimit, storeLimit, resetLimit,
  parseArgs, postMessages, textOf, callApi, sessionLine, run,
};

if (require.main === module) {
  run(process.argv.slice(2)).then((rc) => { process.exitCode = rc; });
}
