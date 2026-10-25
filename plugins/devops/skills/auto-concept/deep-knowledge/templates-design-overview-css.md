# Concept templates, part 16 of 33: Variant overview CSS (≥2 designs)

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
/* The name carries its OWN cap: 17rem ≈ everything else on the row (back,
   pill chrome, ★, eye, gaps, padding — the 📍 left the header), so the row
   never exceeds the header's cap; the full name and motto live in its
   tooltip. The 4.5rem floor keeps a short name like "Übersicht" whole. */
.design-header-name {
  color: var(--text, #e6edf3); font-weight: 600; min-width: 0;
  max-width: max(4.5rem, min(12rem, calc(var(--dz-head-cap) - 17rem)));
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

