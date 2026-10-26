# Concept templates, part 08 of 43: Template: design — rules, devices, click-through, annotation layer

# Template: design

*(legacy alias: `prototype` — normalised to `design` on read)*

**One visual artefact, one screen at a time, 100 % viewport.** The body shows
exactly one screen from the flow. The user switches between screens via the
screen-nav inside the ☰ decision panel, keyboard arrows, OR by clicking
buttons inside the mockup itself (click-dummy behaviour). The viewport
has no header bar, no sidebars — just the current screen and two floating
buttons:

## Rules

- **Click-dummy by default (2+ screens):** buttons/links inside the mockup
  MUST navigate between screens when clicked. A real "Continue" button on
  screen 1 takes the user to screen 2; "Back" goes to screen 1; etc. The
  user can thereby click through the whole flow as if it were a real app.
- **"Screen" = logical state, not necessarily full page.** A screen is any
  user-distinguishable state the reviewer should be able to annotate
  separately:
  - Full-page transitions (welcome / credentials / success)
  - Modal / drawer / dialog toggles (main view without modal vs. with
    modal open)
  - Tab or accordion selections (tab A content vs. tab B content)
  - Empty / loading / populated / error states of the same component
  - Before / after user action (form empty vs. form submitted)

  Each such state becomes its own `<section data-screen>`. The click-dummy
  wiring with `data-screen-link` handles the transition like any other
  screen switch.
- **Single-screen design (exactly one `<section data-screen>`):**
  - Only THAT design's row collapses in the ☰ panel: its
    `.screen-nav-group` keeps the heading that switches to it, and just the
    one redundant screen entry goes. `#screen-nav` itself must NOT be
    gated on this — it lists every design in the iteration, so hiding the
    container on the active design's screen count blanks the whole table
    of contents and strands the user (see § Layout CSS). The container
    disappears only when the iteration ALSO has a single design, i.e.
    when there is genuinely nothing left to navigate.
  - Feedback dock shows ONLY the general-notes textarea (no
    per-screen section, no "Aktueller Screen" label)
  - No click-dummy wiring required — nothing to navigate to
  - The screen-indicator overlay can be hidden or simplified
  - Two flags, two scopes, deliberately: `updateScreenScope()` sets
    `document.body.dataset.singleScreen` from the design currently on the
    canvas — that is the right scope for the DOCK, which always talks about
    the active screen. `buildDesignUI()` stamps
    `group.dataset.singleScreen` per design — the right scope for the
    PANEL, which shows all of them at once and must stay stable when the
    active design changes. Never drive one from the other's flag.
- **Single-design iteration (exactly one `<section data-design>`):**
  degenerates to today's behaviour — no design switcher, no per-design
  feedback row, `#screen-nav` renders the screens as a flat list (the
  design heading collapses). A views group, if the iteration has one, still
  renders WITH its heading — `body[data-single-design]` hides
  `.screen-nav-design-heading`, not `.screen-nav-views-heading`.
  `buildDesignUI()` detects `designs.length === 1` and sets
  `document.body.dataset.singleDesign = 'true'`, the sibling of
  `data-single-screen` above, so CSS hides the same way. The `data-design`
  wrapper is still required in the markup even when there's only one — see
  § Screen-pattern markup.
- **Do NOT invent artificial screens** to make the template fit. If the
  artefact has no meaningful secondary state, leave it as a single screen
  and let the dock collapse to general notes only.
- **Views are optional, additional top-level items — ≥1 `data-design` stays
  mandatory.** Alongside the design(s), a `design` iteration MAY hold any
  number of `section[data-view]` siblings (§ Views (optional) below). Views
  never stand alone: an iteration that is only questions, with no artefact
  in front of the user, is a `decision` iteration, not a `design` one with
  zero designs. The validation gate enforces this — see
  `deep-knowledge/validation-gate.md`.
- **Design system alignment:** the mockup MUST use the project's existing
  design tokens (colors, typography, spacing, component shapes) unless the
  user explicitly requests a different look. Read `design-tokens.*`,
  Tailwind config, Figma variables via the design MCP, or the existing UI
  layer before inventing a style. The example in this file uses the generic
  GitHub-style palette only because dotclaude has no project-specific
  tokens — consumer projects will differ.
- **Annotation layer is optional.** Only pin questions onto a screen when
  Claude has a concrete, element-level question to ask ("should this list
  auto-refresh?", "is this the right empty state?") — not as a default
  decoration on every design iteration. A design with no annotations simply
  omits `[data-anno-layer]` entirely; nothing degrades. See § Annotation
  Layer (optional) below. The layer's pin/bubble/leader visuals MAY be
  restyled via its CSS custom properties (`--anno-accent`,
  `--anno-bubble-bg`, `--anno-pin-size`, …) to match the design's own theme
  — never change the toggle semantics (`body.anno-hidden`) or the
  `data-anno*` attribute names when doing so, since the shared JS and the
  submit payload both key off them.

## Responsive device views

A design page mocks an app that may ship on more than one form factor. The
concept **declares** which ones; the user switches between them with the
`.viewport-toggle` bottom-left. Desktop is the pre-existing full-bleed
rendering, unchanged: no stage, no clone, no frame. A concept that declares
nothing behaves exactly as it did before this existed and never renders the
toggle.

Declared on `section[data-iteration]`, overridable on a single
`section[data-design]` whose form factors genuinely differ:

| Attribute | Meaning | Default |
|---|---|---|
| `data-viewports` | Ordered, space-separated subset of `desktop tablet phone`. The order IS the click-cycle order. | `desktop` (→ no toggle) |
| `data-viewport-default` | Which of them the page opens in. A phone-only app declares `data-viewports="phone"` and opens straight into the phone frame. | first entry of `data-viewports` |
| `data-orientations` | Subset of `portrait landscape`. Both are rendered **side by side, simultaneously** — the reviewer compares them without switching. Declare one only for an app that locks its orientation. | `portrait landscape` |
| `data-device-tablet`, `data-device-phone` | `WIDTHxHEIGHT` in portrait CSS pixels, e.g. `360x800` for an Android target. | `834x1194` / `390x844` |

**Mock authoring constraints (device mode makes these load-bearing).** The
frames are DOM clones of the screen's content rendered into a
`container-type: size` box; they are not iframes and the browser viewport
does not change. Inside `section[data-screen]`, therefore:

- **No `vh` / `vw` / `dvh` / `svh` / `lvh` units.** They resolve against the
  browser window, not the frame: a `height: 100vh` hero renders 1080px tall
  inside a 390×844 phone shell and bursts out of it. Use `100%` (the frame
  is definitely sized) or `cqh` / `cqw` against `container-name: device`.
- **No `@media` queries for the device breakpoints.** They key off the
  window, which never changes. Style device variants off the shell instead —
  `.device-shell[data-device="phone"] .nav { … }`,
  `.device-shell[data-orientation="landscape"] .sidebar { … }` — or use
  `@container device (max-width: 480px)`.
- **No `position: fixed`.** It anchors to the window in desktop mode and to
  the transformed stage in device mode, i.e. two different results from one
  rule. Use `position: absolute` inside the frame.
- **No `<script>`, `<canvas>`, `<style>` or `<iframe>`.** A cloned `<script>`
  is spec-marked "already started" and never runs; a cloned `<canvas>` comes
  out blank because the bitmap is not copied. Both render correctly in
  desktop mode and dead in device mode — a divergence with no error anywhere.
  Mockups are declarative markup; their CSS lives in the page's single
  `<head>` stylesheet like all other concept CSS.
- **The annotation layer never enters a frame.** `[data-anno-layer]` is
  stripped from every clone: its JS collects `[data-anno-pin]` and
  `textarea[data-annotation]` document-wide, and a cloned answer is a third
  textarea that persistence and the submit payload both skip — it would be
  typed and silently lost. Annotations stay a desktop-view affordance.
- **A view suspends device mode.** While a `section[data-view]` is the active
  top-level item (`body[data-view-active="true"]`) no screen is on display,
  so the stage is torn down and the toggle hides — a question view is prose,
  not a screen to frame.
- **Style mocks by class, never by `#id`.** Clone ids are namespaced per
  frame (`dv1-`, `dv2-`) so the two copies cannot collide, which means an
  `#id` rule stops matching inside the frames while it still matches the
  hidden original.

## Click-through wiring (`data-screen-link`)

Buttons inside a mockup get `data-screen-link` to declare their navigation:

```html
<div class="device-frame">
  <h4>Welcome</h4>
  <button class="mock-btn" data-screen-link="screen-credentials">Los geht's</button>
  <button class="mock-btn secondary" data-screen-link="screen-login">Anmelden</button>
</div>
```

Values:
- `data-screen-link="screen-id"` — jump to the screen with that id
- `data-screen-link="next"` — advance to the next screen in DOM order
- `data-screen-link="prev"` — go to the previous screen
- Omit the attribute entirely for decorative / terminal buttons

The wiring is a single delegated click handler installed alongside
`showScreen` — see § Click-through Handler below.

- `☰` (top-right) → Decision panel: iteration tabs, screen navigation, submit
- `💬` (bottom-right) → Feedback dock: **context-sensitive** textarea for the
  currently-visible screen + a persistent "general notes" textarea below

Both FABs are the same 60px circle in the same accent colour — they differ
only by glyph and position (see § Layout CSS). Do not re-size either one per
page: it is the first thing that looks broken when concepts sit side by side.

### Feedback behaviour (strict)

- The dock starts **collapsed** in every state, including frozen iterations.
  The 💬 FAB is the only thing that opens it. At concept start the artefact
  is what the user came for, not three empty textareas over it.
- Open, the dock has exactly two sizes — `compact` (420px, general note only)
  and `wide` (560px, general + design + per-screen). `applyDockSize()` picks
  one from `body[data-single-screen]` / `body[data-single-design]`. Never
  size it to its content or to a viewport fraction. Both sizes are tuned so
  screen + design + general (or view + general, while a view is active) fit
  on a ~1080px-tall viewport without scrolling or needing the maximise
  control (§ Layout CSS `.feedback-dock` / `.feedback-section`).

- The dock is ordered **specific → general, top to bottom**: the currently-
  active screen's textarea first, then the design textarea (only when the
  iteration has ≥2 designs), then general notes last. While a view is
  active, the view textarea takes the design+screen rows' place, so the
  visible order becomes view → general. General sits last because it is
  the one field that never disappears or changes label — the specific field
  the user is looking at gets filled in first, the catch-all note last.
- The 💬 dock always shows **one textarea for the currently-active screen**
  (label: "Aktueller Screen: {screen-label}"). Its content is private to that
  screen.
- At the bottom, a **general notes textarea** stays visible regardless of
  the active screen — the user can append from any screen.
- When the user switches screens (via ☰ or keyboard), the screen textarea
  swaps to the new screen's notes. Previous screen's notes are preserved and
  come back when the user returns.
- `localStorage` persists all screen notes independently + the general notes
  + the active-screen id, so refresh / tab-close / browser-restart don't
  lose state.
- After Submit, a new iteration is appended (like decision). The user can
  switch back to iteration N via the iteration-tabs and re-read their frozen
  notes per screen.

## Annotation Layer (optional)

A second, independent feedback channel: instead of (or alongside) the 💬
dock's free-form notes, Claude can pin a numbered question directly onto a
concrete element of a screen and the user answers it right there. This is
the home of every component-level question — top 3 to top 7 per design
(`SKILL.md` § Step 0.5 count preferences); a view or a `decision` round
never carries one. Pins carry questions, not decoration: a design with
genuinely nothing element-level to ask has no layer, but that is the
exception.

- **Pin + short leader line to a bubble.** A numbered pin (`data-anno-pin`)
  sits on the annotated element; a short leader line connects it to a speech
  bubble (`data-anno-bubble`) beside it. Collapsed, the bubble shows one
  truncated line of the question plus a chevron. Expanded
  (`data-open="true"`), it shows the full question, an answer textarea and
  an attachment drop area.
- **Positioned in percentages, not pixels.** `--anno-x` / `--anno-y` on the
  wrapping `.anno` element place the pin as a percentage of the screen box —
  `.anno-layer` is `inset: 0`, so that box is the FULL section including the
  chrome safe area (§ Layout CSS), not the padded content box the mock is
  drawn in. Hand-picked coordinates must be read off the whole viewport, not
  off the artefact. `anchorToTarget()` measures live rects and is unaffected;
  this only matters for coordinates authored by hand. They survive any
  viewport size either way. `data-anno-side="right|left|top|bottom"`
  picks the PREFERRED side for the bubble — Claude chooses it at generation
  time from the element's position in the mock.
- **Always fully visible — pins and bubbles, collapsed and expanded.** At
  runtime `layoutAnno()` (§ Annotation Layer JS) keeps every pin and every
  bubble of the active screen inside the visible box — the viewport narrowed
  by each ancestor that clips overflow (the scrolling canvas) — and off the
  fixed chrome (☰ / 💬 FABs, eye pill, screen indicator, design switcher,
  viewport toggle, frozen bar, open dock, open ☰ panel). A pin is nudged
  inward (it never sits half off the edge); a bubble tries the authored side,
  then the opposite one, then bottom/top, keeps the one with the least
  hidden area, and is then shifted into view. This runs for COLLAPSED bubbles
  too — a one-line summary cut off at the window edge is the same defect as
  an expanded one — and again on resize, canvas scroll, and whenever the
  panel or dock opens or closes.
- **The eye pill (`#anno-toggle`) toggles the whole layer**, globally, for
  every screen — not per screen. It is shaped like a pin (same ring and
  accent) with an eye glyph instead of a number — no count — and swaps to a
  struck-through eye while the layer is hidden. It is the only thing that
  stays visible once the layer is hidden, so the user can always bring it
  back. It only renders
  when the active screen has ≥1 annotation (`updateAnnoUI()`, § Layout JS).
  Hiding the layer (`body.anno-hidden`) removes pins, leaders and bubbles
  completely — the design underneath must be pixel-clean, not just dimmed.
- **The two existing FABs are untouched.** ☰ and 💬 keep working exactly as
  before, independently of the annotation layer's state — the feedback dock
  remains the normal way to leave free-form notes whether the layer is
  shown or hidden.
- **Answers persist for free.** The answer textarea carries
  `data-comment="anno-{id}"`, so the existing `saveState()` / `restoreState()`
  (§ State Persistence) picks it up with zero extra code, exactly like any
  other comment field. The layer's own visibility (`body.anno-hidden`) is
  persisted the same way `state['theme']` is (§ State Persistence).
- **Attachments.** Each answer textarea carries `data-annotation="{id}"`
  and `data-attachable`, plus an adjacent mount
  `<div class="attach-slot" data-attach-slot="anno-{id}"></div>`. §
  Attachments wires exactly one attachment bar per field: it matches on
  `data-attachable` — not `data-comment`, which the textarea also carries,
  so matching on it would double-wire — and mounts the bar into this
  dedicated `.attach-slot` instead of appending after the textarea.
- **Frozen iterations stay browsable.** `.anno-pin`, `[data-anno-summary]`
  and `#anno-toggle` are exempt from the freeze sweep exactly like
  `.design-switch-item` and `#panel-toggle` — see `iteration-rules.md` §
  Freezing Design Iterations. The summary row must be exempt alongside the
  pin: it is a second, fully equivalent way to open the same bubble, and
  exempting only the pin leaves the layer half-navigable on a frozen tab.
  Answer textareas become `readonly`, never `disabled`.
- **Click-through safety.** A click on a pin, a summary row, or inside a
  bubble must never be interpreted as `data-screen-link` navigation, even
  though all three live inside the same `[data-screen]` — the click-through
  handler (§ Click-through Handler) explicitly ignores `[data-anno-pin]`,
  `[data-anno-summary]` and `.anno-bubble` before it looks for a navigation
  target.

See § Layout (markup), § Layout CSS (pin/bubble/eye-pill styling and the
top-edge partition) and § Layout JS (`wireAnnotationLayer()`) below for the
reference implementation, and § Screen-pattern markup for a worked example.

