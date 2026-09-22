#!/usr/bin/env node
/**
 * @script graphify-audit
 * @version 0.3.0
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
 *     node scripts/graphify-audit.js [--sessions 10] [--since 2026-09-01] [--skip <sid-prefix>]
 *
 *   `--skip` drops the session running the audit (its own grep output would
 *   otherwise count as gate hits). Token figures are chars/4 for tool results
 *   and `message.usage` sums for the model side. Read-only; never writes.
 *
 *   A SECOND per-session table (`--sessions N`, default 10) is built purely
 *   from the telemetry stream (sid 'nosid' excluded — that is a hook run with
 *   no session context, not a real session): queries/queryChars,
 *   searches/searchChars, gate fired/bypassed/noanswer/relented, and token
 *   guard blocks/releases. It ends with a NET estimate line (Requirement 9):
 *   `gate_fired`/`gate_bypassed` events carry a short `keyHash` that DIRECTLY
 *   links a bypass back to the block it bypassed; a bypassed gate counts as a
 *   NET LOSS (the block's `answerChars` were paid AND the raw search still
 *   ran), an accepted gate as a gain (or loss — NOT clamped to 0) against the
 *   median `responseChars` of ELIGIBLE searches sharing the same
 *   `outputMode`, in the same project (falling back to that mode globally,
 *   then to the overall global median). See `estimateSavings`'s doc comment
 *   for the full method.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');
// Same override graphify-metrics.js's own metricsPath() honours (Requirement
// 8) — lets a live-QA run or a test point this script at an isolated file
// instead of the real `~/.claude/graphify-metrics.jsonl`.
const METRICS_FILE = process.env.DOTCLAUDE_GRAPHIFY_METRICS || path.join(os.homedir(), '.claude', 'graphify-metrics.jsonl');
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
        // Requirement 9: only a genuine hook-BLOCK error result counts as a
        // gate — `is_error: true` on the tool_result, not merely text that
        // happens to CONTAIN "GRAPHIFY GATE" (a grep of this very file's own
        // source, or a Read of this script, would otherwise false-positive).
        if (c.is_error && text.includes(GATE_MARK)) {
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

/** Every telemetry line since `since` (ISO date) as a parsed event, test runs excluded. */
function readMetricsEvents(since) {
  let raw;
  try { raw = fs.readFileSync(METRICS_FILE, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (since && e.ts < since) continue;
    if (/[\\/]Temp[\\/]|[\\/]tmp[\\/]/.test(e.project || '')) continue; // vitest runs
    out.push(e);
  }
  return out;
}

/** Aggregate the telemetry stream since `since` (ISO date), test runs excluded. */
function metricsSummary(since) {
  const out = { events: {}, queryChars: 0, searchChars: 0, broadSearchChars: 0, searches: 0, broadSearches: 0 };
  for (const e of readMetricsEvents(since)) {
    out.events[e.event] = (out.events[e.event] || 0) + 1;
    if (e.event === 'query_ran') out.queryChars += e.responseChars || 0;
    if (e.event === 'search_ran') {
      out.searches++; out.searchChars += e.responseChars || 0;
      if (e.broad) { out.broadSearches++; out.broadSearchChars += e.responseChars || 0; }
    }
  }
  return out;
}

/** Median of a numeric array; 0 for an empty array. */
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Per-SESSION rollup of the telemetry stream (sid 'nosid' excluded — a hook
 * run with no session context is not a session). Pure function of the parsed
 * event array so the aggregation is unit-testable with fixture data. Sessions
 * are returned newest-first (by each session's latest event timestamp).
 */
function aggregateMetricsBySession(events) {
  const sessions = new Map();
  for (const e of events) {
    if (!e || !e.sid || e.sid === 'nosid') continue;
    let s = sessions.get(e.sid);
    if (!s) {
      s = {
        sid: e.sid, project: e.project || '', lastTs: e.ts || '',
        queries: 0, queryChars: 0, searches: 0, searchChars: 0,
        gatesFired: 0, gatesBypassed: 0, gatesNoAnswer: 0, gatesRelented: 0,
        guardBlocks: 0, guardReleases: 0,
      };
      sessions.set(e.sid, s);
    }
    if (!s.project && e.project) s.project = e.project;
    if (e.ts && e.ts > s.lastTs) s.lastTs = e.ts;
    switch (e.event) {
      case 'query_ran': s.queries++; s.queryChars += e.responseChars || 0; break;
      case 'search_ran': s.searches++; s.searchChars += e.responseChars || 0; break;
      case 'gate_fired': s.gatesFired++; break;
      case 'gate_bypassed': s.gatesBypassed++; break;
      case 'gate_noanswer': s.gatesNoAnswer++; break;
      case 'gate_relented': s.gatesRelented++; break;
      case 'guard_blocked': s.guardBlocks++; break;
      case 'guard_released': s.guardReleases++; break;
      default: break;
    }
  }
  return [...sessions.values()].sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''));
}

/**
 * NET tokens the graphify gate cost/saved (Requirement 9). NOT clamped to 0 —
 * a bypassed gate is a real LOSS (the block's own `answerChars` were paid AND
 * the original search still ran afterward), and an accepted answer bigger
 * than its baseline is a real loss too; hiding either behind a floor of 0
 * would overstate how well the gate is doing.
 *
 * Linking a `gate_bypassed` back to the `gate_fired` it bypassed uses the
 * short `keyHash` both events carry (added alongside this rewrite) — a
 * direct pairing, not an inferred count. Events recorded by an older hook
 * version (no `keyHash`) fall back to the previous per-project count
 * approximation (`max(0, fired - bypassed)`, oldest-first-treated-as-bypassed)
 * so an audit spanning an upgrade window does not silently drop older data.
 *
 * The baseline for an ACCEPTED gate — what the search would have cost as a
 * raw Grep — and the "search that ran anyway" cost for a BYPASSED gate are
 * both the MEDIAN `responseChars` of ELIGIBLE searches with the SAME
 * `outputMode`, in the SAME project (fallback: that `outputMode` across all
 * projects; fallback of the fallback: the global median across every
 * eligible search regardless of mode). Splitting by `outputMode` matters
 * because a `content`-mode gate's true alternative is a `content`-mode
 * search, not a much cheaper `files_with_matches`/`count` one.
 *
 * `sid: 'nosid'` events are excluded throughout. tokens ≈ chars/4.
 * @returns {{netChars:number, netTokens:number, acceptedCount:number, bypassedCount:number, globalMedian:number}}
 */
function estimateSavings(events) {
  const eligibleByProjMode = new Map(); // `${proj}\u0000${mode}` -> chars[]
  const eligibleByMode = new Map();     // mode -> chars[]
  const eligibleAll = [];
  const firedByHash = new Map();        // keyHash -> {project, outputMode, answerChars}
  const bypassedHashes = new Set();
  const firedNoHash = [];               // legacy (pre-keyHash) fired events
  const bypassedNoHashByProject = new Map();

  for (const e of events) {
    if (!e || e.sid === 'nosid') continue;
    const proj = e.project || 'unknown';
    if (e.event === 'search_ran' && e.eligible) {
      const mode = e.outputMode || '';
      const pmKey = proj + '\u0000' + mode;
      if (!eligibleByProjMode.has(pmKey)) eligibleByProjMode.set(pmKey, []);
      eligibleByProjMode.get(pmKey).push(e.responseChars || 0);
      if (!eligibleByMode.has(mode)) eligibleByMode.set(mode, []);
      eligibleByMode.get(mode).push(e.responseChars || 0);
      eligibleAll.push(e.responseChars || 0);
    } else if (e.event === 'gate_fired') {
      const entry = { project: proj, outputMode: e.outputMode || '', answerChars: e.answerChars || 0 };
      if (e.keyHash) firedByHash.set(e.keyHash, entry);
      else firedNoHash.push(entry);
    } else if (e.event === 'gate_bypassed') {
      if (e.keyHash) bypassedHashes.add(e.keyHash);
      else bypassedNoHashByProject.set(proj, (bypassedNoHashByProject.get(proj) || 0) + 1);
    }
  }

  const globalMedian = median(eligibleAll);
  const baselineFor = (proj, mode) => {
    const pm = eligibleByProjMode.get(proj + '\u0000' + mode);
    if (pm && pm.length) return median(pm);
    const m = eligibleByMode.get(mode);
    if (m && m.length) return median(m);
    return globalMedian;
  };

  let netChars = 0;
  let acceptedCount = 0;
  let bypassedCount = 0;

  for (const [hash, fired] of firedByHash) {
    const baseline = baselineFor(fired.project, fired.outputMode);
    if (bypassedHashes.has(hash)) {
      netChars -= (fired.answerChars + baseline); // NET LOSS — paid the answer AND ran the search anyway
      bypassedCount++;
    } else {
      netChars += (baseline - fired.answerChars); // NOT clamped to 0
      acceptedCount++;
    }
  }

  const legacyByProject = new Map();
  for (const f of firedNoHash) {
    if (!legacyByProject.has(f.project)) legacyByProject.set(f.project, []);
    legacyByProject.get(f.project).push(f);
  }
  for (const [proj, fired] of legacyByProject) {
    const bypassed = bypassedNoHashByProject.get(proj) || 0;
    fired.forEach((f, idx) => {
      const baseline = baselineFor(f.project, f.outputMode);
      if (idx < bypassed) {
        netChars -= (f.answerChars + baseline);
        bypassedCount++;
      } else {
        netChars += (baseline - f.answerChars);
        acceptedCount++;
      }
    });
  }

  return { netChars, netTokens: Math.round(netChars / 4), acceptedCount, bypassedCount, globalMedian };
}

function shortProject(d) {
  return d.replace(/^C--Users-[^-]+-IdeaProjects-/, '').replace(/--claude-worktrees-/, '/wt:');
}

function fmt(n) { return Number(n).toLocaleString('en-US'); }

function main(argv) {
  const opt = { sessions: 10, since: '', skip: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sessions') opt.sessions = parseInt(argv[++i], 10) || 10;
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

  // ── Per-session telemetry table + estimated savings (Requirement C) ──────
  const events = readMetricsEvents(opt.since);
  const sessionRows = aggregateMetricsBySession(events).slice(0, opt.sessions);
  if (sessionRows.length) {
    console.log(`\nPER-SESSION TELEMETRY (${sessionRows.length} most recent sessions, sid 'nosid' excluded)`);
    console.log(
      pad('sid', 12) + pad('project', 34) + num('query', 6) + num('qChr', 7)
      + num('srch', 5) + num('sChr', 7) + num('fired', 6) + num('byps', 5)
      + num('noans', 6) + num('relnt', 6) + num('gblk', 5) + num('grls', 5)
    );
    for (const s of sessionRows) {
      console.log(
        pad(s.sid.slice(0, 10), 12) + pad(shortProject(s.project).slice(0, 32), 34)
        + num(s.queries, 6) + num(fmt(s.queryChars), 7) + num(s.searches, 5) + num(fmt(s.searchChars), 7)
        + num(s.gatesFired, 6) + num(s.gatesBypassed, 5) + num(s.gatesNoAnswer, 6) + num(s.gatesRelented, 6)
        + num(s.guardBlocks, 5) + num(s.guardReleases, 5)
      );
    }
    const est = estimateSavings(events);
    const sign = est.netTokens >= 0 ? '+' : '';
    console.log(
      `\nNET estimate: ${sign}${fmt(est.netTokens)} tok`
      + ` over ${est.acceptedCount} accepted + ${est.bypassedCount} bypassed gate(s) (not clamped to 0)`
      + ` — method: accepted = outputMode-matched median eligible-search chars minus answerChars;`
      + ` bypassed = -(answerChars + that same median) since the block's answer AND the raw search both ran;`
      + ` global median fallback ${fmt(Math.round(est.globalMedian))} chars; tokens ≈ chars/4.`
    );
  } else {
    console.log('\nPER-SESSION TELEMETRY: no sessions with an sid in the telemetry stream yet.');
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  analyzeTranscript, metricsSummary, listSessions, resultText,
  readMetricsEvents, aggregateMetricsBySession, estimateSavings, median,
};
