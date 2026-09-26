# Concept templates, part 07 of 16: Template: design — annotation JS, click-through, screen patterns, decisions

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
  function anchorToTarget(anno) {
    const sel = anno.dataset.annoTarget;
    if (!sel) return;                       // authored --anno-x/--anno-y wins
    const screen = anno.closest('section[data-screen]');
    const layer = annoLayerOf(anno);
    if (!screen || !layer) return;
    let target = null;
    try { target = screen.querySelector(sel); } catch (e) { target = null; }
    if (!target) return;                    // stale selector: keep last known spot
    const box = layer.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    if (!box.width || !box.height || !t.width) return;   // not laid out yet
    const x = ((t.right - box.left) / box.width) * 100;
    const y = ((t.top + t.height / 2 - box.top) / box.height) * 100;
    anno.style.setProperty('--anno-x', Math.max(0, Math.min(100, x)).toFixed(2) + '%');
    anno.style.setProperty('--anno-y', Math.max(0, Math.min(100, y)).toFixed(2) + '%');
  }

  // Keep an open bubble inside the viewport: flip to the opposite side first
  // (that is what the authored side is for), then shift by whatever is still
  // sticking out. A bubble the user cannot read is worse than one that opens
  // on the "wrong" side.
  function placeBubble(anno) {
    if (!anno) return;
    const bubble = anno.querySelector('[data-anno-bubble]');
    if (!bubble || bubble.dataset.open !== 'true') return;
    if (!anno.dataset.annoSideAuthored) {
      anno.dataset.annoSideAuthored = anno.dataset.annoSide || 'right';
    }
    anno.dataset.annoSide = anno.dataset.annoSideAuthored;
    bubble.style.marginLeft = '';
    bubble.style.marginTop = '';
    const pad = 12;
    let r = bubble.getBoundingClientRect();
    if (anno.dataset.annoSide === 'right' && r.right > window.innerWidth - pad) {
      anno.dataset.annoSide = 'left';
      r = bubble.getBoundingClientRect();
    } else if (anno.dataset.annoSide === 'left' && r.left < pad) {
      anno.dataset.annoSide = 'right';
      r = bubble.getBoundingClientRect();
    }
    let dx = 0;
    if (r.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    if (dx) bubble.style.marginLeft = Math.round(dx) + 'px';
    r = bubble.getBoundingClientRect();
    let dy = 0;
    if (r.bottom > window.innerHeight - pad) dy = (window.innerHeight - pad) - r.bottom;
    if (r.top + dy < pad) dy = pad - r.top;
    if (dy) bubble.style.marginTop = Math.round(dy) + 'px';
  }

  function openBubbleAt(id) {
    const anno = document.querySelector(`[data-anno="${CSS.escape(id)}"]`);
    if (anno) { anchorToTarget(anno); placeBubble(anno); }
  }

  function updateAnnoUI() {
    const screen = activeScreen();
    // Reconciliation with § Views (optional): showView() never clears the
    // previously-active screen's data-screen-active, so activeScreen()
    // above can still resolve to a (now hidden) screen while a view is on
    // screen. The eye pill must not show a stale count — or render at all —
    // over a view's own content. body[data-view-active] is undefined on
    // pages that never use views, so this is a pure no-op there.
    const viewActive = document.body.dataset.viewActive === 'true';
    const all = viewActive ? [] : annotationsInScreen(screen);
    // Recompute here, not only on `input`: restoreState() writes persisted
    // answers back programmatically and fires no input event, so a reloaded
    // page would otherwise paint every already-answered pin as unanswered.
    all.forEach(anno => recomputeAnswered(anno));
    all.forEach(anchorToTarget);
    toggle.hidden = all.length === 0;
    // The pill counts OPEN questions, not annotations — an answered pin is
    // done, and a pill stuck at "3" after answering all three reads as broken.
    const open = all.filter(anno => {
      const pin = anno.querySelector('[data-anno-pin]');
      return !pin || pin.dataset.answered !== 'true';
    }).length;
    const countEl = document.getElementById('anno-count');
    if (countEl) countEl.textContent = String(open);
    const hidden = document.body.classList.contains('anno-hidden');
    const label = (hidden ? toggle.dataset.labelShow : toggle.dataset.labelHide) || '';
    if (label) toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(!hidden));
  }
  // Called from § State Persistence's DOMContentLoaded handler AFTER
  // restoreState() has applied the persisted body.anno-hidden class — see
  // the note there. Exposed the same way updateNoteMarkers() is.
  window.updateAnnoUI = updateAnnoUI;

  document.querySelectorAll('[data-anno]').forEach(recomputeAnswered);

  // Pin clicks toggle their own bubble. Bubble-summary clicks (the
  // collapsed truncated-question row) do the same — either is a valid way
  // to open the same bubble. Neither must ever reach the click-through
  // handler's data-screen-link lookup — guarded there directly (§
  // Click-through Handler), not by relying on event ordering here.
  document.addEventListener('click', e => {
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
  // A resize moves every anchored pin and can push an open bubble off-screen.
  window.addEventListener('resize', () => {
    updateAnnoUI();
    const open = document.querySelector('[data-anno-bubble][data-open="true"]');
    if (open) placeBubble(open.closest('[data-anno]'));
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
  if (e.target.closest('[data-anno-pin], [data-anno-summary], .anno-bubble')) return;
  // A view (§ Views (optional)) is the active top-level item — no design is
  // on screen to navigate within, even though a hidden design still carries
  // data-design-active="true" as its own "last shown page" memory. Bail
  // before the lookup below would otherwise resolve to that hidden design.
  if (document.body.dataset.viewActive === 'true') return;
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

## Screen-pattern markup

A design iteration holds one or more `<section data-design>`, each owning
its own set of pages. Each logical page inside a design is a `<section>`
with `data-screen`:

```html
<section data-iteration="1" data-iteration-template="design" data-active
         data-viewports="desktop phone" data-viewport-default="phone">
  <header class="iteration-intro">
    <h2>Iteration 1 · Login flow mockup</h2>
    <p>High-fidelity walkthrough of the three-step sign-in flow.</p>
  </header>

  <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true">
    <section id="d1-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
      <div class="device-frame">…mockup HTML for welcome screen…</div>
    </section>

    <section id="d1-s2" data-nav-label="Credentials" data-screen hidden>
      <div class="device-frame">…mockup HTML for credentials screen…</div>
    </section>

    <section id="d1-s3" data-nav-label="Success" data-screen hidden>
      <div class="device-frame">…mockup HTML for success screen…</div>
    </section>
  </section>

  <section data-design="holotable" data-nav-label="Holotable" hidden>
    <section id="d2-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
      <div class="device-frame">…mockup HTML for welcome screen…</div>
    </section>
  </section>
</section>
```

**Rules:**
- `data-screen` marks a block as a "feedback target" — it appears as a
  per-screen textarea in the dock. Use it only for screens worth commenting on.
- Every `data-screen` section MUST also have `id` and `data-nav-label` so
  the panel TOC and the feedback dock can reference it. Screen ids only need
  to be unique across the whole page — `d{design-index}-s{page-index}`
  (e.g. `d1-s1`, `d2-s1`) keeps them readable and collision-free without
  coordinating names across designs.
- Exactly one `data-design` carries `data-design-active="true"`; the others
  are `hidden`. Within the active design, exactly one `data-screen` carries
  `data-screen-active="true"`.
- **One design** → the wrapper is still required (markup shape stays
  uniform across single- and multi-design concepts) but degenerates to
  today's behaviour: no switcher, no per-design feedback field. Do not omit
  `data-design` just because there's only one.
- A design iteration section can still contain non-screen, non-design
  `<section>`s (e.g. `id="design-notes" data-nav-label="Design notes"`)
  directly under the iteration. Those appear in the TOC but NOT in the
  feedback dock.
- Iteration tabs still apply — when Claude iterates on feedback, a new
  `<section data-iteration="N+1">` is appended with updated designs/screens
  and the old one is frozen (see Shared Systems § Iteration Tabs).
- **Form factors are declared on the iteration** via `data-viewports` /
  `data-viewport-default` / `data-orientations` (§ Responsive device views).
  Omit them for a desktop-only concept. The example above declares a
  phone-first app that also has a desktop view, so the page opens in the
  phone frames and the bottom-left toggle cycles the two.
- **A screen's children are the clone source.** Everything inside
  `section[data-screen]` (whether or not it is wrapped in `.device-frame`)
  is cloned into each device frame, so it must be declarative markup —
  no `<script>`, `<canvas>`, `<style>` or `<iframe>`, no `vh`/`vw` units, no
  `position: fixed`, and no `#id` selectors in its CSS. § Responsive device
  views explains what each of those does when cloned.
- **Mock CSS is namespaced per design — never a bare generic name, never an
  engine chrome class.** A round's `<style>` (at the top of the iteration,
  outside every `section[data-screen]`) lives in the same document as the
  engine: a mock rule `.overlay { position: absolute; left: 0; pointer-events:
  none }` for its fog SVGs once restyled the decision panel, which then sat
  docked left with a dead ☰ FAB (#400). Prefix every mock class per design
  (`.d1-fog`, `.d2-card`; `mock-` is accepted too) or scope the selector
  under the design (`[data-design="d1"] .fog`). Never write a selector that
  names an engine class — `concept-decision-panel`, `panel-fab`,
  `panel-backdrop`, `feedback-fab`, `feedback-dock`, `iteration-tabs`,
  `iteration-tab`, `screen-indicator`, `design-switcher`, `frozen-bar`,
  `closeout-sheet`, `device-frame`, `panel-here`, `panel-status`,
  `concept-layout`, `concept-content` — the engine's own head stylesheet
  owns those. `post.concept.gate` blocks both shapes (validation-gate.md P32).

### Annotated screen (optional annotation layer)

A screen with concrete, element-level questions adds `[data-anno-layer]`
inside the `<section data-screen>`, one `.anno` per question. This is
**additive** to the plain shape above — `data-screen`/`id`/`data-nav-label`
work exactly the same either way:

```html
<section id="d1-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
  <div class="device-frame">…mockup HTML for welcome screen…</div>

  <div class="anno-layer" data-anno-layer>
    <div class="anno" data-anno="a1" data-anno-side="right" style="--anno-x:62.5%;--anno-y:31.2%">
      <button class="anno-pin" type="button" data-anno-pin="a1"
              aria-expanded="false" aria-controls="anno-bubble-a1"
              aria-label="{{anno.pin_label}}">1</button>
      <div class="anno-bubble" id="anno-bubble-a1" data-anno-bubble="a1" data-open="false">
        <button type="button" class="anno-bubble-summary" data-anno-summary="a1"
                aria-expanded="false" aria-controls="anno-bubble-a1">
          <span class="anno-bubble-question">Should the dispatch queue auto-refresh, or stay manual?</span>
          <span class="anno-chevron" aria-hidden="true">›</span>
        </button>
        <div class="anno-bubble-body">
          <textarea class="anno-answer" data-comment="anno-a1" data-annotation="a1" data-attachable
                    placeholder="{{anno.answer_placeholder}}"></textarea>
          <div class="attach-slot" data-attach-slot="anno-a1"></div>
        </div>
      </div>
    </div>
  </div>
</section>
```

**Rules (in addition to the plain screen rules above):**
- `[data-anno-layer]` is a plain wrapper (no positioning of its own) placed
  anywhere inside the `[data-screen]` section — it is absolutely positioned
  to the screen's own box by CSS (§ Layout CSS), so it does not need to
  live inside `.device-frame` specifically.
- Annotation ids (`data-anno`, `data-anno-pin`, `data-anno-bubble`,
  `data-anno-summary`, `data-annotation`, `data-attach-slot`'s `anno-{id}`
  suffix) MUST be unique **page-wide**. Prefix them with the screen id —
  `d1-s2-a1`, `d2-s1-a1` — which makes uniqueness structural instead of
  something the author has to remember.
  Do NOT number them `a1`, `a2` per screen. That reads harmless and is not:
  `saveState()` keys the answer as `text:anno-{id}`, so two screens both
  using `a1` share ONE storage slot — the last field saved wins, the other
  answer is gone on reload, and both pins come back showing the same text.
  The payload's `annotations[]` entries collide the same way
  (§ Decision schema). Observed in a browser, not theorised.
- **Prefer `data-anno-target` over hand-picked coordinates.** It takes a CSS
  selector resolved inside the pin's own screen (`data-anno-target=".kb-card
  .kb-title"`), and the pin is placed on that element's right edge at load,
  on every screen/design/iteration switch and on resize. Hand-guessed
  percentages drift the moment the mock reflows, and the reported symptom is
  exactly that: numbered pins floating in empty space next to the thing they
  ask about.
- `--anno-x` / `--anno-y` stay supported as percentages of the screen box and
  are the fallback whenever no target is given or the selector matches
  nothing — a stale selector keeps the last known position instead of
  collapsing the pin into a corner.
- `data-anno-side` picks the side the bubble PREFERS to open toward. It is a
  preference, not a promise: `placeBubble()` flips to the opposite side when
  the preferred one would overflow the viewport, then shifts by whatever is
  still sticking out, so a bubble is never half off-screen. The authored side
  is remembered, so the bubble returns to it as soon as there is room again.
- The pin number (`1`, `2`, …) and `{{anno.pin_label}}`'s `{n}` MUST match —
  both are the 1-based order Claude assigns per screen, not a global counter
  across the whole design.
- Every answer textarea MUST carry `data-comment="anno-{id}"` (state
  persistence, § State Persistence), `data-annotation="{id}"` (the payload
  scan, § collectDecisions (design branch)) and `data-attachable` (hook for
  a later change — do not wire uploads here). The immediately-following
  `<div class="attach-slot" data-attach-slot="anno-{id}"></div>` stays empty.
- Do not add the eye pill (`#anno-toggle`) or `body.anno-hidden` handling
  per screen — both are page-global, emitted once in § Layout, driven by
  `wireAnnotationLayer()` (§ Annotation Layer JS).

### View sections (optional)

`section[data-view]` is a top-level sibling of `section[data-design]`, not
something nested inside one — see § Views (optional) above (right before
§ Layout) for the full worked reference markup of both view kinds
(`data-view-kind="decision"` and `data-view-kind="comparison"`), their CSS
(`section[data-view]`, `.view-frame`, `.cmp-*`, `.view-switch-item`,
`.screen-nav-view-item`) and their JS (`views()`, `showView()`,
`buildViewTextareas()`). This subsection exists only as the same
cross-reference anchor § Annotated screen has above, so a reader scanning
top-to-bottom through § Screen-pattern markup does not miss that views
exist. **≥1 `data-design` remains mandatory** alongside any number of views
— see § Rules.

## Decision schema

The design submit payload's comments carry the shape every template emits —
`general` (the dock's general note, `{ text, attachments }`, always present)
and `items` (every other commented field: the dock rows as `design-{id}` /
`{screen-id}` / `view-{id}`, view decision notes as `{id}-note`) — PLUS the
design-level keyed maps `designs` / `screens` / `views`. `comments.screens`
keeps flat screen-id keying regardless of which design a screen belongs to,
so no consumer needs to learn the design nesting to read page feedback. `decisions` was always
`[]` for a design iteration with no views — it is now populated whenever the
iteration has ≥1 `data-view-kind="decision"` or `"comparison"` view, one
entry per `[data-decision]` group across every view, each tagged with the
owning `view` id (§ Views (optional)). A `data-view-kind="mapping"` view
contributes no `decisions[]` entry; its result is one `mappings[]` entry:

```json
{
  "submitted": true,
  "template": "design",
  "iteration": 2,
  "decisions": [
    { "id": "nav-tabs", "label": "Tabs", "evaluation": "include", "view": "nav-model", "note": "only for the desktop layout" },
    { "id": "nav-drawer", "label": "Drawer", "evaluation": "discard", "view": "nav-model", "note": "" },
    { "id": "compact", "label": "Compact", "evaluation": "include", "view": "card-density", "note": "" }
  ],
  "comments": {
    "general": { "text": "...", "attachments": [ { "id": "<sha256>.png", "name": "shot.png", "mime": "image/png", "size": 84213, "path": ".claude/concepts/{{slug}}/attachments/<sha256>.png" } ] },
    "items": [
      { "id": "design-dispatch", "text": "...", "attachments": [] },
      { "id": "d1-s1", "text": "...", "attachments": [] },
      { "id": "view-nav-model", "text": "...", "attachments": [] },
      { "id": "nav-tabs-note", "text": "only for the desktop layout", "attachments": [] }
    ],
    "designs": { "dispatch": "...", "holotable": "..." },
    "screens": { "d1-s1": "...", "d1-s2": "..." },
    "views": { "nav-model": "...", "card-density": "..." }
  },
  "annotations": [
    {
      "id": "a1",
      "screen": "d1-s1",
      "design": "dispatch",
      "question": "Should the dispatch queue auto-refresh, or stay manual?",
      "answer": "Auto-refresh, but with a manual pause toggle."
    }
  ],
  "attachments": {
    "general": [ { "id": "<sha256>.png", "name": "shot.png", "mime": "image/png", "size": 84213, "path": ".claude/concepts/{{slug}}/attachments/<sha256>.png" } ],
    "design-dispatch": [],
    "d1-s1": [],
    "view-nav-model": [],
    "anno-a1": [],
    "nav-tabs-note": []
  },
  "mappings": [
    {
      "id": "veh_a", "label": "Field mapping · Card A", "view": "fields_a", "design": "card_a",
      "mode": "schema",
      "assigned":   { "card@phone": [["plate","card.header"], ["status","card.badge"]],
                      "card@desktop": [["plate","card.header"]] },
      "order":      { "card.line1@phone": ["mileage","location"] },
      "diff":       [ {"item":"colour","target":"card.overview","ctx":"phone","proposed":false,"now":true},
                      {"item":"fuel","target":"card.line2","ctx":"phone","proposed":true,"now":false} ],
      "unassigned": ["chassis","battery"],
      "violations": [ {"target":"card.line2","ctx":"phone","kind":"min","have":0,"want":1},
                      {"item":"plate","kind":"required"} ],
      "adhocItems": ["Next inspection"],
      "note": "…",
      "slotNotes":  { "card.badge": "…" }
    }
  ]
}
```

`mappings` is always present — `[]` without a mapping view, otherwise one
entry per live `section[data-mapping]` (frozen rounds and sections with a
`.map-error` never contribute), produced by `collectMappings()`
(§ Information Mapping (engine)). Inside an entry, `view` / `design` / `ctx`
are present **only when applicable** — `view` when the section sits inside a
`section[data-view]`, `design` when that view carries `data-view-for`,
`ctx` on `diff[]` / `violations[]` entries only when the spec has a
`context`; every other key is always present (empty-array / empty-object
convention). `mode` is the view the user last had open (`"matrix"` for an
axes-only spec). `assigned` is keyed by **matrix key**
(`{elementId|axisId}` or `{elementId|axisId}@{ctx}`) and holds the checked
`[item, target]` pairs of that matrix; `order` is keyed `{target}[@ctx]` for
ordered parts only. `unassigned` means *assigned nowhere across ALL matrices
of the mapping* (the `Σ` column in the UI is per matrix). `violations[]`
kinds: `one` / `min` / `max` (per target, with `have` / `want`), `min1`
(per item and `source`, an element / axis with `itemTargets: "min1"`),
`required` (per item, mapping-wide). `note` is the dock's view-level text
in a design round and the inline `map-{m}-note` text in a free round;
`slotNotes` holds only the non-empty ones, keyed by target key. **`diff` is
what Claude reads first, `assigned` is the full truth**, and `allFields`
carries the compact state strings (`map-{m}-cells-…`, `-order-…`, `-adhoc`,
`-ui`) — never the checkboxes, which are unnamed on purpose (§ Information
Mapping (engine) → State). A `decisions[]` or `mappings[]` entry from a view
carrying `data-view-for="{designId}"` additionally has
`"design": "{designId}"`; the key is absent for a variant-independent view.

`decisions[]` entries use the **same shape as the decision template's own
schema** (`{id, label, evaluation}` — § Bi-State Variant Evaluation →
Decision schema — `evaluation` is `"include"` or `"discard"`), plus the
`view` field so Claude knows which view each entry answers and the `note`
field carrying the mandatory adjacent `{decisionId}-note` textarea (empty
string when the user left it blank) — the verdict without the reasoning is
half the message, and it must not be reachable only through `allFields`.
The comparison view's freer controls (favourite radios, criteria-matrix
selects, weight sliders) deliberately stay untyped and arrive in
`allFields` — they are author-invented per page, so no fixed schema can
describe them. A design
iteration with no views still emits `"decisions": []`, never omits the key
— same empty-array convention as `annotations` above. `comments.views` is
**optional and only present when the iteration has ≥1 view** — a view-less
design iteration emits `"views": {}`, matching how `comments.designs`
already degenerates to `{}` for a single-design iteration. Only views with
non-empty, trimmed dock text are included, same trimming rule as every
other `comments.*` level.

`annotations` is **optional** and only present when the page uses the
annotation layer (§ Annotation Layer (optional)) — a page with none emits
`"annotations": []`, never omits the key (same convention as the empty
`"decisions": []` above, so consumers never need an existence check). Only
entries with a non-empty, trimmed `answer` are included — an unanswered pin
contributes nothing to the payload, matching how `comments.*` already skips
empty fields. `question` is read from the pin's bubble markup at submit
time (`.anno-bubble-question` textContent), not hand-duplicated anywhere.

`attachments` is a top-level map, keyed by the same slot key every
`textarea[data-attachable]` carries as its `data-comment` value (`general`,
`design-{id}`, `{screenId}`, `view-{id}`, `anno-{id}`, `{decisionId}-note`)
— see § Attachments. Each value is the array `attachmentsFor(slotKey)`
already produces (`{id, name, mime, size, path}`, synced files only). A slot
with zero attachments is simply absent from the map — it is not padded with
an empty array, unlike `comments.*`, because the map itself may legitimately
be `{}` for an iteration where nothing was attached. This is a *separate*
top-level key from the shared `comments.general.attachments` /
`comments.items[].attachments` (§ collectDecisions (dispatcher)) — those
cover the commented fields; this map is the complete per-slot index of the
round (annotation answers included), which is why it stays its own key.

## collectDecisions (design branch)

```javascript
// Called by the shared submit handler; `data-template` picks the branch.
// Generic querySelectorAll('input, select, textarea') per the coverage gate
// (iteration-rules.md § coverage gate) — no hand-listed field ids. Scoped to
// #feedback-dock rather than [data-active]: the dock is an overlay that
// lives outside section[data-iteration] in the DOM.
// The dock holds a textarea for EVERY screen of EVERY design in the active
// iteration (buildScreenTextareas), not just the design on screen — the
// non-active ones are `hidden`, which does not affect querySelectorAll. That
// is what makes this scan complete: an earlier version rebuilt the container
// per design switch, so submitting a 2-design iteration shipped only the
// design the user happened to be looking at and silently dropped the rest.
// The dock's textareas are rebuilt per iteration and its storage keys carry
// the round number (§ State Persistence `_iterationPrefix`), so it never
// carries a previous iteration's text into the next payload — and, unlike the
// old submit-time wipe that guaranteed the same thing, it does not destroy the
// round's comments while the user is still waiting to read them back.
function collectDesignDecisions() {
  const active = document.querySelector('section[data-iteration][data-active]');
  // The shared shape first — { general: { text, attachments }, items } over
  // the live round + the dock (§ collectDecisions (dispatcher),
  // collectComments) — then the design-specific keyed maps on top: the same
  // dock rows, keyed by design / screen / view id so no consumer has to
  // parse the `design-{id}` / `view-{id}` item ids.
  const comments = { ...collectComments(active || document), designs: {}, screens: {}, views: {} };
  document.querySelectorAll('#feedback-dock input, #feedback-dock select, #feedback-dock textarea').forEach(el => {
    const value = (el.value || '').trim();
    if (!value) return;
    if (el.dataset.designComment) comments.designs[el.dataset.designComment] = value;
    else if (el.dataset.screenComment) comments.screens[el.dataset.screenComment] = value;
    // Views (§ Views (optional)) — same "dock lives outside
    // section[data-iteration]" reasoning as designs/screens above.
    else if (el.dataset.viewComment) comments.views[el.dataset.viewComment] = value;
  });
  // Decisions authored inside views (§ Views (optional)) — reuses the same
  // [data-decision] bi-state markup and value convention
  // ("include"/"discard") as the decision template's own cards (§ Bi-State
  // Variant Evaluation), just scanned wherever it lives on THIS page: unlike
  // the dock, views live INSIDE section[data-iteration][data-active], so
  // this scan is scoped to `active` directly, same as the annotations scan
  // below. Every view is scanned regardless of which is on screen — a view
  // rebuilds nothing on switch (only `hidden` flips), so this sees all of
  // them. A design iteration with no views yields `decisions: []`, the same
  // empty-but-present convention as `annotations` below.
  const decisions = [];
  if (active) {
    active.querySelectorAll('section[data-view]').forEach(view => {
      view.querySelectorAll('[data-decision]').forEach(group => {
        const checked = group.querySelector('input[type="radio"]:checked');
        if (!checked) return;
        // The adjacent {decisionId}-note textarea is mandatory (§ View kind
        // decision, and ensureCommentSlots() injects it when an author
        // forgets). Without it here the typed payload reports the verdict
        // and drops the reasoning, leaving it reachable only through the
        // untyped allFields bag. Look inside the group, then its card, then
        // the view — ensureCommentSlots() appends next to the group, hand
        // authored markup tends to put it one level up.
        const decisionId = group.dataset.decision;
        const noteEl = group.querySelector(`[data-comment="${decisionId}-note"]`)
          || (group.parentElement && group.parentElement.querySelector(`[data-comment="${decisionId}-note"]`))
          || view.querySelector(`[data-comment="${decisionId}-note"]`);
        const entry = {
          id: decisionId,
          label: group.dataset.label || decisionId,
          evaluation: checked.value,
          view: view.dataset.view,
          note: ((noteEl && noteEl.value) || '').trim()
        };
        // A view tied to one variant (`data-view-for`, § Views (optional))
        // tags its decisions with that design; a variant-independent view
        // carries no key at all rather than `design: null`.
        if (view.dataset.viewFor) entry.design = view.dataset.viewFor;
        decisions.push(entry);
      });
    });
  }
  // Annotations (§ Annotation Layer (optional)) live INSIDE
  // section[data-iteration][data-active] — unlike the dock above, which is
  // an overlay outside it — so this scan is scoped to `active` directly.
  // Every design's screens are scanned regardless of which is on screen
  // (same "every design, not just the active one" rule the dock scan
  // relies on): the annotation layer is a per-screen DOM fixture, not
  // something rebuilt on design switch, so querySelectorAll sees all of
  // them whether their screen is currently `hidden` or not. Only answered
  // pins (non-empty, trimmed textarea) produce an entry — an optional
  // feature that ships zero completed annotations must still emit
  // "annotations": [] (see § Decision schema), not omit the key.
  const annotations = [];
  if (active) {
    active.querySelectorAll('[data-anno]').forEach(anno => {
      const ta = anno.querySelector('textarea[data-annotation]');
      const answer = ta ? (ta.value || '').trim() : '';
      if (!answer) return;
      const screen = anno.closest('section[data-screen][id]');
      const design = anno.closest('section[data-design]');
      const questionEl = anno.querySelector('.anno-bubble-question');
      annotations.push({
        id: anno.dataset.anno,
        screen: screen ? screen.id : null,
        design: design ? design.dataset.design : null,
        question: questionEl ? questionEl.textContent.trim() : '',
        answer
      });
    });
  }
  // Attachments (§ Attachments) — one entry per slot key that has at least
  // one synced file. `comments.general.attachments` / `items[].attachments`
  // already carry the commented fields' files; this map is the complete
  // per-slot index (annotation answers included), walking every slot the
  // attachment engine knows about rather than re-deriving the list from the
  // DOM.
  const attachments = {};
  if (typeof attachmentsFor === 'function' && typeof _attachments !== 'undefined') {
    for (const slotKey of _attachments.keys()) {
      const list = attachmentsFor(slotKey);
      if (list.length) attachments[slotKey] = list;
    }
  }
  // Mappings (§ Information Mapping (engine)) — the engine's own collector,
  // scoped to the live round like the scans above; `[]` on a page whose
  // engine block is absent, so the key is always present (§ 9 uniform shape).
  // `window.` on purpose: a bare `typeof collectMappings` here hits the TDZ of this very const.
  const collectMappings = (typeof window.collectMappings === 'function') ? window.collectMappings : () => [];
  return {
    submitted: true,
    template: 'design',
    iteration: active ? Number(active.dataset.iteration) : undefined,
    decisions,
    comments,
    annotations,
    attachments,
    mappings: collectMappings(active || document)
  };
}
```

---

