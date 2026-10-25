# Concept templates, part 04 of 41: Panel chrome — page-level JS


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
  panelToggle?.addEventListener('click', openPanel);
  panelCloseBtn?.addEventListener('click', closePanel);
  backdrop?.addEventListener('click', closePanel);

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
//   * Fields grow with their text while the whole dock still fits under its
//     ceiling; past that the OTHER visible fields shrink step by step (never
//     below 3 lines or their CSS min-height) to make room for the active one;
//     only then does the active field scroll.
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
  // Taken back only while the field still holds exactly what we left in it.
  dock.addEventListener('focusout', e => {
    const ta = e.target;
    if (!ta || ta.tagName !== 'TEXTAREA' || ta.dataset.autoNewline == null) return;
    if (ta.value === ta.dataset.autoNewline) ta.value = ta.value.slice(0, -1);
    delete ta.dataset.autoNewline;
  });
  dock.addEventListener('input', e => {
    if (e.target && e.target.dataset) delete e.target.dataset.autoNewline;
    fitDockFields(e.target);
  });
  dock.addEventListener('focusin', e => { if (e.target.tagName === 'TEXTAREA') fitDockFields(e.target); });
  dock.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    window.closeDock?.();
  });

  const px = v => parseFloat(v) || 0;
  // Natural height = what the text needs (border-box), floored at 3 lines /
  // the CSS min-height. Measured by collapsing the field for one read.
  function measure(ta) {
    const cs = getComputedStyle(ta);
    const lh = px(cs.lineHeight) || px(cs.fontSize) * 1.5 || 20;
    const borders = px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const floor = Math.max(px(cs.minHeight), Math.ceil(3 * lh + px(cs.paddingTop) + px(cs.paddingBottom) + borders));
    const prev = ta.style.height;
    ta.style.height = '0px';
    const natural = Math.max(floor, Math.ceil(ta.scrollHeight + borders));
    ta.style.height = prev;
    return { natural, floor };
  }
  // Pure allocation (exported for the tests): heights for the fields'
  // natural heights `nat` and floors `floor` under `budget`; `active` = the
  // index of the field being typed in, which keeps its natural height for
  // as long as the others can still give way.
  window.allocDockHeights = function(nat, floor, budget, active) {
    const h = nat.slice();
    let over = h.reduce((a, b) => a + b, 0) - budget;
    while (over > 0) {
      let k = -1;
      for (let i = 0; i < h.length; i++) {
        if (i === active || h[i] <= floor[i]) continue;
        if (k < 0 || h[i] > h[k]) k = i;
      }
      if (k < 0) break;
      // Tallest other field first, down to the next-tallest (then in small
      // steps), so the shrinking is even rather than one field collapsing.
      let second = floor[k];
      h.forEach((v, i) => { if (i !== k && i !== active && v > second && v < h[k]) second = v; });
      const step = Math.min(over, h[k] > second ? h[k] - second : Math.min(4, h[k] - floor[k]));
      h[k] -= step;
      over -= step;
    }
    if (over > 0 && active >= 0) h[active] = Math.max(floor[active], h[active] - over);
    return h;
  };
  let fitting = false;
  function fitDockFields(activeEl) {
    if (fitting || !isOpen()) return;
    fitting = true;
    try {
      const list = fields();
      if (!list.length) return;
      const pick = list.includes(activeEl) ? activeEl : document.activeElement;
      const active = Math.max(0, list.indexOf(pick));
      const m = list.map(measure);
      const dcs = getComputedStyle(dock);
      const cap = px(dcs.maxHeight) || innerHeight * 0.8;
      const used = list.reduce((a, ta) => a + ta.offsetHeight, 0);
      const outer = dock.scrollHeight + px(dcs.borderTopWidth) + px(dcs.borderBottomWidth);
      const budget = Math.max(0, cap - (outer - used) - 1);
      const h = window.allocDockHeights(m.map(x => x.natural), m.map(x => x.floor), budget, active);
      list.forEach((ta, i) => {
        ta.style.height = h[i] + 'px';
        ta.dataset.scroll = h[i] < m[i].natural ? 'true' : 'false';
      });
    } finally { fitting = false; }
  }
  window.fitDockFields = fitDockFields;

  // data-open is the single truth for "the dock just opened".
  new MutationObserver(() => { if (isOpen()) raf(focusPrimary); })
    .observe(dock, { attributes: true, attributeFilter: ['data-open'] });
  // Page switches: wait one frame so the layout's own handlers (same event)
  // have swapped which fields are visible.
  ['screen:changed', 'view:changed', 'overview:changed', 'iteration:changed'].forEach(ev =>
    document.addEventListener(ev, () => raf(() => {
      if (!isOpen() || document.body.classList.contains('panel-open')) return;
      focusPrimary();
    })));
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
   until the whole dock is out of room. The short height transition is the
   "step by step" when a field shrinks to make room for the active one. */
/* `html` prefix: same weight as the global field base above, later in source,
   so the height transition is not dropped by its shorter transition list. */
html .feedback-dock .feedback-section textarea {
  resize: none; overflow-y: hidden; padding: 0.7rem 0.85rem;
  transition: height 0.16s ease, border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.feedback-dock .feedback-section textarea[data-scroll="true"] { overflow-y: auto; }
@media (prefers-reduced-motion: reduce) {
  html .feedback-dock .feedback-section textarea { transition: none; }
}

/* ── Notes dock fields (R4 "Notiz-Dock"): breadcrumb header per field, soft
   glow on the active one, 📎 inside the field, "Wusstest du schon?" tip. ── */
.feedback-dock .feedback-section { padding: 10px; border-radius: 14px; background: rgba(255,255,255,0.025); }
.feedback-dock .feedback-section:focus-within {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-color, #58a6ff) 12%, transparent), rgba(137,87,229,0.07));
}
.feedback-dock .feedback-section textarea:focus {
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent), 0 0 18px color-mix(in srgb, var(--accent-color, #58a6ff) 25%, transparent);
}
.dock-crumb { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.dock-crumb i { font-style: normal; color: color-mix(in srgb, var(--text-secondary) 60%, transparent); }
.dock-crumb .dock-scope { display: inline-flex; align-items: center; gap: 6px; }
.dock-crumb strong, .dock-crumb .dock-crumb-last { color: var(--text-color, #f0f6fc); font-weight: 650; font-size: 13px; }
.dock-crumb .dock-tag {
  margin-left: auto; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  color: var(--text-secondary); background: rgba(255,255,255,0.05); white-space: nowrap;
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
.dock-tip b { flex: none; color: var(--tip-color, #3fa7d6); font-weight: 650; }
.dock-tip .dock-tip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-secondary, #8b949e); }
.dock-tip[hidden] { display: none; }
```
