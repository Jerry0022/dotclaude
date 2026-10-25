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
```

