/**
 * @module agent-card
 * @version 0.1.0
 * @description The one template every agent display uses — the spawn card
 *   `pre.agent.announce` hands Claude for each launch and the plan card
 *   `scripts/agent-card.js` renders for an auto-agents run. One agent, three
 *   or ten: same header, same table, only more rows. Waves become sections
 *   when a card spans more than one; a grouped model · effort tally closes the
 *   card when at least one combination occurs twice.
 *
 *   Pure: takes resolved agents (`model`/`effort` as `resolve()` in
 *   pre.agent.announce returns them), returns markdown.
 */

'use strict';

const L = {
  en: {
    started: (n) => `${n} ${n === 1 ? 'agent' : 'agents'} started`,
    plan: 'Agent plan',
    agents: (n) => `${n} ${n === 1 ? 'agent' : 'agents'}`,
    waves: (n) => `${n} ${n === 1 ? 'wave' : 'waves'}`,
    wave: 'Wave',
    background: 'background',
    foreground: 'foreground',
    newest: 'Models: newest release of each family',
    cols: ['', 'Agent', 'Task', 'Model', 'Effort'],
    tally: 'Mix',
    session: 'session',
    sessionModel: 'session model',
    sessionEffort: 'session',
  },
  de: {
    started: (n) => `${n} ${n === 1 ? 'Agent' : 'Agents'} gestartet`,
    plan: 'Agent-Plan',
    agents: (n) => `${n} ${n === 1 ? 'Agent' : 'Agents'}`,
    waves: (n) => `${n} ${n === 1 ? 'Wave' : 'Waves'}`,
    wave: 'Wave',
    background: 'Hintergrund',
    foreground: 'Vordergrund',
    newest: 'Modelle: jeweils neueste Version der Familie',
    cols: ['', 'Agent', 'Aufgabe', 'Modell', 'Effort'],
    tally: 'Verteilung',
    session: 'Session',
    sessionModel: 'Session-Modell',
    sessionEffort: 'Session',
  },
};

const ICON = {
  core: '🔧', frontend: '🎨', designer: '🖌️', ai: '🧠', qa: '🧪', redteam: '🛡️',
  research: '🔎', po: '🎯', feature: '🧩', windows: '🪟', gamer: '🎮', rethinker: '💡',
  explore: '🔭', plan: '📐', 'general-purpose': '🤖',
};

// Filled dots only — one per level, so a higher level just adds a dot.
const DOTS = { low: '●', medium: '●●', high: '●●●', xhigh: '●●●●', max: '●●●●●' };
const ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable']);

/** `[W1] Build contracts` → { wave: '1', task: 'Build contracts' }. */
function parseWave(description) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  const m = text.match(/^\[W(\d+(?:\.\d+)?)\]\s*/i);
  return m ? { wave: m[1], task: text.slice(m[0].length) } : { wave: null, task: text };
}

/** `devops:core` → `core`; other namespaces stay visible. */
function shortType(type) {
  return String(type || 'general-purpose').replace(/^devops:/, '');
}

function icon(type) {
  const t = shortType(type);
  return ICON[t.toLowerCase()] || ICON[t.split(':').pop().toLowerCase()] || '🤖';
}

function cell(s) {
  return String(s || '—').replace(/\|/g, '\\|');
}

/** Localise the English markers `resolve()` produces for inherited values. */
function modelLabel(model, t) {
  return String(model)
    .replace(/\(session\)/g, `(${t.session})`)
    .replace(/^session model/, t.sessionModel);
}

function effortLabel(effort, t) {
  if (effort === 'session effort') return `◌ ${t.sessionEffort}`;
  if (effort === 'default effort') return '—';
  return DOTS[effort] ? `${DOTS[effort]} ${effort}` : effort;
}

function usesAlias(model) {
  return String(model).split(' → ').some((m) => ALIASES.has(m.trim()));
}

function modeLabel(agents, t) {
  const bg = agents.filter((a) => a.mode !== 'foreground').length;
  const fg = agents.length - bg;
  if (!fg) return t.background;
  if (!bg) return t.foreground;
  return `${bg} ${t.background} · ${fg} ${t.foreground}`;
}

function table(agents, t) {
  const rows = agents.map((a) =>
    `| ${icon(a.type)} | **${cell(shortType(a.type))}** | ${cell(a.task)} | ${cell(modelLabel(a.model, t))} | ${cell(effortLabel(a.effort, t))} |`);
  return [`| ${t.cols.join(' | ')} |`, '|---|---|---|---|---|', ...rows].join('\n');
}

/** `**3×** sonnet ●● medium  ·  **1×** opus ●●● high`, or null when nothing repeats. */
function tally(agents, t) {
  const counts = new Map();
  for (const a of agents) {
    const key = `${modelLabel(a.model, t)} ${effortLabel(a.effort, t)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (![...counts.values()].some((n) => n >= 2)) return null;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `**${n}×** ${k}`)
    .join('  ·  ');
}

/**
 * @param {object} o
 * @param {'start'|'plan'} [o.kind]  start = agents just launched; plan = the run ahead
 * @param {Array<{type:string, task?:string, description?:string, wave?:string|null,
 *   model:string, effort:string, mode?:string}>} o.agents
 * @param {'en'|'de'} [o.lang]
 * @param {string} [o.tier]  plan only: tier label shown in the header
 * @returns {string} markdown card
 */
function renderAgentCard({ kind = 'start', agents, lang = 'en', tier = '' }) {
  const t = L[lang] || L.en;
  const list = (agents || []).map((a) => {
    const parsed = parseWave(a.description);
    return { ...a, wave: a.wave != null ? String(a.wave) : parsed.wave, task: a.task || parsed.task };
  });
  const waves = [...new Set(list.map((a) => a.wave).filter(Boolean))]
    .sort((a, b) => parseFloat(a) - parseFloat(b));

  const head = kind === 'plan'
    ? `### 🗺️ **${t.plan}** · ${t.agents(list.length)}${waves.length > 1 ? ` · ${t.waves(waves.length)}` : ''}${tier ? ` · ${tier}` : ''}`
    : `### 🤖 **${t.started(list.length)}** · ${modeLabel(list, t)}`;

  const out = ['---', head];
  if (list.some((a) => usesAlias(a.model))) out.push(`*${t.newest}*`);
  out.push('');

  if (waves.length > 1 || (waves.length === 1 && kind === 'plan')) {
    const groups = waves.map((w) => [w, list.filter((a) => a.wave === w)]);
    const loose = list.filter((a) => !a.wave);
    if (loose.length) groups.push(['—', loose]);
    for (const [w, group] of groups) {
      out.push(`#### ${t.wave} ${w} · ${t.agents(group.length)}`, table(group, t), '');
    }
  } else {
    if (waves.length === 1) out[1] += ` · ${t.wave} ${waves[0]}`;
    out.push(table(list, t), '');
  }

  const mix = tally(list, t);
  if (mix) out.push(`**Σ ${t.tally}:** ${mix}`);
  else out.pop();
  out.push('---');
  return out.join('\n');
}

module.exports = { renderAgentCard, parseWave, shortType };
