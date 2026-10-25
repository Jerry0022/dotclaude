#!/usr/bin/env node
'use strict';
if (require.main === module && !require('../hooks/lib/features').featureAllowed('frustrated-mode')) {
  process.stderr.write('frustrated-mode: not available on this channel\n');
  process.exit(126);
}
/**
 * @script frustrated-brief
 * @feature frustrated-mode (alpha)
 * @description Builds the evidence brief of a frustrated analysis from a
 *   session transcript, mechanically (no narration by the anchored main
 *   thread). Reads only the bounded tail of the transcript (default 4 MB).
 *
 *   Output JSON: {transcript, window:{first,last}, prompts:[{n,text}],
 *   filesEdited:[path], errors:[signature], skills:[name], agents:[type],
 *   codeFree:{prompts:[{n,text}]}}. `prompts` are the user's own prompts
 *   (machine prompts, meta entries and tool results dropped; fenced code and
 *   pasted logs collapsed to `[log: N lines]`). `codeFree` additionally drops
 *   paths, inline code and URLs — the cut for the code-blind roles.
 *
 *   Usage: node frustrated-brief.js [--transcript <file.jsonl> | --session <id>]
 *          [--out <file>] [--max-bytes N] [--max-prompts N]
 *   Without --transcript the transcript of --session (default: this session,
 *   $CLAUDE_CODE_SESSION_ID) is looked up as ~/.claude/projects/<slug>/<id>.jsonl.
 *   A session other than the current one is read only after the user's
 *   explicit yes (the skill asks; decision d5).
 *   `--out` must point into the temp dir (the brief never lands in the
 *   project). Exit: 0 ok, 1 unreadable transcript, 2 usage / --out outside
 *   the temp dir, 126 not available on this channel.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_PROMPTS = 60;
const MAX_PROMPT_CHARS = 2000;
const MAX_ERRORS = 25;

function readTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    // a cut first line is a partial entry
    return len < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { fs.closeSync(fd); }
}

/** Fenced code and long pasted logs collapse to `[log: N lines]`. */
function collapse(text) {
  let t = String(text || '').replace(/```[\s\S]*?```/g, (b) => `[log: ${b.split('\n').length - 2} lines]`);
  const lines = t.split('\n');
  const out = [];
  let run = 0;
  const flush = () => { if (run) { out.push(`[log: ${run} lines]`); run = 0; } };
  for (const l of lines) {
    if (/^\s*(?:at\s+\S|\d{2}:\d{2}:\d{2}|\[\w+\]|[A-Z]\w*Error\b|npm ERR!|\s{4,}\S)/.test(l)) { run += 1; continue; }
    flush();
    out.push(l);
  }
  flush();
  t = out.join('\n').trim();
  return t.length > MAX_PROMPT_CHARS ? `${t.slice(0, MAX_PROMPT_CHARS)} […]` : t;
}

/** Drops paths, inline code and URLs (the code-free cut). */
function codeFree(text) {
  return String(text || '')
    .replace(/\[log: \d+ lines\]/g, '[log]')
    .replace(/`[^`\n]*`/g, '[code]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/(?:[A-Za-z]:)?(?:[\w.-]*[/\\])+[\w.-]+/g, '[path]')
    .replace(/\b[\w-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|py|rb|go|rs|java|kt|cs|css|scss|html|md|yml|yaml|toml|sh|ps1)\b/g, '[file]')
    .trim();
}

function userPromptText(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isCompactSummary) return '';
  const c = entry.message && entry.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.some((b) => b && b.type === 'tool_result')) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}

function errorSignature(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /\b(?:[A-Z]\w*Error|Exception|FAIL|ERR!|error(?:\[\w+\])?:|failed|Cannot|cannot find|not found|exit code [1-9])/i.test(l));
  return hit ? hit.replace(/\s+/g, ' ').slice(0, 240) : null;
}

/**
 * @param {string} jsonl transcript text
 * @param {{maxPrompts?:number, transcript?:string}} [opts]
 */
function buildBrief(jsonl, opts = {}) {
  const { isNonUserPrompt } = require('../hooks/lib/non-user-prompt');
  const prompts = [];
  const files = new Set();
  const errors = new Map();
  const skills = new Set();
  const agents = new Set();
  let first = null;
  let last = null;
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.timestamp) { if (!first) first = e.timestamp; last = e.timestamp; }
    const text = userPromptText(e);
    if (text && text.trim() && !isNonUserPrompt(text) && !text.includes('<command-name>') && !text.includes('<local-command')) {
      prompts.push(collapse(text));
    }
    const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    for (const b of c) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const inp = b.input || {};
        if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(b.name) && (inp.file_path || inp.notebook_path)) files.add(String(inp.file_path || inp.notebook_path).replace(/\\/g, '/'));
        if (b.name === 'Skill' && inp.skill) skills.add(String(inp.skill));
        if ((b.name === 'Agent' || b.name === 'Task') && inp.subagent_type) agents.add(String(inp.subagent_type));
      }
      if (b.type === 'tool_result' && (b.is_error || /error|fail/i.test(typeof b.content === 'string' ? b.content.slice(0, 4000) : ''))) {
        const raw = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('\n') : '';
        const sig = errorSignature(raw.slice(0, 8000));
        if (sig) errors.set(sig, (errors.get(sig) || 0) + 1);
      }
    }
  }
  const max = opts.maxPrompts || DEFAULT_MAX_PROMPTS;
  const offset = Math.max(0, prompts.length - max);
  const numbered = prompts.slice(offset).map((text, i) => ({ n: offset + i + 1, text }));
  return {
    transcript: opts.transcript || null,
    window: { first, last },
    prompts: numbered,
    promptsDropped: offset,
    filesEdited: [...files],
    errors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ERRORS).map(([sig, count]) => ({ sig, count })),
    skills: [...skills],
    agents: [...agents],
    codeFree: { prompts: numbered.map((p) => ({ n: p.n, text: codeFree(p.text) })) },
  };
}

function inTemp(file) {
  const abs = path.resolve(file).replace(/\\/g, '/').toLowerCase();
  const t = path.resolve(os.tmpdir()).replace(/\\/g, '/').toLowerCase();
  return abs.startsWith(t + '/');
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** `~/.claude/projects/<slug>/<session>.jsonl` — one readdir of the projects dir, no deeper walk. */
function findTranscript(sessionId, home = os.homedir()) {
  const id = String(sessionId || '').replace(/[^\w.-]/g, '');
  if (!id) return null;
  const dir = path.join(home, '.claude', 'projects');
  let slugs = [];
  try { slugs = fs.readdirSync(dir); } catch { return null; }
  for (const slug of slugs) {
    const f = path.join(dir, slug, `${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function main(argv, opts = {}) {
  if (!require('../hooks/lib/features').featureAllowed('frustrated-mode', opts.features)) return { code: 126, err: 'frustrated-mode: not available on this channel' };
  const env = opts.env || process.env;
  const session = argOf(argv, '--session') || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID;
  const transcript = argOf(argv, '--transcript') || (session ? findTranscript(session, opts.home) : null);
  const out = argOf(argv, '--out');
  if (!transcript) return { code: 2, err: 'usage: [--transcript <file.jsonl> | --session <id>] [--out <file in temp>] [--max-bytes N] [--max-prompts N] (no transcript found)' };
  if (out && !inTemp(out)) return { code: 2, err: '--out must point into the temp dir' };
  let text;
  try { text = readTail(transcript, Number(argOf(argv, '--max-bytes')) || DEFAULT_MAX_BYTES); } catch (e) { return { code: 1, err: `cannot read transcript: ${e.message}` }; }
  const brief = buildBrief(text, { transcript, maxPrompts: Number(argOf(argv, '--max-prompts')) || undefined });
  const json = JSON.stringify(brief, null, 2);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, json); }
  return { code: 0, json: out ? JSON.stringify({ ok: true, out, prompts: brief.prompts.length, files: brief.filesEdited.length, errors: brief.errors.length }) : json };
}

if (require.main === module) {
  const r = main(process.argv.slice(2));
  if (r.err) process.stderr.write(r.err + '\n');
  if (r.json) process.stdout.write(r.json + '\n');
  process.exit(r.code);
}

module.exports = { buildBrief, collapse, codeFree, findTranscript, main };
