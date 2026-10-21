# Concept templates, part 08 of 17: Template: design — variant overview (≥2 designs)

## Variant overview JS — `wireDesignOverview()`

The engine half of § Variant overview (≥2 designs). `buildDesignUI()` calls
`buildDesignOverview()` on every (re)build of a round's chrome; every
`show*()` of § Layout JS ends in `updateDesignChrome()`; `restoreState()`
ends in `refreshDesignOverview()`. Below two designs `buildDesignOverview()`
removes what it built, puts `#anno-toggle` back where the markup put it and
returns — the single-design page is untouched.

- **Engine store.** The favourite and the user pins of the LIVE round live in
  one hidden `textarea#design-ov-store[data-engine-store="design-overview"]`
  inside `section[data-iteration][data-active]`, holding
  `{"favorite": id|null, "pins": [...]}`. Being a textarea with an id, it is
  persisted by `saveState()` (`text:i{N}:design-ov-store`), mirrored to the
  bridge draft and restored by `restoreState()` like any note — exactly the
  path annotation answers take. It starts EMPTY (not `{}`), so a `saveState()`
  that runs before the restore cannot blank the stored value (the empty-value
  guard of § State Persistence), and every write stamps `data-touched`.
  `collectAllFormFields()` skips it (`data-engine-store`); the design branch
  of collectDecisions types it into `favorite` / `userPins`.
- **Frozen rounds** read the same two keys from the round's
  `data-frozen-feedback` blob (`favorite`, `userPins`, written by
  `concept-build.js bake`): the cards and the header show the favourite, the
  pins render read-only, nothing can be changed.
- **Previews** are clones of each design's first screen (`prefixClone`-style
  id namespacing, every `data-comment` / `data-field` / `data-screen-link` /
  `data-tip` stripped, `inert`, inside `[data-device-clone]` so neither
  `saveState()` nor `collectAllFormFields()` sees a cloned control).
- **Hotkeys** never fire while focus is in a text field, the dock, a bubble or
  a pin editor, nor while the ☰ panel is open (`Esc` aside, which the panel
  owns then). `Tab` advances the page only while nothing is focused, so the
  focus order stays reachable; `Shift`+`Tab` is never taken.

```javascript
(function wireDesignOverview() {
  const DESIGN_TEMPLATES = new Set(['design', 'prototype']);
  const hasDesign = DESIGN_TEMPLATES.has(document.documentElement.dataset.template || '')
    || !!document.querySelector('section[data-iteration][data-iteration-template="design"],'
                              + 'section[data-iteration][data-iteration-template="prototype"]');
  if (!hasDesign) return;

  const L = {
    overview: '{{design.overview}}', back: '{{design.overview_back}}',
    count: '{{design.overview_count}}', open: '{{design.overview_open}}',
    notes: '{{design.overview_notes}}', fav: '{{design.favorite}}',
    favBadge: '{{design.favorite_badge}}', favSet: '{{design.favorite_set}}',
    favUnset: '{{design.favorite_unset}}', hintNone: '{{design.favorite_hint_none}}',
    hintSet: '{{design.favorite_hint_set}}', next: '{{design.next_screen}}',
    keysTitle: '{{design.keys_title}}', keysDesign: '{{design.keys_design}}',
    keysView: '{{design.keys_view}}', keysNext: '{{design.keys_next}}',
    keysRound: '{{design.keys_round}}', keysNotes: '{{design.keys_notes}}',
    keysPin: '{{design.keys_pin}}', keysClick: '{{design.keys_click}}',
    keysClose: '{{design.keys_close}}', ctrl: '{{design.key_ctrl}}',
    upinHint: '{{design.upin_hint}}', upinArm: '{{design.upin_arm}}',
    upinTap: '{{design.upin_tap_hint}}', upinPlaceholder: '{{design.upin_placeholder}}',
    upinKeys: '{{design.upin_keys}}', upinDelete: '{{design.upin_delete}}',
    upinLabel: '{{design.upin_label}}', submit: '{{panel.submit_iterate}}',
    views: '{{design.nav_views_heading}}', anno: '{{anno.toggle_hide}}'
  };
  // Never the accent blue: the icons are drawn in it (one uniform tint), the
  // background must stay distinguishable (§ Variant overview — authoring).
  const PALETTE = ['#5f8b6a', '#e8622c', '#8250df', '#d29922', '#db61a2', '#1f9e89', '#b0563a', '#6e7781', '#c2408f'];
  const ICONS = {
    leaf: ['M5 21c0-9 6-15 15-16-1 9-7 15-16 16z', 'M5 21l8-8'],
    rocket: ['M9 15l-3-3 6-7c2-2 5-3 8-3 0 3-1 6-3 8l-7 6z', 'M5 15c-1 2-1 4-1 5 1 0 3 0 5-1', 'M15 9h.01'],
    gauge: ['M4 18a8 8 0 1 1 16 0', 'M12 18l4-6'],
    grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
    map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z', 'M9 4v14', 'M15 6v14'],
    cube: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5', 'M12 12v9', 'M12 12L4 7.5'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M3 20h18'],
    bolt: ['M13 2L4 14h7l-1 8 9-12h-7z'],
    heart: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
    compass: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M15.5 8.5l-2 5-5 2 2-5z'],
    layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
    sparkles: ['M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'M19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z'],
    shield: ['M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z'],
    book: ['M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z', 'M4 19V5'],
    user: ['M12 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
    home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
    sun: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M5 5l1.5 1.5', 'M17.5 17.5L19 19', 'M5 19l1.5-1.5', 'M17.5 6.5L19 5'],
    moon: ['M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z'],
    flame: ['M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z'],
    palette: ['M12 3a9 9 0 1 0 0 18c1 0 2-1 2-2s-1-2 0-3 2 0 4 0 3-2 3-4c0-5-4-9-9-9z', 'M7.5 11.5h.01', 'M10 7.5h.01', 'M15 7.5h.01'],
    game: ['M6 9h12a4 4 0 0 1 0 8c-2 0-3-2-6-2s-4 2-6 2a4 4 0 0 1 0-8z', 'M8 11v4', 'M6 13h4', 'M15.5 12.5h.01', 'M17.5 14h.01'],
    list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
    question: ['M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 1.7V15', 'M12 18h.01'],
    pin: ['M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z', 'M12 10h.01']
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
  const SVG_ATTRS = new Set(['viewBox', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
    'width', 'height', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'transform', 'opacity', 'fill-rule', 'clip-rule']);
  const CLONE_STRIP = ['data-comment', 'data-field', 'data-annotation', 'data-screen-link', 'data-tip',
    'data-attachable', 'autofocus', 'tabindex', 'title', 'for', 'aria-controls', 'aria-describedby', 'aria-labelledby'];

  const body = document.body;
  const header = document.getElementById('design-header');
  const quick = document.getElementById('design-quick');
  const hint = document.getElementById('upin-hint');
  const sheet = document.getElementById('design-keys');
  const annoToggle = document.getElementById('anno-toggle');
  const annoHome = annoToggle ? { parent: annoToggle.parentNode, next: annoToggle.nextSibling } : null;

  const visibleIteration = () => document.querySelector('section[data-iteration]:not([hidden])');
  const designsOf = it => (it ? [...it.querySelectorAll(':scope > section[data-design]')] : []);
  const viewsOf = it => (it ? [...it.querySelectorAll(':scope > section[data-view]')] : []);
  const overviewOf = it => (it ? it.querySelector(':scope > [data-design-overview]') : null);
  const isLive = it => !!(it && it.hasAttribute('data-active'));
  const activeDesignOf = it => (it ? it.querySelector(':scope > section[data-design][data-design-active="true"]') : null);
  const activeScreenOf = d => (d ? d.querySelector('section[data-screen][data-screen-active="true"]') : null);
  const mode = () => (body.dataset.overviewActive === 'true' ? 'overview'
    : body.dataset.viewActive === 'true' ? 'view' : 'design');
  const on = () => body.dataset.overview === 'true' && document.documentElement.dataset.template === 'design';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgFromPaths(paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(d => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }
  // An author-supplied inline <svg> is parsed as XML and rebuilt from an
  // allowlist — never inserted as markup: `dataset.designIcon` is the DECODED
  // attribute, so innerHTML would be a script sink on the concept page.
  function sanitizedSvg(raw) {
    let doc;
    try { doc = new DOMParser().parseFromString(raw, 'image/svg+xml'); } catch (e) { return null; }
    const root = doc && doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    const copy = src => {
      if (!SVG_TAGS.has(src.localName)) return null;
      const out = document.createElementNS(SVG_NS, src.localName);
      [...src.attributes].forEach(a => { if (SVG_ATTRS.has(a.name)) out.setAttribute(a.name, a.value); });
      [...src.children].forEach(c => { const k = copy(c); if (k) out.appendChild(k); });
      return out;
    };
    const svg = copy(root);
    if (!svg) return null;
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 24 24');
    if (!svg.getAttribute('fill')) svg.setAttribute('fill', 'none');
    if (!svg.getAttribute('stroke')) svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    return svg;
  }
  function iconEl(raw, opts = {}) {
    const span = el('span', 'dz-icon');
    span.setAttribute('aria-hidden', 'true');
    if (opts.size) span.dataset.size = opts.size;
    if (opts.kind) span.dataset.kind = opts.kind;
    if (opts.color) span.style.setProperty('--dz-color', opts.color);
    const v = String(raw || '').trim();
    if (ICONS[v]) span.appendChild(svgFromPaths(ICONS[v]));
    else if (/^<svg[\s>]/i.test(v)) {
      const svg = sanitizedSvg(v);
      if (svg) span.appendChild(svg); else span.appendChild(svgFromPaths(ICONS.grid));
    } else if (v) span.textContent = [...v].slice(0, 2).join('');
    else span.appendChild(svgFromPaths(ICONS.grid));
    return span;
  }
  function metaOf(d, idx) {
    const traits = String(d.dataset.designTraits || '').split('|').map(t => t.trim()).filter(Boolean).slice(0, 3);
    return {
      id: d.dataset.design,
      n: idx + 1,
      label: d.dataset.navLabel || d.dataset.design,
      motto: (d.dataset.designMotto || '').trim(),
      traits,
      icon: d.dataset.designIcon || '',
      color: (d.dataset.designColor || '').trim() || PALETTE[idx % PALETTE.length]
    };
  }
  function setTip(node, label, key) {
    node.dataset.tip = label;
    node.dataset.tipTier = 'info';
    if (key) {
      node.dataset.tipKey = key;
      node.setAttribute('aria-keyshortcuts', key.replace('⇧', 'Shift').replace(L.ctrl, 'Control'));
    }
  }

  // ── Engine store: favourite + user pins ────────────────────────────────
  const EMPTY = () => ({ favorite: null, pins: [] });
  function storeOf(it) {
    return it ? it.querySelector(':scope > textarea[data-engine-store="design-overview"]') : null;
  }
  function ensureStore(it) {
    if (!isLive(it) || storeOf(it)) return;
    const ta = document.createElement('textarea');
    ta.id = 'design-ov-store';
    ta.dataset.engineStore = 'design-overview';
    ta.hidden = true;
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    it.appendChild(ta);
  }
  function normalise(st) {
    const out = EMPTY();
    if (!st || typeof st !== 'object') return out;
    if (typeof st.favorite === 'string' && st.favorite) out.favorite = st.favorite;
    if (Array.isArray(st.pins)) {
      out.pins = st.pins.filter(p => p && typeof p.id === 'string' && typeof p.screen === 'string')
        .map(p => ({ id: p.id, design: String(p.design || ''), screen: p.screen,
          x: Number(p.x) || 0, y: Number(p.y) || 0, target: String(p.target || ''), text: String(p.text || '') }));
    }
    return out;
  }
  function frozenBlob(it) {
    const node = it && it.querySelector(':scope > script[type="application/json"][data-frozen-feedback]');
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }
  function readState(it) {
    if (!it) return EMPTY();
    if (!isLive(it)) {
      const blob = frozenBlob(it) || {};
      return normalise({ favorite: blob.favorite, pins: blob.userPins });
    }
    const ta = storeOf(it);
    if (!ta || !ta.value) return EMPTY();
    try { return normalise(JSON.parse(ta.value)); } catch (e) { return EMPTY(); }
  }
  function writeState(it, st) {
    const ta = storeOf(it);
    if (!ta) return;
    ta.value = JSON.stringify(normalise(st));
    ta.setAttribute('data-touched', 'true');
    // The `input` listeners of § State Persistence (saveState → bridge
    // draft) and § Layout JS (note markers) do the rest.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof _userInteracted !== 'undefined') { try { _userInteracted = true; } catch (e) {} }
    refresh();
  }
  window.designOverviewState = function(it) {
    return readState(it || document.querySelector('section[data-iteration][data-active]'));
  };
  function validFavorite(it, st) {
    return st.favorite && designsOf(it).some(d => d.dataset.design === st.favorite) ? st.favorite : null;
  }
  function toggleFavorite(designId) {
    const it = visibleIteration();
    if (!isLive(it) || body.classList.contains('viewing-frozen') || !designId) return;
    const st = readState(it);
    st.favorite = validFavorite(it, st) === designId ? null : designId;
    writeState(it, st);
  }

  // ── Notes count per design ─────────────────────────────────────────────
  function notesCount(it, designId, st) {
    let n = 0;
    const filled = ta => !!(ta && (ta.value || '').trim());
    document.querySelectorAll('#feedback-dock [data-design-comment]').forEach(ta => {
      if (ta.dataset.designComment === designId && filled(ta)) n++;
    });
    document.querySelectorAll('#feedback-dock [data-screen-comment]').forEach(ta => {
      if (ta.dataset.screenDesign === designId && filled(ta)) n++;
    });
    const d = it && it.querySelector(`:scope > section[data-design="${CSS.escape(designId)}"]`);
    if (d) d.querySelectorAll('textarea[data-annotation]').forEach(ta => { if (filled(ta)) n++; });
    n += st.pins.filter(p => p.design === designId && p.text.trim()).length;
    return n;
  }

  // ── Overview cards ─────────────────────────────────────────────────────
  function cloneFirstScreen(d, prefix) {
    const wrap = el('div', 'design-ov-scale');
    wrap.dataset.deviceClone = 'overview';
    wrap.setAttribute('inert', '');
    wrap.setAttribute('aria-hidden', 'true');
    const first = d.querySelector('section[data-screen]');
    if (!first) return wrap;
    [...first.children].forEach(child => {
      if (child.hasAttribute('data-anno-layer') || child.classList.contains('device-stage')
          || child.classList.contains('upin-layer')) return;
      const c = child.cloneNode(true);
      c.querySelectorAll('[data-anno-layer], .device-stage, .upin-layer, script').forEach(n => n.remove());
      [c, ...c.querySelectorAll('*')].forEach(n => {
        if (n.id) n.id = prefix + n.id;
        const name = n.getAttribute('name');
        if (name) n.setAttribute('name', prefix + name);
        CLONE_STRIP.forEach(a => n.removeAttribute(a));
        n.classList && n.classList.remove('upin-host');
      });
      wrap.appendChild(c);
    });
    return wrap;
  }
  function buildCard(it, d, m) {
    const card = el('article', 'design-ov-card');
    card.dataset.designId = m.id;
    card.style.setProperty('--dz-color', m.color);
    const badge = el('div', 'design-ov-badge', '★ ' + L.favBadge);
    badge.hidden = true;
    card.appendChild(badge);
    const head = el('button', 'design-ov-head');
    head.type = 'button';
    head.appendChild(iconEl(m.icon, { color: m.color }));
    head.appendChild(el('span', 'design-ov-num', String(m.n)));
    head.appendChild(el('span', 'design-ov-name', m.label));
    setTip(head, m.label, String(m.n));
    head.addEventListener('click', () => window.showDesign(m.id));
    card.appendChild(head);
    if (m.motto) card.appendChild(el('h3', 'design-ov-motto', m.motto));
    const preview = el('div', 'design-ov-preview');
    preview.setAttribute('role', 'button');
    preview.tabIndex = 0;
    preview.setAttribute('aria-label', L.open + ': ' + m.label);
    setTip(preview, L.open, String(m.n));
    preview.appendChild(cloneFirstScreen(d, 'ov' + m.n + '-'));
    preview.appendChild(el('span', 'design-ov-zoom', '⤢'));
    preview.addEventListener('click', () => window.showDesign(m.id));
    preview.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.showDesign(m.id); }
    });
    card.appendChild(preview);
    const screens = [...d.querySelectorAll('section[data-screen][id]')];
    if (screens.length > 1) {
      const chips = el('div', 'design-ov-chips');
      screens.forEach(sec => {
        const chip = el('button', 'design-ov-chip', sec.dataset.navLabel || sec.id);
        chip.type = 'button';
        chip.addEventListener('click', () => window.showDesign(m.id, sec.id));
        chips.appendChild(chip);
      });
      card.appendChild(chips);
    }
    if (m.traits.length) {
      const ul = el('ul', 'design-ov-traits');
      m.traits.forEach(t => ul.appendChild(el('li', '', t)));
      card.appendChild(ul);
    }
    const foot = el('div', 'design-ov-foot');
    const notes = el('span', 'design-ov-notes', '💬 0');
    notes.dataset.tip = L.notes;
    foot.appendChild(notes);
    const fav = el('button', 'design-fav-btn');
    fav.type = 'button';
    fav.dataset.designId = m.id;
    fav.setAttribute('aria-pressed', 'false');
    setTip(fav, L.favSet, 'F');
    fav.addEventListener('click', () => toggleFavorite(m.id));
    foot.appendChild(fav);
    card.appendChild(foot);
    return card;
  }

  // ── Header ─────────────────────────────────────────────────────────────
  const H = {};
  function buildHeader() {
    if (!header || H.main) return;
    H.main = el('div', 'design-header-main');
    H.back = el('button', 'design-header-back');
    H.back.type = 'button';
    H.back.appendChild(svgFromPaths(ICONS.grid));
    H.back.appendChild(el('span', '', L.overview));
    setTip(H.back, L.back, 'Esc');
    H.back.addEventListener('click', () => { closeHeader(); window.showOverview(); });
    H.sep = el('span', 'design-header-sep');
    H.iconSlot = el('span', 'design-header-icon');
    H.name = el('strong', 'design-header-name');
    H.star = el('span', 'design-header-star');
    H.eye = el('span', 'design-header-eye');
    // Comment pin: an icon next to the eye, drawn like it (round, ringed),
    // its label lives in the tooltip. Shown on a live design page only.
    H.pin = el('button', 'design-header-pin');
    H.pin.type = 'button';
    H.pin.setAttribute('aria-pressed', 'false');
    H.pin.setAttribute('aria-label', L.upinArm);
    H.pin.appendChild(svgFromPaths(ICONS.pin));
    setTip(H.pin, L.upinArm, L.ctrl + '+' + L.keysClick);
    H.pin.addEventListener('click', () => (armed === 'tap' ? disarm() : arm('tap')));
    // Icon + name sit in one pill, the same shape as the active quick-nav
    // segment, so the header reads as "this variant", not as loose text.
    H.pill = el('span', 'design-header-title');
    H.pill.append(H.iconSlot, H.name);
    H.main.append(H.back, H.sep, H.pill, H.star, H.eye, H.pin);
    H.more = el('div', 'design-header-more');
    H.actions = el('div', 'design-header-actions');
    H.tabs = el('div', 'design-header-tabs');
    H.tabs.setAttribute('role', 'tablist');
    H.fav = el('button', 'design-fav-btn');
    H.fav.type = 'button';
    H.fav.addEventListener('click', () => {
      const d = activeDesignOf(visibleIteration());
      if (d) toggleFavorite(d.dataset.design);
    });
    H.note = el('div', 'design-header-note');
    H.actions.append(H.tabs, H.fav);
    H.more.append(H.actions, H.note);
    header.append(H.main, H.more);
    // Touch path (R6): a tap on the card's own surface opens it the way a
    // hover does; a tap elsewhere closes it again.
    H.main.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      header.dataset.open = header.dataset.open === 'true' ? 'false' : 'true';
    });
    document.addEventListener('pointerdown', e => {
      if (header.dataset.open === 'true' && !header.contains(e.target)) closeHeader();
    });
  }
  function closeHeader() { if (header) header.dataset.open = 'false'; }

  // ── Variant switch that keeps the page ────────────────────────────────
  // Comparing variants means looking at the SAME page in each: on design A
  // page 2, key 2 / the quick-nav segment opens design B page 2. A design
  // without that page opens on its first page. A question view tied to a
  // design (data-view-for) maps the same way, by its position among that
  // design's views. From the overview or a free view the design opens where
  // it was last left (plain showDesign()).
  function showDesignAligned(id) {
    const it = visibleIteration();
    const target = designsOf(it).find(d => d.dataset.design === id);
    if (!target) return;
    const md = mode();
    const cur = activeDesignOf(it);
    if (md === 'design' && cur && cur !== target) {
      const idx = [...cur.querySelectorAll('section[data-screen][id]')].indexOf(activeScreenOf(cur));
      const screens = [...target.querySelectorAll('section[data-screen][id]')];
      const sec = screens[idx] || screens[0];
      window.showDesign(id, sec ? sec.id : undefined);
      return;
    }
    if (md === 'view') {
      const v = it.querySelector(':scope > section[data-view][data-view-active="true"]');
      const from = v && v.dataset.viewFor;
      if (from && from !== id && designsOf(it).some(d => d.dataset.design === from)) {
        const own = f => viewsOf(it).filter(x => x.dataset.viewFor === f);
        const match = own(id)[own(from).indexOf(v)];
        if (match) { window.showView(match.dataset.view); return; }
        const first = target.querySelector('section[data-screen][id]');
        window.showDesign(id, first ? first.id : undefined);
        return;
      }
    }
    window.showDesign(id);
  }

  // ── Quick nav ──────────────────────────────────────────────────────────
  function buildQuick(it, metas) {
    if (!quick) return;
    quick.innerHTML = '';
    const row = el('div', 'design-quick-row design-quick-designs');
    metas.forEach(m => {
      const seg = el('button', 'design-quick-seg');
      seg.type = 'button';
      seg.dataset.designId = m.id;
      seg.style.setProperty('--dz-color', m.color);
      seg.appendChild(iconEl(m.icon, { color: m.color }));
      seg.appendChild(el('span', 'design-quick-name', m.label));
      const star = el('span', 'design-quick-star', '★');
      star.hidden = true;
      seg.appendChild(star);
      setTip(seg, m.label, String(m.n));
      seg.addEventListener('click', () => { if (typeof closePanel === 'function') closePanel(); showDesignAligned(m.id); });
      row.appendChild(seg);
    });
    quick.appendChild(row);
    const vrow = el('div', 'design-quick-row design-quick-views');
    viewsOf(it).forEach((v, i) => {
      const seg = el('button', 'design-quick-view');
      seg.type = 'button';
      seg.dataset.viewId = v.dataset.view;
      seg.appendChild(iconEl('question', { size: 's', kind: 'plain' }));
      seg.appendChild(el('span', 'design-quick-name', v.dataset.navLabel || v.dataset.view));
      setTip(seg, v.dataset.navLabel || v.dataset.view, i < 9 ? '⇧+' + (i + 1) : '');
      seg.addEventListener('click', () => { if (typeof closePanel === 'function') closePanel(); window.showView(v.dataset.view); });
      vrow.appendChild(seg);
    });
    quick.appendChild(vrow);
  }

  // ── ☰ panel: icon prefix + hover keycap per design row ─────────────────
  function decorateNav(metas) {
    // The overview is the first top-level item, so it is the first ☰ row too.
    // Its own class, not .screen-nav-design-heading: every design-row loop
    // (active state, note markers, keycaps) must keep seeing designs only.
    const nav = document.getElementById('screen-nav');
    if (nav && !nav.querySelector('.screen-nav-overview-item')) {
      const row = el('button', 'screen-nav-overview-item');
      row.type = 'button';
      const label = el('span');
      label.append(iconEl('grid', { size: 's' }), document.createTextNode(L.overview));
      const k = el('kbd', 'app-kbd screen-nav-kbd', 'Esc');
      k.setAttribute('aria-hidden', 'true');
      row.append(label, k);
      row.addEventListener('click', () => {
        if (typeof closePanel === 'function') closePanel();
        window.showOverview();
      });
      const group = el('div', 'screen-nav-group screen-nav-overview-group');
      group.appendChild(row);
      nav.insertBefore(group, nav.firstChild);
    }
    document.querySelectorAll('#screen-nav .screen-nav-design-heading').forEach(h => {
      const m = metas.find(x => x.id === h.dataset.designId);
      if (!m) return;
      const label = h.firstElementChild;
      if (label && !label.querySelector('.dz-icon')) label.insertBefore(iconEl(m.icon, { size: 's', color: m.color }), label.firstChild);
      if (!h.querySelector('.screen-nav-kbd') && m.n <= 9) {
        const k = el('kbd', 'app-kbd screen-nav-kbd', String(m.n));
        k.setAttribute('aria-hidden', 'true');
        h.insertBefore(k, h.querySelector('.has-notes'));
        h.setAttribute('aria-keyshortcuts', String(m.n));
      }
    });
  }

  // ── Shortcut sheet ─────────────────────────────────────────────────────
  function kbdNode(spec) {
    const frag = document.createDocumentFragment();
    spec.split('+').forEach((k, i) => {
      if (i) frag.appendChild(document.createTextNode(' + '));
      frag.appendChild(el('kbd', 'app-kbd', k));
    });
    return frag;
  }
  function buildSheet() {
    if (!sheet || sheet.firstChild) return;
    sheet.appendChild(el('h2', '', L.keysTitle));
    const dl = el('dl');
    [['Esc', L.overview], ['1–9', L.keysDesign], ['⇧+1–9', L.keysView], ['Tab', L.keysNext],
     ['F', L.fav], ['Alt+1–9', L.keysRound], ['N', L.keysNotes], [L.ctrl + '+Enter', L.submit],
     [L.ctrl + '+' + L.keysClick, L.keysPin], ['?', L.keysTitle]].forEach(([k, label]) => {
      const dt = el('dt');
      dt.appendChild(kbdNode(k));
      dl.append(dt, el('dd', '', label));
    });
    sheet.appendChild(dl);
    const close = el('button', 'design-keys-close', L.keysClose);
    close.type = 'button';
    close.addEventListener('click', () => toggleSheet(false));
    sheet.appendChild(close);
  }
  function toggleSheet(force) {
    if (!sheet) return;
    const open = typeof force === 'boolean' ? force : sheet.hidden;
    sheet.hidden = !open;
    if (open) sheet.querySelector('.design-keys-close')?.focus();
  }

  // ── Build / teardown ───────────────────────────────────────────────────
  let metas = [];
  function placeEye(inHeader) {
    if (!annoToggle || !annoHome) return;
    if (inHeader && H.eye) { if (annoToggle.parentNode !== H.eye) H.eye.appendChild(annoToggle); }
    else if (annoToggle.parentNode !== annoHome.parent) annoHome.parent.insertBefore(annoToggle, annoHome.next);
  }
  window.buildDesignOverview = function() {
    const it = visibleIteration();
    document.querySelectorAll('[data-design-overview]').forEach(n => { if (!it || n.parentNode !== it) n.remove(); });
    const old = overviewOf(it);
    if (old) old.remove();
    const all = designsOf(it);
    if (all.length < 2) {
      metas = [];
      if (quick) quick.innerHTML = '';
      placeEye(false);
      disarm();
      return;
    }
    metas = all.map(metaOf);
    ensureStore(it);
    const ov = el('div', 'design-ov');
    ov.dataset.designOverview = '';
    ov.hidden = true;
    ov.setAttribute('role', 'region');
    ov.setAttribute('aria-label', L.overview);
    const grid = el('div', 'design-ov-grid');
    all.forEach((d, i) => grid.appendChild(buildCard(it, d, metas[i])));
    ov.appendChild(grid);
    it.insertBefore(ov, all[0]);
    buildHeader();
    buildQuick(it, metas);
    buildSheet();
    decorateNav(metas);
    updateChrome();
    requestAnimationFrame(fitPreviews);
  };
  // Fit the clone's CONTENT, not its 1000px virtual canvas: a phone mock
  // (max-width ~420px) scaled by box/1000 shrank to an unreadable strip in
  // the middle of a wide card. The content's horizontal extent is measured
  // at scale 1 (union of the first two levels), then scaled to fill the box
  // and centred; wide desktop mocks still fall back to box/1000.
  function fitPreviews() {
    document.querySelectorAll('.design-ov-preview').forEach(p => {
      const w = p.clientWidth;
      const wrap = p.querySelector('.design-ov-scale');
      if (!(w > 0) || !wrap) return;
      wrap.style.setProperty('--dz-ov-scale', '1');
      wrap.style.setProperty('--dz-ov-x', '0px');
      const origin = wrap.getBoundingClientRect().left;
      let left = Infinity, right = -Infinity;
      wrap.querySelectorAll(':scope > *, :scope > * > *').forEach(n => {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return;
        left = Math.min(left, r.left - origin);
        right = Math.max(right, r.right - origin);
      });
      const PAD = 24;
      const content = right > left ? Math.min(1000, right - left + 2 * PAD) : 1000;
      const from = right > left ? Math.max(0, left - PAD) : 0;
      const scale = Math.min(1, w / content);
      wrap.style.removeProperty('--dz-ov-scale');
      wrap.style.removeProperty('--dz-ov-x');
      p.style.setProperty('--dz-ov-scale', String(scale));
      p.style.setProperty('--dz-ov-x', ((w - content * scale) / 2 - from * scale).toFixed(1) + 'px');
    });
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitPreviews));
  document.addEventListener('overview:changed', () => requestAnimationFrame(fitPreviews));

  // ── Projection: header, quick nav, cards, pins ─────────────────────────
  function updateChrome() {
    const it = visibleIteration();
    const active = on() && !!overviewOf(it);
    placeEye(active);
    const navOv = document.querySelector('#screen-nav .screen-nav-overview-group');
    if (navOv) navOv.hidden = !active;
    if (!active) { if (hint) hint.hidden = true; return; }
    const st = readState(it);
    const fav = validFavorite(it, st);
    const live = isLive(it) && !body.classList.contains('viewing-frozen');
    const md = mode();
    if (navOv) navOv.firstElementChild.dataset.active = String(md === 'overview');
    const d = activeDesignOf(it);
    const m = d && metas.find(x => x.id === d.dataset.design);
    const favMeta = fav && metas.find(x => x.id === fav);
    if (header && H.main) {
      H.back.hidden = md === 'overview';
      H.sep.hidden = md === 'overview';
      H.iconSlot.innerHTML = '';
      H.tabs.innerHTML = '';
      header.style.removeProperty('--dz-color');
      let motto = '', note = '', showTabs = false, showFav = false;
      if (md === 'overview') {
        H.iconSlot.appendChild(iconEl('grid'));
        H.name.textContent = L.overview;
        H.star.textContent = favMeta ? '★ ' + favMeta.label : '';
        motto = L.count.replace('{n}', String(metas.length));
        note = fav ? L.hintSet : L.hintNone;
      } else if (md === 'view') {
        const v = it.querySelector(':scope > section[data-view][data-view-active="true"]');
        H.iconSlot.appendChild(iconEl('question', { kind: 'plain' }));
        H.name.textContent = v ? (v.dataset.navLabel || v.dataset.view) : '';
        H.star.textContent = '';
      } else if (m) {
        header.style.setProperty('--dz-color', m.color);
        H.iconSlot.appendChild(iconEl(m.icon, { color: m.color }));
        H.name.textContent = m.label;
        H.star.textContent = fav === m.id ? '★' : '';
        motto = m.motto;
        showFav = true;
        const screens = [...d.querySelectorAll('section[data-screen][id]')];
        const cur = activeScreenOf(d);
        if (screens.length > 1) {
          showTabs = true;
          screens.forEach(sec => {
            const tab = el('button', 'design-header-tab', sec.dataset.navLabel || sec.id);
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.dataset.active = String(sec === cur);
            tab.setAttribute('aria-selected', String(sec === cur));
            if (sec !== cur && screens.indexOf(sec) === (screens.indexOf(cur) + 1) % screens.length) setTip(tab, L.next, 'Tab');
            tab.addEventListener('click', () => window.showScreen(sec.id));
            H.tabs.appendChild(tab);
          });
        }
      }
      H.star.hidden = !H.star.textContent;
      // The motto is the name's tooltip, not a line of its own.
      if (motto) setTip(H.name, motto);
      else { delete H.name.dataset.tip; delete H.name.dataset.tipTier; }
      H.note.textContent = note;
      H.note.hidden = !note;
      H.tabs.hidden = !showTabs;
      H.fav.hidden = !showFav;
      H.fav.disabled = !live;
      const pressed = !!(m && fav === m.id);
      H.fav.setAttribute('aria-pressed', String(pressed));
      H.fav.textContent = (pressed ? '★ ' : '☆ ') + L.fav;
      setTip(H.fav, pressed ? L.favUnset : L.favSet, 'F');
      H.pin.hidden = !(md === 'design' && live);
      H.pin.setAttribute('aria-pressed', String(armed === 'tap'));
      H.actions.hidden = H.tabs.hidden && H.fav.hidden;
      H.more.hidden = H.actions.hidden && H.note.hidden;
    }
    if (quick) {
      quick.querySelectorAll('.design-quick-seg').forEach(seg => {
        seg.dataset.active = String(md === 'design' && !!d && seg.dataset.designId === d.dataset.design);
        const star = seg.querySelector('.design-quick-star');
        if (star) star.hidden = seg.dataset.designId !== fav;
      });
      const v = md === 'view' && it.querySelector(':scope > section[data-view][data-view-active="true"]');
      quick.querySelectorAll('.design-quick-view').forEach(seg => {
        seg.dataset.active = String(!!v && seg.dataset.viewId === v.dataset.view);
      });
    }
    const grid = overviewOf(it)?.querySelector('.design-ov-grid');
    if (grid) {
      grid.dataset.hasFavorite = String(!!fav);
      grid.querySelectorAll('.design-ov-card').forEach(card => {
        const id = card.dataset.designId;
        const isFav = id === fav;
        card.dataset.favorite = String(isFav);
        card.querySelector('.design-ov-badge').hidden = !isFav;
        const btn = card.querySelector('.design-fav-btn');
        btn.setAttribute('aria-pressed', String(isFav));
        btn.textContent = (isFav ? '★ ' : '☆ ') + L.fav;
        btn.disabled = !live;
        setTip(btn, isFav ? L.favUnset : L.favSet, 'F');
        const notes = card.querySelector('.design-ov-notes');
        if (notes) notes.textContent = '💬 ' + notesCount(it, id, st);
      });
    }
    if (md !== 'design' || !live) disarm();
    renderPins(it, st, live);
  }
  window.updateDesignChrome = updateChrome;
  function refresh() { if (on()) updateChrome(); }
  window.refreshDesignOverview = refresh;
  document.addEventListener('input', e => {
    if (!on() || (e.target && e.target.dataset && e.target.dataset.engineStore)) return;
    const it = visibleIteration();
    const st = readState(it);
    document.querySelectorAll('.design-ov-card').forEach(card => {
      const notes = card.querySelector('.design-ov-notes');
      if (notes) notes.textContent = '💬 ' + notesCount(it, card.dataset.designId, st);
    });
  });
  document.addEventListener('iteration:changed', () => { closeHeader(); toggleSheet(false); });

  // ── User pins (Ctrl + click) ───────────────────────────────────────────
  let armed = null;   // 'ctrl' while the key is held, 'tap' after the header button
  let draft = null;   // the pin being placed, until saved or discarded
  function arm(kind) {
    if (!on() || mode() !== 'design') return;
    const it = visibleIteration();
    if (!isLive(it) || body.classList.contains('viewing-frozen')) return;
    armed = kind;
    body.classList.add('upin-armed');
    if (hint) {
      hint.textContent = '';
      if (kind === 'ctrl') {
        hint.appendChild(el('kbd', 'app-kbd', L.ctrl));
        hint.appendChild(document.createTextNode(' ' + L.upinHint));
      } else hint.textContent = L.upinTap;
      hint.hidden = false;
    }
    if (H.pin) H.pin.setAttribute('aria-pressed', String(kind === 'tap'));
  }
  function disarm() {
    if (!armed) return;
    armed = null;
    body.classList.remove('upin-armed');
    if (hint) hint.hidden = true;
    if (H.pin) H.pin.setAttribute('aria-pressed', 'false');
  }
  const fieldFocused = t => !!(t && t.closest && t.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"], #feedback-dock, .anno-bubble, .upin-editor'));
  document.addEventListener('keydown', e => {
    if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat && !fieldFocused(e.target)) arm('ctrl');
  });
  document.addEventListener('keyup', e => {
    if ((e.key === 'Control' || e.key === 'Meta') && armed === 'ctrl') disarm();
  });
  window.addEventListener('blur', () => { if (armed === 'ctrl') disarm(); });
  document.addEventListener('pointermove', e => {
    if (armed === 'ctrl' && !e.ctrlKey && !e.metaKey) disarm();
  });
  function contentBox(screen) {
    return screen.querySelector(':scope > .device-frame')
      || [...screen.children].find(c => !c.hasAttribute('data-anno-layer') && !c.classList.contains('device-stage'))
      || screen;
  }
  function describeTarget(node, screen) {
    if (!node || node.nodeType !== 1 || node === screen) return '';
    let s = node.tagName.toLowerCase();
    if (node.id) s = '#' + node.id;
    else {
      const cls = [...node.classList].filter(c => !/^upin/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
    }
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return text ? s + ' "' + text + '"' : s;
  }
  document.addEventListener('click', e => {
    if (!armed && !(e.ctrlKey || e.metaKey)) return;
    if (!on() || mode() !== 'design') return;
    const it = visibleIteration();
    if (!isLive(it) || body.classList.contains('viewing-frozen')) return;
    const d = activeDesignOf(it);
    const screen = activeScreenOf(d);
    if (!screen || !screen.contains(e.target)) return;
    if (e.target.closest('.upin, .anno, .device-stage')) return;
    if (body.dataset.viewportMode && body.dataset.viewportMode !== 'desktop') return;
    const box = contentBox(screen);
    const r = box.getBoundingClientRect();
    const w = r.width || 1, h = r.height || 1;
    const pct = (v, lo, size) => Math.round(Math.min(100, Math.max(0, ((v - lo) / size) * 100)) * 10) / 10;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (armed === 'tap') disarm();
    draft = {
      id: 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      design: d.dataset.design, screen: screen.id,
      x: pct(e.clientX, r.left, w), y: pct(e.clientY, r.top, h),
      target: describeTarget(e.target, screen), text: ''
    };
    renderPins(it, readState(it), true);
  }, true);
  function savePin(pin, text) {
    const it = visibleIteration();
    const st = readState(it);
    const t = String(text || '').trim();
    const idx = st.pins.findIndex(p => p.id === pin.id);
    if (!t) { if (idx >= 0) st.pins.splice(idx, 1); }
    else if (idx >= 0) st.pins[idx].text = t;
    else st.pins.push({ ...pin, text: t });
    if (draft && draft.id === pin.id) draft = null;
    writeState(it, st);
  }
  function discardDraft() {
    draft = null;
    const it = visibleIteration();
    renderPins(it, readState(it), isLive(it));
  }
  function pinNode(pin, k, live, isDraft) {
    const wrap = el('div', 'upin');
    wrap.dataset.upinId = pin.id;
    wrap.style.setProperty('--upin-x', pin.x + '%');
    wrap.style.setProperty('--upin-y', pin.y + '%');
    if (pin.x > 60) wrap.dataset.flipX = 'true';
    if (pin.y > 70) wrap.dataset.flipY = 'true';
    const label = L.upinLabel.replace('{n}', String(k));
    const btn = el('button', 'upin-pin', String(k));
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = pin.text || label;
    const ed = el('div', 'upin-editor');
    ed.hidden = !isDraft;
    ed.appendChild(el('div', 'upin-editor-head', label));
    const ta = el('textarea');
    ta.placeholder = L.upinPlaceholder;
    ta.value = pin.text;
    ta.readOnly = !live;
    ta.setAttribute('aria-label', label);
    ed.appendChild(ta);
    const foot = el('div', 'upin-editor-foot');
    foot.appendChild(el('span', '', live ? L.upinKeys : ''));
    if (live && !isDraft) {
      const del = el('button', 'upin-delete', L.upinDelete);
      del.type = 'button';
      del.addEventListener('click', () => savePin(pin, ''));
      foot.appendChild(del);
    }
    ed.appendChild(foot);
    wrap.append(btn, ed);
    btn.addEventListener('click', () => {
      const open = ed.hidden;
      document.querySelectorAll('.upin-editor').forEach(x => { if (x !== ed) x.hidden = true; });
      ed.hidden = !open;
      if (open) ta.focus();
    });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDraft) discardDraft();
        else { ta.value = pin.text; ed.hidden = true; btn.focus(); }
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (live) savePin(pin, ta.value); else ed.hidden = true;
      }
    });
    // Leaving the editor keeps what was typed (like an annotation answer);
    // an untouched new pin simply goes away.
    ed.addEventListener('focusout', e => {
      if (!live || ed.contains(e.relatedTarget)) return;
      setTimeout(() => {
        if (ed.contains(document.activeElement) || !ed.isConnected) return;
        if (isDraft) { if (ta.value.trim()) savePin(pin, ta.value); else discardDraft(); }
        else if (ta.value.trim() !== pin.text.trim()) savePin(pin, ta.value);
      }, 0);
    });
    return { wrap, ta };
  }
  function renderPins(it, st, live) {
    document.querySelectorAll('.upin-layer').forEach(n => n.remove());
    document.querySelectorAll('.upin-host').forEach(n => n.classList.remove('upin-host'));
    if (!on() || mode() !== 'design' || !it) return;
    if (body.dataset.viewportMode && body.dataset.viewportMode !== 'desktop') return;
    const d = activeDesignOf(it);
    const screen = activeScreenOf(d);
    if (!screen) return;
    const pins = st.pins.filter(p => p.screen === screen.id && (!p.design || p.design === d.dataset.design));
    const showDraft = live && draft && draft.screen === screen.id;
    if (!pins.length && !showDraft) return;
    const box = contentBox(screen);
    box.classList.add('upin-host');
    const layer = el('div', 'upin-layer');
    pins.forEach((p, i) => layer.appendChild(pinNode(p, i + 1, live, false).wrap));
    let focusTa = null;
    if (showDraft) {
      const n = pinNode(draft, pins.length + 1, true, true);
      layer.appendChild(n.wrap);
      focusTa = n.ta;
    }
    box.appendChild(layer);
    if (focusTa) focusTa.focus();
  }

  // ── Hotkeys ────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!on() || e.defaultPrevented) return;
    if (fieldFocused(e.target)) return;
    const panelOpen = !!document.getElementById('decision-panel')?.classList.contains('open');
    const dockOpen = document.getElementById('feedback-dock')?.dataset.open === 'true';
    if (e.key === 'Escape') {
      if (sheet && !sheet.hidden) { toggleSheet(false); e.preventDefault(); return; }
      if (armed) { disarm(); e.preventDefault(); return; }
      if (header && header.dataset.open === 'true') { closeHeader(); e.preventDefault(); return; }
      if (panelOpen || dockOpen) return;
      if (mode() !== 'overview') { e.preventDefault(); window.showOverview(); }
      return;
    }
    if (panelOpen) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    const n = digit ? Number(digit[1]) : 0;
    const it = visibleIteration();
    if (n && e.altKey && !e.ctrlKey && !e.metaKey) {
      const tab = document.querySelectorAll('.iteration-tabs .iteration-tab')[n - 1];
      if (tab) { e.preventDefault(); tab.click(); }
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter') {
        const btn = document.getElementById('submit-iterate-btn');
        const ready = document.getElementById('panel-ready');
        if (btn && !btn.disabled && ready && getComputedStyle(ready).display !== 'none'
            && !body.classList.contains('viewing-frozen')) { e.preventDefault(); btn.click(); }
      }
      return;
    }
    if (e.altKey) return;
    if (n && e.shiftKey) {
      const v = viewsOf(it)[n - 1];
      if (v) { e.preventDefault(); window.showView(v.dataset.view); }
      return;
    }
    if (n) {
      const d = designsOf(it)[n - 1];
      if (d) { e.preventDefault(); showDesignAligned(d.dataset.design); }
      return;
    }
    if (e.key === '?') { e.preventDefault(); toggleSheet(); return; }
    if (e.shiftKey) return;
    const k = (e.key || '').toLowerCase();
    if (e.key === 'Tab') {
      const t = document.activeElement;
      if (mode() !== 'design' || (t && t !== body && t !== document.documentElement)) return;
      const d = activeDesignOf(it);
      const screens = d ? [...d.querySelectorAll('section[data-screen][id]')] : [];
      if (screens.length < 2) return;
      e.preventDefault();
      const cur = screens.indexOf(activeScreenOf(d));
      window.showScreen(screens[(cur + 1) % screens.length].id);
      return;
    }
    if (k === 'f') {
      let id = null;
      if (mode() === 'design') id = activeDesignOf(it)?.dataset.design;
      else if (mode() === 'overview') id = document.activeElement?.closest?.('.design-ov-card')?.dataset.designId || null;
      if (id) { e.preventDefault(); toggleFavorite(id); }
      return;
    }
    if (k === 'n') {
      const fab = document.getElementById('feedback-toggle');
      if (fab) { e.preventDefault(); fab.click(); }
    }
  });
})();
```

## Variant overview CSS (≥2 designs)

Chrome of § Variant overview (≥2 designs). Every rule is gated on
`body[data-overview="true"]` (set by `buildDesignUI()` for a round with ≥2
designs) or lives on an element that only exists in that mode, so a
single-design round paints exactly as before. Geometry follows the top-edge
partition of templates-design-css.md § Layout CSS: the header owns the left band the screen indicator owned
(collapsed ≤ 280px), the quick nav the centre band the design switcher
owned; both expand only as overlays (fixed, higher z-index), never by
pushing anything — the content box never moves.

```css
#design-header, #design-quick { display: none; }
.design-header [hidden], .design-quick [hidden], .design-ov [hidden] { display: none !important; }
/* On the overview no screen and no design is "current": the dock keeps its
   general row only (the per-design notes live on the design pages). */
body[data-overview-active="true"] .feedback-section:has(#screen-textareas),
body[data-overview-active="true"] .feedback-divider:has(+ .feedback-section #screen-textareas),
body[data-overview-active="true"] .feedback-section:has(#design-textareas),
body[data-overview-active="true"] .feedback-divider:has(+ .feedback-section #design-textareas) { display: none; }
body[data-overview-active="true"] .feedback-divider:has(+ .feedback-section #design-general-feedback) { display: none; }
html[data-template="design"] body[data-overview="true"] #design-header,
html[data-template="design"] body[data-overview="true"] #design-quick { display: flex; }
html[data-template="design"] body[data-overview="true"] .screen-indicator,
html[data-template="design"] body[data-overview="true"] .design-switcher { display: none; }
html:not([data-template="design"]) .design-ov,
html:not([data-template="design"]) .upin-layer,
html:not([data-template="design"]) .upin-hint { display: none !important; }

/* ── Overview (first top-level item) ── */
[data-template="design"] .design-ov {
  position: absolute; inset: 0;
  padding: var(--chrome-safe-top, 5.75rem) 2rem var(--chrome-safe-bottom, 2rem);
  overflow-y: auto;
  animation: screen-in 0.25s ease;
}
.design-ov[hidden] { display: none; }
body:not([data-overview-active="true"]) .design-ov { display: none; }
.design-ov-grid {
  display: grid; gap: 1.25rem; align-items: stretch;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  max-width: 1680px; margin: 0 auto;
  /* Room for the favourite's lift + badge so neither is clipped (R8). */
  padding-top: 0.75rem;
}
.design-ov-card {
  --dz-color: var(--accent-color);
  position: relative; display: flex; flex-direction: column; gap: 0.75rem;
  padding: 1.1rem 1.1rem 1rem; border-radius: 16px;
  background: color-mix(in srgb, var(--dz-color) 9%, var(--panel-bg, #161b22));
  border: 2px solid color-mix(in srgb, var(--dz-color) 35%, var(--border-color, #30363d));
  color: var(--text-color, #e6edf3);
  transition: transform 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.design-ov-card::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 6px;
  border-radius: 14px 14px 0 0; background: var(--dz-color);
}
.design-ov-card[data-favorite="true"] {
  border-color: var(--warning-color, #d29922);
  transform: translateY(-6px);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning-color, #d29922) 35%, transparent),
              0 16px 40px color-mix(in srgb, var(--warning-color, #d29922) 28%, transparent);
}
.design-ov-grid[data-has-favorite="true"] .design-ov-card:not([data-favorite="true"]) { opacity: 0.62; }
.design-ov-grid[data-has-favorite="true"] .design-ov-card:not([data-favorite="true"]):hover,
.design-ov-grid[data-has-favorite="true"] .design-ov-card:not([data-favorite="true"]):focus-within { opacity: 1; }
.design-ov-badge {
  position: absolute; top: -0.8rem; right: 1rem;
  padding: 0.2rem 0.7rem; border-radius: 8px;
  background: var(--warning-color, #d29922); color: var(--panel-bg, #0d1117);
  font-weight: 800; font-size: 0.75rem; letter-spacing: 0.1em;
}
.design-ov-head {
  display: flex; align-items: center; gap: 0.5rem; padding: 0; border: 0;
  background: none; cursor: pointer; text-align: left; font: inherit;
  color: var(--dz-color); font-size: 0.8rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.design-ov-head:hover .design-ov-name { text-decoration: underline; }
.design-ov-motto { margin: 0; font-size: 1.45rem; line-height: 1.15; font-weight: 700; color: var(--text, #e6edf3); }
.design-ov-preview {
  /* Tall enough to read the mock, not just recognise it (was 220px). */
  position: relative; display: block; width: 100%; height: clamp(300px, 48vh, 600px);
  border-radius: 12px; overflow: hidden; cursor: zoom-in;
  border: 1px solid var(--border-color, #30363d);
  background: var(--bg-secondary, var(--panel-bg, #0d1117));
}
.design-ov-preview:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
/* The scaled clone: laid out at a fixed 1000px virtual width, scaled to the box by
   fitOverviewPreviews() (--dz-ov-scale). pointer-events none + inert keep
   the mock's own controls out of reach — the preview is one button. */
.design-ov-scale {
  position: absolute; top: 0; left: 0; width: 1000px;
  transform: translateX(var(--dz-ov-x, 0px)) scale(var(--dz-ov-scale, 0.28)); transform-origin: 0 0;
  pointer-events: none; padding: 1.5rem; box-sizing: border-box;
}
.design-ov-scale > * { width: 100%; }
.design-ov-zoom {
  position: absolute; right: 0.5rem; bottom: 0.5rem; padding: 0.15rem 0.5rem;
  border-radius: 999px; font-size: 0.8rem;
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 85%, transparent);
  color: var(--text, #e6edf3);
}
.design-ov-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.design-ov-chip {
  border: 1px solid var(--border-color, #30363d); background: transparent;
  color: var(--text-secondary, #8b949e); border-radius: 999px;
  padding: 0.15rem 0.6rem; font: inherit; font-size: 0.78rem; cursor: pointer;
}
.design-ov-chip:hover { color: var(--text, #e6edf3); border-color: var(--dz-color); }
.design-ov-traits { margin: 0; padding: 0 0 0 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.92rem; font-weight: 600; }
.design-ov-traits li::marker { color: var(--dz-color); }
.design-ov-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.design-ov-notes { font-size: 0.85rem; color: var(--text-secondary, #8b949e); }

/* ── Design icon — one uniform accent tint, the design colour behind it ── */
.dz-icon {
  display: inline-grid; place-items: center; flex: none;
  width: 26px; height: 26px; border-radius: 50%;
  background: color-mix(in srgb, var(--dz-color, var(--border-color)) 45%, var(--panel-bg, #161b22));
  color: color-mix(in srgb, var(--accent-color, #58a6ff) 85%, transparent);
  font-size: 13px; line-height: 1;
}
.dz-icon svg { width: 62%; height: 62%; display: block; }
.dz-icon[data-size="s"] { width: 18px; height: 18px; border-radius: 5px; font-size: 10px; }
.dz-icon[data-kind="plain"] { background: transparent; color: var(--text-secondary, #8b949e); }

/* ── Favourite button (card, header) ── */
.design-fav-btn {
  display: inline-flex; align-items: center; gap: 0.35rem; white-space: nowrap;
  border: 1px solid var(--warning-color, #d29922); background: transparent;
  color: var(--warning-color, #d29922); border-radius: 8px;
  padding: 0.3rem 0.7rem; font: inherit; font-size: 0.85rem; font-weight: 700; cursor: pointer;
}
.design-fav-btn:hover { background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent); }
.design-fav-btn[aria-pressed="true"] { background: var(--warning-color, #d29922); color: var(--panel-bg, #0d1117); }
.design-fav-btn:disabled { opacity: 0.55; cursor: default; }

/* ── Header — one card, grows over the content ── */
.design-header {
  position: fixed; top: 1rem; left: 1rem; z-index: 99;
  flex-direction: column; box-sizing: border-box;
  --dz-head-cap: min(calc(33vw - 1.5rem), 30rem);
  width: max-content; max-width: var(--dz-head-cap);
  padding: 0.35rem 0.7rem; border-radius: 12px;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, transparent);
  border: 1px solid var(--border-color, #30363d);
  border-left: 4px solid var(--dz-color, var(--accent-color));
  color: var(--text-secondary, #8b949e); font-size: 0.85rem;
  backdrop-filter: blur(6px);
  opacity: 0.6;
  transition: opacity 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}
.design-header:hover, .design-header:focus-within, .design-header[data-open="true"] {
  opacity: 1; background: var(--panel-bg, #161b22);
  max-width: calc(100vw - 8rem);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.design-header-main { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; min-width: 0; min-height: 28px; }
/* The name carries its OWN cap, identical at rest and expanded: when only
   the header's max-width capped it, hover lifted the cap, the name
   un-truncated and every icon right of it (★, eye, pin) jumped sideways.
   19rem ≈ everything else on the row (back, pill chrome, ★, eye, pin, gaps,
   padding), so the row never exceeds the resting cap and the expanded state
   cannot reflow it. */
.design-header-name {
  color: var(--text, #e6edf3); font-weight: 600; min-width: 0;
  max-width: max(3rem, min(12rem, calc(var(--dz-head-cap) - 19rem)));
  overflow: hidden; text-overflow: ellipsis;
}
.design-header-title {
  display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0;
  padding: 0.15rem 0.65rem 0.15rem 0.2rem; border-radius: 999px;
  background: color-mix(in srgb, var(--border-color, #30363d) 80%, transparent);
  box-shadow: inset 0 -2px 0 var(--dz-color, var(--accent-color));
}
.design-header-icon:empty { display: none; }
.design-header-title:has(.design-header-icon:empty) { padding-left: 0.65rem; }
.design-header-star { color: var(--warning-color, #d29922); white-space: nowrap; }
.design-header-back {
  display: inline-flex; align-items: center; gap: 0.3rem; flex: none;
  border: 0; background: transparent; color: var(--text-secondary, #8b949e);
  padding: 0.15rem 0.35rem; border-radius: 6px; font: inherit; font-size: 0.8rem; cursor: pointer;
}
.design-header-back:hover { color: var(--text, #e6edf3); background: color-mix(in srgb, var(--accent-color) 12%, transparent); }
.design-header-back svg { width: 14px; height: 14px; display: block; flex: none; }
.design-header-sep { width: 1px; height: 18px; background: var(--border-color, #30363d); flex: none; }
/* The eye moves in here (wireDesignOverview) — same control, inline size. */
.design-header .anno-toggle-fab { position: static; flex: none; width: 24px; height: 24px; border-width: 1px; box-shadow: none; }
.design-header .anno-toggle-fab svg { width: 13px; height: 13px; }
.design-header-more { display: none; flex-direction: column; gap: 0.5rem; margin-top: 0.45rem; padding: 0.45rem 0 0.15rem; border-top: 1px solid var(--border-color, #30363d); }
.design-header:hover .design-header-more,
.design-header:focus-within .design-header-more,
.design-header[data-open="true"] .design-header-more { display: flex; }
.design-header-more:empty { display: none !important; }
.design-header-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.design-header-note { max-width: 320px; white-space: normal; color: var(--text-color, #c9d1d9); }
.design-header-tabs { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 8px; background: color-mix(in srgb, var(--panel-bg, #0d1117) 60%, var(--border-color, #30363d)); }
.design-header-tab {
  border: 0; background: transparent; color: var(--text-secondary, #8b949e);
  padding: 0.2rem 0.6rem; border-radius: 6px; font: inherit; font-size: 0.8rem; cursor: pointer;
}
.design-header-tab:hover { color: var(--text, #e6edf3); }
.design-header-tab[data-active="true"] { background: var(--border-color, #30363d); color: var(--text, #e6edf3); font-weight: 700; }
.design-header-name[data-tip] { cursor: help; }
/* Same shape as the header eye (.design-header .anno-toggle-fab). */
.design-header-pin {
  flex: none; width: 24px; height: 24px; padding: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--anno-accent, var(--accent-color, #58a6ff));
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  color: var(--anno-accent, var(--accent-color, #58a6ff));
  cursor: pointer; transition: transform 0.15s;
}
.design-header-pin:hover { transform: scale(1.08); }
.design-header-pin[hidden] { display: none; }
.design-header-pin svg { width: 13px; height: 13px; display: block; }
.design-header-pin[aria-pressed="true"] { border-color: #f78166; background: #f78166; color: #fff; }

/* ── Quick nav — top centre ── */
.design-quick {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%); z-index: 95;
  flex-direction: column; align-items: center; gap: 4px;
  max-width: 34vw; opacity: 0.6; transition: opacity 0.16s ease;
}
.design-quick:hover, .design-quick:focus-within { opacity: 1; z-index: 98; max-width: calc(100vw - 2 * (1rem + min(33vw - 1.5rem, 280px) + 0.75rem)); }
.design-quick-row { display: flex; gap: 3px; max-width: 100%; }
.design-quick-designs {
  padding: 3px; border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, transparent);
  border: 1px solid var(--border-color, #30363d); backdrop-filter: blur(6px);
}
.design-quick-seg, .design-quick-view {
  display: inline-flex; align-items: center; gap: 0.4rem; min-width: 0;
  border: 0; background: transparent; cursor: pointer; white-space: nowrap;
  border-radius: 999px; font: inherit; color: var(--text-secondary, #8b949e);
}
.design-quick-seg { padding: 0.2rem 0.65rem 0.2rem 0.25rem; font-size: 0.8rem; }
.design-quick-seg .design-quick-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.design-quick-seg:hover, .design-quick-view:hover { color: var(--text, #e6edf3); background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.design-quick-seg[data-active="true"] {
  color: var(--text, #e6edf3); font-weight: 700;
  background: color-mix(in srgb, var(--border-color, #30363d) 80%, transparent);
  box-shadow: inset 0 -2px 0 var(--dz-color, var(--accent-color));
}
.design-quick-star { color: var(--warning-color, #d29922); }
.design-quick-view { padding: 0.1rem 0.55rem; font-size: 0.75rem; }
.design-quick-view[data-active="true"] { color: var(--text, #e6edf3); background: var(--border-color, #30363d); }
.design-quick-views:empty { display: none; }
body.panel-open .design-quick, body.panel-open .design-header { opacity: 0; pointer-events: none; }
@media (max-width: 900px) {
  /* Icons only — the tooltip still names each design. */
  .design-quick-seg .design-quick-name { display: none; }
  .design-quick-seg { padding: 0.2rem; }
}

/* ── ☰ panel: icon prefix + hover keycap on design rows ── */
.screen-nav-overview-group[hidden] { display: none; }
.screen-nav-overview-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 0.85rem; border-radius: 8px; border: none;
  background: transparent; color: var(--text); font: inherit; font-size: 0.9rem;
  font-weight: 700; cursor: pointer; text-align: left; transition: background 0.15s;
}
.screen-nav-overview-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-overview-item[data-active="true"] { color: var(--accent-color); }
.screen-nav-overview-item > span:first-child { display: inline-flex; align-items: center; min-width: 0; }
.screen-nav-overview-item .dz-icon { margin-right: 0.5rem; }
.screen-nav-overview-item:hover .screen-nav-kbd { opacity: 1; transition-delay: 1.5s; }
.screen-nav-design-heading > span:first-child { display: inline-flex; align-items: center; min-width: 0; }
.screen-nav-design-heading .dz-icon { margin-right: 0.5rem; }
.screen-nav-kbd { opacity: 0; transition: opacity 0.14s ease 0s; margin-left: auto; }
.screen-nav-design-heading:hover .screen-nav-kbd { opacity: 1; transition-delay: 1.5s; }
.screen-nav-design-heading:focus-visible .screen-nav-kbd { opacity: 1; transition-delay: 0s; }

/* ── Keycap — one look for the tooltip, the sheet, the hint bar, the panel ── */
.app-kbd {
  display: inline-block; min-width: 1.1em; padding: 0 0.35em; margin: 0 0.1em;
  border: 1px solid var(--border-color, #30363d); border-bottom-width: 2px; border-radius: 5px;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, var(--border-color, #30363d));
  color: var(--text, #e6edf3);
  font: 600 0.72rem/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center; vertical-align: baseline;
}

/* ── Shortcut sheet (`?`) ── */
.design-keys {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 240;
  width: min(420px, calc(100vw - 2rem)); max-height: calc(100dvh - 4rem); overflow-y: auto;
  padding: 1rem 1.25rem; border-radius: 14px; box-sizing: border-box;
  background: var(--panel-bg, #161b22); color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d); box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}
.design-keys[hidden] { display: none; }
.design-keys h2 { margin: 0 0 0.6rem; font-size: 1rem; }
.design-keys dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.4rem 1rem; font-size: 0.88rem; }
.design-keys dt { white-space: nowrap; text-align: right; }
.design-keys dd { margin: 0; color: var(--text-secondary, #8b949e); }
.design-keys-close { margin-top: 0.8rem; float: right; border: 1px solid var(--border-color, #30363d); background: transparent; color: var(--text, #e6edf3); border-radius: 8px; padding: 0.25rem 0.7rem; font: inherit; cursor: pointer; }

/* ── User pins (Ctrl + click) ── */
.upin-hint {
  position: fixed; left: 50%; bottom: 2rem; transform: translateX(-50%); z-index: 99;
  padding: 0.4rem 0.9rem; border-radius: 999px; white-space: nowrap; max-width: calc(100vw - 12rem);
  overflow: hidden; text-overflow: ellipsis;
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 92%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent-color) 60%, transparent);
  color: var(--text-color, #c9d1d9); font-size: 0.82rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.upin-hint[hidden] { display: none; }
/* Never on top of the offline strip, which owns the same bottom-centre spot. */
body:has(.draft-offline-strip:not([hidden])) .upin-hint { bottom: 4.75rem; }
body.upin-armed section[data-screen][data-screen-active="true"],
body.upin-armed section[data-screen][data-screen-active="true"] * { cursor: crosshair !important; }
.upin-host { position: relative; }
.upin-layer { position: absolute; inset: 0; pointer-events: none; z-index: 30; }
.upin {
  --upin-color: #f78166;
  position: absolute; left: var(--upin-x); top: var(--upin-y);
  transform: translate(-4px, -100%); pointer-events: auto;
}
.upin-pin {
  width: 26px; height: 26px; padding: 0; border-radius: 50% 50% 50% 4px;
  border: 0; background: var(--upin-color); color: #0d1117;
  font: 800 0.78rem/1 system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--upin-color) 30%, transparent), 0 6px 16px rgba(0, 0, 0, 0.4);
}
.upin-pin:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
.upin-editor {
  position: absolute; left: 32px; top: 0; width: min(280px, 70vw);
  padding: 0.6rem 0.7rem; border-radius: 12px; box-sizing: border-box;
  background: var(--panel-bg, #161b22); color: var(--text-color, #e6edf3);
  border: 1px solid var(--upin-color); box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
  cursor: auto;
}
.upin[data-flip-x="true"] .upin-editor { left: auto; right: 32px; }
.upin[data-flip-y="true"] .upin-editor { top: auto; bottom: 30px; }
.upin-editor[hidden] { display: none; }
.upin-editor-head { font-size: 0.72rem; color: var(--text-secondary, #8b949e); margin-bottom: 0.35rem; }
.upin-editor textarea {
  width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical;
  padding: 0.45rem; border-radius: 8px; font: inherit; font-size: 0.85rem;
  background: var(--input-bg, #0d1117); color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d);
}
.upin-editor-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.35rem; font-size: 0.72rem; color: var(--text-secondary, #8b949e); }
.upin-delete { border: 0; background: transparent; color: var(--danger-color, #f85149); font: inherit; font-size: 0.75rem; cursor: pointer; padding: 0; }
/* One focus ring for every control of this chrome (R0/R4a). */
.design-header button:focus-visible, .design-quick button:focus-visible,
.design-ov button:focus-visible, .design-keys button:focus-visible,
.upin-editor button:focus-visible, .upin-editor textarea:focus {
  outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px;
}
.upin-editor textarea:focus { outline-offset: 0; }
@media (prefers-reduced-motion: reduce) {
  .design-ov-card, .design-header, .design-quick { transition: none; }
}
```
