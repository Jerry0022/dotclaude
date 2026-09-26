# Concept templates, part 04 of 16: Template: design — rules, devices, views, layout

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
  picks which side the bubble opens on — Claude chooses this at generation
  time from the element's position in the mock; there is no runtime
  collision math.
- **The eye pill (`#anno-toggle`) toggles the whole layer**, globally, for
  every screen — not per screen. It shows a live count of annotations on
  the *current* screen and is the only thing that stays visible once the
  layer is hidden, so the user can always bring it back. It only renders
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

## Views (optional)

A third, independent thing a `design` iteration may hold: non-visual
questions that belong **inside** the same round as the artefact they are
about, instead of being deferred to a separate `decision` iteration one
round later. A `section[data-view]` is a **top-level sibling of
`section[data-design]`** — switched exactly like a design, fullscreen, with
its own entry in the switcher and the panel TOC.

```html
<section data-iteration="3" data-iteration-template="design" data-active>
  <section data-design="dispatch" data-nav-label="Dispatch board" data-design-active="true">
    <section id="d1-s1" data-screen data-nav-label="Overview" data-screen-active="true">…</section>
    <section id="d1-s2" data-screen data-nav-label="Detail" hidden>…</section>
  </section>

  <section data-view="nav-model" data-view-kind="decision"
           data-nav-label="Navigation model" hidden>…</section>

  <section data-view="card-density" data-view-kind="comparison"
           data-nav-label="Card density A/B" hidden>…</section>
</section>
```

**Rules:**

- **≥1 `data-design` is mandatory** — see § Rules above. Views are never the
  only top-level content.
- **Exactly one top-level item is active** at a time: a design carrying
  `data-design-active="true"` (and NOT `hidden`) or a view carrying
  `data-view-active="true"` (and NOT `hidden`). Every other top-level item —
  every other design, every other view — carries `hidden`. `showView()` and
  `showDesign()` (§ Layout JS) both maintain this invariant; neither ever
  leaves two top-level items simultaneously visible.
- **Authored markup always makes a DESIGN the active item, never a view.**
  A view becomes active only at runtime, through `showView()` — from the
  switcher, the panel TOC, or the `_activeView` restore after a reload.
  This is not a style preference: `buildDesignUI()` early-returns without an
  active design, which would leave the switcher, both nav groups and all
  three dock textarea containers unbuilt. The same rule holds after a tab
  switch — the `iteration:changed` handler deliberately drops back to the
  incoming iteration's active design (§ Layout JS). **A reload is not a tab
  switch:** the boot `showIteration()` fires the same event for the round the
  layout has just restored, so the handler compares the incoming round with
  the one it last built (`shownIterationId`) and keeps a restored view that is
  on screen — otherwise the boot hid the view moments after the `_activeView`
  restore and the `showScreen()` → `saveState()` behind it deleted the key, so
  no question view ever survived the reload every iteration append triggers
  (pinned by `view-boot-restore.test.js` on the assembled fixture).
- `data-view` ids are unique **page-wide** — and this is the one id space
  where that matters, so do not pattern-match it off the others. Design ids
  and screen ids deliberately REPEAT across iterations (that is what lets
  `harvestDockValues()` carry a note forward when the same screen reappears
  in the next round); a view id that repeated would collide in exactly the
  places where designs and screens are meant to.
- **A view scrolls; a design screen does not.** `body` keeps
  `overflow: hidden` in `design` mode throughout — only the active view's own
  box scrolls internally (`overflow-y: auto`), never the page. See § Layout CSS.
- **When to use a view instead of a separate `decision` iteration** (also
  stated in `SKILL.md` § Step 1a): the question is *about the artefact in
  front of you* right now → a view inside this `design` iteration. The
  question stands on its own, independent of any one mockup → its own
  `decision` iteration. When in doubt, ask whether the user would need to
  flip back to a screen to answer sensibly — if yes, it is a view.
- **A view never re-asks the design choice** (`SKILL.md` § Step 1a
  → Orthogonality). The verdict *between* the designs comes from the dock's
  per-design / per-screen textareas — that is what `comments.designs` is
  for. A `decision` / `comparison` view asks a question whose answer holds
  whichever design wins; its `[data-decision]` groups are never the
  designs themselves, never the traits that tell them apart, and its prose
  never argues for or against a design. An alternative whose `data-label`
  (or heading) equals a `data-design`'s `data-nav-label` or id in the same
  iteration is refused by the deterministic gate (validation-gate.md P31).
  A view that names one design with `data-view-for` is *about* that
  design — a question inside it, not a vote on it.
- **Navigation.** `#screen-nav` gains a second `.screen-nav-group` below the
  designs group, headed by a plain (non-interactive) `.screen-nav-views-heading`
  label, then one `.screen-nav-view-item` button per view **that names no
  design** (see `data-view-for` below — a view tied to a design is listed
  under that design instead, and the views group is skipped entirely when
  every view is tied). The top-centre switcher (`#design-switcher`) lists
  designs and views in one row: design segments (`.design-switch-item`), a
  thin `.switcher-divider`, then view segments (`.view-switch-item`) — one
  click from anywhere, no detour through the ☰ panel. Both are
  auto-populated by `buildDesignUI()`, exactly like the design-only case.
- **`data-view-for="{designId}"` (optional, all view kinds).** A view that
  is *about one variant* names it: `buildDesignUI()` then nests the view's
  `.screen-nav-view-item` inside that design's `.screen-nav-group`, after
  its screens (`allViews.filter(v => v.dataset.viewFor === d.dataset.design)`);
  the views group lists only the views without a (valid) `data-view-for`
  and is not rendered when that list is empty. The top-centre switcher
  stays one flat row — carry the variant name in the `data-nav-label`
  ("Field mapping · Card A"). `collectDesignDecisions()` adds
  `"design": "{designId}"` to every `decisions[]` and `mappings[]` entry
  from such a view (§ Decision schema); the key is absent otherwise. A
  `data-view-for` that names no `data-design` of the same iteration is a
  gate warning (rule M10, validation-gate.md § Mappings) and falls back to the views group —
  nothing breaks, the grouping is just lost. Absent → variant-independent,
  exactly as before.
- **Screen indicator.** While a view is active, `#screen-indicator` shows the
  view's `data-nav-label` instead of the screen counter — the "Page N/total"
  segment (`#indicator-screen-info`) hides, `#indicator-view` shows. Every
  mount is null-guarded, same discipline as every other indicator segment.
- **Feedback dock.** While a view is active, the dock shows **general +
  one view-level textarea** (`data-comment="view-{id}"`,
  `data-view-comment="{id}"`, label from the view's `data-nav-label`) and
  hides the per-design and per-screen rows; the reverse holds while a design
  is active. The view textareas are built **once per iteration** by
  `buildViewTextareas()`, in the same build-once-per-iteration + hidden-swap
  pattern `buildDesignTextareas()`/`buildScreenTextareas()` already use —
  never rebuilt on a design/view switch, for the same reason documented at
  the top of § Layout JS: a rebuild would drop unsent text and truncate the
  submit payload.
- **Click-through safety.** The `data-screen-link` click-through handler
  (§ Click-through Handler) is scoped to the visible design and returns
  immediately whenever a view is active (`body[data-view-active="true"]`) —
  a stray `data-screen-link` button reachable only through markup reuse must
  never fire screen navigation while the user is looking at a view.
- **Freezing.** A frozen `design` iteration stays fully browsable: view
  switching and the view nav keep working, exactly like the design switcher
  and screen nav today. See `iteration-rules.md` § Freezing Design
  Iterations for the exact exemption list and how a frozen view's submitted
  values (bi-state selections, notes) are restored.

### View kind `decision`

Reuses the decision template's proven bi-state mechanics wholesale — no new
markup vocabulary. A `data-view-kind="decision"` view is a fullscreen frame
(heading + free prose authored above/between the alternatives) around one
or more `[data-decision]` groups, each with the same bi-state
(`Miteinbeziehen` / `Verwerfen`, default include) and the same mandatory
adjacent `textarea[data-comment="{decisionId}-note"]` as § Bi-State Variant
Evaluation. `ensureCommentSlots()` (§ Comment Slot Injection) already runs
page-wide on `DOMContentLoaded` and reaches every `[data-decision]` group
regardless of which template or view it lives in — nothing view-specific
needs wiring there. What changes is only the frame: fullscreen, no sidebar,
no 340px card constraint, so alternatives can carry as much authored context
as the question needs.

```html
<section data-view="nav-model" data-view-kind="decision" data-nav-label="Navigation model" hidden>
  <div class="view-frame">
    <h2>Navigation model</h2>
    <p>Tabs or a drawer for the second level? Both are wired in the mockup —
       flip back to Dispatch board to try either one before deciding.</p>

    <div class="variant-evaluation" data-decision="nav-tabs" data-label="Tabs">
      <h3>Tabs</h3>
      <p>Always-visible, one click, costs permanent header height.</p>
      <div class="eval-group">
        <label class="eval-option">
          <input type="radio" name="eval-nav-tabs" value="discard">
          <span class="eval-label">Verwerfen</span>
        </label>
        <label class="eval-option">
          <input type="radio" name="eval-nav-tabs" value="include" checked>
          <span class="eval-label">Miteinbeziehen</span>
        </label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="nav-tabs-note">{{decision.comment_label}}</label>
        <textarea id="nav-tabs-note" data-comment="nav-tabs-note" data-attachable
                  placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>

    <div class="variant-evaluation" data-decision="nav-drawer" data-label="Drawer">
      <h3>Drawer</h3>
      <p>Hidden by default, saves header height, one extra click per visit.</p>
      <div class="eval-group">
        <label class="eval-option">
          <input type="radio" name="eval-nav-drawer" value="discard">
          <span class="eval-label">Verwerfen</span>
        </label>
        <label class="eval-option">
          <input type="radio" name="eval-nav-drawer" value="include" checked>
          <span class="eval-label">Miteinbeziehen</span>
        </label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="nav-drawer-note">{{decision.comment_label}}</label>
        <textarea id="nav-drawer-note" data-comment="nav-drawer-note" data-attachable
                  placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>
  </div>
</section>
```

**Rules:**
- Mandatory: ≥2 named alternatives (`[data-decision]` groups), each with the
  bi-state selector and its adjacent note textarea.
- `.view-frame` is a plain wrapper (no positioning of its own) — the view's
  own `overflow-y: auto` scroll box does the layout work, see § Layout CSS.
- `collectDesignDecisions()` (§ collectDecisions (design branch)) scans every
  `[data-decision]` group inside every view of the active iteration — not
  just the one on screen — and tags each entry with `view: "{viewId}"`. See
  § Decision schema.

### View kind `comparison` — mandatory skeleton, free interior

Deliberately loose, the same way the design template's mockups are loose:
Claude is free to author whatever the comparison needs, as long as the
mandatory skeleton below is present. **Freedom here is a requirement, not an
afterthought** — do not pad every comparison view with every optional block
just because it is documented below.

**Mandatory:**
- a heading stating the question,
- **≥2** `article[data-compare-option="{id}"]`, each with a title and a free
  body (Claude may put anything inside — bullet points, a small mock,
  metrics, prose),
- a verdict control per option — the same bi-state (`Miteinbeziehen` /
  `Verwerfen`) as § Bi-State Variant Evaluation, keyed
  `data-decision="{optionId}"` so it reuses `ensureCommentSlots()` and
  `collectDesignDecisions()` unchanged; an additional "favourite" radio group
  (`name="compare-favourite-{viewId}"`) is allowed but never replaces the
  per-option bi-state,
- one note `textarea[data-attachable]` per option **and** one for the view as
  a whole — all wired the same way as every other comment slot (§ State
  Persistence picks them up via `data-comment`; `data-attachable` is the
  hook § Attachments wires, appending a bar since these notes have no
  dedicated `.attach-slot` mount).

**Two layouts, both first-class — pick per comparison via
`data-compare-layout`:**

| Value | Shape | Use when |
|---|---|---|
| `grid` | Option cards side by side in a `repeat(auto-fit, minmax(280px, 1fr))` grid | The options differ in SHAPE — each needs its own preview, mockup fragment or prose |
| `table` | One `table.cmp-table`: criteria as rows, options as columns, the evaluation controls in a final row | The options differ in VALUES along shared criteria — the reader wants to scan one row and compare like with like |

Reach for `table` whenever the same handful of criteria applies to every
option. A grid of cards then forces the reader to hop between columns to
compare a single criterion, which is precisely the work a comparison view
exists to remove. `.cmp-table` keeps its own horizontal scroll container so a
five-option comparison never widens the page.

**Optional, freely combinable — use only what the comparison needs:**
- a criteria matrix (`table.cmp-matrix`, criteria as rows, options as
  columns, an optional per-cell rating `<select>`) — this is the `grid`
  layout's companion; with `data-compare-layout="table"` the matrix IS the
  view and a second one is redundant,
- per-criterion weight sliders,
- pros/cons lists per option,
- meta chips (effort, risk, cost — whatever is relevant),
- live mockup fragments reusing `.device-frame` from § Screen-pattern markup,
- a "no preference" escape checkbox/radio.

```html
<section data-view="card-density" data-view-kind="comparison" data-nav-label="Card density A/B" hidden>
  <div class="view-frame view-compare" data-compare-layout="grid">
    <h2>Which card density for the dispatch board?</h2>
    <p>Both are wired into the Dispatch board mockup — switch back and try
       scrolling a full shift's worth of calls in each before deciding.</p>

    <div class="cmp-options">
      <article class="cmp-option" data-compare-option="compact">
        <h3>Compact</h3>
        <p>More calls per screen, denser typography, icon-only actions.</p>
        <!-- optional: pros/cons, meta chips, a .device-frame fragment -->
        <div class="eval-group" data-decision="compact" data-label="Compact">
          <label class="eval-option">
            <input type="radio" name="eval-compact" value="discard">
            <span class="eval-label">Verwerfen</span>
          </label>
          <label class="eval-option">
            <input type="radio" name="eval-compact" value="include" checked>
            <span class="eval-label">Miteinbeziehen</span>
          </label>
        </div>
        <div class="field-row decision-comment-row">
          <label for="compact-note">{{decision.comment_label}}</label>
          <textarea id="compact-note" data-comment="compact-note" data-attachable
                    placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
        </div>
      </article>

      <article class="cmp-option" data-compare-option="comfortable">
        <h3>Comfortable</h3>
        <p>Fewer calls per screen, larger tap targets, labelled actions.</p>
        <div class="eval-group" data-decision="comfortable" data-label="Comfortable">
          <label class="eval-option">
            <input type="radio" name="eval-comfortable" value="discard">
            <span class="eval-label">Verwerfen</span>
          </label>
          <label class="eval-option">
            <input type="radio" name="eval-comfortable" value="include" checked>
            <span class="eval-label">Miteinbeziehen</span>
          </label>
        </div>
        <div class="field-row decision-comment-row">
          <label for="comfortable-note">{{decision.comment_label}}</label>
          <textarea id="comfortable-note" data-comment="comfortable-note" data-attachable
                    placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
        </div>
      </article>
    </div>

    <!-- Optional favourite pick, additive to the per-option bi-state above. -->
    <fieldset class="cmp-favourite">
      <legend>{{view.compare_favourite}}</legend>
      <label><input type="radio" name="compare-favourite-card-density" value="compact"> Compact</label>
      <label><input type="radio" name="compare-favourite-card-density" value="comfortable"> Comfortable</label>
      <label><input type="radio" name="compare-favourite-card-density" value=""> {{view.compare_no_preference}}</label>
    </fieldset>

    <div class="field-row decision-comment-row">
      <label for="card-density-view-note">{{decision.comment_label}}</label>
      <textarea id="card-density-view-note" data-comment="card-density-view-note" data-attachable
                placeholder="{{decision.comment_placeholder}}" rows="3"></textarea>
    </div>
  </div>
</section>
```

**Layout:** `.cmp-options` is a CSS grid, `repeat(auto-fit, minmax(280px, 1fr))`
— 2–4 candidates sit side by side and **wrap to a new row instead of
shrinking** below a readable width. `data-compare-layout` on `.view-compare`
is a layout hint Claude may set (`"grid"` default, `"stacked"` when the
options genuinely need full width each) — purely presentational, no JS reads
it today.

**Rules:**
- Mandatory skeleton only: ≥2 `[data-compare-option]`, a per-option
  bi-state, one note per option + one for the view. Everything else is
  optional and freely combinable — do not treat the optional list as a
  checklist to fulfil.
- Each `[data-compare-option]`'s bi-state reuses `data-decision="{optionId}"`
  verbatim, so it is collected exactly like any other decision (tagged with
  `view: "{viewId}"`, § Decision schema) — do not invent a parallel
  "verdict" schema.
- The "favourite" radio group, when present, carries no `data-decision` and
  is picked up by the generic form catch-all (`el.name`/`el.id` key) like any
  other named input — it augments, never replaces, the per-option verdicts.

### View kind `mapping`

For the question *"which of these many items goes where"* — an
**assignment** of items to targets, not a choice between alternatives. A
`data-view-kind="mapping"` view is a fullscreen frame around one
`section[data-mapping]` whose content is a declarative JSON spec; the shared
engine (§ Information Mapping (engine)) renders the schematic view, the
matrix view, the tabs, the palette and every input from it. Claude authors
**nothing but the wrapper, the heading/intro and the spec** — never a cell.
The same block, with an inline note, lives in `free` rounds (§ Template:
free → Mapping block (optional)); a design concept uses this view instead.

```html
<section data-iteration="3" data-iteration-template="design" data-active>
  <section data-design="card_a" data-nav-label="Card A" data-design-active="true">…</section>
  <section data-design="card_b" data-nav-label="Card B" hidden>…</section>

  <section data-view="fields_a" data-view-kind="mapping" data-view-for="card_a"
           data-nav-label="Field mapping · Card A" hidden>
    <div class="view-frame view-mapping">
      <h2>Which vehicle fields go where on Card A?</h2>
      <p>Proposal pre-filled — correct it. Phone and desktop are separate.</p>
      <section data-mapping="veh_a" id="veh_a" data-nav-label="Field mapping · Card A">
        <script type="application/json" data-mapping-spec>{ … }</script>
      </section>
    </div>
  </section>
</section>
```

The spec's fields (`items`, `elements` / `axes`, `context`, `proposal`,
`proposalOrder`, `slotNotes`, `adhocItems`, `submitted`) are tabled in
§ Information Mapping (engine) → Spec; two complete examples are in the
design spec `docs/superpowers/specs/2026-09-13-concept-information-mapping-design.md`
§ 3.

**Rules:**
- **No inline note textarea inside a view.** The dock's view-level
  textarea (`data-comment="view-{viewId}"`, built by `buildViewTextareas()`
  like for every view) IS the mapping note — `collectMappings()` reads it
  into the entry's `note` whenever the mapping section sits inside a
  `section[data-view]`. Two note fields for one question is the rejected
  alternative (gate rule M5, validation-gate.md § Mappings, flags an inline
  `map-{m}-note` in a view).
  Per-slot notes (`slotNotes: true`) are generated inline in both homes.
- `data-view-for="{designId}"` is optional (rules in § Views (optional));
  a mapping about one variant names it, and the payload entry then carries
  `design`.
- `.view-mapping` lifts the frame's width (`max-width: none; padding: 1rem
  1.5rem`) — the two tier columns and a 30-column matrix need it. The matrix
  is its own two-axis scroll box; the page never widens.
- **≥ 1 `data-design` stays mandatory** — a mapping view is a view like any
  other and never the only top-level content.
- Ids: `data-mapping`, item, element, part, axis, column and context ids
  match `^[a-z0-9_]+$` (no `-`, `.`, `@`, `:`, `>` — the state encodings
  split on them). Item / element / axis ids are unique within a mapping,
  part ids within their element; **mapping ids are unique page-wide** (they
  are DOM ids: the section's `id`, the TOC anchor). `data-mapping` and `id`
  carry the same value.
- A view is never cloned into device frames (`renderDeviceStage` clones
  active screens only), so the section id and the JSON block are safe here.
  `<script type="application/json">` is inert; gate P18 forbids it only
  inside `section[data-screen]`.
- Switcher segment, `.screen-nav-view-item`, screen indicator label, dock
  (general + view-level textarea), `_activeView` restore and view switching
  on frozen tabs all behave exactly as for every other view. The progress
  (`n unassigned · n constraint(s) open`) is the mapping's own summary line
  and the per-tab counts; the panel TOC's progress mirror is a free-round
  affordance (`#section-nav` is hidden in design mode).
- Filtering is per view: the palette's pills (All / Unassigned / Multiple /
  Changed + search) narrow the schematic; the toolbar's **row filter** (All /
  Unassigned / Changed with live counts, `button.map-row-filter`) narrows the
  matrix rows and their groups, in every tab at once. Both share one
  predicate and are in-memory only — nothing is persisted, a frozen section
  keeps them usable.
- Freezing: when the round is frozen Claude writes the payload's
  `mappings[]` entry back into the spec as `submitted` (§ Information
  Mapping (engine) → Freezing) — the frozen view then shows the user's
  submission read-only, never the proposal.

## Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock

```html
<!-- data-template mirrors the ACTIVE iteration; applyIterationTemplate()
     rewrites it on every tab switch. body overflow is set by that function,
     the inline style below is only the first-paint value. -->
<html data-template="design">
<body style="overflow: hidden">
  <div class="concept-layout design fullscreen">
    <div class="concept-content">
      <main>
        <!-- data-viewports / data-orientations declare the form factors this
             concept's app supports (§ Responsive device views). Omit both for
             a desktop-only concept: the toggle then never renders and the
             layout is byte-for-byte what it was before device views existed.
             A single design may override them; the iteration is the normal
             place to declare. -->
        <section data-iteration="1" data-iteration-template="design" data-active
                 data-viewports="desktop tablet phone"
                 data-orientations="portrait landscape">
          <!-- One or more designs. Exactly one <section data-design> carries
               data-design-active="true" (others get `hidden`). A single
               design still needs this wrapper for markup uniformity — it
               just degenerates to today's behaviour (see body[data-single-design]
               below). -->
          <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true">
            <!-- All pages of THIS design live here. Exactly one carries
                 data-screen-active="true" (others get `hidden`). Every screen
                 is position: absolute; inset: 0 so it fills the viewport. A
                 <div class="device-frame"> inside holds the actual mock content. -->
            <section id="d1-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s2" data-screen data-nav-label="Credentials" hidden>
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s3" data-screen data-nav-label="Success" hidden>
              <div class="device-frame">…mock…</div>
            </section>
          </section>
          <section data-design="holotable" data-nav-label="Holotable" hidden>
            <section id="d2-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
          </section>

          <!-- Views — OPTIONAL top-level siblings of section[data-design],
               never a replacement for the ≥1 design above. See § Views
               (optional) and § Screen-pattern markup → View sections for the
               full worked examples of both kinds. -->
          <section data-view="nav-model" data-view-kind="decision"
                    data-nav-label="Navigation model" hidden>…</section>
          <section data-view="card-density" data-view-kind="comparison"
                    data-nav-label="Card density A/B" hidden>…</section>
        </section>
      </main>
    </div>

    <!-- Minimal position indicator (top-left overlay) — NOT a header bar.
         Built entirely in JS from {{design.position_iteration}} and
         {{design.position_page}} (§ UI Locale) — the iteration segment only
         renders when the concept has >1 iteration, the design segment only
         when the iteration has >1 design. See buildDesignUI() below; the
         spans here are just the mount points it fills in. -->
    <div class="screen-indicator" id="screen-indicator">
      <!-- updateIndicator() (§ Layout JS) fills these mount points on every
           iteration/design/screen switch. Each optional segment carries its
           own trailing " · " INSIDE the span, so hiding the span removes the
           separator with it and never leaves a dangling one.
           Static values are the generation-time first-paint fallback
           (3-screen, single-iteration, single-design example) so the page
           never flashes empty before JS runs.
           EVERY id below is required — updateIndicator() null-guards each
           lookup, so a missing span does not throw; the segment simply never
           appears. That failure is silent, which is why the reference markup
           must carry all four. -->
      <span id="indicator-iteration" hidden>{{design.position_iteration}} <strong id="active-iteration-idx">1</strong> · </span>
      <span id="indicator-design" hidden><strong id="active-design-label">Dispatch</strong> · </span>
      <!-- Screen-counter segment — swaps out entirely (not just dimmed) for
           #indicator-view below while a view is active. Both are
           null-guarded by updateIndicator() (§ Layout JS), so a page that
           omits one of the two degrades silently rather than throwing. -->
      <span id="indicator-screen-info">
        {{design.position_page}} <strong id="active-screen-idx">1</strong> / <span id="total-screens">3</span>
        · <span id="active-screen-label">Welcome</span>
      </span>
      <!-- View-label segment — OPTIONAL, only ever shown while a
           section[data-view] is the active top-level item (§ Views
           (optional)). hidden by default so a page with no views never
           shows an empty strong tag. -->
      <span id="indicator-view" hidden><strong id="active-view-label">Navigation model</strong></span>
    </div>

    <!-- Annotation layer eye pill — OPTIONAL, only emitted when at least one
         screen carries [data-anno-layer]. Sits on the left edge directly
         BELOW #screen-indicator (never in the top-left corner itself, which
         the indicator owns) — see § Layout CSS for the exact offset and the
         updated top-edge partition comment. `hidden` by default; JS
         (updateAnnoUI(), § Layout JS) reveals it only when the ACTIVE screen
         has ≥1 annotation, and keeps the count live across screen/iteration
         switches. aria-pressed / aria-label reflect body.anno-hidden. -->
    <button id="anno-toggle" class="anno-toggle-fab" type="button" hidden
            aria-pressed="true"
            aria-label="{{anno.toggle_hide}}"
            data-label-show="{{anno.toggle_show}}"
            data-label-hide="{{anno.toggle_hide}}">
      <span class="anno-eye" aria-hidden="true">👁</span>
      <span id="anno-count" class="anno-count">0</span>
    </button>

    <!-- Design switcher (ghost bar, top centre) — one segment per
         <section data-design>, only rendered when the iteration has ≥2
         designs (hidden via body[data-single-design], see Layout CSS).
         Auto-populated by buildDesignUI(); resting state shows only the
         active label (CSS collapses the rest), hover/:focus-within expands
         to the full segmented control.
         When the iteration ALSO has ≥1 view (§ Views (optional)),
         buildDesignUI() appends a thin .switcher-divider then one
         .view-switch-item per view, in the SAME row — switching between a
         design and a question about it is one click from anywhere. -->
    <nav class="design-switcher" id="design-switcher" aria-label="{{design.switch_label}}">
      <!-- auto-populated: one <button class="design-switch-item"> per
           design, then (if any) a <span class="switcher-divider"> and one
           <button class="view-switch-item"> per view -->
    </nav>

    <!-- Two FABs — the only floating UI besides the screen itself.
         BOTH carry two labels: the toggle swaps `data-tip` AND `aria-label`
         together with `aria-expanded`, so pointer users get a hover tooltip
         and screen-reader users hear the correct NEXT action ("Open" vs
         "Minimize"). The labels are tooltip-only on purpose — an unlabelled
         emoji circle is undiscoverable, but a visible pill would break the
         shared 60px circle geometry the two FABs are pinned to (gate P13).
         Every label string comes from the locale table; never bake English
         (or "Feedback") in here.
         `data-untouched` on the 💬 FAB drives a one-shot attention pulse
         (§ Layout CSS) that the JS clears on the first dock open or the
         first keystroke inside the dock — a returning user is never nagged
         twice. -->
    <button id="panel-toggle" class="panel-fab"
            aria-label="{{panel.toggle_open}}"
            data-tip="{{panel.toggle_open}}"
            aria-expanded="false"
            data-label-open="{{panel.toggle_open}}"
            data-label-close="{{panel.toggle_close}}">☰</button>
    <button id="feedback-toggle" class="feedback-fab"
            aria-label="{{proto.feedback_toggle}}"
            data-tip="{{proto.feedback_toggle}}"
            aria-expanded="false"
            data-untouched="true"
            data-label-open="{{proto.feedback_toggle}}"
            data-label-close="{{panel.minimize}}">💬</button>

    <!-- Device-view toggle (bottom-left) — the fourth corner, and the
         quietest thing on the page. One button, one gesture: each click
         advances to the next DECLARED viewport and wraps around. It is
         deliberately NOT a 60px FAB — those two are one accent-coloured
         component for the page's two actions, this is a view control that
         must not compete with them. Hidden entirely when the iteration
         declares fewer than two viewports (body[data-single-viewport]).
         Every label is a data-attribute rather than baked text: the JS
         rewrites glyph + label + aria-label on each cycle, and the locale
         substitution has to happen once, here, at generation time. -->
    <button id="viewport-toggle" class="viewport-toggle" type="button" data-mode="desktop"
            data-label-prefix="{{design.viewport_switch}}"
            data-label-desktop="{{design.viewport_desktop}}"
            data-label-tablet="{{design.viewport_tablet}}"
            data-label-phone="{{design.viewport_phone}}"
            data-label-portrait="{{design.orientation_portrait}}"
            data-label-landscape="{{design.orientation_landscape}}"
            aria-label="{{design.viewport_switch}}">
      <!-- Inline SVG, not emoji: 🖥/📱 render as full-colour platform art
           that clashes with a dark chrome pill and differs per OS. All three
           share one 20×20 grid, stroke-only, currentColor — so they read as
           one set. The monitor keeps a stand because a bare rectangle is
           indistinguishable from a tablet in landscape; neither tablet nor
           phone gets a notch or home button, which would have to move
           between orientations and carries no information the label lacks. -->
      <svg data-glyph="desktop" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="16" height="11" rx="1.5"/>
        <line x1="10" y1="14" x2="10" y2="17"/>
        <line x1="7" y1="17" x2="13" y2="17"/>
      </svg>
      <svg data-glyph="tablet" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="2" width="12" height="16" rx="2"/>
      </svg>
      <svg data-glyph="phone" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="1" width="8" height="18" rx="2.2"/>
        <line x1="8.5" y1="3.3" x2="11.5" y2="3.3"/>
      </svg>
      <span class="viewport-toggle-label">{{design.viewport_desktop}}</span>
    </button>

    <!-- Decision panel (☰) — contains: iteration-tabs, screen-nav, submit.
         No section-TOC here: the screen-nav replaces it for design. -->
    <aside class="concept-decision-panel" id="decision-panel">
      <!-- Same head row as § Common Structure: round label · back link ·
           🕘 rounds chip · theme toggle · ✕. This is the design round's ONLY
           theme control — the document header that used to carry one is
           hidden in design mode (§ Layout CSS). -->
      <div class="panel-head">
        <span class="panel-here-round" data-here-round></span>
        <!-- Same wrapper as § Common Structure — the group (not either
             child) carries margin-left: auto, so the chip stays right-aligned
             whether or not #panel-here-back is [hidden]. -->
        <span class="panel-here-right">
          <button type="button" id="panel-here-back" class="link-btn panel-here-back" hidden></button>
          <button type="button" id="panel-here-rounds" class="panel-here-rounds-btn" hidden
                  aria-haspopup="true" aria-expanded="false" aria-controls="panel-here-rounds-list"
                  data-tip="{{nav.rounds_chip}}" aria-label="{{nav.rounds_chip}}">
            <span aria-hidden="true">🕘</span> <span data-here-rounds-count></span>
          </button>
        </span>
        <button type="button" id="theme-toggle" class="theme-toggle-btn"
                data-label-light="{{theme.to_light}}"
                data-label-dark="{{theme.to_dark}}"
                data-tip="{{theme.to_light}}" aria-label="{{theme.to_light}}">
          <span class="theme-glyph" data-glyph="sun" aria-hidden="true">☀️</span>
          <span class="theme-glyph" data-glyph="moon" aria-hidden="true">🌙</span>
        </button>
        <button id="panel-close" class="panel-close-btn" aria-label="{{panel.close}}">✕</button>
      </div>
      <!-- Same four-part anatomy as § Common Structure (here / scroll box /
           status / foot) — only the containing aside differs. -->
      <div class="panel-here" id="panel-here">
        <span class="panel-here-section" data-here-section hidden></span>
        <div class="panel-here-rounds-list" id="panel-here-rounds-list" hidden role="list">
          <!-- auto-populated by buildRoundsChip() -->
        </div>
      </div>
      <div class="panel-nav-scroll">
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}"><!-- chips --></nav>
      <!-- #section-nav also lives on the design skeleton: a free/decision round
           on a design concept (the final report is always free) renders its TOC
           here; CSS hides it while a design round is active and #screen-nav
           otherwise (html[data-template] mirrors the active round). Without it
           the final report of every design concept had no TOC at all — and no
           ⚠ Danach-von-Hand entry. -->
      <nav class="section-nav" id="section-nav" aria-label="{{nav.sections}}"></nav>
      <nav class="screen-nav" id="screen-nav" aria-label="Screens">
        <!-- auto-populated, two levels: one .screen-nav-group per
             <section data-design>, a .screen-nav-design-heading button at
             the top of each group, then one .screen-nav-item per page
             nested beneath. Single-design pages skip the heading (CSS,
             body[data-single-design]) and render as today's flat list.
             The ● marker applies at both levels: a design heading shows it
             when ANY of its pages, or its own design-level comment field,
             carries unsubmitted text. Clicking either level switches and
             closes the panel.
             A SECOND .screen-nav-group renders below the designs group
             whenever the iteration has ≥1 view (§ Views (optional)): a
             plain, non-interactive .screen-nav-views-heading label, then
             one .screen-nav-view-item button per view. Own class family
             (screen-nav-view-*) so it can be styled independently of the
             design nav items it sits below. -->
      </nav>
      </div><!-- /.panel-nav-scroll -->
      <!-- Status line — same contract as § Common Structure: #connection-status
           keeps its [data-state] (connecting | connected | disconnected), the
           composed line + the six-state .panel-status[data-status] are
           rendered by renderPanelStatus(); no overlay, no acknowledge button;
           starts in "connecting" and never flashes "disconnected" before the
           first heartbeat response. The progress <ol> lives under the line. -->
      <div class="panel-status" id="panel-status" data-status="connecting">
        <div id="connection-status" class="status-line" data-state="connecting" role="status" aria-live="polite">
          <span class="status-glyph" aria-hidden="true">◐</span>
          <span class="conn-label">{{panel.status_connecting}}</span>
        </div>
        <details class="status-detail" id="status-detail" hidden>
          <summary class="status-detail-row">
            <span class="status-dots" id="status-dots" aria-hidden="true"></span>
            <span class="status-detail-label">{{panel.status_detail}}</span>
          </summary>
          <ol class="status-steps" id="status-steps" aria-live="polite">
            <li data-step="submitted" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_submitted}}</span>
            </li>
            <li data-step="received" data-state="active">
              <span class="step-icon" aria-hidden="true">⏳</span>
              <span class="step-label">{{panel.step_received}}</span>
            </li>
            <li data-step="reality-check" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_reality_check}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_reality_check_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_reality_check}}</span>
            </li>
            <li data-step="implemented" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_waiting}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_implemented_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_implemented}}</span>
            </li>
          </ol>
        </details>
      </div>
      <!-- CTA foot — pinned, ≤120px, no FAB gutter below it: the 💬 FAB
           hides while the panel is open (§ Panel Chrome CSS). -->
      <div class="panel-cta">
      <div id="panel-ready">
        <div class="submit-split">
          <button id="submit-iterate-btn" class="primary submit-btn" data-tip="{{panel.submit_iterate_hint}}">
            <span class="submit-label">{{panel.submit_iterate}}</span>
            <span class="hint-cache" data-cache-hint="iterate" hidden>
              <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
            </span>
          </button>
          <button type="button" id="submit-menu-btn" class="submit-menu-btn"
                  aria-haspopup="menu" aria-expanded="false" aria-controls="submit-menu"
                  aria-label="{{panel.submit_menu}}" data-tip="{{panel.submit_menu}}">
            <span aria-hidden="true">▾</span>
          </button>
        </div>
        <div id="submit-menu" class="submit-menu" role="menu" hidden>
          <button id="submit-implement-btn" class="implement-btn" role="menuitem" data-tip="{{panel.submit_implement_hint}}">
            <span class="warn-icon" aria-hidden="true">⚠</span>
            {{panel.submit_implement}}
          </button>
          <p class="hint hint-cache" data-cache-hint="implement" hidden>
            <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
          </p>
          <p class="hint submit-menu-hint">{{panel.submit_menu_hint}}</p>
        </div>
      </div>
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
      </div>
      <!-- The remaining two panel states — #panel-frozen and
           #panel-final-report — are IDENTICAL to § Common Structure and MUST
           be copied verbatim from there into this .panel-cta. showIteration()
           switches all four states regardless of template, so a design page
           that ships only the two above loses its close-out sheet the moment
           a final report is appended, and shows an empty panel on every past
           tab. The aside itself is identical everywhere (§ Panel Chrome (all
           templates)); only what surrounds it differs. -->
      </div><!-- /.panel-cta -->
    </aside>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- Feedback dock (💬) — speech-bubble overlay, ordered specific → general,
         top to bottom: current screen → design (when ≥2 designs) → general;
         while a view is active, the view row takes the design+screen rows'
         place (§ Layout CSS view-mode swap) so the visible order becomes
         view → general. General sits LAST because it is the one field that
         never disappears or changes label as the user navigates — the user
         fills in the specific thing (what they're looking at) first and the
         catch-all note last, and general's fixed position at the bottom
         means it never jumps even though the rows above it swap content.
         Anchored to the 💬 FAB (bottom-right): the FAB stays visible and
         clickable, the dock floats above/around it like a chat bubble.
         Now that ☰ lives top-right (Wave 3), the dock no longer reserves
         space for it — see Layout CSS geometry comment.
         The close button minimises (does not destroy state) — user input
         is preserved on close, no value is lost.
         CLOSED by default (data-open="false"): at concept start the user
         wants to look at the mockup, not at three empty textareas covering
         it. data-size is written by applyDockSize() — § Panel Chrome JS.
         The dock is PAGE CHROME (§ Panel Chrome (all templates)): the
         header row and the general section below are the same markup every
         template carries; only the three row containers (#screen-textareas,
         #design-textareas, #view-textareas) are the design layout's
         addition, and they fold away by CSS while a document round of the
         same page is on screen. -->
    <aside class="feedback-dock" id="feedback-dock" data-open="false" data-size="compact" data-user-maximized="false">
      <div class="feedback-dock-header">
        <strong>{{proto.feedback_title}}</strong>
        <!-- Maximise (Work package B) is a distinct control from minimise:
             minimise CLOSES the dock (data-open toggle), maximise RESIZES it
             (data-size override) without touching data-open at all. The two
             must never be merged into one button. -->
        <button id="feedback-maximize" class="feedback-maximize-btn" aria-pressed="false"
                aria-label="{{panel.maximize}}" data-tip="{{panel.maximize}}">⤢</button>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.minimize}}" data-tip="{{panel.minimize}}">−</button>
      </div>
      <div class="feedback-section">
        <label>{{proto.feedback_current}}: <strong id="dock-screen-label">Welcome</strong></label>
        <!-- One hidden textarea per screen. Only the active one is shown.
             Each carries data-comment="{screen-id}" AND
             data-screen-comment="{screen-id}" — so saveState/restoreState
             treats it like any comment field. -->
        <div id="screen-textareas" data-placeholder="{{proto.feedback_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <!-- Design row — omitted for single-design iterations via
           body[data-single-design="true"] (Layout CSS), no JS branching.
           One hidden textarea per design; only the active one is shown,
           same swap mechanism as the per-screen row above. Each carries
           data-comment="design-{id}" AND data-design-comment="{id}". -->
      <div class="feedback-section">
        <label>{{design.feedback_design}}: <strong id="dock-design-label">Dispatch</strong></label>
        <div id="design-textareas" data-placeholder="{{design.feedback_design_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <!-- View row — OPTIONAL, only present when the iteration has ≥1
           section[data-view] (§ Views (optional)). Shown ONLY while a view
           is the active top-level item (body[data-view-active="true"],
           § Layout CSS); the design and per-screen rows above hide in that
           state and this one takes their place — never all three visible
           at once. One hidden textarea per view, built ONCE per iteration by
           buildViewTextareas(), same build-once-swap-hidden discipline as
           the design/screen rows. Each carries data-comment="view-{id}" AND
           data-view-comment="{id}". -->
      <div class="feedback-section">
        <label>{{design.feedback_view}}: <strong id="dock-view-label">Navigation model</strong></label>
        <div id="view-textareas" data-placeholder="{{design.feedback_view_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <div class="feedback-section">
        <label>{{proto.feedback_general}}</label>
        <textarea id="design-general-feedback" data-comment="general" data-attachable
                  placeholder="{{proto.feedback_general}}"></textarea>
        <div class="attach-slot" data-attach-slot="general"></div>
      </div>
    </aside>
  </div>

  <!-- Shared content dimmer + frozen bar — see Common Structure for
       behavior + CSS. Both are page-level chrome and MUST be copied verbatim:
       showIteration() drives them regardless of template. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       data-tip="{{panel.dim_dismiss}}" hidden></div>
  <div class="frozen-bar" id="frozen-bar" role="status" hidden>
    <span class="frozen-bar-text">🕘 <strong data-frozen-bar-title>Iteration 1</strong> {{frozen.bar_hint}}</span>
    <button type="button" id="frozen-bar-back">{{frozen.bar_back}}</button>
  </div>
</body>
</html>
```

