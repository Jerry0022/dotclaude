#!/usr/bin/env node
'use strict';
if (require.main === module && !require('../hooks/lib/features').featureAllowed('frustrated-mode')) {
  process.stderr.write('frustrated-mode: not available on this channel\n');
  process.exit(126);
}
/**
 * @script frustration-replay
 * @feature frustrated-mode (alpha)
 * @description Offline replay of Claude Code transcripts (JSONL) through the
 *   frustration scorer, for tuning the weights. Reads only the files you name,
 *   prints per-session markers (never prompt text): rounds, score, signals,
 *   flagged. Nothing is written.
 *
 *   Usage: node frustration-replay.js <transcript.jsonl|dir> [...]
 *   Exit: 0 ok, 2 usage, 126 not available on this channel.
 */

const fs = require('fs');
const path = require('path');

function userText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta) return '';
  const c = entry.message && entry.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  if (c.some((b) => b && b.type === 'tool_result')) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}

function assistantText(entry) {
  if (!entry || entry.type !== 'assistant') return '';
  const c = entry.message && entry.message.content;
  return Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : String(c || '');
}

/**
 * Replay one transcript's text.
 * @param {string} jsonl
 * @returns {{prompts:number, flaggedAt:number[], steps:Array<{n:number, rounds:number, score:number, signals:string[], flagged:boolean}>}}
 */
function replay(jsonl) {
  const { detect, claimsDone } = require('../hooks/lib/frustration-detect');
  const { isNonUserPrompt } = require('../hooks/lib/non-user-prompt');
  let state = null;
  let lastAssistant = '';
  const steps = [];
  const flaggedAt = [];
  let n = 0;
  for (const line of String(jsonl).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const a = assistantText(e);
    if (a.trim()) { lastAssistant = a; continue; }
    const t = userText(e);
    if (!t.trim() || isNonUserPrompt(t) || t.includes('<command-name>')) continue;
    n += 1;
    const res = detect(t, state, { claimedDone: claimsDone(lastAssistant), nowMs: Date.parse(e.timestamp) || n * 1000 });
    state = res.state;
    steps.push({ n, rounds: res.rounds, score: res.score, signals: res.signals, flagged: res.flagged });
    if (res.flagged) flaggedAt.push(n);
  }
  return { prompts: n, flaggedAt, steps };
}

function collect(arg) {
  const st = fs.statSync(arg);
  if (st.isFile()) return [arg];
  return fs.readdirSync(arg).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(arg, f));
}

function main(argv) {
  if (!argv.length) {
    process.stderr.write('usage: frustration-replay.js <transcript.jsonl|dir> [...]\n');
    return 2;
  }
  for (const arg of argv) {
    let files;
    try { files = collect(arg); } catch { process.stderr.write(`cannot read ${arg}\n`); continue; }
    for (const f of files) {
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const r = replay(text);
      const maxScore = r.steps.reduce((m, s) => Math.max(m, s.score), 0);
      process.stdout.write(`${path.basename(f)} prompts=${r.prompts} maxScore=${maxScore} flaggedAt=${r.flaggedAt.join(',') || '-'}\n`);
    }
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { replay, main };
