# Post-Generation Validation Gate, part 2: template-specific patterns and failure handling

Continues [validation-gate.md](validation-gate.md) (Phase 0 to Generic Form Collection).

## Phase 2 — Template-specific patterns

Run the subset matching the template picked per-iteration in Step 1a of
`SKILL.md`, using each iteration's own `data-iteration-template`.

### Template: decision

| # | Pattern | Purpose |
|---|---------|---------|
| D1 | `eval-group` OR `tri-state-group` | Bi-state evaluation container (tri-state-* is legacy alias) |
| D2 | `eval-` (as input name prefix) | Bi-state radio name convention (`eval-{variant-id}`) |
| D3 | `data-decision` | Variant card marker for `collectDecisionDecisions()` |
| D4 | `value="include"` | One of exactly two allowed radio values |
| D5 | `value="discard"` | The other allowed value |

The selector MUST have exactly two radio inputs per variant (no `value="only"`).
If the page contains no variants (unusual for the decision template), D1–D5
may be skipped — but in that case the content likely belongs in the `free`
template instead. Reconsider the template pick before suppressing these.

### Template: design (legacy alias: prototype)

The dock patterns P1 / P2 / P5 / P11 / P12 / P13 / P13b–P13g are NOT here any
more: the 💬 dock is page chrome in every template (#399) and they run on
every page from the Phase 1 block above. What follows is only what a design
round adds — the row containers, the screen markup, the design switcher and
the device views.

| # | Pattern | Purpose |
|---|---------|---------|
| P3 | `screen-textareas` OR `feedback-screen-list` | Auto-populated per-page comment container (legacy pages use `feedback-screen-list`) |
| P4 | `data-screen` | Marker on screen sections that feed the dock |
| P6 | `panel-fab` | FAB that opens the decision overlay |
| P7 | `panel-backdrop` | Overlay backdrop element |
| P8 | `collectDesignDecisions` OR `collectPrototypeDecisions` | Design branch of `collectDecisions` (legacy pages may still name it `collectPrototypeDecisions`) |
| P9 | `data-design` | Design wrapper marker — required even for a single design (uniform markup shape) |
| P10 | `data-design-comment` | Design-level feedback textarea — required only when the iteration has ≥2 `data-design` wrappers |
| P14 | `data-device-clone` appearing in BOTH `saveState()` and `collectAllFormFields()` | Device frames are clones of the mockup living inside `section[data-iteration][data-active]`. Without the `closest('[data-device-clone]')` filter in both, every mock field ships two extra times in `allFields` under namespaced names, and the localStorage blob fills with `dv1-*` keys that the next screen switch deletes again. Silent in both directions — the panel goes green either way. |
| P14b | `restoreState()` called IMMEDIATELY after `buildDesignUI()` in § Layout JS's own `DOMContentLoaded` handler — before any `showScreen()` / `showView()` / `primeDock()` — AND `saveState()` merging over the stored blob rather than rebuilding it from the DOM | Two halves of one defect, both required. The dock textareas do not exist until `buildDesignUI()` builds them, and § State Persistence's `DOMContentLoaded` listener has NO guaranteed order against § Layout JS's — so the page-load `restoreState()` can scan an empty dock, write nothing, and never re-run. The second half is what makes that fatal: a `saveState()` that rebuilds `state = {}` from the live DOM then persists a blob with no `text:{screen-id}` keys on the very first `input` event, DELETING every dock note instead of merely failing to show it. ORDER WITHIN the handler is load-bearing, not just "somewhere after `buildDesignUI()`": `showScreen()` ends in `saveState()`, and the freshly rebuilt textareas are EMPTY, so a restore placed after it reads a blob that call has already blanked. Grep for a `JSON.parse(localStorage.getItem(STORAGE_KEY))` seed at the top of `saveState()`, and for the guarded `restoreState()` sitting BEFORE the first `showScreen(`/`primeDock(` in both the load handler and the `iteration:changed` handler (which rebuilds the dock too). Third half, belt and braces: `saveState()` must refuse to overwrite a non-empty stored `text:` value with `''` from a node the user has never typed into (`data-touched`, stamped from a trusted `input` event) — otherwise any future call ordered before the restore re-opens the same hole. Keys written conditionally (`_activeView`, `_userInteracted`) MUST be `delete`d in the else branch — under a merge, "not written" no longer means "cleared". Silent both ways: the checker panel is green and the dock looks merely empty. |
| P15 | `applyViewport()` called from inside `showScreen()` | The single route that rebuilds the frames for the screen that just became active and re-clamps the mode against what the design declares. Defined-but-never-called leaves the toggle switching a mode nothing renders. |
| P15b | **exactly ONE non-hidden `section[data-screen]` inside the active design after any design switch or nav click** | **Behavioural assertion, not a grep:** switch designs via the ghost bar, then click every `#screen-nav` entry of every design, and after each click count the visible screens of the design that ended up active — it MUST be exactly 1, never 0. Two ways to reach 0: `buildDesignUI()`'s build-time `activeDesign()` going stale (it never re-runs on a switch, so a nav handler comparing against it calls `showScreen()` with another design's id), and `showScreen()` hiding on `s.id !== id` without checking that `id` belongs to the design at all. Both blank the canvas silently — the checker panel stays green. Requires the click-time `const cur = activeDesign()` in the nav handler AND the `screens[0].id` fallback in `showScreen()`. **Assert visibility with `el.getClientRects().length`, not `getComputedStyle(el).display`:** a screen hidden by an ancestor (`section[data-design][hidden]`) still computes `display: block` on itself, so the `display` read reports every design's screens as visible and the check passes on a blank page. |

Both dock textareas (P5 general field, `design-textareas`/`screen-textareas`/`view-textareas`) and every attachable field inside them MUST carry `data-attachable` per pattern 41 — the dock is the field most likely to be missed since it is rebuilt by `buildDesignUI()` rather than authored once inline.

**Only when the page declares device views** (any `section[data-iteration]`
or `section[data-design]` carrying `data-viewports` with ≥2 entries):

| # | Pattern | Purpose |
|---|---------|---------|
| P16 | `viewport-toggle` | The bottom-left device switcher. A page that declares two viewports and ships no toggle offers no way to reach the second one. |
| P17 | `bestFit` + `device-fit` | The fit maths and the size-compensating wrapper. `transform: scale()` leaves the layout box unscaled, so a page missing `.device-fit` scrolls around empty space and puts the top of the stage out of reach. |
| P18 | NO `<script>`, `<canvas>`, `<style>` or `<iframe>` inside any `section[data-screen]`, and NO `vh`/`vw`/`dvh`/`svh` unit or `position: fixed` in their CSS | These survive `cloneNode()` badly or not at all (a cloned `<script>` never runs, a cloned `<canvas>` is blank) or resolve against the browser window instead of the frame. See templates-design.md § Responsive device views. |

**P3 (here) and P5 (Phase 1) carry alternates:** the dock ids changed
(`feedback-screen-list` → `screen-textareas`, `proto-general-feedback` →
`design-general-feedback`). Accept both, prefer the new ones.

At least one `<section data-screen id="…" data-nav-label="…">` MUST exist
inside the active design. A design iteration with zero screens can't collect
per-screen feedback. With ≥2 `data-design` wrappers, exactly one MUST carry
`data-design-active="true"` and the rest `hidden`.

**Annotation layer (conditional — only when the page contains
`[data-anno-layer]`):** the layer is optional (§ Annotation Layer
(optional), templates.md); a design page with none of these patterns is not
a failure. Once a page contains `data-anno-layer` anywhere, run this subset:

| # | Pattern | Purpose |
|---|---------|---------|
| P14 | `anno-toggle` | The eye pill that toggles the whole layer — must exist once the page has any `[data-anno-layer]`, and must NOT be inside `html:not([data-template="design"])`-hidden chrome. |
| P15 | `anno-hidden` | Body class the eye pill toggles; drives the `body.anno-hidden .anno-layer { display: none }` pixel-clean hide. |
| P16 | `data-anno-pin` | Pin marker inside each `.anno` wrapper. |
| P17 | `data-anno-bubble` | Bubble marker, `id` MUST match the pin's `aria-controls`. |
| P18 | `data-annotation` on a `textarea` | The answer field the payload scan (`collectDesignDecisions`) reads. |
| P19 | `data-comment="anno-` (prefix) on that same textarea | Required for `saveState()`/`restoreState()` to persist the answer — a `data-annotation` textarea without a matching `data-comment` loses its answer on reload. |
| P20 | `data-attach-slot="anno-` (prefix) | Dedicated attachment mount next to the answer textarea. `initCommentAttachments()` (pattern 42) places the bar inside this mount rather than appending after the textarea — see templates-attachments.md § Attachments. |
| P21 | `wireAnnotationLayer` | The JS that wires pins, bubbles, the eye pill and the answered-state of each pin. Missing → every pin renders inert. |
| P21b | **every `data-anno` value is unique page-wide** | **Structural assertion, not a grep for a token:** collect all `data-anno="..."` values and fail on any duplicate. Two annotations sharing an id share ONE `text:anno-{id}` storage slot — the last one saved wins, the other answer is lost on reload, and both pins come back showing the same text. Their `annotations[]` payload entries collide too. Prefix ids with the screen id (`d1-s2-a1`) so uniqueness is structural. |

**Failure for P14–P21:** if `[data-anno-layer]` is present anywhere on the
page but any of these is missing, treat it the same as a missing mandatory
pattern for that iteration — a half-wired annotation layer (pins that don't
open, or open onto a bubble that never persists) is worse than no layer at
all. A page with **zero** `[data-anno-layer]` occurrences skips P14–P21
entirely.

**Views (conditional — only when the page contains `data-view=`):** views
are optional (§ Views (optional), templates.md); a design page with none of
these patterns is not a failure. Once a page contains `data-view` anywhere,
run this subset:

| # | Pattern | Purpose |
|---|---------|---------|
| P22 | `section[data-design]` — at least one, count ≥1 | **Structural assertion, always run once `data-view=` is present:** a design iteration with views MUST still carry ≥1 `data-design`. Views never stand alone — a page with `data-view` and zero `data-design` picked the wrong template; it belongs in `decision`. |
| P23 | `data-view-kind="decision"` OR `data-view-kind="comparison"` OR `data-view-kind="mapping"` | Every `[data-view]` MUST declare its kind — an unrecognised or missing kind means the page invented a fourth shape with no reference implementation. |
| P24 | `view-switch-item` | View segments in the top-centre switcher — required once any view exists, so switching to it is reachable without opening the ☰ panel. |
| P25 | `screen-nav-view-item` | View entries in the panel's second `#screen-nav` group. |
| P26 | `showView` | The JS that switches the active top-level item to a view — missing means the switcher/nav segments render but do nothing. |
| P27 | `data-decision` inside every `[data-view-kind="decision"]` — at least one, count ≥2 | A decision-kind view with fewer than two alternatives is not a decision; reconsider whether it belongs in the artefact's mockup notes instead. |
| P28 | `data-compare-option` inside every `[data-view-kind="comparison"]` — count ≥2 | A comparison-kind view MUST have ≥2 `article[data-compare-option]` — see § Views (optional) → View kind `comparison`. |
| P29 | `data-decision` inside every `[data-compare-option]`'s owning `[data-view-kind="comparison"]` — one per option | Each comparison option's verdict reuses the bi-state `[data-decision]` markup, not a bespoke control. |
| P30 | `view-textareas` | Dock mount for the per-view feedback textarea (general + per-view shown while a view is active, § Layout — Fullscreen…). |
| P30b | `_activeView` inside the `DOMContentLoaded` restore block — AND `shownIterationId` compared against the incoming round inside the `iteration:changed` handler | Reload persistence for the active view (Work package C) — without it, a reload always drops back to design mode even if the user was reading a question view when they left. Must be tried BEFORE the pre-existing `_activeScreen` restore, with a defensive fallback to it when the stored view id no longer resolves. The second half is what makes the first one hold: the boot `showIteration()` fires `iteration:changed` for the same round right after the restore, and a handler that treats every event as a tab switch hides the view again and lets the `showScreen()` → `saveState()` behind it delete the key. Same-round event → keep the visible view (`activeViewVisible()`); different round → drop back to the design, as before. Pinned by `view-boot-restore.test.js` on the assembled fixture. |

| P31 | **no `[data-decision]` inside a `decision` / `comparison` view whose `data-label` (fallback: its first `h2`/`h3` text) equals — case-insensitively, trimmed — the `data-nav-label` or the `data-design` id of any `section[data-design]` in the same iteration** | **Structural assertion, not a grep:** the view re-asks the design choice. Which design wins is read from the dock's per-design notes (`comments.designs`); a view whose alternatives are the designs again asks the same question twice and the two answers can disagree. `SKILL.md` § Step 1a → Orthogonality. Enforced by `hooks/lib/concept-gate.js` (`findViewOverlap`) — the crude form only; alternatives that *paraphrase* the designs ("Sidebar as in A") are the manual sweep's job. |

| P32 | **no selector inside a `<style>` of any `section[data-iteration]` names an engine chrome class (`concept-decision-panel`, `panel-fab`, `panel-backdrop`, `feedback-fab`, `feedback-dock`, `iteration-tabs`, `iteration-tab`, `screen-indicator`, `design-switcher`, `frozen-bar`, `closeout-sheet`, `device-frame`, `panel-here`, `panel-status`, `concept-layout`, `concept-content`, …), and no rule there is a bare single-class selector without a per-design prefix (`.d1-…`, `.mock-…`)** | **Structural assertion, not a grep:** a mock's `<style>` shares the document with the engine, so `.overlay { position: absolute; left: 0; pointer-events: none }` for a fog SVG restyled the decision panel — docked left, ☰ FAB dead (#400). Enforced by `hooks/lib/concept-gate.js` (`findChromeCollisions`): every rule of every `<style>` inside an iteration, `@media` recursed, comments stripped. Fix: prefix or scope the mock class; never touch an engine class. templates-design-wiring.md § Design layout rules. |
| P33 | `id="screen-nav"` (the element) AND `.screen-nav {` (its CSS rule) AND `function activeDesign` AND `showScreen` (as `window.showScreen =` or `function showScreen`) | **Design engine integrity (#430)** — the design-scoped half of entry 64, asserted only when `<html data-template="design"`. A design page whose screen nav markup, its stylesheet rule or the screen-switch JS went missing after generation renders the nav items bleeding through the mocks and no screen switching at all. Enforced by `hooks/lib/concept-gate.js` (`ENGINE_DESIGN`) under the STALE ENGINE block. |

**Variant overview (conditional — a design round with ≥2
`section[data-design]`):** templates-design-views.md § Variant overview (≥2
designs). The engine half is asserted on every design page; the authoring
half only warns, so a page written before the overview still builds.

| # | Pattern | Purpose |
|---|---------|---------|
| V1 | `id="design-header"` (the mount) AND `function wireDesignOverview` AND `window.showOverview =` AND `window.designOverviewState =` | **Engine currency** — enforced by `hooks/lib/concept-gate.js` (`ENGINE_DESIGN`) under STALE ENGINE. Without them a ≥2-design round has no overview, and its payload silently lacks `favorite` / `userPins`. |
| V2 | every `section[data-design]` of a ≥2-design round carries `data-design-motto`, `data-design-traits` (exactly three, `\|`-separated) and `data-design-icon` (**warning**) | The card renders without the missing part (no motto, no traits, a generic icon). Enforced as a warning by `concept-gate.js` `findDesignAuthoringWarnings`; `concept-build.js` prints it with `⚠`. |
| V3 | `collectDesignDecisions` returns `favorite` and `userPins`; `collectAllFormFields` skips `[data-engine-store]` | The typed payload carries the favourite and the pins; the raw store JSON never lands in `allFields`. |
| V4 | `bakeFrozenFeedback` (concept-build.js) writes `favorite` (only for a `data-design-set="alternatives"` round) / `userPins` into `data-frozen-feedback` | A frozen round shows its favourite and pins read-only. |
| V5 | no hotkey of `wireDesignOverview()` fires while focus is in `textarea`, `input`, `select`, `[contenteditable]`, `#feedback-dock`, `.anno-bubble` or `.upin-editor` | ui-defaults R4b — never a bare key firing in a text field (`Space` and `←` / `→` on the overview included). Pinned by `design-overview.test.js`. |
| V6 | every `section[data-iteration]` with ≥2 designs carries `data-design-set="alternatives"` or `"topics"` (**warning**) | Only `alternatives` shows the favourite (☆/★, `F`, header ★, dimming); unmarked means no star. Enforced as a warning by `findDesignAuthoringWarnings` (`overview-set`). |
| V7 | `data-design-overlay`, when present, is one of `tl`, `tr`, `bl`, `br`, `tc`, `bc` (**warning**) | Anything else silently falls back to `bl`. `findDesignAuthoringWarnings` (`overview-overlay`). |

**Failure for P22–P31:** if `data-view` is present anywhere on the page but
any of these is missing (scoped to the view kind that requires it — P27 only
applies to `decision`-kind views, P28/P29 only to `comparison`-kind views),
treat it the same as a missing mandatory pattern for that iteration. P22 is
the hardest failure of the set: it means the page should not have used the
`design` template at all. P31 fails by presence, not absence: remove the
offending alternatives (usually the whole view) instead of relabelling them.

**Mappings (conditional — only when the page contains `data-mapping=`):**
the information-mapping construct (templates-mapping.md § Information Mapping
(engine); § Views (optional) → View kind `mapping` for a design round,
§ Mapping block (optional) for a free round) is optional; a page without
`[data-mapping]` skips this set entirely. Once any `section[data-mapping]`
exists, run this subset over the whole page (frozen rounds included):

| # | Pattern | Purpose |
|---|---------|---------|
| M1 | every `[data-mapping]` has ≥ 1 `script[data-mapping-spec]` inside the wrapper (before its `</section>`); the first is read; it must parse as a JSON object. Authoring MUST: exactly one, with `type="application/json"` | The renderer's only input — a missing or broken spec renders a red `.map-error` instead of the mapping; without the JSON `type` the browser would execute the block. |
| M2 | the `data-mapping` value matches `^[a-z0-9_]+$` and equals the section's `id`; **mapping ids unique page-wide**; every item / element / part / axis / column / context-value entry is an object whose `id` matches `^[a-z0-9_]+$`; item ids unique per mapping, element + axis ids unique per mapping (one namespace), part ids per element, column ids per axis, context values per context; item ids never match `^u\d+$` (reserved for ad-hoc items) | Name grammar — ids become DOM ids (`map-{m}-…` state inputs in `div.map-states`), matrix keys and TOC anchors; a collision silently merges two mappings' state. |
| M3 | every `proposal` / `proposalOrder` / `submitted` reference resolves to a known item, target (`{element}.{part}` / `{axis}.{column}`) and context value; `proposalOrder` / `submitted.order` keys name `ordered: true` targets; a `ctx` is present in `proposal` tuples and `@ctx` in `submitted` / order keys iff the spec has a `context` with values | Unresolvable references are dropped by the normaliser — the proposal (or the frozen submission) would show fewer cells than authored, with no error. |
| M4 | ≥ 1 of `elements` / `axes`; every element has ≥ 1 part; every axis has ≥ 1 column; ≥ 1 item; a `context` needs ≥ 1 value; `items` / `elements` / `parts` / `axes` / `columns` / `context.values` / `proposal`, when present, are arrays | An empty mapping renders nothing to assign; a non-array list is silently ignored by the engine. |
| M5 | free-round block: exactly one `textarea[data-comment="map-{m}-note"][data-attachable]` inside the section; design-round view (`[data-view-kind="mapping"]`): NO inline note textarea | The note channel per home — the dock's `view-{id}` textarea is the note in a design round, `collectMappings()` reads whichever applies; two channels would split the user's remark. |
| M6 | `renderMappings`, `refreshMappings`, `setCell`, `collectMappings` present; `renderMappings()` is the FIRST statement of the persistence block's `DOMContentLoaded` handler (before `ensureCommentSlots` / `restoreState`); `refreshMappings()` is the last call of `restoreState()` | Engine + load order — the `.map-state` inputs must exist before `restoreState()` writes into them, and the cells must be re-projected after it does. |
| M7 | `collectDesignDecisions` and `collectFreeDecisions` both contain `mappings: collectMappings(`; `collectDecisions` emits `mappings` in every branch (`[]` for decision) | Payload in both homes, uniform shape. |
| M8 | the `.map-scroll` rule carries `overflow: auto` and `max-width: 100%`; no `100vw` anywhere in the mapping CSS; a wide free-round block uses `data-map-wide` + `.concept-content:has([data-map-wide]) { max-width: 1600px }` | The page never widens — the matrix is its own two-axis scroll box. |
| M9 | inside every `section[data-iteration]:not([data-active])`, every `[data-mapping-spec]` carries `submitted`: `submitted.cells` carries every matrix key of that spec (`{element\|axis}[@ctx]`) and, for ordered parts, `submitted.order` every ordered target key (`{element}.{part}[@ctx]`) — enforced; `adhoc` and `slotNotes` are the authoring contract (manual) | A frozen round shows the user's submission, not the proposal — the renderer treats a `submitted` that lacks any matrix key as missing and shows the `map.frozen_missing` banner, and falls back to `proposalOrder` for a missing order key; the gate refuses the page. |
| M10 | every `data-view-for` value names a `section[data-design]` id inside the same iteration (**warning**) | The ☰ nav's nesting falls back to the flat views group silently otherwise. |

**Failure for M1–M10:** if `data-mapping` is present anywhere on the page but
any of these is missing (scoped to the home that requires it — M5's inline
note applies to free-round blocks, its absence to design-round views; M9 only
to frozen rounds), treat it the same as a missing mandatory pattern for
that iteration. M10 is a warning. `hooks/lib/concept-gate.js`
(`findMappingIssues`) enforces exactly this on every write of a concept
page: M1 (a spec inside the wrapper that parses as an object), M2 (mapping
id grammar + `id` equality + page-wide uniqueness, entry shape, id grammar,
uniqueness, reserved `u{n}`), M3 (references, ordered-target keys, context
presence), M4 (non-empty sets, `context` with values, array shapes) and M9
(`submitted.cells` every matrix key, `submitted.order` every ordered target
key on frozen rounds) — so a mis-typed id, a dangling `proposal` reference
or a forgotten `submitted` blocks the write deterministically. Not
mechanical: M1's `type="application/json"` / exactly-one, M9's `adhoc` /
`slotNotes`, and M5–M8, M10 — part of the manual sweep, like their P-set
siblings.

### Frozen/Active Mismatch

For every `section[data-iteration]`: if it carries `data-active`, its
`data-iteration-template` MUST equal `<html data-template>` at validation
time (simulate a tab switch to it, or check the generation-time initial
state if it is the only active one). A mismatch is a **hard-fail error** —
it means either `applyIterationTemplate()` was not wired into
`showIteration()`, or the initial `<html data-template>` written at
generation time does not match the active iteration, which produces a
flash-of-wrong-layout on load.

### Template: free

| # | Pattern | Purpose |
|---|---------|---------|
| F1 | `collectFreeDecisions` | Free branch of `collectDecisions` |

The free template has no mandatory body structure. Tri-state (`tri-state-group`,
`eval-` radio names) is opt-in — include it only where a section needs
user evaluation. The decision panel (the ☰ overlay — § Panel Chrome (all
templates)) is reused from the decision template with no changes.

## Failure handling

**If ANY forbidden pattern (Phase 0) is present, OR any shared pattern is
missing, OR any template-specific mandatory pattern is missing → DO NOT open
the page.** Fix the HTML first, then re-validate. This is a **blocking gate**
— no exceptions, no "this page doesn't need it". The `post.concept.gate` hook
enforces the same on write.

**Common failures this gate catches** (every other one is the Purpose column of its row):
- `data-oq-origin` missing on an open point → the row exists without an admissible reason: almost always approved scope that was not built, handed back to the user as a checkbox instead of reported as a shortfall

The patterns in `templates.md` (§ Claude Connection Heartbeat, § Submit
Handler, § State Persistence, § Template: design, § Template: free)
provide the reference implementations.
