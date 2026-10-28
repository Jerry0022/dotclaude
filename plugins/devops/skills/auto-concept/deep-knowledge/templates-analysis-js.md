# Concept templates, part 45 of 48: Template: analysis — engine UI JS (palette, stages, stepper, choreography)

## Engine UI — palette, stages, stepper, choreography (JS)

One namespaced block (`window.CONCEPT_VIZ`, `window.conceptAnalysis`); it only
**enhances** the authored markup and only ever writes the named controls of the
contract (`dm-{id}`, `dm-{id}.{opt}`, `-alt`, `-fix`, `-text`, `-touched`,
`-issue`, `-epic`, the `data-comment` note). Collect, bake and freeze therefore
need nothing else. UI strings are a small de/en table keyed off
`<html lang>` (no `{{key}}` rows needed).

What the code does, in the order of the file:

1. `CONCEPT_VIZ` — the palette registry (`text kpi bar bars spark donut compare flow`),
   `renderViz(root, size)`; unknown type or bad spec renders `spec.text`.
2. `setup(root)` — one instance per `[data-analysis]`: builds the stage list
   (briefing, topic intros, decisions, review, next round, list), the sticky
   stepper (Full) / progress dots (Lite), the foot of every decision (ONE note
   field, "Als Issue anlegen" link, Zurück / Weiter) and the mode widgets
   (slider bar, sortable order, inline alt / fix / custom fields).
3. The analysis column: three levels, one long at a time, with the
   choreography (≈ 1 s the first two times per page — counter in
   `localStorage`, try/catch — then ≈ 0.3 s; `prefers-reduced-motion` → no
   motion; "↻ Übergang" replays it).
4. Touched tracking: a stage open ≥ 3 s, or any change in it, writes
   `dm-{id}-touched` = `"1"` (and fires `input` + `change`, so persistence and
   the section nav see it).
5. Keys: Enter / ⇧+Enter, ← → stages, ↑ ↓ options, 1–N options (decision has
   focus), Home / End, ⇧+1–3 topics, PgUp / PgDn levels, N note, I issue,
   L list, R replay, B evidence, U first untouched, Esc closes the popup.

```javascript
(function () {
  'use strict';
  if (window.conceptAnalysis) return;
  const DE = () => String(document.documentElement.lang || 'en').slice(0, 2) === 'de';
  const L = (de, en) => (DE() ? de : en);
  const WJ = String.fromCharCode(0x2060);
  const BS = String.fromCharCode(92);
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssEsc = s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => BS + c);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const fmt = n => (Math.round(num(n) * 10) / 10).toLocaleString(DE() ? 'de-DE' : 'en-US');
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function btn(cls, text) { const b = h('button', cls, text); b.type = 'button'; return b; }
  // App tooltip (templates-utilities.md): a visible name gets only its keycap.
  function tip(el, text, key) {
    if (key) {
      el.setAttribute('data-tip-key', key);
      el.setAttribute('aria-keyshortcuts', key.replace('⇧+', 'Shift+').replace('Pos1', 'Home').replace('Ende', 'End'));
    }
    if (text) el.setAttribute('data-tip', text);
    else if (key) { el.setAttribute('data-tip', WJ); el.setAttribute('data-tip-key-only', 'true'); }
  }

  /* ================= 1. palette: CONCEPT_VIZ ================= */
  const VIZ = (window.CONCEPT_VIZ = window.CONCEPT_VIZ || {});
  const SEG = ['#79c0ff', '#58a6ff', '#a5d6ff', '#388bfd', '#b6e3ff', '#8cb4ff'];
  const list = (a) => (Array.isArray(a) ? a : []);
  VIZ.text = (el, s) => {
    el.textContent = '';
    el.classList.add('an-vz-text');
    let ul = null;
    String(s.text == null ? '' : s.text).split(/\n+/).filter(l => l.trim()).forEach(line => {
      const m = /^\s*[-•]\s+(.*)$/.exec(line);
      if (m) { if (!ul) { ul = h('ul'); el.appendChild(ul); } ul.appendChild(h('li', '', m[1])); }
      else { ul = null; el.appendChild(h('p', '', line.trim())); }
    });
  };
  VIZ.kpi = (el, s) => {
    el.innerHTML = '<span class="an-kpi"><b class="an-kpi-v">' + esc(s.value) + '</b>'
      + (s.unit ? '<span class="an-kpi-u">' + esc(s.unit) + '</span>' : '')
      + (s.delta ? '<span class="an-kpi-d">' + esc(s.delta) + '</span>' : '')
      + (s.label ? '<span class="an-kpi-l">' + esc(s.label) + '</span>' : '') + '</span>';
  };
  VIZ.bar = (el, s) => {
    const max = num(s.max) || 100, v = num(s.value);
    el.innerHTML = '<div class="an-bar"><div class="an-bar-h"><span>' + esc(s.label || '') + '</span><b>' + esc(fmt(v) + (s.unit ? ' ' + s.unit : '')) + '</b></div>'
      + '<div class="an-bar-t" role="img" aria-label="' + esc(fmt(v) + ' / ' + fmt(max)) + '"><i style="width:' + clamp(v / max * 100, 0, 100) + '%"></i></div></div>';
  };
  VIZ.bars = (el, s, ctx) => {
    const items = list(s.items), top = ctx && ctx.size === 'short' ? 3 : items.length;
    const max = Math.max.apply(null, items.map(i => num(i.value)).concat([1]));
    el.innerHTML = '<div class="an-bars">' + items.slice(0, top).map(i =>
      '<div><span>' + esc(i.label) + '</span><div class="an-bar-t"><i style="width:' + clamp(num(i.value) / max * 100, 0, 100) + '%"></i></div><b>'
      + esc(fmt(i.value) + (s.unit ? ' ' + s.unit : '')) + '</b></div>').join('') + '</div>';
  };
  VIZ.spark = (el, s, ctx) => {
    const pts = list(s.points).map(num);
    if (pts.length < 2) { VIZ.text(el, { text: s.label || '' }); return; }
    const W = 200, H = 48, lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts), span = hi - lo || 1;
    const xy = pts.map((p, i) => [4 + i * (W - 8) / (pts.length - 1), H - 5 - (p - lo) / span * (H - 12)]);
    const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = xy[xy.length - 1];
    el.innerHTML = '<div class="an-spark"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(s.label || '') + '">'
      + '<path d="' + d + ' L' + last[0] + ' ' + H + ' L4 ' + H + ' Z" fill="#79c0ff" opacity=".14"/>'
      + '<path d="' + d + '" fill="none" stroke="#79c0ff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'
      + '<circle cx="' + last[0] + '" cy="' + last[1].toFixed(1) + '" r="3" fill="#79c0ff"/></svg>'
      + (ctx && ctx.size === 'short' ? '' : '<div class="an-spark-l"><span>' + esc(s.label || '') + '</span><span>' + esc(fmt(pts[0]) + ' → ' + fmt(pts[pts.length - 1])) + '</span></div>') + '</div>';
  };
  VIZ.donut = (el, s) => {
    const parts = list(s.parts), total = parts.reduce((a, p) => a + Math.max(0, num(p.value)), 0) || 1;
    let off = 0, arcs = '';
    parts.forEach((p, i) => {
      const pct = Math.max(0, num(p.value)) / total * 100;
      arcs += '<circle cx="21" cy="21" r="15.9155" fill="none" stroke="' + SEG[i % SEG.length] + '" stroke-width="6" stroke-dasharray="' + pct.toFixed(2) + ' ' + (100 - pct).toFixed(2) + '" stroke-dashoffset="' + (25 - off).toFixed(2) + '"/>';
      off += pct;
    });
    el.innerHTML = '<div class="an-donut"><svg viewBox="0 0 42 42" role="img" aria-label="' + esc(parts.map(p => p.label + ' ' + p.value).join(', ')) + '"><circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(128,138,150,.25)" stroke-width="6"/>' + arcs + '</svg><ul>'
      + parts.map((p, i) => '<li><i style="background:' + SEG[i % SEG.length] + '"></i>' + esc(p.label) + ' <b>' + Math.round(num(p.value) / total * 100) + ' %</b></li>').join('') + '</ul></div>';
  };
  VIZ.compare = (el, s) => {
    const a = s.before || {}, b = s.after || {}, max = Math.max(num(a.value), num(b.value), 1);
    const delta = num(a.value) ? Math.round((num(b.value) - num(a.value)) / num(a.value) * 100) : 0;
    const row = (x, cls) => '<div class="an-cmp-r ' + cls + '"><span>' + esc(x.label || '') + '</span><div class="an-bar-t"><i style="width:' + clamp(num(x.value) / max * 100, 0, 100) + '%"></i></div><b>' + esc(fmt(x.value) + (s.unit ? ' ' + s.unit : '')) + '</b></div>';
    el.innerHTML = '<div class="an-cmp">' + row(a, 'an-before') + row(b, 'an-after') + '<span class="an-cmp-d">' + (delta > 0 ? '+' : '') + delta + ' %</span></div>';
  };
  VIZ.flow = (el, s) => {
    el.innerHTML = '<div class="an-flow">' + list(s.steps).map((st, i) => (i ? '<i>→</i>' : '') + '<span>' + (st.value != null && st.value !== '' ? '<b>' + esc(st.value) + '</b>' : '') + esc(st.label) + '</span>').join('') + '</div>';
  };
  /** Render every [data-viz] below root once. size = "short" | "long". */
  function renderViz(root, size) {
    (root.matches && root.matches('[data-viz]') ? [root] : []).concat([...root.querySelectorAll('[data-viz]')]).forEach(el => {
      if (el.dataset.vizDone || el.closest('[data-alevel]')) return;   // authored level sources stay raw; the column renders clones
      let spec = null;
      try { spec = JSON.parse(el.getAttribute('data-viz-spec') || 'null'); } catch (e) { spec = null; }
      if (!spec || typeof spec !== 'object') return;          // keep the authored fallback text
      let fn = VIZ[el.getAttribute('data-viz')];
      if (!fn) {
        // Custom type: the author's own markup (inline SVG ...) stays; spec.text only fills an empty element.
        if (el.children.length || el.textContent.trim()) { el.dataset.vizDone = '1'; return; }
        fn = VIZ.text;
      }
      try { fn(el, spec, { size: size || 'long' }); } catch (e) { try { VIZ.text(el, spec); } catch (e2) { /* keep */ } }
      el.dataset.vizDone = '1';
      el.classList.add('an-vz-' + (size || 'long'));
    });
  }

  /* ================= 2. helpers over the contract ================= */
  const instances = [];
  const TOPIC_COLORS = ['#a371f7', '#39c5cf', '#7c8cff', '#c297ff', '#5ec8e5', '#9aa8ff', '#b392f0'];   // never red / green / orange
  const decId = d => d.dataset.decision;
  const ctl = (d, name) => [...d.querySelectorAll('input, textarea, select')].filter(c => (c.name || '') === name);
  const ctl1 = (d, name) => ctl(d, name)[0] || null;
  const optEl = (d, v) => [...d.querySelectorAll('[data-opt]')].find(o => o.getAttribute('data-opt') === v) || null;
  const optLabel = (d, v) => { const o = optEl(d, v); const l = o && o.querySelector('[data-opt-label]'); return l ? l.textContent.trim() : String(v); };
  const optCons = o => { const c = o && o.querySelector('[data-opt-consequence]'); return c ? c.textContent.trim() : ''; };
  const recList = d => String(d.dataset.rec || '').split(/[\s,]+/).filter(Boolean);
  const isTouched = d => { const c = ctl1(d, 'dm-' + decId(d) + '-touched'); return !!c && c.value === '1'; };
  const entryOf = d => (typeof collectModeDecision === 'function' ? collectModeDecision(d) : { id: decId(d), mode: d.dataset.decisionMode, value: '', deviates: false, untouched: !isTouched(d), issue: false });
  function stateOf(inst, d) {
    const e = entryOf(d);
    if (e.issue) return 'iss';
    if (e.untouched) return inst.visited.has(decId(d)) ? 'un' : 'open';
    return e.deviates ? 'dev' : 'ok';
  }
  function stateText(s) {
    return { ok: L('entschieden', 'decided'), dev: L('weicht von der Empfehlung ab', 'differs from the recommendation'), iss: L('Issue', 'issue'), un: L('offen, kurz gesehen', 'open, glanced at'), open: L('offen', 'open') }[s];
  }
  function valueText(d, e) {
    const m = e.mode, v = e.value, unit = d.dataset.unit ? ' ' + d.dataset.unit : '';
    if (m === 'multi') return v.length ? v.map(x => optLabel(d, x)).join(', ') : L('nichts gewählt', 'nothing picked');
    if (m === 'yesnoalt') return v.answer === 'alt' ? L('Anders: ', 'Other: ') + (v.alt || '…') : v.answer ? optLabel(d, v.answer) : '–';
    if (m === 'slider') return v == null ? '–' : fmt(v) + unit;
    if (m === 'order') return v.map(x => optLabel(d, x)).join(' → ');
    if (m === 'wording') return v || '–';
    return v ? optLabel(d, v) : '–';
  }
  function recText(d) {
    const m = d.dataset.decisionMode, r = recList(d);
    if (m === 'slider') return r[0] + (d.dataset.unit ? ' ' + d.dataset.unit : '');
    if (m === 'order') return r.map(x => optLabel(d, x)).join(' → ');
    return r.map(x => optLabel(d, x)).join(', ');
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setHidden(d, suffix, value) {
    const name = 'dm-' + decId(d) + suffix;
    let c = ctl1(d, name);
    if (!c) { c = h('input'); c.type = 'hidden'; c.name = name; d.appendChild(c); }
    if (c.value === value || c.disabled) return false;
    c.value = value;
    fire(c);
    return true;
  }
  /** Touched = open >= 3 s or changed. Idempotent; returns true when it wrote. */
  function markTouched(d) {
    const wrote = setHidden(d, '-touched', '1');
    const inst = instances.find(i => i.root.contains(d));
    if (wrote && inst) refresh(inst);
    return wrote;
  }

  /* choreography duration: slow the first two times per page */
  const CK = 'concept-an-transitions:' + (location.pathname || '/');
  function transCount() { try { return parseInt(localStorage.getItem(CK) || '0', 10) || 0; } catch (e) { return 0; } }
  function bumpTrans() { try { const v = String(transCount() + 1); if (typeof _guardedSetItem === 'function') _guardedSetItem(CK, v); else localStorage['setItem'](CK, v); } catch (e) { /* private mode */ } }
  function transMs() { return reduced() ? 0 : (transCount() < 2 ? 1000 : 300); }

  /* ================= 3. analysis column ================= */
  function levelSrc(inst, st, n) {
    if (n === 1) return inst.root.querySelector('[data-alevel="1"]');
    if (n === 2) return st.topic ? [...st.topic.children].find(c => c.getAttribute('data-alevel') === '2') || null : null;
    return st.kind === 'dec' ? st.el.querySelector('[data-alevel="3"]') : null;
  }
  function wanted(inst, st) {
    let w = {};
    if (st.kind === 'brief' || st.kind === 'start') w = { 1: 'long' };
    else if (st.kind === 'topic') w = { 1: 'short', 2: 'long' };
    else if (st.kind === 'dec') w = inst.lite ? { 1: 'short', 3: 'long' } : { 1: 'short', 2: 'short', 3: 'long' };
    const present = [1, 2, 3].filter(n => w[n] && levelSrc(inst, st, n));
    if (present.length && !present.some(n => w[n] === 'long')) w[present[present.length - 1]] = 'long';
    return w;
  }
  function slotNodes(src, kind) {
    const slot = [...src.children].find(c => c.getAttribute('data-slot') === kind);
    const box = h('div');
    if (slot) {
      const c = slot.cloneNode(true);
      c.querySelectorAll('[data-evidence]').forEach(e => e.remove());
      c.querySelectorAll('[data-viz-done]').forEach(e => e.removeAttribute('data-viz-done'));
      while (c.firstChild) box.appendChild(c.firstChild);
    }
    return box;
  }
  function buildLevel(inst, n, src) {
    const node = h('div', 'an-lv');
    node.dataset.n = String(n);
    node.dataset.state = 'short';
    node.__src = src;
    const head = btn('an-lv-h');
    head.innerHTML = '<i class="an-lv-i"></i><span class="an-lv-t"></span>';
    head.querySelector('.an-lv-t').textContent = src.dataset.title || '';
    tip(head, L('Auf- oder zuklappen · Bild↑ / Bild↓ wechselt die Stufe', 'Expand or collapse · PgUp / PgDn switches level'));
    head.setAttribute('aria-expanded', 'false');
    head.addEventListener('click', () => openLevel(inst, n));
    const ws = h('div', 'an-w an-w-s'), wl = h('div', 'an-w an-w-l');
    const is = h('div', 'an-in'), il = h('div', 'an-in');
    const short = slotNodes(src, 'short'), long = slotNodes(src, 'long');
    if (!short.childNodes.length && long.firstElementChild) short.appendChild(long.firstElementChild.cloneNode(true));
    is.appendChild(short);
    il.appendChild(long);
    if (n === 3) long.insertBefore(h('div', 'an-cons-slot'), long.firstChild);
    const ev = [...src.querySelectorAll('[data-evidence]')];
    if (ev.length) {
      const b = btn('an-ev', '🔎 ' + L('Belege', 'Evidence'));
      tip(b, '', 'B');
      b.addEventListener('click', () => openEvidence(inst, src.dataset.title || '', ev, b));
      long.appendChild(b);
    }
    ws.appendChild(is); wl.appendChild(il);
    node.append(head, ws, wl);
    renderViz(short, 'short');
    renderViz(long, 'long');
    return node;
  }
  function setState(node, state) {
    node.dataset.state = state;
    const b = node.querySelector('.an-lv-h');
    if (b) b.setAttribute('aria-expanded', state === 'long' ? 'true' : 'false');
  }
  /** Accordion: n long, every other present level short. */
  function openLevel(inst, n) {
    if (!inst.lv[n]) return;
    [1, 2, 3].forEach(k => { if (inst.lv[k]) setState(inst.lv[k], k === n ? 'long' : 'short'); });
  }
  function stepLevel(inst, dir) {
    const present = [1, 2, 3].filter(k => inst.lv[k]);
    if (!present.length) return;
    const cur = present.find(k => inst.lv[k].dataset.state === 'long');
    const i = present.indexOf(cur);
    openLevel(inst, present[clamp((i < 0 ? 0 : i) + dir, 0, present.length - 1)]);
  }
  function applyLevels(inst, st, opt) {
    opt = opt || {};
    const dur = opt.dur != null ? opt.dur : transMs();
    inst.root.style.setProperty('--an-dur', dur + 'ms');
    inst.timers.forEach(clearTimeout);
    inst.timers = [];
    const want = wanted(inst, st);
    let animated = false;
    [1, 2, 3].forEach(n => {
      const src = want[n] ? levelSrc(inst, st, n) : null;
      let node = inst.lv[n];
      if (!src) { if (node) { node.remove(); delete inst.lv[n]; } return; }
      if (node && node.__src !== src) { node.remove(); node = null; delete inst.lv[n]; }
      if (node) { setState(node, want[n]); return; }
      node = buildLevel(inst, n, src);
      inst.lv[n] = node;
      const after = [1, 2, 3].filter(k => k < n && inst.lv[k]).pop();
      if (after) inst.lvs.insertBefore(node, inst.lv[after].nextSibling); else inst.lvs.insertBefore(node, inst.lvs.firstChild);
      if (n > 1 && dur) {
        animated = true;
        setState(node, 'short');
        const cls = opt.swap && n === 3 ? 'an-swap' : 'an-enter';
        node.classList.add(cls);
        node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
        if (want[n] === 'long') inst.timers.push(setTimeout(() => setState(node, 'long'), Math.round(dur * 0.6)));
      } else setState(node, want[n]);
    });
    if (animated && !opt.replay) bumpTrans();
    updateCons(inst);
  }
  function consequenceNode(d) {
    const e = entryOf(d), box = h('div', 'an-cons');
    box.appendChild(h('b', '', L('Folge deiner Wahl', 'What your choice does')));
    const m = e.mode;
    if (m === 'multi') {
      const ul = h('ul');
      e.value.forEach(v => { const li = h('li'); li.textContent = optLabel(d, v) + (optCons(optEl(d, v)) ? ' — ' + optCons(optEl(d, v)) : ''); ul.appendChild(li); });
      box.appendChild(e.value.length ? ul : h('span', '', L('Nichts gewählt.', 'Nothing picked.')));
    } else if (m === 'slider' || m === 'order' || m === 'wording') {
      box.appendChild(h('span', '', valueText(d, e)));
    } else {
      const o = optEl(d, m === 'yesnoalt' ? e.value.answer : e.value);
      const c = optCons(o);
      box.appendChild(h('span', '', valueText(d, e) + (c ? ' — ' + c : '')));
    }
    return box;
  }
  function updateCons(inst) {
    const st = inst.stages[inst.idx], node = inst.lv[3];
    if (!node) return;
    const slot = node.querySelector('.an-cons-slot');
    if (!slot || !st || st.kind !== 'dec') return;
    const want = isTouched(st.el);
    const have = slot.firstChild && slot.firstChild.__for;
    if (!want) { slot.textContent = ''; return; }
    const n = consequenceNode(st.el);
    if (have && slot.firstChild.textContent === n.textContent) return;
    n.__for = true;
    slot.textContent = '';
    slot.appendChild(n);
  }
  function openEvidence(inst, title, nodes, opener) {
    closeEvidence(inst);
    const scrim = h('div', 'an-scrim'), pop = h('div', 'an-pop');
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true');
    const x = btn('an-x', '✕');
    tip(x, '', 'Esc');
    x.setAttribute('aria-label', L('Schließen', 'Close'));
    const head = h('div', 'an-pop-h'), hd = h('div');
    hd.append(h('div', 'an-pop-k', L('Belege', 'Evidence')), h('div', 'an-pop-t', title));
    head.append(hd, x);
    const body = h('div', 'an-pop-b');
    nodes.forEach(n => { const c = n.cloneNode(true); c.removeAttribute('hidden'); c.removeAttribute('data-evidence'); body.appendChild(c); });
    pop.append(head, body);
    scrim.appendChild(pop);
    scrim.addEventListener('click', e => { if (e.target === scrim) closeEvidence(inst); });
    x.addEventListener('click', () => closeEvidence(inst));
    inst.root.appendChild(scrim);
    inst.pop = { scrim, opener };
    x.focus({ preventScroll: true });
  }
  function closeEvidence(inst) {
    if (!inst.pop) return false;
    const { scrim, opener } = inst.pop;
    scrim.remove();
    inst.pop = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    return true;
  }

  /* ================= 4. instance: stages, stepper, briefing ================= */
  function setup(root) {
    if (root.__an) return root.__an;
    const lite = root.getAttribute('data-analysis') === 'lite';
    const inst = { root, lite, stages: [], groups: [], idx: 0, lv: {}, timers: [], visited: new Set(), decs: [], pop: null, maxIdx: 0, touchTimer: 0 };
    root.__an = inst;
    instances.push(inst);
    root.classList.add('an-enh');
    if (lite) root.classList.add('an-lite');
    const nodes = [...root.querySelectorAll('[data-analysis-briefing], [data-topic], [data-decision][data-decision-mode]')]
      .filter(n => n.closest('[data-analysis]') === root);
    let topicIdx = -1;
    nodes.forEach(n => {
      if (n.hasAttribute('data-analysis-briefing')) { inst.stages.push({ kind: 'brief', el: n }); inst.brief = n; return; }
      if (n.hasAttribute('data-topic')) {
        topicIdx++;
        const color = TOPIC_COLORS[topicIdx % TOPIC_COLORS.length];
        n.style.setProperty('--c', color);
        const intro = h('section', 'an-stage an-intro');
        n.insertBefore(intro, n.firstChild);
        const g = { topic: n, label: n.dataset.navLabel || n.id, color, intro, decs: [], idx: topicIdx };
        inst.groups.push(g);
        inst.stages.push({ kind: 'topic', el: intro, topic: n, group: g });
        return;
      }
      const topic = n.parentElement && n.parentElement.closest('[data-topic]');
      const g = topic ? inst.groups.find(x => x.topic === topic) : null;
      const st = { kind: 'dec', el: n, topic: topic || null, group: g };
      inst.stages.push(st);
      inst.decs.push(st);
      if (g) g.decs.push(st);
    });
    if (lite) {
      const l1 = root.querySelector('[data-alevel="1"]');
      if (l1) {
        const start = h('section', 'an-stage an-start');
        root.insertBefore(start, root.firstChild);
        inst.stages.unshift({ kind: 'start', el: start });
      }
      const done = h('section', 'an-stage an-fin');
      root.appendChild(done);
      inst.stages.push({ kind: 'done', el: done });
    } else {
      ['review', 'next', 'list'].forEach(k => {
        const el = h('section', 'an-stage an-' + k);
        root.appendChild(el);
        inst.stages.push({ kind: k, el, aux: k === 'list' });
      });
    }
    inst.seq = inst.stages.filter(s => !s.aux);
    // Aside: the three analysis levels.
    const ana = h('aside', 'an-ana');
    const ah = h('div', 'an-ana-h');
    ah.appendChild(h('span', '', L('Analyse', 'Analysis')));
    const rp = btn('an-rp', '↻ ' + L('Übergang', 'Transition'));
    tip(rp, '', 'R');
    rp.addEventListener('click', () => replay(inst));
    ah.appendChild(rp);
    inst.lvs = h('div', 'an-lvs');
    ana.append(ah, inst.lvs);
    inst.ana = ana;
    root.appendChild(ana);
    inst.decs.forEach(st => prepDecision(inst, st));
    if (inst.brief) prepBrief(inst);
    inst.groups.forEach(g => prepIntro(inst, g));
    if (lite) prepLiteStart(inst);
    buildStepper(inst);
    root.addEventListener('input', e => onEdit(inst, e));
    root.addEventListener('change', e => onEdit(inst, e));
    root.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[data-go]'); if (t) go(inst, Number(t.dataset.go)); });
    root.addEventListener('pointerdown', () => { if (!root.contains(document.activeElement)) { const st = inst.stages[inst.idx]; if (st && st.el.tabIndex === -1) st.el.focus({ preventScroll: true }); } });
    if (typeof ResizeObserver === 'function') {
      let w = 0;
      new ResizeObserver(() => { const nw = root.offsetWidth; if (nw !== w) { w = nw; drawConn(inst); armTouch(inst); } }).observe(root);
    }
    go(inst, 0, { initial: true });
    return inst;
  }
  const isWideKind = k => k === 'review' || k === 'next' || k === 'list' || k === 'done';

  function buildStepper(inst) {
    const old = inst.root.querySelector(':scope > .an-step, :scope > .an-lhead');
    if (old) old.remove();
    if (inst.lite) {
      const head = h('div', 'an-lhead');
      const l1 = inst.root.querySelector('[data-alevel="1"]');
      head.appendChild(h('div', 'an-lt', (l1 && l1.dataset.title) || inst.root.dataset.navLabel || L('Kurze Fragen', 'Quick questions')));
      const pr = h('div', 'an-lpr');
      pr.appendChild(h('span', 'an-lcount'));
      const dots = h('span', 'an-dots');
      inst.decs.forEach(st => { const b = btn('an-dot'); b.dataset.go = String(inst.stages.indexOf(st)); b.dataset.dec = decId(st.el); dots.appendChild(b); });
      pr.appendChild(dots);
      head.appendChild(pr);
      inst.root.insertBefore(head, inst.root.firstChild);
      inst.stepEl = head;
      return;
    }
    const nav = h('nav', 'an-step');
    nav.setAttribute('aria-label', L('Fortschritt', 'Progress'));
    const bk = btn('an-k'); bk.dataset.k = 'brief';
    bk.innerHTML = '<span class="an-ic">✓</span>';
    bk.appendChild(document.createTextNode(inst.brief ? (inst.brief.dataset.navLabel || 'Briefing') : 'Briefing'));
    bk.dataset.go = String(inst.stages.findIndex(s => s.kind === 'brief'));
    tip(bk, '', 'Pos1');
    if (inst.brief) nav.append(bk, h('i', 'an-sep'));
    inst.groups.forEach((g, gi) => {
      const grp = h('div', 'an-grp'); grp.style.setProperty('--c', g.color); grp.dataset.g = String(gi);
      const gl = btn('an-gl');
      gl.innerHTML = '<span class="an-ic">✓</span><i></i>';
      gl.appendChild(document.createTextNode(g.label));
      gl.dataset.go = String(inst.stages.indexOf(inst.stages.find(s => s.group === g && s.kind === 'topic')));
      tip(gl, '', '⇧+' + (gi + 1));
      const dots = h('span', 'an-dots');
      g.decs.forEach(st => { const b = btn('an-dot'); b.dataset.go = String(inst.stages.indexOf(st)); b.dataset.dec = decId(st.el); dots.appendChild(b); });
      grp.append(gl, dots);
      nav.append(grp, h('i', 'an-sep'));
    });
    const rv = btn('an-k', L('Review', 'Review')); rv.dataset.k = 'review'; rv.dataset.go = String(inst.stages.findIndex(s => s.kind === 'review'));
    tip(rv, '', 'Ende');
    const nx = btn('an-k', L('Nächste Runde', 'Next round')); nx.dataset.k = 'next'; nx.dataset.go = String(inst.stages.findIndex(s => s.kind === 'next'));
    nav.append(rv, h('i', 'an-sep'), nx);
    inst.root.insertBefore(nav, inst.root.firstChild);
    inst.stepEl = nav;
  }
  function refreshStepper(inst) {
    const cur = inst.stages[inst.idx];
    const decStates = new Map(inst.decs.map(st => [st, stateOf(inst, st.el)]));
    inst.stepEl.querySelectorAll('.an-dot').forEach(b => {
      const st = inst.decs.find(x => decId(x.el) === b.dataset.dec);
      const s = decStates.get(st);
      b.className = 'an-dot an-s-' + s + (st === cur ? ' an-cur' : '');
      tip(b, ((st.el.dataset.label || decId(st.el))) + ' · ' + stateText(s));
      b.setAttribute('aria-label', st.el.dataset.label + ' · ' + stateText(s));
      if (st === cur) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    if (inst.lite) {
      const n = inst.decs.indexOf(cur) + 1;
      const c = inst.stepEl.querySelector('.an-lcount');
      if (c) c.textContent = n ? n + ' / ' + inst.decs.length : '';
      return;
    }
    const k = inst.stepEl.querySelector('[data-k="brief"]');
    if (k) { k.classList.toggle('an-on', cur.kind === 'brief'); k.classList.toggle('an-done', inst.maxIdx > inst.stages.findIndex(s => s.kind === 'brief')); tip(k, L('Briefing · Analyse, Potential, Themenfelder', 'Briefing · analysis, potential, topics'), 'Pos1'); }
    const seps = [...inst.stepEl.querySelectorAll(':scope > .an-sep')];
    inst.groups.forEach((g, gi) => {
      const grp = inst.stepEl.querySelector('.an-grp[data-g="' + gi + '"]');
      const done = g.decs.length > 0 && g.decs.every(st => decStates.get(st) !== 'open' && decStates.get(st) !== 'un');
      grp.classList.toggle('an-gdone', done);
      grp.classList.toggle('an-on', cur.group === g);
      const sep = grp.nextElementSibling;
      if (sep) sep.classList.toggle('an-sd', done);
      const gl = grp.querySelector('.an-gl');
      const nDone = g.decs.filter(st => decStates.get(st) !== 'open' && decStates.get(st) !== 'un').length;
      tip(gl, g.label + ' · ' + nDone + '/' + g.decs.length + ' ' + L('entschieden', 'decided'), '⇧+' + (gi + 1));
    });
    void seps;
    ['review', 'next'].forEach(kd => { const b = inst.stepEl.querySelector('[data-k="' + kd + '"]'); if (b) b.classList.toggle('an-on', cur.kind === kd); });
  }

  function prepBrief(inst) {
    const b = inst.brief, root = inst.root;
    b.classList.add('an-stage', 'an-brief');
    b.tabIndex = -1;
    const what = b.querySelector('[data-briefing-what]');
    b.setAttribute('data-an-kicker', L('Analyse', 'Analysis'));
    const chipsEls = [...b.querySelectorAll('[data-briefing-topic]')];
    if (chipsEls.length) {
      const wrap = h('div', 'an-chips');
      chipsEls[0].parentNode.insertBefore(wrap, chipsEls[0]);
      chipsEls.forEach((c, i) => {
        const g = inst.groups.find(x => x.topic.id === c.getAttribute('data-briefing-topic'));
        c.style.setProperty('--c', g ? g.color : TOPIC_COLORS[i % TOPIC_COLORS.length]);
        c.setAttribute('role', 'button'); c.tabIndex = 0;
        const share = num(c.dataset.share);
        const meta = h('em', '', (g ? g.decs.length + ' ' + L('Entscheidungen', 'decisions') : '') + (share ? (g ? ' · ' : '') + Math.round(share) + ' %' : ''));
        c.appendChild(meta);
        const idx = g ? inst.stages.findIndex(s => s.group === g && s.kind === 'topic') : -1;
        c.dataset.go = String(idx);
        tip(c, '', g ? '⇧+' + (inst.groups.indexOf(g) + 1) : '');
        c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); c.click(); } });
        wrap.appendChild(c);
      });
    }
    const dur = b.querySelector('[data-briefing-duration]');
    if (dur) dur.style.display = 'none';
    const cta = h('div', 'an-cta');
    const t = h('div', 'an-cta-t');
    t.append(h('b', '', L("Los geht's", "Let's go")), document.createTextNode((dur ? dur.textContent.trim() : '') + (inst.decs.length ? (dur ? ' · ' : '') + inst.decs.length + ' ' + L('Entscheidungen', 'decisions') : '')));
    const go1 = btn('an-btn', L("Los geht's", "Let's go") + ' →');
    tip(go1, '', 'Enter');
    go1.addEventListener('click', () => { go1.classList.add('an-pressed'); go(inst, inst.stages.findIndex(s => s.kind === 'brief') + 1); });
    cta.append(t, go1);
    b.appendChild(cta);
    const q = h('div', 'an-quiet');
    q.appendChild(listLink(inst));
    b.appendChild(q);
    void what; void root;
  }
  function listLink(inst) {
    const l = btn('an-link', L('Alle als Liste', 'All as list'));
    tip(l, '', 'L');
    l.addEventListener('click', () => go(inst, inst.stages.findIndex(s => s.kind === 'list')));
    return l;
```

