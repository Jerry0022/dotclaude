#!/usr/bin/env node
/**
 * @script build-concept-fixture
 * @version 0.1.0
 * @plugin devops
 * @description Assemble a standalone concept page from the reference blocks in
 *   `skills/concept/deep-knowledge/templates.md` — the same fenced HTML / CSS
 *   / JS a generated page is copied from — with a synthetic history of N
 *   rounds, so the Kompass decision panel (archive fold, TOC groups, the six
 *   status-line states, the split button, the mobile bottom bar, the FAB
 *   gutter in design mode) can be opened in a REAL browser and looked at
 *   (#341). The jsdom suites (section-nav, panel-anatomy, panel-chrome) run
 *   the same engine without layout or paint; this is the fixture for the
 *   half they cannot see.
 *
 *   Usage:
 *     node build-concept-fixture.js --out <file.html> [--rounds 8] [--entries 14]
 *                                   [--mode decision|design] [--locale en|de] [--mapping]
 *
 *   `--mapping` adds an information mapping (templates.md § Information
 *   Mapping (engine)) so the schematic / matrix engine can be looked at too:
 *   in design mode the live round gains a `data-view-kind="mapping"` view
 *   (vehicle fields → list card, phone + desktop) under its design; in
 *   decision mode the live round becomes a `free` round carrying the mapping
 *   block (requirements → release trains / owners, matrix-only) with its
 *   inline note. In both modes the round before the live one holds a FROZEN
 *   mapping of the same kind with a complete `submitted`, so the read-only
 *   render and the gate's rule M9 are exercised. Without the flag the output
 *   is byte-identical to what it was.
 *
 *   No bridge is involved: the page's heartbeat / draft fetches fail and the
 *   status line settles on "local-only", which is itself one of the states to
 *   verify. Open it via file:// in an isolated browser profile (never the
 *   user's Edge window — SKILL.md Step 3, #347).
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES = path.join(__dirname, '..', 'skills', 'concept', 'deep-knowledge', 'templates.md');

function parseArgs(argv) {
  const out = { out: '', rounds: 8, entries: 14, mode: 'decision', locale: 'en', mapping: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (!key || !Object.prototype.hasOwnProperty.call(out, key)) continue;
    if (typeof out[key] === 'boolean') { out[key] = true; continue; }   // value-less flag
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) continue;
    i++;
    out[key] = typeof out[key] === 'number' ? Number(raw) : raw;
  }
  return out;
}

/** Fenced blocks of a markdown file, same walk as the concept test suites. */
function scanBlocks(src) {
  const lines = src.split('\n');
  const out = [];
  let open = null, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(.*)$/.exec(lines[i]);
    if (m) {
      if (open === null) { open = { info: m[1].trim(), start: i + 2 }; body = []; }
      else { out.push({ info: open.info, line: open.start, code: body.join('\n') }); open = null; }
      continue;
    }
    if (open) body.push(lines[i]);
  }
  return out;
}

/** `{{key}}` → the locale table's column, key itself when the row is missing. */
function localeMap(md, locale) {
  const map = new Map();
  const header = md.match(/^\| Key \| (.+) \|$/m);
  const cols = header ? header[1].split('|').map(s => s.trim()) : ['en', 'de'];
  const idx = Math.max(0, cols.indexOf(locale));
  const rowRe = /^\| `([a-z_.]+)`\s*\|(.+)\|$/gm;
  let m;
  while ((m = rowRe.exec(md))) {
    const cells = m[2].split('|').map(s => s.trim());
    if (cells[idx]) map.set(m[1], cells[idx]);
  }
  return map;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const LOREM = [
  'The reviewer reads this section and decides whether the direction holds.',
  'A second paragraph keeps the section tall enough that the scroll spy has something to track.',
  'Nothing here is real product copy; the fixture only needs the shape of a long round.',
];

/** One plain context section (TOC entry, scroll only). */
function plainSection(id, label) {
  return [
    `<section id="${id}" data-nav-label="${esc(label)}">`,
    `  <h2>${esc(label)}</h2>`,
    ...LOREM.map(p => `  <p>${p}</p>`),
    '</section>',
  ].join('\n');
}

/** One variant card with the mandatory bi-state selector + note slot. */
function variantSection(id, label, { discard = false, disabled = false } = {}) {
  const dis = disabled ? ' disabled' : '';
  return [
    `<section id="${id}" class="variant-card" data-nav-label="${esc(label)}">`,
    `  <h2>${esc(label)}</h2>`,
    `  <p>${LOREM[0]}</p>`,
    `  <ul><li>Pro: ${LOREM[1]}</li><li>Con: ${LOREM[2]}</li></ul>`,
    `  <div class="variant-evaluation" data-decision="${id}" data-label="${esc(label)}">`,
    '    <div class="eval-group">',
    `      <label class="eval-option"><input type="radio" name="eval-${id}" value="discard"${discard ? ' checked' : ''}${dis}><span class="eval-label">{{variant.discard}}</span></label>`,
    `      <label class="eval-option"><input type="radio" name="eval-${id}" value="include"${discard ? '' : ' checked'}${dis}><span class="eval-label">{{variant.include}}</span></label>`,
    '    </div>',
    '    <div class="field-row decision-comment-row">',
    `      <label for="${id}-note">{{decision.comment_label}}</label>`,
    `      <textarea id="${id}-note" data-comment="${id}-note" data-attachable placeholder="{{decision.comment_placeholder}}" rows="2"${dis}${disabled ? ' readonly' : ''}></textarea>`,
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
}

// --- Information mapping (--mapping) ------------------------------------------
// The two specs of skills/concept/mapping-harness.js (VEHICLE_SPEC, TRAINS_SPEC),
// copied: the harness is an ES module, this script is CommonJS. Keep them in
// step by hand — they are test data, not a contract.
const VEHICLE_SPEC = {
  items: [
    { id: 'plate', label: 'Licence plate', group: 'Identity', required: true },
    { id: 'model', label: 'Model', group: 'Identity' },
    { id: 'vin', label: 'VIN', group: 'Identity' },
    { id: 'status', label: 'Status', group: 'Status' },
    { id: 'mileage', label: 'Mileage', group: 'Telemetry' },
    { id: 'holder', label: 'Holder', group: 'Ownership' },
  ],
  elements: [{ id: 'card', label: 'List card', itemTargets: 'any', parts: [
    { id: 'header', label: 'header', tier: 'first', row: 1, min: 1 },
    { id: 'badge', label: 'badge', tier: 'first', row: 1, accepts: 'one', min: 1 },
    { id: 'line1', label: 'line 1', tier: 'first', row: 2, min: 1, ordered: true },
    { id: 'line2', label: 'line 2', tier: 'first', row: 3, ordered: true },
    { id: 'footer', label: 'footer', tier: 'first', row: 4 },
    { id: 'overview', label: 'Tab: Overview', tier: 'after', row: 1 },
    { id: 'history', label: 'Tab: History', tier: 'after', row: 2 },
  ] }],
  context: { id: 'device', label: 'Context', values: [{ id: 'phone', label: 'Phone' }, { id: 'desktop', label: 'Desktop' }] },
  proposal: [['plate', 'card.header', 'phone'], ['model', 'card.header', 'phone'], ['status', 'card.badge', 'phone'],
             ['mileage', 'card.line1', 'phone'], ['vin', 'card.overview', 'phone'], ['plate', 'card.header', 'desktop']],
  proposalOrder: { 'card.line1@phone': ['mileage'] },
  slotNotes: true, adhocItems: true,
};
const TRAINS_SPEC = {
  items: [{ id: 'req01', label: 'REQ-01', group: 'Requirements' }, { id: 'rsk01', label: 'RSK-01', group: 'Risks' }],
  axes: [
    { id: 'train', label: 'Release train', itemTargets: 'one', columns: [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }] },
    { id: 'owner', label: 'Owner', itemTargets: 'min1', columns: [{ id: 'web', label: 'Web' }, { id: 'ops', label: 'Ops' }] },
  ],
  proposal: [['req01', 'train.r1'], ['req01', 'owner.web'], ['rsk01', 'train.r2']],
};

/**
 * The `submitted` object of a frozen round (templates.md § Information
 * Mapping (engine) → Freezing): the proposal pairs grouped by matrix key
 * (`{src}` or `{src}@{ctx}`), an `order` entry for every ordered target key,
 * no ad-hoc items, no slot notes. `edits` are extra `[item, target, ctx?]`
 * pairs the "user" added on top — one visible ◆ per frozen mapping, so the
 * read-only render is distinguishable from the proposal in the browser.
 */
function submittedFor(spec, edits = []) {
  const ctxs = spec.context && spec.context.values ? spec.context.values.map(v => v.id) : [null];
  const sources = [
    ...(spec.elements || []).map(e => ({ id: e.id, targets: e.parts })),
    ...(spec.axes || []).map(a => ({ id: a.id, targets: a.columns })),
  ];
  const cells = {}, order = {};
  const pairs = [...(spec.proposal || []), ...edits];
  sources.forEach(s => ctxs.forEach(c => {
    const key = s.id + (c ? '@' + c : '');
    const targets = new Set(s.targets.map(t => `${s.id}.${t.id}`));
    cells[key] = pairs.filter(p => (p[2] || null) === c && targets.has(p[1])).map(p => [p[0], p[1]]);
    s.targets.filter(t => t.ordered).forEach(t => {
      const tk = `${s.id}.${t.id}`;
      const ok = tk + (c ? '@' + c : '');
      const proposed = (spec.proposalOrder || {})[ok] || [];
      const checked = cells[key].filter(p => p[1] === tk).map(p => p[0]);
      order[ok] = proposed.filter(id => checked.includes(id)).concat(checked.filter(id => !proposed.includes(id)));
    });
  }));
  return { cells, order, adhoc: [], slotNotes: {} };
}

const specScript = spec => `<script type="application/json" data-mapping-spec>${JSON.stringify(spec)}</script>`;

/**
 * Design mode: one `data-view-kind="mapping"` view tied to the round's design
 * (§ View kind `mapping`). No inline note — the dock's view textarea is the
 * mapping note. Frozen rounds carry the submission in the spec.
 */
function mappingView(n, { live }) {
  const id = `veh_${n}`;
  const spec = live ? VEHICLE_SPEC : { ...VEHICLE_SPEC, submitted: submittedFor(VEHICLE_SPEC, [['holder', 'card.overview', 'phone']]) };
  return [
    `  <section data-view="map_d${n}" data-view-kind="mapping" data-view-for="d${n}" data-nav-label="Field mapping · Design ${n}" hidden>`,
    '    <div class="view-frame view-mapping">',
    `      <h2>Which vehicle fields go where on the list card of Design ${n}?</h2>`,
    '      <p>Proposal pre-filled — correct it. Phone and desktop are separate.</p>',
    `      <section data-mapping="${id}" id="${id}" data-nav-label="Field mapping · Design ${n}">`,
    `        ${specScript(spec)}`,
    '      </section>',
    '    </div>',
    '  </section>',
  ].join('\n');
}

/**
 * Free-round block (§ Mapping block (optional)): matrix-only spec (axes, no
 * schematic, no view toggle) plus the mandatory inline note. Frozen rounds
 * carry the submission in the spec and a frozen note, like every other
 * comment of that round.
 */
function mappingBlock(n, { live }) {
  const id = `rel_${n}`;
  const spec = live ? TRAINS_SPEC : { ...TRAINS_SPEC, submitted: submittedFor(TRAINS_SPEC, [['rsk01', 'owner.ops']]) };
  const dis = live ? '' : ' disabled readonly';
  return [
    `<section data-mapping="${id}" id="${id}" data-nav-label="Requirements → release trains">`,
    '  <h2>Which requirement lands in which train, and who owns it?</h2>',
    `  <p>${LOREM[0]}</p>`,
    `  ${specScript(spec)}`,
    '  <div class="field-row decision-comment-row">',
    `    <label for="${id}-note">{{decision.comment_label}}</label>`,
    `    <textarea id="${id}-note" data-comment="map-${id}-note" data-attachable rows="3" placeholder="{{decision.comment_placeholder}}"${dis}></textarea>`,
    '  </div>',
    '</section>',
  ].join('\n');
}

/** A free round: intro, one context section, the mapping block, one more section. */
function freeRound(n, { live }) {
  return [
    `<section id="iter-${n}" data-iteration="${n}" data-iteration-template="free"${live ? ' data-active' : ' hidden'}>`,
    '  <header class="iteration-intro">',
    `    <h2>Iteration ${n} · ${live ? 'live round' : 'frozen round'}</h2>`,
    `    <p>Synthetic free round ${n} of the Kompass fixture — one mapping block between two context sections.</p>`,
    '  </header>',
    plainSection(`r${n}-s0`, `Context — round ${n}`),
    mappingBlock(n, { live }),
    plainSection(`r${n}-s2`, `Recommendation — round ${n}`),
    '</section>',
  ].join('\n');
}

/**
 * A decision round. `entries` sections, the first `plain` of them context
 * sections and the rest variant cards — two kinds, so the live round groups
 * once it exceeds NAV_GROUP_OVER_ENTRIES.
 */
function decisionRound(n, { live, entries, plain, discard = 0 }) {
  const parts = [];
  parts.push(`<section id="iter-${n}" data-iteration="${n}" data-iteration-template="decision"${live ? ' data-active' : ' hidden'}>`);
  parts.push('  <div class="iteration-intro">');
  parts.push(`    <h2>Iteration ${n} · ${live ? 'live round' : 'frozen round'}</h2>`);
  parts.push(`    <p>Synthetic round ${n} of the Kompass fixture — ${entries} sections, ${plain} of them context.</p>`);
  parts.push('  </div>');
  for (let i = 0; i < entries; i++) {
    const id = `r${n}-s${i}`;
    if (i < plain) parts.push(plainSection(id, `Context ${i + 1} — round ${n}`));
    else parts.push(variantSection(id, `Variant ${String.fromCharCode(65 + i - plain)} — round ${n}`, { discard: i - plain < discard, disabled: !live }));
  }
  parts.push('</section>');
  return parts.join('\n');
}

/** A design round: one design with three wired screens; a mapping view with `mapping`. */
function designRound(n, { live, mapping = false }) {
  const screen = (id, label, next, active) => [
    `<section id="${id}" data-screen data-nav-label="${esc(label)}"${active ? ' data-screen-active="true"' : ' hidden'}>`,
    '  <div class="device-frame">',
    `    <div style="padding:2rem;font-family:system-ui"><h1 style="margin:0 0 1rem">${esc(label)}</h1>`,
    `    <p>${LOREM[0]}</p>`,
    next ? `    <button type="button" data-screen-link="${next}">Continue →</button>` : '    <p><strong>Done.</strong></p>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');
  return [
    `<section id="iter-${n}" data-iteration="${n}" data-iteration-template="design"${live ? ' data-active' : ' hidden'}>`,
    `  <section data-design="d${n}" data-nav-label="Design ${n}" data-design-active="true">`,
    screen(`d${n}-s1`, 'Welcome', `d${n}-s2`, true),
    screen(`d${n}-s2`, 'Credentials', `d${n}-s3`, false),
    screen(`d${n}-s3`, 'Success', null, false),
    '  </section>',
    ...(mapping ? [mappingView(n, { live })] : []),
    '</section>',
  ].join('\n');
}

function tabs(rounds, live) {
  return rounds.map(n =>
    `<button class="iteration-tab" role="tab" data-iteration="${n}" aria-selected="${n === live ? 'true' : 'false'}">Iteration ${n}${n === live ? ' {{iteration.active_suffix}}' : ''}</button>`
  ).join('\n');
}

// The reference CSS consumes design tokens (`var(--panel-bg)`, `var(--accent-color)`,
// …) but defines none — every generated page carries its own `:root` block,
// written by Claude per project (SKILL.md Step 2 § Design). The fixture needs
// one too, or every state colour collapses to the browser default. This set
// mirrors the newest sample page in docs/concepts/ plus the names the
// reference CSS additionally reads (both the `--bg` and the `--bg-color`
// family are in use across pages).
const TOKENS = `
:root {
  --bg: #0d1117; --bg-color: #0d1117; --bg-secondary: #161b22; --bg-subtle: #1c2128; --surface-2: #1c2128;
  --text: #c9d1d9; --text-color: #c9d1d9; --text-primary: #c9d1d9; --text-secondary: #8b949e;
  --text-muted: #8b949e; --text-tertiary: #6e7681;
  --panel-bg: #161b22; --border-color: #30363d; --input-bg: #0d1117; --code-bg: #1c2128;
  --accent-color: #58a6ff; --success-color: #3fb950; --warning-color: #d29922; --danger-color: #f85149;
  --chrome-safe-top: 0px; --chrome-safe-bottom: 0px;
}
html[data-theme="light"] {
  --bg: #ffffff; --bg-color: #ffffff; --bg-secondary: #f6f8fa; --bg-subtle: #f6f8fa; --surface-2: #eaeef2;
  --text: #1f2328; --text-color: #1f2328; --text-primary: #1f2328; --text-secondary: #59636e;
  --text-muted: #59636e; --text-tertiary: #818b98;
  --panel-bg: #f6f8fa; --border-color: #d1d9e0; --input-bg: #ffffff; --code-bg: #f6f8fa;
  --accent-color: #0969da; --success-color: #1a7f37; --warning-color: #9a6700; --danger-color: #d1242f;
}
body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
.concept-content { padding: 2rem; }
.variant-card { border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; background: var(--panel-bg); }
`;

function build(opts, md = fs.readFileSync(TEMPLATES, 'utf8')) {
  const blocks = scanBlocks(md);
  const html = blocks.filter(b => b.info === 'html');
  const css = blocks.filter(b => b.info === 'css').map(b => b.code).join('\n\n');
  const js = blocks.filter(b => /^(javascript|js)$/.test(b.info)).map(b => b.code).join('\n\n');
  const locale = localeMap(md, opts.locale);
  const subst = s => s.replace(/\{\{([a-z_.]+)\}\}/g, (_, k) => locale.get(k) || k);

  const rounds = Array.from({ length: opts.rounds }, (_, i) => i + 1);
  const live = opts.rounds;
  const mapping = !!opts.mapping;
  const sections = rounds.map(n => {
    if (n === live) {
      if (opts.mode === 'design') return designRound(n, { live: true, mapping });
      return mapping
        ? freeRound(n, { live: true })          // a mapping block never sits in a decision round
        : decisionRound(n, { live: true, entries: opts.entries, plain: Math.max(2, Math.floor(opts.entries / 3)) });
    }
    // With --mapping the round before the live one is a frozen round of the
    // same kind, carrying its mapping with the baked submission.
    if (mapping && n === live - 1) return opts.mode === 'design' ? designRound(n, { live: false, mapping }) : freeRound(n, { live: false });
    // Frozen history: varying sizes, a few discards, so the chip summaries differ.
    return decisionRound(n, { live: false, entries: 3 + (n % 4), plain: 1, discard: n % 3 });
  }).join('\n\n');

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const title = `Kompass fixture — ${opts.rounds} rounds, ${opts.entries} entries (${opts.mode})`;
  let page;

  if (opts.mode === 'design') {
    const skel = html.find(b => b.code.includes('class="concept-layout design fullscreen"'));
    if (!skel) throw new Error('design skeleton not found in templates.md');
    // The design skeleton ships only #panel-ready and #panel-submitted and
    // tells the author to copy #panel-frozen + #panel-final-report verbatim
    // from the Common Structure — do exactly that, in place of its comment.
    const common = html.find(b => b.code.startsWith('<!DOCTYPE html>'));
    if (!common) throw new Error('common structure skeleton not found in templates.md');
    const foot = common.code.slice(common.code.indexOf('<div id="panel-frozen"'), common.code.indexOf('<!-- /.panel-cta -->'));
    const restStates = foot.slice(0, foot.lastIndexOf('</div>'));   // drop the .panel-cta closer itself
    page = skel.code
      .replace(/<!-- The remaining two panel states[\s\S]*?-->/, restStates)
      .replace(/^<html data-template="design">/m,
        `<!DOCTYPE html>\n<html lang="${opts.locale}" data-theme="dark" data-page-version="${stamp}" data-template="design">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${esc(title)}</title>\n<style>\n${TOKENS}\n${css}\n</style>\n</head>`)
      .replace(/<main>[\s\S]*?<\/main>/, `<main>\n${sections}\n</main>`)
      .replace(/<\/body>\s*<\/html>\s*$/, `<script type="application/json" id="concept-decisions">\n{"submitted": false, "decisions": [], "comments": []}\n</script>\n<script>\n${js}\n</script>\n</body>\n</html>\n`);
  } else {
    const skel = html.find(b => b.code.startsWith('<!DOCTYPE html>'));
    if (!skel) throw new Error('common structure skeleton not found in templates.md');
    page = skel.code
      .replace(/<html lang="en"[^>]*>/, `<html lang="${opts.locale}" data-theme="dark" data-page-version="${stamp}" data-template="decision">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<style>\/\* all CSS inline \*\/<\/style>/, `<style>\n${TOKENS}\n${css}\n</style>`)
      .replace(/<h1>\{title\}<\/h1>\s*<p class="subtitle">[^<]*<\/p>/, `<h1>${esc(title)}</h1>\n        <p class="subtitle">Generated by scripts/build-concept-fixture.js — no bridge, no real content.</p>`)
      .replace(/<main>[\s\S]*?<\/main>/, `<main>\n${sections}\n</main>`)
      .replace(/<script>\/\* all JS inline \*\/<\/script>/, `<script>\n${js}\n</script>`);
  }

  // Tabs go into the (first) iteration-tabs nav of whichever skeleton was used.
  page = page.replace(/(<nav class="iteration-tabs"[^>]*>)[\s\S]*?(<\/nav>)/, `$1\n${tabs(rounds, live)}\n$2`);
  page = subst(page);
  // Anything the skeleton left as a {placeholder} for Claude to fill.
  page = page.replace(/\{generation-timestamp\}/g, stamp);
  return page;
}

module.exports = { parseArgs, scanBlocks, localeMap, build, TEMPLATES };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out) {
    process.stderr.write('usage: build-concept-fixture.js --out <file.html> [--rounds 8] [--entries 14] [--mode decision|design] [--locale en|de] [--mapping]\n');
    process.exit(2);
  }
  const page = build(opts);
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, page);
  process.stdout.write(`${path.resolve(opts.out)} (${page.length} bytes, ${opts.rounds} rounds, mode ${opts.mode}${opts.mapping ? ', mapping' : ''})\n`);
}
