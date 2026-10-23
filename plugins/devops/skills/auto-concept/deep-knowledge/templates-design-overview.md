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
  `concept-build.js bake`): the overlay star and the header show the
  favourite, the pins render read-only, nothing can be changed.
- **Favourite only for alternatives.** ☆/★, `F`, the header ★ and the
  favourite dimming exist only while the iteration carries
  `data-design-set="alternatives"` (`favOn()`); unmarked or `topics` → no
  star anywhere and `designOverviewState().favorite` is always `null`.
- **Carousel.** The overview is one slide per design plus a trailing
  questions slide (`section[data-view]`s). The current slide sits large in
  the centre; its neighbours peek in cut off at the edges (`data-pos`
  `prev` / `next`, dimmed). A click on a neighbour or
  `←` / `→` only turns the carousel (no ‹ › buttons); the centre preview opens its design
  (click / `Enter`). Everything is sized from the viewport (CSS container
  units on the stage), so the overview never scrolls.
- **Overlay** on the current preview: kicker `icon · N · name` (+ ☆/★),
  motto, the three traits. Anchor from `data-design-overlay`
  (`tl|tr|bl|br|tc|bc`, default `bl`), tint from
  `data-design-overlay-tone="warm"`. The header's layers button hides /
  shows it (Space is the notes dock); the choice is a per-viewer
  convenience in localStorage (`concept-ov-overlay:<path>`). A variant new
  or changed this round carries ONE chip in this box ("Neugedacht" /
  "Verbessert").
- **Preview fit** is measured through no ancestor transform (`fitPreviews()`
  divides by the wrap's ancestor scale — a side card's rects read at its
  `scale(.74)` made the fit too large and cropped the real content).
- **Previews** are clones of each design's first screen (`prefixClone`-style
  id namespacing, every `data-comment` / `data-field` / `data-screen-link` /
  `data-tip` stripped, `inert`, inside `[data-device-clone]` so neither
  `saveState()` nor `collectAllFormFields()` sees a cloned control).
- **Quick-nav band.** The quick nav is centred; its `max-width` is measured
  against the header's real right edge and the ☰ FAB on every render, so the
  two never overlap. Too little room → pages fold into the "2 / 7 ▾" chip,
  then (overview / view) the designs shrink to their icons.
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
    favUnset: '{{design.favorite_unset}}',
    hintSet: '{{design.favorite_hint_set}}', next: '{{design.next_screen}}',
    chNew: '{{design.change_new}}', chChanged: '{{design.change_changed}}',
    chSame: '{{design.change_same}}', chPreview: '{{design.change_preview}}',
    chDot: '{{design.change_dot}}',
    qLabel: '{{design.questions}}', qOpen: '{{design.questions_open}}',
    qProgress: '{{design.questions_progress}}', qAllDone: '{{design.questions_all_done}}',
    qSubmit: '{{design.questions_submit_hint}}', qJump: '{{design.questions_jump}}',
    qOpen1: '{{design.questions_open_one}}', qSubmit1: '{{design.questions_submit_hint_one}}',
    pagesOf: '{{design.pages_of}}',
    keysTitle: '{{design.keys_title}}', keysDesign: '{{design.keys_design}}',
    keysView: '{{design.keys_view}}', keysNext: '{{design.keys_next}}',
    keysRound: '{{design.keys_round}}', keysNotes: '{{design.keys_notes}}',
    keysPin: '{{design.keys_pin}}', keysClick: '{{design.keys_click}}',
    keysClose: '{{design.keys_close}}', ctrl: '{{design.key_ctrl}}',
    upinHint: '{{design.upin_hint}}', upinArm: '{{design.upin_arm}}',
    upinTap: '{{design.upin_tap_hint}}', upinPlaceholder: '{{design.upin_placeholder}}',
    upinKeys: '{{design.upin_keys}}', upinDelete: '{{design.upin_delete}}',
    upinLabel: '{{design.upin_label}}', submit: '{{panel.submit_iterate}}',
    views: '{{design.nav_views_heading}}', anno: '{{anno.toggle_hide}}',
    prev: '{{design.overview_prev}}', nextDesign: '{{design.overview_next}}',
    countPlain: '{{design.overview_count_plain}}', overlay: '{{design.overview_overlay}}',
    keysCarousel: '{{design.keys_carousel}}', keysOverlay: '{{design.keys_overlay}}',
    space: '{{design.key_space}}', chRethought: '{{design.change_rethought}}',
    chImproved: '{{design.change_improved}}', keysDock: '{{design.keys_dock}}',
    keysLevel: '{{design.keys_level}}'
  };
  // Never the accent blue: the icons are drawn in it (one uniform tint), the
  // background must stay distinguishable (§ Variant overview — authoring).
  const OV_ANCHORS = new Set(['tl', 'tr', 'bl', 'br', 'tc', 'bc']);
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
  // The page builds itself up in stages on load (CSS § Intro): content,
  // header, quick nav, then the FABs. The class goes again afterwards, so
  // a later tab switch or display toggle never replays it.
  // Staged entrance: the header islands, the quick nav and the FABs come LAST
  // and only on the very first open of this page in this browser (later
  // opens keep them in place); then the glow pulses once. A new round pulses
  // the glow too (see the round handler below).
  let firstOpen = true;
  try {
    const seenKey = 'concept-chrome-seen:' + location.pathname;
    firstOpen = !localStorage.getItem(seenKey);
    if (typeof _guardedSetItem === 'function') _guardedSetItem(seenKey, '1');
  } catch (e) { /* private mode: treat as first open, harmless */ }
  const pulseChromeGlow = () => {
    body.classList.add('chrome-glow');
    setTimeout(() => body.classList.remove('chrome-glow'), 3200);
  };
  window.pulseChromeGlow = pulseChromeGlow;
  body.classList.add('dz-intro');
  if (firstOpen) body.classList.add('dz-intro-first');
  setTimeout(() => {
    body.classList.remove('dz-intro', 'dz-intro-first');
    if (firstOpen) pulseChromeGlow();
  }, firstOpen ? 3000 : 2200);
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
      color: (d.dataset.designColor || '').trim() || PALETTE[idx % PALETTE.length],
      // Overlay anchor + tint, authored per design (§ Variant overview —
      // authoring); anything else falls back to bottom-left, bluish.
      anchor: OV_ANCHORS.has(d.dataset.designOverlay) ? d.dataset.designOverlay : 'bl',
      tone: d.dataset.designOverlayTone === 'warm' ? 'warm' : ''
    };
  }
  // A view's short nav title — the layout's viewNavTitle() (§ Views
  // (optional) → Nav title); the full question stays in the tooltip.
  const viewTitle = v => (typeof window.viewNavTitle === 'function'
    ? window.viewNavTitle(v) : (v.dataset.navLabel || v.dataset.view));
  function setTip(node, label, key) {
    node.dataset.tip = label;
    node.dataset.tipTier = 'info';
    if (key) {
      node.dataset.tipKey = key;
      node.setAttribute('aria-keyshortcuts', key.replace('⇧', 'Shift').replace(L.ctrl, 'Control'));
    }
  }

  // Quick-nav controls act on pointerdown, not on click. A click needs the
  // SAME node under pointerdown and pointerup, and the quick nav is rebuilt
  // (renderQuick: innerHTML = '') whenever a panel / dock closes or an
  // answer flips — a blur / change between the two events swallowed the
  // first click (the "needs two clicks" bug). The click listener stays for
  // the keyboard (Enter / Space on a focused button) and is skipped when
  // the pointerdown already acted.
  function press(node, fn) {
    let at = 0;
    node.addEventListener('pointerdown', e => {
      if (e.button > 0 || e.isPrimary === false) return;
      at = Date.now();
      fn(e);
    });
    node.addEventListener('click', e => {
      if (at && Date.now() - at < 900) { at = 0; return; }
      fn(e);
    });
  }
  const roman = n => (typeof window.romanNumeral === 'function' ? window.romanNumeral(n) : String(n));

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
  // The favourite exists only where the designs are alternatives for the
  // same thing: `data-design-set="alternatives"` on the iteration. Unmarked
  // or `topics` → no ☆/★, no F, no header ★, no dimming, payload null.
  const favOn = it => !!(it && it.dataset.designSet === 'alternatives' && designsOf(it).length >= 2);
  window.designOverviewState = function(it) {
    const r = it || document.querySelector('section[data-iteration][data-active]');
    const st = readState(r);
    st.favorite = validFavorite(r, st);
    return st;
  };
  function validFavorite(it, st) {
    return favOn(it) && st.favorite && designsOf(it).some(d => d.dataset.design === st.favorite) ? st.favorite : null;
  }
  function toggleFavorite(designId) {
    const it = visibleIteration();
    if (!isLive(it) || !favOn(it) || body.classList.contains('viewing-frozen') || !designId) return;
    const st = readState(it);
    st.favorite = validFavorite(it, st) === designId ? null : designId;
    writeState(it, st);
  }

  // ── Round changes: what this round changed against the one before ──────
  // Design and screen ids repeat across rounds (templates-design.md § Views
  // (optional)), so a screen is matched by id inside the same design of the
  // nearest earlier design round and compared by a markup signature that
  // ignores what the build or the runtime toggles (ids, hidden / disabled /
  // readonly / checked, data-*, aria-*) and every overlay layer. A screen
  // new to its design counts as changed; a design new to the round is "new"
  // as a whole. Round 1 has nothing to compare against: no marks at all.
  const SIG_SKIP = /^(id|name|for|hidden|disabled|readonly|checked|selected|tabindex|inert|title|role|data-.*|aria-.*)$/;
  const SIG_DROP = '[data-anno-layer], .device-stage, .upin-layer, .upin, script, template, textarea';
  const sigCache = new WeakMap();
  function signature(sec) {
    if (sigCache.has(sec)) return sigCache.get(sec);
    const parts = [];
    const walk = n => {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t) parts.push('"' + t);
        return;
      }
      if (n.nodeType !== 1 || n.matches(SIG_DROP)) return;
      const attrs = [...n.attributes].map(a => a.name).filter(k => !SIG_SKIP.test(k)).sort()
        .map(k => k + '=' + (k === 'class'
          ? [...n.classList].filter(c => !/^upin/.test(c)).sort().join(' ') : n.getAttribute(k)));
      parts.push('<' + n.localName + ' ' + attrs.join(' '));
      n.childNodes.forEach(walk);
      parts.push('>');
    };
    sec.childNodes.forEach(walk);
    const s = parts.join('');
    sigCache.set(sec, s);
    return s;
  }
  function previousDesignRound(it) {
    const n = Number(it && it.dataset.iteration);
    let best = null;
    document.querySelectorAll('section[data-iteration]').forEach(s => {
      const k = Number(s.dataset.iteration);
      if (k < n && designsOf(s).length && (!best || k > Number(best.dataset.iteration))) best = s;
    });
    return best;
  }
  const changeCache = new WeakMap();
  function changesOf(it) {
    if (!it) return null;
    if (changeCache.has(it)) return changeCache.get(it);
    const prev = previousDesignRound(it);
    let out = null;
    if (prev) {
      out = { round: Number(it.dataset.iteration), designs: {} };
      designsOf(it).forEach(d => {
        const id = d.dataset.design;
        const old = designsOf(prev).find(x => x.dataset.design === id);
        const entry = { isNew: !old, screens: [] };
        if (old) d.querySelectorAll('section[data-screen][id]').forEach(sec => {
          const was = old.querySelector(`section[data-screen][id="${CSS.escape(sec.id)}"]`);
          if (!was || signature(was) !== signature(sec)) entry.screens.push(sec.id);
        });
        out.designs[id] = entry;
      });
    }
    changeCache.set(it, out);
    return out;
  }
  window.designRoundChanges = changesOf;

  // "Something new here" dots on every menu entry that leads to a changed
  // page, until the user has opened that page once. Seen pages are a
  // per-viewer convenience: localStorage, keyed by page and round, never
  // persisted anywhere Claude reads.
  const SEEN_KEY = 'concept-seen:' + location.pathname;
  function seenSet() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); }
  }
  function markSeen(keys) {
    const s = seenSet();
    const fresh = keys.filter(k => !s.has(k));
    if (!fresh.length) return;
    fresh.forEach(k => s.add(k));
    if (typeof _guardedSetItem === 'function') _guardedSetItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
  }
  function unseenOf(it) {
    const ch = isLive(it) ? changesOf(it) : null;
    const seen = seenSet();
    const screens = id => {
      const e = ch && ch.designs[id];
      return e && !e.isNew ? e.screens.filter(s => !seen.has(ch.round + '/' + id + '/' + s)) : [];
    };
    const design = id => {
      const e = ch && ch.designs[id];
      if (!e) return false;
      return e.isNew ? !seen.has(ch.round + '/' + id + '/*') : screens(id).length > 0;
    };
    return { screens, design };
  }
  function setDot(node, show) {
    if (!node) return;
    let dot = node.querySelector(':scope > .dz-new-dot');
    if (show && !dot) {
      dot = el('span', 'dz-new-dot');
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', L.chDot);
      node.appendChild(dot);
    } else if (!show && dot) dot.remove();
    if (show) node.dataset.changed = 'true'; else delete node.dataset.changed;
  }
  function paintChanges(it) {
    const u = unseenOf(it);
    document.querySelectorAll('#screen-nav .screen-nav-design-heading').forEach(h => setDot(h, u.design(h.dataset.designId)));
    document.querySelectorAll('#screen-nav .screen-nav-item').forEach(b =>
      setDot(b, u.screens(b.dataset.designId).includes(b.dataset.screenId)));
  }
  function noteVisit(it) {
    if (!isLive(it) || mode() !== 'design') return;
    const ch = changesOf(it);
    const d = activeDesignOf(it);
    const sec = activeScreenOf(d);
    if (!ch || !d || !sec) return;
    markSeen([ch.round + '/' + d.dataset.design + '/' + sec.id, ch.round + '/' + d.dataset.design + '/*']);
  }

  // ── Overview previews ──────────────────────────────────────────────────
  function cloneScreen(first, prefix) {
    const wrap = el('div', 'design-ov-scale');
    wrap.dataset.deviceClone = 'overview';
    wrap.setAttribute('inert', '');
    wrap.setAttribute('aria-hidden', 'true');
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
  // ── Overview carousel ──────────────────────────────────────────────────
  // One slide per design, the questions as the last slide. The current one
  // sits large in the centre, its neighbours peek in at the edges. A click
  // on a neighbour (or an arrow, ← / →) only turns the carousel; the centre
  // preview opens its design. No page chips, no notes row, no second
  // navigation: the pages live in the quick nav.
  let ovIndex = 0;
  const slidesOf = it => { const ov = overviewOf(it); return ov ? [...ov.querySelectorAll('.design-ov-slide')] : []; };
  function wireSlide(slide, onOpen) {
    // Capture: a neighbour swallows the click before any control inside it.
    slide.addEventListener('click', e => {
      if (slide.dataset.pos === 'cur') return;
      e.preventDefault();
      e.stopPropagation();
      goSlide(slidesOf(visibleIteration()).indexOf(slide));
    }, true);
    if (onOpen) slide.addEventListener('click', e => {
      if (slide.dataset.pos === 'cur' && !(e.target.closest && e.target.closest('button'))) onOpen();
    });
  }
  function buildSlide(it, d, m) {
    const slide = el('article', 'design-ov-slide');
    slide.dataset.designId = m.id;
    slide.dataset.anchor = m.anchor;
    slide.style.setProperty('--dz-color', m.color);
    const preview = el('div', 'design-ov-preview');
    preview.setAttribute('role', 'button');
    preview.tabIndex = -1;
    preview.setAttribute('aria-label', L.open + ': ' + m.label);
    preview.setAttribute('aria-keyshortcuts', String(m.n));
    // An unchanged first page would show the same picture round after round
    // while the change sits on page 4: the preview then shows the first
    // CHANGED page, and opening the slide lands there too.
    const screens = [...d.querySelectorAll('section[data-screen][id]')];
    const ch = changesOf(it);
    const delta = ch && ch.designs[m.id];
    let shown = screens[0] || d.querySelector('section[data-screen]');
    if (delta && !delta.isNew && delta.screens.length && shown && !delta.screens.includes(shown.id)) {
      shown = screens.find(s => s.id === delta.screens[0]) || shown;
    }
    const open = () => (shown && shown !== screens[0] ? window.showDesign(m.id, shown.id) : window.showDesign(m.id));
    preview.appendChild(cloneScreen(shown, 'ov' + m.n + '-'));
    // "Open ↗" shows on hover / focus only — at rest the preview is a still.
    // The hotkey belongs to THIS button: shown on a long hover of it or while
    // Alt is held (body.hk-alt), never as a tooltip over the centre nav.
    const openBtn = el('span', 'design-ov-open', L.open + ' ↗');
    openBtn.appendChild(el('kbd', 'app-kbd design-ov-open-key', String(m.n)));
    preview.appendChild(openBtn);
    // ONE chip, merged into the info box below: "Neugedacht" (new variant)
    // or "Verbessert" (changed this round); an unchanged variant gets none.
    const kind = delta ? (delta.isNew ? 'new' : delta.screens.length ? 'changed' : 'same') : '';
    if (kind) slide.dataset.change = kind;
    preview.addEventListener('keydown', e => {
      if (e.key === 'Enter' && slide.dataset.pos === 'cur') { e.preventDefault(); open(); }
    });
    slide.appendChild(preview);
    // Overlay: kicker (icon · N · name + ☆/★), motto, three traits — at the
    // anchor the author picked, in the tint the author picked.
    const ov = el('div', 'design-ov-overlay');
    ov.dataset.anchor = m.anchor;
    if (m.tone) ov.dataset.tone = m.tone;
    if (kind === 'new' || kind === 'changed') {
      const chip = el('span', 'design-ov-change', kind === 'new' ? L.chRethought : L.chImproved);
      chip.dataset.kind = kind;
      ov.appendChild(chip);
    }
    const kick = el('div', 'design-ov-kicker');
    kick.append(iconEl(m.icon, { color: m.color }), el('span', 'design-ov-num', String(m.n)), el('span', 'design-ov-name', m.label));
    const star = el('button', 'design-ov-star');
    star.type = 'button';
    star.dataset.designId = m.id;
    star.hidden = true;
    star.setAttribute('aria-pressed', 'false');
    star.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(m.id); });
    kick.appendChild(star);
    ov.appendChild(kick);
    if (m.motto) ov.appendChild(el('h3', 'design-ov-motto', m.motto));
    if (m.traits.length) {
      const ul = el('ul', 'design-ov-traits');
      m.traits.forEach(t => ul.appendChild(el('li', '', t)));
      ov.appendChild(ul);
    }
    slide.appendChild(ov);
    wireSlide(slide, open);
    return slide;
  }
  function buildQuestionsSlide() {
    const slide = el('article', 'design-ov-slide design-ov-qslide');
    slide.dataset.questions = 'true';
    slide.setAttribute('aria-label', L.qLabel);
    slide.appendChild(el('div', 'design-ov-qcard'));
    wireSlide(slide, null);
    return slide;
  }
  // Places every slide relative to the current one (`--dz-off`, `data-pos`).
  // Three or more slides wrap around (the questions peek in left of design
  // 1); two stay linear. Only the current slide's controls are tabbable.
  function layoutCarousel(it) {
    const ov = overviewOf(it || visibleIteration());
    if (!ov) return;
    const slides = [...ov.querySelectorAll('.design-ov-slide')];
    const n = slides.length;
    if (!n) return;
    ovIndex = ((ovIndex % n) + n) % n;
    slides.forEach((s, i) => {
      let off = i - ovIndex;
      if (n >= 3) { if (off > n / 2) off -= n; else if (off <= -n / 2) off += n; }
      s.style.setProperty('--dz-off', String(off));
      s.dataset.pos = off === 0 ? 'cur' : off === -1 ? 'prev' : off === 1 ? 'next' : 'far';
      s.setAttribute('aria-hidden', String(off !== 0));
      s.querySelectorAll('button, .design-ov-preview').forEach(b => { b.tabIndex = off === 0 ? 0 : -1; });
    });
    ov.dataset.index = String(ovIndex);
  }
  function goSlide(i) {
    const it = visibleIteration();
    if (i < 0 && slidesOf(it).length) i = (i % slidesOf(it).length) + slidesOf(it).length;
    const hadFocus = !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.design-ov-slide'));
    ovIndex = i;
    layoutCarousel(it);
    if (hadFocus) overviewOf(it)?.querySelector('.design-ov-slide[data-pos="cur"] .design-ov-preview, .design-ov-slide[data-pos="cur"] button')?.focus();
  }
  const stepSlide = dir => goSlide(ovIndex + dir);
  window.designOverviewGo = goSlide;
  // Arriving on the overview centres the design the user came from.
  document.addEventListener('overview:changed', () => {
    if (mode() !== 'overview') return;
    const it = visibleIteration();
    const d = activeDesignOf(it);
    const i = d ? slidesOf(it).findIndex(s => s.dataset.designId === d.dataset.design) : -1;
    if (i >= 0) ovIndex = i;
    layoutCarousel(it);
    const ov = overviewOf(it);
    if (ov) {
      ov.dataset.enter = 'true';
      clearTimeout(ov._enterTimer);
      ov._enterTimer = setTimeout(() => { ov.dataset.enter = 'false'; }, 1600);
    }
  });

  // Overlay on / off (Space, header button). A per-viewer convenience like
  // the seen pages: localStorage only, never persisted anywhere Claude reads.
  const OVERLAY_KEY = 'concept-ov-overlay:' + location.pathname;
  let overlayShown = (() => { try { return localStorage.getItem(OVERLAY_KEY) !== 'off'; } catch (e) { return true; } })();
  function paintOverlay() {
    document.querySelectorAll('.design-ov').forEach(o => { o.dataset.overlay = overlayShown ? 'on' : 'off'; });
    if (H.overlay) H.overlay.setAttribute('aria-pressed', String(overlayShown));
  }
  function setOverlay(v) {
    overlayShown = !!v;
    const val = overlayShown ? 'on' : 'off';
    if (typeof _guardedSetItem === 'function') _guardedSetItem(OVERLAY_KEY, val);
    paintOverlay();
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
    H.back.addEventListener('click', () => window.showOverview());
    H.sep = el('span', 'design-header-sep');
    H.iconSlot = el('span', 'design-header-icon');
    H.name = el('strong', 'design-header-name');
    // The star is a control like the eye and the pin next to it: on a design
    // page it toggles that design's favourite (☆ / ★, same as F); on the
    // overview "★ <name>" opens the favourite.
    H.star = el('button', 'design-header-star');
    H.star.type = 'button';
    H.star.addEventListener('click', () => {
      const it = visibleIteration();
      if (mode() === 'overview') {
        const fav = validFavorite(it, readState(it));
        if (fav) window.showDesign(fav);
        return;
      }
      const d = activeDesignOf(it);
      if (d) toggleFavorite(d.dataset.design);
    });
    H.eye = el('span', 'design-header-eye');
    // No 📍 pin-hint in the header any more: Ctrl + click is taught by the Alt
    // example pin and the dock tips.
    H.pin = null;
    // Overlay toggle: the touch path of Space, shown on the overview only.
    H.overlay = el('button', 'design-header-overlay');
    H.overlay.type = 'button';
    H.overlay.setAttribute('aria-pressed', String(overlayShown));
    H.overlay.setAttribute('aria-label', L.overlay);
    H.overlay.appendChild(svgFromPaths(ICONS.layers));
    setTip(H.overlay, L.overlay, L.space);
    H.overlay.setAttribute('aria-keyshortcuts', 'Space');
    H.overlay.addEventListener('click', () => setOverlay(!overlayShown));
    // Icon + name sit in one pill, the same shape as the active quick-nav
    // segment, so the header reads as "this variant", not as loose text.
    H.pill = el('span', 'design-header-title');
    H.pill.append(H.iconSlot, H.name);
    H.main.append(H.back, H.sep, H.pill, H.star, H.eye, H.overlay);
    // One row only: pages live in the quick nav, the favourite on ★ — the
    // header never grows a second row over the content.
    header.append(H.main);
  }

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

  // ── Questions (views) ──────────────────────────────────────────────────
  // A question view counts as answered once the user left anything in it: a
  // note (inline or in the dock) or a bi-state they actually clicked
  // (`data-touched`, set by the change listener of § Submit). The default
  // "include" alone is not an answer.
  function viewAnswered(v) {
    if (v.dataset.interacted === 'true') return true;
    const filled = ta => !!(ta && (ta.value || '').trim());
    if ([...v.querySelectorAll('textarea')].some(filled)) return true;
    if (v.querySelector('input[data-touched]')) return true;
    return filled(document.querySelector(`#feedback-dock [data-view-comment="${CSS.escape(v.dataset.view)}"]`));
  }
  function questionsOf(it) {
    return viewsOf(it).map(v => ({ v, id: v.dataset.view, title: viewTitle(v), done: viewAnswered(v) }));
  }
  window.designOpenQuestions = it => questionsOf(it || visibleIteration()).filter(q => !q.done);
  function goQuestion(id) {
    if (typeof closePanel === 'function') closePanel();
    window.showView(id);
  }
  function progressBar(done, total) {
    const bar = el('div', 'design-quick-qbar');
    const fill = el('i');
    fill.style.width = (total ? Math.round((done / total) * 100) : 100) + '%';
    bar.appendChild(fill);
    return bar;
  }
  function questionItem(q, onPick) {
    const item = el('button', 'design-quick-qitem');
    item.type = 'button';
    item.dataset.done = String(q.done);
    item.append(el('span', 'design-quick-qstate', q.done ? '✓' : ''), el('span', 'design-quick-qtitle', q.title));
    item.addEventListener('click', onPick);
    return item;
  }

  // ── Quick nav ──────────────────────────────────────────────────────────
  // One row: the designs, then the questions. On a design page the active
  // design fans its pages out inside its own segment and every other design
  // shrinks to its icon (name in the tooltip); on the overview and on a
  // question view every design keeps its name and no pages show. When the
  // row does not fit between the header and the ☰ FAB, the pages fold into
  // one "2 / 7 ▾" chip that opens downwards. The questions segment counts the
  // unanswered views and carries their list as a tab hanging off it.
  // 0 = everything named, 1 = the active design's pages folded into the
  // "2 / 7 ▾" chip, 2 = every design an icon (overview / view).
  let quickLevel = 0;
  const quickCompact = () => quickLevel > 0;
  // The quick nav is centred; its band ends a gap before the header's REAL
  // right edge and before the ☰ FAB. Offsets, not getBoundingClientRect():
  // the intro animation translates / scales both, a rect read mid-animation
  // would size the band wrong for good.
  function fitQuickBand() {
    const vw = document.documentElement.clientWidth || window.innerWidth || 0;
    if (!vw || !quick) return;
    const GAP = 12;
    let half = vw / 2;
    if (header && header.offsetWidth) half = Math.min(half, vw / 2 - (header.offsetLeft + header.offsetWidth) - GAP);
    const fab = document.querySelector('.panel-fab');
    if (fab && fab.offsetWidth) half = Math.min(half, fab.offsetLeft - vw / 2 - GAP);
    quick.style.maxWidth = Math.max(0, Math.floor(2 * half)) + 'px';
  }
  function quickSeg(m, named, u, fav) {
    const seg = el('button', 'design-quick-seg');
    seg.type = 'button';
    seg.dataset.designId = m.id;
    seg.style.setProperty('--dz-color', m.color);
    if (!named) seg.dataset.iconOnly = 'true';
    seg.appendChild(iconEl(m.icon, { color: m.color }));
    seg.appendChild(el('span', 'design-quick-name', m.label));
    if (fav === m.id) seg.appendChild(el('span', 'design-quick-star', '★'));
    setTip(seg, m.label, m.n <= 9 ? String(m.n) : '');
    press(seg, () => { if (typeof closePanel === 'function') closePanel(); showDesignAligned(m.id); });
    if (u) setDot(seg, u.design(m.id));
    return seg;
  }
  function quickGroup(d, m, u, fav) {
    const g = el('span', 'design-quick-group');
    g.style.setProperty('--dz-color', m.color);
    const head = quickSeg(m, true, null, fav);
    head.dataset.active = 'true';
    g.appendChild(head);
    const screens = [...d.querySelectorAll('section[data-screen][id]')];
    if (screens.length < 2) return g;
    const cur = activeScreenOf(d);
    const idx = screens.indexOf(cur);
    const fresh = u.screens(m.id);
    g.appendChild(el('span', 'design-quick-sep'));
    const pageBtn = (sec, i, cls) => {
      const b = el('button', cls);
      b.type = 'button';
      b.dataset.screenId = sec.id;
      b.dataset.active = String(sec === cur);
      b.append(el('span', 'design-quick-num', roman(i + 1)), el('span', 'design-quick-name', sec.dataset.navLabel || sec.id));
      setDot(b, fresh.includes(sec.id));
      setTip(b, sec.dataset.navLabel || sec.id, sec !== cur && i === (idx + 1) % screens.length ? 'Tab' : '');
      press(b, () => {
        if (typeof closePanel === 'function') closePanel();
        window.showScreen(sec.id);
      });
      return b;
    };
    if (!quickCompact()) {
      screens.forEach((sec, i) => g.appendChild(pageBtn(sec, i, 'design-quick-page')));
      return g;
    }
    const wrap = el('span', 'design-quick-morewrap');
    const chip = el('button', 'design-quick-more');
    chip.type = 'button';
    chip.setAttribute('aria-haspopup', 'true');
    chip.setAttribute('aria-expanded', 'false');
    chip.append(el('span', '', (idx + 1) + ' / ' + screens.length), el('span', 'design-quick-caret', '▾'));
    setDot(chip, fresh.length > 0);
    setTip(chip, L.pagesOf.replace('{label}', m.label));
    chip.addEventListener('click', () => {
      wrap.dataset.open = wrap.dataset.open === 'true' ? 'false' : 'true';
      chip.setAttribute('aria-expanded', wrap.dataset.open);
    });
    const list = el('div', 'design-quick-vlist');
    list.setAttribute('role', 'menu');
    screens.forEach((sec, i) => {
      const b = pageBtn(sec, i, 'design-quick-vitem');
      b.setAttribute('role', 'menuitem');
      list.appendChild(b);
    });
    wrap.append(chip, list);
    g.appendChild(wrap);
    return g;
  }
  // "Fragen" is one segment, no "?" mark, no submenu. One question: it opens
  // directly. Several: a click opens the first open one, a click while inside
  // the questions opens the next open one (wrapping; all answered -> the
  // questions in order).
  function nextQuestion(it) {
    const qs = questionsOf(it);
    if (!qs.length) return null;
    const open = qs.filter(q => !q.done);
    const pool = open.length ? open : qs;
    if (pool.length === 1) return pool[0];
    const cur = mode() === 'view' ? it.querySelector(':scope > section[data-view][data-view-active="true"]') : null;
    const at = cur ? qs.findIndex(q => q.v === cur) : -1;
    for (let i = 1; i <= qs.length; i++) {
      const cand = qs[(at + i + qs.length) % qs.length];
      if (pool.includes(cand)) return cand;
    }
    return pool[0];
  }
  window.designNextQuestion = () => { const q = nextQuestion(visibleIteration()); if (q) goQuestion(q.id); return q ? q.id : null; };
  function quickQuestions(it, qs, md) {
    const open = qs.filter(q => !q.done);
    const wrap = el('span', 'design-quick-qwrap');
    const btn = el('button', 'design-quick-q');
    btn.type = 'button';
    btn.dataset.state = open.length ? 'open' : 'done';
    const viewOn = md === 'view' ? it.querySelector(':scope > section[data-view][data-view-active="true"]') : null;
    btn.dataset.active = String(!!viewOn);
    btn.appendChild(el('span', 'design-quick-name', L.qLabel));
    btn.appendChild(open.length ? el('span', 'design-quick-badge', String(open.length)) : el('span', 'design-quick-qok', '✓'));
    setTip(btn, open.length ? (open.length === 1 ? L.qOpen1 : L.qOpen.replace('{n}', String(open.length))) : L.qAllDone);
    press(btn, () => { const q = nextQuestion(visibleIteration()); if (q) goQuestion(q.id); });
    wrap.append(btn);
    return wrap;
  }
  function renderQuick(it) {
    if (!quick) return;
    quick.innerHTML = '';
    if (!it || !metas.length) return;
    const md = mode();
    const d = md === 'design' ? activeDesignOf(it) : null;
    const u = unseenOf(it);
    const fav = validFavorite(it, readState(it));
    const row = el('div', 'design-quick-row design-quick-designs');
    metas.forEach(m => {
      if (d && d.dataset.design === m.id) row.appendChild(quickGroup(d, m, u, fav));
      else row.appendChild(quickSeg(m, md !== 'design' && quickLevel < 2, u, fav));
    });
    const qs = questionsOf(it);
    if (qs.length) row.appendChild(quickQuestions(it, qs, md));
    quick.appendChild(row);
    quick.dataset.compact = String(quickCompact());
    quick.dataset.level = String(quickLevel);
    fitQuickBand();
    // Measured right away (the read forces layout): a requestAnimationFrame
    // never fires in a background tab, which left the row overflowing.
    // clientWidth, not the rect: the intro bounce scales the quick nav.
    if (quickLevel < 2 && row.scrollWidth > quick.clientWidth + 1) {
      quickLevel = d && quickLevel === 0 ? 1 : 2;
      renderQuick(it);
    }
  }
  function buildQuick(it) { quickLevel = 0; renderQuick(it); }
  window.addEventListener('resize', () => {
    if (!on()) return;
    quickLevel = 0;
    renderQuick(visibleIteration());
  });
  document.addEventListener('pointerdown', e => {
    document.querySelectorAll('.design-quick-qwrap[data-open="true"], .design-quick-morewrap[data-open="true"]').forEach(w => {
      if (!w.contains(e.target)) w.dataset.open = 'false';
    });
  });
  // Never forget the questions: every arrival on the overview (the boot
  // included) pulses the questions segment while any of them is open.
  document.addEventListener('overview:changed', () => {
    if (mode() !== 'overview') return;
    const q = quick && quick.querySelector('.design-quick-q[data-state="open"]');
    if (!q) return;
    q.dataset.pulse = 'false';
    void q.offsetWidth;
    q.dataset.pulse = 'true';
    q.addEventListener('animationend', () => { q.dataset.pulse = 'false'; }, { once: true });
  });

  // ── Questions slide (overview) + submit hint ────────────────────────────
  function renderQuestionsCard(it) {
    const card = overviewOf(it)?.querySelector('.design-ov-qcard');
    if (!card) return;
    const qs = questionsOf(it);
    const open = qs.filter(q => !q.done);
    card.innerHTML = '';
    card.dataset.state = open.length ? 'open' : 'done';
    const head = el('div', 'design-ov-qhead');
    head.append(el('span', 'design-ov-qmark', '?'), el('strong', '', L.qLabel));
    card.append(head, el('p', 'design-ov-qprogress', open.length
      ? L.qProgress.replace('{done}', String(qs.length - open.length)).replace('{n}', String(qs.length))
      : L.qAllDone), progressBar(qs.length - open.length, qs.length));
    qs.forEach(q => card.appendChild(questionItem(q, () => goQuestion(q.id))));
  }
  function renderSubmitHint(it) {
    const ready = document.getElementById('panel-ready');
    const split = ready && ready.querySelector('.submit-split');
    if (!split) return;
    let hintEl = ready.querySelector('.submit-open-questions');
    const open = on() && isLive(it) && !body.classList.contains('viewing-frozen')
      ? questionsOf(it).filter(q => !q.done) : [];
    if (!open.length) { if (hintEl) hintEl.hidden = true; return; }
    if (!hintEl) {
      hintEl = el('p', 'submit-open-questions');
      ready.insertBefore(hintEl, split);
    }
    hintEl.hidden = false;
    hintEl.textContent = '';
    hintEl.appendChild(el('span', '', '⚠ ' + (open.length === 1 ? L.qSubmit1 : L.qSubmit.replace('{n}', String(open.length))) + ' '));
    const jump = el('button', 'link-btn', L.qJump);
    jump.type = 'button';
    jump.addEventListener('click', () => goQuestion(open[0].id));
    hintEl.appendChild(jump);
  }
  function refreshQuestions() {
    if (!on()) return;
    const it = visibleIteration();
    renderQuick(it);
    renderQuestionsCard(it);
    renderSubmitHint(it);
    layoutCarousel(it);
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
     ['←/→', L.keysCarousel], ['↑/↓', L.keysLevel], [L.space, L.keysDock], ['F', L.fav], ['Alt+1–9', L.keysRound], ['N', L.keysNotes], [L.ctrl + '+Enter', L.submit],
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
    if (!all.length) {
      metas = [];
      if (quick) quick.innerHTML = '';
      placeEye(false);
      disarm();
      return;
    }
    // Header and quick nav on every design round; the overview carousel
    // (and with it Esc-to-overview) only where there is something to
    // compare; the favourite only where the round says they are alternatives.
    metas = all.map(metaOf);
    if (all.length >= 2) {
      ensureStore(it);
      const ov = el('div', 'design-ov');
      ov.dataset.designOverview = '';
      ov.hidden = true;
      ov.setAttribute('role', 'region');
      ov.setAttribute('aria-roledescription', 'carousel');
      ov.setAttribute('aria-label', L.overview);
      ov.dataset.overlay = overlayShown ? 'on' : 'off';
      const stage = el('div', 'design-ov-stage');
      const track = el('div', 'design-ov-track');
      all.forEach((d, i) => track.appendChild(buildSlide(it, d, metas[i])));
      if (viewsOf(it).length) track.appendChild(buildQuestionsSlide());
      stage.appendChild(track);
      ov.appendChild(stage);
      it.insertBefore(ov, all[0]);
      if (ovIndex >= track.children.length) ovIndex = 0;
    }
    buildHeader();
    buildQuick(it);
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
      // Rects are measured through every ancestor transform: a side slide
      // sits at scale(.74), so its content read 26 % smaller and the preview
      // was fitted 26 % too large — cropped to a corner that no longer showed
      // what differs between the variants. k = that ancestor scale.
      const box0 = wrap.getBoundingClientRect();
      const k = wrap.offsetWidth && box0.width ? box0.width / wrap.offsetWidth : 1;
      const origin = box0.left;
      const originTop = box0.top;
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      wrap.querySelectorAll(':scope > *, :scope > * > *').forEach(n => {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return;
        left = Math.min(left, (r.left - origin) / k);
        right = Math.max(right, (r.right - origin) / k);
        top = Math.min(top, (r.top - originTop) / k);
        bottom = Math.max(bottom, (r.bottom - originTop) / k);
      });
      const PAD = 24;
      const content = right > left ? Math.min(1000, right - left + 2 * PAD) : 1000;
      const from = right > left ? Math.max(0, left - PAD) : 0;
      // The carousel preview is large: a desktop mock may grow past 1:1; a
      // narrow (phone) mock is fitted by height too, so it is seen whole.
      let scale = Math.min(2, w / content);
      const h = p.clientHeight;
      if (content < 700 && h > 0 && bottom > top) scale = Math.min(scale, h / (bottom + PAD));
      wrap.style.removeProperty('--dz-ov-scale');
      wrap.style.removeProperty('--dz-ov-x');
      p.style.setProperty('--dz-ov-scale', String(scale));
      p.style.setProperty('--dz-ov-x', ((w - content * scale) / 2 - from * scale).toFixed(1) + 'px');
    });
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitPreviews));
  document.addEventListener('overview:changed', () => requestAnimationFrame(fitPreviews));

  // ── Projection: header, quick nav, carousel, pins ─────────────────────────
  function updateChrome() {
    const it = visibleIteration();
    noteVisit(it);
    paintChanges(it);
    const active = on() && metas.length > 0;
    const hasOverview = !!overviewOf(it);
    placeEye(active);
    const navOv = document.querySelector('#screen-nav .screen-nav-overview-group');
    if (navOv) navOv.hidden = !(active && hasOverview);
    if (!active) { if (hint) hint.hidden = true; renderSubmitHint(it); return; }
    const st = readState(it);
    const fav = validFavorite(it, st);
    const live = isLive(it) && !body.classList.contains('viewing-frozen');
    const md = mode();
    if (navOv) navOv.firstElementChild.dataset.active = String(md === 'overview');
    const d = activeDesignOf(it);
    const m = d && metas.find(x => x.id === d.dataset.design);
    const favMeta = fav && metas.find(x => x.id === fav);
    if (header && H.main) {
      H.back.hidden = md === 'overview' || !hasOverview;
      H.sep.hidden = H.back.hidden;
      H.iconSlot.innerHTML = '';
      header.style.removeProperty('--dz-color');
      let motto = '';
      if (md === 'overview') {
        H.iconSlot.appendChild(iconEl('grid'));
        H.name.textContent = L.overview;
        H.star.textContent = favMeta ? '★ ' + favMeta.label : '';
        // Only the alternatives round invites a favourite.
        H.star.dataset.kind = 'label';
        H.star.disabled = false;
        H.star.removeAttribute('aria-pressed');
        if (favMeta) setTip(H.star, L.open + ': ' + favMeta.label);
        motto = (favOn(it) ? L.count : L.countPlain).replace('{n}', String(metas.length));
      } else if (md === 'view') {
        const v = it.querySelector(':scope > section[data-view][data-view-active="true"]');
        H.iconSlot.appendChild(iconEl('question', { kind: 'plain' }));
        H.name.textContent = v ? viewTitle(v) : '';
        H.star.textContent = '';
      } else if (m) {
        header.style.setProperty('--dz-color', m.color);
        H.iconSlot.appendChild(iconEl(m.icon, { color: m.color }));
        H.name.textContent = m.label;
        const isFav = fav === m.id;
        H.star.textContent = isFav ? '★' : '☆';
        H.star.dataset.kind = 'icon';
        H.star.disabled = !live;
        H.star.setAttribute('aria-pressed', String(isFav));
        H.star.setAttribute('aria-label', isFav ? L.favUnset : L.favSet);
        setTip(H.star, isFav ? L.favUnset : L.favSet, 'F');
        if (!hasOverview || !favOn(it)) H.star.textContent = '';
        motto = m.motto;
      }
      H.star.hidden = !H.star.textContent;
      // The motto is the name's tooltip, not a line of its own.
      if (motto) setTip(H.name, motto);
      else { delete H.name.dataset.tip; delete H.name.dataset.tipTier; }
      H.overlay.hidden = !(md === 'overview' && hasOverview);
      H.overlay.setAttribute('aria-pressed', String(overlayShown));
    }
    renderQuick(it);
    renderQuestionsCard(it);
    renderSubmitHint(it);
    const ov = overviewOf(it);
    if (ov) {
      const favs = favOn(it);
      ov.dataset.favorites = String(favs);
      ov.dataset.hasFavorite = String(!!fav);
      ov.querySelectorAll('.design-ov-slide[data-design-id]').forEach(slide => {
        const isFav = slide.dataset.designId === fav;
        slide.dataset.favorite = String(isFav);
        const btn = slide.querySelector('.design-ov-star');
        btn.hidden = !favs;
        btn.textContent = isFav ? '★' : '☆';
        btn.setAttribute('aria-pressed', String(isFav));
        btn.setAttribute('aria-label', isFav ? L.favUnset : L.favSet);
        btn.disabled = !live;
        setTip(btn, isFav ? L.favUnset : L.favSet, 'F');
      });
      layoutCarousel(it);
      paintOverlay();
    }
    if (md !== 'design' || !live) disarm();
    renderPins(it, st, live);
  }
  window.updateDesignChrome = updateChrome;
  function refresh() { if (on()) updateChrome(); }
  window.refreshDesignOverview = refresh;
  // Answering a question updates badge, list, card and submit hint — but
  // only when an answered state actually flipped, so typing never rebuilds
  // a quick nav the pointer is resting on.
  let answeredKey = '';
  function onAnswerChange() {
    if (!on()) return;
    const key = questionsOf(visibleIteration()).map(q => q.done ? 1 : 0).join('');
    if (key === answeredKey) return;
    answeredKey = key;
    refreshQuestions();
  }
  // Any interaction or scroll inside a question counts as answering it — a
  // mere visit does not. Runtime only; typed notes persist through the fields.
  function markInteracted(e) {
    const v = e.target && e.target.closest && e.target.closest('section[data-view]');
    if (!v || v.dataset.interacted === 'true' || !on()) return;
    v.dataset.interacted = 'true';
    onAnswerChange();
  }
  ['click', 'input', 'change', 'keydown', 'wheel', 'touchmove', 'scroll'].forEach(t =>
    document.addEventListener(t, markInteracted, true));
  document.addEventListener('input', onAnswerChange);
  document.addEventListener('change', () => setTimeout(onAnswerChange, 0));
  document.addEventListener('iteration:changed', () => toggleSheet(false));
  // A NEW round always opens on the overview start page (first card), not
  // where the previous round was left. Per viewer: localStorage remembers the
  // last live round this page showed; the first ever visit restores as usual.
  const ROUND_KEY = 'concept-last-round:' + location.pathname;
  document.addEventListener('iteration:changed', () => {
    setTimeout(() => {
      const it = visibleIteration();
      if (!on() || !isLive(it)) return;
      let last = null;
      const now = String(it.dataset.iteration);
      try { last = localStorage.getItem(ROUND_KEY); } catch (e) { /* private mode */ }
      if (typeof _guardedSetItem === 'function') _guardedSetItem(ROUND_KEY, now);
      if (last && last !== now && overviewOf(it)) { ovIndex = 0; window.showOverview(); layoutCarousel(it); }
      if (last && last !== now) pulseChromeGlow();
    }, 0);
  });

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
    // Setting a new pin closes every other open note first (own editors and
    // annotation bubbles), keeping what was typed in them.
    closeOtherNotes(null);
    draft = {
      id: 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      design: d.dataset.design, screen: screen.id,
      x: pct(e.clientX, r.left, w), y: pct(e.clientY, r.top, h),
      target: describeTarget(e.target, screen), text: ''
    };
    renderPins(it, readState(it), true);
  }, true);
  // Touch path for an own pin: a long-press (~500 ms, no movement) on the
  // content does what Ctrl+click does — it replays a Ctrl+click at that point
  // into the handler above, then swallows the click the lift would fire.
  const LONG_PRESS_MS = 500, LONG_PRESS_SLOP = 10;
  let lp = null, swallowClickUntil = 0;
  function cancelLongPress() { if (lp) { clearTimeout(lp.timer); lp = null; } }
  document.addEventListener('pointerdown', e => {
    cancelLongPress();
    if (e.pointerType === 'mouse' || !e.isPrimary || !on() || mode() !== 'design') return;
    if (e.target.closest('.upin, .anno, .device-stage, button, a, textarea, input, select, #feedback-dock')) return;
    const x = e.clientX, y = e.clientY, target = e.target;
    lp = { x, y, timer: setTimeout(() => {
      lp = null;
      swallowClickUntil = Date.now() + 1500;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true, view: window }));
    }, LONG_PRESS_MS) };
  }, true);
  document.addEventListener('pointermove', e => {
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) cancelLongPress();
  }, true);
  ['pointerup', 'pointercancel', 'scroll'].forEach(t => document.addEventListener(t, cancelLongPress, true));
  document.addEventListener('contextmenu', e => { if (lp || Date.now() < swallowClickUntil) e.preventDefault(); }, true);
  document.addEventListener('click', e => {
    if (e.isTrusted && Date.now() < swallowClickUntil) { swallowClickUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); }
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
  // The editor sits inside the screen, whose frame clips it — a phone mock-up
  // is narrower than pin + editor — so it is placed by measuring: open on the
  // side with room, then clamp it inside the content box.
  function placeEditor(wrap) {
    const ed = wrap.querySelector('.upin-editor');
    const host = wrap.closest('.upin-host');
    if (!ed || ed.hidden || !host) return;
    const b = host.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const gap = 8;
    delete wrap.dataset.flipX;
    delete wrap.dataset.flipY;
    ['left', 'right', 'top', 'bottom', 'width'].forEach(p => { ed.style[p] = ''; });
    if (ed.getBoundingClientRect().width > b.width - 2 * gap) ed.style.width = Math.max(160, b.width - 2 * gap) + 'px';
    let r = ed.getBoundingClientRect();
    if (r.right > b.right - gap) { wrap.dataset.flipX = 'true'; r = ed.getBoundingClientRect(); }
    if (r.left < b.left + gap || r.right > b.right - gap) {
      const left = Math.min(Math.max(r.left, b.left + gap), b.right - gap - r.width);
      ed.style.left = (left - wrap.getBoundingClientRect().left) + 'px';
      ed.style.right = 'auto';
    }
    r = ed.getBoundingClientRect();
    if (r.bottom > b.bottom - gap) { wrap.dataset.flipY = 'true'; r = ed.getBoundingClientRect(); }
    if (r.top < b.top + gap || r.bottom > b.bottom - gap) {
      const top = Math.max(Math.min(r.top, b.bottom - gap - r.height), b.top + gap);
      ed.style.top = (top - wrap.getBoundingClientRect().top) + 'px';
      ed.style.bottom = 'auto';
    }
  }
  // Own pins take attachments like every other note: the textarea carries
  // data-attachable and an .attach-slot, slot key `upin-ta-<pin id>`.
  const upinSlot = id => 'upin-ta-' + id;
  function commitEditor(ed) {
    const wrap = ed.closest('.upin');
    const ta = ed.querySelector('textarea');
    if (!wrap || !ta || ta.readOnly) return;
    const id = wrap.dataset.upinId;
    if (draft && draft.id === id) { if (ta.value.trim()) savePin(draft, ta.value); else draft = null; return; }
    const p = readState(visibleIteration()).pins.find(x => x.id === id);
    if (p && ta.value.trim() !== p.text.trim()) savePin(p, ta.value);
  }
  function closeOtherNotes(except) {
    document.querySelectorAll('.upin-editor').forEach(x => {
      if (x !== except && !x.hidden) { commitEditor(x); x.hidden = true; }
    });
    if (typeof window.closeAnnoBubbles === 'function') window.closeAnnoBubbles();
  }
  function openPinEditor(id) {
    const w = document.querySelector('.upin[data-upin-id="' + CSS.escape(id) + '"]');
    const e = w && w.querySelector('.upin-editor');
    if (!e) return;
    e.hidden = false;
    placeEditor(w);
    w.querySelector('textarea').focus();
  }
  // body[data-note-editing] (hide the others while one note is open) lives in
  // the annotation layer (templates-design-wiring.md) so single-design pages
  // get it too; own-pin editors open here and are picked up by its observer.
  function pinNode(pin, k, live, isDraft) {
    const wrap = el('div', 'upin');
    wrap.dataset.upinId = pin.id;
    wrap.style.setProperty('--upin-x', pin.x + '%');
    wrap.style.setProperty('--upin-y', pin.y + '%');
    const label = L.upinLabel.replace('{n}', String(k));
    const btn = el('button', 'upin-pin');   // no number: bubble + glow only
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = pin.text || label;
    const ed = el('div', 'upin-editor');
    ed.hidden = !isDraft;
    ed.appendChild(el('div', 'upin-editor-head', label));
    const ta = el('textarea');
    ta.id = upinSlot(pin.id);
    ta.setAttribute('data-attachable', '');
    ta.placeholder = L.upinPlaceholder;
    ta.value = pin.text;
    ta.readOnly = !live;
    ta.setAttribute('aria-label', label);
    ed.appendChild(ta);
    const slot = el('div', 'attach-slot');
    slot.dataset.attachSlot = upinSlot(pin.id);
    ed.appendChild(slot);
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
    // The WHOLE pin is the drag handle (a press only becomes a drag after a
    // few px, so a click still opens the note). The spot is stored as percent
    // of the content box, like at placement.
    if (live) btn.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const host = wrap.closest('.upin-host');
      if (!host) return;
      const g = { x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
      const move = ev => {
        if (ev.pointerId !== g.id) return;
        if (!g.moved) {
          if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) < 6) return;
          g.moved = true;
          wrap.dataset.dragging = 'true';
          try { btn.setPointerCapture(ev.pointerId); } catch (err) { /* released */ }
        }
        ev.preventDefault();
        const r = host.getBoundingClientRect();
        if (!r.width || !r.height) return;
        pin.x = Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)) * 10) / 10;
        pin.y = Math.round(Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)) * 10) / 10;
        wrap.style.setProperty('--upin-x', pin.x + '%');
        wrap.style.setProperty('--upin-y', pin.y + '%');
      };
      const up = ev => {
        if (ev.pointerId !== g.id) return;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        delete wrap.dataset.dragging;
        if (!g.moved) return;
        wrap.dataset.justDragged = 'true';
        setTimeout(() => { delete wrap.dataset.justDragged; }, 0);
        if (isDraft) return;   // the draft object already carries the new spot
        const it = visibleIteration();
        const st = readState(it);
        const i = st.pins.findIndex(p => p.id === pin.id);
        if (i >= 0) { st.pins[i].x = pin.x; st.pins[i].y = pin.y; writeState(it, st); }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
    btn.addEventListener('click', () => {
      if (wrap.dataset.justDragged) return;
      const open = ed.hidden;
      closeOtherNotes(ed);
      if (!open) { ed.hidden = true; return; }
      // Committing another editor may have re-rendered the layer.
      if (ed.isConnected) { ed.hidden = false; placeEditor(wrap); ta.focus(); } else openPinEditor(pin.id);
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
    let drafted = null;
    if (showDraft) {
      drafted = pinNode(draft, pins.length + 1, true, true);
      layer.appendChild(drafted.wrap);
    }
    box.appendChild(layer);
    if (typeof initCommentAttachments === 'function') initCommentAttachments();
    if (drafted) { placeEditor(drafted.wrap); drafted.ta.focus(); }
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
    // Space is the notes dock (wireChromeHotkeys, every template). Arrows:
    // left / right = same level, up / down = one level (overview <-> variant).
    if (e.key === 'ArrowUp' && mode() !== 'overview' && overviewOf(it)) {
      e.preventDefault();
      window.showOverview();
      return;
    }
    if (mode() === 'overview' && overviewOf(it)) {
      if (e.key === 'ArrowDown') {
        const cur = overviewOf(it).querySelector('.design-ov-slide[data-pos="cur"]');
        if (!cur) return;
        e.preventDefault();
        if (cur.dataset.designId) cur.querySelector('.design-ov-preview')?.click();
        else window.designNextQuestion();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (slidesOf(it).length < 2) return;
        e.preventDefault();
        stepSlide(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
    }
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
      else if (mode() === 'overview') id = overviewOf(it)?.querySelector('.design-ov-slide[data-pos="cur"]')?.dataset.designId || null;
      if (id && favOn(it)) { e.preventDefault(); toggleFavorite(id); }
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

/* ── Overview: carousel (first top-level item) ──
   Sized from the viewport only: the stage is the viewport minus the
   header / quick-nav row, a slide is min(78 % of the stage width, stage
   height × 1.6) at 16:10 (container units). Nothing is in the flow, so the
   overview never scrolls — not at 1920 × 1080, not at 1366 × 768, not in a
   narrow window. */
[data-template="design"] .design-ov {
  position: absolute; inset: 0; overflow: hidden;
  --dz-ov-top: 4rem; --dz-ov-bottom: 1.25rem;
  /* The overlay sits on arbitrary previews, not on the app surface: its own
     two tints, the bluish default and the warm graphite for bluish mocks. */
  --dz-ov-tint: rgba(34, 66, 138, 0.62); --dz-ov-tint-line: rgba(150, 185, 255, 0.45);
  --dz-ov-warm: rgba(46, 36, 30, 0.76); --dz-ov-warm-line: rgba(255, 210, 165, 0.4);
  animation: screen-in 0.25s ease;
}
.design-ov[hidden] { display: none; }
body:not([data-overview-active="true"]) .design-ov { display: none; }
.design-ov-stage {
  position: absolute; left: 0; right: 0; top: var(--dz-ov-top); bottom: var(--dz-ov-bottom);
  container-type: size; overflow: hidden;
}
.design-ov-track { position: absolute; inset: 0; }
.design-ov-slide {
  --dz-color: var(--accent-color);
  --dz-ov-w: min(78cqw, 160cqh);
  position: absolute; top: 50%; left: 50%; box-sizing: border-box;
  width: var(--dz-ov-w); aspect-ratio: 16 / 10;
  /* Neighbours: 74 %, cut off by the stage edge, dimmed and desaturated; a
     hover grows them ~8 % and lays a glowing arrow over them. */
  transform: translate(-50%, -50%) translateX(calc(var(--dz-off, 0) * (var(--dz-ov-w) * 0.86 + 1.5rem))) scale(var(--dz-s, 0.74));
  opacity: 0.32; filter: saturate(0.55); cursor: pointer;
  transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease, filter 0.25s ease;
}
.design-ov-slide[data-pos="cur"] { --dz-s: 1; transform: translate(-50%, -50%); opacity: 1; filter: none; cursor: default; z-index: 1; }
.design-ov-slide[data-pos="prev"]:hover, .design-ov-slide[data-pos="next"]:hover { opacity: 0.7; --dz-s: 0.8; }
/* No ‹ › buttons: the side card itself is the control. */
.design-ov-slide[data-pos="prev"]::after, .design-ov-slide[data-pos="next"]::after {
  content: "‹"; position: absolute; top: 50%; z-index: 3; width: 64px; height: 64px; margin-top: -32px;
  display: grid; place-items: center; border-radius: 50%; pointer-events: none;
  font-size: 2.4rem; line-height: 1; color: #fff; background: color-mix(in srgb, var(--dz-color) 55%, #0d1117);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55), 0 0 34px 8px var(--dz-color);
  opacity: 0; transform: scale(0.85); transition: opacity 0.2s ease, transform 0.2s ease;
}
.design-ov-slide[data-pos="prev"]::after { right: 14%; }
.design-ov-slide[data-pos="next"]::after { left: 14%; content: "›"; }
.design-ov-slide[data-pos="prev"]:hover::after, .design-ov-slide[data-pos="next"]:hover::after { opacity: 1; transform: none; }
.design-ov-slide[data-pos="far"] { visibility: hidden; opacity: 0; }
.design-ov-preview {
  position: absolute; inset: 0; display: block; overflow: hidden; border-radius: 22px;
  background: var(--bg-secondary, var(--panel-bg, #0d1117));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5), 0 0 0 2px var(--dz-color);
}
.design-ov-slide[data-pos="cur"] .design-ov-preview { cursor: pointer; }
.design-ov-preview:focus-visible { outline: 3px solid var(--accent-color); outline-offset: 4px; }
/* The scaled clone: laid out at a fixed 1000px virtual width, scaled to the box by
   fitPreviews() (--dz-ov-scale). pointer-events none + inert keep
   the mock's own controls out of reach — the preview is one still image. */
.design-ov-scale {
  position: absolute; top: 0; left: 0; width: 1000px;
  transform: translateX(var(--dz-ov-x, 0px)) scale(var(--dz-ov-scale, 0.28)); transform-origin: 0 0;
  pointer-events: none; padding: 1.5rem; box-sizing: border-box;
}
.design-ov-scale > * { width: 100%; }
/* "Open ↗" — only on hover / keyboard focus of the centre preview. */
.design-ov-open {
  position: absolute; right: 1rem; bottom: 1rem; z-index: 1; display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.35rem 0.85rem; border-radius: 999px; font-size: 0.9rem; font-weight: 700;
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 88%, transparent);
  color: var(--text, #e6edf3); border: 1px solid var(--dz-color);
  opacity: 0; transition: opacity 0.15s ease;
}
.design-ov-slide[data-anchor="br"] .design-ov-open { right: auto; left: 1rem; }
.design-ov-open-key { opacity: 0; transition: opacity 0.15s ease 0s; margin: 0; }
.design-ov-open:hover .design-ov-open-key { opacity: 1; transition-delay: 0.8s; }
body.hk-alt .design-ov-slide[data-pos="cur"] .design-ov-open,
body.hk-alt .design-ov-slide[data-pos="cur"] .design-ov-open-key { opacity: 1; transition-delay: 0s; }
.design-ov-slide[data-pos="cur"]:hover .design-ov-open,
.design-ov-slide[data-pos="cur"] .design-ov-preview:focus-visible .design-ov-open { opacity: 1; }
/* ── Overlay: kicker, motto, three traits — authored anchor and tint ── */
.design-ov-overlay {
  position: absolute; z-index: 2; box-sizing: border-box; max-width: 40%;
  padding: 1.1rem 1.4rem 1.25rem; border-radius: 16px; color: #fff; line-height: 1.4;
  background: var(--dz-ov-tint); border: 1px solid var(--dz-ov-tint-line);
  backdrop-filter: blur(8px); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  transition: opacity 0.2s ease, visibility 0.2s ease;
}
.design-ov-overlay[data-tone="warm"] { background: var(--dz-ov-warm); border-color: var(--dz-ov-warm-line); }
.design-ov-overlay[data-anchor="tl"] { top: 1.4rem; left: 1.4rem; }
.design-ov-overlay[data-anchor="tr"] { top: 1.4rem; right: 1.4rem; }
.design-ov-overlay[data-anchor="bl"] { bottom: 1.4rem; left: 1.4rem; }
.design-ov-overlay[data-anchor="br"] { bottom: 1.4rem; right: 1.4rem; }
.design-ov-overlay[data-anchor="tc"] { top: 1.4rem; left: 50%; transform: translateX(-50%); }
.design-ov-overlay[data-anchor="bc"] { bottom: 1.4rem; left: 50%; transform: translateX(-50%); }
.design-ov-slide:not([data-pos="cur"]) .design-ov-overlay,
.design-ov[data-overlay="off"] .design-ov-overlay { opacity: 0; visibility: hidden; }
.design-ov-kicker {
  display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;
  font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.9;
}
.design-ov-num::before, .design-ov-name::before { content: "·"; margin-right: 0.5rem; opacity: 0.7; }
.design-ov-motto { margin: 0 0 0.6rem; font-size: clamp(1.1rem, 1.5vw, 1.65rem); line-height: 1.15; font-weight: 800; letter-spacing: -0.01em; }
.design-ov-traits { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; font-size: clamp(0.85rem, 0.95vw, 1rem); }
.design-ov-traits li { display: flex; gap: 0.6rem; align-items: baseline; }
.design-ov-traits li::before {
  content: ""; flex: none; width: 9px; height: 9px; border-radius: 50%;
  background: var(--dz-color); box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6); transform: translateY(-1px);
}
/* ☆ / ★ — only on an alternatives round (the engine un-hides it). */
.design-ov-star {
  margin-left: auto; padding: 0 0 0 0.5rem; border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: 1.3rem; line-height: 1; letter-spacing: 0; color: var(--warning-color, #d29922);
}
.design-ov-star:disabled { opacity: 0.55; cursor: default; }
.design-ov-slide[data-favorite="true"] .design-ov-preview {
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5), 0 0 0 3px var(--warning-color, #d29922);
}
.design-ov[data-has-favorite="true"] .design-ov-slide[data-design-id]:not([data-favorite="true"]) .design-ov-preview { filter: saturate(0.6) brightness(0.8); }
@media (max-width: 900px) {
  .design-ov-overlay { max-width: 62%; padding: 0.7rem 0.9rem 0.8rem; }
}

/* ── Round changes: overlay on the preview, dots on menu entries ── */
.design-ov, .design-header, .design-quick, .screen-nav { --dz-new-color: var(--success-color, #3fb950); }
/* One chip in the top-3 info box: "Neugedacht" / "Verbessert". */
.design-ov-change {
  display: inline-flex; align-items: center; gap: 0.4rem; margin: 0 0 0.55rem; box-sizing: border-box;
  padding: 0.2rem 0.65rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.02em;
  color: #fff; background: color-mix(in srgb, var(--dz-new-color) 38%, transparent);
  border: 1px solid var(--dz-new-color); box-shadow: 0 0 14px color-mix(in srgb, var(--dz-new-color) 45%, transparent);
}
.design-ov-change::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--dz-new-color); }
.design-ov-change[data-kind="changed"] { --dz-new-color: var(--warning-color, #d29922); }
/* Staged entrance: main card, then the info box, then the side cards. */
@keyframes dz-ov-in { from { opacity: 0; transform: translateY(14px); } }
@keyframes dz-ov-fade { from { opacity: 0; } }
.design-ov[data-enter="true"] .design-ov-slide[data-pos="cur"] .design-ov-preview { animation: dz-ov-in 0.45s ease both; }
.design-ov[data-enter="true"] .design-ov-slide[data-pos="cur"] .design-ov-overlay { animation: dz-ov-fade 0.4s ease 0.35s both; }
.design-ov[data-enter="true"] .design-ov-slide:not([data-pos="cur"]) .design-ov-preview { animation: dz-ov-fade 0.45s ease 0.7s both; }
@media (prefers-reduced-motion: reduce) {
  .design-ov[data-enter="true"] .design-ov-preview, .design-ov[data-enter="true"] .design-ov-overlay { animation: none !important; }
  .design-ov-slide, .design-ov-slide::after, .design-ov-open-key { transition: none !important; }
}
.dz-new-dot {
  display: inline-block; flex: none; width: 7px; height: 7px; margin-left: 0.4rem;
  border-radius: 50%; background: var(--dz-new-color, #3fb950); vertical-align: middle;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dz-new-color, #3fb950) 30%, transparent);
}

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

/* ── Header — one compact row, never grows ── */
.design-header {
  position: fixed; top: 1rem; left: 1rem; z-index: 99;
  flex-direction: column; box-sizing: border-box;
  --dz-head-cap: min(calc(33vw - 1.5rem), 30rem);
  width: max-content; max-width: var(--dz-head-cap);
  padding: 0.4rem 0.8rem 0.4rem 0.9rem; border-radius: 14px;
  /* Island (variant C): filled inside, soft outer glow, accent edge as an
     inset — no frame, no light-blue border. */
  background: color-mix(in srgb, var(--panel-bg, #161b22) 94%, #fff);
  border: 0;
  box-shadow: inset 3px 0 0 var(--dz-color, var(--accent-color)), 0 0 22px color-mix(in srgb, var(--dz-color, var(--accent-color)) 18%, transparent), 0 4px 14px rgba(0, 0, 0, 0.35);
  color: var(--text-secondary, #8b949e); font-size: 0.85rem;
  transition: box-shadow 0.2s ease;
}
.design-header:hover, .design-header:focus-within { box-shadow: inset 3px 0 0 var(--dz-color, var(--accent-color)), 0 0 30px color-mix(in srgb, var(--dz-color, var(--accent-color)) 30%, transparent), 0 4px 14px rgba(0, 0, 0, 0.35); }
@keyframes chromeGlowIsland {
  50% { box-shadow: inset 3px 0 0 var(--dz-color, var(--accent-color)), 0 0 42px color-mix(in srgb, var(--dz-color, var(--accent-color)) 45%, transparent), 0 4px 14px rgba(0, 0, 0, 0.35); }
}
body.chrome-glow .design-header { animation: chromeGlowIsland 1.4s ease-in-out 2; }
@media (prefers-reduced-motion: reduce) { body.chrome-glow .design-header { animation: none; } }
.design-header-main { display: flex; align-items: center; gap: 0.5rem; white-space: nowrap; min-width: 0; min-height: 28px; }
/* The name carries its OWN cap: 19rem ≈ everything else on the row (back,
   pill chrome, ★, eye, pin, gaps, padding), so the row never exceeds the
   header's cap; the full name and motto live in its tooltip. */
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
.design-header-star {
  flex: none; border: 0; background: transparent; padding: 0; font: inherit; cursor: pointer;
  color: var(--warning-color, #d29922); white-space: nowrap;
}
.design-header-star[hidden] { display: none; }
.design-header-star[data-kind="label"]:hover { text-decoration: underline; }
/* Same round shape as the eye and the pin beside it, in the favourite colour. */
.design-header-star[data-kind="icon"] {
  width: 24px; height: 24px; border-radius: 50%; line-height: 1; font-size: 0.85rem;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--warning-color, #d29922);
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  transition: transform 0.15s;
}
.design-header-star[data-kind="icon"]:hover:not(:disabled) { transform: scale(1.08); }
.design-header-star[data-kind="icon"][aria-pressed="true"] { background: var(--warning-color, #d29922); color: var(--panel-bg, #0d1117); }
.design-header-star:disabled { opacity: 0.55; cursor: default; }
.design-header-back {
  display: inline-flex; align-items: center; gap: 0.3rem; flex: none;
  border: 0; background: transparent; color: var(--text-secondary, #8b949e);
  padding: 0.15rem 0.35rem; border-radius: 6px; font: inherit; font-size: 0.8rem; cursor: pointer;
}
.design-header-back:hover { color: var(--text, #e6edf3); background: color-mix(in srgb, var(--accent-color) 12%, transparent); }
.design-header-back svg { width: 14px; height: 14px; display: block; flex: none; }
.design-header-sep { width: 1px; height: 18px; background: var(--border-color, #30363d); flex: none; }
/* The eye moves in here (wireDesignOverview) — same control, inline size. */
.design-header .anno-toggle-fab { position: relative; flex: none; width: 24px; height: 24px; border-width: 1px; box-shadow: none; }
.design-header .anno-toggle-fab svg { width: 13px; height: 13px; }
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
/* Overlay toggle (overview only) — same round shape as the eye and the pin. */
.design-header-overlay {
  flex: none; width: 24px; height: 24px; padding: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color, #30363d);
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  color: var(--text-secondary, #8b949e); cursor: pointer; transition: transform 0.15s;
}
.design-header-overlay:hover { transform: scale(1.08); }
.design-header-overlay[hidden] { display: none; }
.design-header-overlay svg { width: 13px; height: 13px; display: block; }
.design-header-overlay[aria-pressed="true"] { border-color: var(--accent-color, #58a6ff); color: var(--accent-color, #58a6ff); }

/* ── Quick nav — top centre, one row ── */
.design-quick {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%); z-index: 95;
  flex-direction: column; align-items: center;
  /* The band between the header (left) and the ☰ FAB (right). First-paint
     value from the header's cap; fitQuickBand() replaces it with the
     measured band on every render, so the two never overlap. */
  max-width: calc(100vw - 2 * (1rem + min(33vw - 1.5rem, 30rem) + 0.75rem));
  opacity: 0.8; transition: opacity 0.16s ease;
}
.design-quick:hover, .design-quick:focus-within { opacity: 1; z-index: 98; }
.design-quick-row { display: flex; align-items: center; gap: 3px; max-width: 100%; }
.design-quick-designs {
  padding: 3px; border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 80%, transparent);
  border: 1px solid var(--border-color, #30363d); backdrop-filter: blur(6px);
}
.design-quick-seg {
  position: relative; display: inline-flex; align-items: center; gap: 0.4rem; flex: none;
  border: 0; background: transparent; cursor: pointer; white-space: nowrap;
  border-radius: 999px; font: inherit; font-size: 0.8rem; color: var(--text-secondary, #8b949e);
  padding: 0.2rem 0.65rem 0.2rem 0.25rem; transition: background 0.15s, color 0.15s;
}
.design-quick-seg:hover { color: var(--text, #e6edf3); background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.design-quick-seg[data-icon-only="true"] { padding: 0.2rem; }
.design-quick-seg[data-icon-only="true"] .design-quick-name { display: none; }
.design-quick-seg[data-icon-only="true"] .dz-new-dot { position: absolute; top: 1px; right: 1px; margin: 0; }
.design-quick-star { color: var(--warning-color, #d29922); }
/* The active design: its pages fan out of its own segment. */
.design-quick-group {
  display: inline-flex; align-items: center; gap: 2px; flex: none; padding-right: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dz-color, var(--accent-color)) 16%, var(--panel-bg, #161b22));
  box-shadow: inset 0 -2px 0 var(--dz-color, var(--accent-color)),
              inset 0 0 0 1px color-mix(in srgb, var(--dz-color, var(--accent-color)) 40%, transparent);
  /* No fill: a clip-path left in place would clip the "2 / 7" list. */
  animation: dz-quick-fan 0.32s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.design-quick-group > .design-quick-seg { color: var(--text, #e6edf3); font-weight: 700; }
.design-quick-group > .design-quick-seg:hover { background: transparent; }
.design-quick-sep { width: 1px; height: 16px; margin: 0 2px; flex: none; background: color-mix(in srgb, var(--dz-color, var(--border-color)) 45%, var(--border-color, #30363d)); }
.design-quick-page, .design-quick-vitem {
  display: inline-flex; align-items: center; gap: 0.3rem; flex: none;
  border: 0; background: transparent; cursor: pointer; white-space: nowrap;
  font: inherit; font-size: 0.76rem; color: var(--text-secondary, #8b949e);
  padding: 0.18rem 0.55rem; border-radius: 999px; transition: background 0.15s, color 0.15s;
}
.design-quick-page:hover, .design-quick-vitem:hover { color: var(--text, #e6edf3); background: color-mix(in srgb, var(--dz-color, var(--accent-color)) 24%, transparent); }
.design-quick-page[data-active="true"] { background: var(--dz-color, var(--accent-color)); color: var(--panel-bg, #0d1117); font-weight: 700; }
.design-quick-num { font-size: 0.68rem; opacity: 0.7; font-variant-numeric: tabular-nums; }
@keyframes dz-quick-fan {
  from { clip-path: inset(0 100% 0 0 round 999px); }
  to { clip-path: inset(0 0 0 0 round 999px); }
}
/* Not enough room: the pages fold into one "2 / 7 ▾" chip. */
.design-quick-morewrap { position: relative; display: inline-flex; flex: none; }
.design-quick-more {
  display: inline-flex; align-items: center; gap: 0.3rem; border: 0; cursor: pointer;
  padding: 0.18rem 0.6rem; border-radius: 999px; font: inherit; font-size: 0.76rem; font-weight: 700;
  background: var(--dz-color, var(--accent-color)); color: var(--panel-bg, #0d1117);
}
.design-quick-morewrap:hover .design-quick-more,
.design-quick-morewrap[data-open="true"] .design-quick-more { border-radius: 10px 10px 0 0; }
.design-quick-vlist {
  display: none; position: absolute; top: 100%; left: 0; z-index: 3; min-width: 180px;
  flex-direction: column; gap: 2px; padding: 6px; border-radius: 0 10px 10px 10px;
  background: var(--panel-bg, #161b22); border: 1px solid var(--dz-color, var(--accent-color));
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.45);
}
.design-quick-morewrap:hover .design-quick-vlist,
.design-quick-morewrap[data-open="true"] .design-quick-vlist { display: flex; }
.design-quick-vitem { border-radius: 7px; }
.design-quick-vitem[data-active="true"] { color: var(--text, #e6edf3); font-weight: 700; background: color-mix(in srgb, var(--dz-color, var(--accent-color)) 25%, transparent); }
/* Questions: the last segment; their list hangs off it as one tab. */
.design-quick-qwrap { --q: var(--warning-color, #d29922); position: relative; display: inline-flex; flex: none; margin-left: 2px; }
.design-quick-qwrap:has(.design-quick-q[data-state="done"]) { --q: var(--success-color, #3fb950); }
.design-quick-q {
  position: relative; display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer;
  padding: 0.15rem 0.5rem; border-radius: 999px; border: 1px solid var(--q);
  background: color-mix(in srgb, var(--q) 14%, transparent); color: var(--q);
  font: inherit; font-size: 0.78rem; font-weight: 700; white-space: nowrap;
  transition: border-radius 0.15s ease, background 0.15s ease;
}
.design-quick-q[data-active="true"] { background: var(--q); color: var(--panel-bg, #0d1117); }
.design-quick-qmark { font-weight: 900; }
.design-quick-badge {
  min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px;
  display: inline-grid; place-items: center;
  background: var(--q); color: var(--panel-bg, #0d1117); font-size: 0.66rem; font-weight: 800;
}
.design-quick-q[data-active="true"] .design-quick-badge { background: var(--panel-bg, #0d1117); color: var(--q); }
.design-quick-qok { font-weight: 900; }
.design-quick-qwrap:hover .design-quick-q,
.design-quick-qwrap[data-open="true"] .design-quick-q {
  z-index: 4; border-radius: 12px 12px 0 0; border-bottom-color: transparent;
  background: var(--panel-bg, #161b22); color: var(--q);
}
/* Covers the list's top border under the button: button and list read as
   one surface, the tab growing out of the segment. */
.design-quick-qwrap::after {
  content: ""; display: none; position: absolute; left: 1px; right: 1px; bottom: -2px; height: 3px;
  background: var(--panel-bg, #161b22); z-index: 5;
}
.design-quick-qwrap:hover::after, .design-quick-qwrap[data-open="true"]::after { display: block; }
.design-quick-qpop {
  display: none; position: absolute; top: calc(100% - 1px); right: 0; z-index: 3;
  width: max-content; min-width: 260px; max-width: min(360px, 80vw);
  flex-direction: column; gap: 2px; padding: 10px 8px 8px;
  border: 1px solid var(--q); border-radius: 12px 0 12px 12px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--q) 9%, var(--panel-bg, #161b22)), var(--panel-bg, #161b22) 60px);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5), 0 0 0 4px color-mix(in srgb, var(--q) 10%, transparent);
  transform-origin: top right;
}
.design-quick-qwrap:hover .design-quick-qpop,
.design-quick-qwrap[data-open="true"] .design-quick-qpop { display: flex; animation: dz-qpop-in 0.18s ease-out; }
@keyframes dz-qpop-in { from { opacity: 0; transform: scaleY(0.85); } }
.design-quick-qhead {
  display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0 6px 6px;
  color: var(--q); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
}
.design-quick-qhead span { color: var(--text-secondary, #8b949e); text-transform: none; letter-spacing: 0; }
.design-quick-qbar { height: 4px; margin: 0 6px 6px; border-radius: 2px; overflow: hidden; background: var(--border-color, #30363d); }
.design-quick-qbar i { display: block; height: 100%; background: var(--success-color, #3fb950); transition: width 0.3s ease; }
.design-quick-qitem {
  display: flex; align-items: center; gap: 0.55rem; width: 100%; box-sizing: border-box;
  padding: 0.42rem 0.5rem; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--text, #e6edf3); font: inherit; font-size: 0.82rem; text-align: left;
}
.design-quick-qitem:hover { background: color-mix(in srgb, var(--q, #d29922) 14%, transparent); }
.design-quick-qitem[data-active="true"] { background: color-mix(in srgb, var(--q, #d29922) 22%, transparent); font-weight: 700; }
.design-quick-qitem[data-done="true"] { color: var(--text-secondary, #8b949e); }
.design-quick-qstate {
  flex: none; width: 14px; height: 14px; box-sizing: border-box; border-radius: 50%;
  border: 2px solid var(--q, #d29922); display: grid; place-items: center;
  font-size: 9px; font-weight: 900; color: var(--panel-bg, #0d1117);
}
.design-quick-qitem[data-done="true"] .design-quick-qstate { background: var(--success-color, #3fb950); border-color: var(--success-color, #3fb950); }
.design-quick-qtitle { min-width: 0; overflow-wrap: anywhere; }
/* Every arrival on the overview pulses the questions while any is open. */
.design-quick-q[data-pulse="true"] { animation: dz-q-pulse 1.1s ease-out 2; }
@keyframes dz-q-pulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--q) 65%, transparent); }
  100% { box-shadow: 0 0 0 14px transparent; }
}
body.panel-open .design-quick, body.panel-open .design-header { opacity: 0; pointer-events: none; }
@media (max-width: 900px) {
  /* Icons only — the tooltip still names each design. */
  .design-quick-seg .design-quick-name { display: none; }
  .design-quick-seg { padding: 0.2rem; }
}

/* ── Questions slide (last slide of the carousel) ── */
.design-ov-qcard {
  --q: var(--warning-color, #d29922);
  position: absolute; inset: 0; box-sizing: border-box; overflow: hidden auto;
  display: flex; flex-direction: column; gap: 0.6rem;
  padding: 5% 6%; border-radius: 22px;
  background: color-mix(in srgb, var(--q) 6%, var(--panel-bg, #161b22));
  box-shadow: 0 0 0 2px var(--q), 0 24px 70px rgba(0, 0, 0, 0.5);
}
.design-ov-qcard[data-state="done"] { --q: var(--success-color, #3fb950); }
.design-ov-qhead { display: flex; align-items: center; gap: 0.75rem; color: var(--q); font-size: clamp(1.2rem, 2vw, 2.2rem); }
.design-ov-qmark {
  width: 1.4em; height: 1.4em; border-radius: 50%; display: grid; place-items: center;
  background: var(--q); color: var(--panel-bg, #0d1117); font-weight: 900;
}
.design-ov-qprogress { margin: 0; font-size: clamp(0.85rem, 1vw, 1.05rem); color: var(--text-secondary, #8b949e); }
.design-ov-qcard .design-quick-qbar { margin: 0 0 0.5rem; }
.design-ov-qcard .design-quick-qitem {
  padding: 0.85rem 0.5rem; border-radius: 0; font-size: clamp(0.95rem, 1.3vw, 1.4rem);
  border-top: 1px solid color-mix(in srgb, var(--border-color, #30363d) 70%, transparent);
}
.design-ov-qcard .design-quick-qstate { width: 1.1em; height: 1.1em; }

/* ── Submit hint: open questions, never a blocker ── */
.submit-open-questions {
  margin: 0 0 0.4rem; padding: 0.35rem 0.6rem; border-radius: 8px; font-size: 0.78rem; line-height: 1.35;
  border: 1px solid var(--warning-color, #d29922); color: var(--warning-color, #d29922);
  background: color-mix(in srgb, var(--warning-color, #d29922) 12%, transparent);
}
.submit-open-questions[hidden] { display: none; }
.submit-open-questions .link-btn { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }

/* ── Intro: the page builds itself up (wireDesignOverview adds .dz-intro
   for ~2 s) — content, header, quick nav with a bounce, then the FABs.
   From-only keyframes end on the element's own resting values. ── */
@keyframes dz-intro-fade { from { opacity: 0; } }
@keyframes dz-intro-slide { from { opacity: 0; transform: translateX(-28px); } }
@keyframes dz-intro-quick {
  0% { opacity: 0; transform: translate(-50%, -48px) scale(0.55); filter: blur(10px); }
  55% { opacity: 1; transform: translate(-50%, 8px) scale(1.1); filter: blur(0); }
  78% { transform: translate(-50%, -3px) scale(0.97); }
}
body.dz-intro .concept-content { animation: dz-intro-fade 0.45s ease both; }
/* Header islands, quick nav and FABs come last and only on the very first
   open (.dz-intro-first); on every later open they are simply there. */
body.dz-intro:not(.dz-intro-first) #design-header, body.dz-intro:not(.dz-intro-first) #design-quick,
body.dz-intro:not(.dz-intro-first) .panel-fab, body.dz-intro:not(.dz-intro-first) .feedback-fab { animation: none; }
body.dz-intro-first #design-header { animation: dz-intro-slide 0.45s ease 1.4s both; }
body.dz-intro-first #design-quick { animation: dz-intro-quick 0.75s cubic-bezier(0.2, 0.8, 0.2, 1) 1.6s both; }
body.dz-intro-first .panel-fab, body.dz-intro-first .feedback-fab { animation: dz-intro-fade 0.5s ease 2.2s both; }
@media (prefers-reduced-motion: reduce) {
  body.dz-intro .concept-content, body.dz-intro #design-header, body.dz-intro #design-quick,
  body.dz-intro .panel-fab, body.dz-intro .feedback-fab,
  .design-quick-group, .design-quick-qpop, .design-quick-q[data-pulse="true"] { animation: none !important; }
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
  --upin-color: #d2a8ff;
  position: absolute; left: var(--upin-x); top: var(--upin-y);
  transform: translate(-4px, -100%); pointer-events: auto;
}
.upin-pin {
  position: relative; width: 28px; height: 28px; padding: 0; border-radius: 50% 50% 50% 4px; border: 0;
  background: linear-gradient(160deg, #ecd9ff, var(--upin-color));
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; transition: transform 0.15s, opacity 0.2s;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--upin-color) 22%, transparent), 0 0 24px color-mix(in srgb, var(--upin-color) 65%, transparent), 0 6px 14px rgba(0, 0, 0, 0.4);
}
.upin-pin::after { content: ''; position: absolute; inset: 0; margin: auto; width: 8px; height: 8px; border-radius: 50%; background: #fff; opacity: 0.92; }
.upin[data-dragging="true"] { z-index: 3; }
.upin[data-dragging="true"] .upin-pin { cursor: grabbing; transform: scale(1.15); transition: none; }
.upin-pin:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
.upin-editor {
  position: absolute; left: 32px; top: 0; width: min(280px, 70vw);
  padding: 0.6rem 0.7rem; border-radius: 12px; box-sizing: border-box;
  background: var(--panel-bg, #161b22); color: var(--text-color, #e6edf3);
  border: 0; box-shadow: 0 0 26px color-mix(in srgb, var(--upin-color) 35%, transparent), 0 14px 30px rgba(0, 0, 0, 0.5);
  cursor: auto;
}
.upin[data-flip-x="true"] .upin-editor { left: auto; right: 32px; }
.upin[data-flip-y="true"] .upin-editor { top: auto; bottom: 30px; }
.upin-editor[hidden] { display: none; }
.upin-editor .attach-slot { position: relative; }
.upin-editor .attach-slot .attach-btn { position: absolute; right: 8px; top: -30px; opacity: 0.7; }
.upin-editor textarea { padding-bottom: 1.7rem; }
.upin-editor-head { font-size: 0.72rem; color: var(--text-secondary, #8b949e); margin-bottom: 0.35rem; }
.upin-editor textarea {
  width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical;
  padding: 0.45rem 0.45rem 1.7rem; border-radius: 8px; font: inherit; font-size: 0.85rem;
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
  .design-ov-slide, .design-ov-overlay, .design-header, .design-quick { transition: none; }
}
```

## Hotkey overlay, Space and nudges — `wireChromeHotkeys()`

Runs on EVERY template (decision, free, design), so the plain-mode pages get
the same hotkeys and tips as a design round. Three jobs:

- **Space** toggles the notes dock (a click on `#feedback-toggle`, like `N`),
  only when focus is not in a field, the dock, a bubble or a pin editor and
  not on a native button / link (which keep their own Space); it calls
  `preventDefault()`, so the page never scrolls. Space no longer advances
  screens or the overview overlay — that moved to the arrow keys.
- **Alt held** = `body.hk-alt` plus `#hk-overlay`: one `kbd.hk-badge` at the
  top-right of every `[data-tip-key]` control that is on screen, and — on a
  design page — an example own pin labelled "Ctrl + click". Alt up, window
  blur or a tab switch removes it. The "Design öffnen" button of the overview
  shows its key from the same class.
- **Nudges** — a quiet tip tab (`#hk-nudge.hk-nudge`) sitting on top of the
  status toast: key caps, a text that names the word "Hotkey(s)", a 1.5px
  timer line, ✕. It appears only when the engine sees the user doing by mouse
  what a hotkey does faster: switching variants (2 mouse clicks on the quick
  nav in 90 s), clicking through pages (3), opening the dock by click (2),
  submitting the round by mouse, and — once — on the first visit
  ("Halte Alt für alle Hotkeys"). It auto-expires after 9 s; ✕ silences that
  one nudge for 30 days (`localStorage` `concept-nudge:<id>` = timestamp,
  every access in try / catch). Never two nudges within 60 s.
  **Contract for the toast:** the tab's bottom edge is
  `bottom: var(--hk-nudge-bottom, 6.5rem)`; the toast code sets that custom
  property on `:root` to the toast's height + gap (nothing else is shared).
  `window.conceptNudge(id, caps, text)` shows one by hand; `window.conceptNudgeSilenced(id)`
  reads the 30-day state.

```javascript
(function wireChromeHotkeys() {
  const T = {
    alt: '{{nudge.alt}}', variants: '{{nudge.variants}}', pages: '{{nudge.pages}}',
    dock: '{{nudge.dock}}', submit: '{{nudge.submit}}', dismiss: '{{nudge.dismiss}}',
    space: '{{design.key_space}}', ctrl: '{{design.key_ctrl}}', click: '{{design.keys_click}}'
  };
  const body = document.body;
  const DAY = 86400000;
  const TTL = 30 * DAY;
  const BASE = 'concept-nudge:';
  const fieldIn = t => !!(t && t.closest && t.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"], #feedback-dock, .anno-bubble, .upin-editor'));
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The dock FAB names its hotkey like every other hotkey-bound control.
  const fab = document.getElementById('feedback-toggle');
  if (fab && !fab.dataset.tipKey) fab.dataset.tipKey = T.space;

  // ── Space → notes dock ──────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || (e.key !== ' ' && e.code !== 'Space')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (fieldIn(e.target)) return;
    if (document.getElementById('decision-panel')?.classList.contains('open')) return;
    const t = document.activeElement;
    if (t && t.closest && t.closest('button, a[href], summary, select')) return;
    const toggle = document.getElementById('feedback-toggle');
    if (!toggle) return;
    e.preventDefault();
    toggle.click();
  });

  // ── Alt held → every hotkey badge ───────────────────────────────────
  let layer = null;
  const visible = n => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  function showKeys() {
    if (layer) return;
    body.classList.add('hk-alt');
    layer = mk('div', 'hk-overlay');
    layer.id = 'hk-overlay';
    layer.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-tip-key]').forEach(n => {
      if (!visible(n)) return;
      const r = n.getBoundingClientRect();
      const badge = mk('kbd', 'app-kbd hk-badge', n.dataset.tipKey);
      badge.style.left = Math.round(r.right) + 'px';
      badge.style.top = Math.round(r.top) + 'px';
      layer.appendChild(badge);
    });
    const onDesign = document.querySelector('section[data-design]')
      && body.dataset.overviewActive !== 'true' && body.dataset.viewActive !== 'true';
    if (onDesign) {
      const ex = mk('div', 'hk-pin-example');
      ex.append(mk('span', 'hk-pin-dot'), mk('span', 'hk-pin-label', T.ctrl + ' + ' + T.click));
      layer.appendChild(ex);
    }
    body.appendChild(layer);
  }
  function hideKeys() {
    body.classList.remove('hk-alt');
    if (layer) { layer.remove(); layer = null; }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Alt' && !e.repeat) showKeys(); });
  document.addEventListener('keyup', e => { if (e.key === 'Alt') hideKeys(); });
  window.addEventListener('blur', hideKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideKeys(); });

  // ── Nudges ──────────────────────────────────────────────────────────
  function silenced(id) {
    try {
      const at = Number(localStorage.getItem(BASE + id));
      return !!at && Date.now() - at < TTL;
    } catch (e) { return false; }
  }
  function silence(id) {
    if (typeof _guardedSetItem === 'function') _guardedSetItem(BASE + id, String(Date.now()));
  }
  let lastShown = 0;
  let current = null;
  function hideNudge() {
    if (!current) return;
    clearTimeout(current.timer);
    current.node.remove();
    current = null;
  }
  function nudge(id, caps, text) {
    if (silenced(id) || current || Date.now() - lastShown < 60000) return false;
    lastShown = Date.now();
    const node = mk('div', 'hk-nudge');
    node.id = 'hk-nudge';
    node.setAttribute('role', 'status');
    node.dataset.nudge = id;
    const keys = mk('span', 'hk-nudge-keys');
    caps.forEach(c => keys.appendChild(mk('kbd', 'hk-nudge-key', c)));
    const x = mk('button', 'hk-nudge-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', T.dismiss);
    x.dataset.tip = T.dismiss;
    x.dataset.tipTier = 'info';
    x.addEventListener('click', () => { silence(id); hideNudge(); });
    node.append(keys, mk('span', 'hk-nudge-text', text), x, mk('i', 'hk-nudge-timer'));
    document.body.appendChild(node);
    current = { node, timer: setTimeout(hideNudge, 9000) };
    return true;
  }
  window.conceptNudge = nudge;
  window.conceptNudgeSilenced = silenced;

  // Mouse moments. detail > 0 = a real pointer click (a keyboard "click"
  // reports 0), so using the hotkey never counts as the slow way.
  const counts = {};
  const hit = (id, need) => {
    const now = Date.now();
    const list = (counts[id] = (counts[id] || []).filter(t => now - t < 90000));
    list.push(now);
    return list.length >= need;
  };
  document.addEventListener('click', e => {
    if (!(e.detail > 0) || !e.target || !e.target.closest) return;
    const t = e.target;
    if (t.closest('.design-quick-seg') && hit('variants', 2)) {
      const n = document.querySelectorAll('.design-quick-designs > .design-quick-seg, .design-quick-designs > .design-quick-group').length;
      const caps = [];
      for (let i = 1; i <= Math.min(n, 3); i++) caps.push(String(i));
      if (caps.length) nudge('variants', caps, T.variants.replace('{n}', String(Math.min(n, 9))));
    } else if (t.closest('.design-quick-page, .design-quick-vitem, .screen-nav-item') && hit('pages', 3)) {
      nudge('pages', ['←', '→'], T.pages);
    } else if (t.closest('#feedback-toggle') && hit('dock', 2)) {
      nudge('dock', [T.space], T.dock);
    } else if (t.closest('#submit-iterate-btn')) {
      nudge('submit', [T.ctrl, 'Enter'], T.submit);
    }
  }, true);
  // First visit: once, a few seconds after the page settled.
  setTimeout(() => {
    if (silenced('alt')) return;
    if (nudge('alt', ['Alt'], T.alt)) silence('alt');
  }, 7000);
})();
```

```css
/* Alt overlay: badges sit at the control's top-right, right-aligned, slightly overlapping. */
.hk-overlay { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
.hk-badge {
  position: fixed; transform: translate(-100%, -35%); margin: 0; z-index: 1;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); animation: hk-pop 0.14s ease both;
}
.hk-pin-example {
  position: fixed; left: 62%; top: 58%; display: flex; align-items: center; gap: 0.5rem;
  animation: hk-pop 0.18s ease both;
}
.hk-pin-dot {
  width: 22px; height: 22px; border-radius: 50%; background: var(--accent-color, #388bfd);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-color, #388bfd) 28%, transparent), 0 0 22px var(--accent-color, #388bfd);
}
.hk-pin-label {
  padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; color: var(--text, #e6edf3);
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 92%, transparent); border: 1px solid var(--border-color, #30363d);
}
@keyframes hk-pop { from { opacity: 0; transform: translate(-100%, -35%) scale(0.85); } }
.hk-pin-example { animation-name: hk-fade; }
@keyframes hk-fade { from { opacity: 0; } }

/* Nudge tab: quiet, almost no background, coloured key caps, 1.5px timer line. */
.hk-nudge {
  position: fixed; left: 50%; bottom: var(--hk-nudge-bottom, 6.5rem); transform: translateX(-50%); z-index: 9000;
  display: flex; align-items: center; gap: 0.6rem; max-width: min(92vw, 560px); box-sizing: border-box;
  padding: 0.4rem 0.7rem 0.45rem; border-radius: 12px 12px 0 0; overflow: hidden;
  font-size: 0.9rem; color: var(--text-secondary, #8b949e);
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 55%, transparent);
  backdrop-filter: blur(6px); animation: hk-nudge-in 0.25s ease both;
}
.hk-nudge-keys { display: inline-flex; gap: 0.25rem; }
.hk-nudge-key {
  min-width: 1.5rem; padding: 0.1rem 0.4rem; border-radius: 6px; text-align: center; font: inherit; font-weight: 800;
  color: #1a1200; background: var(--warning-color, #d29922); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
}
.hk-nudge-text { min-width: 0; }
.hk-nudge-x {
  flex: none; width: 1.5rem; height: 1.5rem; padding: 0; border: 0; border-radius: 50%; background: transparent;
  color: inherit; font: inherit; cursor: pointer;
}
.hk-nudge-x:hover, .hk-nudge-x:focus-visible { background: rgba(255, 255, 255, 0.1); color: var(--text, #e6edf3); }
.hk-nudge-timer {
  position: absolute; left: 0; bottom: 0; height: 1.5px; width: 100%; transform-origin: 0 50%;
  background: var(--warning-color, #d29922); animation: hk-nudge-timer 9s linear both;
}
@keyframes hk-nudge-in { from { opacity: 0; transform: translateX(-50%) translateY(6px); } }
@keyframes hk-nudge-timer { to { transform: scaleX(0); } }
@media (prefers-reduced-motion: reduce) {
  .hk-badge, .hk-pin-example, .hk-nudge { animation: none; }
  .hk-nudge-timer { animation: none; transform: scaleX(0.5); }
}
```
