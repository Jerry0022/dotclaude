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
 *     token-guard / local-llm   NOT measurable - no hook logs a saving, so
 *                   only block FREQUENCY is reported (pre.tokens.guard texts)
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

const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Relative price per token by model family (opus = 1). Approximation from the
 * public list prices (opus 5 : sonnet 3 : haiku 1 per MTok input); adjust here
 * when pricing changes. Unknown model -> 1 (no saving claimed).
 */
const PRICE_RATIO = { opus: 1, sonnet: 0.6, haiku: 0.2, unknown: 1 };

const HOOK_TAG_RE = /\[(?:(?:ss|prompt|pre|post|sub|substop|stop)\.[\w.-]+|devops|delegation(?:-policy)?|skill-overrides|token-guard|card-pregate|agent-card-relay|agent-model|run-contract)\]/;
const FRUSTRATION_RE = /funktioniert nicht|doesn'?t work|does not work|broken/i;
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
    gate: {}, firstTs: null, lastTs: null,
  };
  const countGate = (text) => {
    if (TOKEN_GUARD_RE.test(text)) s.tokenGuardBlocks++;
    if (!gate) return;
    for (const r of gate) if (r.res.some((re) => re.test(text))) s.gate[r.id] = (s.gate[r.id] || 0) + 1;
  };
  const hookText = (text) => {
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
          s.subagents.push({ type: call.input.subagent_type, model: modelFamily(call.input.model || tr.model), tokens });
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
    return {
      project, tokens, compactions: s.compactions,
      plugin: { ...s.pluginTokens, subagentTokens: s.subagents.reduce((n, a) => n + a.tokens, 0), total: hookCtx + s.pluginTokens.skillLoads + s.pluginTokens.mcpResults },
      subagents: s.subagents,
      rework: { repeatedBashFailures: [...s.bashFail.values()].filter((n) => n >= 2).length, autoFixLoads: s.autoFix, frustrationPrompts: s.frustration },
      tokenGuardBlocks: s.tokenGuardBlocks, gate: s.gate, firstTs: s.firstTs, lastTs: s.lastTs,
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
async function mine({ root = process.cwd(), projectsDir, since, days = 30, now = Date.now() } = {}) {
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
  return summarize(sessions, { sinceMs, now, skipped, notes, files: files.length });
}

function summarize(sessions, { sinceMs, now, skipped, notes, files }) {
  const sum = (fn) => sessions.reduce((n, s) => n + fn(s), 0);
  const byProject = {};
  for (const s of sessions) {
    const p = (byProject[s.project] = byProject[s.project] || { sessions: 0, tokens: 0, pluginTokens: 0 });
    p.sessions++; p.tokens += s.tokens; p.pluginTokens += s.plugin.total;
  }
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
    benefit: {
      delegation,
      tokenGuard: { measurable: false, note: 'not measurable - no hook logs a saving; only block frequency is known', blocks: sum((s) => s.tokenGuardBlocks) },
      localLlm: { measurable: false, note: 'not measurable - delegations to the local model are not logged with a saved-token figure' },
      rework: {
        repeatedBashFailures: sum((s) => s.rework.repeatedBashFailures), autoFixLoads: sum((s) => s.rework.autoFixLoads),
        frustrationPrompts: sum((s) => s.rework.frustrationPrompts),
        perSession: sessions.length ? Number((sum((s) => s.rework.repeatedBashFailures + s.rework.autoFixLoads + s.rework.frustrationPrompts) / sessions.length).toFixed(2)) : 0,
      },
      gateCatches: { kind: 'frequency', note: 'how often a guard refused the model - a frequency, NOT a token saving', byRule: gate, total: Object.values(gate).reduce((n, v) => n + v, 0) },
    },
  };
}

module.exports = { mine, mineFile, createSession, summarize, modelFamily, PRICE_RATIO, MAX_FILE_BYTES };
