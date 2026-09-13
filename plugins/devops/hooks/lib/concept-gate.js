#!/usr/bin/env node
/**
 * @module concept-gate
 * @description Deterministic validator for concept HTML pages.
 *
 *   Backstop for two recurring regressions where Claude only "half-uses" the
 *   concept skill:
 *     A) the page bakes in a "copy the JSON, paste it into chat" submit
 *        instead of the live bridge — a clipboard fallback that defeats the
 *        whole monitoring loop.
 *     B) the page ships with no live decision panel at all.
 *
 *   This is a focused gate, NOT a re-implementation of the full 35-pattern
 *   validation-gate.md. It checks only the markers whose absence equals
 *   failure mode A or B, plus the forbidden clipboard/paste-to-chat anti-
 *   pattern. The full pattern sweep stays Claude's Step-2 responsibility.
 */

const path = require('path');

// Live decision-panel + bridge-submit markers that MUST be present.
// Each label doubles as the grep token and the human-readable reason line.
const REQUIRED = [
  { token: 'concept-decisions', why: 'decision data container' },
  { token: 'panel-ready', why: 'live decision panel (ready state)' },
  { token: 'iteration-tabs', why: 'decision-panel iteration tab bar' },
  { token: 'submit-iterate-btn', why: 'live "Zur nächsten Iteration" submit button' },
  { token: 'submit-implement-btn', why: 'live "Mit Feedback implementieren" submit button' },
  { token: 'pollHeartbeat', why: 'bridge-server heartbeat poll' },
  { token: 'connection-status', why: 'inline connection status pill (connecting / connected / disconnected)' },
];

// Clipboard / paste-into-chat submit anti-patterns. A valid live-bridge
// concept page never copies anything to the clipboard, so any match here is
// the exact regression the user reported.
//
// The clipboard pattern matches the copy-out API and the copy-out UI wording
// only — NOT the bare word. The templates' own attachment engine legitimately
// reads `ev.clipboardData` for Ctrl/Cmd+V file paste (templates.md
// § Attachments), and a bare /clipboard/ blocked every page generated verbatim
// from the reference (#330).
const FORBIDDEN = [
  { re: /navigator\.clipboard|clipboard\.(write|read)(Text)?\(|copy (to|into) (the )?clipboard/i, why: 'clipboard copy (navigator.clipboard / clipboard.writeText / "copy to clipboard")' },
  { re: /zwischenablage/i, why: '"Zwischenablage kopieren" copy UI' },
  { re: /in den chat (ein|einf)/i, why: '"in den Chat einfügen" paste instruction' },
  { re: /paste[^.\n]{0,24}chat/i, why: '"paste … into chat" instruction' },
];

/**
 * Is this written file a concept page we should gate?
 * Triggers on the canonical output location (the `docs/concepts/*.html` path
 * where SKILL.md Step 2 writes every concept) OR on a concept content
 * signature, so a misplaced page is still caught. The narrow `docs/concepts/`
 * match avoids false-positives on an unrelated `concepts/` folder a consumer
 * project might happen to have.
 */
function isConceptHtml(filePath, html) {
  if (!filePath || !/\.html?$/i.test(filePath)) return false;
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (norm.includes('docs/concepts/')) return true;
  const body = html || '';
  return (
    body.includes('concept-decisions') ||
    /data-template=["'](decision|prototype|free)["']/.test(body) ||
    body.includes('submit-iterate-btn')
  );
}

/** Required markers absent from the html. */
function findMissing(html) {
  const body = html || '';
  return REQUIRED.filter(r => !body.includes(r.token));
}

/** Forbidden anti-patterns present in the html. */
function findForbidden(html) {
  const body = html || '';
  return FORBIDDEN.filter(f => f.re.test(body));
}

/**
 * Structural integrity of the `<style>` / `<script>` blocks (#346).
 *
 * Every marker grep passes on a page whose opening `<style>` line was copied
 * INSIDE the new style block (engine CSS carried over from an older page):
 * the CSS parser swallows the whole `:root` token block and the page renders
 * white and unthemed — "das ganze Konzept kaputt dargestellt" — while all the
 * required tokens are still present. So the gate walks the tag stream and
 * reports: a `<style` or `<script` that opens while a block of that kind is
 * already open, a closing tag with no open block, an open block that never
 * closes, and an open/close count mismatch per kind. A `<style` token seen
 * while a `<script>` block is open is ignored — that is a string inside JS,
 * not markup — and only the tag-open form (`<style>` / `<style ...>`) counts,
 * never a bare mention in prose or a comment.
 *
 * @returns {Array<{kind:string, why:string, at:number}>} — empty when sound.
 */
function findStructural(html) {
  const body = html || '';
  const issues = [];
  const re = /<(\/?)(style|script)(?=[\s>])/gi;
  const open = { style: null, script: null };
  const counts = { style: { open: 0, close: 0 }, script: { open: 0, close: 0 } };
  let m;
  while ((m = re.exec(body)) !== null) {
    const closing = m[1] === '/';
    const kind = m[2].toLowerCase();
    const at = m.index;
    // Inside an open <script>, a "<style" / "<script" token is JS string
    // content (template literals building markup), not a tag.
    if (open.script !== null && !(closing && kind === 'script')) continue;
    if (closing) {
      counts[kind].close += 1;
      if (open[kind] === null) {
        issues.push({ kind: `stray-close-${kind}`, why: `</${kind}> at offset ${at} closes nothing — no open <${kind}> block`, at });
      } else {
        open[kind] = null;
      }
      continue;
    }
    counts[kind].open += 1;
    if (open[kind] !== null) {
      issues.push({ kind: `nested-${kind}`, why: `<${kind}> at offset ${at} opens inside the <${kind}> block that opened at offset ${open[kind]} — the parser swallows everything up to the next </${kind}>`, at });
      continue; // keep the outer block as the open one
    }
    if (kind === 'script' && open.style !== null) {
      issues.push({ kind: 'script-in-style', why: `<script> at offset ${at} opens inside the <style> block that opened at offset ${open.style}`, at });
      continue;
    }
    open[kind] = at;
  }
  for (const kind of ['style', 'script']) {
    if (open[kind] !== null) {
      issues.push({ kind: `unclosed-${kind}`, why: `<${kind}> at offset ${open[kind]} is never closed`, at: open[kind] });
    }
    const c = counts[kind];
    if (c.open !== c.close) {
      issues.push({ kind: `unbalanced-${kind}`, why: `${c.open} <${kind}> vs ${c.close} </${kind}> tags`, at: -1 });
    }
  }
  return issues;
}

// --- Information mapping specs (templates.md § Information Mapping (engine)) -

const MAP_ID_RE = /^[a-z0-9_]+$/;
const MAP_RESERVED_RE = /^u\d+$/; // `u{n}` belongs to ad-hoc items

/**
 * Split a matrix / order key (`{base}` or `{base}@{ctx}`) into its parts.
 * Only the LAST `@` separates the context: ids never contain `@`, so a
 * key with more than one is simply reported as unknown by the caller.
 */
function splitCtxKey(key) {
  const i = String(key).lastIndexOf('@');
  return i < 0 ? { base: String(key), ctx: null } : { base: key.slice(0, i), ctx: key.slice(i + 1) };
}

/**
 * Validate one parsed mapping spec against the engine's `normalizeSpec()`
 * rules (M2–M4 of the design spec) plus the reference / context checks of
 * `proposal`, `proposalOrder`, `submitted.cells` and `submitted.order`.
 * Pushes `{kind, why, at}` issues; returns the derived model the caller
 * needs for the frozen-round check (M9).
 */
function validateMappingSpec(raw, mid, at, issues) {
  const push = (kind, why) => issues.push({ kind, why: `mapping "${mid}": ${why}`, at });
  const show = v => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v));
  // Shape: a present but non-array list is a spec error, never silently [].
  const arr = (v, field, where) => {
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    push('spec-parse', `"${field}" must be an array${where ? ` (${where})` : ''}`);
    return [];
  };
  const idOf = o => (o && typeof o === 'object' ? o.id : undefined);

  const items = arr(raw.items, 'items');
  const elements = arr(raw.elements, 'elements');
  const axes = arr(raw.axes, 'axes');
  const rawHasContext = raw.context != null;
  const ctxIsObject = rawHasContext && typeof raw.context === 'object' && !Array.isArray(raw.context);
  if (rawHasContext && !ctxIsObject) push('spec-parse', '"context" must be an object');
  const ctxValues = ctxIsObject ? arr(raw.context.values, 'context.values') : [];
  // Like the engine: a context without values is no context at all.
  const hasContext = ctxValues.length > 0;
  const elParts = elements.map(el => arr(el && el.parts, 'parts', `element ${show(idOf(el))}`));
  const axColumns = axes.map(ax => arr(ax && ax.columns, 'columns', `axis ${show(idOf(ax))}`));

  // M4 — an empty mapping renders nothing.
  if (!items.length) push('empty-mapping', 'no items — at least one is required');
  if (!elements.length && !axes.length) push('empty-mapping', 'no elements and no axes — at least one is required');
  elements.forEach((el, i) => { if (!elParts[i].length) push('empty-mapping', `element ${show(idOf(el))} has no parts`); });
  axes.forEach((ax, i) => { if (!axColumns[i].length) push('empty-mapping', `axis ${show(idOf(ax))} has no columns`); });
  if (rawHasContext && !hasContext) push('empty-mapping', 'context is present but has no values');

  // M2 — id grammar over every id the engine checks.
  const checkId = (what, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { push('bad-id', `${what} entry ${show(entry)} must be an object with an "id"`); return; }
    const id = entry.id;
    if (typeof id !== 'string' || !MAP_ID_RE.test(id)) push('bad-id', `${what} id ${show(id)} must match ^[a-z0-9_]+$`);
  };
  items.forEach(it => checkId('item', it));
  elements.forEach((el, i) => { checkId('element', el); elParts[i].forEach(p => checkId(`part (element ${show(idOf(el))})`, p)); });
  axes.forEach((ax, i) => { checkId('axis', ax); axColumns[i].forEach(c => checkId(`column (axis ${show(idOf(ax))})`, c)); });
  ctxValues.forEach(v => checkId('context value', v));
  items.forEach(it => {
    const id = idOf(it);
    if (typeof id === 'string' && MAP_RESERVED_RE.test(id)) push('bad-id', `item id "${id}" is reserved for ad-hoc items (u{n})`);
  });

  // M2 — uniqueness.
  const dupes = (what, ids, where) => {
    const seen = new Set();
    ids.forEach(id => {
      if (id === undefined) return;
      const k = typeof id === 'string' ? id : JSON.stringify(id);
      if (seen.has(k)) push('duplicate-id', `duplicate ${what} id ${show(id)}${where || ''}`);
      seen.add(k);
    });
  };
  dupes('item', items.map(idOf));
  dupes('source', [...elements.map(idOf), ...axes.map(idOf)], ' (element and axis ids share one namespace)');
  elements.forEach((el, i) => dupes('part', elParts[i].map(idOf), ` in element ${show(idOf(el))}`));
  axes.forEach((ax, i) => dupes('column', axColumns[i].map(idOf), ` in axis ${show(idOf(ax))}`));
  dupes('context value', ctxValues.map(idOf));

  // Derived sets for the reference checks (M3).
  const itemIds = new Set(items.map(idOf).filter(id => typeof id === 'string'));
  const ctxIds = new Set(ctxValues.map(idOf).filter(id => typeof id === 'string'));
  const sources = [
    ...elements.map((el, i) => ({ id: idOf(el), targets: elParts[i].map(p => ({ key: `${idOf(el)}.${idOf(p)}`, ordered: !!(p && p.ordered) })) })),
    ...axes.map((ax, i) => ({ id: idOf(ax), targets: axColumns[i].map(c => ({ key: `${idOf(ax)}.${idOf(c)}`, ordered: false })) })),
  ];
  const targetKeys = new Set(sources.flatMap(s => s.targets.map(t => t.key)));
  const orderedKeys = new Set(sources.flatMap(s => s.targets.filter(t => t.ordered).map(t => t.key)));
  const targetsOf = new Map(sources.map(s => [s.id, new Set(s.targets.map(t => t.key))]));
  const withCtx = key => (ctxIds.size ? [...ctxIds].map(c => `${key}@${c}`) : [key]);
  const matrixKeys = sources.flatMap(s => withCtx(s.id));
  const orderKeys = [...orderedKeys].flatMap(withCtx);

  // A context reference in a proposal triple / key must agree with the spec.
  const checkCtx = (where, ctx) => {
    if (ctx == null) {
      if (hasContext) { push('ctx-mismatch', `${where} lacks the context value the spec's "context" requires`); return false; }
      return true;
    }
    if (!hasContext) { push('ctx-mismatch', `${where} carries context ${show(ctx)} but the spec has no "context"`); return false; }
    if (!ctxIds.has(ctx)) { push('ctx-mismatch', `${where} names unknown context value ${show(ctx)}`); return false; }
    return true;
  };

  arr(raw.proposal, 'proposal').forEach((p, i) => {
    const where = `proposal[${i}] ${JSON.stringify(p)}`;
    if (!Array.isArray(p) || p.length < 2) { push('unknown-ref', `${where} is not an [item, target] pair`); return; }
    if (!itemIds.has(p[0])) push('unknown-ref', `${where} references unknown item ${show(p[0])}`);
    if (!targetKeys.has(p[1])) push('unknown-ref', `${where} references unknown target ${show(p[1])} (expected {element|axis}.{part|column})`);
    checkCtx(where, p.length > 2 && p[2] != null ? p[2] : null);
  });

  // `{target}` / `{target}@{ctx}` → [itemIds]; the target must be ordered.
  const checkOrder = (label, order, extraItem) => {
    if (order == null) return;
    if (typeof order !== 'object' || Array.isArray(order)) { push('unknown-ref', `${label} must be an object keyed by "{target}" or "{target}@{ctx}"`); return; }
    Object.keys(order).forEach(key => {
      const where = `${label}["${key}"]`;
      const { base, ctx } = splitCtxKey(key);
      if (!targetKeys.has(base)) push('unknown-ref', `${where} names unknown target ${show(base)}`);
      else if (!orderedKeys.has(base)) push('unknown-ref', `${where} names target ${show(base)} which is not "ordered": true`);
      checkCtx(where, ctx);
      if (!Array.isArray(order[key])) { push('unknown-ref', `${where} must be an array of item ids`); return; }
      order[key].forEach(id => { if (!itemIds.has(id) && !extraItem(id)) push('unknown-ref', `${where} lists unknown item ${show(id)}`); });
    });
  };
  checkOrder('proposalOrder', raw.proposalOrder, () => false);

  // `submitted` — written by Claude when the round is frozen (§ Freezing).
  const submitted = raw.submitted != null && typeof raw.submitted === 'object' && !Array.isArray(raw.submitted) ? raw.submitted : null;
  const cells = submitted && submitted.cells != null && typeof submitted.cells === 'object' && !Array.isArray(submitted.cells) ? submitted.cells : null;
  const order = submitted && submitted.order != null && typeof submitted.order === 'object' && !Array.isArray(submitted.order) ? submitted.order : null;
  // Ad-hoc items `u{n}` resolve against `submitted.adhoc` (labels, 1-based).
  const adhocCount = submitted && Array.isArray(submitted.adhoc) ? submitted.adhoc.length : 0;
  const isAdhoc = id => {
    const m = typeof id === 'string' && MAP_RESERVED_RE.exec(id);
    if (!m) return false;
    const n = Number(id.slice(1));
    return !!raw.adhocItems && n >= 1 && n <= adhocCount;
  };
  if (cells) {
    Object.keys(cells).forEach(key => {
      const where = `submitted.cells["${key}"]`;
      const { base, ctx } = splitCtxKey(key);
      const known = targetsOf.has(base);
      if (!known) push('unknown-ref', `${where} names unknown element/axis ${show(base)} (matrix keys are "{src}" or "{src}@{ctx}")`);
      checkCtx(where, ctx);
      const pairs = cells[key];
      if (!Array.isArray(pairs)) { push('unknown-ref', `${where} must be an array of [item, target] pairs`); return; }
      pairs.forEach((p, i) => {
        const pw = `${where}[${i}] ${JSON.stringify(p)}`;
        if (!Array.isArray(p) || p.length < 2) { push('unknown-ref', `${pw} is not an [item, target] pair`); return; }
        if (p.length > 2 && p[2] != null) push('ctx-mismatch', `${pw} carries a third element — the context belongs in the matrix key ("${base}@{ctx}"), not in the pair`);
        if (!itemIds.has(p[0]) && !isAdhoc(p[0])) push('unknown-ref', `${pw} references unknown item ${show(p[0])}`);
        if (!targetKeys.has(p[1])) push('unknown-ref', `${pw} references unknown target ${show(p[1])}`);
        else if (known && !targetsOf.get(base).has(p[1])) push('unknown-ref', `${pw} target ${show(p[1])} does not belong to "${base}"`);
      });
    });
  }
  if (submitted) checkOrder('submitted.order', submitted.order, isAdhoc);

  // Mirror of the engine's complete(): every matrix key present as an array.
  // Ordered targets additionally need `submitted.order[key]` — otherwise the
  // engine falls back to `proposalOrder` and shows the proposal's order as
  // the user's decision.
  const missingKeys = cells ? matrixKeys.filter(k => !Array.isArray(cells[k])) : matrixKeys;
  const missingOrderKeys = order ? orderKeys.filter(k => !Array.isArray(order[k])) : orderKeys;
  const complete = !!cells && !missingKeys.length && !missingOrderKeys.length;
  return { complete, matrixKeys, missingKeys, orderKeys, missingOrderKeys };
}

/**
 * Information-mapping specs (templates.md § Information Mapping (engine) →
 * Spec; design spec § 11 rules M1–M4 and M9).
 *
 * Every `section[data-mapping]` must carry a `<script data-mapping-spec>`
 * whose JSON normalises exactly as the page's engine normalises it: id
 * grammar, uniqueness, resolvable `proposal` / `submitted` references, the
 * context dimension present iff the spec has one, a non-empty target set.
 * A mapping inside an iteration WITHOUT `data-active` is frozen and must
 * carry a complete `submitted` (a cells entry for every matrix key) —
 * otherwise the page silently presents Claude's proposal as the user's
 * decision, the one outcome this construct must never produce.
 *
 * Regex walk over the raw HTML, like findStructural: iteration open tags
 * give the frozen/live state (nearest preceding one wins), mapping open tags
 * delimit where a spec script may sit (before the wrapper's `</section>` and
 * before the next mapping). Attribute values may be double- or
 * single-quoted; the `data-mapping` value must follow the id grammar and
 * equal the section's `id`. Ordered targets of a frozen round need
 * `submitted.order` as well as `submitted.cells`.
 *
 * @returns {Array<{kind:string, why:string, at:number}>} — empty when sound.
 */
function findMappingIssues(html) {
  const body = html || '';
  const issues = [];
  if (!body.includes('data-mapping')) return issues;

  const iterations = [];
  const iterRe = /<section\b[^>]*\bdata-iteration=("|')(\d+)\1[^>]*>/gi;
  let m;
  while ((m = iterRe.exec(body)) !== null) {
    iterations.push({ at: m.index, n: m[2], active: /\bdata-active\b/.test(m[0]) });
  }

  const mappings = [];
  const mapRe = /<section\b[^>]*\bdata-mapping=("|')([^"']*)\1[^>]*>/gi;
  while ((m = mapRe.exec(body)) !== null) {
    const idAttr = /\bid=("|')([^"']*)\1/i.exec(m[0]);
    mappings.push({ at: m.index, id: m[2], domId: idAttr ? idAttr[2] : null });
  }

  const specRe = /<script\b[^>]*\bdata-mapping-spec\b[^>]*>([\s\S]*?)<\/script>/gi;
  const seenIds = new Map();

  mappings.forEach((map, i) => {
    const mid = map.id;
    const at = map.at;
    // The spec must sit inside the wrapper: before its first `</section>`
    // and before the next mapping's open tag, whichever comes first.
    const close = body.indexOf('</section>', at);
    const nextAt = i + 1 < mappings.length ? mappings[i + 1].at : body.length;
    const end = Math.min(close < 0 ? body.length : close, nextAt);

    // M2 — the mapping id follows the grammar and IS the section's DOM id.
    if (!MAP_ID_RE.test(mid)) {
      issues.push({ kind: 'bad-id', why: `mapping id "${mid}" (data-mapping) must match ^[a-z0-9_]+$`, at });
    }
    if (map.domId !== mid) {
      const have = map.domId == null ? 'no id attribute' : `id="${map.domId}"`;
      issues.push({ kind: 'bad-id', why: `mapping "${mid}": section id must equal data-mapping (section has ${have})`, at });
    }

    if (seenIds.has(mid)) {
      issues.push({ kind: 'duplicate-mapping-id', why: `data-mapping="${mid}" at offset ${at} repeats the mapping at offset ${seenIds.get(mid)} — mapping ids are DOM ids and must be unique page-wide`, at });
    } else {
      seenIds.set(mid, at);
    }

    specRe.lastIndex = at;
    const s = specRe.exec(body);
    if (!s || s.index >= end) {
      issues.push({ kind: 'spec-missing', why: `mapping "${mid}" at offset ${at} has no <script type="application/json" data-mapping-spec> block inside its section`, at });
      return;
    }
    let raw;
    try { raw = JSON.parse(s[1]); }
    catch (e) {
      issues.push({ kind: 'spec-parse', why: `mapping "${mid}": spec JSON does not parse — ${e.message}`, at });
      return;
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ kind: 'spec-parse', why: `mapping "${mid}": spec must be a JSON object`, at });
      return;
    }

    const model = validateMappingSpec(raw, mid, at, issues);

    // M9 — nearest preceding iteration open tag decides frozen vs live.
    let iter = null;
    for (const it of iterations) { if (it.at < at) iter = it; else break; }
    if (iter && !iter.active && !model.complete) {
      const q = ks => ks.map(k => `"${k}"`).join(', ');
      let detail;
      if (raw.submitted == null) detail = 'has no "submitted" object';
      else if (model.missingKeys.length) detail = `"submitted.cells" lacks matrix key(s) ${q(model.missingKeys)}`;
      else detail = `"submitted.order" lacks ordered target key(s) ${q(model.missingOrderKeys)} (the engine would fall back to proposalOrder)`;
      issues.push({ kind: 'frozen-without-submitted', why: `mapping "${mid}" sits in frozen iteration ${iter.n} (no data-active) but ${detail} — the page would show Claude's proposal as the user's decision`, at });
    }
  });

  return issues;
}

/**
 * Full evaluation for a written file.
 * @returns {{applicable:boolean, ok:boolean, missing:Array, forbidden:Array, structural:Array, mapping:Array}}
 */
function evaluate(filePath, html) {
  if (!isConceptHtml(filePath, html)) {
    return { applicable: false, ok: true, missing: [], forbidden: [], structural: [], mapping: [] };
  }
  const missing = findMissing(html);
  const forbidden = findForbidden(html);
  const structural = findStructural(html);
  const mapping = findMappingIssues(html);
  return {
    applicable: true,
    ok: missing.length === 0 && forbidden.length === 0 && structural.length === 0 && mapping.length === 0,
    missing,
    forbidden,
    structural,
    mapping,
  };
}

/** Build the blocking feedback shown to Claude (stderr, exit 2). */
function buildBlockReason(filePath, missing, forbidden, structural, mapping) {
  missing = missing || [];
  forbidden = forbidden || [];
  structural = structural || [];
  mapping = mapping || [];
  const name = path.basename(filePath || 'concept.html');
  const onlyMapping = mapping.length > 0 && !missing.length && !forbidden.length && !structural.length;
  const lines = [];
  if (onlyMapping) lines.push(`BLOCKED: mapping spec problems in "${name}".`);
  else lines.push(`BLOCKED: "${name}" is not a valid live-bridge concept page.`);
  lines.push('');
  if (mapping.length) {
    lines.push('Mapping spec problems — the information-mapping engine cannot render these sections as authored:');
    mapping.forEach(i => lines.push(`  - ${i.kind}: ${i.why}`));
    lines.push('  Fix: regenerate the spec from skills/concept/deep-knowledge/templates.md § Information Mapping (engine) → Spec');
    lines.push('  (ids ^[a-z0-9_]+$, unique, data-mapping = section id; ≥ 1 item; lists are arrays; proposal/submitted');
    lines.push('  refer only to declared items and {src}.{part} targets; a ctx value present iff the spec has "context"');
    lines.push("  with values). When freezing a round, write \"submitted\" into the frozen spec from the payload's");
    lines.push('  mappings[] entry: {cells: assigned, order, adhoc: adhocItems, slotNotes} — cells must carry every');
    lines.push('  matrix key ({src} or {src}@{ctx}) and order every ordered target key.');
    lines.push('');
  }
  if (onlyMapping) {
    lines.push('The rest of the page (decision panel, bridge submit, <style>/<script> structure) passed —');
    lines.push('fix only the mapping sections above, re-write the file, and open it once this gate passes.');
    return lines.join('\n');
  }
  if (structural.length) {
    lines.push('Broken <style> / <script> structure — the page renders unstyled (white, no theme) even though every marker is present:');
    structural.forEach(s => lines.push(`  - ${s.kind}: ${s.why}`));
    lines.push('  Typical cause: the opening <style> line of an older page was pasted INSIDE the new style block.');
    lines.push('  Fix: exactly one <style> per block, closed before the next tag; then verify in the browser that');
    lines.push("  getComputedStyle(document.documentElement).getPropertyValue('--accent-color') is non-empty.");
    lines.push('');
  }
  if (forbidden.length) {
    lines.push('Forbidden clipboard / paste-into-chat submit detected:');
    forbidden.forEach(f => lines.push(`  - ${f.why}`));
    lines.push('');
  }
  if (missing.length) {
    lines.push('Missing mandatory live decision-panel / bridge markers:');
    missing.forEach(m => lines.push(`  - ${m.token} — ${m.why}`));
    lines.push('');
  }
  lines.push('The concept flow requires the LIVE bridge: a persistent decision panel whose');
  lines.push('"Zur nächsten Iteration" / "Mit Feedback implementieren" buttons POST to the');
  lines.push('bridge server (monitored via heartbeat + cron). A "copy the JSON and paste it');
  lines.push('into chat" block is NEVER an acceptable substitute — that is the exact');
  lines.push('regression this gate exists to prevent. The decision panel may never be omitted.');
  lines.push('');
  lines.push('Fix BEFORE opening the page (SKILL.md Step 3):');
  lines.push('  1. Regenerate the HTML with the full decision panel + bridge submit handlers');
  lines.push('     (deep-knowledge/templates.md) and run the 35-pattern check in');
  lines.push('     deep-knowledge/validation-gate.md.');
  lines.push('  2. Remove any clipboard / paste-into-chat fallback entirely.');
  lines.push('  3. Re-write the file; only open it once this gate passes.');
  return lines.join('\n');
}

module.exports = {
  REQUIRED,
  FORBIDDEN,
  isConceptHtml,
  findMissing,
  findForbidden,
  findStructural,
  findMappingIssues,
  evaluate,
  buildBlockReason,
};
