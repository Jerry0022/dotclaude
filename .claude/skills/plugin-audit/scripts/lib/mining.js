'use strict';
/**
 * @module plugin-audit/mining
 * @version 0.1.0
 * @description Streams Claude Code transcripts (`~/.claude/projects/<project>/*.jsonl`,
 *   top level only - subagent transcripts are covered by the parent's Agent
 *   result) line by line and attributes tokens.
 *
 *   Per session: total usage tokens (assistant `usage`, de-duplicated by
 *   message id), plugin-attributable tokens, compactions, project.
 *   Plugin-attributable (all character counts / 3.5, except subagent tokens
 *   which the Agent result reports):
 *     hookContext   hook additionalContext / system messages / blocking errors
 *                   whose text carries a devops hook tag ("[ss.x]", "[prompt.x]",
 *                   "[devops]", "[delegation-policy]", "[skill-overrides]" ...)
 *     skillLoads    "Base directory for this skill: ...devops..." payloads
 *     mcpResults    tool results of mcp__plugin_devops_* tools
 *     subagents     reported total tokens of Agent spawns with subagent_type devops:*
 *
 *   Benefit proxies (honest scope):
 *     delegation    subagent tokens x (1 - price ratio of its model / opus)
 *     token-guard / local-llm   never measured; the savings log
 *                   (~/.claude/devops-savings.jsonl, hooks/lib/savings-log.js)
 *                   gives labelled ESTIMATES, without it only block FREQUENCY
 *     version       "[devops] version=X" (ss.project.setup) per session, else
 *                   attributed by time window (byVersion)
 *     spawn model   "[agent-model] id=.. model=.." (pre.agent.announce) when the
 *                   Agent input/result names none
 *     rework        repeated failing Bash commands, auto-fix loads, "does not
 *                   work" prompts
 *     gateCatches   guard refusals by rule (session-grader's signal table) -
 *                   FREQUENCY only, never token savings
 *   Window: since the last audit (`since`), else `days` (default 30) by mtime.
 *   Files over 200 MB are skipped with a note.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { tokensOfChars } = require('./util');

// pre.ship.guard refusals carry `[ship-guard:<rule>]`; refusals without it count as 'untagged'.
const SHIP_GUARD_TAG_RE = /\[ship-guard:([a-z0-9-]+)\]/;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Relative price per token by model family (opus = 1). Approximation from the
 * public list prices (opus 5 : sonnet 3 : haiku 1 per MTok input); adjust here
 * when pricing changes. Unknown model -> 1 (no saving claimed).
 */
const PRICE_RATIO = { opus: 1, sonnet: 0.6, haiku: 0.2, unknown: 1 };

const HOOK_TAG_RE = /\[(?:(?:ss|prompt|pre|post|sub|substop|stop)\.[\w.-]+|devops|delegation(?:-policy)?|skill-overrides|token-guard|card-pregate|agent-card-relay|agent-model|run-contract)\]/;
const FRUSTRATION_RE = /funktioniert nicht|doesn'?t work|does not work|broken/i;
// Markers the plugin writes into transcript-visible hook context:
//   ss.project.setup      "[devops] version=0.290.0"
//   pre.agent.announce    "[agent-model] id=<tool_use_id> type=<t> model=<m>"
const VERSION_RE = /\[devops\] version=(\d+\.\d+\.\d+[\w.+-]*)/;
const AGENT_MODEL_RE = /\[agent-model\] id=(\S+) type=\S+ model=(\S+)/g;
const TOKEN_GUARD_RE = /\[(?:pre\.tokens\.guard|token-guard)\]/;

function modelFamily(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x && (x.text || (typeof x.content === 'string' ? x.content : textOf(x.content))) || '')).join('\n');
  return '';
}

function compileGateSignals(repoRoot) {
  try {
    const grader = require(path.join(repoRoot, 'plugins/devops/scripts/session-grader.js'));
    return grader.DEFAULT_RULES.filter((r) => (r.signals || []).length)
      .map((r) => ({ id: r.id, res: r.signals.map((s) => new RegExp(s)) }));
  } catch { return null; }
}

/** Per-session accumulator fed with parsed transcript objects. */
function createSession(project, gate) {
  const s = {
    project, usageById: new Map(), compactions: 0, pluginTokens: { hookContext: 0, skillLoads: 0, mcpResults: 0 },
    subagents: [], toolNames: new Map(), bashFail: new Map(), autoFix: 0, frustration: 0, tokenGuardBlocks: 0,
    gate: {}, shipBlocks: {}, firstTs: null, lastTs: null, version: null, spawnModels: new Map(),
  };
  const countGate = (text) => {
    if (TOKEN_GUARD_RE.test(text)) s.tokenGuardBlocks++;
    const tagged = SHIP_GUARD_TAG_RE.exec(text);
    if (tagged || text.includes('BLOCKED: Manual PR creation')) {
      const rule = tagged ? tagged[1] : 'untagged';
      s.shipBlocks[rule] = (s.shipBlocks[rule] || 0) + 1;
    }
    if (!gate) return;
    for (const r of gate) if (r.res.some((re) => re.test(text))) s.gate[r.id] = (s.gate[r.id] || 0) + 1;
  };
  const hookText = (text) => {
    if (!s.version) { const v = VERSION_RE.exec(text); if (v) s.version = v[1]; }
    if (text.includes('[agent-model]')) for (const m of text.matchAll(AGENT_MODEL_RE)) s.spawnModels.set(m[1], m[2]);
    if (HOOK_TAG_RE.test(text)) s.pluginTokens.hookContext += tokensOfChars(text.length);
    countGate(text);
  };

  s.add = (o) => {
    if (o.timestamp) { s.firstTs = s.firstTs || o.timestamp; s.lastTs = o.timestamp; }
    if (o.type === 'system' && o.subtype === 'compact_boundary') { s.compactions++; return; }
    if (o.type === 'attachment' && o.attachment) {
      const a = o.attachment;
      if (a.type === 'hook_additional_context') (Array.isArray(a.content) ? a.content : [a.content]).forEach((t) => typeof t === 'string' && hookText(t));
      else if (a.type === 'hook_system_message' && typeof a.content === 'string') hookText(a.content);
      else if (a.type === 'hook_blocking_error' && a.blockingError) hookText(String(a.blockingError.blockingError || ''));
      else if (a.type === 'invoked_skills' && Array.isArray(a.skills)) {
        for (const sk of a.skills) {
          const c = String(sk.content || '');
          if (/Base directory for this skill:.*devops/i.test(c.slice(0, 400))) s.pluginTokens.skillLoads += tokensOfChars(c.length);
        }
      }
      return;
    }
    if (o.type === 'assistant' && o.message) {
      const u = o.message.usage;
      if (u) {
        const id = o.message.id || o.uuid;
        const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
        s.usageById.set(id, total);
      }
      for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
        if (b.type !== 'tool_use') continue;
        s.toolNames.set(b.id, { name: b.name, input: b.input || {} });
        if (b.name === 'Skill' && /auto-fix/.test(String(b.input && (b.input.skill || b.input.name)))) s.autoFix++;
      }
      return;
    }
    if (o.type === 'user' && o.message) {
      const content = o.message.content;
      if (typeof content === 'string') { if (FRUSTRATION_RE.test(content) && !/<system-reminder>|<task-notification>/.test(content.slice(0, 40))) s.frustration++; return; }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === 'text' && FRUSTRATION_RE.test(b.text || '') && !/^<(?:system-reminder|task-notification)/.test(b.text)) s.frustration++;
        if (b.type !== 'tool_result') continue;
        const text = textOf(b.content);
        const call = s.toolNames.get(b.tool_use_id) || { name: '', input: {} };
        if (/^mcp__plugin_devops_/.test(call.name)) s.pluginTokens.mcpResults += tokensOfChars(text.length);
        if (/Base directory for this skill:.*devops/i.test(text.slice(0, 400))) s.pluginTokens.skillLoads += tokensOfChars(text.length);
        if (/^(Agent|Task)$/.test(call.name) && /^devops:/.test(String(call.input.subagent_type || ''))) {
          const tr = o.toolUseResult || {};
          const m = /(?:subagent_tokens|total_?tokens|totalTokens)\D{0,6}(\d+)/i.exec(text);
          const tokens = Number(tr.totalTokens || tr.total_tokens || (m && m[1]) || 0);
          s.subagents.push({ type: call.input.subagent_type, id: b.tool_use_id, explicit: modelFamily(call.input.model || tr.model), model: 'unknown', tokens });
        }
        if (b.is_error && call.name === 'Bash') {
          const key = String(call.input.command || '').slice(0, 40);
          s.bashFail.set(key, (s.bashFail.get(key) || 0) + 1);
        }
        if (b.is_error || /BLOCKED|^\[/.test(text.slice(0, 20))) countGate(text);
      }
    }
  };

  s.finish = () => {
    const tokens = [...s.usageById.values()].reduce((n, v) => n + v, 0);
    const hookCtx = s.pluginTokens.hookContext;
    // Model: explicit input/result field, else the pre.agent.announce marker, else unknown.
    for (const a of s.subagents) a.model = a.explicit !== 'unknown' ? a.explicit : modelFamily(s.spawnModels.get(a.id));
    return {
      project, tokens, compactions: s.compactions,
      plugin: { ...s.pluginTokens, subagentTokens: s.subagents.reduce((n, a) => n + a.tokens, 0), total: hookCtx + s.pluginTokens.skillLoads + s.pluginTokens.mcpResults },
      subagents: s.subagents,
      rework: { repeatedBashFailures: [...s.bashFail.values()].filter((n) => n >= 2).length, autoFixLoads: s.autoFix, frustrationPrompts: s.frustration },
      tokenGuardBlocks: s.tokenGuardBlocks, gate: s.gate, shipBlocks: s.shipBlocks, firstTs: s.firstTs, lastTs: s.lastTs, version: s.version,
    };
  };
  return s;
}

async function mineFile(file, project, gate) {
  const s = createSession(project, gate);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    s.add(o);
  }
  return s.finish();
}

function listFiles(projectsDir, sinceMs) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(projectsDir, d.name), { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl') || f.name.startsWith('agent-')) continue;
      const fp = path.join(projectsDir, d.name, f.name);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (st.mtimeMs >= sinceMs) out.push({ file: fp, project: d.name, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out;
}

/**
 * @param {{root?:string, projectsDir?:string, since?:string|number, days?:number, now?:number}} opts
 *   `root` = repo root (session-grader signal table); `projectsDir` defaults to ~/.claude/projects.
 */
/**
 * The plugin's savings log (hooks/lib/savings-log.js): estimates written by
 * pre.tokens.guard and the local-llm delegation. Absent/unreadable -> null.
 * Token guard: a 'blocked' call only counts as avoided when no 'released'
 * (the same call went ahead after the retry) cancels it - estimate, not a
 * measurement.
 */
function readSavings(file, sinceMs) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const t = { blocked: 0, released: 0, blockedTokens: 0, releasedTokens: 0 };
  const l = { delegations: 0, estTokens: 0 };
  let lines = 0;
  for (const raw of text.split('\n')) {
    if (!raw || raw[0] !== '{') continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    if (!o || (o.ts && new Date(o.ts).getTime() < sinceMs)) continue;
    const n = Number(o.estTokens) || 0;
    if (o.source === 'token-guard' && o.op === 'blocked') { t.blocked++; t.blockedTokens += n; lines++; }
    else if (o.source === 'token-guard' && o.op === 'released') { t.released++; t.releasedTokens += n; lines++; }
    else if (o.source === 'local-llm' && o.op === 'delegated') { l.delegations++; l.estTokens += n; lines++; }
  }
  return lines ? { lines, tokenGuard: { ...t, avoidedEstimate: Math.max(0, t.blockedTokens - t.releasedTokens) }, localLlm: l } : null;
}

async function mine({ root = process.cwd(), projectsDir, since, days = 30, now = Date.now(), savingsLog } = {}) {
  const dir = projectsDir || path.join(os.homedir(), '.claude', 'projects');
  const sinceMs = since ? new Date(since).getTime() : now - days * 86400000;
  const gate = compileGateSignals(root);
  const notes = [];
  if (!gate) notes.push('session-grader signal table not loadable - gate catches not counted');
  const files = listFiles(dir, sinceMs);
  const sessions = [];
  const skipped = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) { skipped.push({ file: path.basename(f.file), reason: `larger than 200 MB (${Math.round(f.size / 1048576)} MB)` }); continue; }
    try { sessions.push(await mineFile(f.file, f.project, gate)); } catch (e) { skipped.push({ file: path.basename(f.file), reason: e.message }); }
  }
  const logFile = savingsLog || process.env.DEVOPS_SAVINGS_LOG || path.join(os.homedir(), '.claude', 'devops-savings.jsonl');
  return summarize(sessions, { sinceMs, now, skipped, notes, files: files.length, savings: readSavings(logFile, sinceMs) });
}

/**
 * Sessions per plugin version. Tagged sessions carry `[devops] version=` in
 * their SessionStart context (exact). An untagged session (older plugin) is
 * attributed by time window: the version of the latest tagged session that
 * started before it, flagged `inferred`; with none before it -> 'unknown'.
 */
function attributeVersions(sessions) {
  const order = [...sessions].sort((a, b) => String(a.firstTs || '').localeCompare(String(b.firstTs || '')));
  const out = {};
  let last = null;
  for (const s of order) {
    let v = s.version, inferred = false;
    if (v) last = v; else { v = last || 'unknown'; inferred = !!last; }
    const b = (out[v] = out[v] || { sessions: 0, inferredSessions: 0, tokens: 0, pluginTokens: 0 });
    b.sessions++; if (inferred) b.inferredSessions++;
    b.tokens += s.tokens; b.pluginTokens += s.plugin.total;
  }
  return out;
}

function summarize(sessions, { sinceMs, now, skipped, notes, files, savings = null }) {
  const sum = (fn) => sessions.reduce((n, s) => n + fn(s), 0);
  const byProject = {};
  for (const s of sessions) {
    const p = (byProject[s.project] = byProject[s.project] || { sessions: 0, tokens: 0, pluginTokens: 0 });
    p.sessions++; p.tokens += s.tokens; p.pluginTokens += s.plugin.total;
  }
  const shipBlocks = {};
  for (const s of sessions) for (const [k, v] of Object.entries(s.shipBlocks || {})) shipBlocks[k] = (shipBlocks[k] || 0) + v;
  const gate = {};
  for (const s of sessions) for (const [k, v] of Object.entries(s.gate)) gate[k] = (gate[k] || 0) + v;
  const subagents = sessions.flatMap((s) => s.subagents);
  const delegation = { spawns: subagents.length, byModel: {}, savedOpusEquivalentTokens: 0, priceRatio: PRICE_RATIO };
  for (const a of subagents) {
    const b = (delegation.byModel[a.model] = delegation.byModel[a.model] || { spawns: 0, tokens: 0 });
    b.spawns++; b.tokens += a.tokens;
    delegation.savedOpusEquivalentTokens += Math.round(a.tokens * (1 - (PRICE_RATIO[a.model] ?? 1) / PRICE_RATIO.opus));
  }
  const totalTokens = sum((s) => s.tokens);
  const pluginInContext = sum((s) => s.plugin.total);
  const subagentTokens = sum((s) => s.plugin.subagentTokens);
  return {
    window: { since: new Date(sinceMs).toISOString(), until: new Date(now).toISOString() },
    files, skipped, notes,
    totals: {
      sessions: sessions.length, tokens: totalTokens, compactions: sum((s) => s.compactions),
      pluginInContextTokens: pluginInContext, pluginSubagentTokens: subagentTokens,
      pluginShare: totalTokens ? Number(((pluginInContext + subagentTokens) / totalTokens).toFixed(4)) : 0,
      hookContextTokens: sum((s) => s.plugin.hookContext), skillLoadTokens: sum((s) => s.plugin.skillLoads), mcpResultTokens: sum((s) => s.plugin.mcpResults),
    },
    byProject,
    byVersion: attributeVersions(sessions),
    benefit: {
      delegation,
      tokenGuard: savings && savings.tokenGuard.blocked
        ? { measurable: false, estimated: true, note: 'ESTIMATE from the savings log: blocked call cost minus calls released unchanged', blocks: sum((s) => s.tokenGuardBlocks), ...savings.tokenGuard }
        : { measurable: false, note: 'no savings-log entries in the window - only block frequency is known', blocks: sum((s) => s.tokenGuardBlocks) },
      localLlm: savings && savings.localLlm.delegations
        ? { measurable: false, estimated: true, note: 'ESTIMATE from the savings log: output tokens Claude did not have to write', ...savings.localLlm }
        : { measurable: false, note: 'no savings-log entries in the window - delegations are not measured' },
      rework: {
        repeatedBashFailures: sum((s) => s.rework.repeatedBashFailures), autoFixLoads: sum((s) => s.rework.autoFixLoads),
        frustrationPrompts: sum((s) => s.rework.frustrationPrompts),
        perSession: sessions.length ? Number((sum((s) => s.rework.repeatedBashFailures + s.rework.autoFixLoads + s.rework.frustrationPrompts) / sessions.length).toFixed(2)) : 0,
      },
      gateCatches: { kind: 'frequency', note: 'how often a guard refused the model - a frequency, NOT a token saving', byRule: gate, total: Object.values(gate).reduce((n, v) => n + v, 0) },
      shipBlocksByRule: { kind: 'frequency', note: 'blocked manual-ship attempts per [ship-guard:<rule>] tag; untagged = refusal without a tag', byRule: shipBlocks, total: Object.values(shipBlocks).reduce((n, v) => n + v, 0) },
    },
  };
}

module.exports = { readSavings, attributeVersions, mine, mineFile, createSession, summarize, modelFamily, PRICE_RATIO, MAX_FILE_BYTES };
