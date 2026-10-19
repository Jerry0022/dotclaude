# Concept templates, part 06 of 16: Template: design — layout JS

## Layout JS — single-screen navigation + context-sensitive feedback

Only one screen is visible at a time, scoped to the one active design. Each
design remembers its own last-viewed page (`lastScreenByDesign`, persisted
via `saveState()`), so switching designs and back returns to that page, not
page 1. `showScreen(id)` swaps the active screen, rebuilds the position
indicator, and swaps the feedback-dock textarea to the matching per-screen
`<textarea>`.

The dock holds **one textarea per screen of EVERY design in the iteration**,
built once per iteration by `buildScreenTextareas()` — never per design
switch. Switching design or page only flips `hidden`; no node is ever
destroyed. This is load-bearing in three ways:

1. Values survive a design switch. `restoreState()` is re-invoked only at the
   two points where the dock is (re)built — the design IIFE's own
   `DOMContentLoaded` handler and `iteration:changed` — so a node destroyed
   at any other moment is never rehydrated.
2. `saveState()` serialises only nodes present in the DOM. It merges its scan
   over the previously stored blob (see § State Persistence), so a destroyed
   textarea no longer DELETES its `text:{screen-id}` key — but the note is
   still invisible and unsubmittable until a node with that `data-comment`
   exists again, and `collectDesignDecisions()` reads the DOM, not storage.
3. `collectDesignDecisions()` scans the dock; only a dock holding all designs'
   screens produces a complete `comments.screens` payload.

Same rule, same reason as `buildDesignTextareas()` for the design-level row.
Both builders carry values across the one rebuild they do have (iteration
change) via `harvestDockValues()`.

The dock itself — toggle, maximise, `applyDockSize()`, `applyDockFreezeState()`,
`primeDock()`, `markDockSubmitted()` — is NOT wired here: it is page chrome in
every template (§ Panel Chrome (all templates) → Feedback dock, #399), and this
IIFE only calls the globals that block exports. What stays here is what only a
design round has: the three row builders and the ordering of stash → rebuild
→ restore → `primeDock()` on an iteration switch (gate P14b).

```javascript
(function wireDesignLayout() {
  // Guard on the PAGE, not on the current projection: a page whose first
  // iteration is `decision` may still contain a `design` iteration further
  // down, and this IIFE only runs once at load.
  // The legacy alias `prototype` is normalised FIRST — a page that carries
  // data-template="prototype" on <html> and no data-iteration-template at
  // all (the documented legacy shape) must still wire up. Comparing the raw
  // value against 'design' only would fail both disjuncts and leave the
  // page inert.
  const DESIGN_TEMPLATES = new Set(['design', 'prototype']);
  const hasDesign = DESIGN_TEMPLATES.has(document.documentElement.dataset.template || '')
    || !!document.querySelector('section[data-iteration][data-iteration-template="design"],'
                              + 'section[data-iteration][data-iteration-template="prototype"]');
  if (!hasDesign) return;

  // Per-design "last viewed page" memory, keyed by design id. Restored from
  // localStorage's `_activeScreenByDesign` on load (see saveState below) so
  // it survives reloads, not just in-session switches.
  let lastScreenByDesign = {};
  // Two values, deliberately: the device view is a VIEWING preference that
  // belongs to the reader, while what can actually be RENDERED belongs to
  // whatever the visible iteration and design declare.
  //   viewportPref — the last mode the user chose. Persisted. NEVER clamped.
  //   viewportMode — the effective mode, derived from pref ∩ declaration.
  // Collapsing the two into one variable silently downgrades the choice: a
  // page that mixes a design iteration with a decision one (the documented
  // split for entangled questions) clamps the single variable to `desktop`
  // the moment the user clicks the decision tab, and coming back shows a
  // desktop view they never asked for. Same for a design that declares fewer
  // form factors than its neighbour.
  let viewportPref = null;
  let viewportMode = 'desktop';
  // The iteration this layout last built its chrome for. The
  // `iteration:changed` handler compares the incoming iteration against it to
  // tell a real tab switch (views are dropped, by design) from a re-entry into
  // the SAME round — the boot `showIteration()` above all, which fires the same
  // event moments after this block's own DOMContentLoaded listener restored
  // `_activeView`. Without the distinction the boot event hid the restored
  // view and the showScreen() → saveState() behind it deleted `_activeView`
  // from storage, so no question view ever survived a reload.
  let shownIterationId = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      lastScreenByDesign = saved._activeScreenByDesign || {};
      viewportPref = saved._viewportMode || null;
    }
  } catch (e) {}

  function visibleIteration() {
    return document.querySelector('section[data-iteration]:not([hidden])');
  }
  function activeDesign() {
    const it = visibleIteration();
    return it ? it.querySelector('section[data-design][data-design-active="true"]') : null;
  }
  function designs() {
    const it = visibleIteration();
    return it ? [...it.querySelectorAll('section[data-design]')] : [];
  }
  // Views (§ Views (optional)) — top-level siblings of section[data-design].
  // Mirrors designs()/activeDesign() above. A page with no data-view
  // sections simply yields an empty array everywhere below; every view
  // code path is additive and no-ops in that case.
  function views() {
    const it = visibleIteration();
    return it ? [...it.querySelectorAll('section[data-view]')] : [];
  }
  // Only returns a view that is BOTH marked active AND actually visible —
  // unlike activeDesign() above, a view's data-view-active can legitimately
  // go stale while a design is on screen (showDesign() does not touch it),
  // so callers that care about "what is on screen right now" must use this,
  // not a bare data-view-active lookup.
  function activeViewVisible() {
    const it = visibleIteration();
    return it ? it.querySelector('section[data-view][data-view-active="true"]:not([hidden])') : null;
  }

  // Label + note marker of one screen-nav row, built as DOM nodes. Never
  // innerHTML: `dataset.navLabel` hands back the DECODED attribute, so a label
  // Claude escaped correctly (`data-nav-label="Login &lt;img …&gt;"`) would be
  // parsed as markup again — a script sink on the concept page. textContent
  // keeps it text, exactly like buildSectionNav().
  function navRowLabel(row, label, idx) {
    const span = document.createElement('span');
    if (idx !== null) {
      const num = document.createElement('span');
      num.className = 'screen-idx';
      num.textContent = idx;
      span.appendChild(num);
    }
    span.appendChild(document.createTextNode(label));
    row.appendChild(span);
  }
  // `key` is the camelCase dataset key (`noteMarker` → data-note-marker).
  function navRowMarker(row, key, value) {
    const marker = document.createElement('span');
    marker.className = 'has-notes';
    marker.dataset[key] = value;
    row.appendChild(marker);
  }

  // Build screen-nav (two-level: design heading + nested pages), the design
  // switcher ghost bar, and per-screen textareas — all scoped to the
  // VISIBLE iteration (may be a frozen tab the user clicked back to, not
  // necessarily the live one).
  function buildDesignUI() {
    const allDesigns = designs();
    const active = activeDesign();
    if (!active) return;

    // Single-design collapse: CSS keys off body[data-single-design="true"]
    // to hide the switcher + design-level feedback row, mirroring
    // body[data-single-screen] below.
    document.body.dataset.singleDesign = allDesigns.length <= 1 ? 'true' : 'false';
    // Variant overview mode (§ Variant overview (≥2 designs)): the CSS gate
    // for the header, the quick nav and the overview itself. A single-design
    // round never sets it, so its chrome stays what it was.
    document.body.dataset.overview = allDesigns.length >= 2 ? 'true' : 'false';
    if (allDesigns.length < 2) document.body.dataset.overviewActive = 'false';

    // Design switcher (ghost bar) — one segment per design.
    const switcher = document.getElementById('design-switcher');
    switcher.innerHTML = '';
    allDesigns.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'design-switch-item';
      btn.type = 'button';
      btn.dataset.designId = d.dataset.design;
      btn.dataset.active = String(d === active);
      btn.textContent = d.dataset.navLabel || d.dataset.design;
      btn.addEventListener('click', () => { showDesign(d.dataset.design); });
      switcher.appendChild(btn);
    });
    // Views (§ Views (optional)) — appended to the SAME row after a thin
    // divider, only when the iteration has ≥1. Never rendered for a
    // design-only iteration (allViews.length === 0 short-circuits both the
    // divider and the loop, so the switcher's markup is byte-identical to
    // pre-views pages when no view exists).
    const allViews = views();
    if (allViews.length) {
      const divider = document.createElement('span');
      divider.className = 'switcher-divider';
      divider.setAttribute('aria-hidden', 'true');
      switcher.appendChild(divider);
      allViews.forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'view-switch-item';
        btn.type = 'button';
        btn.dataset.viewId = v.dataset.view;
        btn.dataset.active = 'false';
        btn.textContent = v.dataset.navLabel || v.dataset.view;
        btn.addEventListener('click', () => { showView(v.dataset.view); });
        switcher.appendChild(btn);
      });
    }

    // Two-level screen-nav inside the ☰ panel: one .screen-nav-group per
    // design, a heading button, then nested .screen-nav-item per page.
    const nav = document.getElementById('screen-nav');
    nav.innerHTML = '';
    // One nav row per view — the same markup whether it sits under its
    // design (`data-view-for`) or in the views group below.
    const viewNavItem = v => {
      const btn = document.createElement('button');
      btn.className = 'screen-nav-view-item';
      btn.type = 'button';
      btn.dataset.viewId = v.dataset.view;
      navRowLabel(btn, v.dataset.navLabel || v.dataset.view, null);
      navRowMarker(btn, 'viewNoteMarker', v.dataset.view);
      btn.addEventListener('click', () => { showView(v.dataset.view); closePanel(); });
      return btn;
    };
    allDesigns.forEach(d => {
      const group = document.createElement('div');
      group.className = 'screen-nav-group';

      const heading = document.createElement('button');
      heading.className = 'screen-nav-design-heading';
      heading.type = 'button';
      heading.dataset.designId = d.dataset.design;
      heading.dataset.active = String(d === active);
      navRowLabel(heading, d.dataset.navLabel || d.dataset.design, null);
      navRowMarker(heading, 'designNoteMarker', d.dataset.design);
      heading.addEventListener('click', () => { showDesign(d.dataset.design); closePanel(); });
      group.appendChild(heading);

      const screens = [...d.querySelectorAll('section[data-screen][id]')];
      // Per-design collapse flag for the TOC (§ Layout CSS,
      // .screen-nav-group[data-single-screen]). Derived from THIS design's
      // own screens — body[data-single-screen] tracks only the design on the
      // canvas, and using it here would hide every other design's rows too,
      // flipping the whole TOC on every switch.
      group.dataset.singleScreen = String(screens.length <= 1);
      screens.forEach((sec, idx) => {
        const btn = document.createElement('button');
        btn.className = 'screen-nav-item';
        btn.type = 'button';
        btn.dataset.screenId = sec.id;
        btn.dataset.designId = d.dataset.design;
        navRowLabel(btn, sec.dataset.navLabel || sec.id, `${idx + 1}.`);
        navRowMarker(btn, 'noteMarker', '');
        btn.addEventListener('click', () => {
          // Resolve the active design at CLICK time. buildDesignUI() only
          // runs on iteration:changed / DOMContentLoaded, never on a design
          // switch, so the build-time `active` above goes stale the moment
          // the ghost bar is used — and a stale `d === active` sends a
          // FOREIGN screen id into showScreen(), which then hides every
          // screen of the design actually on the canvas (blank page).
          // A VIEW on screen (§ Views (optional)) is the third case: the
          // design still carries data-design-active="true" as its own
          // "last shown page" memory, so `cur === d` reads true and a bare
          // showScreen() would only swap pages INSIDE the hidden design —
          // the view stays on the canvas and the click looks dead. Only
          // showDesign() leaves view mode, so route through it whenever a
          // view is what is actually visible.
          const cur = activeDesign();
          const viewOnScreen = document.body.dataset.viewActive === 'true';
          if (viewOnScreen || !cur || cur.dataset.design !== d.dataset.design) showDesign(d.dataset.design, sec.id);
          else showScreen(sec.id);
          closePanel();
        });
        group.appendChild(btn);
      });
      // Views tied to THIS design (`data-view-for`, § Views (optional)) sit
      // under its screens; the top-centre switcher stays one flat row.
      allViews.filter(v => v.dataset.viewFor === d.dataset.design)
        .forEach(v => group.appendChild(viewNavItem(v)));
      nav.appendChild(group);
    });

    // Second nav group, below the designs — only for the views that belong
    // to no design of this round: `data-view-for` absent, or naming a design
    // that does not exist here (a gate warning; the TOC falls back silently).
    // Heading is a plain label (no click handler): there is nothing to
    // "switch to" at the group level, only the individual views nested
    // under it. Skipped entirely when every view sits under a design.
    const freeViews = allViews.filter(v => !v.dataset.viewFor
      || !allDesigns.some(d => d.dataset.design === v.dataset.viewFor));
    if (freeViews.length) {
      const viewGroup = document.createElement('div');
      viewGroup.className = 'screen-nav-group screen-nav-views-group';
      const heading = document.createElement('div');
      heading.className = 'screen-nav-views-heading';
      heading.textContent = '{{design.nav_views_heading}}';
      viewGroup.appendChild(heading);
      freeViews.forEach(v => viewGroup.appendChild(viewNavItem(v)));
      nav.appendChild(viewGroup);
    }

    buildDesignTextareas(allDesigns, active);
    buildScreenTextareas(allDesigns);
    buildViewTextareas(allViews);
    updateScreenScope(active);
    // Overview, header, quick nav and the ☰ icon prefixes (§ Variant overview
    // JS) — rebuilt with the rest of the round's chrome, never per switch.
    if (typeof window.buildDesignOverview === 'function') window.buildDesignOverview();
    // § Attachments — rebuild bars for the freshly (re)created textareas
    // and re-render any attachments already tracked for their slot keys.
    if (typeof initCommentAttachments === 'function') initCommentAttachments();
    // LAST: the builders above read the previous stamp to decide whether the
    // text on screen was theirs to carry (harvestDockValues). Re-stamping
    // before them would make every rebuild look like a same-round one.
    const _liveNow = liveIterationId();
    if (dock.dataset.iteration !== _liveNow) delete dock.dataset.submitted;
    dock.dataset.iteration = _liveNow;
  }
  // harvestDockValues() and liveIterationId() are globals from § Panel
  // Chrome's dock block (the dock is page chrome, so the carry-over that
  // protects a rebuild belongs to it, not to this layout).

  // Per-design textareas (💬) — one per design, only the active one shown.
  // Rebuilt only when the design SET changes (buildDesignUI, i.e. iteration
  // switches). A design switch never rebuilds anything: showDesign() just
  // flips `hidden`.
  function buildDesignTextareas(allDesigns, active) {
    const container = document.getElementById('design-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allDesigns.forEach(d => {
      const ta = document.createElement('textarea');
      ta.dataset.comment = `design-${d.dataset.design}`;
      ta.dataset.designComment = d.dataset.design;
      ta.dataset.attachable = '';
      ta.placeholder = placeholder;
      ta.hidden = d !== active;
      if (carried[ta.dataset.comment]) ta.value = carried[ta.dataset.comment];
      container.appendChild(ta);
      // The mount goes DIRECTLY after its textarea — nothing in between.
      // `textarea[hidden] + .attach-slot` (§ Layout CSS) is what hides an
      // inactive field's 📎 bar, and it only reaches an adjacent sibling.
      // Same rule in buildScreenTextareas/buildViewTextareas below.
      const slot = document.createElement('div');
      slot.className = 'attach-slot';
      slot.dataset.attachSlot = ta.dataset.comment;
      container.appendChild(slot);
    });
    const label = document.getElementById('dock-design-label');
    if (label && active) label.textContent = active.dataset.navLabel || active.dataset.design;
  }

  // Per-screen textareas (💬) — one per screen of EVERY design in the
  // iteration, all hidden until showScreen() reveals the active one. Built
  // ONCE per iteration, exactly like buildDesignTextareas above; never on a
  // design switch. Destroying and rebuilding them per design lost user text
  // (restoreState never re-runs) and truncated the submit payload
  // (collectDesignDecisions scans this container).
  // data-screen-design carries the owning design id — the dock lives outside
  // section[data-design], so that attribute is the only link back.
  function buildScreenTextareas(allDesigns) {
    const container = document.getElementById('screen-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allDesigns.forEach(d => {
      d.querySelectorAll('section[data-screen][id]').forEach(sec => {
        const ta = document.createElement('textarea');
        ta.dataset.comment = sec.id;
        ta.dataset.screenComment = sec.id;
        ta.dataset.screenDesign = d.dataset.design;
        ta.dataset.attachable = '';
        ta.placeholder = placeholder;
        ta.hidden = true;
        if (carried[sec.id]) ta.value = carried[sec.id];
        container.appendChild(ta);
        const slot = document.createElement('div');
        slot.className = 'attach-slot';
        slot.dataset.attachSlot = sec.id;
        container.appendChild(slot);
      });
    });
  }

  // Per-view textareas (💬) — one per view of the iteration, built ONCE per
  // iteration exactly like buildDesignTextareas/buildScreenTextareas above,
  // for the same reason: rebuilding on every design/view switch would drop
  // unsent text and truncate collectDesignDecisions()'s comments.views scan
  // (§ Views (optional)). Only the currently-active view's textarea is
  // shown; showView() below flips `hidden`, nothing is ever destroyed.
  function buildViewTextareas(allViews) {
    const container = document.getElementById('view-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allViews.forEach(v => {
      const ta = document.createElement('textarea');
      ta.dataset.comment = `view-${v.dataset.view}`;
      ta.dataset.viewComment = v.dataset.view;
      ta.dataset.attachable = '';
      ta.placeholder = placeholder;
      ta.hidden = true;
      if (carried[ta.dataset.comment]) ta.value = carried[ta.dataset.comment];
      container.appendChild(ta);
      const slot = document.createElement('div');
      slot.className = 'attach-slot';
      slot.dataset.attachSlot = ta.dataset.comment;
      container.appendChild(slot);
    });
  }

  // Counters + single-screen collapse for the design currently active.
  // Pure projection — touches no textarea, so it is safe to call on every
  // design switch.
  function updateScreenScope(design) {
    const screens = [...design.querySelectorAll('section[data-screen][id]')];
    // Optional chaining throughout: the indicator is documented as
    // "can be hidden or simplified" for single-screen designs, so its spans
    // are genuinely optional — an unguarded write would turn that documented
    // choice into a boot-time TypeError.
    const totalEl = document.getElementById('total-screens');
    if (totalEl) totalEl.textContent = screens.length;
    // Single-screen designs: hide the per-screen FEEDBACK row (and, combined
    // with body[data-single-design], the now-empty #screen-nav). This flag
    // describes the design currently on the canvas, so it must never gate the
    // panel's per-design rows on its own — buildDesignUI() stamps
    // group.dataset.singleScreen for those. See § Layout CSS.
    document.body.dataset.singleScreen = screens.length <= 1 ? 'true' : 'false';
  }

  // ── Responsive device views ──────────────────────────────────────────
  // See § Responsive device views for the declaration attributes. Desktop
  // mode is a no-op by construction: no stage is built, nothing is cloned,
  // and the layout is what it was before this code existed.
  const VIEWPORT_MODES = ['desktop', 'tablet', 'phone'];
  const VIEWPORT_ORIENTATIONS = ['portrait', 'landscape'];
  // Portrait CSS pixels. iPad Air 11" and iPhone 15 — mid-range devices
  // whose widths (834 / 390) are the ones layouts actually break at.
  const DEVICE_SIZES = { tablet: [834, 1194], phone: [390, 844] };
  // Below this a frame's text is unreadable; scrolling the pair is the
  // better degradation than shrinking further.
  const MIN_DEVICE_SCALE = 0.3;
  const VIEWPORT_LABELS = (() => {
    const d = (document.getElementById('viewport-toggle') || {}).dataset || {};
    return {
      desktop: d.labelDesktop || 'Desktop', tablet: d.labelTablet || 'Tablet',
      phone: d.labelPhone || 'Phone',
      portrait: d.labelPortrait || 'Portrait', landscape: d.labelLandscape || 'Landscape'
    };
  })();

  // "834x1194" -> [834, 1194]. A malformed value falls back instead of
  // producing NaN geometry: a NaN width collapses the frame to 0px and the
  // mockup silently disappears with nothing logged anywhere.
  function parseDeviceSize(raw, fallback) {
    const m = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(String(raw == null ? '' : raw));
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : fallback.slice();
  }

  // Space/comma separated token list, filtered against `allowed`, order
  // preserved, duplicates dropped. Returns null when nothing valid remains so
  // callers can apply their own default rather than inheriting an empty list.
  function parseTokenList(raw, allowed) {
    const out = [];
    String(raw == null ? '' : raw).split(/[\s,]+/).forEach(tok => {
      const k = tok.trim().toLowerCase();
      if (k && allowed.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k);
    });
    return out.length ? out : null;
  }

  // Cycles the DECLARED order, never VIEWPORT_MODES: a tablet+phone concept
  // must not land on a desktop view its app does not have. An unknown current
  // value (index -1) wraps to the first entry.
  function nextViewportMode(modes, current) {
    if (!modes.length) return 'desktop';
    return modes[(modes.indexOf(current) + 1) % modes.length];
  }

  // Lays the pair out along whichever axis leaves the bigger uniform scale.
  // A fixed "stack below 900px" breakpoint is wrong in BOTH directions:
  // measured for a phone pair in a 900×800 window, side-by-side yields 0.70
  // and stacked only 0.55, while a 1000×600 window is the reverse. Deciding
  // from the two candidate scales is the same three lines and is right at
  // every size. Ties go to `row` — side by side is the point of the view.
  function bestFit(frames, availW, availH, gap) {
    const add = (a, b) => a + b;
    const span = gap * Math.max(0, frames.length - 1);
    const rowW = frames.map(f => f[0]).reduce(add, 0) + span;
    const rowH = frames.reduce((m, f) => Math.max(m, f[1]), 0);
    const colW = frames.reduce((m, f) => Math.max(m, f[0]), 0);
    const colH = frames.map(f => f[1]).reduce(add, 0) + span;
    const fit = (w, h) => (w > 0 && h > 0 && availW > 0 && availH > 0)
      ? Math.min(1, availW / w, availH / h) : 1;
    const row = fit(rowW, rowH);
    const col = fit(colW, colH);
    const axis = col > row ? 'column' : 'row';
    const raw = Math.max(row, col);
    return {
      axis,
      scale: Math.max(MIN_DEVICE_SCALE, raw),
      clamped: raw < MIN_DEVICE_SCALE,
      width: axis === 'row' ? rowW : colW,
      height: axis === 'row' ? rowH : colH
    };
  }

  // Resolution order: active design -> its iteration -> built-in default.
  // Declaring once on the iteration is the common case; the per-design
  // override exists for the rare concept whose designs target different form
  // factors. Because this reads the LIVE DOM on every call, a design switch
  // picks up the new declaration without buildDesignUI() having to re-run
  // (it deliberately does not — see buildScreenTextareas).
  function viewportSpec() {
    const design = activeDesign();
    const iter = visibleIteration();
    const read = key => (design && design.dataset[key]) || (iter && iter.dataset[key]) || '';
    const modes = parseTokenList(read('viewports'), VIEWPORT_MODES) || ['desktop'];
    const wanted = String(read('viewportDefault') || '').trim().toLowerCase();
    return {
      modes,
      orientations: parseTokenList(read('orientations'), VIEWPORT_ORIENTATIONS)
        || VIEWPORT_ORIENTATIONS.slice(),
      initial: modes.indexOf(wanted) >= 0 ? wanted : modes[0],
      sizes: {
        tablet: parseDeviceSize(read('deviceTablet'), DEVICE_SIZES.tablet),
        phone: parseDeviceSize(read('devicePhone'), DEVICE_SIZES.phone)
      }
    };
  }

  // Attributes that carry an id REFERENCE and must follow their target's
  // rename. Missing one of these is silent: the control still renders, it
  // just points at the other frame's copy.
  const ID_REF_ATTRS = ['for', 'form', 'list', 'headers',
                        'aria-labelledby', 'aria-describedby', 'aria-controls',
                        'aria-owns', 'aria-activedescendant', 'aria-details',
                        'aria-errormessage'];
  // SVG paints reference defs by url(#id); an un-rewritten one resolves to
  // the HIDDEN original's def, which works by accident in one frame and not
  // at all once the original is display:none in some browsers.
  const URL_REF_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter',
                         'marker-start', 'marker-mid', 'marker-end', 'style'];
  // Deep-clones a subtree and namespaces every identifier in it. Without this
  // the frames are two elements sharing one id (getElementById resolves to
  // whichever comes first, label[for] focuses the wrong frame) and two radios
  // in ONE group — clicking the landscape copy would clear the portrait one.
  function prefixClone(node, prefix) {
    const clone = node.cloneNode(true);
    if (clone.nodeType !== 1) return clone;
    // Same reason as the top-level filter in renderDeviceStage: a layer
    // nested deeper than the screen's direct children must not reach a frame
    // either, or its answers become unpersistable.
    clone.querySelectorAll('[data-anno-layer]').forEach(el => el.remove());
    [clone].concat([...clone.querySelectorAll('*')]).forEach(el => {
      if (el.id) el.id = prefix + el.id;
      const name = el.getAttribute('name');
      if (name) el.setAttribute('name', prefix + name);
      // Never carried into a clone: it would yank focus out of whatever the
      // user was doing on every screen switch.
      el.removeAttribute('autofocus');
      ID_REF_ATTRS.forEach(attr => {
        const v = el.getAttribute(attr);
        if (v) el.setAttribute(attr, v.split(/\s+/).filter(Boolean).map(t => prefix + t).join(' '));
      });
      URL_REF_ATTRS.forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && v.indexOf('url(#') >= 0) {
          el.setAttribute(attr, v.replace(/url\(#([^)"']+)\)/g, (_, id) => 'url(#' + prefix + id + ')'));
        }
      });
      ['href', 'xlink:href'].forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && v.charAt(0) === '#' && v.length > 1) el.setAttribute(attr, '#' + prefix + v.slice(1));
      });
    });
    return clone;
  }

  // Builds the stage for the ACTIVE screen only. Every other screen is
  // `hidden`, so cloning into all of them would duplicate the page for
  // nothing. Teardown is unconditional and page-wide: a stage left on the
  // iteration the user just switched away from keeps a stale copy alive and
  // would be found by the next fit pass.
  function renderDeviceStage(spec) {
    document.querySelectorAll('.device-stage').forEach(el => el.remove());
    document.querySelectorAll('section[data-screen][data-device-mode]')
      .forEach(s => { delete s.dataset.deviceMode; });
    if (viewportMode === 'desktop') return;
    // A view (§ Views (optional)) is the active top-level item instead of a
    // design: its screens are hidden, so there is nothing to frame. Teardown
    // above has already run, which is the whole point of returning here
    // rather than earlier.
    if (document.body.dataset.viewActive === 'true') return;
    // Same for the variant overview: no design is on screen.
    if (document.body.dataset.overviewActive === 'true') return;
    const size = spec.sizes[viewportMode];
    const design = activeDesign();
    const screen = design && design.querySelector('section[data-screen][data-screen-active="true"]');
    if (!size || !screen) return;
    // The clone source is EVERY element child except a stage — not
    // `.device-frame`. That class is a documented convention with no CSS and
    // no gate behind it, so a page that lays its mock out differently is
    // legal today; keying on it would render empty frames on exactly those
    // pages, and look correct while doing it.
    // The annotation layer (§ Annotation Layer (optional)) is authored INSIDE
    // the screen, so a naive clone carries it into both frames. Its own IIFE
    // collects [data-anno-pin] and textarea[data-annotation] DOCUMENT-WIDE and
    // keys them by attribute value, so a cloned pin would open its bubble in
    // every copy — harmless — but a cloned ANSWER is a third textarea that
    // saveState() and the submit payload both skip, because clones are
    // excluded via [data-device-clone]. An answer typed inside a device frame
    // would be silently lost. Annotations therefore stay a desktop-view
    // affordance and the frames show the mockup itself.
    const source = [...screen.children]
      .filter(el => !el.classList.contains('device-stage') && !el.hasAttribute('data-anno-layer'));
    if (!source.length) return;

    const stage = document.createElement('div');
    stage.className = 'device-stage';
    // One marker for the whole subtree. saveState() and collectAllFormFields()
    // filter on it via closest() — the clones must never reach localStorage or
    // the submit payload, where they would triple every mock field under
    // names no human ever typed into.
    stage.setAttribute('data-device-clone', '');
    const fitBox = document.createElement('div');
    fitBox.className = 'device-fit';
    const pair = document.createElement('div');
    pair.className = 'device-pair';
    fitBox.appendChild(pair);
    stage.appendChild(fitBox);

    spec.orientations.forEach((orientation, i) => {
      const landscape = orientation === 'landscape';
      const w = landscape ? size[1] : size[0];
      const h = landscape ? size[0] : size[1];
      const shell = document.createElement('div');
      shell.className = 'device-shell';
      shell.dataset.device = viewportMode;
      shell.dataset.orientation = orientation;
      // Labelled, NOT aria-hidden. Both frames are interactive by design, and
      // aria-hidden over focusable content is an ARIA violation that produces
      // a worse experience than the duplication it hides. The duplication is
      // the point of this view; naming each frame is what makes it legible.
      shell.setAttribute('role', 'group');
      shell.setAttribute('aria-label',
        (VIEWPORT_LABELS[viewportMode] || viewportMode) + ' · ' +
        (VIEWPORT_LABELS[orientation] || orientation));

      const bezel = document.createElement('div');
      bezel.className = 'device-bezel';
      bezel.dataset.device = viewportMode;
      const vp = document.createElement('div');
      vp.className = 'device-viewport';
      vp.style.setProperty('--device-w', w + 'px');
      vp.style.setProperty('--device-h', h + 'px');
      const prefix = 'dv' + (i + 1) + '-';
      source.forEach(node => vp.appendChild(prefixClone(node, prefix)));
      bezel.appendChild(vp);

      const caption = document.createElement('div');
      caption.className = 'device-caption';
      const strong = document.createElement('strong');
      strong.textContent = VIEWPORT_LABELS[orientation] || orientation;
      caption.appendChild(strong);
      caption.appendChild(document.createTextNode(' · ' + w + ' × ' + h));

      shell.appendChild(bezel);
      shell.appendChild(caption);
      pair.appendChild(shell);
    });

    screen.appendChild(stage);
    screen.dataset.deviceMode = viewportMode;
    wireFrameMirroring(pair);
  }

  // The frames render one screen twice; a box ticked in one has to tick in
  // the other, or the pair reads as two different states of the same app.
  // Index matching is exact because both frames are clones of one source.
  // The handler assigns values WITHOUT dispatching further events: an echoed
  // `input` would re-enter this handler from the twin and loop forever, and
  // the clones are excluded from persistence anyway, so there is nothing
  // downstream that needs the echo. Listeners live on the pair, which is
  // destroyed and rebuilt on every switch — nothing to unbind, nothing to leak.
  function wireFrameMirroring(pair) {
    const SEL = 'input, select, textarea';
    const sync = e => {
      const el = e.target;
      if (!el || !el.matches || !el.matches(SEL)) return;
      const shell = el.closest('.device-shell');
      if (!shell) return;
      const idx = [...shell.querySelectorAll(SEL)].indexOf(el);
      if (idx < 0) return;
      pair.querySelectorAll('.device-shell').forEach(other => {
        if (other === shell) return;
        const twin = other.querySelectorAll(SEL)[idx];
        if (!twin) return;
        if (twin.type === 'checkbox' || twin.type === 'radio') twin.checked = el.checked;
        else twin.value = el.value;
      });
    };
    pair.addEventListener('input', sync);
    pair.addEventListener('change', sync);
  }

  // Measures the pair unscaled (offsetWidth/offsetHeight are pre-transform),
  // picks the axis, then writes the scaled size onto .device-fit so the
  // LAYOUT box matches what is actually painted. Skipping that step is what
  // puts a scrollbar around empty space and pushes the top of the stage above
  // the scroll origin, where it cannot be reached at all.
  function fitDeviceStage() {
    // Scoped to the active design, exactly like renderDeviceStage's lookup.
    // showDesign() hides the previous design but leaves its screens' own
    // data-screen-active flag set, so a document-wide query here is one
    // stale flag away from measuring a screen nobody is looking at.
    const design = activeDesign();
    const stage = design && design.querySelector(
      'section[data-screen][data-screen-active="true"] .device-stage');
    if (!stage) return;
    const pair = stage.querySelector('.device-pair');
    const fitBox = stage.querySelector('.device-fit');
    if (!pair || !fitBox) return;
    const shells = [...pair.children];
    if (!shells.length) return;
    const gap = parseFloat(getComputedStyle(pair).gap) || 0;
    const frames = shells.map(s => [s.offsetWidth, s.offsetHeight]);
    const box = stage.getBoundingClientRect();
    const res = bestFit(frames, box.width, box.height, gap);
    pair.dataset.axis = res.axis;
    pair.style.transform = 'scale(' + res.scale + ')';
    fitBox.style.width = Math.ceil(res.width * res.scale) + 'px';
    fitBox.style.height = Math.ceil(res.height * res.scale) + 'px';
    stage.dataset.clamped = res.clamped ? 'true' : 'false';
  }

  function renderViewportToggle(spec) {
    const btn = document.getElementById('viewport-toggle');
    if (!btn) return;
    const current = VIEWPORT_LABELS[viewportMode] || viewportMode;
    const upcoming = nextViewportMode(spec.modes, viewportMode);
    btn.dataset.mode = viewportMode;
    // Names the NEXT state, like #feedback-toggle's open/close label swap —
    // this is a cycle, not an on/off control, so aria-pressed would be a lie.
    const label = (btn.dataset.labelPrefix ? btn.dataset.labelPrefix + ': ' : '')
      + current + ' → ' + (VIEWPORT_LABELS[upcoming] || upcoming);
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = label;
    const text = btn.querySelector('.viewport-toggle-label');
    if (text) text.textContent = current;
  }

  // The one entry point. Idempotent, so every caller can just invoke it.
  // Derives the effective mode from the preference WITHOUT writing back to
  // it — see the two-variable comment at the top of this IIFE.
  function applyViewport() {
    const spec = viewportSpec();
    viewportMode = (viewportPref && spec.modes.indexOf(viewportPref) >= 0)
      ? viewportPref : spec.initial;
    document.body.dataset.viewportMode = viewportMode;   // what is rendered
    document.body.dataset.viewportPref = viewportPref || '';  // what was chosen
    document.body.dataset.singleViewport = spec.modes.length <= 1 ? 'true' : 'false';
    renderViewportToggle(spec);
    renderDeviceStage(spec);
    fitDeviceStage();
  }
  window.applyViewport = applyViewport;

  function cycleViewport() {
    const spec = viewportSpec();
    if (spec.modes.length <= 1) return;
    // Advances from what is CURRENTLY RENDERED, not from the stored
    // preference: the user is clicking what they can see.
    viewportPref = nextViewportMode(spec.modes, viewportMode);
    applyViewport();
    if (typeof saveState === 'function') saveState();
  }

  document.getElementById('viewport-toggle')?.addEventListener('click', cycleViewport);

  // Exactly ONE resize listener, installed here at IIFE level rather than in
  // the stage builder — installing it per build would accumulate one listener
  // per screen switch, each measuring a detached stage.
  let fitFrame = 0;
  function scheduleFit() {
    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitDeviceStage(); });
  }
  window.addEventListener('resize', scheduleFit);
  // Late-arriving webfonts and images change the mock's intrinsic size after
  // the first measurement.
  window.addEventListener('load', scheduleFit);

  // Switches the active design (and, within it, the given page or its
  // remembered last-viewed page). Closes over showScreen defined below.
  window.showDesign = function(designId, screenId) {
    const it = visibleIteration();
    if (!it) return;
    // Leaving view mode, if we were in it (§ Views (optional)) — no-op when
    // already in design mode (every view already hidden/inactive). Views'
    // own data-view-active memory is intentionally NOT preserved across a
    // design switch: unlike designs, there is no "last active view" to
    // return to, showView() is always an explicit click.
    it.querySelectorAll('section[data-view]').forEach(v => {
      v.hidden = true;
      v.dataset.viewActive = 'false';
    });
    document.querySelectorAll('.view-switch-item, .screen-nav-view-item').forEach(item => {
      item.dataset.active = 'false';
    });
    document.body.dataset.viewActive = 'false';
    hideOverview(it);
    const targets = [...it.querySelectorAll('section[data-design]')];
    targets.forEach(d => {
      const match = d.dataset.design === designId;
      d.hidden = !match;
      d.dataset.designActive = match ? 'true' : 'false';
    });
    document.querySelectorAll('.design-switch-item').forEach(item => {
      item.dataset.active = String(item.dataset.designId === designId);
    });
    document.querySelectorAll('.screen-nav-design-heading').forEach(h => {
      h.dataset.active = String(h.dataset.designId === designId);
    });
    // Swap the per-design textarea (built once by buildDesignTextareas —
    // only its `hidden` state and the dock label change on switch, same
    // pattern as showScreen swapping [data-screen-comment] below).
    document.querySelectorAll('[data-design-comment]').forEach(ta => {
      ta.hidden = ta.dataset.designComment !== designId;
    });
    const dockDesignLabel = document.getElementById('dock-design-label');
    if (dockDesignLabel) dockDesignLabel.textContent = targets.find(d => d.dataset.design === designId)?.dataset.navLabel || designId;
    // Scoped to the VISIBLE iteration — design ids repeat across iterations,
    // so an unscoped lookup would resolve to a frozen iteration's node and
    // navigate the wrong section.
    const design = it.querySelector(`section[data-design="${CSS.escape(designId)}"]`);
    if (!design) return;
    updateScreenScope(design);
    const remembered = screenId || lastScreenByDesign[designId];
    const first = design.querySelector('section[data-screen]');
    const target = (remembered && design.querySelector(`#${CSS.escape(remembered)}`)) ? remembered : first?.id;
    // showScreen() is the usual route to applyViewport(). A design with no
    // screens has no target, so that route does not exist here — and the
    // device stage cloned for the PREVIOUS design's screen would stay in the
    // DOM, showing the old design's mockup under the new design's name.
    // Teardown lives inside renderDeviceStage(), so the call has to happen
    // either way.
    if (target) showScreen(target);
    else applyViewport();
    updateDesignNoteMarkers();
  };

  // Switches the active top-level item to a view (§ Views (optional)).
  // Mirrors showDesign() above: hides every OTHER top-level item (every
  // design AND every other view), marks the target visible + active, and
  // re-derives every piece of chrome that cares which item is on screen
  // (switcher, screen-nav, indicator, dock). Unlike showScreen(), there is
  // no "remembered" view to restore — the user always reaches a view via an
  // explicit click on its switcher segment or nav item.
  window.showView = function(viewId) {
    const it = visibleIteration();
    if (!it) return;
    // Hide every design (top-level) without touching data-design-active —
    // that attribute is design-vs-design memory, orthogonal to whether
    // design mode itself is what's on screen right now.
    it.querySelectorAll('section[data-design]').forEach(d => { d.hidden = true; });
    hideOverview(it);
    const allViews = views();
    let target = null;
    allViews.forEach(v => {
      const match = v.dataset.view === viewId;
      v.hidden = !match;
      v.dataset.viewActive = match ? 'true' : 'false';
      if (match) target = v;
    });
    if (!target) return; // unknown view id — leave the page as-is rather than blanking it
    document.querySelectorAll('.design-switch-item').forEach(item => { item.dataset.active = 'false'; });
    document.querySelectorAll('.view-switch-item').forEach(item => {
      item.dataset.active = String(item.dataset.viewId === viewId);
    });
    document.querySelectorAll('.screen-nav-design-heading, .screen-nav-item').forEach(item => {
      item.dataset.active = 'false';
    });
    document.querySelectorAll('.screen-nav-view-item').forEach(item => {
      item.dataset.active = String(item.dataset.viewId === viewId);
    });
    document.querySelectorAll('#feedback-dock [data-view-comment]').forEach(ta => {
      ta.hidden = ta.dataset.viewComment !== viewId;
    });
    const label = target.dataset.navLabel || viewId;
    const dockViewLabel = document.getElementById('dock-view-label');
    if (dockViewLabel) dockViewLabel.textContent = label;
    document.body.dataset.viewActive = 'true';
    updateIndicator();
    updateViewNoteMarkers();
    if (typeof window.updateDesignChrome === 'function') window.updateDesignChrome();
    if (typeof saveState === 'function') saveState();
    // Consistent with showScreen()'s screen:changed below — lets
    // wireAnnotationLayer() and any other cross-cutting listener react
    // without knowing views exist.
    document.dispatchEvent(new CustomEvent('view:changed', { detail: { id: viewId } }));
  };

  // The variant overview (§ Variant overview (≥2 designs)) — the third kind
  // of top-level item, next to designs and views. buildDesignOverview()
  // creates `[data-design-overview]` inside the visible iteration when it has
  // ≥2 designs. Showing it hides every design (data-design-active stays: it
  // is the design-vs-design memory showDesign() returns to) and every view;
  // showDesign()/showView() call hideOverview() on the way in.
  function overviewOf(it) {
    return it ? it.querySelector(':scope > [data-design-overview]') : null;
  }
  function hideOverview(it) {
    const ov = overviewOf(it);
    if (ov) ov.hidden = true;
    document.body.dataset.overviewActive = 'false';
  }
  window.showOverview = function() {
    const it = visibleIteration();
    const ov = overviewOf(it);
    if (!ov) return;
    it.querySelectorAll('section[data-design]').forEach(d => { d.hidden = true; });
    it.querySelectorAll('section[data-view]').forEach(v => {
      v.hidden = true;
      v.dataset.viewActive = 'false';
    });
    document.querySelectorAll('.design-switch-item, .view-switch-item, .screen-nav-design-heading, .screen-nav-item, .screen-nav-view-item')
      .forEach(item => { item.dataset.active = 'false'; });
    document.body.dataset.viewActive = 'false';
    ov.hidden = false;
    document.body.dataset.overviewActive = 'true';
    // Tears the device stage down (renderDeviceStage() returns early in
    // overview mode) — a framed clone of the last screen must not linger.
    applyViewport();
    updateIndicator();
    if (typeof window.updateDesignChrome === 'function') window.updateDesignChrome();
    if (typeof saveState === 'function') saveState();
    document.dispatchEvent(new CustomEvent('overview:changed'));
  };

  function updateViewNoteMarkers() {
    document.querySelectorAll('[data-view-note-marker]').forEach(marker => {
      const id = marker.dataset.viewNoteMarker;
      const ta = document.querySelector(`#feedback-dock [data-view-comment="${CSS.escape(id)}"]`);
      marker.textContent = (ta && ta.value.trim()) ? '●' : '';
    });
  }

  window.showScreen = function(id) {
    const design = activeDesign();
    if (!design) return;
    // From the variant overview a page switch is a design switch: only
    // showDesign() puts the design back on screen (it hides the overview and
    // comes straight back here, no longer in overview mode).
    if (document.body.dataset.overviewActive === 'true') { showDesign(design.dataset.design, id); return; }
    const screens = design.querySelectorAll('section[data-screen][id]');
    // Membership guard. `hidden = s.id !== id` is a blanket hide when NO
    // screen carries `id` — one foreign id (a nav entry of another design, a
    // stale deep link, a restored state pointing at a deleted screen) empties
    // the canvas with no error anywhere. Fall back to the design's first
    // screen instead: something always paints.
    if (!screens.length) return;
    if (![...screens].some(s => s.id === id)) id = screens[0].id;
    let idx = 0;
    screens.forEach((s, i) => {
      const match = s.id === id;
      s.hidden = !match;
      s.dataset.screenActive = match ? 'true' : 'false';
      if (match) idx = i;
    });
    // Scoped to the active design for the same reason as showDesign's
    // lookup: screen ids repeat across iterations.
    const screen = design.querySelector(`#${CSS.escape(id)}`);
    const label = screen?.dataset.navLabel || id;
    // Guarded like every other indicator write — see updateScreenScope().
    const labelEl = document.getElementById('active-screen-label');
    if (labelEl) labelEl.textContent = label;
    const idxEl = document.getElementById('active-screen-idx');
    if (idxEl) idxEl.textContent = idx + 1;
    const dockLabel = document.getElementById('dock-screen-label');
    if (dockLabel) dockLabel.textContent = label;
    const dockScreenDesign = document.getElementById('dock-screen-design');
    if (dockScreenDesign) dockScreenDesign.textContent = design.dataset.navLabel || design.dataset.design;
    // The dock holds every design's screen textareas, so match on the
    // owning design too — screen ids are unique per iteration, but this
    // keeps the swap correct even if a page reuses ids across designs.
    document.querySelectorAll('#feedback-dock [data-screen-comment]').forEach(ta => {
      ta.hidden = !(ta.dataset.screenComment === id
        && (!ta.dataset.screenDesign || ta.dataset.screenDesign === design.dataset.design));
    });
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      item.dataset.active = String(item.dataset.screenId === id);
    });
    lastScreenByDesign[design.dataset.design] = id;
    // Rebuilds the device frames for the screen that just became active, and
    // re-clamps the mode against what THIS design declares. Runs before
    // saveState() so the persisted `_viewportMode` is the one now on screen.
    // Every other entry point (showDesign, iteration:changed, boot) reaches
    // the switcher through this call rather than duplicating it.
    applyViewport();
    updateIndicator();
    updateNoteMarkers();
    if (typeof window.updateDesignChrome === 'function') window.updateDesignChrome();
    if (typeof saveState === 'function') saveState();
    // Lets the (optional) annotation layer refresh its per-screen counter
    // without this function knowing that layer exists — see
    // wireAnnotationLayer() below. Fired even when no listener is attached.
    document.dispatchEvent(new CustomEvent('screen:changed', { detail: { id } }));
  };

  // Rebuilds the position indicator from the locale word-primitives +
  // live numbers: "{iteration} · {design} · {page} N/total · {label}",
  // dropping the iteration segment when there is one iteration and the
  // design segment when the active iteration has one design. Never a
  // fixed-shape string — each segment is toggled `hidden` independently so
  // a missing one leaves no dangling " · ".
  function updateIndicator() {
    const totalIterations = document.querySelectorAll('section[data-iteration]').length;
    const iterEl = document.getElementById('indicator-iteration');
    if (iterEl) {
      iterEl.hidden = totalIterations <= 1;
      if (!iterEl.hidden) {
        const activeIter = document.querySelector('section[data-iteration]:not([hidden])');
        const idxEl = document.getElementById('active-iteration-idx');
        if (idxEl && activeIter) idxEl.textContent = activeIter.dataset.iteration;
      }
    }
    const designEl = document.getElementById('indicator-design');
    if (designEl) {
      const total = designs().length;
      designEl.hidden = total <= 1;
      if (!designEl.hidden) {
        const active = activeDesign();
        const labelEl = document.getElementById('active-design-label');
        if (labelEl && active) labelEl.textContent = active.dataset.navLabel || active.dataset.design;
      }
    }
    // View label swap (§ Views (optional)) — while a view is the visible
    // top-level item, the screen-counter segment hides and the view label
    // takes its place. Both spans are optional/null-guarded, same
    // discipline as every other indicator segment above.
    const viewInfoEl = document.getElementById('indicator-screen-info');
    const viewLabelEl = document.getElementById('indicator-view');
    const activeView = activeViewVisible();
    if (viewInfoEl) viewInfoEl.hidden = !!activeView;
    if (viewLabelEl) {
      viewLabelEl.hidden = !activeView;
      if (activeView) {
        const labelEl = document.getElementById('active-view-label');
        if (labelEl) labelEl.textContent = activeView.dataset.navLabel || activeView.dataset.view;
      }
    }
  }

  // Every per-screen textarea belongs to the DOCK, not to the mockup
  // section — `section[data-design]` never contains one. Note markers must
  // therefore query the dock and filter by the owning design id.
  function dockScreenTextareas(designId) {
    return [...document.querySelectorAll('#feedback-dock [data-screen-comment]')]
      .filter(ta => !designId || !ta.dataset.screenDesign || ta.dataset.screenDesign === designId);
  }

  function updateNoteMarkers() {
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      const id = item.dataset.screenId;
      const ta = dockScreenTextareas(item.dataset.designId)
        .find(t => t.dataset.screenComment === id);
      const marker = item.querySelector('[data-note-marker]');
      if (marker) marker.textContent = (ta && ta.value.trim()) ? '● Notiz' : '';
    });
    updateDesignNoteMarkers();
    updateViewNoteMarkers();
  }
  window.updateNoteMarkers = updateNoteMarkers;

  // Design heading marker: lights up when ANY of its pages, or its own
  // design-level comment field (Feedback dock, Wave "design feedback row"
  // — `[data-design-comment="{id}"]`, may not exist yet on older pages),
  // carries unsubmitted text.
  function updateDesignNoteMarkers() {
    document.querySelectorAll('[data-design-note-marker]').forEach(marker => {
      const id = marker.dataset.designNoteMarker;
      const pageHasNotes = dockScreenTextareas(id).some(ta => ta.value.trim());
      const designTa = document.querySelector(`[data-design-comment="${CSS.escape(id)}"]`);
      const designHasNotes = designTa && designTa.value.trim();
      marker.textContent = (pageHasNotes || designHasNotes) ? '●' : '';
    });
  }

  // Panel toggle: NOT here. openPanel/closePanel and their wiring live in
  // § Panel Chrome (all templates) because the ☰ panel exists on every page,
  // including one that never renders a mockup — this IIFE does not. They are
  // reached through `window.` from the dock paths below; the only thing kept
  // here is the reference the click-through guard needs.
  const panel = document.getElementById('decision-panel');
  // Dock toggle, maximise, sizing, freeze state, submitted state: NOT here
  // either (#399). The 💬 dock is page chrome like the panel, wired in
  // § Panel Chrome (all templates) → Feedback dock, and reached from this
  // IIFE through the globals it exports: harvestDockValues / liveIterationId
  // (the row builders above), stashLiveDockValues / primeDock (the
  // iteration:changed handler below), applyDockSize (restoreState). The
  // element reference is kept only for the keyboard-shortcut guard at the
  // bottom of this block.
  const dock = document.getElementById('feedback-dock');

  document.addEventListener('DOMContentLoaded', () => {
    buildDesignUI();
    // IMMEDIATELY after the rebuild and BEFORE showView()/showScreen(): the
    // dock textareas exist only NOW, and buildDesignUI() created them EMPTY.
    // showScreen() ends in saveState(), and saveState()'s merge cannot protect
    // a key whose node IS present — it would serialise those empty textareas
    // straight over the stored notes, and the restore further down would then
    // read the blob it had just blanked. Measured in a browser: one reload
    // emptied `text:{screen-id}` for good.
    // § State Persistence's own DOMContentLoaded listener is not guaranteed to
    // run before this one (the same unguaranteed ordering applyDockSize()
    // already works around), so its restoreState() may have scanned a dock
    // that did not exist yet, written nothing, and it never re-runs on its
    // own. Re-restoring here is safe: restoreState() is idempotent (it only
    // assigns values off the same stored blob) and no user input can have
    // happened before DOMContentLoaded.
    // Also deliberately BEFORE primeDock(): on a frozen tab
    // applyDockFreezeState() stashes the live values into liveDockValues and
    // paints the frozen blob over them, so restoring afterwards would clobber
    // the frozen view and lose the stash.
    if (typeof restoreState === 'function') restoreState();
    if (typeof updateNoteMarkers === 'function') updateNoteMarkers();
    const active = document.querySelector('section[data-iteration][data-active]');
    // Recorded BEFORE the view restore below: the boot showIteration() (§ Tab
    // Switch JS) fires `iteration:changed` for this same round right after,
    // and the handler keeps a restored view only when the round matches.
    shownIterationId = active ? String(active.dataset.iteration) : null;
    if (active) {
      // Work package C — restore an active VIEW first. Defensive by
      // design: an unknown/removed view id (edited between sessions, or
      // belongs to a different iteration after a reload) simply fails the
      // querySelector check below and falls through to the pre-existing
      // screen-restore path exactly as if no view had ever been active —
      // it must never leave the page blank.
      let restoredView = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restoredView = JSON.parse(raw)._activeView;
      } catch (e) {}
      const viewTarget = restoredView && active.querySelector(`section[data-view="${CSS.escape(restoredView)}"]`);
      // Variant overview (≥2 designs): a fresh page lands on the overview; a
      // reload returns to where the user was (`_overview` 'on' | 'off' plus
      // the design and page, § State Persistence). An unknown design id
      // falls back to the overview rather than to a blank canvas.
      let ovState = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const st = JSON.parse(raw);
          ovState = { mode: st._overview, design: st._overviewDesign, screen: st._overviewScreen };
        }
      } catch (e) {}
      const ovDesign = ovState && ovState.design
        && active.querySelector(`:scope > section[data-design="${CSS.escape(ovState.design)}"]`);
      if (viewTarget) {
        showView(restoredView);
      } else if (overviewOf(active)) {
        if (ovState && ovState.mode === 'off' && ovDesign) showDesign(ovState.design, ovState.screen || undefined);
        else showOverview();
      } else {
        const design = active.querySelector('section[data-design][data-design-active="true"]');
        if (design) {
          // Restore last active screen from localStorage if available,
          // otherwise default to the first screen of the active design.
          let restored = null;
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) restored = JSON.parse(raw)._activeScreen;
          } catch (e) {}
          const first = design.querySelector('section[data-screen]');
          showScreen(restored && design.querySelector(`#${CSS.escape(restored)}`) ? restored : (first ? first.id : ''));
        }
      }
    }
    updateIndicator();
    document.addEventListener('input', updateNoteMarkers);
    // Runs after the restore above, once buildDesignUI() has set the
    // body[data-single-*] flags applyDockSize() reads. The dock stays closed —
    // priming only syncs its field state and its size.
    primeDock();
    // The stage showScreen() just built cloned the mock BEFORE restoreState()
    // ran: that listener lives in a later block and therefore fires after this
    // one. A rAF callback lands after EVERY DOMContentLoaded listener, so this
    // rebuild clones the restored DOM instead of the pristine one. It is also
    // the only viewport pass a design with zero screens gets, since showScreen()
    // never runs there and the toggle would otherwise stay unbuilt.
    requestAnimationFrame(applyViewport);
  });

  // Rebuild after iteration switches (fresh designs, fresh screens, fresh
  // textareas). Preserve the previously active screen if it still exists in
  // the newly visible design; otherwise fall back to that design's
  // remembered page, or its first page.
  document.addEventListener('iteration:changed', () => {
    // Stash the OUTGOING iteration's unsent dock text before buildDesignUI()
    // empties the three containers. applyDockFreezeState() (via primeDock()
    // at the end of this handler) does the same stash, but by then the
    // harvest reads an already-rebuilt dock and writes empty strings over
    // the user's text. Design and screen ids happen to repeat across
    // iterations so harvestDockValues() masks it there; view ids are unique
    // page-wide, so a view note was lost every single time.
    // showIteration() sets body.viewing-frozen BEFORE dispatching this
    // event, so the class already describes the tab we are moving TO.
    if (document.body.classList.contains('viewing-frozen')) stashLiveDockValues();
    // Same round re-entered (the boot showIteration() above all) vs. a real
    // tab switch. A question view survives the former and never the latter:
    // on boot this block's own DOMContentLoaded listener has just restored
    // `_activeView` via showView(), and this event arrives moments later for
    // the very same round — treating it as a switch hid the view again and
    // the showScreen() → saveState() below then deleted `_activeView` from
    // storage. Only a view that is BOTH active AND on screen is kept
    // (activeViewVisible()); a stale data-view-active behind a design is not.
    const incoming = visibleIteration();
    const incomingId = incoming ? String(incoming.dataset.iteration) : null;
    const sameRound = incomingId !== null && incomingId === shownIterationId;
    const keptView = sameRound ? activeViewVisible() : null;
    // The overview survives a same-round re-entry (the boot event) like a
    // view does, and a real tab switch into a ≥2-design round lands on that
    // round's overview when the user was on one before.
    const wasOverview = document.body.dataset.overviewActive === 'true';
    shownIterationId = incomingId;
    if (!keptView) {
      // A question view never survives a tab switch. buildDesignUI() requires
      // an active design, and a stale body[data-view-active] leaves the
      // position indicator empty, kills arrow-key navigation and makes every
      // data-screen-link click-dummy inert with no visible cause.
      document.querySelectorAll('section[data-view]').forEach(v => {
        v.dataset.viewActive = 'false';
        v.hidden = true;
      });
      document.body.dataset.viewActive = 'false';
      // ...and put the designs back on screen. showView() hides every design
      // when a question view takes over the viewport, and nothing else undoes
      // that: only showDesign() un-hides, and it is not on this path. Without
      // this, a view -> other iteration tab -> back round trip lands on a
      // design that still says data-design-active="true" while being
      // display:none — no mockup, dead click-dummy, dead arrow keys, and no
      // visible cause. Verified in a browser, not deduced.
      if (incoming) {
        incoming.querySelectorAll(':scope > section[data-design]').forEach(d => {
          d.hidden = d.dataset.designActive !== 'true';
        });
      }
    }
    buildDesignUI();
    // buildDesignUI() above destroyed and rebuilt the three dock containers,
    // so the textareas below it are EMPTY again. Restore them here — before
    // applyViewport(), showScreen() and primeDock(), every one of which ends
    // in a saveState() that would write those empty nodes over the stored
    // notes (the merge only protects keys whose node is ABSENT).
    // harvestDockValues() carries what was on screen, but only that: a note
    // belonging to a screen the OUTGOING iteration never rendered a textarea
    // for exists in localStorage and nowhere else, and would come back blank.
    // Skipped while a frozen tab is on screen: applyDockFreezeState() has
    // already painted the frozen blob into the same fields and stashed the
    // live values in liveDockValues, and writing localStorage over that would
    // show live text under a read-only frozen iteration.
    if (!document.body.classList.contains('viewing-frozen')
        && typeof restoreState === 'function') restoreState();
    // BEFORE the early return below, not after: switching to a decision/free
    // iteration leaves no active design, so showScreen() — the usual route to
    // applyViewport() — never runs. Without this call the device stage of the
    // design iteration the user just left stays in the DOM, and the toggle
    // keeps offering viewports that iteration never declared.
    applyViewport();
    // Re-entered round with its view still up: buildDesignUI() rebuilt the
    // switcher, the nav and the dock textareas from scratch (every segment
    // inactive, every view textarea hidden), so re-apply the view's chrome the
    // same way a click would — showView() also ends in saveState(), which is
    // what keeps `_activeView` in storage across the boot.
    if (keptView) {
      showView(keptView.dataset.view);
      primeDock();
      updateNoteMarkers();
      return;
    }
    if (wasOverview && overviewOf(incoming)) {
      showOverview();
      primeDock();
      updateNoteMarkers();
      return;
    }
    if (incoming) hideOverview(incoming);
    const design = activeDesign();
    // A document round of this page (a decision reality-check, the free
    // final report) has no design to show — but it HAS the dock (#399: page
    // chrome in every template, general note only here), so the freeze
    // state and the compact size still have to be applied before leaving.
    // Skipping this used to be harmless only because the dock was hidden
    // outside design rounds; now it would leave the live round's note
    // editable under a frozen tab.
    if (!design) { primeDock(); updateNoteMarkers(); return; }
    const prevId = document.querySelector('[data-screen][data-screen-active="true"]')?.id;
    const stillThere = prevId && design.querySelector(`section[data-screen]#${CSS.escape(prevId)}`);
    const remembered = lastScreenByDesign[design.dataset.design];
    const first = design.querySelector('section[data-screen]');
    const target = stillThere ? prevId
      : (remembered && design.querySelector(`#${CSS.escape(remembered)}`)) ? remembered
      : first?.id;
    if (target) showScreen(target);
    // Re-sync frozen-vs-live fields and the dock size for the iteration we
    // just switched to. Never touches open/closed — a tab switch must not
    // yank the dock open over the mockup the user just navigated to.
    primeDock();
    // Last, so the ☰ "has notes" dots describe the values primeDock() left in
    // the fields — restored, stashed or frozen.
    updateNoteMarkers();
  });

  // Keyboard: Arrow Left/Right (and Space) jump between screens (within the
  // active design) when no textarea/input is focused and no overlay is open.
  document.addEventListener('keydown', e => {
    // Both optional: this handler is bound on every design page, and either
    // overlay can be absent from the markup. Unguarded, a missing one threw
    // on EVERY keypress — the arrow keys stopped working and the console
    // filled with errors pointing at the keyboard shortcut rather than at
    // the markup.
    if (dock?.dataset.open === 'true' || panel?.classList.contains('open')) return;
    // Bailing out on textarea/input alone was too narrow: Space activates a
    // FOCUSED BUTTON, so pressing it on a mock's "Continue" advanced the
    // screen and swallowed the click at the same time. Device mode doubles
    // the focusable mock surface, which is what made it worth fixing here.
    if (e.target && e.target.closest
        && e.target.closest('textarea, input, select, button, a[href], [contenteditable], [role="button"]')) return;
    // A view is scrollable prose/questions, not a screen sequence — Arrow
    // Left/Right must not hijack it into switching designs (§ Views (optional)).
    // It has no device frames either, so `v` below is equally out of scope.
    if (document.body.dataset.viewActive === 'true') return;
    if (document.body.dataset.overviewActive === 'true') return;
    // `v` cycles the device view — the keyboard equivalent of the bottom-left
    // toggle, and a no-op on concepts that declare a single viewport.
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); cycleViewport(); return; }
    const design = activeDesign();
    if (!design) return;
    const screens = [...design.querySelectorAll('section[data-screen]')];
    const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
    if (currentIdx < 0) return;
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight' || e.key === ' ') nextIdx = Math.min(currentIdx + 1, screens.length - 1);
    else if (e.key === 'ArrowLeft') nextIdx = Math.max(currentIdx - 1, 0);
    else return;
    e.preventDefault();
    showScreen(screens[nextIdx].id);
  });
})();
```


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
    question: ['M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 1.7V15', 'M12 18h.01']
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
    H.main.append(H.back, H.sep, H.iconSlot, H.name, H.star, H.eye);
    H.more = el('div', 'design-header-more');
    H.motto = el('div', 'design-header-motto');
    H.actions = el('div', 'design-header-actions');
    H.tabs = el('div', 'design-header-tabs');
    H.tabs.setAttribute('role', 'tablist');
    H.fav = el('button', 'design-fav-btn');
    H.fav.type = 'button';
    H.fav.addEventListener('click', () => {
      const d = activeDesignOf(visibleIteration());
      if (d) toggleFavorite(d.dataset.design);
    });
    H.pin = el('button', 'design-header-pin', '📍 ' + L.upinArm);
    H.pin.type = 'button';
    H.pin.setAttribute('aria-pressed', 'false');
    setTip(H.pin, L.upinArm, L.ctrl + '+' + L.keysClick);
    H.pin.addEventListener('click', () => (armed === 'tap' ? disarm() : arm('tap')));
    H.note = el('div', 'design-header-note');
    H.actions.append(H.tabs, H.fav, H.pin);
    H.more.append(H.motto, H.actions, H.note);
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
      seg.addEventListener('click', () => { if (typeof closePanel === 'function') closePanel(); window.showDesign(m.id); });
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
  function fitPreviews() {
    document.querySelectorAll('.design-ov-preview').forEach(p => {
      const w = p.clientWidth;
      if (w > 0) p.style.setProperty('--dz-ov-scale', String(w / 1200));
    });
  }
  window.addEventListener('resize', () => requestAnimationFrame(fitPreviews));
  document.addEventListener('overview:changed', () => requestAnimationFrame(fitPreviews));

  // ── Projection: header, quick nav, cards, pins ─────────────────────────
  function updateChrome() {
    const it = visibleIteration();
    const active = on() && !!overviewOf(it);
    placeEye(active);
    if (!active) { if (hint) hint.hidden = true; return; }
    const st = readState(it);
    const fav = validFavorite(it, st);
    const live = isLive(it) && !body.classList.contains('viewing-frozen');
    const md = mode();
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
      H.motto.textContent = motto;
      H.motto.hidden = !motto;
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
      H.actions.hidden = H.tabs.hidden && H.fav.hidden && H.pin.hidden;
      H.more.hidden = H.motto.hidden && H.actions.hidden && H.note.hidden;
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
      if (d) { e.preventDefault(); window.showDesign(d.dataset.design); }
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
