'use strict';
/**
 * @module savings-log
 * @description One JSONL line per avoided / delegated operation, so the plugin
 *   audit can weigh benefit against cost. Every figure is an ESTIMATE (the line
 *   says so: `estimate:true`) - nothing here is a measured saving.
 *
 *   File: ~/.claude/devops-savings.jsonl (override: DEVOPS_SAVINGS_LOG).
 *   Capped: past MAX_BYTES the oldest half is dropped. Never throws and never
 *   blocks - a log error must not change a hook's verdict.
 *
 *   Line: { v, ts, source: 'token-guard'|'local-llm', op, estimate: true,
 *           estTokens, ...extra }
 *   token-guard ops: 'blocked' (estTokens = the call's estimated cost, only
 *   avoided if the retry is narrower), 'released' (the same call went ahead -
 *   cancels a block), 'narrowed' (the next call was measurably narrower -
 *   estimate:false, see guard-followup.js; estTokens an upper bound). local-llm op: 'delegated' (estTokens = output Claude
 *   did not have to generate).
 *
 *   The local-llm plugin ships an identical copy (separate plugin, no shared
 *   code) - keep both in step.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 256 * 1024;

function logPath() {
  return process.env.DEVOPS_SAVINGS_LOG || path.join(os.homedir(), '.claude', 'devops-savings.jsonl');
}

function rotate(file) {
  const text = fs.readFileSync(file, 'utf8');
  const keep = text.slice(Math.floor(text.length / 2));
  const nl = keep.indexOf('\n');
  fs.writeFileSync(file, nl === -1 ? '' : keep.slice(nl + 1));
}

/** @returns {boolean} true when the line was written */
function record(source, op, estTokens, extra = {}) {
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { if (fs.statSync(file).size > MAX_BYTES) rotate(file); } catch { /* absent or unreadable - append anyway */ }
    const n = Number(estTokens);
    const line = { v: 1, ts: new Date().toISOString(), source, op, estimate: true, estTokens: Number.isFinite(n) ? Math.round(n) : 0, ...extra };
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** local-llm delegation: output Claude did not write (~3.5 chars/token). */
function recordDelegated(content, tokensUsed, extra = {}) {
  return record('local-llm', 'delegated', Math.ceil(String(content || '').length / 3.5), { localTokensUsed: tokensUsed ?? null, ...extra });
}

module.exports = { record, recordDelegated, logPath, MAX_BYTES };
