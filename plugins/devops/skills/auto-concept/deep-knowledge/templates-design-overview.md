# Concept templates, part 16 of 46: Template: design — variant overview JS

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
  `concept-build.js bake`): the overlay star and the quick nav's ★ show the
  favourite, the pins render read-only, nothing can be changed.
- **Favourite only for alternatives.** ☆/★, `F`, the quick nav's ★ and the
  favourite dimming exist only while the iteration carries
  `data-design-set="alternatives"` (`favOn()`); unmarked or `topics` → no
  star anywhere and `designOverviewState().favorite` is always `null`.
- **Carousel.** The overview is one slide per design plus a trailing
  questions slide (`section[data-view]`s). The current slide sits large in
  the centre; its neighbours peek in cut off at the edges (`data-pos`
  `prev` / `next`) as plain bordered tiles — no cut-off preview, just the
  variant's icon (`.design-ov-side`: the quick-nav icon, no frame of its
  own), vertically centred just outside the hover chevron so the chevron
  points at it; the name shows under it on hover, wrapped, never cut. A
  click on a neighbour or `←` / `→` only turns the carousel (no ‹ ›
  buttons); the centre preview opens its design (click / `Enter` / `↓`) and
  glows on hover — it never scales, and the stage clips sideways only and
  keeps `--dz-ov-glow` free above and below, so the glow is never cut. The
  centre tile carries no badge: the quick nav highlights the centred variant
  (`data-ov-focus`, its pages stay folded, a small ▾ hints at them; the
  questions tile highlights "Fragen"). Everything is sized from the viewport
  (CSS container units on the stage), so the overview never scrolls.
- **Header = the eye only.** `#design-header` holds nothing but the
  annotation eye (`.design-header-eye`), bare and dimmed until pointed at —
  no breadcrumb, no back item, no title, no ★, no box. Back to the overview:
  the ☰ menu's "Übersicht" entry or `Esc`; the favourite shows as the quick
  nav's ★ and toggles with `F` / the overlay ☆.
- **Eye counter** (`#anno-eye-count`, § Annotation Layer JS): the automatic
  notes of the CURRENT page that are neither answered nor opened yet; the
  overview and question views own none and count 0.
- **Overlay** on the current preview: kicker `icon name` (+ ☆/★) — the
  same pairing as the quick nav, no number — motto, the three traits.
  Semi-transparent at rest, opaque on hover / focus. Anchor from
  `data-design-overlay` (`tl|tr|bl|br|tc|bc`, default `bl`), tint from
  `data-design-overlay-tone="warm"`. The eye (`#anno-toggle`, top left)
  hides it with every other annotation; there is no separate
  overlay toggle. A NEW variant carries the "Neugedacht" chip; a variant
  CHANGED this round shows one line under the traits — "Verbessert" + the
  phrase from the optional `data-design-improved` attribute on its
  `section[data-design]` (a few words, ≤ ~40 chars, e.g. "Größere
  Tageskacheln"; longer text is cut at a word boundary). No attribute → no
  line, no chip.
- **Preview fit** is measured through no ancestor transform (`fitPreviews()`
  divides by the wrap's ancestor scale — a side card's rects read at its
  `scale(.74)` made the fit too large and cropped the real content).
- **Previews** are clones of each design's first screen (`prefixClone`-style
  id namespacing, every `data-comment` / `data-field` / `data-screen-link` /
  `data-tip` stripped, `inert`, inside `[data-device-clone]` so neither
  `saveState()` nor `collectAllFormFields()` sees a cloned control).
- **Quick-nav band.** The quick nav is centred; its `max-width` is measured
  against the eye's real right edge and the ☰ FAB on every render, so the
  two never overlap. Too little room → pages fold into the "2 / 7 ▾" chip,
  then (overview / view) the designs shrink to their icons.
- **"Fragen".** One question view: the segment opens it directly, no
  dropdown. Two or more: the segment carries their list as a dropdown
  (hover / focus; the first tap on touch), a click still jumps to the next
  open one.
- **Hotkeys** never fire while focus is in a real text entry
  (`isConceptTextEntry()`, § Design JS — a focused dock button does not
  count); digits, arrows, `Enter` and `Tab` also work while the ☰ panel is
  open (`Esc` belongs to the panel then). No own-note arming while it is
  open. `Tab` advances the page only while nothing is focused, so the
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
    keysViewport: '{{design.keys_viewport}}', keysMenu: '{{design.keys_menu}}',
    keysHide: '{{design.keys_hide}}', keysTheme: '{{design.keys_theme}}',
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
    chImproved: '{{design.change_improved}}', keysDock: '{{design.keys_dock}}', keysDockNext: '{{design.keys_dock_next}}', keysDockClose: '{{design.keys_dock_close}}',
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
      tone: d.dataset.designOverlayTone === 'warm' ? 'warm' : '',
      improved: improvedPhrase(d.dataset.designImproved)
    };
  }
  // `data-design-improved`: a few words on what improved this round. Capped
  // so the line never outgrows the info box — cut at a word boundary.
  function improvedPhrase(raw) {
    const t = String(raw || '').replace(/\s+/g, ' ').trim();
    if (t.length <= 44) return t;
    const cut = t.slice(0, 44);
    const sp = cut.lastIndexOf(' ');
    return (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '') + '…';
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
  // A control whose name is on screen gets no tooltip that repeats it
  // (ui-defaults: no tooltip that merely restates visible text): only its
  // hotkey as a keycap, or no tooltip at all. Uniform per kind — every named
  // segment / page with a hotkey shows the keycap, every one without none.
  // The tooltip component needs a non-empty data-tip, so the label is an
  // invisible word joiner and data-tip-key-only marks the case.
  const KEY_ONLY = String.fromCharCode(0x2060);
  function keyTip(node, key) {
    delete node.dataset.tipKey;
    node.removeAttribute('aria-keyshortcuts');
    if (!key) { delete node.dataset.tip; delete node.dataset.tipKeyOnly; return; }
    setTip(node, KEY_ONLY, key);
    node.dataset.tipKeyOnly = 'true';
  }
  // Under 900px the quick nav shows icons only (CSS), so the name is no
  // longer on screen and goes back into the tooltip.
  const quickNarrow = () => !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);

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
      out.pins = st.pins.filter(p => p && typeof p.id === 'string' && typeof p.screen === 'string' && !p.anchor)
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
    if (!ta) return false;
    ta.value = JSON.stringify(normalise(st));
    ta.setAttribute('data-touched', 'true');
    // The `input` listeners of § State Persistence (saveState → bridge
    // draft) and § Layout JS (note markers) do the rest.
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof _userInteracted !== 'undefined') { try { _userInteracted = true; } catch (e) {} }
    refresh();
    return true;
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
    // No "Open ↗" button: the centre preview itself is the control (click /
    // Enter / ↓) and answers a hover with a glow, never with scaling.
    const kind = delta ? (delta.isNew ? 'new' : delta.screens.length ? 'changed' : 'same') : '';
    if (kind) slide.dataset.change = kind;
    preview.addEventListener('keydown', e => {
      if (e.key === 'Enter' && slide.dataset.pos === 'cur') { e.preventDefault(); open(); }
    });
    slide.appendChild(preview);
    slide.appendChild(sideLabelOf(iconEl(m.icon, { color: m.color })));
    // Overlay: kicker (icon name + ☆/★), motto, three traits, and for a
    // changed variant the "Verbessert …" line — at the anchor the author
    // picked, in the tint the author picked.
    const ov = el('div', 'design-ov-overlay');
    ov.dataset.anchor = m.anchor;
    if (m.tone) ov.dataset.tone = m.tone;
    if (kind === 'new') {
      const chip = el('span', 'design-ov-change', L.chRethought);
      chip.dataset.kind = kind;
      ov.appendChild(chip);
    }
    const kick = el('div', 'design-ov-kicker');
    kick.append(iconEl(m.icon, { color: m.color }), el('span', 'design-ov-name', m.label));
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
    if (kind === 'changed' && m.improved) {
      const line = el('p', 'design-ov-improved');
      line.append(el('strong', '', L.chImproved), document.createTextNode(' ' + m.improved));
      ov.appendChild(line);
    }
    slide.appendChild(ov);
    wireSlide(slide, open);
    return slide;
  }
  // Side-tile label: only a neighbour (a plain bordered tile) shows it — the
  // variant's icon alone, exactly the quick-nav icon (no frame, no name: the
  // quick nav names it), vertically centred right where the hover chevron
  // points. The centre tile carries no badge: the quick nav marks it.
  function sideLabelOf(icon) {
    const b = el('span', 'design-ov-side');
    b.setAttribute('aria-hidden', 'true');
    b.append(icon);
    return b;
  }
  function buildQuestionsSlide() {
    const slide = el('article', 'design-ov-slide design-ov-qslide');
    slide.dataset.questions = 'true';
    slide.setAttribute('aria-label', L.qLabel);
    slide.appendChild(el('div', 'design-ov-qcard'));
    slide.appendChild(sideLabelOf(iconEl('question', { kind: 'plain' })));
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
    markQuickFocus(it || visibleIteration());
  }
  // On the overview the quick nav names the tile in the centre: that
  // variant's segment (or "Fragen" on the questions tile) is highlighted —
  // the variant only, its pages stay folded; a small caret hints that it
  // opens onto them. Painted in place, no re-render: turning the carousel
  // must not rebuild the nav under the pointer.
  function markQuickFocus(it) {
    if (!quick) return;
    const cur = mode() === 'overview'
      ? overviewOf(it)?.querySelector('.design-ov-slide[data-pos="cur"]') : null;
    const id = cur ? cur.dataset.designId || '' : '';
    const onQ = !!(cur && cur.dataset.questions === 'true');
    quick.querySelectorAll('.design-quick-seg[data-design-id]').forEach(s => {
      if (s.parentNode && s.parentNode.classList.contains('design-quick-group')) return;
      s.dataset.ovFocus = String(!!id && s.dataset.designId === id);
    });
    quick.querySelectorAll('.design-quick-q').forEach(q => { q.dataset.ovFocus = String(onQ); });
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
    // The staged entrance is the first arrival only (boot / restore); a
    // way back from a variant is the zoom-out of § Page transitions.
    if (ov && body.dataset.dzNav !== 'out') {
      ov.dataset.enter = 'true';
      clearTimeout(ov._enterTimer);
      ov._enterTimer = setTimeout(() => { ov.dataset.enter = 'false'; }, 1600);
    }
  });

  // The info box has no toggle of its own any more: the header eye hides it
  // with every other annotation (body.anno-hidden), so a second "layers"
  // button next to it was redundant. data-overlay stays "on" — an older
  // stored "off" (concept-ov-overlay:<path>) is ignored, it had no way back.
  const overlayShown = true;
  function paintOverlay() {
    document.querySelectorAll('.design-ov').forEach(o => { o.dataset.overlay = 'on'; });
  }

  // ── Header: the eye, nothing else ──────────────────────────────────────
  // No breadcrumb, no back item, no title, no ★: the page stays calm. The
  // way back to the overview is the ☰ menu's "Übersicht" entry (and Esc),
  // the current variant shows in the quick nav, the favourite as its ★
  // there. Only the annotation eye stays top left, as a bare control —
  // #design-header is its slot (placeEye(), § Panel Chrome JS adopt).
  const H = {};
  function buildHeader() {
    if (!header || H.main) return;
    H.main = el('div', 'design-header-main');
    H.eye = el('span', 'design-header-eye');
    H.main.append(H.eye);
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
  // Every question entry carries its hotkey (⇧ + its number) as a keycap
  // only — the title is on screen — like the designs' digits.
  function questionItem(q, onPick, n) {
    const item = el('button', 'design-quick-qitem');
    item.type = 'button';
    item.dataset.done = String(q.done);
    item.append(el('span', 'design-quick-qstate', q.done ? '✓' : ''), el('span', 'design-quick-qtitle', q.title));
    if (n >= 1 && n <= 9) keyTip(item, '⇧+' + n);
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
    const key = m.n <= 9 ? String(m.n) : '';
    if (named && !quickNarrow()) keyTip(seg, key); else setTip(seg, m.label, key);
    // The variant already on screen is one level up: back to the overview,
    // that variant centred — a click on it never re-renders anything.
    press(seg, () => {
      if (typeof closePanel === 'function') closePanel();
      const it = visibleIteration();
      const cur = mode() === 'design' ? activeDesignOf(it) : null;
      if (cur && cur.dataset.design === m.id) { if (overviewOf(it)) window.showOverview(); return; }
      showDesignAligned(m.id);
    });
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
    // Active state, dot and the Tab keycap are painted by paintQuick(), in
    // place, on every page switch — the buttons themselves stay.
    const pageBtn = (sec, i, cls) => {
      const b = el('button', cls);
      b.type = 'button';
      b.dataset.screenId = sec.id;
      b.append(el('span', 'design-quick-num', roman(i + 1)), el('span', 'design-quick-name', sec.dataset.navLabel || sec.id));
      // The page already on screen is one level up: back to the overview.
      press(b, () => {
        if (typeof closePanel === 'function') closePanel();
        if (sec.dataset.screenActive === 'true' && mode() === 'design') {
          if (overviewOf(visibleIteration())) window.showOverview();
          return;
        }
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
  // "Fragen" is one segment, no "?" mark. One question: no submenu, it opens
  // directly and hovers like its siblings. Several: the segment carries
  // their list as a dropdown (hover / focus, like a design's pages; on touch
  // the first tap opens it), and a click opens the first open one, a click
  // while inside the questions the next open one (wrapping; all answered ->
  // the questions in order).
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
    // "Fragen" and the open count are on screen: no tooltip repeating them,
    // the full sentence goes to assistive tech only.
    btn.setAttribute('aria-label', L.qLabel + ': ' + (open.length ? (open.length === 1 ? L.qOpen1 : L.qOpen.replace('{n}', String(open.length))) : L.qAllDone));
    const multi = qs.length >= 2;
    press(btn, e => {
      if (multi && e && e.pointerType === 'touch' && wrap.dataset.open !== 'true') {
        wrap.dataset.open = 'true';
        btn.setAttribute('aria-expanded', 'true');
        return;
      }
      wrap.dataset.open = 'false';
      const q = nextQuestion(visibleIteration());
      if (q) goQuestion(q.id);
    });
    wrap.append(btn);
    if (!multi) return wrap;
    wrap.dataset.multi = 'true';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.appendChild(el('span', 'design-quick-caret', '▾'));
    const pop = el('div', 'design-quick-qpop');
    pop.setAttribute('role', 'menu');
    const head = el('div', 'design-quick-qhead');
    head.append(el('strong', '', L.qLabel),
      el('span', '', L.qProgress.replace('{done}', String(qs.length - open.length)).replace('{n}', String(qs.length))));
    pop.append(head, progressBar(qs.length - open.length, qs.length));
    qs.forEach((q, i) => {
      const item = questionItem(q, () => { wrap.dataset.open = 'false'; goQuestion(q.id); }, i + 1);
      item.setAttribute('role', 'menuitem');
      item.dataset.viewId = q.id;
      item.dataset.active = String(viewOn === q.v);
      pop.appendChild(item);
    });
    wrap.appendChild(pop);
    return wrap;
  }
  // The quick nav is rebuilt only when its SHAPE changes (mode, which
  // variant fans out, fold level, favourite, the questions and their done
  // state, narrow layout). A page switch, a dot that goes, a question view
  // that changes only repaint the existing buttons (paintQuick) — a rebuild
  // under the pointer was the flicker on every quick-nav click.
  let quickKey = '';
  let quickMd = '';
  function quickShape(it, md, d, fav, qs) {
    return [it.id || '', md, d ? d.dataset.design : '', quickLevel, fav || '', quickNarrow(),
      metas.map(m => m.id).join(','), d ? [...d.querySelectorAll('section[data-screen][id]')].map(s => s.id).join(',') : '',
      qs.map(q => q.id + ':' + q.done).join(',')].join('|');
  }
  function paintQuick(it) {
    if (!quick || !it) return;
    const md = mode();
    const d = md === 'design' ? activeDesignOf(it) : null;
    const u = unseenOf(it);
    quick.querySelectorAll('.design-quick-designs > .design-quick-seg[data-design-id]').forEach(s => setDot(s, u.design(s.dataset.designId)));
    if (d) {
      const screens = [...d.querySelectorAll('section[data-screen][id]')];
      const cur = activeScreenOf(d);
      const idx = screens.indexOf(cur);
      const fresh = u.screens(d.dataset.design);
      quick.querySelectorAll('.design-quick-page, .design-quick-vitem').forEach(b => {
        const i = screens.findIndex(s => s.id === b.dataset.screenId);
        const isCur = i >= 0 && screens[i] === cur;
        b.dataset.active = String(isCur);
        if (isCur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        setDot(b, fresh.includes(b.dataset.screenId));
        // Every page names its key, one kind for all: the page on screen ↑
        // (a click on it goes one level up), the next Tab, the previous ←.
        // A page further away has no key and so no tooltip.
        keyTip(b, i < 0 ? '' : isCur ? '↑'
          : i === (idx + 1) % screens.length ? 'Tab' : i === idx - 1 ? '←' : '');
      });
      const chip = quick.querySelector('.design-quick-more');
      if (chip && chip.firstElementChild) {
        chip.firstElementChild.textContent = (idx + 1) + ' / ' + screens.length;
        setDot(chip, fresh.length > 0);
      }
    }
    const viewOn = md === 'view' ? it.querySelector(':scope > section[data-view][data-view-active="true"]') : null;
    const qb = quick.querySelector('.design-quick-q');
    if (qb) qb.dataset.active = String(!!viewOn);
    quick.querySelectorAll('.design-quick-qitem[data-view-id]').forEach(item => {
      item.dataset.active = String(!!viewOn && viewOn.dataset.view === item.dataset.viewId);
    });
    markQuickFocus(it);
  }
  function renderQuick(it) {
    if (!quick) return;
    if (!it || !metas.length) { quick.innerHTML = ''; quickKey = ''; return; }
    const md = mode();
    const d = md === 'design' ? activeDesignOf(it) : null;
    const fav = validFavorite(it, readState(it));
    const qs = questionsOf(it);
    const shape = quickShape(it, md, d, fav, qs);
    if (shape === quickKey && quick.firstChild) { quickMd = md; paintQuick(it); return; }
    const u = unseenOf(it);
    const row = el('div', 'design-quick-row design-quick-designs');
    metas.forEach(m => {
      if (d && d.dataset.design === m.id) {
        const g = quickGroup(d, m, u, fav);
        // The pages fan out only when a variant is ENTERED (from the overview
        // or a question) — a sideways switch just swaps the group in place.
        if (quickMd && quickMd !== 'design') g.dataset.fan = 'true';
        row.appendChild(g);
      } else row.appendChild(quickSeg(m, md !== 'design' && quickLevel < 2, u, fav));
    });
    // On the overview a variant with several pages carries a small caret:
    // shown on the highlighted one only (markQuickFocus), it hints that the
    // variant opens onto its pages.
    if (md === 'overview') {
      row.querySelectorAll('.design-quick-seg[data-design-id]').forEach(seg => {
        const dd = designsOf(it).find(x => x.dataset.design === seg.dataset.designId);
        if (dd && dd.querySelectorAll('section[data-screen][id]').length >= 2) {
          seg.appendChild(el('span', 'design-quick-subcaret', '▾'));
        }
      });
    }
    if (qs.length) row.appendChild(quickQuestions(it, qs, md));
    // One swap, no empty frame in between.
    quick.replaceChildren(row);
    quickKey = shape;
    quick.dataset.compact = String(quickCompact());
    quick.dataset.level = String(quickLevel);
    fitQuickBand();
    // Measured right away (the read forces layout): a requestAnimationFrame
    // never fires in a background tab, which left the row overflowing.
    // clientWidth, not the rect: the intro bounce scales the quick nav.
    if (quickLevel < 2 && row.scrollWidth > quick.clientWidth + 1) {
      quickLevel = d && quickLevel === 0 ? 1 : 2;
      renderQuick(it);
      return;
    }
    quickMd = md;
    paintQuick(it);
  }
  function buildQuick(it) { quickLevel = 0; quickKey = ''; renderQuick(it); }

  // ── Page transitions: the motion names the direction ───────────────────
  // Every show*() ends in updateChrome(); comparing where the user was with
  // where they are now picks one short motion (CSS § Page transitions):
  // overview -> variant zooms in from the tile, variant -> overview zooms
  // out, a sideways step (next / previous page, variant or question) slides.
  // No change, no motion — and without a direction nothing animates at all.
  let navPos = null;
  function navPosOf(it, md) {
    const d = md === 'design' ? activeDesignOf(it) : null;
    const v = md === 'view' ? it.querySelector(':scope > section[data-view][data-view-active="true"]') : null;
    return {
      it, md, d: d ? designsOf(it).indexOf(d) : -1,
      s: d ? [...d.querySelectorAll('section[data-screen][id]')].indexOf(activeScreenOf(d)) : -1,
      v: v ? viewsOf(it).indexOf(v) : -1
    };
  }
  function navDirection(a, b) {
    if (!a || a.it !== b.it) return '';
    if (a.md === b.md && a.d === b.d && a.s === b.s && a.v === b.v) return '';
    if (b.md === 'overview') return 'out';
    if (a.md === 'overview') return 'in';
    if (a.md === 'design' && b.md === 'design') return (a.d !== b.d ? b.d > a.d : b.s > a.s) ? 'next' : 'prev';
    if (a.md === 'view' && b.md === 'view') return b.v > a.v ? 'next' : 'prev';
    // The quick nav lists the variants first, the questions after them.
    return b.md === 'view' ? 'next' : 'prev';
  }
  let navTimer = 0;
  function playNav(it, md) {
    const pos = navPosOf(it, md);
    const dir = navDirection(navPos, pos);
    navPos = pos;
    window.designNavDirection = dir;
    if (!dir) return;
    if (dir === 'out') {
      // Land on the variant the user came from without the carousel sliding
      // there first: positions are set with transitions off for one beat.
      const ov = overviewOf(it);
      const cameFrom = activeDesignOf(it);
      const i = cameFrom ? slidesOf(it).findIndex(s => s.dataset.designId === cameFrom.dataset.design) : -1;
      if (i >= 0) ovIndex = i;
      if (ov) {
        ov.dataset.instant = 'true';
        clearTimeout(ov._instantTimer);
        ov._instantTimer = setTimeout(() => { ov.dataset.instant = 'false'; }, 60);
      }
    }
    body.dataset.dzNav = dir;
    clearTimeout(navTimer);
    navTimer = setTimeout(() => { delete body.dataset.dzNav; }, 320);
  }
  window.addEventListener('resize', () => {
    if (!on()) return;
    quickLevel = 0;
    quickKey = '';
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
    qs.forEach((q, i) => card.appendChild(questionItem(q, () => goQuestion(q.id), i + 1)));
  }
  function renderSubmitHint(it) {
    const ready = document.getElementById('panel-ready');
    const split = ready && ready.querySelector('.submit-split');
    if (!split) return;
    let hintEl = document.querySelector('.submit-open-questions');
    const open = on() && isLive(it) && !body.classList.contains('viewing-frozen')
      ? questionsOf(it).filter(q => !q.done) : [];
    if (!open.length) { if (hintEl) hintEl.hidden = true; return; }
    // ABOVE the call to action: the journey row (#journey, in .panel-status)
    // carries the submit button, so the hint opens that block; without a
    // journey row it sits right before the split button.
    const journey = document.getElementById('journey');
    const anchor = journey && journey.parentNode ? journey : split;
    if (!hintEl) hintEl = el('p', 'submit-open-questions');
    if (hintEl.nextSibling !== anchor || hintEl.parentNode !== anchor.parentNode) anchor.parentNode.insertBefore(hintEl, anchor);
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
    const rows = [['Esc', L.overview], ['1–9', L.keysDesign], ['⇧+1–9', L.keysView], ['Tab', L.keysNext],
     ['←/→', L.keysCarousel], ['↑/↓', L.keysLevel], ['Enter', L.open], [L.space, L.keysDock], ['F', L.fav], ['Alt+1–9', L.keysRound], ['N', L.keysNotes], [L.ctrl + '+Enter', L.keysDockNext], [L.ctrl + '+' + L.space, L.keysDockClose],
     [L.ctrl + '+' + L.keysClick, L.keysPin], ['M', L.keysMenu], ['H', L.keysHide], ['T', L.keysTheme], ['?', L.keysTitle]];
    // V only where there is a device view to switch to.
    if (document.getElementById('viewport-toggle') && body.dataset.singleViewport !== 'true') rows.splice(9, 0, ['V', L.keysViewport]);
    rows.forEach(([k, label]) => {
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
  // `?` shows the sheet AND the hotkey badges on the page (wireChromeHotkeys):
  // one key for "every hotkey", never a held Alt (it focuses the browser menu).
  function toggleSheet(force) {
    if (!sheet) return;
    const open = typeof force === 'boolean' ? force : sheet.hidden;
    sheet.hidden = !open;
    if (typeof window.conceptKeyBadges === 'function') window.conceptKeyBadges(open);
    if (open) sheet.querySelector('.design-keys-close')?.focus();
  }
  if (sheet) window.conceptKeySheet = toggleSheet;

  // ── Build / teardown ───────────────────────────────────────────────────
  let metas = [];
  // The device switch (#viewport-toggle and its per-mode icons,
  // § Responsive device views) rides next to the eye in the same quiet
  // corner; without the header it goes back to its own bottom-left spot.
  function placeDevices(inHeader) {
    const vt = document.getElementById('viewport-toggle');
    if (!vt) return;
    if (!vpHome) vpHome = { parent: vt.parentNode, next: vt.nextSibling };
    const modes = document.getElementById('viewport-modes');
    if (inHeader && H.main) {
      if (vt.parentNode !== H.main) H.main.appendChild(vt);
      if (modes && modes.previousSibling !== vt) vt.after(modes);
    } else if (vt.parentNode !== vpHome.parent) {
      vpHome.parent.insertBefore(vt, vpHome.next);
      if (modes) vt.after(modes);
    }
  }
  let vpHome = null;
  function placeEye(inHeader) {
    placeDevices(inHeader);
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
    ensureStore(it);   // pins live in the store — single-design rounds too
    if (all.length >= 2) {
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
      wrap.style.setProperty('--dz-ov-y', '0px');
      // Rects are measured through every ancestor transform: a side slide
      // sits at scale(.74), so its content read 26 % smaller and the preview
      // was fitted 26 % too large — cropped to a corner that no longer showed
      // what differs between the variants. k = that ancestor scale.
      const box0 = wrap.getBoundingClientRect();
      const k = wrap.offsetWidth && box0.width ? box0.width / wrap.offsetWidth : 1;
      const origin = box0.left;
      const originTop = box0.top;
      // Two unions: everything down to three levels, and the same without
      // full-width CONTAINERS (the screen section, a centring wrapper) — a
      // 520px widget inside a 1000px section was fitted as if it were 1000px
      // wide and sat small in a sea of empty tile. The tight union wins when
      // it found anything.
      const all = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
      const tight = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
      const add = (u, r) => {
        u.l = Math.min(u.l, (r.left - origin) / k); u.r = Math.max(u.r, (r.right - origin) / k);
        u.t = Math.min(u.t, (r.top - originTop) / k); u.b = Math.max(u.b, (r.bottom - originTop) / k);
      };
      wrap.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *').forEach(n => {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return;
        add(all, r);
        if (!(n.firstElementChild && r.width / k >= 0.9 * (wrap.offsetWidth || 1000))) add(tight, r);
      });
      const u = tight.r > tight.l ? tight : all;
      const PAD = 24;
      const content = u.r > u.l ? Math.min(1000, u.r - u.l + 2 * PAD) : 1000;
      const from = u.r > u.l ? Math.max(0, u.l - PAD) : 0;
      const tall = u.b > u.t ? u.b - u.t + 2 * PAD : 0;
      const fromY = u.b > u.t ? Math.max(0, u.t - PAD) : 0;
      // Fill the tile: as large as the width allows (up to 2.5×); content
      // that would then overflow the height is fitted by height — a phone
      // mock fully, a long desktop page only down to 70 % of the width fit
      // (its bottom may crop). Centred on both axes when it fits.
      const h = p.clientHeight;
      // strict: the region's bottom edge is the info card — a long page may
      // not crop past it into the card, so it is fitted by height in full.
      const fitIn = (aw, ah, strict) => {
        let s = Math.min(2.5, aw / content);
        if (ah > 0 && tall && tall * s > ah) s = Math.max(ah / tall, content < 700 || strict ? 0 : s * 0.7);
        return Math.max(0, s);
      };
      // The info card sits in one corner of the tile; a design blown up to
      // the full tile ran underneath it. Reserve the card's band — beside it
      // or above/below it, whichever leaves the larger design.
      let region = { x: 0, y: 0, w, h };
      const card = p.closest('.design-ov-slide')?.querySelector('.design-ov-overlay');
      const pr = p.getBoundingClientRect();
      const cr = card && !card.hidden ? card.getBoundingClientRect() : null;
      if (cr && cr.width && cr.height && pr.width) {
        const G = 16;
        const o = { l: (cr.left - pr.left) / k, r: (cr.right - pr.left) / k, t: (cr.top - pr.top) / k, b: (cr.bottom - pr.top) / k };
        const left = (o.l + o.r) / 2 < w / 2, bottom = (o.t + o.b) / 2 > h / 2;
        const side = left ? { x: o.r + G, y: 0, w: w - o.r - G, h } : { x: 0, y: 0, w: o.l - G, h };
        const band = bottom ? { x: 0, y: 0, w, h: o.t - G, strict: true } : { x: 0, y: o.b + G, w, h: h - o.b - G };
        const cands = [side, band].filter(c => c.w > 0 && c.h > 0);
        if (cands.length) region = cands.reduce((a, c) => (fitIn(c.w, c.h, c.strict) > fitIn(a.w, a.h, a.strict) ? c : a));
      }
      const scale = fitIn(region.w, region.h, region.strict);
      const y = region.h > 0 && tall ? region.y + Math.max(0, (region.h - tall * scale) / 2) - fromY * scale : 0;
      wrap.style.removeProperty('--dz-ov-scale');
      wrap.style.removeProperty('--dz-ov-x');
      wrap.style.removeProperty('--dz-ov-y');
      p.style.setProperty('--dz-ov-scale', String(scale));
      p.style.setProperty('--dz-ov-x', (region.x + (region.w - content * scale) / 2 - from * scale).toFixed(1) + 'px');
      p.style.setProperty('--dz-ov-y', y.toFixed(1) + 'px');
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
    playNav(it, md);
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
  // Notes set while body.anno-hidden is on stay visible (data-upin-fresh) until
  // the eye shows everything again. The set is shared with the document-pin
  // engine (§ Document pins); either engine clears it on un-hide.
  const freshPins = window.conceptFreshPins || (window.conceptFreshPins = new Set());
  new MutationObserver(() => {
    if (body.classList.contains('anno-hidden') || !freshPins.size) return;
    freshPins.clear();
    document.querySelectorAll('[data-upin-fresh]').forEach(n => n.removeAttribute('data-upin-fresh'));
  }).observe(body, { attributes: true, attributeFilter: ['class'] });
  let armed = null;   // 'ctrl' while the key is held, 'tap' after the header button
  let draft = null;   // the pin being placed, until saved or discarded
  function arm(kind) {
    if (!on() || mode() !== 'design') return;
    // No own-note hint / crosshair while the menu is open.
    if (body.classList.contains('panel-open')) return;
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
    if (document.body.classList.contains('panel-open')) return;
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
    // Set while everything is hidden: this note stays visible (data-upin-fresh).
    if (body.classList.contains('anno-hidden')) freshPins.add(draft.id);
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
    // The write re-renders, so the draft must be gone by then — but it stays
    // (and its editor with the typed note) when there is no store to take it.
    if (!storeOf(it)) return;
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
    if (freshPins.has(pin.id)) wrap.dataset.upinFresh = 'true';
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
    // The 📎 lives in the foot row (keys hint · 📎 · delete), never inside
    // the textarea, where it sat on the typed text and the resize grip.
    const slot = el('div', 'attach-slot');
    slot.dataset.attachSlot = upinSlot(pin.id);
    const foot = el('div', 'upin-editor-foot');
    foot.appendChild(el('span', 'upin-editor-keys', live ? L.upinKeys : ''));
    foot.appendChild(slot);
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
    // Navigation keys stop only for real text entry: a focused dock BUTTON
    // (or one in a bubble / pin editor) must not kill the overview keys.
    // isConceptTextEntry is the shared check of § Design JS; the wide
    // fieldFocused() stays the fallback (and the Ctrl-arm check above).
    const typing = typeof window.isConceptTextEntry === 'function'
      ? window.isConceptTextEntry(e.target) || window.isConceptTextEntry(document.activeElement)
      : fieldFocused(e.target);
    if (typing) return;
    const panelOpen = !!document.getElementById('decision-panel')?.classList.contains('open');
    const dockOpen = document.getElementById('feedback-dock')?.dataset.open === 'true';
    if (e.key === 'Escape') {
      if (sheet && !sheet.hidden) { toggleSheet(false); e.preventDefault(); return; }
      if (armed) { disarm(); e.preventDefault(); return; }
      if (panelOpen || dockOpen) return;
      if (mode() !== 'overview') { e.preventDefault(); window.showOverview(); }
      return;
    }
    // Digits, arrows, Enter and Tab keep working while the ☰ panel is open.
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    const n = digit ? Number(digit[1]) : 0;
    const it = visibleIteration();
    if (n && e.altKey && !e.ctrlKey && !e.metaKey) {
      const tab = document.querySelectorAll('.iteration-tabs .iteration-tab')[n - 1];
      if (tab) { e.preventDefault(); tab.click(); }
      return;
    }
    // Ctrl/Cmd + Enter never submits: a round is sent only by clicking in the
    // ☰ panel. The dock's own Ctrl + Enter / Ctrl + Space live in § Feedback dock.
    if (e.ctrlKey || e.metaKey) return;
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
    // Variant pages: ← / → step through the variant's pages even while a
    // chrome control (quick nav, header) holds the focus — the screen
    // handler of § Design JS bails on any focused button. Focus on the page
    // itself stays that handler's case, so a press never steps twice.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && mode() === 'design'
        && e.target && e.target.closest && e.target.closest('#design-quick, #design-header')) {
      const d = activeDesignOf(it);
      const screens = d ? [...d.querySelectorAll('section[data-screen][id]')] : [];
      const cur = screens.indexOf(activeScreenOf(d));
      const next = cur + (e.key === 'ArrowLeft' ? -1 : 1);
      if (cur < 0 || next < 0 || next >= screens.length) return;
      e.preventDefault();
      window.showScreen(screens[next].id);
      return;
    }
    if (mode() === 'overview' && overviewOf(it)) {
      // Enter opens the centre tile like ↓ — unless a control has the focus
      // (it answers Enter itself) — the preview's own handler covers focus on it.
      const fa = document.activeElement;
      const onPage = !fa || fa === body || fa === document.documentElement
        || (fa.tagName !== 'BUTTON' && !!fa.closest('.design-ov-slide[data-pos="cur"]'));
      if (e.key === 'ArrowDown' || (e.key === 'Enter' && onPage)) {
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

