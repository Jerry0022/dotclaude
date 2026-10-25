#!/usr/bin/env node
'use strict';
/**
 * Hook audit: what do the plugin's hooks cost, how often do they time out, and
 * does the model act on what they say? Reproduces the 2026-10 transcript audit
 * (per-hook output/blocks/timeouts, context weight, compliance, PreToolUse
 * blocks) and adds the hook telemetry file (silent hooks, kill rate).
 *
 *   node hook-audit.js [--days 14] [--files a.jsonl,b.jsonl] [--min-kb 200]
 *                      [--telemetry <file>] [--json] [--only hooks,weight,comply,blocks,telemetry]
 *
 * Sources: ~/.claude/projects/<proj>/*.jsonl (interactive sessions; --files
 * overrides) and ~/.claude/devops-hook-telemetry.jsonl (written by
 * hooks/lib/hook-telemetry.js; env DEVOPS_HOOK_TELEMETRY). Read-only, no model tokens.
 *
 * weight = tokens of an injection x API requests until the next compaction
 * (every injection is re-sent as cache read on each later request).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? true) : def; };
const ONLY = new Set(String(opt('only', 'hooks,weight,comply,blocks,telemetry')).split(','));
const JSON_OUT = args.includes('--json');

const base = (c) => { const m = String(c || '').match(/([\w.-]+\.(?:js|py|sh|cmd))/g); return m ? m[m.length - 1] : String(c || '?').slice(0, 40); };
const pct = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const kfmt = (n) => Math.round(n / 1000);

function listTranscripts() {
  if (opt('files')) return String(opt('files')).split(',').filter((p) => fs.existsSync(p));
  const root = path.join(os.homedir(), '.claude', 'projects');
  const since = Date.now() - Number(opt('days', 14)) * 86400000;
  const minBytes = Number(opt('min-kb', 200)) * 1024;
  const out = [];
  for (const d of safeDir(root)) {
    for (const e of safeDir(path.join(root, d))) {
      if (!e.endsWith('.jsonl')) continue;
      const p = path.join(root, d, e);
      const st = fs.statSync(p);
      if (st.size >= minBytes && st.mtimeMs >= since) out.push(p);
    }
  }
  return out;
}
function safeDir(d) { try { return fs.readdirSync(d); } catch { return []; } }

/** The text a hook injected (additionalContext / reason / systemMessage / raw stdout). */
function outText(stdout, content) {
  let t = '';
  if (stdout) {
    try {
      const j = JSON.parse(stdout.trim());
      t = (j.hookSpecificOutput && (j.hookSpecificOutput.additionalContext || j.hookSpecificOutput.permissionDecisionReason)) || '';
      if (j.systemMessage) t += j.systemMessage;
      if (j.reason) t += j.reason;
    } catch { t = stdout; }
  }
  return t || content || '';
}

const isPrompt = (o) => o.type === 'user' && !o.isMeta && o.message
  && (typeof o.message.content === 'string'
    || (Array.isArray(o.message.content) && !o.message.content.some((c) => c.type === 'tool_result')));

/** One pass over a transcript: the event list every report is computed from. */
function parse(file) {
  const ev = [];
  const seen = new Set();
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === 'assistant' && o.message) {
      if (o.message.id && !seen.has(o.message.id)) { seen.add(o.message.id); ev.push({ k: 'req' }); }
      if (Array.isArray(o.message.content)) {
        for (const c of o.message.content) {
          if (c.type === 'text' && c.text.trim()) ev.push({ k: 'text', text: c.text });
          if (c.type === 'tool_use') ev.push({ k: 'use', id: c.id, name: c.name, input: c.input || {} });
        }
      }
    }
    if (o.type === 'system' && o.subtype === 'compact_boundary') ev.push({ k: 'compact' });
    if (isPrompt(o)) ev.push({ k: 'prompt' });
    if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
      for (const c of o.message.content) {
        if (c.type !== 'tool_result') continue;
        const txt = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.map((x) => x.text || '').join('') : '');
        ev.push({ k: 'result', id: c.tool_use_id, err: !!c.is_error, txt });
      }
    }
    if (o.type === 'system' && o.subtype === 'stop_hook_summary') {
      for (const h of o.hookInfos || []) if (h.durationMs != null) ev.push({ k: 'dur', event: 'Stop', hook: base(h.command), ms: h.durationMs });
    }
    if (o.type !== 'attachment' || !/^hook_/.test(o.attachment.type)) continue;
    const a = o.attachment;
    const hook = `${a.hookEvent} ${base(a.command)}`;
    if (a.type === 'hook_success') {
      const t = outText(a.stdout, a.content);
      ev.push({ k: 'hook', hook, text: t, ms: a.durationMs });
    } else if (a.type === 'hook_non_blocking_error') ev.push({ k: 'hookerr', hook, ms: a.durationMs });
    else if (a.type === 'hook_cancelled') ev.push({ k: 'hookcancel', hook, timedOut: !!a.timedOut, ms: a.durationMs });
    else if (a.type === 'hook_blocking_error') {
      const be = (a.blockingError && a.blockingError.blockingError) || '';
      const m = be.match(/^\[([\w.-]+)\]/);
      ev.push({ k: 'block', hook: `${a.hookEvent} ${m ? `${m[1]}.js` : '?'}`, text: be });
    }
  }
  return ev;
}

function hookTable(sessions) {
  const H = {};
  const get = (k) => H[k] || (H[k] = { hook: k, out: 0, chars: 0, blk: 0, err: 0, tmo: 0, tmoS: 0, dur: [] });
  for (const ev of sessions) {
    for (const e of ev) {
      if (e.k === 'hook') { const r = get(e.hook); if (e.ms != null) r.dur.push(e.ms); if (e.text) { r.out++; r.chars += e.text.length; } }
      if (e.k === 'hookerr') { const r = get(e.hook); r.err++; if (e.ms != null) r.dur.push(e.ms); }
      if (e.k === 'hookcancel') { const r = get(e.hook); if (e.timedOut) { r.tmo++; r.tmoS += (e.ms || 0) / 1000; } }
      if (e.k === 'block') { const r = get(e.hook); r.blk++; r.chars += e.text.length; }
      if (e.k === 'dur') get(`Stop ${e.hook}`).dur.push(e.ms);
    }
  }
  return Object.values(H).map((r) => ({
    hook: r.hook.slice(0, 52), out: r.out, kchar: kfmt(r.chars), blk: r.blk, err: r.err, tmo: r.tmo, tmoS: Math.round(r.tmoS),
    p50: pct(r.dur, 0.5), p95: pct(r.dur, 0.95), max: r.dur.length ? Math.max(...r.dur) : null, n: r.dur.length,
  })).sort((a, b) => b.kchar - a.kchar || b.tmoS - a.tmoS);
}

function weightTable(sessions) {
  const W = {};
  for (const ev of sessions) {
    let reqAfter = 0;
    const after = new Array(ev.length);
    for (let i = ev.length - 1; i >= 0; i--) { if (ev[i].k === 'compact') reqAfter = 0; if (ev[i].k === 'req') reqAfter++; after[i] = reqAfter; }
    ev.forEach((e, i) => {
      if ((e.k !== 'hook' && e.k !== 'block') || !e.text) return;
      const w = W[e.hook] || (W[e.hook] = { n: 0, tok: 0, weight: 0 });
      w.n++; w.tok += e.text.length / 4; w.weight += (e.text.length / 4) * after[i];
    });
  }
  return Object.entries(W).map(([hook, v]) => ({ hook: hook.slice(0, 60), n: v.n, avgTok: Math.round(v.tok / v.n), MtokResent: +(v.weight / 1e6).toFixed(1) }))
    .sort((a, b) => b.MtokResent - a.MtokResent);
}

/** After a hook instruction, does the model do what it asked within `window` steps? Extend CHECKS per hook. */
const CHECKS = [
  { name: 'pre.agent.announce -> card relayed', trig: /^Agent card — show the user/, ok: (s) => s.k === 'text' && /gestartet|started|\| Agent \|/.test(s.text), window: 12 },
  { name: 'post.flow.debug -> Skill auto-fix', trig: /^Repeated shell failure detected/, ok: (s) => s.k === 'use' && s.name === 'Skill' && /auto-fix/.test(JSON.stringify(s.input)), window: 3 },
  { name: 'prompt.ship.detect -> do-ship', trig: /^\[prompt\.ship\.detect\] Ship intent/, ok: (s) => s.k === 'use' && (/do-ship/.test(JSON.stringify(s.input)) || /ship_preflight|ship_build/.test(s.name)), window: 12 },
  { name: 'title-work New work -> set_session_title', trig: /^\[prompt\.flow\.title-work\] New work/, ok: (s) => s.k === 'use' && /set_session_title|get_session/.test(s.name), window: 3 },
  { name: 'ss.git.check -> EnterWorktree before Edit/Write', trig: /^Workspace rule at session start/, ok: (s) => s.k === 'use' && s.name === 'EnterWorktree', fail: (s) => s.k === 'use' && (s.name === 'Edit' || s.name === 'Write'), window: 400 },
  { name: 'concept.resume -> concept resumed', trig: /^An open \/auto-concept session was/, ok: (s) => s.k === 'use' && /concept/.test(JSON.stringify(s.input) + s.name), window: 6 },
];

function complianceTable(sessions) {
  const R = {};
  for (const ev of sessions) {
    ev.forEach((e, i) => {
      if (e.k !== 'hook' || !e.text) return;
      for (const ch of CHECKS) {
        if (!ch.trig.test(e.text)) continue;
        const r = R[ch.name] || (R[ch.name] = { fired: 0, ok: 0, fail: 0 });
        r.fired++;
        let seen = 0;
        for (let j = i + 1; j < ev.length && seen < ch.window; j++) {
          if (!['use', 'text'].includes(ev[j].k)) continue;
          seen++;
          if (ch.ok(ev[j])) { r.ok++; break; }
          if (ch.fail && ch.fail(ev[j])) { r.fail++; break; }
        }
      }
    });
  }
  return R;
}

/** PreToolUse blocks per hook (tool results carrying the hook error) and what followed a token-guard block. */
function blockTable(sessions) {
  const blocks = {};
  const tg = { blocked: 0, sameRetry: 0, narrowed: 0, other: 0 };
  for (const ev of sessions) {
    const uses = {};
    ev.forEach((e) => { if (e.k === 'use') uses[e.id] = e; });
    ev.forEach((e, i) => {
      if (e.k !== 'result' || !e.err) return;
      const m = e.txt.match(/PreToolUse:\w+ hook error: \[node "[^"]*?[\\/]([\w.-]+\.js)"\]/) || e.txt.match(/PreToolUse:\w+ hook error: .*?(\w+\.[\w.-]+\.js)/);
      if (!m) return;
      blocks[m[1]] = (blocks[m[1]] || 0) + 1;
      if (m[1] !== 'pre.tokens.guard.js' || !uses[e.id]) return;
      tg.blocked++;
      const nx = ev.slice(i + 1).find((x) => x.k === 'use');
      if (nx && nx.name === uses[e.id].name && JSON.stringify(nx.input) === JSON.stringify(uses[e.id].input)) tg.sameRetry++;
      else if (nx && nx.name === uses[e.id].name) tg.narrowed++;
      else tg.other++;
    });
  }
  return { blocks, tokenGuard: tg };
}

/** Telemetry file (silent hooks included): runs, duration, outcome mix, chars, killed (start without end). */
function telemetryTable(file) {
  const rows = {};
  const starts = new Map();
  const ended = new Set();
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n'); } catch { return []; } };
  for (const l of [...read(`${file}.1`), ...read(file)]) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    if (!r || !r.hook) continue;
    const row = rows[r.hook] || (rows[r.hook] = { hook: r.hook, runs: 0, ok: 0, output: 0, block: 0, error: 0, killed: 0, chars: 0, ms: [] });
    if (r.phase === 'start') starts.set(r.id, { hook: r.hook, ts: r.ts });
    if (r.phase === 'end') { ended.add(r.id); row.runs++; row[r.outcome] = (row[r.outcome] || 0) + 1; row.chars += r.chars || 0; row.ms.push(r.ms); }
  }
  for (const [id, s] of starts) if (!ended.has(id) && Date.now() - s.ts > 120000) { rows[s.hook].killed++; rows[s.hook].runs++; }
  return Object.values(rows).map((r) => ({
    hook: r.hook, runs: r.runs, ok: r.ok, output: r.output, block: r.block, error: r.error, killed: r.killed,
    killPct: r.runs ? +(100 * r.killed / r.runs).toFixed(1) : 0, kchar: kfmt(r.chars), p50: pct(r.ms, 0.5), p95: pct(r.ms, 0.95), max: r.ms.length ? Math.max(...r.ms) : null,
  })).sort((a, b) => b.killPct - a.killPct || (b.p95 || 0) - (a.p95 || 0));
}

function main() {
  const report = {};
  let sessions = [];
  if (['hooks', 'weight', 'comply', 'blocks'].some((s) => ONLY.has(s))) {
    const files = listTranscripts();
    sessions = files.map(parse);
    report.sessions = files.length;
    if (ONLY.has('hooks')) report.hooks = hookTable(sessions);
    if (ONLY.has('weight')) report.weight = weightTable(sessions);
    if (ONLY.has('comply')) report.comply = complianceTable(sessions);
    if (ONLY.has('blocks')) report.blocks = blockTable(sessions);
  }
  if (ONLY.has('telemetry')) {
    report.telemetry = telemetryTable(String(opt('telemetry', process.env.DEVOPS_HOOK_TELEMETRY || path.join(os.homedir(), '.claude', 'devops-hook-telemetry.jsonl'))));
  }
  if (JSON_OUT) { process.stdout.write(`${JSON.stringify(report, null, 1)}\n`); return; }
  for (const [k, v] of Object.entries(report)) {
    console.log(`\n## ${k}`);
    if (Array.isArray(v)) console.table(v); else console.log(v);
  }
}

if (require.main === module) main();

module.exports = { parse, hookTable, weightTable, complianceTable, blockTable, telemetryTable, outText, CHECKS };
