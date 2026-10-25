# Concept templates, part 18 of 41: Template: design — variant overview CSS (≥2 designs) (continued 2)

```css
/* ── Side-tile label: neighbours only. The variant icon — exactly the
   quick-nav icon, no frame of its own — sits vertically centred just
   outside the hover chevron, so the chevron points at it; on hover the name
   appears under it, wrapped, never cut. The centre tile carries no badge
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
.design-ov-side-name {
  position: absolute; top: calc(100% + 0.4rem); left: 50%; transform: translateX(-50%);
  width: max-content; max-width: 8rem; text-align: center;
  white-space: normal; overflow-wrap: anywhere; line-height: 1.2;
  color: var(--text, #e6edf3); font-size: 0.75rem; font-weight: 600;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
  opacity: 0; transition: opacity 0.2s ease;
}
.design-ov-slide:is([data-pos="prev"], [data-pos="next"]):hover .design-ov-side-name { opacity: 1; }
/* A changed variant: one line under the traits, "Verbessert" + the phrase
   from data-design-improved. */
.design-ov-improved {
  margin: 0.6rem 0 0; padding-top: 0.5rem; font-size: 0.82rem; line-height: 1.3;
  border-top: 1px solid color-mix(in srgb, currentColor 22%, transparent); opacity: 0.95;
}
.design-ov-improved strong { margin-right: 0.35rem; color: var(--warning-color, #d29922); }

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
```

