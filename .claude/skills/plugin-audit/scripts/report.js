#!/usr/bin/env node
'use strict';
/**
 * @script plugin-audit/report
 * @version 0.1.0
 * @description Step 4 of the plugin audit: turns <dir>/results.json (+ the
 *   synthesis agent's suggestions.json, if present) into an INTERACTIVE
 *   concept page - the report is never a static file. Builds the concept
 *   source folder <dir>/report/ with the plugin's concept-build (init, one
 *   free-mode round fragment rounds/01.html, build) and prints the built html
 *   path on the last line. Opening the page (bridge + Edge) and handling the
 *   submission is the session's job (auto-concept Step 3 / Step 5).
 *
 *   Sections: Überblick, Nutzen-Proxys, Prüfkatalog, Repo- & Ship-Hygiene,
 *   Verbesserungsvorschläge (one bi-state card per suggestion). All round CSS
 *   is namespaced `.d1-…` (concept gate P32).
 *
 *   Usage: report.js --in <dir> [--state-dir DIR] [--no-build]
 *   concept-build: newest ~/.claude/plugins/cache/dotclaude/devops/<semver>/
 *   scripts/concept-build.js, fallback the repo's own plugins/devops copy.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, readJson, cmpSemver, git } = require('./lib/util');
const state = require('./lib/state');

const STATUS_LABEL = { green: 'grün', yellow: 'gelb', red: 'rot', skipped: 'übersprungen' };

function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x';

function worst(list) {
  if (list.some((c) => c.status === 'red')) return 'red';
  if (list.some((c) => c.status === 'yellow')) return 'yellow';
  if (list.length && list.every((c) => c.status === 'skipped')) return 'skipped';
  return 'green';
}

/** Rule-derived suggestions, used when the synthesis agent did not run. */
function fallbackSuggestions(results) {
  const out = [];
  const all = [...results.integrity.map((c) => ({ ...c, area: 'Integrität' })), ...results.hygiene.map((c) => ({ ...c, area: 'Hygiene' }))];
  for (const c of all) {
    if (c.status !== 'red' && c.status !== 'yellow') continue;
    out.push({
      id: `fix-${c.id}`, title: `${c.title}: ${c.findings.length} Befund(e)`, priority: c.status === 'red' ? 'high' : 'medium', group: c.area,
      evidence: c.findings.slice(0, 4).map((f) => (f.file ? `${f.file}${f.line ? ':' + f.line : ''} - ${f.msg}` : f.msg)),
      change: `Befunde des Checks "${c.id}" abarbeiten.`,
    });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.priority] - order[b.priority]);
}

function light(status) {
  return `<span class="d1-light d1-${esc(status)}" title="${esc(STATUS_LABEL[status] || status)}"></span>`;
}

/** Inline SVG: footprint tokens over PAST AUDIT RUNS (history.json), not per version. */
function curveSvg(history) {
  const pts = history.filter((h) => typeof h.footprintTokens === 'number');
  if (pts.length < 2) return '<p class="d1-note">Noch zu wenige Audit-Läufe für eine Kurve (mindestens 2 nötig).</p>';
  const W = 560; const H = 140; const pad = 28;
  const max = Math.max(...pts.map((p) => p.footprintTokens)); const min = Math.min(...pts.map((p) => p.footprintTokens));
  const span = max - min || 1;
  const xy = pts.map((p, i) => [pad + (i * (W - 2 * pad)) / (pts.length - 1), H - pad - ((p.footprintTokens - min) / span) * (H - 2 * pad)]);
  const dots = xy.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="d1-dot"><title>${esc(pts[i].version)}: ${pts[i].footprintTokens} Tokens</title></circle><text x="${x.toFixed(1)}" y="${H - 8}" class="d1-axis" text-anchor="middle">${esc(pts[i].version)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="d1-curve" role="img" aria-label="Statischer Footprint je Audit-Lauf"><polyline fill="none" class="d1-line" points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>${dots}<text x="${pad}" y="14" class="d1-axis">${max} Tok</text><text x="${pad}" y="${H - 18}" class="d1-axis">${min} Tok</text></svg>`;
}

function checkTable(list) {
  const rows = list.map((c) => {
    const f = c.findings.map((x) => `<li>${esc(x.msg)}${x.file ? ` <code>${esc(x.file)}${x.line ? ':' + x.line : ''}</code>` : ''}</li>`).join('');
    const detail = c.findings.length ? `<details><summary>${c.findings.length} Befund(e)</summary><ul class="d1-list">${f}</ul></details>` : '–';
    return `<tr><td>${light(c.status)}</td><td><strong>${esc(c.title)}</strong><br><code>${esc(c.id)}</code></td><td>${c.durationMs} ms</td><td>${detail}</td></tr>`;
  }).join('');
  return `<table class="d1-table"><thead><tr><th></th><th>Check</th><th>Dauer</th><th>Befunde</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function suggestionCard(s, i) {
  const id = `sug-${slug(s.id || String(i + 1))}`;
  const label = esc(s.title || id);
  const ev = (s.evidence || []).map((e) => `<li>${esc(e)}</li>`).join('');
  return `<div class="d1-card d1-prio-${esc(s.priority || 'medium')}">
  <h3>${label} <span class="d1-badge">${esc(s.priority || 'medium')}</span> <span class="d1-badge d1-group">${esc(s.group || '')}</span></h3>
  <ul class="d1-list">${ev}</ul>
  <p><strong>Änderung:</strong> ${esc(s.change || '')}</p>
  <div class="variant-evaluation" data-decision="${id}" data-label="${label}">
    <div class="eval-group">
      <label class="eval-option">
        <input type="radio" name="eval-${id}" value="discard">
        <span class="eval-label">Verwerfen</span>
      </label>
      <label class="eval-option">
        <input type="radio" name="eval-${id}" value="include" checked>
        <span class="eval-label">Miteinbeziehen</span>
      </label>
    </div>
    <div class="field-row decision-comment-row">
      <label for="${id}-note">Anmerkung</label>
      <textarea id="${id}-note" data-comment="${id}-note" data-attachable placeholder="Anmerkung…" rows="2"></textarea>
    </div>
  </div>
</div>`;
}

const CSS = `
.d1-table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 0.92em; }
.d1-table th, .d1-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border-color, #30363d); vertical-align: top; }
.d1-light { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #8b949e; }
.d1-green { background: #2ea043; }
.d1-yellow { background: #d29922; }
.d1-red { background: #f85149; }
.d1-skipped { background: #8b949e; }
.d1-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 10px 0 16px; }
.d1-tile { border: 1px solid var(--border-color, #30363d); border-radius: 8px; padding: 10px 12px; }
.d1-tile strong { display: block; margin-bottom: 4px; }
.d1-card { border: 1px solid var(--border-color, #30363d); border-radius: 8px; padding: 10px 14px; margin: 12px 0; }
.d1-prio-high { border-left: 4px solid #f85149; }
.d1-prio-medium { border-left: 4px solid #d29922; }
.d1-prio-low { border-left: 4px solid #8b949e; }
.d1-badge { font-size: 0.7em; font-weight: 600; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border-color, #30363d); vertical-align: middle; }
.d1-list { margin: 4px 0 8px 18px; padding: 0; }
.d1-note { opacity: 0.8; font-size: 0.9em; }
.d1-curve { width: 100%; max-width: 560px; height: auto; }
.d1-line { stroke: #58a6ff; stroke-width: 2; }
.d1-dot { fill: #58a6ff; }
.d1-axis { font-size: 9px; fill: currentColor; opacity: 0.7; }
.d1-warn { border: 1px dashed #d29922; border-radius: 8px; padding: 8px 12px; margin: 10px 0; }
`;

/** Blocked ship attempts per `[ship-guard:<rule>]` tag — frequencies, never savings. */
function shipBlocksTable(sb) {
  if (!sb || !sb.byRule) return '';
  const rows = Object.entries(sb.byRule).sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${Number(v) || 0}</td></tr>`).join('');
  return `
  <h3>Blockierte Ship-Versuche nach Regel (nur Häufigkeit)</h3>
  ${sb.note ? `<p class="d1-note">${esc(sb.note)}</p>` : ''}
  <table class="d1-table"><thead><tr><th>Regel</th><th>Versuche</th></tr></thead><tbody>${rows || '<tr><td colspan="2">keine</td></tr>'}</tbody></table>`;
}

/**
 * Build the round-1 fragment.
 * @param {object} results   results.json
 * @param {{suggestions?:object[]}|null} suggestions
 * @param {object[]} history history.json (past audit runs)
 */
function renderFragment(results, suggestions, history = []) {
  const list = suggestions && Array.isArray(suggestions.suggestions) && suggestions.suggestions.length ? suggestions.suggestions : fallbackSuggestions(results);
  const fromAgent = list === (suggestions && suggestions.suggestions);
  const top3 = list.slice(0, 3);
  const net = results.net;
  const fp = results.footprint;
  const m = results.mining;
  const b = results.benefit;
  const fmt = (n) => Number(n || 0).toLocaleString('de-DE');
  const tile = (title, status, text) => `<div class="d1-tile">${light(status)} <strong style="display:inline">${esc(title)}</strong><br>${text}</div>`;
  const overview = `
<section id="overview" data-nav-label="Überblick">
  <h2>Überblick</h2>
  <div class="d1-grid">
    ${tile('Integrität', worst(results.integrity), `${results.integrity.filter((c) => c.status === 'green').length}/${results.integrity.length} Checks grün`)}
    ${tile('Repo- &amp; Ship-Hygiene', worst(results.hygiene), `${results.hygiene.filter((c) => c.status === 'green').length}/${results.hygiene.length} Checks grün`)}
    ${tile('Statischer Footprint', 'skipped', `~${fmt(fp.totalTokens)} Tokens je Session`)}
    ${tile('Kosten vs. messbarer Nutzen', 'skipped', `~${fmt(net.costTokens)} / ~${fmt(net.benefitTokens)} Tokens`)}
  </div>
  <p><strong>Kosten</strong> ~${fmt(net.costTokens)} Tokens (Plugin-Text in den Transkripten) · <strong>messbarer Nutzen</strong> ~${fmt(net.benefitTokens)} Tokens (nur Delegation, Opus-Äquivalent). Kein Netto-Wert: Guard- und local-llm-Ersparnis werden nirgends protokolliert, ein Saldo würde nur den messbaren Teil des Nutzens gegen die ganzen Kosten rechnen.</p>
  <p class="d1-warn">${esc(net.uncertainty)}</p>
  <h3>Top-Vorschläge</h3>
  <ol class="d1-list">${top3.map((s) => `<li><strong>${esc(s.title)}</strong> - ${esc(s.change || '')}</li>`).join('') || '<li>Keine Befunde.</li>'}</ol>
  ${fromAgent ? '' : '<p class="d1-note">Vorschläge regelbasiert abgeleitet (keine Synthese).</p>'}
  <h3>Footprint je Audit-Lauf</h3>
  ${curveSvg(history)}
</section>`;

  const benefit = `
<section id="benefit" data-nav-label="Nutzen-Proxys">
  <h2>Nutzen-Proxys</h2>
  <p class="d1-note">Fenster ${esc(m.window.since.slice(0, 10))} bis ${esc(m.window.until.slice(0, 10))}, ${m.totals.sessions} Sessions, ${fmt(m.totals.tokens)} Tokens gesamt, Plugin-Anteil ${(m.totals.pluginShare * 100).toFixed(2)} %.</p>
  <table class="d1-table"><thead><tr><th>Proxy</th><th>Wert</th><th>Aussage</th></tr></thead><tbody>
    <tr><td>Delegation</td><td>${b.delegation.spawns} Spawns, ~${fmt(b.delegation.savedOpusEquivalentTokens)} Tok gespart</td><td>Subagent-Tokens × (1 − Preisverhältnis zu Opus)</td></tr>
    <tr><td>Token-Guard</td><td>${b.tokenGuard.blocks} Blocks</td><td>${esc(b.tokenGuard.note)}</td></tr>
    <tr><td>Local-LLM</td><td>–</td><td>${esc(b.localLlm.note)}</td></tr>
    <tr><td>Nacharbeit</td><td>${b.rework.repeatedBashFailures} wiederholte Bash-Fehler · ${b.rework.autoFixLoads} auto-fix · ${b.rework.frustrationPrompts} "funktioniert nicht"</td><td>${b.rework.perSession} je Session</td></tr>
  </tbody></table>
  <h3>Gate-Treffer (nur Häufigkeit, keine Token-Ersparnis)</h3>
  <p class="d1-note">${esc(b.gateCatches.note)}</p>
  <table class="d1-table"><thead><tr><th>Regel</th><th>Treffer</th></tr></thead><tbody>${Object.entries(b.gateCatches.byRule).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${Number(v) || 0}</td></tr>`).join('') || '<tr><td colspan="2">keine</td></tr>'}</tbody></table>${shipBlocksTable(b.shipBlocksByRule)}
  <h3>Footprint-Komponenten</h3>
  <table class="d1-table"><thead><tr><th>Komponente</th><th>Anzahl</th><th>Tokens</th></tr></thead><tbody>${fp.components.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.count}</td><td>${fmt(c.tokens)}</td></tr>`).join('')}</tbody></table>
  <p class="d1-note">${fp.notes.map(esc).join(' ')}</p>
</section>`;

  const catalog = `
<section id="catalog" data-nav-label="Prüfkatalog">
  <h2>Prüfkatalog</h2>
  ${checkTable(results.integrity)}
</section>`;
  const hygiene = `
<section id="hygiene" data-nav-label="Repo- &amp; Ship-Hygiene">
  <h2>Repo- &amp; Ship-Hygiene</h2>
  ${checkTable(results.hygiene)}
</section>`;
  const sugg = `
<section id="suggestions" data-nav-label="Verbesserungsvorschläge">
  <h2>Verbesserungsvorschläge</h2>
  <p class="d1-note">Miteinbeziehen = als Issue anlegen oder umsetzen; Verwerfen = ignorieren.</p>
  ${list.map(suggestionCard).join('\n')}
</section>`;

  return `<section data-iteration="1" data-iteration-template="free" data-active>
<style>${CSS}</style>
<header class="iteration-intro">
  <h2>Plugin-Audit · v${esc(results.version)}</h2>
  <p>${esc(results.ranAt.slice(0, 10))} · Auslöser: ${esc(results.trigger)}</p>
</header>
${overview}
${benefit}
${catalog}
${hygiene}
${sugg}
</section>
`;
}

/** Newest installed concept-build, else the repo's own. */
function findConceptBuild(repoRoot, home = os.homedir()) {
  const base = path.join(home, '.claude/plugins/cache/dotclaude/devops');
  try {
    const v = fs.readdirSync(base).filter((n) => /^\d+\.\d+\.\d+$/.test(n)).sort(cmpSemver).reverse();
    for (const n of v) {
      const p = path.join(base, n, 'scripts/concept-build.js');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* not installed */ }
  const own = path.join(repoRoot, 'plugins/devops/scripts/concept-build.js');
  return fs.existsSync(own) ? own : null;
}

function build(inDir, { stateDirOverride, noBuild, repoRoot } = {}) {
  const dir = path.resolve(inDir);
  const results = readJson(path.join(dir, 'results.json'));
  if (!results) return { error: `no results.json in ${dir}` };
  const suggestions = readJson(path.join(dir, 'suggestions.json'), null);
  const history = state.readHistory(state.stateDir(repoRoot || process.cwd(), stateDirOverride));
  const src = path.join(dir, 'report');
  const builder = findConceptBuild(repoRoot || process.cwd());
  if (!builder) return { error: 'concept-build.js not found (installed cache or repo copy)' };
  fs.rmSync(src, { recursive: true, force: true });
  // --allow-main: the source folder lives in the git-ignored audit state dir of
  // the main checkout, which a ship-triggered run sits in; init's main-checkout
  // refusal targets concept pages that land in the repo, not this one.
  const init = run('node', [builder, 'init', src, '--title', `Plugin-Audit v${results.version}`, '--subtitle', results.ranAt.slice(0, 10), '--locale', 'de', '--mode', 'free', '--allow-main'], { timeout: 60000 });
  if (!init.ok) return { error: `concept-build init failed: ${(init.stderr || init.stdout).trim().slice(0, 300)}` };
  fs.mkdirSync(path.join(src, 'rounds'), { recursive: true });
  fs.writeFileSync(path.join(src, 'rounds', '01.html'), renderFragment(results, suggestions, history));
  if (noBuild) return { src, html: null };
  const html = `${src}.html`;
  const b = run('node', [builder, 'build', src, '--out', html], { timeout: 120000 });
  if (!b.ok) return { error: `concept-build build failed: ${(b.stderr || b.stdout).trim().slice(0, 600)}` };
  return { src, html, buildLine: b.stdout.trim().split('\n').pop() };
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const inDir = get('--in');
  if (!inDir) { process.stderr.write('plugin-audit report: --in <dir> required\n'); return 2; }
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()) || process.cwd();
  const r = build(inDir, { stateDirOverride: get('--state-dir'), noBuild: argv.includes('--no-build'), repoRoot });
  if (r.error) { process.stderr.write(`plugin-audit report: ${r.error}\n`); return 1; }
  if (r.buildLine) process.stdout.write(`${r.buildLine}\n`);
  process.stdout.write(`${r.html || r.src}\n`);
  return 0;
}

module.exports = { renderFragment, fallbackSuggestions, suggestionCard, curveSvg, findConceptBuild, build, esc };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
