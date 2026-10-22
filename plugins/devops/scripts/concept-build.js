#!/usr/bin/env node
/**
 * @script concept-build
 * @version 0.2.0
 * @plugin devops
 * @description Build a concept page from a source folder: the engine comes
 *   from the concept templates of the plugin running this script, the content
 *   from one fragment file per round. Claude writes only the round fragments
 *   and never copies, reads or edits the engine (about 600 KB once
 *   assembled), so a round costs the tokens of its own content. Every round
 *   rebuilds the engine from the current reference, so engine drift cannot
 *   occur.
 *
 *   Source folder (docs/concepts/{name}/), next to the built page
 *   docs/concepts/{name}.html, which bridge, watchers, hooks and close-out
 *   keep addressing as before:
 *
 *     page.json        { title, subtitle, locale, mode, pageVersion, lastBuild }
 *     head.html        optional: the page's design tokens / content base CSS /
 *                      CSP meta / fonts. Falls back to
 *                      {project}/.claude/skills/auto-concept/head.html, then
 *                      ~/.claude/skills/auto-concept/head.html, then the
 *                      built-in neutral set (consumer customisation).
 *     rounds/NN.html   exactly one <section data-iteration="N" …> per round.
 *                      The highest is the live round; every other one is
 *                      frozen at build time (hidden, controls disabled /
 *                      readonly, design navigation left browsable) and must
 *                      have been baked (data-baked) with the user's answers.
 *
 *   Commands:
 *     init   <dir> --title T [--subtitle S] [--locale de] [--mode decision|design|mixed|free]
 *     build  <dir> [--out <file>] [--force]
 *                                       assemble + gate; writes atomically and only when
 *                                       it passes and the page on disk is the last build
 *     check  <dir>                      the same, without writing
 *     bake   <dir> --round N (--payload <decisions.json> | --unanswered)
 *                                       write the submitted values of round N into its
 *                                       fragment (fields, mapping `submitted`, dock notes)
 *     import <page.html> [--dir <dir>]  split a single-file page from before this script
 *                                       into a source folder
 *
 *   No dependencies beyond Node: it runs from the installed plugin cache.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { readTemplates } = require('../skills/auto-concept/templates-source.js');
const { scanBlocks, localeMap } = require('./build-concept-fixture.js');
const gate = require('../hooks/lib/concept-gate.js');

const GENERATOR = 'concept-build';

const VALID_TEMPLATES = new Set(['decision', 'design', 'free', 'prototype']);
const normTemplate = t => (t === 'prototype' ? 'design' : t);

const CONTENT_BASE = `body { margin: 0; background: var(--bg, var(--bg-color)); color: var(--text, var(--text-color)); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
.concept-content { padding: 2rem; }
.variant-card { border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; background: var(--panel-bg); }
.subtitle { color: var(--text-secondary); margin-top: 0; }
.field-row { margin-top: 0.75rem; }
code, pre { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
pre { background: var(--code-bg); padding: 0.75rem 1rem; border-radius: 6px; overflow-x: auto; }`;

// Neutral token set plus the content base the reference CSS assumes but does
// not define (the engine styles chrome, not the reading column). A project
// overrides all of it with its own head.html (see the header comment).
const DEFAULT_HEAD = `<style>
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
${CONTENT_BASE}
</style>`;

// ---------------------------------------------------------------------------
// HTML helpers — regex-based on purpose (no DOM library in the plugin cache),
// but attributes are tokenised, never matched by name inside the raw string.
// ---------------------------------------------------------------------------

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

// An opening tag whose attribute values may contain '>' inside quotes.
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const tagRe = names => new RegExp(`<(${names})\\b${ATTRS}>`, 'gi');

/** Attribute string → [{ name, raw }] (raw keeps its quotes), plus a self-closing flag. */
function parseAttrs(str) {
  const list = [];
  const re = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m;
  while ((m = re.exec(str))) list.push({ name: m[1], raw: m[2] });
  return { list, selfClose: /\/\s*$/.test(str) };
}
function serializeAttrs({ list, selfClose }) {
  return list.map(a => ` ${a.name}${a.raw === undefined ? '' : '=' + a.raw}`).join('') + (selfClose ? ' /' : '');
}
const unquote = raw => (raw === undefined ? '' : /^["']/.test(raw) ? raw.slice(1, -1) : raw);

function getAttr(attrs, name) {
  const a = parseAttrs(attrs).list.find(x => x.name.toLowerCase() === name.toLowerCase());
  return a ? decode(unquote(a.raw)) : undefined;
}
const hasAttr = (attrs, name) => getAttr(attrs, name) !== undefined;
function removeAttr(attrs, name) {
  const p = parseAttrs(attrs);
  p.list = p.list.filter(x => x.name.toLowerCase() !== name.toLowerCase());
  return serializeAttrs(p);
}
function setAttr(attrs, name, value) {
  const p = parseAttrs(attrs);
  const raw = value === true ? undefined : `"${esc(value)}"`;
  const at = p.list.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
  if (at >= 0) p.list[at] = { name: p.list[at].name, raw };
  else p.list.push({ name, raw });
  return serializeAttrs(p);
}
const classes = attrs => (getAttr(attrs, 'class') || '').split(/\s+/).filter(Boolean);

/** The first <section …> outside comments, with its attribute string. */
function rootSection(fragment) {
  const masked = maskComments(fragment);
  const m = new RegExp(`<section\\b${ATTRS}>`, 'i').exec(masked);
  if (!m) return null;
  return { index: m.index, length: m[0].length, attrs: fragment.slice(m.index + 8, m.index + m[0].length - 1) };
}
function replaceRootAttrs(fragment, fn) {
  const root = rootSection(fragment);
  if (!root) return fragment;
  return fragment.slice(0, root.index) + `<section${fn(root.attrs)}>` + fragment.slice(root.index + root.length);
}

// Same-length masking keeps offsets valid while hiding comment / opaque bodies.
const blank = s => s.replace(/[^\n]/g, ' ');
const maskComments = html => html.replace(/<!--[\s\S]*?-->/g, blank);

/** Spans whose contents are never rewritten: comments, script, style, pre, code, textarea bodies. */
function opaqueSpans(html, { textarea = true } = {}) {
  const spans = [];
  const names = textarea ? 'script|style|pre|code|textarea' : 'script|style|pre|code';
  const re = new RegExp(`<!--[\\s\\S]*?-->|<(${names})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
  let m;
  while ((m = re.exec(html))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
const inSpan = (spans, i) => spans.some(([a, b]) => i > a && i < b);

/** Top-level element extent of the root section (handles nested sections). */
function rootExtent(fragment) {
  const root = rootSection(fragment);
  if (!root) return null;
  const masked = maskComments(fragment);
  const re = /<section\b(?:[^>"']|"[^"]*"|'[^']*')*>|<\/section\s*>/gi;
  re.lastIndex = root.index;
  let depth = 0, m;
  while ((m = re.exec(masked))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return { start: root.index, end: re.lastIndex };
  }
  return { start: root.index, end: -1 };
}

// ---------------------------------------------------------------------------
// Freeze (iteration-rules.md § Freezing Design Iterations, templates-rounds.md
// § Freezing Past Iterations)
// ---------------------------------------------------------------------------

// Controls a frozen DESIGN round keeps live, so its mockups stay browsable.
const DESIGN_EXEMPT_CLASSES = ['design-switch-item', 'screen-nav-item', 'screen-nav-design-heading', 'anno-pin', 'view-switch-item', 'screen-nav-view-item'];
const DESIGN_EXEMPT_ATTRS = ['data-screen-link', 'data-anno-summary'];
const DESIGN_EXEMPT_IDS = ['panel-toggle', 'feedback-toggle', 'feedback-close', 'anno-toggle'];

function isDesignExempt(attrs) {
  if (DESIGN_EXEMPT_ATTRS.some(a => hasAttr(attrs, a))) return true;
  if (DESIGN_EXEMPT_IDS.includes(getAttr(attrs, 'id'))) return true;
  return classes(attrs).some(c => DESIGN_EXEMPT_CLASSES.includes(c));
}

/**
 * Freeze one round fragment: `data-active` is the ONLY attribute removed from
 * the section, `hidden` is added, every control inside is disabled (text
 * fields and textareas additionally readonly; a design round's textareas stay
 * readonly-only so the submitted text stays legible). Idempotent.
 */
function freezeFragment(fragment) {
  const root = rootSection(fragment);
  if (!root) return fragment;
  const template = normTemplate(getAttr(root.attrs, 'data-iteration-template') || 'decision');
  let out = replaceRootAttrs(fragment, a => setAttr(removeAttr(a, 'data-active'), 'hidden', true));
  const spans = opaqueSpans(out, { textarea: false });
  out = out.replace(tagRe('input|textarea|select|button'), (tag, name, attrs, offset) => {
    if (inSpan(spans, offset)) return tag;
    const n = name.toLowerCase();
    if (template === 'design' && isDesignExempt(attrs)) return tag;
    let a = attrs;
    const type = (getAttr(a, 'type') || 'text').toLowerCase();
    const textual = n === 'textarea' || (n === 'input' && ['text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type));
    if (textual) a = setAttr(a, 'readonly', true);
    const keepEnabled = template === 'design' && n === 'textarea';
    if (!keepEnabled) a = setAttr(a, 'disabled', true);
    return `<${name}${a}>`;
  });
  return out;
}

/** The live round: data-active on, hidden off. */
function activateFragment(fragment) {
  return replaceRootAttrs(fragment, a => setAttr(removeAttr(a, 'hidden'), 'data-active', true));
}

// ---------------------------------------------------------------------------
// Bake: write a round's submitted values into its fragment (Step 5c freeze)
// ---------------------------------------------------------------------------

// Same key order as collectAllFormFields() (templates-submit.md).
const FIELD_KEYS = ['data-field', 'data-v4', 'data-confirm', 'data-rename', 'data-entities', 'data-comment', 'name', 'id'];
function fieldKey(attrs) {
  for (const k of FIELD_KEYS) {
    const v = getAttr(attrs, k);
    if (v) return v;
  }
  return null;
}

/** Keys that more than one checkbox shares (collectAllFormFields keeps only the last). */
function sharedCheckboxKeys(fragment) {
  const seen = new Map();
  const spans = opaqueSpans(fragment);
  for (const m of fragment.matchAll(tagRe('input'))) {
    if (inSpan(spans, m.index)) continue;
    if ((getAttr(m[2], 'type') || '').toLowerCase() !== 'checkbox') continue;
    const k = fieldKey(m[2]);
    if (k) seen.set(k, (seen.get(k) || 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

function bakeFields(fragment, fields, notes) {
  if (!fields || typeof fields !== 'object') return fragment;
  const has = k => Object.prototype.hasOwnProperty.call(fields, k);
  const shared = sharedCheckboxKeys(fragment);
  shared.forEach(k => { if (has(k)) notes.push(`checkbox group "${k}" shares one key — left as authored, set it by hand`); });
  let out = fragment;

  // textarea: replace the body (outside script/style/pre/code)
  const spansT = opaqueSpans(out, { textarea: false });
  out = out.replace(new RegExp(`<textarea\\b${ATTRS}>([\\s\\S]*?)</textarea>`, 'gi'), (whole, attrs, body, offset) => {
    if (inSpan(spansT, offset)) return whole;
    const key = fieldKey(attrs);
    if (!key || !has(key)) return whole;
    return `<textarea${attrs}>${escText(fields[key] ?? '')}</textarea>`;
  });

  // select: mark the chosen option (value, or the option text when it has none)
  const spansS = opaqueSpans(out, { textarea: false });
  out = out.replace(new RegExp(`<select\\b${ATTRS}>([\\s\\S]*?)</select>`, 'gi'), (whole, attrs, body, offset) => {
    if (inSpan(spansS, offset)) return whole;
    const key = fieldKey(attrs);
    if (!key || !has(key)) return whole;
    const want = String(fields[key]);
    const opts = body.replace(new RegExp(`<option\\b${ATTRS}>([^<]*)`, 'gi'), (o, oa, text) => {
      const val = hasAttr(oa, 'value') ? getAttr(oa, 'value') : decode(text).trim();
      return `<option${val === want ? setAttr(oa, 'selected', true) : removeAttr(oa, 'selected')}>${text}`;
    });
    return `<select${attrs}>${opts}</select>`;
  });

  // input: radio / checkbox / value
  const spansI = opaqueSpans(out);
  out = out.replace(tagRe('input'), (tag, name, attrs, offset) => {
    if (inSpan(spansI, offset)) return tag;
    const type = (getAttr(attrs, 'type') || 'text').toLowerCase();
    if (type === 'radio') {
      const group = getAttr(attrs, 'name');
      if (!group || !has(group)) return tag;
      const on = String(getAttr(attrs, 'value')) === String(fields[group]);
      return `<${name}${on ? setAttr(attrs, 'checked', true) : removeAttr(attrs, 'checked')}>`;
    }
    const key = fieldKey(attrs);
    if (!key || !has(key)) return tag;
    if (type === 'checkbox') {
      if (shared.has(key)) return tag;
      return `<${name}${fields[key] ? setAttr(attrs, 'checked', true) : removeAttr(attrs, 'checked')}>`;
    }
    if (['button', 'submit', 'reset', 'file', 'image'].includes(type)) return tag;
    return `<${name}${setAttr(attrs, 'value', String(fields[key] ?? ''))}>`;
  });
  return out;
}

/** mappings[] → `submitted` in each frozen spec (templates-mapping.md § Freezing). */
function bakeMappings(fragment, mappings, notes) {
  if (!Array.isArray(mappings) || !mappings.length) return fragment;
  let out = fragment;
  for (const entry of mappings) {
    if (!entry || !entry.id) continue;
    // The spec script may follow headings / paragraphs inside the mapping section.
    const open = new RegExp(`<section\\b${ATTRS}>`, 'gi');
    let m, at = -1;
    while ((m = open.exec(out))) {
      if (getAttr(m[1], 'data-mapping') === entry.id) { at = open.lastIndex; break; }
    }
    if (at < 0) { notes.push(`mapping "${entry.id}" from the payload has no section in this round`); continue; }
    const specRe = /(<script\b[^>]*\bdata-mapping-spec\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
    specRe.lastIndex = at;
    const s = specRe.exec(out);
    if (!s) { notes.push(`mapping "${entry.id}" has no data-mapping-spec script`); continue; }
    let spec;
    try { spec = JSON.parse(s[2]); } catch { notes.push(`mapping "${entry.id}": spec JSON does not parse`); continue; }
    spec.submitted = {
      cells: entry.assigned || {},
      order: entry.order || {},
      adhoc: entry.adhocItems || [],
      slotNotes: entry.slotNotes || {},
    };
    const json = JSON.stringify(spec).replace(/<\/script/gi, '<\\/script');
    out = out.slice(0, s.index) + s[1] + json + s[3] + out.slice(s.index + s[0].length);
  }
  return out;
}

/** The dock's submitted notes, embedded so a frozen tab shows them (iteration-rules.md). */
function bakeFrozenFeedback(fragment, payload) {
  const c = (payload && payload.comments) || {};
  const blob = { general: c.general || { text: '', attachments: [] } };
  for (const k of ['designs', 'screens', 'views']) {
    const v = (c[k] && typeof c[k] === 'object') ? c[k] : (payload && payload[k] && typeof payload[k] === 'object' ? payload[k] : null);
    if (v) blob[k] = v;
  }
  // Variant overview (templates-design.md § Variant overview): the frozen tab
  // shows the favourite and the user's own pins read-only. A favourite only
  // means something on a round of alternatives (data-design-set).
  const rootTag = rootSection(fragment);
  const alternatives = !!rootTag && /(?:^|\s)data-design-set=("|')alternatives\1/i.test(rootTag.attrs);
  if (alternatives && payload && typeof payload.favorite === 'string' && payload.favorite) blob.favorite = payload.favorite;
  if (payload && Array.isArray(payload.userPins) && payload.userPins.length) blob.userPins = payload.userPins;
  const tag = `<script type="application/json" data-frozen-feedback>${JSON.stringify(blob).replace(/<\/script/gi, '<\\/script')}</script>`;
  const cleaned = fragment.replace(/\s*<script\b[^>]*data-frozen-feedback[^>]*>[\s\S]*?<\/script>/gi, '');
  const root = rootSection(cleaned);
  if (!root) return cleaned;
  const at = root.index + root.length;
  return cleaned.slice(0, at) + '\n  ' + tag + cleaned.slice(at);
}

/** Does the fragment hold controls a payload would key (outside opaque spans)? */
function hasKeyedControls(fragment) {
  const spans = opaqueSpans(fragment, { textarea: false });
  for (const m of fragment.matchAll(tagRe('input|textarea|select'))) {
    if (!inSpan(spans, m.index) && fieldKey(m[2])) return true;
  }
  return false;
}

function bake(fragment, payload, opts = {}) {
  const notes = [];
  if (opts.unanswered) {
    // A round the user never submitted (steered from chat, superseded by a
    // correction): frozen as authored and explicitly marked, never a guessed payload.
    return { html: replaceRootAttrs(fragment, a => setAttr(setAttr(a, 'data-baked', true), 'data-unanswered', true)), notes };
  }
  const fields = payload && payload.allFields;
  if ((!fields || !Object.keys(fields).length) && hasKeyedControls(fragment)) {
    notes.push('the payload carries no allFields, so no control value was written (a stored -decisions.json summary is not a /decisions payload)');
  }
  let out = bakeFields(fragment, fields, notes);
  out = bakeMappings(out, payload && payload.mappings, notes);
  out = bakeFrozenFeedback(out, payload);
  out = replaceRootAttrs(out, a => setAttr(a, 'data-baked', true));
  return { html: out, notes };
}

// ---------------------------------------------------------------------------
// Source folder
// ---------------------------------------------------------------------------

function roundFiles(dir) {
  const rdir = path.join(dir, 'rounds');
  if (!fs.existsSync(rdir)) return [];
  return fs.readdirSync(rdir)
    .map(f => ({ f, m: /^(\d+)[^/\\]*\.html$/i.exec(f) }))
    .filter(x => x.m)
    .map(x => ({ n: Number(x.m[1]), file: path.join(rdir, x.f) }))
    .sort((a, b) => a.n - b.n);
}

const roundPath = (dir, n) => path.join(dir, 'rounds', `${String(n).padStart(2, '0')}.html`);
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, '');
const sha = s => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');

function readPage(dir) {
  const p = path.join(dir, 'page.json');
  if (!fs.existsSync(p)) throw new Error(`${p} missing — run "concept-build.js init" first`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writePage(dir, page) {
  writeAtomic(path.join(dir, 'page.json'), JSON.stringify(page, null, 2) + '\n');
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  // Windows refuses the rename (EPERM / EBUSY) while the bridge streams the
  // page or a scanner holds the new file: retry briefly, never leave the tmp.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (attempt >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { fs.unlinkSync(tmp); } catch { /* already gone */ }
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

/** Project root = the folder holding docs/concepts/…; falls back to cwd. */
function projectRootOf(dir) {
  const norm = path.resolve(dir);
  const i = norm.replace(/\\/g, '/').toLowerCase().lastIndexOf('/docs/concepts/');
  return i >= 0 ? norm.slice(0, i) : process.cwd();
}

function resolveHead(dir, opts = {}) {
  const own = path.join(dir, 'head.html');
  if (fs.existsSync(own)) return { source: own, html: fs.readFileSync(own, 'utf8') };
  const home = opts.home || os.homedir();
  for (const p of [
    path.join(projectRootOf(dir), '.claude', 'skills', 'auto-concept', 'head.html'),
    path.join(home, '.claude', 'skills', 'auto-concept', 'head.html'),
  ]) {
    if (fs.existsSync(p)) return { source: p, html: fs.readFileSync(p, 'utf8') };
  }
  return { source: 'built-in', html: DEFAULT_HEAD };
}

function outPathOf(dir) {
  const abs = path.resolve(dir);
  return path.join(path.dirname(abs), path.basename(abs) + '.html');
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

function tabLabel(attrs, n) {
  const own = getAttr(attrs, 'data-tab-label');
  if (own) return esc(own);
  if (hasAttr(attrs, 'data-final-report')) return '{{iteration.final_tab}}';
  if (hasAttr(attrs, 'data-reality-check')) return '{{iteration.reality_tab}}';
  return `Iteration ${n}`;
}

function tabsHtml(rounds, liveN) {
  return rounds.map(r => {
    const flags = ['data-reality-check', 'data-final-report'].filter(f => hasAttr(r.attrs, f)).map(f => ' ' + f).join('');
    const id = getAttr(r.attrs, 'id') || `iter-${r.n}`;
    return `<button class="iteration-tab" role="tab"${flags} data-iteration="${r.n}" aria-selected="${r.n === liveN ? 'true' : 'false'}" aria-controls="${esc(id)}">${tabLabel(r.attrs, r.n)}</button>`;
  }).join('\n');
}

/**
 * `{{key}}` → locale value. Only KNOWN keys are replaced (plus `{{slug}}`),
 * an unknown `{{…}}` stays as written, and nothing inside pre / code /
 * textarea bodies or JSON script blocks is touched — user content keeps its
 * braces.
 */
function substitute(html, locale, slug) {
  const spans = [];
  // A <style> or engine <script> block is matched first and skipped whole: a
  // CSS comment naming `<textarea data-comment>` is no textarea, and taking it
  // for one left every key up to the next real </textarea> unreplaced.
  const re = /<(style|script)\b(?![^>]*type=["']application\/json["'])[^>]*>[\s\S]*?<\/\1\s*>|(<(pre|code|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/\3\s*>|(<script\b[^>]*type=["']application\/json["'][^>]*>)[\s\S]*?<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) continue;
    const open = (m[2] || m[4]).length;
    spans.push([m.index + open - 1, m.index + m[0].length]);
  }
  return html.replace(/\{\{([a-z_.]+)\}\}/g, (whole, k, offset) => {
    if (inSpan(spans, offset)) return whole;
    if (k === 'slug') return slug;
    return locale.has(k) ? locale.get(k) : whole;
  });
}

/**
 * Assemble the page from the engine (templates of THIS plugin) and the
 * source folder's content. Pure: returns { html, problems, … }.
 */
function assemble({ page, head, fragments, slug = 'concept', md = readTemplates() }) {
  const problems = [];
  const blocks = scanBlocks(md);
  const htmlBlocks = blocks.filter(b => b.info === 'html');
  const css = blocks.filter(b => b.info === 'css').map(b => b.code).join('\n\n');
  const js = blocks.filter(b => /^(javascript|js)$/.test(b.info)).map(b => b.code).join('\n\n');
  const locale = localeMap(md, page.locale || 'en');

  const rounds = fragments.map(({ n, html }) => {
    const root = rootSection(html);
    return { n, html, attrs: root ? root.attrs : '', root };
  });
  if (!rounds.length) problems.push('no round fragments in rounds/ — write rounds/01.html first');
  const seen = new Set();
  let finals = 0;
  const live = rounds[rounds.length - 1];
  for (const r of rounds) {
    if (!r.root) { problems.push(`round ${r.n}: no <section> element`); continue; }
    const it = getAttr(r.attrs, 'data-iteration');
    if (String(it) !== String(r.n)) problems.push(`round ${r.n}: section carries data-iteration="${it}", the file name says ${r.n}`);
    const t = getAttr(r.attrs, 'data-iteration-template');
    if (!t || !VALID_TEMPLATES.has(t)) problems.push(`round ${r.n}: data-iteration-template missing or not decision|design|free`);
    if (seen.has(r.n)) problems.push(`round ${r.n}: duplicate round number`);
    seen.add(r.n);
    if (hasAttr(r.attrs, 'data-final-report')) finals++;
    const masked = maskComments(r.html);
    if ((masked.match(/<section\b[^>]*\bdata-iteration=/gi) || []).length > 1) problems.push(`round ${r.n}: more than one section[data-iteration] in one fragment`);
    const ext = rootExtent(r.html);
    if (ext && ext.end < 0) problems.push(`round ${r.n}: the round section is never closed`);
    else if (ext) {
      const outside = (masked.slice(0, ext.start) + masked.slice(ext.end)).trim();
      if (outside) problems.push(`round ${r.n}: content outside the round section ("${outside.slice(0, 40)}…") — everything belongs inside it`);
    }
    if (r !== live && !hasAttr(r.attrs, 'data-baked')) problems.push(`round ${r.n}: frozen but never baked — run "concept-build.js bake --round ${r.n}" with its payload first`);
  }
  if (finals > 1) problems.push('more than one data-final-report round');
  if (finals === 1 && live && !hasAttr(live.attrs, 'data-final-report')) problems.push('a final-report round must be the last round');

  const liveN = live ? live.n : 0;
  const sectionsHtml = rounds.map(r => {
    let html = r.html.trim();
    html = replaceRootAttrs(html, a => (getAttr(a, 'id') ? a : setAttr(a, 'id', `iter-${r.n}`)));
    return r.n === liveN ? activateFragment(html) : freezeFragment(html);
  }).join('\n\n');

  const liveTemplate = normTemplate(live ? getAttr(live.attrs, 'data-iteration-template') || 'decision' : 'decision');
  const anyDesign = rounds.some(r => normTemplate(getAttr(r.attrs, 'data-iteration-template')) === 'design')
    || page.mode === 'design' || page.mode === 'mixed';
  const version = page.pageVersion || stamp();
  const title = page.title || 'Concept';
  const headExtra = `<meta name="generator" content="${GENERATOR}">\n${head}`;
  let html;

  if (anyDesign) {
    const skel = htmlBlocks.find(b => b.code.includes('class="concept-layout design fullscreen"'));
    const common = htmlBlocks.find(b => b.code.startsWith('<!DOCTYPE html>'));
    if (!skel || !common) throw new Error('design or common skeleton not found in the concept templates');
    const foot = common.code.slice(common.code.indexOf('<div id="panel-frozen"'), common.code.indexOf('<!-- /.panel-cta -->'));
    const restStates = foot.slice(0, foot.lastIndexOf('</div>'));
    html = skel.code
      .replace(/<!-- The remaining two panel states[\s\S]*?-->/, () => restStates)
      .replace(/^<html data-template="design">/m, () =>
        `<!DOCTYPE html>\n<html lang="${esc(page.locale || 'en')}" data-theme="dark" data-page-version="${esc(version)}" data-template="${liveTemplate}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Concept — ${esc(title)}</title>\n${headExtra}\n<style>\n${css}\n</style>\n</head>`)
      .replace(/<body style="overflow: hidden">/, () => `<body${liveTemplate === 'design' ? ' style="overflow: hidden"' : ''}>`)
      .replace(/<main>[\s\S]*?<\/main>/, () => `<main>\n${sectionsHtml}\n</main>`)
      .replace(/<\/body>\s*<\/html>\s*$/, () => `<script type="application/json" id="concept-decisions">\n{"submitted": false, "decisions": [], "comments": {"general": {"text": "", "attachments": []}, "items": []}}\n</script>\n<script>\n${js}\n</script>\n</body>\n</html>\n`);
  } else {
    const skel = htmlBlocks.find(b => b.code.startsWith('<!DOCTYPE html>'));
    if (!skel) throw new Error('common skeleton not found in the concept templates');
    const sub = page.subtitle ? `<p class="subtitle">${esc(page.subtitle)}</p>` : '';
    html = skel.code
      .replace(/<html lang="en"[^>]*>/, () => `<html lang="${esc(page.locale || 'en')}" data-theme="dark" data-page-version="${esc(version)}" data-template="${liveTemplate}">`)
      .replace(/<title>[^<]*<\/title>/, () => `<title>Concept — ${esc(title)}</title>\n  ${headExtra}`)
      .replace(/<style>\/\* all CSS inline \*\/<\/style>/, () => `<style>\n${css}\n</style>`)
      .replace(/<h1>\{title\}<\/h1>\s*<p class="subtitle">[^<]*<\/p>/, () => `<h1>${esc(title)}</h1>\n        ${sub}`)
      .replace(/<main>[\s\S]*?<\/main>/, () => `<main>\n${sectionsHtml}\n</main>`)
      .replace(/<script>\/\* all JS inline \*\/<\/script>/, () => `<script>\n${js}\n</script>`);
  }

  html = html.replace(/(<nav class="iteration-tabs"[^>]*>)[\s\S]*?(<\/nav>)/, (_, a, b) => `${a}\n${tabsHtml(rounds, liveN)}\n${b}`);
  html = substitute(html, locale, slug);
  html = html.replace(/\{generation-timestamp\}/g, version);
  return { html, rounds: rounds.map(r => r.n), liveN, liveTemplate, problems };
}

/** Deterministic gate over the assembled page (hooks/lib/concept-gate.js). */
function runGate(outPath, html) {
  const r = gate.evaluate(outPath, html);
  return {
    ok: r.ok,
    reason: r.ok ? '' : gate.buildBlockReason(outPath, r.missing, r.forbidden, r.structural, r.mapping, r.overlap, r.stale, r.collisions),
    warnings: (r.warnings || []).map(w => w.why),
  };
}

function build(dir, opts = {}) {
  const page = readPage(dir);
  const head = resolveHead(dir, opts);
  const fragments = roundFiles(dir).map(r => ({ n: r.n, html: fs.readFileSync(r.file, 'utf8') }));
  const out = opts.out || outPathOf(dir);
  const slug = path.basename(out).replace(/\.html?$/i, '');
  if (!page.pageVersion) page.pageVersion = stamp();          // fixed from the first build on
  const res = assemble({ page, head: head.html, fragments, slug, md: opts.md });
  const g = runGate(out, res.html);
  const problems = [...res.problems];

  // A page on disk that is not the last build was edited by hand (or by a
  // session without this script) — rebuilding would silently drop that work.
  if (!opts.force && page.lastBuild && fs.existsSync(out) && sha(fs.readFileSync(out, 'utf8')) !== page.lastBuild) {
    problems.push(`${path.basename(out)} changed since the last build (edited by hand?) — move that content into the round fragments, then build with --force`);
  }
  const ok = !problems.length && g.ok;
  if (ok && !opts.dryRun) {
    writeAtomic(out, res.html);
    page.lastBuild = sha(res.html);
    writePage(dir, page);
  }
  return { ok, out, head: head.source, bytes: res.html.length, rounds: res.rounds, live: res.liveN, template: res.liveTemplate, problems, gate: g.reason, warnings: g.warnings || [], html: res.html };
}

function init(dir, opts) {
  if (fs.existsSync(path.join(dir, 'page.json')) && !opts.force) throw new Error(`${dir}/page.json exists — refusing to overwrite (pass --force)`);
  fs.mkdirSync(path.join(dir, 'rounds'), { recursive: true });
  const page = {
    title: opts.title || 'Concept',
    subtitle: opts.subtitle || '',
    locale: opts.locale || 'en',
    mode: opts.mode || 'decision',
    // Kept for the life of the concept: reload detection and the draft store
    // key on it, so a rebuild must never change it.
    pageVersion: stamp(),
  };
  writePage(dir, page);
  return page;
}

function bakeRound(dir, n, payload, opts = {}) {
  if (!opts.unanswered && payload && payload.iteration !== undefined && Number(payload.iteration) !== Number(n)) {
    throw new Error(`the payload is for round ${payload.iteration}, not round ${n}`);
  }
  const alt = roundFiles(dir).find(r => r.n === Number(n));
  if (!alt) throw new Error(`round ${n} has no fragment in ${path.join(dir, 'rounds')}`);
  const before = fs.readFileSync(alt.file, 'utf8');
  const { html, notes } = bake(before, payload, opts);
  writeAtomic(alt.file, html);
  return { file: alt.file, changed: before !== html, notes };
}

/**
 * Split a single-file page (written before this script) into a source
 * folder: each top-level section[data-iteration] of <main> becomes a round
 * fragment (template inferred where an old page left it out; every round but
 * the last marked baked — its values are already in the markup), and the
 * page's own CSS ahead of the engine plus its CSP meta become head.html.
 */
function importPage(htmlPath, dir, opts = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const forceHint = ' (to take the page as the truth because it moved ahead outside the build, re-run with --force: its rounds replace the folder\'s)';
  if (fs.existsSync(path.join(dir, 'page.json')) && !opts.force) throw new Error(`${dir}/page.json exists — this concept already has a source folder${forceHint}`);
  if (/<meta name="generator" content="concept-build">/.test(html) && !opts.force) throw new Error(`this page is already built by concept-build.js — edit its source folder instead${forceHint}`);
  if (opts.force) for (const r of roundFiles(dir)) fs.unlinkSync(r.file);
  const masked = maskComments(html);
  const mainAt = masked.search(/<main\b[^>]*>/i);
  const mainEnd = masked.lastIndexOf('</main>');
  if (mainAt < 0 || mainEnd < 0) throw new Error('no <main> in the page — not a concept page this script can import');
  const bodyStart = masked.indexOf('>', mainAt) + 1;
  const body = html.slice(bodyStart, mainEnd);
  const bodyMasked = masked.slice(bodyStart, mainEnd);
  const re = /<section\b((?:[^>"']|"[^"]*"|'[^']*')*)>|<\/section\s*>/gi;
  const found = [];
  let depth = 0, start = -1, m;
  while ((m = re.exec(bodyMasked))) {
    if (m[0][1] !== '/') {
      if (depth === 0 && /\bdata-iteration\s*=/.test(m[1] || '')) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) { found.push(body.slice(start, re.lastIndex)); start = -1; }
    }
  }
  if (!found.length) throw new Error('no section[data-iteration] found in <main>');

  const headPart = html.slice(0, Math.max(0, masked.search(/<\/head>/i)));
  const titleTag = (/<title>([^<]*)<\/title>/i.exec(headPart) || [])[1];
  const afterHead = html.slice(masked.search(/<\/head>/i));
  const h1 = (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(afterHead) || [])[1];
  const clean = s => decode(String(s || '').replace(/<[^>]+>/g, '')).trim();
  const title = clean(titleTag).replace(/^Concept\s+[—-]\s+/, '') || clean(h1) || 'Concept';
  const subtitle = clean((/<p class="subtitle">([\s\S]*?)<\/p>/i.exec(afterHead) || [])[1]);
  const htmlTag = (/<html\b([^>]*)>/i.exec(html) || [])[1] || '';
  const locale = getAttr(htmlTag, 'lang') || 'en';
  const pageVersion = getAttr(htmlTag, 'data-page-version') || stamp();
  const base = normTemplate(getAttr(htmlTag, 'data-template') || '')
    || found.map(s => getAttr(rootSection(s).attrs, 'data-iteration-template')).find(Boolean) || 'decision';
  const fragments = found.map(s => {
    const t = getAttr(rootSection(s).attrs, 'data-iteration-template');
    return t ? s : replaceRootAttrs(s, a => setAttr(a, 'data-iteration-template', normTemplate(base)));
  });
  const templates = fragments.map(s => normTemplate(getAttr(rootSection(s).attrs, 'data-iteration-template')));
  const mode = templates.includes('design') ? (templates.every(t => t === 'design') ? 'design' : 'mixed') : 'decision';

  fs.mkdirSync(path.join(dir, 'rounds'), { recursive: true });
  writePage(dir, { title, subtitle, locale, mode, pageVersion });
  fragments.forEach((s, i) => {
    const n = Number(getAttr(rootSection(s).attrs, 'data-iteration'));
    const frag = i < fragments.length - 1 ? replaceRootAttrs(s, a => setAttr(a, 'data-baked', true)) : s;
    fs.writeFileSync(roundPath(dir, n), frag.trim() + '\n');
  });

  // Head: CSP meta + the page's own CSS ahead of the engine's first rule.
  const csp = (/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(headPart) || [])[0];
  const firstStyle = /<style\b[^>]*>([\s\S]*?)<\/style>/i.exec(headPart);
  let own = '';
  if (firstStyle) {
    const engineCss = scanBlocks(opts.md || readTemplates()).filter(b => b.info === 'css').map(b => b.code.trim()).filter(Boolean);
    const probe = engineCss.length ? engineCss[0].slice(0, 80) : null;
    const cut = probe ? firstStyle[1].indexOf(probe) : -1;
    own = (cut > 0 ? firstStyle[1].slice(0, cut) : '').trim();
    if (!own) {
      // An older engine (the probe is today's first block): keep the page's
      // token rules and add the built-in content base, which those pages
      // carried somewhere inside their engine copy.
      const tokens = [...firstStyle[1].matchAll(/(^|\n)\s*((?::root|html\[data-theme[^\]]*\])\s*\{[^}]*\})/g)].map(x => x[2]).join('\n');
      own = tokens ? `${tokens}\n${CONTENT_BASE}` : '';
    }
  }
  const headParts = [];
  if (csp) headParts.push(csp);
  headParts.push(own ? `<style>\n${own}\n</style>` : DEFAULT_HEAD);
  fs.writeFileSync(path.join(dir, 'head.html'), headParts.join('\n') + '\n');
  return { rounds: found.length, mode, head: own ? 'page' : 'default' };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function report(r, dry) {
  const lines = [];
  lines.push(`${r.ok ? 'OK' : 'BLOCKED'} ${r.out}${dry && r.ok ? ' (check only, nothing written)' : ''}`);
  lines.push(`  rounds ${r.rounds.join(',') || '-'} · live ${r.live} (${r.template}) · ${r.bytes} bytes · head ${r.head}`);
  r.problems.forEach(p => lines.push(`  ✗ ${p}`));
  (r.warnings || []).forEach(w => lines.push(`  ⚠ ${w}`));
  if (r.gate) lines.push(r.gate.split('\n').map(l => '  ' + l).join('\n'));
  if (!r.ok) lines.push('  The page was NOT written — the last good build stays live. Fix the round fragment, then build again.');
  return lines.join('\n') + '\n';
}

const USAGE = `usage:
  concept-build.js init   <dir> --title T [--subtitle S] [--locale de] [--mode decision|design|mixed|free] [--allow-main]
  concept-build.js build  <dir> [--out file.html] [--force]
  concept-build.js check  <dir>
  concept-build.js bake   <dir> --round N (--payload decisions.json | --unanswered)
  concept-build.js import <page.html> [--dir <dir>] [--force]
`;

/**
 * Why `init <dir>` must not run here, or null. A new concept in a repo's MAIN
 * checkout on main/master lands where the Edit/Write branch guard cannot see
 * it (node writes), and the session only notices at its first blocked brief —
 * with a page and a live bridge to relocate. Only `init` refuses: `build`,
 * `bake` and `check` serve pages that already exist. Not a git repo, a linked
 * worktree, a feature branch, DEVOPS_ALLOW_MAIN=1 or --allow-main → null.
 */
function mainCheckoutRefusal(dir, args) {
  if (args['allow-main'] || process.env.DEVOPS_ALLOW_MAIN === '1') return null;
  const { execFileSync } = require('child_process');
  let probe = path.resolve(dir);
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const git = (a) => {
    try { return execFileSync('git', ['-C', probe, ...a], { windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
  const gitDir = git(['rev-parse', '--absolute-git-dir']);
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !common || path.resolve(gitDir) !== path.resolve(common)) return null;
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch !== 'main' && branch !== 'master') return null;
  return `refusing to start a concept in the repo's MAIN checkout on ${branch} (${path.dirname(common)}). ` +
    'Call EnterWorktree first and run init inside the worktree — the standing devops rule; with workspace.ownWorktree set, do not ask the user. ' +
    'A repo deliberately worked on main: DEVOPS_ALLOW_MAIN=1 (set by the user) or --allow-main.';
}

function main(argv) {
  const args = parseArgs(argv);
  const [cmd, target] = args._;
  try {
    if (cmd === 'init' && target) {
      const refusal = mainCheckoutRefusal(target, args);
      if (refusal) { process.stderr.write(`concept-build: ${refusal}\n`); return 3; }
      const page = init(target, args);
      process.stdout.write(`init ${path.resolve(target)} (locale ${page.locale}, mode ${page.mode}, pageVersion ${page.pageVersion})\n`);
      return 0;
    }
    if ((cmd === 'build' || cmd === 'check') && target) {
      const r = build(target, { out: args.out, dryRun: cmd === 'check', force: !!args.force });
      process.stdout.write(report(r, cmd === 'check'));
      return r.ok ? 0 : 1;
    }
    if (cmd === 'bake' && target && args.round && (args.payload || args.unanswered)) {
      const raw = args.payload ? JSON.parse(fs.readFileSync(args.payload, 'utf8')) : null;
      const r = bakeRound(target, Number(args.round), raw, { unanswered: !!args.unanswered });
      process.stdout.write(`baked round ${args.round} into ${r.file}${r.changed ? '' : ' (no change)'}\n`);
      r.notes.forEach(n => process.stdout.write(`  ! ${n}\n`));
      return 0;
    }
    if (cmd === 'import' && target) {
      const dir = args.dir || target.replace(/\.html?$/i, '');
      const r = importPage(target, dir, { force: !!args.force });
      process.stdout.write(`imported ${r.rounds} rounds into ${path.resolve(dir)} (mode ${r.mode}, head from the ${r.head} CSS)\n`);
      return 0;
    }
  } catch (e) {
    process.stderr.write(`concept-build: ${e.message}\n`);
    return 2;
  }
  process.stderr.write(USAGE);
  return 2;
}

module.exports = {
  assemble, build, init, bake, bakeRound, importPage, freezeFragment, activateFragment, substitute,
  resolveHead, outPathOf, roundFiles, getAttr, setAttr, removeAttr, parseAttrs, DEFAULT_HEAD, GENERATOR,
  mainCheckoutRefusal,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
