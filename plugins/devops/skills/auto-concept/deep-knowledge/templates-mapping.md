# Concept templates, part 31 of 41: Shared systems — information mapping engine (spec, DOM contract, CSS)

## Information Mapping (engine)

Shared, template-independent engine for `section[data-mapping]` (§ View kind `mapping`,
§ Mapping block (optional)). Copied verbatim into every page like the annotation layer;
`renderMappings()` early-returns on pages without a mapping. The matrix's checkboxes are
the DOM truth; one CSS-hidden text input per matrix is the persisted form (§ State
Persistence picks it up as `text:i{N}:map-…`). With more than one matrix a tab strip
(`button.map-tab`) switches schematic and matrix together; the toolbar tools (⧉ copy
context, ↺ proposal, + item) and the slot notes (`textarea[data-comment="map-{m}-note-{target}"]`)
are generated too. Inside an iteration without `data-active` the section is frozen
(`data-map-frozen`): it renders from `spec.submitted` read-only — no tools, no chip ×,
view state in memory — and shows a `.map-error` banner when `submitted` is missing.
See the design spec `docs/superpowers/specs/2026-09-13-concept-information-mapping-design.md`.

### Spec

The `<script type="application/json" data-mapping-spec>` inside the section:

| Field | Shape | Meaning |
|---|---|---|
| `items[]` | `{id, label, group?, hint?, required?}` | the units to place; `group` (order of first appearance) is collapsible in both views; `required: true` flags an item that is assigned nowhere |
| `elements[]` | `{id, label, itemTargets?, parts[]}` | a schematic UI element (list card, detail page, form…) made of parts; `itemTargets`: `"one"` (an item goes to exactly one part here — checking another swaps along the row), `"min1"` (flag an item unassigned on this element) or `"any"` (default) |
| `parts[]` | `{id, label, tier?, row?, accepts?, min?, max?, ordered?}` | a slot inside an element. `tier`: `"first"` (at first glance, default) or `"after"` (after click) — an attribute of the target, not a dimension; `row`: parts sharing a row sit side by side inside their tier column, rows stack (numeric, parts without one come last); `accepts`: `"one"` (exactly one item, another swaps) or `"many"` (default); `min` / `max` soft, flagged; `ordered: true` keeps an order input |
| `axes[]` | `{id, label, itemTargets?, columns[]: {id, label, accepts?, min?, max?}}` | an abstract target axis for non-UI mappings (release trains, roles): named columns, no schematic |
| `context` | `{id, label, values[]: {id, label}}` | optional extra dimension (device, role…): every value yields a full copy of the target set → one matrix per value; the tab strip switches them |
| `proposal` | `[[item, target, ctx?], …]` | Claude's pre-filled assignment — **mandatory** (empty only when Claude honestly has none); `ctx` present iff the spec has `context` |
| `proposalOrder` | `{"target[@ctx]": [itemIds]}` | initial order for ordered parts |
| `slotNotes` | `true` | one per-target note textarea, revealed by ✎ |
| `adhocItems` | `true` | the user may add ≤ 20 label-only items ("+ item"), group "Added by you", ids `u1…` |
| `submitted` | `{cells: {"matrixKey": [[item, target]…]}, order, adhoc, slotNotes}` | the user's submission, written by Claude when the round is frozen (see Freezing) |

Target key = `{elementId}.{partId}` or `{axisId}.{columnId}`; matrix key =
`{elementId|axisId}` or `{elementId|axisId}@{ctx}`. `elements` and `axes` may coexist,
at least one is required; a spec without `elements` renders the matrix only and no view
toggle. Cardinality is **never blocked, always flagged** (amber / red counts, ⚠, the
summary line) — an item assigned nowhere is reported as `unassigned`, not an error,
unless it is `required` or its element / axis says `min1`. A spec that does not parse
or does not normalise (unknown id in `proposal`, bad id, duplicate item id, reserved id)
renders a red `div.map-error[role=alert]` with the error in place of the mapping and
contributes no `mappings[]` entry — never a silent blank.

### Rendered DOM contract

Everything below is generated; the authored markup is the wrapper section, the spec and
(free rounds) the note. `div.map-root` (or the spec-error box) is mounted **directly after
the spec script**, so an authored note that follows the spec stays below the mapping.

| Element | Identity | Count | Purpose |
|---|---|---|---|
| `input[type=checkbox]` | **no name / id**; `data-map-cell="{item}>{target}"`, `data-proposed="1|0"`; inside `td.map-cell-td[data-accepts=one]?` > `label` > input + `span.map-cell` | items × targets × contexts | DOM truth, keyboard + label semantics; `disabled` when frozen |
| `input[type=text].map-state` | `map-{m}-cells-{matrixKey}`, `map-{m}-order-{target}[@ctx]` (ordered parts), `map-{m}-adhoc` (with `adhocItems`), `map-{m}-ui`; all in one `div.map-states` directly under the section, `tabindex="-1"`, `aria-hidden` | 1 per matrix + ordered parts + adhoc + ui | persisted form (§ State), `allFields`; `readonly` when frozen |
| `div.map-root` > `div.map-toolbar`, `div.map-summary[aria-live]`, `div.map-schema[data-map-ctx]` ×n, `div.map-matrices`, `div.map-slot-notes`? | | 1 | section layout; `.map-root [hidden]` wins over every display rule |
| `button.map-view-btn[data-map-mode][aria-pressed]` × 2 in `.map-view-toggle[role=group]` | | with `elements` only | Schema \| Matrix |
| `button.map-tab[data-map-tab="{matrixKey}"][aria-pressed]` in `div.map-tabs`, with `span.map-tabs-label` (Context / Axis) and `span.map-tab-count` | | > 1 matrix | active matrix / context; the count reads `{n} open` per matrix |
| `button.map-row-filter[data-filter="all\|unassigned\|changed"][aria-pressed]` × 3 in `div.map-row-filters[role=group]`, each with `span.map-filter-count` | | 1 per mapping, `hidden` unless the matrix is on screen | matrix row filter (spec § 7 "Rows"): hides `tr.map-item-row`s that fail the pill and every `tr.map-group-row` with no passing member — in EVERY matrix, not just the visible tab; same predicate and counts as the palette pills (`unassigned` = nowhere across all matrices, `changed` = any diff vs `data-proposed`); in memory (`model.rowFilter`), never persisted; a frozen section keeps it |
| `div.map-tools` > `button.map-copy[data-from][data-to]` per ordered context pair, `button.map-reset`, `button.map-add-item` (with `adhocItems`), `div.map-status.map-tools-status[role=status]` | | live sections only | ⧉ copy context, ↺ proposal, + item, duplicate hint |
| `div.map-element[data-map-element]` > caption > `div.map-tiers` > `div.map-tier[data-tier]` > `div.map-row[data-row]` > `div.map-slot[data-map-target][data-accepts]` > `button.map-slot-label` (+ `.map-slot-count`), `.map-slot-chips` > `button.map-chip[data-item]`, `button.map-slot-note-btn` | | per element / context | schematic view, arm-then-tap |
| `div.map-palette` > `input[type=search].map-search` (unnamed), `button.map-filter[data-filter][aria-pressed]` × 4, `button.map-palette-collapse[aria-expanded]`, `div.map-groups` > `div.map-group[data-group]` > `button.map-group-toggle[aria-expanded]` + `button.map-item-chip[data-item][aria-pressed]` | | per schematic | palette, search, filters |
| `div.map-matrix[data-map-matrix="{matrixKey}"]` > `div.map-scroll` > `table.map-table[role=grid]` — `thead` rows `tr.map-head-src` (element / axis label, colspan = its columns), `tr.map-head-tier` (`th[data-tier]`, only when both tiers occur), `tr.map-head-targets` (`th[data-map-target][data-col-tier]` + `.map-col-count`), `tr.map-group-row` (with `button.map-group-toggle`), `tr.map-item-row` (`th[scope=row].map-item-label`, cells, `td.map-sum`); `data-dense="true"` above 18 columns, `data-head-rows="2|3"` (header row count — the sticky offsets and the scroll padding follow it) | | per matrix, `hidden` when inactive | matrix view; inputs exist regardless of what is on screen |
| `textarea[data-comment="map-{m}-note"][data-attachable]` | **authored**, free rounds only | 1 | mapping note (design rounds: the dock's `view-{id}`) |
| `textarea[data-comment="map-{m}-note-{target}"]` in `label.map-slot-note` (hidden until ✎) | generated when `slotNotes` | per target (not per context) | per-slot note; `readonly` when frozen |
| `div.map-error[role=alert]` | | on failure | spec error (in place of the mapping) or frozen-without-`submitted` banner (prepended above it) |

Controls are `<button>`s, never radios: freezing is Claude's hand-edit of the HTML plus
`section[data-iteration]:not([data-active]) input { pointer-events: none }` — buttons are
untouched by that rule (like `.view-switch-item`), so a frozen mapping keeps its view
toggle, tabs, group collapse and filters; the palette search is the one input the engine
CSS re-enables there (it filters what is on screen, it writes nothing). The view toggle
carries `aria-disabled="true"` (and ignores clicks) while the active tab is an axis — an
axis has no schematic. The ✎ buttons carry `has-note` while their target's note has text.
The renderer **measures nothing** (it runs while its view is `hidden`): `data-dense` and
`data-head-rows` are derived from the column count and the tier layout.

### State and load order

The checkboxes are unnamed, so `saveState()` and `collectAllFormFields()` ignore them;
the persisted form is one compact string per matrix in the `.map-state` text inputs:
cells = space-separated `item>target` pairs (a deliberately empty matrix is the sentinel
`-`, never `""`), order = comma-separated item ids, adhoc = a JSON array of labels, ui =
`mode=schema;tab=card@phone`. They ride the existing `text:` path unchanged
(`text:i{N}:{id}`, iteration-namespaced), so the draft mirror, `_carryOverTypedWork()`
and `allFields` all cover them.

Script order across the page's IIFEs is not guaranteed, so `renderMappings()` is the
**first statement of § State Persistence's `DOMContentLoaded` handler** (before
`ensureCommentSlots()` and `restoreState()`, `typeof`-guarded): it creates the state
inputs (from `submitted` on a frozen section, else from `proposal`), renders the
checkboxes from them and projects the schematic. `restoreState()` may then overwrite a
live state input's value — and it **runs three times** (load, every `iteration:changed`,
after `hydrateDraftFromBridge()`), setting values without events — so it ends with
`refreshMappings()` (precedent: `updateNoteMarkers()`), which re-reads every state
input, normalises it, re-sets the checkboxes, re-projects and re-mirrors the TOC. A
restore never touches an input the user changed in this page life (`data-touched`) and
never applies another round's keys (the `i{N}:` namespace), so a frozen round's baked
`submitted` cannot be overwritten by a stale local key. Unknown item / target ids in a
state string are dropped. `setCell()` is the only cell write path (schematic, matrix,
keyboard, reset, copy): it applies the `accepts: "one"` / `itemTargets: "one"` swaps,
rewrites the affected state inputs, stamps `data-touched`, sets `_userInteracted`,
dispatches bubbling `input` + `change` events and re-projects. Search, filters,
collapsed groups and the armed item / slot are in-memory only.

### Freezing

At Step 5c, when the next round is appended, Claude writes the payload's `mappings[]`
entry into the frozen round's spec as `"submitted": {cells, order, adhoc, slotNotes}` —
`cells` is the entry's `assigned` verbatim (keyed by matrix key), `order` its `order`,
`adhoc` its `adhocItems`, `slotNotes` its `slotNotes`. On a section inside an iteration
without `data-active` the renderer sets `data-map-frozen="true"` and initialises from
`submitted`, keeps `data-proposed` from `proposal` so the ◆ markers stay visible, renders
every checkbox `disabled`, the state inputs and slot-note textareas `readonly`, omits the
tools and the chip ×, and keeps toggle, tabs, collapse, search and filters browsable
(their state lives in memory on a frozen section; the `readonly` ui input is never
written). A `submitted` that is missing **or incomplete** (no `cells`, or a matrix key
missing) is treated as missing: the proposal is shown behind a prepended
`div.map-error[role=alert]` (`map.frozen_missing`) and gate rule M9
(validation-gate.md § Mappings) fails the page — silently presenting the proposal as the user's decision is the one outcome this
construct must never produce. Frozen sections contribute no `mappings[]` entry.

### Authoring rule

Claude writes **only** the wrapper `section[data-mapping][id][data-nav-label]`, the JSON
spec and — in free rounds — the note textarea; never a cell, a state input or a control.
Ids match `^[a-z0-9_]+$`; mapping ids are unique page-wide; item ids matching `u\d+` are
reserved for ad-hoc items and rejected by the engine. Labels are content, not UI strings
— no `{{…}}` locale tokens inside a spec — and must not contain `</script>` (the HTML
parser would end the JSON block early; the parse then fails visibly). Keep ≤ 60 items, ≤ 20
targets per matrix, ≤ 4 context values per mapping; split beyond that.

### Wiring

Wiring into the shared systems (all of it lives in those systems, not here):
`renderMappings()` is the **first** statement of § State Persistence's `DOMContentLoaded`
handler (the state inputs must exist before `restoreState()` writes into them — script order
across IIFEs is not guaranteed) and `restoreState()` ends with `refreshMappings()`, which
re-projects the boxes from the restored values and re-mirrors the TOC.
`collectDesignDecisions()` / `collectFreeDecisions()` emit `mappings: collectMappings(active)`
(§ 9 shape; `collectDecisionDecisions()` emits `[]`, so the key is always present); a view with
`data-view-for` tags its `decisions[]` and `mappings[]` entries with `design`. In the panel
TOC (`buildSectionNav()`) a `section[data-mapping]` entry carries `data-mapping-nav` and a
`.section-nav-state.state-mapping` reading `assigned/total · violations ⚠` from
`mappingProgress()`, refreshed after every cell write and restore. In the design template's ☰
nav (`buildDesignUI()`) a view with `data-view-for` is listed under that design after its
screens; the views group holds only the views that name no design of the round.

### CSS

```css
/* Information mapping — persisted form (hidden text inputs) */
.map-state { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }

/* layout: toolbar, summary, one schematic per context, one matrix per key */
.map-root { display: flex; flex-direction: column; gap: 0.75rem; }
.map-root [hidden] { display: none !important; }   /* the flex/grid rules below must not beat the hidden attribute */
.map-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
.map-toolbar:empty { display: none; }
.map-view-toggle { display: inline-flex; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
.map-view-btn { border: 0; border-right: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); padding: 0.4rem 0.9rem; font: inherit; cursor: pointer; }
.map-view-btn:last-child { border-right: 0; }
.map-view-btn[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-color) 18%, transparent); color: var(--text-color); font-weight: 600; }
.map-view-btn[aria-disabled="true"] { opacity: 0.5; cursor: default; }   /* an axis tab has no schematic: the toggle is inert there */
.map-tabs { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; }
.map-tabs-label { font-size: 0.8rem; color: var(--text-secondary); margin-right: 0.25rem; }
.map-tab { border: 1px solid var(--border-color); border-radius: 999px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 0.85rem; padding: 0.2rem 0.7rem; cursor: pointer; }
.map-tab[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-color) 18%, transparent); color: var(--text-color); border-color: var(--accent-color); font-weight: 600; }
.map-tab-count { font-size: 0.75rem; color: var(--warning-color); }
.map-tab-count:empty { display: none; }
.map-tools { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-left: auto; }
.map-copy, .map-reset, .map-add-item { border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 0.85rem; padding: 0.25rem 0.6rem; cursor: pointer; }
.map-copy:hover, .map-reset:hover, .map-add-item:hover { color: var(--text-color); border-color: var(--accent-color); }
.map-add-item:disabled { opacity: 0.5; cursor: default; }
.map-tools-status:empty { display: none; }
.map-summary { font-size: 0.9rem; color: var(--text-secondary); }
.map-summary[data-ok="false"] { color: var(--warning-color); }
.map-error { border: 1px solid var(--danger-color, #f85149); color: var(--danger-color, #f85149); padding: 0.75rem; border-radius: 6px; }
.view-mapping { max-width: none; padding: 1rem 1.5rem; }
.concept-content:has([data-map-wide]) { max-width: 1600px; }

/* schematic: element → tiers side by side → rows → slots */
.map-schema { display: flex; flex-direction: column; gap: 1rem; }
.map-element { border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem; }
.map-element-caption { font-weight: 600; margin-bottom: 0.5rem; }
.map-tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.map-tiers:has(> .map-tier:only-child) { grid-template-columns: 1fr; }
@media (max-width: 700px) { .map-tiers { grid-template-columns: 1fr; } }
.map-tier { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.5rem; border-radius: 6px; background: color-mix(in srgb, var(--text-secondary) 6%, transparent); }
.map-tier[data-tier="first"] { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.map-tier-label { font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
.map-row { display: flex; gap: 0.5rem; }
.map-slot { flex: 1; min-width: 0; border: 1px dashed var(--border-color); border-radius: 6px; padding: 0.4rem; background: var(--panel-bg); }
.map-slot.is-armed { border-style: solid; border-color: var(--accent-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 25%, transparent); }
.map-slot.is-under { border-color: var(--warning-color); }
.map-slot.is-over { border-color: var(--danger-color, #f85149); }
.map-slot.is-swapped { animation: map-swap 0.7s ease-out; }
@keyframes map-swap { from { background: color-mix(in srgb, var(--warning-color) 35%, transparent); } to { background: var(--panel-bg); } }
.map-schema[data-armed="item"] .map-slot { cursor: copy; }
.map-slot-label { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; width: 100%; border: 0; background: transparent; color: var(--text-color); font: inherit; font-weight: 600; text-align: left; padding: 0 0 0.3rem; cursor: pointer; }
.map-slot-count { font-weight: 400; font-size: 0.8rem; color: var(--text-secondary); }
.map-slot.is-under .map-slot-count { color: var(--warning-color); }
.map-slot.is-under .map-slot-count::after { content: " ⚠"; }
.map-slot.is-over .map-slot-count { color: var(--danger-color, #f85149); }
.map-slot-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; min-height: 1.6rem; }
.map-slot-note-btn { border: 0; background: transparent; color: var(--text-secondary); font: inherit; padding: 0 0.2rem; cursor: pointer; }
.map-slot-note-btn:hover, .map-slot-note-btn.has-note { color: var(--accent-color); }   /* has-note: the target's note carries text */
.map-table th .map-slot-note-btn { font-weight: 400; }

/* slot notes: one textarea per target, revealed by ✎ */
.map-slot-notes { display: flex; flex-direction: column; gap: 0.5rem; }
.map-slot-notes:empty { display: none; }
.map-slot-note { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--text-secondary); }
.map-slot-note:has(> textarea[hidden]) { display: none; }
.map-slot-note textarea { width: 100%; box-sizing: border-box; padding: 0.4rem 0.5rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--input-bg, transparent); color: var(--text-color); font: inherit; resize: vertical; }

/* chips — in slots and in the palette */
.map-chip, .map-item-chip { display: inline-flex; align-items: center; gap: 0.3rem; border: 1px solid var(--border-color); border-radius: 999px; background: var(--input-bg, transparent); color: var(--text-color); font: inherit; font-size: 0.85rem; line-height: 1.2; padding: 0.15rem 0.55rem; cursor: pointer; }
.map-chip.is-proposed::before { content: "·"; color: var(--text-secondary); }
.map-chip.is-changed, .map-item-chip.is-changed { text-decoration: underline var(--accent-color); text-underline-offset: 3px; }
.map-chip.is-changed::before, .map-item-chip.is-changed .map-item-label::after { content: "◆"; color: var(--accent-color); font-size: 0.7em; }
.map-item-chip.is-changed .map-item-label::after { margin-left: 0.25rem; }
.map-chip.is-removed { opacity: 0.5; text-decoration: line-through; cursor: default; }
.map-chip-remove { color: var(--text-secondary); padding-left: 0.15rem; }
.map-chip:hover .map-chip-remove, .map-chip:focus-visible .map-chip-remove { color: var(--danger-color, #f85149); }
.map-item-chip[aria-pressed="true"] { outline: 2px solid var(--accent-color); outline-offset: 1px; }
.map-item-count { font-size: 0.75rem; color: var(--text-secondary); }
.map-item-chip.is-unassigned .map-item-count { color: var(--warning-color); }

/* palette: sticky tray at the bottom of the mapping's scroll box */
.map-palette { position: sticky; bottom: 0; background: var(--panel-bg); border-top: 1px solid var(--border-color); padding: 0.5rem 0; display: flex; flex-direction: column; gap: 0.4rem; z-index: 1; }
.map-palette-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.map-palette-title { font-weight: 600; }
.map-search { flex: 1; min-width: 8rem; padding: 0.3rem 0.5rem; border: 1px solid var(--border-color); border-radius: 6px; background: var(--input-bg, transparent); color: var(--text-color); font: inherit; }
/* § Iteration Tabs CSS kills pointer events on every input of a frozen tab; the palette
   search only filters what is on screen, so it stays live there (specificity 0,4,1 beats
   that rule's 0,2,2 wherever the two blocks land in the page). */
section[data-iteration]:not([data-active]) .map-root .map-search { pointer-events: auto; filter: none; }
.map-filters, .map-row-filters { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; }
.map-filter, .map-row-filter { border: 1px solid var(--border-color); border-radius: 999px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 0.8rem; padding: 0.15rem 0.6rem; cursor: pointer; }
.map-filter[aria-pressed="true"], .map-row-filter[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-color) 18%, transparent); color: var(--text-color); border-color: var(--accent-color); }
.map-filter-count { opacity: 0.8; }
.map-palette-collapse { margin-left: auto; border: 0; background: transparent; color: var(--text-secondary); font: inherit; padding: 0 0.3rem; cursor: pointer; }
.map-groups { display: flex; flex-direction: column; gap: 0.4rem; }
.map-group { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.3rem; }
.map-group-toggle { border: 0; background: transparent; color: var(--text-secondary); font: inherit; font-size: 0.85rem; padding: 0.1rem 0.3rem; cursor: pointer; white-space: nowrap; }
.map-group-count { opacity: 0.8; }
.map-group-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.map-status { min-height: 1.2rem; font-size: 0.85rem; color: var(--accent-color); }

/* matrix: one scroll box per table so sticky headers and the sticky first column work together.
   Every header row is exactly 2rem tall (row height fixed, no vertical padding, the 1px
   border inside it) and each row sticks at index × 2rem — by ROW INDEX, not by class: a
   matrix without a tier row has two rows, and a class-bound `top: 4rem` on the targets
   row left it floating one row below the source row, over the first body row
   (browser-verified). The renderer stamps `data-head-rows="2|3"` on the table so the
   scroll padding matches the header height exactly in both cases. */
.map-scroll { --map-head-rows: 2; overflow: auto; width: max-content; max-width: 100%; max-height: calc(100vh - var(--map-chrome, 220px)); scroll-padding: calc(var(--map-head-rows) * 2rem) 0 0 230px; border: 1px solid var(--border-color); border-radius: 6px; }
.map-scroll:has(> .map-table[data-head-rows="3"]) { --map-head-rows: 3; }
html:not([data-template="design"]) .map-scroll { max-height: 80vh; }
.map-table { border-collapse: separate; border-spacing: 0; width: max-content; font-size: 0.85rem; }
.map-table th, .map-table td { border-bottom: 1px solid var(--border-color); border-right: 1px solid var(--border-color); padding: 0.2rem 0.4rem; white-space: nowrap; }
.map-table thead tr { height: 2rem; }
.map-table thead th { position: sticky; top: 0; z-index: 2; background: var(--panel-bg); text-align: center; font-weight: 600; padding: 0 0.5rem; }
.map-table thead tr:nth-child(2) th { top: 2rem; }
.map-table thead tr:nth-child(3) th { top: 4rem; }
.map-table tr.map-head-tier th { font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
.map-table tr.map-head-tier th[data-tier="first"] { background: color-mix(in srgb, var(--accent-color) 12%, var(--panel-bg)); }
.map-table tr.map-head-targets th { font-weight: 500; }
.map-table tr.map-head-targets th[data-col-tier="first"] { background: color-mix(in srgb, var(--accent-color) 6%, var(--panel-bg)); }
.map-table th.map-item-label, .map-table th.map-corner { position: sticky; left: 0; z-index: 3; background: var(--panel-bg); min-width: 220px; text-align: left; font-weight: 400; }
.map-table thead th.map-corner { z-index: 4; }
.map-table tr.map-group-row td { background: color-mix(in srgb, var(--text-secondary) 8%, var(--panel-bg)); position: sticky; left: 0; z-index: 1; text-align: left; }
.map-table tr.map-item-row { height: 28px; }
.map-table td.map-sum { text-align: center; color: var(--text-secondary); }
.map-cell-td { padding: 0; text-align: center; position: relative; }
.map-cell-td label { display: block; width: 28px; height: 28px; margin: auto; cursor: pointer; }
.map-cell-td input { position: absolute; opacity: 0; width: 28px; height: 28px; margin: 0; cursor: pointer; }
.map-cell { display: block; width: 18px; height: 18px; margin: 5px; border: 1px solid var(--border-color); border-radius: 4px; box-sizing: border-box; }
.map-cell-td input:checked + .map-cell { background: var(--accent-color); border-color: var(--accent-color); }
.map-cell-td input:focus-visible + .map-cell { outline: 2px solid var(--accent-color); outline-offset: 1px; }
.map-cell-td[data-accepts="one"] .map-cell { border-radius: 50%; }
.map-cell-td input:disabled, .map-cell-td input:disabled + .map-cell, .map-cell-td:has(input:disabled) label { cursor: default; }
.map-cell-td.is-changed .map-cell { box-shadow: inset 0 0 0 2px var(--panel-bg), inset 0 0 0 4px var(--accent-color); }
.map-cell-td.is-changed input:not(:checked) + .map-cell { border-style: dashed; border-color: var(--accent-color); }
.map-table[data-dense="true"] tr.map-head-targets th { writing-mode: vertical-rl; transform: rotate(180deg); padding: 0.4rem 0.2rem; }
.map-col-count { color: var(--text-secondary); font-weight: 400; }
.map-col-count.is-under, .map-table td.map-sum.is-under { color: var(--warning-color); }   /* td.map-sum: must outrank the base Σ rule above */
.map-col-count.is-over { color: var(--danger-color, #f85149); }
.map-table th.is-under .map-col-count { color: var(--warning-color); }
.map-table th.is-over .map-col-count { color: var(--danger-color, #f85149); }
```

