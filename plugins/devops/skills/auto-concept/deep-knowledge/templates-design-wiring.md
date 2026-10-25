# Concept templates, part 14 of 41: Template: design — annotation JS, click-through handler

## Annotation Layer JS — `wireAnnotationLayer()`

Entirely independent of `wireDesignLayout()` above: a page with no
`[data-anno-layer]` anywhere runs this IIFE and does nothing else, forever
(the `!toggle` early return). It never reaches into `wireDesignLayout()`'s
closed-over state — the two communicate only via the `screen:changed` /
`iteration:changed` DOM events and via `document.body.classList`, exactly
like every other cross-cutting concern on this page (`viewing-frozen`,
`panel-open`, `single-screen`, …).

```javascript
(function wireAnnotationLayer() {
  const toggle = document.getElementById('anno-toggle');
  if (!toggle) return; // no eye pill mounted — layer not used on this page

  // While one note's input is open, body[data-note-editing] makes the CSS hide
  // the connectors and summaries of all others and fade their pins.
  function syncNoteEditing() {
    const open = document.querySelector('.upin-editor:not([hidden])');
    const bubble = document.querySelector('[data-anno-bubble][data-open="true"]');
    document.querySelectorAll('.upin[data-editing], .anno[data-editing]').forEach(n => n.removeAttribute('data-editing'));
    const owner = (open && open.closest('.upin')) || (bubble && bubble.closest('.anno'));
    if (owner) { owner.dataset.editing = 'true'; document.body.dataset.noteEditing = 'true'; }
    else delete document.body.dataset.noteEditing;
  }
  window.syncNoteEditing = syncNoteEditing;
  let noteSyncQueued = false;
  new MutationObserver(() => {
    if (noteSyncQueued) return;
    noteSyncQueued = true;
    requestAnimationFrame(() => { noteSyncQueued = false; syncNoteEditing(); });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'data-open'] });

  function activeScreen() {
    // Scoped through the visible iteration and its active design, exactly
    // like wireDesignLayout()'s own activeDesign()/activeScreen() lookups —
    // this IIFE cannot reuse those closures (see note above) so the same
    // scoping is reimplemented here. An unscoped
    // 'section[data-screen][data-screen-active="true"]' would always
    // resolve to the FIRST such screen in document order: the reference
    // markup ships two simultaneously-active screens (one per design), and
    // frozen iterations keep their own data-screen-active too. Without this
    // scoping the eye pill would permanently report design 1 of iteration 1.
    const it = document.querySelector('section[data-iteration]:not([hidden])');
    if (!it) return null;
    const design = it.querySelector('section[data-design][data-design-active="true"]');
    if (!design) return null;
    return design.querySelector('section[data-screen][data-screen-active="true"]');
  }
  function annotationsInScreen(screen) {
    return screen ? [...screen.querySelectorAll('[data-anno]')] : [];
  }

  // Only one bubble open at a time, across every screen/design — a bubble
  // left open under a screen the user has since navigated away from would
  // otherwise reappear open on return.
  function openBubble(id) {
    document.querySelectorAll('[data-anno-bubble]').forEach(b => {
      b.dataset.open = String(b.dataset.annoBubble === id);
    });
    document.querySelectorAll('[data-anno-pin], [data-anno-summary]').forEach(el => {
      const owns = el.dataset.annoPin === id || el.dataset.annoSummary === id;
      el.setAttribute('aria-expanded', String(owns));
    });
    openBubbleAt(id);
  }
  function closeAllBubbles() {
    document.querySelectorAll('[data-anno-bubble]').forEach(b => { b.dataset.open = 'false'; });
    document.querySelectorAll('[data-anno-pin], [data-anno-summary]').forEach(el => {
      el.setAttribute('aria-expanded', 'false');
    });
    // A collapsed bubble is narrower than the open one it was placed as.
    layoutAnnos(annotationsInScreen(activeScreen()));
  }

  // Recomputed on every input, not just at generation time — an answer
  // typed and then deleted must revert the pin to "unanswered".
  function recomputeAnswered(anno) {
    const ta = anno.querySelector('textarea[data-annotation]');
    const pin = anno.querySelector('[data-anno-pin]');
    if (!ta || !pin) return;
    pin.dataset.answered = String(!!ta.value.trim());
  }

  // --- placement ---------------------------------------------------------
  // Two problems the percentage-only approach had, both reported from a real
  // page: pins landed in empty space next to the element they asked about,
  // and bubbles opened straight off the edge of the screen. Authored
  // coordinates stay supported (and stay the fallback), but a pin can now
  // name the element it belongs to and the bubble is always pulled back into
  // view.
  function annoLayerOf(anno) { return anno.closest('[data-anno-layer]'); }

  // data-anno-target is a CSS selector resolved INSIDE the pin's own screen,
  // so the same selector may repeat on other screens without colliding.
  // Robust anchoring: the spot comes from the LAYOUT boxes (offsetLeft /
  // offsetTop up the offsetParent chain), never from getBoundingClientRect —
  // that one reads transforms, so a note hung on an element whose mock
  // animates (a scale/translate entrance, a pulsing card) used to jump with
  // every frame, most visibly while the user was typing into it. Positions
  // are re-measured on resize, scroll and screen change only, and are frozen
  // while the note's own input has focus.
  function layoutOrigin(node) {
    let x = 0, y = 0, n = node;
    while (n && n.nodeType === 1) {
      x += n.offsetLeft || 0; y += n.offsetTop || 0;
      const p = n.offsetParent;
      if (p) { x += p.clientLeft || 0; y += p.clientTop || 0; }
      n = p;
    }
    return { x, y };
  }
  // The target's spot as percent of the layer, from layout boxes; null when
  // one of them is not laid out yet (or is no HTML element: then the caller
  // falls back to the painted rects).
  function layoutSpot(target, layer) {
    if (typeof target.offsetWidth !== 'number' || typeof layer.offsetWidth !== 'number') return null;
    if (!layer.offsetWidth || !layer.offsetHeight || !target.offsetWidth) return null;
    const lo = layoutOrigin(layer), to = layoutOrigin(target);
    return {
      x: ((to.x + target.offsetWidth - lo.x) / layer.offsetWidth) * 100,
      y: ((to.y + target.offsetHeight / 2 - lo.y) / layer.offsetHeight) * 100
    };
  }
  function anchorToTarget(anno) {
    const sel = anno.dataset.annoTarget;
    if (!sel) return;                       // authored --anno-x/--anno-y wins
    if (anno.dataset.annoMoved) return;     // the user dragged it — their spot wins
    if (anno.contains(document.activeElement)) return;   // typing: the note stays put
    const screen = anno.closest('section[data-screen]');
    const layer = annoLayerOf(anno);
    if (!screen || !layer) return;
    let target = null;
    try { target = screen.querySelector(sel); } catch (e) { target = null; }
    if (!target) return;                    // stale selector: keep last known spot
    let spot = layoutSpot(target, layer);
    if (!spot) {
      const box = layer.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      if (!box.width || !box.height || !t.width) return;   // not laid out yet
      spot = { x: ((t.right - box.left) / box.width) * 100, y: ((t.top + t.height / 2 - box.top) / box.height) * 100 };
    }
    const x = spot.x, y = spot.y;
    anno.style.setProperty('--anno-x', Math.max(0, Math.min(100, x)).toFixed(2) + '%');
    anno.style.setProperty('--anno-y', Math.max(0, Math.min(100, y)).toFixed(2) + '%');
  }

  // Reported from a real page: pins sat half off the right edge, a collapsed
  // bubble's summary ran out of the window, and an expanded bubble opened
  // under the ☰ FAB with its question clipped by the scrolling canvas. The
  // window alone is the wrong box — the canvas clips earlier, and the fixed
  // chrome paints over the layer (z-index 40) — so every placement below
  // measures against BOTH.
  const ANNO_PAD = 8;
  const ANNO_CHROME = [
    '.panel-fab', '.feedback-fab', '.anno-toggle-fab', '.screen-indicator',
    '.design-switcher', '.viewport-toggle', '.frozen-bar', '.feedback-dock',
    '.concept-decision-panel', '[data-anno-avoid]'
  ].join(', ');

  // The viewport narrowed by every ancestor that clips its overflow.
  function visibleBounds(el) {
    let b = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + ' ' + cs.overflowY)) continue;
      const r = p.getBoundingClientRect();
      b = {
        left: Math.max(b.left, r.left), top: Math.max(b.top, r.top),
        right: Math.min(b.right, r.right), bottom: Math.min(b.bottom, r.bottom)
      };
    }
    return {
      left: b.left + ANNO_PAD, top: b.top + ANNO_PAD,
      right: b.right - ANNO_PAD, bottom: b.bottom - ANNO_PAD
    };
  }

  // Fixed chrome that is actually painted right now. Hidden controls
  // (display:none, faded-out FAB while the panel is open, the closed panel
  // parked off-screen) yield no rect or an invisible one and are skipped.
  function chromeRects() {
    const out = [];
    document.querySelectorAll(ANNO_CHROME).forEach(el => {
      if (el.closest('[data-anno-layer]')) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push(r);
    });
    return out;
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }
  // Hidden area of a rect: the part outside the visible box plus the part
  // under chrome. 0 means fully readable.
  function hiddenArea(r, bounds, chrome) {
    const total = r.width * r.height;
    let hidden = total - overlapArea(r, bounds);
    chrome.forEach(c => { hidden += overlapArea(r, c); });
    return hidden;
  }
  function shifted(r, dx, dy) {
    return { left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy,
             width: r.width, height: r.height };
  }

  // Smallest (dx, dy) that puts `r` inside `bounds` and clear of every chrome
  // rect. First clamp into bounds; then, per chrome rect still covered, try
  // stepping out on each of its four sides and keep the cheapest move that
  // stays in bounds. Falls back to the clamp alone when nothing clears.
  function nudge(r, bounds, chrome) {
    let dx = 0, dy = 0;
    if (r.right > bounds.right) dx = bounds.right - r.right;
    if (r.left + dx < bounds.left) dx = bounds.left - r.left;
    if (r.bottom > bounds.bottom) dy = bounds.bottom - r.bottom;
    if (r.top + dy < bounds.top) dy = bounds.top - r.top;
    // Six passes, not three: besides the chrome, a pin in a cluster has to
    // step around its neighbours (layoutAnnos()) — one hop per obstacle.
    for (let pass = 0; pass < 6; pass++) {
      const cur = shifted(r, dx, dy);
      const hit = chrome.find(c => overlapArea(cur, c) > 0);
      if (!hit) break;
      const moves = [
        [hit.left - ANNO_PAD - cur.right, 0], [hit.right + ANNO_PAD - cur.left, 0],
        [0, hit.top - ANNO_PAD - cur.bottom], [0, hit.bottom + ANNO_PAD - cur.top]
      ].filter(([mx, my]) => {
        const n = shifted(cur, mx, my);
        return n.left >= bounds.left - 0.5 && n.right <= bounds.right + 0.5 &&
               n.top >= bounds.top - 0.5 && n.bottom <= bounds.bottom + 0.5;
      }).sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])));
      if (!moves.length) break;
      dx += moves[0][0]; dy += moves[0][1];
    }
    return [Math.round(dx), Math.round(dy)];
  }

  // The pin moves the whole .anno (pin + leader + bubble) via margins — the
  // authored/anchored --anno-x/--anno-y stay untouched, so the next pass
  // starts again from the true spot instead of compounding nudges.
  function placePin(anno, bounds, chrome) {
    const pin = anno.querySelector('[data-anno-pin]');
    anno.style.marginLeft = '';
    anno.style.marginTop = '';
    if (!pin) return;
    const r = pin.getBoundingClientRect();
    if (!r.width) return;
    const [dx, dy] = nudge(r, bounds, chrome);
    if (dx) anno.style.marginLeft = dx + 'px';
    if (dy) anno.style.marginTop = dy + 'px';
  }

  // Collapsed AND open bubbles: try the authored side, its opposite, then
  // bottom/top; keep the side with the least hidden area (ties keep the
  // earlier, i.e. authored, side), then shift what still sticks out. A
  // bubble the user cannot read is worse than one on the "wrong" side.
  const OPPOSITE = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
  function placeBubble(anno, bounds, chrome) {
    if (!anno) return;
    const bubble = anno.querySelector('[data-anno-bubble]');
    if (!bubble) return;
    if (!anno.dataset.annoSideAuthored) {
      anno.dataset.annoSideAuthored = anno.dataset.annoSide || 'right';
    }
    bounds = bounds || visibleBounds(anno);
    chrome = chrome || chromeRects();
    bubble.style.marginLeft = '';
    bubble.style.marginTop = '';
    const authored = anno.dataset.annoSideAuthored;
    const sides = [...new Set([authored, OPPOSITE[authored] || 'left', 'bottom', 'top', 'right', 'left'])];
    let best = null;
    for (const side of sides) {
      anno.dataset.annoSide = side;
      const score = hiddenArea(bubble.getBoundingClientRect(), bounds, chrome);
      if (!best || score < best.score - 0.5) best = { side, score };
      if (score === 0) break;
    }
    anno.dataset.annoSide = best.side;
    const [dx, dy] = nudge(bubble.getBoundingClientRect(), bounds, chrome);
    if (dx) bubble.style.marginLeft = dx + 'px';
    if (dy) bubble.style.marginTop = dy + 'px';
  }

  function layoutAnno(anno, bounds, chrome) {
    anchorToTarget(anno);
    bounds = bounds || visibleBounds(anno);
    chrome = chrome || chromeRects();
    placePin(anno, bounds, chrome);
    placeBubble(anno, bounds, chrome);
  }
  // Reported from a real page: two pins anchored to the same control sat on
  // the same spot and their collapsed bubbles stacked into one unreadable
  // block. Several questions on one point are fine, side by side is fine —
  // overlapping never is. So the screen is laid out in two phases: every
  // pin placed counts as an obstacle for the next pin, then every pin and
  // every bubble placed counts as one for the next bubble (the open bubble
  // goes first, so it keeps its best side and the collapsed ones make room).
  function isOpenAnno(anno) {
    return !!anno.querySelector('[data-anno-bubble][data-open="true"]');
  }
  function layoutAnnos(list) {
    if (document.body.classList.contains('anno-hidden') || !list.length) return;
    const chrome = chromeRects();
    const bounds = visibleBounds(list[0]);
    const pins = [];
    list.forEach(anno => {
      anchorToTarget(anno);
      placePin(anno, bounds, chrome.concat(pins.map(p => p.rect)));
      const pin = anno.querySelector('[data-anno-pin]');
      const r = pin && pin.getBoundingClientRect();
      if (r && r.width) pins.push({ anno, rect: r });
    });
    const bubbles = [];
    [...list.filter(isOpenAnno), ...list.filter(a => !isOpenAnno(a))].forEach(anno => {
      const others = pins.filter(p => p.anno !== anno).map(p => p.rect);
      placeBubble(anno, bounds, chrome.concat(others, bubbles));
      const bubble = anno.querySelector('[data-anno-bubble]');
      const r = bubble && bubble.getBoundingClientRect();
      if (r && r.width) bubbles.push(r);
    });
  }

  function openBubbleAt(id) {
    const anno = document.querySelector(`[data-anno="${CSS.escape(id)}"]`);
    if (!anno) return;
    const all = annotationsInScreen(activeScreen());
    if (all.includes(anno)) layoutAnnos(all); else layoutAnno(anno);
  }

  function updateAnnoUI() {
    const screen = activeScreen();
    // Reconciliation with § Views (optional): showView() never clears the
    // previously-active screen's data-screen-active, so activeScreen()
    // above can still resolve to a (now hidden) screen while a view is on
    // screen. The eye pill must not render over a view's own content. body[data-view-active] is undefined on
    // pages that never use views, so this is a pure no-op there.
    // The variant overview (§ Variant overview (≥2 designs)) hides every
    // design the same way a view does — no pin belongs on it.
    const viewActive = document.body.dataset.viewActive === 'true'
      || document.body.dataset.overviewActive === 'true';
    const all = viewActive ? [] : annotationsInScreen(screen);
    // Recompute here, not only on `input`: restoreState() writes persisted
    // answers back programmatically and fires no input event, so a reloaded
    // page would otherwise paint every already-answered pin as unanswered.
    all.forEach(anno => recomputeAnswered(anno));
    all.forEach(anchorToTarget);
    layoutAnnos(all);
    // On the overview the eye sits in the header and still owns the
    // show/hide preference for every design of the round — hiding it there
    // because the overview itself carries no pin made one click on it final
    // (reported: the eye vanished and could not be switched back on).
    const onOverview = document.body.dataset.overviewActive === 'true';
    const it = document.querySelector('section[data-iteration]:not([hidden])');
    const hidden = document.body.classList.contains('anno-hidden');
    // Counter = open (unanswered) notes of the page; the eye itself is hidden
    // only when the page has nothing to hide (no notes, no own pins, no
    // overview box) — and never while the layer is off, or it could not be
    // switched back on.
    const scope = onOverview ? (it ? [...it.querySelectorAll('section[data-design] [data-anno]')] : []) : all;
    const openCount = scope.filter(a => {
      const p = a.querySelector('[data-anno-pin]');
      return !(p && p.dataset.answered === 'true');
    }).length;
    const hideable = scope.length > 0 || !!document.querySelector('.upin')
      || (onOverview && !!document.querySelector('.design-ov'));
    toggle.hidden = !hideable && !hidden;
    const badge = document.getElementById('anno-eye-count');
    if (badge) { badge.textContent = String(openCount); badge.hidden = openCount === 0; }
    const label = (hidden ? toggle.dataset.labelShow : toggle.dataset.labelHide) || '';
    if (label) { toggle.setAttribute('aria-label', label); toggle.setAttribute('data-tip', label); }
    toggle.setAttribute('aria-pressed', String(!hidden));
  }
  // Called from § State Persistence's DOMContentLoaded handler AFTER
  // restoreState() has applied the persisted body.anno-hidden class — see
  // the note there. Exposed the same way updateNoteMarkers() is.
  window.updateAnnoUI = updateAnnoUI;
  window.closeAnnoBubbles = closeAllBubbles;

  document.querySelectorAll('[data-anno]').forEach(recomputeAnswered);

  // Pin clicks toggle their own bubble. Bubble-summary clicks (the
  // collapsed truncated-question row) do the same — either is a valid way
  // to open the same bubble. Neither must ever reach the click-through
  // handler's data-screen-link lookup — guarded there directly (§
  // Click-through Handler), not by relying on event ordering here.
  document.addEventListener('click', e => {
    // The click that ends a pin drag is not a click on the pin.
    if (suppressPinClick) { suppressPinClick = false; if (e.target.closest('[data-anno-pin]')) return; }
    const trigger = e.target.closest('[data-anno-pin], [data-anno-summary]');
    if (trigger) {
      const id = trigger.dataset.annoPin || trigger.dataset.annoSummary;
      const bubble = document.querySelector(`[data-anno-bubble="${CSS.escape(id)}"]`);
      const isOpen = bubble && bubble.dataset.open === 'true';
      if (isOpen) closeAllBubbles(); else openBubble(id);
      return;
    }
    // Clicking anywhere else in the bubble (the textarea, the attach slot)
    // must never close it; clicking anywhere outside the layer does.
    if (e.target.closest('.anno-bubble')) return;
    closeAllBubbles();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllBubbles();
  });

  // --- moving a pin --------------------------------------------------------
  // Reported from a real page: a pin sometimes sits right on what it asks
  // about, and hiding the whole layer to see it loses every other pin. So a
  // single pin can be dragged aside. A press only turns into a drag once the
  // pointer has travelled PIN_DRAG_THRESHOLD px — a click that wobbles a few
  // pixels still opens the bubble instead of nudging the pin. The new spot is
  // stored as --anno-x/--anno-y (percent of the layer, so it survives a
  // resize) plus data-anno-moved, which anchorToTarget() then respects, and
  // persisted by saveState() (`annoPos`).
  const PIN_DRAG_THRESHOLD = 10;
  let pinDrag = null;
  let suppressPinClick = false;
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || document.body.classList.contains('anno-hidden')) return;
    const pin = e.target.closest('[data-anno-pin]');
    const anno = pin && pin.closest('[data-anno]');
    const layer = anno && annoLayerOf(anno);
    if (!layer) return;
    pinDrag = { anno, pin, layer, id: e.pointerId, x0: e.clientX, y0: e.clientY, moving: false };
  });
  document.addEventListener('pointermove', e => {
    if (!pinDrag || e.pointerId !== pinDrag.id) return;
    const d = pinDrag;
    if (!d.moving) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < PIN_DRAG_THRESHOLD) return;
      d.moving = true;
      const r = d.pin.getBoundingClientRect();
      d.offX = d.x0 - (r.left + r.width / 2);
      d.offY = d.y0 - (r.top + r.height / 2);
      try { d.pin.setPointerCapture(e.pointerId); } catch (err) { /* already released */ }
      d.anno.dataset.annoDragging = 'true';
      closeAllBubbles();
    }
    e.preventDefault();
    const box = d.layer.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.max(0, Math.min(100, ((e.clientX - d.offX - box.left) / box.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - d.offY - box.top) / box.height) * 100));
    d.anno.style.marginLeft = '';
    d.anno.style.marginTop = '';
    d.anno.style.setProperty('--anno-x', x.toFixed(2) + '%');
    d.anno.style.setProperty('--anno-y', y.toFixed(2) + '%');
    d.anno.dataset.annoMoved = x.toFixed(2) + ',' + y.toFixed(2);
  });
  function endPinDrag(e) {
    if (!pinDrag || e.pointerId !== pinDrag.id) return;
    const d = pinDrag;
    pinDrag = null;
    if (!d.moving) return;
    delete d.anno.dataset.annoDragging;
    // pointerup is followed by a click on the pin in the same task; the
    // flag is cleared again right after, so it never eats a later click.
    suppressPinClick = true;
    setTimeout(() => { suppressPinClick = false; }, 0);
    layoutAnnos(annotationsInScreen(activeScreen()));
    if (typeof saveState === 'function') saveState();
  }
  document.addEventListener('pointerup', endPinDrag);
  document.addEventListener('pointercancel', endPinDrag);

  document.addEventListener('input', e => {
    if (!e.target.matches('textarea[data-annotation]')) return;
    const anno = e.target.closest('[data-anno]');
    if (!anno) return;
    recomputeAnswered(anno);
    updateAnnoUI();
    // data-comment on the same textarea already drives saveState()/
    // restoreState() (§ State Persistence) — no extra persistence code
    // needed for the answer text itself.
  });

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('anno-hidden');
    // Hiding the layer must not leave a bubble open underneath it —
    // reopening later should start from a clean collapsed state.
    if (document.body.classList.contains('anno-hidden')) closeAllBubbles();
    updateAnnoUI();
    if (typeof saveState === 'function') saveState();
  });

  // The IIFE runs before the mock has its final layout, so the first anchor
  // pass can read a half-measured box and pin the marker to a corner — where
  // it then STAYS, because nothing else recomputes on a page that is simply
  // sitting there. Re-run once the frame is painted and again on load (web
  // fonts and images move things a second time).
  requestAnimationFrame(() => updateAnnoUI());
  window.addEventListener('load', () => updateAnnoUI());

  document.addEventListener('screen:changed', updateAnnoUI);
  document.addEventListener('iteration:changed', updateAnnoUI);
  // A view takes over the whole viewport, so the pill must not keep floating
  // over it with the previous screen's count. showView() dispatches this;
  // without the listener the guard inside updateAnnoUI() never runs on the
  // design -> view transition (the reverse works only by accident, because
  // showDesign() routes through showScreen()).
  document.addEventListener('view:changed', updateAnnoUI);
  document.addEventListener('overview:changed', updateAnnoUI);
  // A resize moves every anchored pin and can push a bubble off-screen;
  // scrolling the canvas moves pins against its clip edge; opening the
  // panel or dock (body class change) puts new chrome over the layer. All
  // three re-run the placement, coalesced to one pass per frame.
  let annoFrame = 0;
  function scheduleAnnoLayout() {
    if (annoFrame) return;
    annoFrame = requestAnimationFrame(() => {
      annoFrame = 0;
      layoutAnnos(annotationsInScreen(activeScreen()));
    });
  }
  window.addEventListener('resize', () => { updateAnnoUI(); scheduleAnnoLayout(); });
  document.addEventListener('scroll', scheduleAnnoLayout, true);
  new MutationObserver(scheduleAnnoLayout)
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // The panel and dock slide in with a transition — measure again once it ends.
  document.addEventListener('transitionend', e => {
    if (e.target.matches && e.target.matches(ANNO_CHROME)) scheduleAnnoLayout();
  });
  updateAnnoUI();
})();
```

**Persistence extension:** the design layout's `saveState()` must also write
`_activeScreen: '{current-screen-id}'` AND `_activeScreenByDesign: {designId:
screenId, …}` into the localStorage payload — the former for the currently
active design (kept for backward compatibility with the single-design
degenerate case), the latter so EVERY design's last-viewed page survives a
reload, not just the one on screen at save time. **Work package C** adds
`_activeView` the same way (§ State Persistence `saveState()` already shows
the literal code, a plain DOM read of `section[data-view-active="true"]`) —
a reload used to always drop back to design mode even when the user was
reading a question view; the `DOMContentLoaded` handler below now tries the
restored view FIRST and only falls back to the screen-restore path when
there is no view id, or the id no longer resolves to a `section[data-view]`
in the active iteration. `_viewportMode` rides along
in the shared `saveState()` block below, read straight off
`body[data-viewport-pref]` so there is exactly one writer of the state blob
and no cross-scope variable to keep in sync.

## Click-through Handler

Single delegated listener that interprets `data-screen-link` on any element
inside a `[data-screen]` section, **scoped to the active design** — a link
may only target screens within its own design, never reach across into
another design's pages. Closes the ☰ panel (harmless no-op if it's not open)
and fires `showScreen()`. Returns immediately while a view is the active
top-level item (§ Views (optional)) — there is no screen on screen to
navigate within.

```javascript
document.addEventListener('click', e => {
  // Annotation pins/bubbles (§ Annotation Layer JS) live inside
  // [data-screen] too and have their own click handling — they must never
  // fall through to click-dummy navigation, even if a future pin design
  // nests a [data-screen-link] ancestor by accident.
  // User pins (§ Variant overview JS) sit inside the screen as well.
  if (e.target.closest('[data-anno-pin], [data-anno-summary], .anno-bubble, .upin')) return;
  // A view (§ Views (optional)) is the active top-level item — no design is
  // on screen to navigate within, even though a hidden design still carries
  // data-design-active="true" as its own "last shown page" memory. Bail
  // before the lookup below would otherwise resolve to that hidden design.
  if (document.body.dataset.viewActive === 'true') return;
  // Same for the variant overview: its previews are inert clones.
  if (document.body.dataset.overviewActive === 'true') return;
  const link = e.target.closest('[data-screen-link]');
  if (!link) return;
  const activeDesignEl = document.querySelector(
    'section[data-iteration]:not([hidden]) section[data-design][data-design-active="true"]');
  if (!activeDesignEl) return;
  const dest = link.dataset.screenLink;
  const screens = [...activeDesignEl.querySelectorAll('section[data-screen]')];
  const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
  let targetId = null;
  if (dest === 'next') targetId = screens[Math.min(currentIdx + 1, screens.length - 1)]?.id;
  else if (dest === 'prev') targetId = screens[Math.max(currentIdx - 1, 0)]?.id;
  else targetId = dest;
  // Guard against cross-design links: the target id must resolve to a
  // <section data-screen> INSIDE the active design, not merely exist
  // somewhere on the page.
  if (!targetId || !activeDesignEl.querySelector(`#${CSS.escape(targetId)}`)) return;
  e.preventDefault();
  if (typeof closePanel === 'function') closePanel();
  showScreen(targetId);
});
```

