# Concept templates, part 18 of 41: Template: design — variant overview CSS (≥2 designs) (continued 2)

```css
/* ── Side-tile label: neighbours only. The variant icon — exactly the
   quick-nav icon, no frame of its own — sits vertically centred just
   outside the hover chevron, so the chevron points at it — no name (the
   quick nav names the variant). The centre tile carries no badge
   (the quick nav marks it). The chevron is 2.6rem wide at 7 % from the
   tile's visible edge (.design-ov-slide::after). ── */
.design-ov-side {
  display: none; position: absolute; top: 50%; z-index: 3; pointer-events: none;
  transform: translateY(-50%) scale(1.35);
}
.design-ov-slide:is([data-pos="prev"], [data-pos="next"]) .design-ov-side { display: block; }
.design-ov-slide[data-pos="prev"] .design-ov-side { right: calc(7% + 3.2rem); transform-origin: right center; }
.design-ov-slide[data-pos="next"] .design-ov-side { left: calc(7% + 3.2rem); transform-origin: left center; }
.design-ov-side > .dz-icon { display: grid; }
/* A changed variant: one line under the traits, "Verbessert" + the phrase
   from data-design-improved. */
.design-ov-improved {
  margin: 0.6rem 0 0; padding-top: 0.5rem; font-size: 0.82rem; line-height: 1.3;
  border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); opacity: 0.95;
}
.design-ov-improved strong { margin-right: 0.35rem; color: var(--warning-color, #d29922); }

/* Improved line inside an annotation bubble (rounds 2+): same look as the
   overview line; one ellipsised line collapsed, wrapped when open. */
.anno-bubble-improved {
  margin: 0 0 0.35rem; font-size: 0.82rem; line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.anno-bubble[data-open="true"] .anno-bubble-improved { white-space: normal; }
.anno-bubble-improved strong { margin-right: 0.35rem; color: var(--warning-color, #d29922); }

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
/* While an own note is open its layer rises above the annotation layer
   (z-index 40) and the auto pins underneath fade out of the way — nothing
   draws over the editor. */
.upin-layer:has(.upin[data-editing="true"]) { z-index: 45; }
.upin[data-editing="true"] { z-index: 4; }
body[data-note-editing="true"]:has(.upin[data-editing="true"]) .anno-layer { opacity: 0.25; transition: opacity 0.15s ease; }
.upin-editor-head { font-size: 0.72rem; color: var(--text-secondary, #8b949e); margin-bottom: 0.35rem; }
.upin-editor textarea {
  width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical;
  padding: 0.45rem 0.55rem; border-radius: 8px; font: inherit; font-size: 0.85rem;
  background: var(--input-bg, #0d1117); color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d);
}
/* Foot row: keys hint · 📎 (+ its file chips) · delete. */
.upin-editor-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.4rem; font-size: 0.72rem; color: var(--text-secondary, #8b949e); }
.upin-editor-keys { flex: 1 1 auto; min-width: 0; }
.upin-editor-foot .attach-slot { display: flex; flex: none; }
.upin-editor-foot .attach-slot:empty { display: none; }
.upin-editor-foot .attach-bar { margin: 0; gap: 0.3rem; }
.upin-editor-foot .attach-btn { position: static; opacity: 0.75; }
.upin-editor-foot .attach-btn:hover { opacity: 1; }
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

/* ── Page transitions — the motion names the direction ──
   body[data-dz-nav] is set by playNav() (overview JS) for ~320 ms after a
   switch; only the section that just became visible animates. in = the
   variant grows out of its tile, out = the page shrinks back into the
   carousel, next / prev = a short slide from the side the user moved to.
   No attribute, no motion: a re-render never replays anything. */
@keyframes dz-nav-in { from { opacity: 0; transform: scale(0.84); } }
@keyframes dz-nav-out { from { opacity: 0; transform: scale(1.14); } }
@keyframes dz-nav-next { from { opacity: 0; transform: translateX(56px); } }
@keyframes dz-nav-prev { from { opacity: 0; transform: translateX(-56px); } }
body[data-dz-nav="in"] section[data-iteration] > section[data-design] > section[data-screen],
body[data-dz-nav="in"] section[data-iteration] > section[data-view] { animation: dz-nav-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
body[data-dz-nav="out"] .design-ov-stage { animation: dz-nav-out 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
body[data-dz-nav="next"] section[data-iteration] > section[data-design] > section[data-screen],
body[data-dz-nav="next"] section[data-iteration] > section[data-view] { animation: dz-nav-next 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
body[data-dz-nav="prev"] section[data-iteration] > section[data-design] > section[data-screen],
body[data-dz-nav="prev"] section[data-iteration] > section[data-view] { animation: dz-nav-prev 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
/* Arriving back on the overview: slides take their places without sliding. */
.design-ov[data-instant="true"] .design-ov-slide { transition: none; }
@media (prefers-reduced-motion: reduce) {
  body[data-dz-nav] section[data-screen], body[data-dz-nav] section[data-view],
  body[data-dz-nav] .design-ov-stage, .design-quick-group[data-fan="true"] { animation: none !important; }
}

/* ── Light theme — the overview, quick nav and info card on a light page ──
   Same tokens as the rest of the page: a light surface with dark text for
   the info card, soft grey shadows instead of the dark theme's black ones,
   a chevron in the variant colour instead of white. */
html[data-theme="light"] .design-ov {
  --dz-ov-tint: color-mix(in srgb, var(--panel-bg, #f6f8fa) 94%, transparent);
  --dz-ov-tint-line: var(--border-color, #d1d9e0);
  --dz-ov-warm: color-mix(in srgb, #fff8f1 95%, transparent);
  --dz-ov-warm-line: color-mix(in srgb, var(--warning-color, #9a6700) 30%, var(--border-color, #d1d9e0));
  --dz-ov-ink: var(--text-color, #1f2328);
  --dz-ov-dot-ring: var(--panel-bg, #f6f8fa);
  --dz-ov-shadow: 0 18px 48px rgba(31, 35, 40, 0.14);
}
html[data-theme="light"] .design-ov-overlay { box-shadow: 0 10px 28px rgba(31, 35, 40, 0.12); }
html[data-theme="light"] .design-ov-slide[data-pos="cur"] .design-ov-overlay:not(:hover):not(:focus-within) { opacity: 0.88; }
html[data-theme="light"] .design-ov-kicker { color: var(--text-secondary, #59636e); opacity: 1; }
html[data-theme="light"] .design-ov-slide[data-pos="cur"] .design-ov-preview:hover,
html[data-theme="light"] .design-ov-slide[data-pos="cur"] .design-ov-preview:focus-visible {
  box-shadow: var(--dz-ov-shadow), 0 0 0 2px var(--dz-color), 0 0 34px 4px color-mix(in srgb, var(--dz-color) 35%, transparent);
}
html[data-theme="light"] .design-ov-slide:is([data-pos="prev"], [data-pos="next"]) { opacity: 0.75; filter: saturate(0.85); }
html[data-theme="light"] .design-ov-slide:is([data-pos="prev"], [data-pos="next"]) .design-ov-preview,
html[data-theme="light"] .design-ov-slide:is([data-pos="prev"], [data-pos="next"]) .design-ov-qcard {
  background: color-mix(in srgb, var(--dz-color) 6%, var(--bg-color, #ffffff));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--dz-color) 35%, var(--border-color, #d1d9e0)), 0 8px 24px rgba(31, 35, 40, 0.06);
}
html[data-theme="light"] .design-ov-slide:is([data-pos="prev"], [data-pos="next"])::after {
  background: var(--dz-color);
  -webkit-mask: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 80' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 3L5 40l14 37'/%3E%3C/svg%3E");
  mask: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 80' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 3L5 40l14 37'/%3E%3C/svg%3E");
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--dz-color) 45%, transparent));
}
html[data-theme="light"] .design-ov[data-has-favorite="true"] .design-ov-slide[data-design-id]:not([data-favorite="true"]) .design-ov-preview { filter: saturate(0.6) brightness(0.97); }
html[data-theme="light"] .design-quick-designs { background: color-mix(in srgb, var(--bg-color, #ffffff) 88%, transparent); box-shadow: 0 2px 10px rgba(31, 35, 40, 0.06); }
html[data-theme="light"] .design-quick-group,
html[data-theme="light"] .design-quick-seg[data-ov-focus="true"] { background: color-mix(in srgb, var(--dz-color, var(--accent-color)) 12%, var(--bg-color, #ffffff)); }
html[data-theme="light"] .design-quick-page[data-active="true"],
html[data-theme="light"] .design-quick-more { color: #fff; }
html[data-theme="light"] .design-quick-vlist, html[data-theme="light"] .design-quick-qpop,
html[data-theme="light"] .design-keys, html[data-theme="light"] .upin-hint { box-shadow: 0 14px 34px rgba(31, 35, 40, 0.14); }
html[data-theme="light"] .design-header .anno-toggle-fab:hover, html[data-theme="light"] .design-header .anno-toggle-fab:focus-visible,
html[data-theme="light"] .viewport-mode:hover, html[data-theme="light"] .viewport-mode:focus-visible { background: var(--bg-color, #ffffff); }
```

