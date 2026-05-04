#!/usr/bin/env node
/**
 * @script run-benchmark
 * @version 0.1.0
 * @plugin local-llm
 * @description Detached benchmark runner. Probes the local AnythingLLM
 *   workspace with three deterministic coding tasks and writes a tier
 *   classification (low | medium | high) to the persistent cache.
 *
 *   This script is spawned by ss.llm.health.js with `detached: true` —
 *   it has its own lifecycle and does NOT block the SessionStart hook.
 *
 *   Tier mapping:
 *     score ≥ 0.85 → high     (delegate boilerplate AND simple logic)
 *     score ≥ 0.50 → medium   (delegate ONLY pure boilerplate)
 *     score <  0.50 → low     (delegation disabled)
 *
 *   Each test scores 0..1 based on regex checks on the cleaned model output.
 *   Latency is recorded but does not affect the tier — it's surfaced for
 *   debugging only.
 */

'use strict';

const path = require('node:path');

const LIB = path.resolve(__dirname, '..', 'hooks', 'lib');
const http = require(path.join(LIB, 'anythingllm-http.js'));
const tierCache = require(path.join(LIB, 'anythingllm-tier-cache.js'));
const { resolveConfig, hasApiKey } = require(path.join(LIB, 'anythingllm-config.js'));

const CONFIG = resolveConfig();
const BASE_URL = CONFIG.anythingllm?.baseUrl || 'http://localhost:3001';
const WORKSPACE_SLUG = CONFIG.anythingllm?.workspaceSlug || 'claude-code';
const API_KEY = CONFIG.anythingllm?.apiKey || '';

// Same sanitization the MCP server uses — local models tend to wrap output
// in fences and inline <think> blocks regardless of the system prompt.
function stripOuterFence(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  const m = trimmed.match(/^```[a-zA-Z0-9_+\-.#]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : trimmed;
}
function stripThinking(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
}
function clean(text) { return stripOuterFence(stripThinking(text)); }

function scoreChecks(output, checks) {
  if (!output) return 0;
  let hits = 0;
  for (const re of checks) if (re.test(output)) hits += 1;
  return hits / checks.length;
}

// Structural sanity: balanced braces/parens. Cheap pre-gate to reject the
// most common hallucinations (truncated output, runaway code) before the
// regex score even runs.
function looksWellFormed(output) {
  if (!output) return false;
  let curly = 0;
  let paren = 0;
  let bracket = 0;
  for (const ch of output) {
    if (ch === '{') curly += 1;
    else if (ch === '}') curly -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    if (curly < 0 || paren < 0 || bracket < 0) return false;
  }
  return curly === 0 && paren === 0 && bracket === 0;
}

const SYSTEM_PROMPT =
  'You are a code generation assistant. Output ONLY the requested code — ' +
  'no explanations, no markdown fences, no commentary, no <think> blocks. ' +
  'If the task specifies a function signature, match it exactly.';

const TESTS = [
  {
    name: 'interface',
    weight: 1,
    prompt:
      'Language: typescript\n\nGenerate a TypeScript interface named `User` ' +
      'with these fields: `id: string`, `email: string`, `name: string`, ' +
      '`createdAt: Date`. Output only the interface declaration.',
    checks: [
      /interface\s+User\b/,
      /\bid\s*:\s*string\b/,
      /\bemail\s*:\s*string\b/,
      /\bname\s*:\s*string\b/,
      /\bcreatedAt\s*:\s*Date\b/,
    ],
  },
  {
    name: 'debounce',
    weight: 1,
    prompt:
      'Language: typescript\n\nImplement a debounce function with this exact ' +
      'signature:\n\n  function debounce<T extends (...args: any[]) => void>' +
      '(fn: T, ms: number): T\n\nIt should return a wrapped function that ' +
      'delays calling `fn` until `ms` ms have passed since the last call. ' +
      'Use setTimeout/clearTimeout.',
    // Behavioral gates: must SCHEDULE fn (not just mention it) and CANCEL
    // on re-entry. Pure token-presence regexes were too easy to satisfy
    // with code that returns `fn` unchanged.
    checks: [
      /\bdebounce\b/,
      /\bclearTimeout\b/,                // must cancel
      /setTimeout\s*\(\s*(?:\(\)\s*=>|function)/, // must schedule a callback
      /\bfn\s*\(/,                        // must actually CALL fn somewhere
      /\bms\b/,
    ],
  },
  {
    name: 'mergeSorted',
    weight: 1,
    prompt:
      'Language: typescript\n\nWrite a TypeScript function with signature ' +
      '`function mergeSorted(a: number[], b: number[]): number[]` that ' +
      'merges two pre-sorted ascending arrays into a single sorted array. ' +
      'Do not use external libraries. Two-pointer or concat+sort both fine.',
    // Must reference BOTH inputs in the body and produce an array result.
    checks: [
      /\bmergeSorted\s*\(/,
      /:\s*number\[\]/,
      /\ba\b[\s\S]*\bb\b|\bb\b[\s\S]*\ba\b/, // both inputs touched
      /\b(while|for|concat|\.\.\.)/,         // iteration or spread/concat
      /return\s+(?:result|merged|out|res|\[|\.\.\.|[a-z]+\s*[;.])/i,
    ],
  },
];

async function runOneTest(test) {
  const startedAt = Date.now();
  const res = await http.chatCompletion(BASE_URL, API_KEY, {
    workspaceSlug: WORKSPACE_SLUG,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: test.prompt },
    ],
    temperature: 0.2,
    maxTokens: 1024,
  });
  const latencyMs = Date.now() - startedAt;
  if (!res.ok) {
    return { name: test.name, passed: false, score: 0, latencyMs, error: res.error || res.errorType };
  }
  const output = clean(res.content);
  // Structurally broken output (unbalanced braces/parens) → score 0.
  // No amount of regex hits should rescue obvious garbage.
  if (!looksWellFormed(output)) {
    return { name: test.name, passed: false, score: 0, latencyMs, output: output.slice(0, 240), error: 'malformed' };
  }
  const score = scoreChecks(output, test.checks);
  return {
    name: test.name,
    passed: score >= 0.8,
    score,
    latencyMs,
    output: output.slice(0, 240),
  };
}

function classifyTier(avgScore) {
  if (avgScore >= 0.85) return 'high';
  if (avgScore >= 0.5) return 'medium';
  return 'low';
}

async function main() {
  if (!hasApiKey(CONFIG)) {
    process.stderr.write('[benchmark] no api key — abort\n');
    process.exit(0);
  }

  const auth = await http.verifyAuth(BASE_URL, API_KEY);
  if (!auth.valid) {
    process.stderr.write(`[benchmark] auth invalid (${auth.errorType}) — abort\n`);
    tierCache.clearRunning();
    process.exit(0);
  }

  const ws = await http.getWorkspace(BASE_URL, API_KEY, WORKSPACE_SLUG);
  if (!ws.ok || !ws.workspace) {
    process.stderr.write('[benchmark] workspace missing — abort\n');
    tierCache.clearRunning();
    process.exit(0);
  }
  const model = ws.workspace.chatModel || 'unknown';

  const results = [];
  for (const t of TESTS) {
    process.stderr.write(`[benchmark] ${t.name}…\n`);
    const r = await runOneTest(t);
    results.push(r);
  }

  const totalWeight = TESTS.reduce((s, t) => s + t.weight, 0);
  const weighted = results.reduce((s, r, i) => s + r.score * TESTS[i].weight, 0);
  const score = weighted / totalWeight;
  const tier = classifyTier(score);

  tierCache.writeCache({
    model,
    ranAt: new Date().toISOString(),
    tier,
    score,
    tests: results.map((r) => ({
      name: r.name,
      passed: r.passed,
      score: r.score,
      latencyMs: r.latencyMs,
      ...(r.error ? { error: r.error } : {}),
    })),
  });

  process.stderr.write(`[benchmark] done — model=${model} tier=${tier} score=${score.toFixed(2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`[benchmark] crash: ${err.stack || err.message}\n`);
  tierCache.clearRunning();
  process.exit(1);
});
