# Concept templates, part 04 of 46: Panel chrome — page-level JS


```javascript
// --- Panel chrome (all templates) ---
// Wired at page level, NOT inside the design layout IIFE: a decision- or
// free-only page never runs that IIFE, and when the panel toggle lived there
// such a page had a FAB that did nothing (which is why the panel used to be
// hidden and docked instead).
(() => {
  // Deferred until the DOM is parsed. The generated page puts its inline
  // <script> last in <body>, so this normally runs with everything present —
  // but this block is now on EVERY page, and a page whose script block ends
  // up higher (a re-sync, a hand edit) would otherwise log "markup
  // incomplete" and hand the user an inert ☰ on every template at once.
  const boot = () => {
  const panel = document.getElementById('decision-panel');
  const panelToggle = document.getElementById('panel-toggle');
  const panelCloseBtn = document.getElementById('panel-close');
  const backdrop = document.getElementById('panel-backdrop');
  // These four used to be dereferenced unguarded, and a page missing any one
  // of them died with a TypeError that took every listener after it down —
  // silently: no visible error, just a page that ignores every click.
  const missingPanelParts = [
    ['decision-panel', panel], ['panel-toggle', panelToggle],
    ['panel-close', panelCloseBtn], ['panel-backdrop', backdrop],
  ].filter(([, el]) => !el).map(([id]) => id);
  if (missingPanelParts.length) {
    console.error('[concept] decision-panel markup incomplete, panel disabled — missing: '
      + missingPanelParts.join(', '));
  }
  // The design switcher auto-hides while the panel is open (the panel carries
  // the same navigation) — driven by body.panel-open, see Layout CSS.
  // The ☰ panel and the 💬 dock are both right-edge overlays and therefore
  // mutually exclusive: opening one minimises the other, so they can never
  // sit expanded on top of each other. The reciprocal call belongs in the
  // OPEN paths only — a close path must never touch the other overlay, or
  // dismissing one would resurrect the other.
  // closeDock goes through `window.` and is optional on purpose: it is
  // exported by the dock block below (same section, every template) once
  // that has booted, and a page whose dock markup is missing must still be
  // able to open its panel.
  window.openPanel = () => {
    const dock = document.getElementById('feedback-dock');
    const fromDock = dock?.contains(document.activeElement);
    window.closeDock?.(true);
    panel?.classList.add('open');
    backdrop?.classList.add('visible');
    panelToggle?.classList.add('hidden');
    // Tooltip + a11y label name the NEXT action, exactly like the 💬 FAB.
    // Written inline (no shared helper) because both labels are read off the
    // button's own dataset — the locale substitution happened once, at
    // generation time, in the markup.
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'true');
      const lbl = panelToggle.dataset.labelClose;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.dataset.tip = lbl; }
    }
    document.body.classList.add('panel-open');
    window.markPanelCurrent?.();
    // Only re-home focus that the dock just lost — never steal it from a
    // pointer user who was not typing anywhere.
    if (fromDock) panelCloseBtn?.focus();
  };
  window.closePanel = () => {
    panel?.classList.remove('open');
    backdrop?.classList.remove('visible');
    panelToggle?.classList.remove('hidden');
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'false');
      const lbl = panelToggle.dataset.labelOpen;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.dataset.tip = lbl; }
    }
    document.body.classList.remove('panel-open');
  };
  // Bound by reference, exactly as before the extraction: both handlers are
  // globals (window.openPanel / window.closePanel), so a bare identifier here
  // resolves to the same function the dock paths call.
  // The ☰ menu is navigation the user clicks THROUGH: a click on an entry
  // switches the page and leaves the menu open (the user's call). Layout
  // handlers still call closePanel() after a nav click; a click that started
  // inside the panel (anything but ✕) marks this tick, and closePanel()
  // ignores calls made while it is marked. The mark lasts 400 ms, not one
  // tick: a page switch can finish (and call closePanel) after its slide
  // transition, and a question entry must leave the menu open like any
  // other. Closing stays: ✕, Esc, a click outside (backdrop) and the ☰ FAB.
  let navClickTick = false;
  let navClickTimer = 0;
  panel?.addEventListener('click', e => {
    if (panelCloseBtn && panelCloseBtn.contains(e.target)) return;
    navClickTick = true;
    clearTimeout(navClickTimer);
    navClickTimer = setTimeout(() => { navClickTick = false; }, 400);
  }, true);
  const closeForReal = window.closePanel;
  window.closePanel = () => { if (!navClickTick) closeForReal(); };
  panelToggle?.addEventListener('click', openPanel);
  panelCloseBtn?.addEventListener('click', () => closeForReal());
  backdrop?.addEventListener('click', () => closeForReal());

  // "What is open now" is always marked in the menu, live: the layout writes
  // data-active on its nav entries (screen / view / overview items, design
  // headings, quick pages); this mirrors it to aria-current — the one hook
  // the highlight CSS (§ Panel CSS) and screen readers read — and keeps the
  // current entry scrolled into view while the menu is open, so arrow-key
  // page switches are followed by the highlight.
  const NAV_ENTRY = '.screen-nav-item, .screen-nav-view-item, .screen-nav-overview-item, .screen-nav-design-heading, .design-quick-page, .design-quick-vitem, .design-quick-qitem';
  function markPanelCurrent() {
    if (!panel) return;
    let cur = null;
    panel.querySelectorAll(NAV_ENTRY).forEach(el => {
      const on = el.dataset.active === 'true';
      const val = el.classList.contains('screen-nav-design-heading') ? 'true' : 'page';
      if (on) { if (el.getAttribute('aria-current') !== val) el.setAttribute('aria-current', val); if (val === 'page') cur = el; }
      else if (el.hasAttribute('aria-current') && !el.classList.contains('section-nav-item')) el.removeAttribute('aria-current');
    });
    if (cur && panel.classList.contains('open') && typeof cur.scrollIntoView === 'function') {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (err) { /* old engines */ }
    }
  }
  window.markPanelCurrent = markPanelCurrent;
  if (panel) {
    new MutationObserver(markPanelCurrent)
      .observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-active'] });
    markPanelCurrent();
  }

  // Escape closes it. The panel is a backdropped modal on every page now, and
  // ✕ plus the backdrop were the only ways out for a keyboard user. The
  // content dimmer has its own Escape handler and returns early while the
  // panel is open, so one press never lifts the frozen veil BEHIND the thing
  // the user is dismissing.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.body.classList.contains('panel-open')) return;
    window.closePanel();
  });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

// --- Notes dock: focus on open, focus follows the page, auto-grow ---
// Lives here (page chrome, every template), not in the dock block, because
// it only reacts to the dock's own state: data-open flipping to "true" (a
// click on 💬 and Space both end in openDock()) and the page-switch events.
//   * Opening the dock puts the caret in the TOPMOST visible, editable field
//     = the most specific one (this page / this view, then the variant note,
//     then the general note — the dock's DOM order IS that order). Caret
//     after the last character; a field whose text does not end in a newline
//     gets ONE appended so the user starts a fresh paragraph. That newline is
//     taken back on blur if nothing was typed: opening + closing never
//     changes a note.
//   * While the dock is open, a switch to another page / view / variant /
//     round moves the caret to THAT page's field by the same rule — the user
//     never has to click into a field again.
//     Not when the user switched by KEYBOARD from outside the dock: then the
//     focus stays put, so the next arrow / Enter keeps navigating.
//   * Fields grow with their text while the whole dock still fits under its
//     ceiling; past that the OTHER visible fields shrink (never below 3 lines
//     or their CSS min-height) to make room for the active one; only then
//     does the active field scroll. An empty field stays at 3 lines — spare
//     room is never handed out. Recomputed from scratch (no incremental
//     state, no height transition) on input / focus / open / page switch /
//     resize / maximise.
//   * Esc inside the dock closes it (closeDock() returns focus to 💬).
(() => {
  const boot = () => {
  const dock = document.getElementById('feedback-dock');
  if (!dock) return;
  const isOpen = () => dock.dataset.open === 'true';
  const raf = f => (window.requestAnimationFrame || (g => setTimeout(g, 16)))(f);
  // Visible = no hidden ancestor and no display:none up to the dock (the
  // rows fold away by attribute AND by CSS, e.g. body[data-view-active]).
  const shown = ta => {
    if (ta.closest('[hidden]')) return false;
    for (let n = ta; n && n !== dock; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') return false;
    }
    return true;
  };
  const fields = () => [...dock.querySelectorAll('textarea')].filter(shown);
  const primary = () => fields().find(ta => !ta.readOnly && !ta.disabled) || null;
  function caretToEnd(ta) {
    if (ta.value && !ta.value.endsWith('\n')) {
      ta.value += '\n';
      ta.dataset.autoNewline = ta.value;
    }
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    try { ta.setSelectionRange(end, end); } catch (e) { /* not a text control */ }
  }
  function focusPrimary() {
    if (!isOpen()) return;
    const ta = primary();
    if (ta && document.activeElement !== ta) caretToEnd(ta);
    fitDockFields(ta);
  }
  window.focusDockField = focusPrimary;
  // A click outside the dock on something that takes no focus (the design,
  // empty page) leaves the caret in the field, so its focus glow stayed lit
  // while the user was clearly elsewhere. Such a click releases the field.
  document.addEventListener('pointerdown', e => {
    const a = document.activeElement;
    if (!a || !dock.contains(a) || dock.contains(e.target)) return;
    if (e.target.closest && e.target.closest('button, a[href], input, select, textarea, [contenteditable], [tabindex]')) return;
    a.blur();
  }, true);
  // Taken back only while the field still holds exactly what we left in it.
  dock.addEventListener('focusout', e => {
    const ta = e.target;
    if (!ta || ta.tagName !== 'TEXTAREA' || ta.dataset.autoNewline == null) return;
    if (ta.value === ta.dataset.autoNewline) ta.value = ta.value.slice(0, -1);
    delete ta.dataset.autoNewline;
  });
  dock.addEventListener('input', e => {
    if (e.target && e.target.dataset) delete e.target.dataset.autoNewline;
    if (e.target && e.target.tagName === 'TEXTAREA') fitDockFields(e.target);
  });
  // Focus decides which field is "active" (the one that may scroll last),
  // so a focus move re-runs the same deterministic rule.
  dock.addEventListener('focusin', e => {
    if (e.target && e.target.tagName === 'TEXTAREA') fitDockFields(e.target);
  });
  dock.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    window.closeDock?.();
  });
  // A page switch the user drove from the KEYBOARD (no text field focused:
  // arrows, Enter, digits) leaves the focus where it is. Pulling the caret
  // into the new page's field made the next arrow move the caret instead of
  // the page. Pointer-driven switches still bring the caret along.
  const typingIn = el => !!(el && el.closest && el.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"]'));
  let navKeyAt = 0;
  document.addEventListener('keydown', () => {
    if (!typingIn(document.activeElement)) navKeyAt = Date.now();
  }, true);

  const px = v => parseFloat(v) || 0;
  // Natural height = what the text needs (border-box), floored at 3 lines /
  // the CSS min-height. Measured on an off-screen mirror <div> (pre-wrap,
  // same font, padding and text width) — never by collapsing the live field,
  // which reset its scroll position and, mid height-transition, read back
  // the OLD height (so a field could grow but never settle).
  let probe = null;
  const MIRROR = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'wordSpacing',
    'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'];
  function measure(ta) {
    const cs = getComputedStyle(ta);
    const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.5 || 20;
    const borders = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const floor = Math.max(px(cs.minHeight), Math.ceil(3 * lh + px(cs.paddingTop) + px(cs.paddingBottom) + borders));
    if (!probe) {
      probe = document.createElement('div');
      probe.id = 'dock-measure';
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
        + 'box-sizing:content-box;border:0;height:auto;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;';
      document.body.appendChild(probe);
    }
    MIRROR.forEach(p => { probe.style[p] = cs[p]; });
    probe.style.width = Math.max(0, ta.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)) + 'px';
    const v = ta.value || '';
    // A trailing newline only takes up a line once something follows it.
    probe.textContent = !v || v.endsWith('\n') ? v + ' ' : v;
    const natural = Math.max(floor, Math.ceil(probe.scrollHeight + borders));
    return { natural, floor };
  }
  // Pure allocation (exported for the tests). One deterministic rule, no
  // incremental state — the same inputs always give the same heights:
  //   target(i) = max(floor(i), nat(i))   (floor = 3 lines / CSS min-height)
  //   * all targets fit the budget → every field gets EXACTLY its target. An
  //     empty field stays at 3 lines and never grows to fill spare room; the
  //     leftover is simply unused (the dock ends shorter).
  //   * otherwise the NON-active fields give way, tallest first, levelled
  //     down to a common height (never below their floor);
  //   * still too tall → the active field takes what is left (≥ its floor)
  //     and scrolls. `active` = index of the focused field, -1 = none (then
  //     every field is levelled alike).
  window.allocDockHeights = function(nat, floor, budget, active) {
    const h = nat.map((v, i) => Math.max(v || 0, floor[i] || 0));
    const total = h.reduce((a, b) => a + b, 0);
    if (total <= budget) return h;
    const hasActive = active >= 0 && active < h.length;
    const others = h.map((_, i) => i).filter(i => i !== active);
    const lvl = L => others.reduce((s, i) => s + Math.max(floor[i] || 0, Math.min(h[i], L)), 0);
    const room = budget - (hasActive ? h[active] : 0);
    // Largest whole-pixel level L with lvl(L) <= room (lvl is monotonic).
    let lo = 0, hi = Math.ceil(Math.max(0, ...others.map(i => h[i])));
    if (lvl(0) > room) hi = 0;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lvl(mid) <= room) lo = mid; else hi = mid - 1;
    }
    others.forEach(i => { h[i] = Math.max(floor[i] || 0, Math.min(h[i], lo)); });
    if (hasActive) {
      const rest = budget - others.reduce((s, i) => s + h[i], 0);
      h[active] = Math.max(floor[active] || 0, Math.min(h[active], rest));
    }
    return h;
  };
  let fitting = false;
  function fitDockFields(activeEl) {
    if (fitting || !isOpen()) return;
    fitting = true;
    const keep = dock.scrollTop;
    try {
      const list = fields();
      if (!list.length) return;
      const pick = list.includes(activeEl) ? activeEl : document.activeElement;
      const active = list.indexOf(pick);
      const m = list.map(measure);
      const cur = list.map(ta => ta.offsetHeight);
      const dcs = getComputedStyle(dock);
      const cap = px(dcs.maxHeight) || innerHeight * 0.8;
      // Chrome = everything in the dock that is not a field (header, crumbs,
      // gaps, tip, padding) — independent of the fields' current heights.
      const used = cur.reduce((a, b) => a + b, 0);
      const outer = dock.scrollHeight + px(dcs.borderTopWidth) + px(dcs.borderBottomWidth);
      const budget = Math.max(0, cap - (outer - used) - 1);
      const h = window.allocDockHeights(m.map(x => x.natural), m.map(x => x.floor), budget, active);
      list.forEach((ta, i) => {
        // A sub-pixel difference is not a change: writing it anyway is what
        // made the fields twitch on every keystroke.
        if (Math.abs(cur[i] - h[i]) >= 1 || !ta.style.height) ta.style.height = h[i] + 'px';
        const sc = h[i] < m[i].natural - 1 ? 'true' : 'false';
        if (ta.dataset.scroll !== sc) ta.dataset.scroll = sc;
      });
      if (dock.scrollTop !== keep) dock.scrollTop = keep;
    } finally { fitting = false; }
  }
  window.fitDockFields = fitDockFields;

  // data-open is the single truth for "the dock just opened" — a real
  // closed → open flip only: page switches re-write data-open="true" on an
  // already open dock (primeDock), and treating that as an open pulled the
  // caret back in after a keyboard page switch.
  new MutationObserver(recs => {
    if (isOpen() && recs.some(r => r.oldValue !== 'true')) raf(focusPrimary);
  }).observe(dock, { attributes: true, attributeFilter: ['data-open'], attributeOldValue: true });
  // Maximise / size flips change the width (re-wrap) and the ceiling: same
  // rule, recomputed once the new geometry is laid out.
  new MutationObserver(() => { if (isOpen()) raf(() => fitDockFields()); })
    .observe(dock, { attributes: true, attributeFilter: ['data-user-maximized', 'data-size'] });
  // Page switches: wait one frame so the layout's own handlers (same event)
  // have swapped which fields are visible.
  ['screen:changed', 'view:changed', 'overview:changed', 'iteration:changed'].forEach(ev =>
    document.addEventListener(ev, () => {
      const byKey = Date.now() - navKeyAt < 600;
      raf(() => {
        if (!isOpen() || document.body.classList.contains('panel-open')) return;
        if (byKey && !dock.contains(document.activeElement)) { fitDockFields(); return; }
        focusPrimary();
      });
    }));
  window.addEventListener('resize', () => { if (isOpen()) fitDockFields(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

// --- Eye in the header panel (safety net) ---
// While the overview header card (#design-header) is on screen, the
// annotation eye (#anno-toggle) belongs INSIDE it, in its eye slot
// (.design-header-eye, filled by wireDesignOverview's placeEye()). A state
// where the header shows but the eye stayed at its floating fallback spot
// below it read as a stray button. This only adopts — moving the eye back
// out stays placeEye()'s job — and is a no-op without header or slot.
(() => {
  const adopt = () => {
    const eye = document.getElementById('anno-toggle');
    const header = document.getElementById('design-header');
    const slot = header && header.querySelector('.design-header-eye');
    if (!eye || !slot || slot.contains(eye)) return;
    if (document.body.dataset.overview !== 'true' || !header.getClientRects().length) return;
    const cs = getComputedStyle(header);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    slot.appendChild(eye);
  };
  const later = () => (window.requestAnimationFrame || (g => setTimeout(g, 16)))(adopt);
  ['screen:changed', 'view:changed', 'overview:changed', 'iteration:changed']
    .forEach(ev => document.addEventListener(ev, later));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later);
  else later();
})();
```

```css
/* ── Shared tokens: tips and form fields ──
   --tip-color is the calm INFO hue of every tip surface ("Wusstest du
   schon?" in the dock, the hotkey nudges): blue-cyan, deliberately distinct
   from --question-color / --warning-color (amber), which marks things that
   still need an answer. A tip never needs anything from the user, so it must
   not look like an open question.
   --field-* is the one look of every text input in the concept UI. */
:root {
  --tip-color: #3fa7d6;
  /* Single-line pill / label text that clips (overflow: hidden, ellipsis)
     needs room for descenders: at line-height 1 the "g" of "Umsetzung"
     was cut. Every such rule reads this token (test-enforced ≥ 1.2). */
  --pill-line-height: 1.3;
  --question-color: var(--warning-color, #d29922);
  --field-radius: 10px;
  --field-bg: color-mix(in srgb, var(--text-color, #c9d1d9) 5%, var(--input-bg, #0d1117));
  --field-border: color-mix(in srgb, var(--text-color, #c9d1d9) 16%, transparent);
  --field-border-hover: color-mix(in srgb, var(--text-color, #c9d1d9) 28%, transparent);
  --field-focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent-color, #58a6ff) 22%, transparent), 0 0 16px color-mix(in srgb, var(--accent-color, #58a6ff) 16%, transparent);
}
/* Global field base — every textarea / text-like input / select on the page:
   soft radius, a subtly filled surface, a hairline border that firms up on
   hover, and an accent focus ring with glow. Only the SURFACE is set here
   (no padding, no size, no font): those stay with each context's own rule.
   The `html :is(...)` + `:not(.map-state)` shape is deliberate — it lifts the
   rule over the per-context field rules (.decision-comment-row textarea,
   .anno-answer, .upin-editor textarea, .feedback-section textarea, the
   mapping notes) so the whole UI shares one look without editing each of
   them, while an id-scoped rule (#design-general-feedback's quiet band)
   still wins. Hidden state inputs (.map-state) are left alone. */
html :is(textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input:not([type]), select):not(.map-state) {
  background-color: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--field-radius);
  color: var(--text-color, #c9d1d9);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
html :is(textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input:not([type]), select):not(.map-state):hover:not(:focus):not([readonly]) {
  border-color: var(--field-border-hover);
}
html :is(textarea, input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="number"], input:not([type]), select):not(.map-state):focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
  box-shadow: var(--field-focus-ring);
}
html :is(textarea, input)::placeholder { color: color-mix(in srgb, var(--text-secondary, #8b949e) 80%, transparent); opacity: 1; }

/* Dock fields grow with their text (fitDockFields, § Panel Chrome JS) —
   the height is the script's job, so no manual resize grip and no scrollbar
   until the whole dock is out of room. NO height transition: a running
   transition made every keystroke animate from a stale height while the
   next measurement already ran, so neighbouring fields chased each other.
   `scrollbar-gutter: stable` keeps the text width identical whether the
   field scrolls or not — a scrollbar appearing re-wrapped the text, changed
   its natural height and flipped the allocation back. */
html .feedback-dock .feedback-section textarea {
  resize: none; overflow-y: hidden; padding: 0.7rem 0.85rem; scrollbar-gutter: stable;
}
.feedback-dock .feedback-section textarea[data-scroll="true"] { overflow-y: auto; }
/* A scrolling dock field must SHOW that it scrolls, focused or not. The
   universal scrollbar skin (§ Layout CSS → Scrollbars) paints its thumb in
   --border-color, which vanished on the field surface. No second skin here:
   the field only re-points the token the skin reads (its own border is
   --field-border, so nothing else moves). The focus ring is a box-shadow
   outside the border and never covers the bar. */
.feedback-dock .feedback-section textarea {
  --border-color: color-mix(in srgb, var(--text-secondary, #8b949e) 70%, transparent);
}

/* ── Notes dock fields (R4 "Notiz-Dock"): breadcrumb header per field, soft
   glow on the active one, 📎 inside the field, "Wusstest du schon?" tip. ── */
/* Theme-neutral surfaces: a tint of --text-color, never a fixed white
   rgba that vanished on the light theme. */
.feedback-dock .feedback-section { padding: 10px; border-radius: 14px; background: color-mix(in srgb, var(--text-color, #c9d1d9) 4%, transparent); }
.feedback-dock .feedback-section:focus-within {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-color, #58a6ff) 12%, transparent), color-mix(in srgb, var(--accent-color, #58a6ff) 4%, transparent));
}
.feedback-dock .feedback-section textarea:focus {
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent), 0 0 18px color-mix(in srgb, var(--accent-color, #58a6ff) 25%, transparent);
}
.dock-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.dock-crumb i { font-style: normal; color: color-mix(in srgb, var(--text-secondary) 60%, transparent); }
.dock-crumb .dock-scope { display: inline-flex; align-items: center; gap: 6px; }
/* One rule for every field header: the ancestors are muted, ONLY the
   field's own level (the last crumb) is emphasised — white, bold. So "II
   Sonniger Tag" (page), "Kompakt" (variant) and "Concept" (general) look
   identical, and an ancestor "Concept" is never highlighted. Scoped under
   .feedback-dock so the generic `.feedback-section label strong` accent
   (§ Panel) can never turn the variant name blue. */
.feedback-dock .dock-crumb .dock-crumb-lv { color: var(--text-secondary); font-weight: 500; font-size: 12px; }
.feedback-dock .dock-crumb strong, .feedback-dock .dock-crumb .dock-crumb-last { color: var(--text-color, #f0f6fc); font-weight: 650; font-size: 13px; }
.dock-crumb .dock-tag {
  margin-left: auto; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  color: var(--text-secondary); background: color-mix(in srgb, var(--text-color, #c9d1d9) 8%, transparent); white-space: nowrap;
}
.feedback-dock .feedback-section:focus-within .dock-tag { color: var(--accent-color); background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent); }
/* The 📎 sits inside the field (bottom-right); thumbnails flow under it. */
.feedback-dock .attach-slot { position: relative; }
/* right: 14px keeps it clear of the field's scrollbar; the field reserves a
   matching right gutter (§ Attachments CSS) so typed text never runs under it. */
.feedback-dock .attach-slot .attach-btn { position: absolute; right: 14px; top: -34px; opacity: 0.7; }
.feedback-dock .attach-slot .attach-btn:hover { opacity: 1; }
/* "Wusstest du schon?" — ONE line, always (the pool's texts are kept short,
   ellipsis is only the safety net for a narrow phone sheet), in the calm
   --tip-color, never the amber of open questions. */
.dock-tip {
  display: flex; align-items: baseline; gap: 6px; flex-wrap: nowrap; min-width: 0; padding: 7px 10px; border-radius: 12px;
  background: color-mix(in srgb, var(--tip-color, #3fa7d6) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--tip-color, #3fa7d6) 18%, transparent);
  font-size: 12px; color: var(--text-color, #c9d1d9); white-space: nowrap;
}
.dock-tip b { flex: none; display: inline-flex; align-items: center; gap: 5px; align-self: center; color: var(--tip-color, #3fa7d6); font-weight: 650; }
/* The lamp is an inline SVG filled with currentColor — the --tip-color of
   the title — never the yellow 💡 emoji, which no CSS can tint. */
.dock-tip .dock-tip-icon { flex: none; width: 13px; height: 13px; display: block; }
.dock-tip .dock-tip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary, #8b949e); }
.dock-tip[hidden] { display: none; }
```
