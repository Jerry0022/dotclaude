#!/usr/bin/env node
/**
 * @script graphify-audit
 * @version 0.1.0
 * @plugin devops
 * @description Measures whether the graphify enforcement chain (nudge → gate →
 *   `graphify query`) actually pays for itself, from two sources that need no
 *   instrumentation to have been on: the Claude Code session transcripts under
 *   `~/.claude/projects/**\/*.jsonl` (what really ran: every Grep/Glob/Read,
 *   every shell command, every gate block, every token count) and the
 *   graphify telemetry stream `~/.claude/graphify-metrics.jsonl` (what the
 *   hooks believed they did). Prints a per-session table, the aggregate, and
 *   the gate → what-followed trace for every blocked search.
 *
 *   The first run (2026-09-17, 20 sessions) found 2 queries in 1 session, 3
 *   gate blocks, and Grep/Glob output at 0.03 % of new input — i.e. nothing
 *   to save. Re-run after a fix to see whether that moved:
 *
 *     node scripts/graphify-audit.js [--sessions 20] [--since 2026-09-01] [--skip <sid-prefix>]
 *
 *   `--skip` drops the session running the audit (its own grep output would
 *   otherwise count as gate hits). Token figures are chars/4 for tool results
 *   and `message.usage` sums for the model side. Read-only; never writes.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
const METRICS_FILE = path.join(os.homedir(), '.claude', 'graphify-metrics.jsonl');
const MIN_TRANSCRIPT_BYTES = 100 * 1024; // below this a "session" is a hook-only stub
const QUERY_RE = /graphify\s+query/;
const GATE_MARK = 'GRAPHIFY GATE';
const SHELLS = new Set(['Bash', 'PowerShell']);

const tok = (s) => Math.round((s || '').length / 4);

/** Text of a tool_result content block, whatever shape the transcript stored. */
function resultText(c) {
  if (typeof c.content === 'string') return c.content;
  if (Array.isArray(c.content)) return c.content.map((x) => x.text || '').join('');
  return '';
}

/**
 * Pure per-transcript analysis. `lines` are raw JSONL lines. Returns counts,
 * token sums, the query commands, and the gate → what-followed trace.
 */
function analyzeTranscript(lines) {
  const r = {
    turns: 0, out: 0, inNew: 0, cacheRead: 0,
    gq: 0, gqTok: 0, gqCmds: [],
    gate: 0, gateTok: 0, bypass: 0,
    grep: 0, glob: 0, broad: 0, searchTok: 0,
    read: 0, readTok: 0,
    graphifyOther: 0,
    cwd: null, trace: [],
  };
  const toolUse = new Map(); // id → {name, input}
  const gated = new Set();   // "Tool:pattern" keys blocked, awaiting a retry
  let pendingGate = 0;       // how many follow-up steps to record after a gate
  for (const l of lines) {
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (!r.cwd && e.cwd) r.cwd = e.cwd;
    const m = e.message;
    if (!m) continue;
    if (e.type === 'assistant') {
      if (m.usage) {
        r.turns++;
        r.out += m.usage.output_tokens || 0;
        r.inNew += (m.usage.input_tokens || 0) + (m.usage.cache_creation_input_tokens || 0);
        r.cacheRead += m.usage.cache_read_input_tokens || 0;
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type !== 'tool_use') continue;
        const input = c.input || {};
        toolUse.set(c.id, { name: c.name, input });
        if (c.name === 'Grep') { r.grep++; if (!input.path) r.broad++; }
        if (c.name === 'Glob') { r.glob++; if (!input.path) r.broad++; }
        if (c.name === 'Read') r.read++;
        if (SHELLS.has(c.name)) {
          const cmd = input.command || '';
          if (QUERY_RE.test(cmd)) { r.gq++; r.gqCmds.push(cmd.replace(/\s+/g, ' ').slice(0, 110)); }
          else if (/\bgraphify\b/.test(cmd)) r.graphifyOther++;
        }
        if (pendingGate > 0) {
          r.trace.push({ step: 'use', tool: c.name, brief: JSON.stringify(input).slice(0, 100) });
        }
      }
    } else if (e.type === 'user' && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type !== 'tool_result') continue;
        const tu = toolUse.get(c.tool_use_id);
        if (!tu) continue;
        const text = resultText(c);
        const t = tok(text);
        if (text.includes(GATE_MARK)) {
          r.gate++; r.gateTok += t;
          gated.add(`${tu.name}:${tu.input.pattern || ''}`);
          r.trace.push({ step: 'GATE', tool: tu.name, brief: String(tu.input.pattern || ''), tok: t });
          pendingGate = 3;
          continue;
        }
        if (tu.name === 'Grep' || tu.name === 'Glob') {
          r.searchTok += t;
          const key = `${tu.name}:${tu.input.pattern || ''}`;
          if (!tu.input.path && gated.has(key)) { r.bypass++; gated.delete(key); }
        }
        if (tu.name === 'Read') r.readTok += t;
        if (SHELLS.has(tu.name) && QUERY_RE.test(tu.input.command || '')) r.gqTok += t;
        if (pendingGate > 0) {
          r.trace.push({ step: 'res', tool: tu.name, tok: t });
          pendingGate--;
        }
      }
    }
  }
  return r;
}

/** Newest-first transcript files, deduped by session id (mirror dirs repeat them). */
function listSessions({ sessions, skip }) {
  const files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_ROOT); } catch { return []; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_ROOT, d);
    let names;
    try { if (!fs.statSync(dir).isDirectory()) continue; names = fs.readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dir, f);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size < MIN_TRANSCRIPT_BYTES) continue;
      files.push({ p, mtime: st.mtimeMs, size: st.size, proj: d, sid: f.slice(0, -6) });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const seen = new Set();
  return files
    .filter((f) => !seen.has(f.sid) && seen.add(f.sid))
    .filter((f) => !skip || !f.sid.startsWith(skip))
    .slice(0, sessions);
}

/** Aggregate the telemetry stream since `since` (ISO date), test runs excluded. */
function metricsSummary(since) {
  const out = { events: {}, queryChars: 0, searchChars: 0, broadSearchChars: 0, searches: 0, broadSearches: 0 };
  let raw;
  try { raw = fs.readFileSync(METRICS_FILE, 'utf8'); } catch { return out; }
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (since && e.ts < since) continue;
    if (/[\\/]Temp[\\/]|[\\/]tmp[\\/]/.test(e.project || '')) continue; // vitest runs
    out.events[e.event] = (out.events[e.event] || 0) + 1;
    if (e.event === 'query_ran') out.queryChars += e.responseChars || 0;
    if (e.event === 'search_ran') {
      out.searches++; out.searchChars += e.responseChars || 0;
      if (e.broad) { out.broadSearches++; out.broadSearchChars += e.responseChars || 0; }
    }
  }
  return out;
}

function shortProject(d) {
  return d.replace(/^C--Users-[^-]+-IdeaProjects-/, '').replace(/--claude-worktrees-/, '/wt:');
}

function fmt(n) { return Number(n).toLocaleString('en-US'); }

function main(argv) {
  const opt = { sessions: 20, since: '', skip: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sessions') opt.sessions = parseInt(argv[++i], 10) || 20;
    else if (argv[i] === '--since') opt.since = argv[++i] || '';
    else if (argv[i] === '--skip') opt.skip = argv[++i] || '';
  }
  const rows = [];
  for (const f of listSessions(opt)) {
    const lines = fs.readFileSync(f.p, 'utf8').split('\n');
    const r = analyzeTranscript(lines);
    let hasGraph = null;
    if (r.cwd) {
      try {
        const nudge = require('../hooks/lib/graph-nudge');
        const g = nudge.resolveGraphJson(r.cwd);
        hasGraph = g ? g.source : 'none';
      } catch { hasGraph = null; }
    }
    rows.push({ ...r, sid: f.sid.slice(0, 8), proj: shortProject(f.proj), date: new Date(f.mtime).toISOString().slice(0, 16).replace('T', ' '), mb: f.size / 1048576, hasGraph });
  }

  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(`graphify audit — ${rows.length} most recent sessions${opt.skip ? ` (skipping ${opt.skip}*)` : ''}\n`);
  console.log(pad('date', 17) + pad('project', 46) + pad('sid', 9) + num('graph', 6) + num('query', 6) + num('qTok', 6) + num('gate', 5) + num('bypass', 7) + num('grep', 5) + num('glob', 5) + num('broad', 6) + num('sTok', 7) + num('read', 5) + num('rTok', 8));
  const agg = {};
  for (const r of rows) {
    console.log(pad(r.date, 17) + pad(r.proj.slice(0, 44), 46) + pad(r.sid, 9) + num(r.hasGraph || '?', 6) + num(r.gq, 6) + num(r.gqTok, 6) + num(r.gate, 5) + num(r.bypass, 7) + num(r.grep, 5) + num(r.glob, 5) + num(r.broad, 6) + num(r.searchTok, 7) + num(r.read, 5) + num(r.readTok, 8));
    for (const k of ['gq', 'gqTok', 'gate', 'gateTok', 'bypass', 'grep', 'glob', 'broad', 'searchTok', 'read', 'readTok', 'out', 'inNew', 'cacheRead']) agg[k] = (agg[k] || 0) + r[k];
  }
  const withQuery = rows.filter((r) => r.gq).length;
  console.log('\nAGGREGATE');
  console.log(`  sessions with a graphify query : ${withQuery} / ${rows.length}   (queries ${agg.gq}, answers ${fmt(agg.gqTok)} tok)`);
  console.log(`  gate blocks                    : ${agg.gate}   bypassed by retry: ${agg.bypass}   block messages ${fmt(agg.gateTok)} tok`);
  console.log(`  Grep/Glob                      : ${agg.grep + agg.glob} (broad ${agg.broad}) → ${fmt(agg.searchTok)} tok of results`);
  console.log(`  Read                           : ${agg.read} → ${fmt(agg.readTok)} tok`);
  console.log(`  model input (new)              : ${fmt(agg.inNew)} tok   cache reads ${fmt(agg.cacheRead)}   output ${fmt(agg.out)}`);
  const share = agg.inNew ? (100 * agg.searchTok / agg.inNew).toFixed(3) : 'n/a';
  console.log(`  search results as share of new input: ${share} %  ← upper bound of what any search gate can save`);

  const traces = rows.filter((r) => r.gate);
  if (traces.length) {
    console.log('\nGATE → WHAT FOLLOWED');
    for (const r of traces) {
      console.log(`  [${r.sid}] ${r.proj}`);
      for (const t of r.trace) {
        if (t.step === 'GATE') console.log(`    ⛔ ${t.tool} "${t.brief}"  (+${t.tok} tok)`);
        else if (t.step === 'use') console.log(`       → ${t.tool} ${t.brief}`);
        else console.log(`         [${t.tok} tok]`);
      }
    }
  }
  if (agg.gq) {
    console.log('\nQUERIES');
    for (const r of rows) for (const c of r.gqCmds) console.log(`  [${r.sid}] ${c}`);
  }

  const ms = metricsSummary(opt.since);
  console.log(`\nTELEMETRY ${METRICS_FILE}${opt.since ? ` since ${opt.since}` : ''} (test runs excluded)`);
  console.log('  ' + Object.entries(ms.events).sort().map(([k, v]) => `${k} ${v}`).join('   '));
  if (ms.searches) console.log(`  search_ran: ${ms.searches} (broad ${ms.broadSearches}) → ${fmt(ms.searchChars)} chars (broad ${fmt(ms.broadSearchChars)});  query answers ${fmt(ms.queryChars)} chars`);
  else console.log('  no search_ran events yet — sizes arrive with post.graphify.search (v0.1.0+)');
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { analyzeTranscript, metricsSummary, listSessions, resultText };
