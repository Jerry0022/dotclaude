'use strict';
/**
 * @module plugin-audit/footprint
 * @version 0.1.0
 * @description Static footprint of the CURRENT checkout: what devops and
 *   local-llm put into the model's context before any work happens.
 *     skills         name + description of every SKILL.md (listed every session)
 *     agents         name + description of every agent
 *     mcpTools       tool name + title + description + schema .describe() text,
 *                    read from the `registerTool(` calls in the mcp-server
 *                    sources (head of the call up to the handler)
 *     alwaysOnDocs   deep-knowledge docs SessionStart injects in full
 *                    (ALWAYS_ON of ss.knowledge.index.js)
 *     sessionStart / userPromptSubmit
 *                    stdout of the hooks that are safe to execute with a
 *                    fixture (ss.knowledge.index, prompt.knowledge.dispatch -
 *                    pure text emitters). Every other hook is NOT executed
 *                    (side effects: updates, reaps, git sync) and is listed
 *                    under `notExecuted`; their cost is therefore a lower bound.
 *   Tokens ~ chars / 3.5. Output per component and in total.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokensOfChars, run, walk, readText, readJson, rel } = require('./util');

/** Hooks executed with a fixture to measure their real stdout. */
const SAFE_HOOKS = [
  { event: 'SessionStart', rel: 'hooks/session-start/ss.knowledge.index.js', stdin: { hook_event_name: 'SessionStart', source: 'startup' } },
  { event: 'UserPromptSubmit', rel: 'hooks/user-prompt-submit/prompt.knowledge.dispatch.js', stdin: { hook_event_name: 'UserPromptSubmit', prompt: 'hallo' } },
];

/** Parse the YAML frontmatter `name` and (possibly folded) `description`. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const k = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (!k) continue;
    let val = k[2];
    if (/^[>|][+-]?$/.test(val)) {
      const parts = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      val = parts.join(' ');
    }
    out[k[1]] = val.replace(/^["']|["']$/g, '');
  }
  return out;
}

function pluginDirs(root) {
  const base = path.join(root, 'plugins');
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
}

function component(name, items) {
  const chars = items.reduce((n, i) => n + i.chars, 0);
  return { name, count: items.length, chars, tokens: tokensOfChars(chars), items: items.map((i) => ({ ...i, tokens: tokensOfChars(i.chars) })) };
}

function skillItems(root, plugin) {
  const dir = path.join(root, 'plugins', plugin, 'skills');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const items = [];
  for (const n of names) {
    const f = path.join(dir, n, 'SKILL.md');
    const fm = frontmatter(readText(f));
    if (!fm.name && !fm.description) continue;
    items.push({ id: `${plugin}:${n}`, file: rel(root, f), chars: `${fm.name || n}: ${fm.description || ''}`.length });
  }
  return items;
}

function agentItems(root, plugin) {
  const dir = path.join(root, 'plugins', plugin, 'agents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  return files.map((f) => {
    const fm = frontmatter(readText(path.join(dir, f)));
    return { id: `${plugin}:${f.replace(/\.md$/, '')}`, file: rel(root, path.join(dir, f)), chars: `${fm.name || f}: ${fm.description || ''}`.length };
  });
}

/** String literals in a source slice (single, double, template without ${}). */
function stringLiterals(src) {
  const out = [];
  const re = /"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** Tool definitions (name + declared text size) of one mcp-server source file. */
function mcpToolsOfSource(src, file) {
  const items = [];
  const starts = [];
  const re = /registerTool\(/g;
  let m;
  while ((m = re.exec(src))) starts.push(m.index + m[0].length);
  for (const s of starts) {
    const tail = src.slice(s, s + 12000);
    const hm = /async\s*\(|\)\s*=>\s*[{(]|async\s+function/.exec(tail);
    const head = hm ? tail.slice(0, hm.index) : tail.slice(0, 2000);
    const lits = stringLiterals(head);
    const name = lits[0] || 'registerTool(' + s + ')';
    items.push({ id: name, file, chars: lits.reduce((n, l) => n + l.length, 0) + 40 });
  }
  return items;
}

function mcpItems(root, plugin) {
  const dir = path.join(root, 'plugins', plugin, 'mcp-server');
  const files = walk(dir, (p) => p.endsWith('.js') && !p.endsWith('.test.js'));
  const items = [];
  for (const f of files) {
    const src = readText(f);
    if (src && src.includes('registerTool(')) items.push(...mcpToolsOfSource(src, rel(root, f)));
  }
  return items;
}

function alwaysOnItems(root) {
  const hook = path.join(root, 'plugins/devops/hooks/session-start/ss.knowledge.index.js');
  const src = readText(hook) || '';
  const m = /const ALWAYS_ON = \[([^\]]*)\]/.exec(src);
  const names = m ? stringLiterals(m[1]) : [];
  return names.map((n) => {
    const f = path.join(root, 'plugins/devops/deep-knowledge', n);
    const t = readText(f);
    return { id: n, file: rel(root, f), chars: t ? t.length : 0 };
  });
}

/** Execute the safe hooks once; returns measured stdout sizes. */
function measureHooks(root) {
  const pluginRoot = path.join(root, 'plugins', 'devops');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-audit-fp-'));
  const result = { SessionStart: [], UserPromptSubmit: [] };
  try {
    for (const h of SAFE_HOOKS) {
      const file = path.join(pluginRoot, h.rel);
      if (!fs.existsSync(file)) continue;
      const stdin = JSON.stringify({ session_id: `audit-fp-${process.pid}-${Date.now()}`, cwd, ...h.stdin });
      const r = run('node', [file], { cwd, input: stdin, timeout: 15000, env: { CLAUDE_PLUGIN_ROOT: pluginRoot, DEVOPS_COMPLETION_NO_USAGE: '1' } });
      let text = r.stdout;
      try {
        const j = JSON.parse(r.stdout);
        text = (j.hookSpecificOutput && j.hookSpecificOutput.additionalContext) || j.additionalContext || r.stdout;
      } catch { /* raw stdout */ }
      result[h.event].push({ id: path.basename(h.rel, '.js'), file: h.rel, chars: text.length, ok: r.ok });
    }
  } finally {
    try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  return result;
}

/** Names of registered hooks per event that were NOT executed. */
function unexecutedHooks(root) {
  const out = { SessionStart: [], UserPromptSubmit: [] };
  const executed = new Set(SAFE_HOOKS.map((h) => path.basename(h.rel)));
  for (const plugin of pluginDirs(root)) {
    const cfg = readJson(path.join(root, 'plugins', plugin, 'hooks', 'hooks.json'), null);
    if (!cfg || !cfg.hooks) continue;
    for (const ev of Object.keys(out)) {
      for (const g of cfg.hooks[ev] || []) {
        for (const h of g.hooks || []) {
          const base = path.basename(String(h.command || '').split(/\s+/).pop() || '');
          if (base && !executed.has(base)) out[ev].push(`${plugin}/${base}`);
        }
      }
    }
  }
  return out;
}

/**
 * @param {{root?:string, execHooks?:boolean}} [opts]
 * @returns {{components:object[], totalChars:number, totalTokens:number, notExecuted:object, notes:string[]}}
 */
function collect({ root = process.cwd(), execHooks = true } = {}) {
  const plugins = pluginDirs(root);
  const skills = []; const agents = []; const mcp = [];
  for (const p of plugins) { skills.push(...skillItems(root, p)); agents.push(...agentItems(root, p)); mcp.push(...mcpItems(root, p)); }
  const components = [
    component('skills (frontmatter)', skills),
    component('agents (description)', agents),
    component('mcp tool schemas', mcp),
    component('always-on deep-knowledge', alwaysOnItems(root)),
  ];
  const notes = ['MCP tool size is read statically from registerTool() calls (names, titles, descriptions, .describe() text); the JSON-schema wrapper adds roughly 10-20% on top.'];
  const unexec = unexecutedHooks(root);
  if (execHooks) {
    const m = measureHooks(root);
    components.push(component('SessionStart hook output (measured)', m.SessionStart));
    components.push(component('UserPromptSubmit injection per prompt (measured)', m.UserPromptSubmit));
    notes.push(`Only ${SAFE_HOOKS.length} text-emitting hooks are executed; ${unexec.SessionStart.length} further SessionStart and ${unexec.UserPromptSubmit.length} UserPromptSubmit hooks emit conditionally or have side effects and are not run - their output is NOT in the total (lower bound).`);
  } else {
    components.push(component('SessionStart hook output (measured)', []));
    components.push(component('UserPromptSubmit injection per prompt (measured)', []));
    notes.push('Hooks were not executed (execHooks=false).');
  }
  const totalChars = components.reduce((n, c) => n + c.chars, 0);
  return { components, totalChars, totalTokens: tokensOfChars(totalChars), notExecuted: unexec, notes };
}

module.exports = { collect, frontmatter, mcpToolsOfSource, stringLiterals, SAFE_HOOKS };
