# Concept templates, part 13 of 16: Shared systems — information mapping engine

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

### JS

```javascript
// --- Information mapping engine (§ Information Mapping) --------------------
(function () {
  const MAP_LOCALE = {
    view_schema: '{{map.view_schema}}', view_matrix: '{{map.view_matrix}}',
    tier_first: '{{map.tier_first}}', tier_after: '{{map.tier_after}}',
    items: '{{map.items}}', search: '{{map.search}}',
    filter_all: '{{map.filter_all}}', filter_unassigned: '{{map.filter_unassigned}}',
    filter_multiple: '{{map.filter_multiple}}', filter_changed: '{{map.filter_changed}}',
    reset: '{{map.reset}}', reset_confirm: '{{map.reset_confirm}}',
    copy: '{{map.copy}}', copy_confirm: '{{map.copy_confirm}}',
    add_item: '{{map.add_item}}', add_item_prompt: '{{map.add_item_prompt}}',
    add_item_duplicate: '{{map.add_item_duplicate}}', added_group: '{{map.added_group}}',
    armed_item: '{{map.armed_item}}', armed_slot: '{{map.armed_slot}}',
    summary_unassigned: '{{map.summary_unassigned}}', summary_violations: '{{map.summary_violations}}',
    summary_ok: '{{map.summary_ok}}', slot_empty_min: '{{map.slot_empty_min}}',
    slot_over_max: '{{map.slot_over_max}}', item_required: '{{map.item_required}}',
    remove: '{{map.remove}}', slot_note: '{{map.slot_note}}', context: '{{map.context}}',
    axis: '{{map.axis}}', tab_open: '{{map.tab_open}}',
    frozen_missing: '{{map.frozen_missing}}', spec_error: '{{map.spec_error}}'
  };
  const fmt = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars) ? vars[k] : '{' + k + '}');
  const ID_RE = /^[a-z0-9_]+$/;
  const MODELS = new WeakMap();      // section → model

  // --- spec → model ----------------------------------------------------------
  function normalizeSpec(raw) {
    const err = msg => { throw new Error(msg); };
    const items = (raw.items || []).map(it => ({ id: it.id, label: it.label || it.id, group: it.group || '', hint: it.hint || '', required: !!it.required, adhoc: false }));
    const sources = [];
    (raw.elements || []).forEach(el => sources.push({ kind: 'element', id: el.id, label: el.label || el.id, itemTargets: el.itemTargets || 'any',
      targets: (el.parts || []).map(p => ({ key: el.id + '.' + p.id, id: p.id, label: p.label || p.id, tier: p.tier === 'after' ? 'after' : 'first',
        row: Number.isFinite(p.row) ? p.row : null, accepts: p.accepts === 'one' ? 'one' : 'many', min: p.min || 0, max: p.max || 0, ordered: !!p.ordered })) }));
    (raw.axes || []).forEach(ax => sources.push({ kind: 'axis', id: ax.id, label: ax.label || ax.id, itemTargets: ax.itemTargets || 'any',
      targets: (ax.columns || []).map(c => ({ key: ax.id + '.' + c.id, id: c.id, label: c.label || c.id, tier: 'first', row: null,
        accepts: c.accepts === 'one' ? 'one' : 'many', min: c.min || 0, max: c.max || 0, ordered: false })) }));
    if (!sources.length) err('no elements/axes');
    sources.forEach(s => { if (!s.targets.length) err('source without targets: ' + s.id); });
    const contexts = raw.context && Array.isArray(raw.context.values) && raw.context.values.length
      ? raw.context.values.map(v => ({ id: v.id, label: v.label || v.id })) : null;
    const all = [...items.map(i => i.id), ...sources.map(s => s.id), ...sources.flatMap(s => s.targets.map(t => t.id)), ...(contexts || []).map(c => c.id)];
    all.forEach(id => { if (typeof id !== 'string' || !ID_RE.test(id)) err('bad id: ' + id); });
    const seen = new Set(); items.forEach(i => { if (seen.has(i.id)) err('duplicate item id: ' + i.id); seen.add(i.id); });
    items.forEach(i => { if (/^u\d+$/.test(i.id)) err('reserved id: ' + i.id); });                 // `u{n}` belongs to ad-hoc items
    const matrices = [];
    sources.forEach(s => (contexts || [null]).forEach(c => matrices.push({ key: s.id + (c ? '@' + c.id : ''), src: s, ctx: c ? c.id : null, targets: s.targets })));
    const targetKeys = new Set(sources.flatMap(s => s.targets.map(t => t.key)));
    const itemIds = new Set(items.map(i => i.id));
    (raw.proposal || []).forEach(p => { if (!itemIds.has(p[0]) || !targetKeys.has(p[1])) err('proposal references unknown id: ' + p.join(',')); });
    const groups = [...new Set(items.map(i => i.group))];
    return { items, groups, sources, contexts, matrices, targetKeys, proposal: raw.proposal || [], proposalOrder: raw.proposalOrder || {},
             submitted: raw.submitted || null, slotNotes: !!raw.slotNotes, adhocItems: !!raw.adhocItems, hasElements: sources.some(s => s.kind === 'element') };
  }

  // --- state encoding (§ State model) ----------------------------------------
  const encodeCells = pairs => pairs.length ? pairs.map(p => p[0] + '>' + p[1]).join(' ') : '-';
  const decodeCells = str => String(str || '').trim() === '-' ? [] : String(str || '').split(/\s+/).filter(Boolean).map(t => t.split('>')).filter(p => p.length === 2);
  function matrixOf(model, targetKey, ctx) { return model.matrices.find(m => m.ctx === (ctx || null) && m.targets.some(t => t.key === targetKey)); }
  function sectionOf(sectionOrId) {
    return typeof sectionOrId === 'string' ? document.querySelector('[data-mapping="' + sectionOrId + '"]') : sectionOrId;
  }
  function stateInput(section, m, kind, suffix) {
    const id = 'map-' + m + '-' + kind + (suffix ? '-' + suffix : '');
    let input = [...section.querySelectorAll('input.map-state')].find(i => i.id === id);
    if (input) return input;
    let holder = section.querySelector(':scope > div.map-states');
    if (!holder) { holder = document.createElement('div'); holder.className = 'map-states'; section.appendChild(holder); }
    input = document.createElement('input');
    input.type = 'text';
    input.className = 'map-state';
    input.id = id;
    input.tabIndex = -1;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-hidden', 'true');
    holder.appendChild(input);
    return input;
  }
  // Pairs of a matrix as the checkboxes should show them: decoded from the
  // state input, unknown item / target ids dropped (a re-served round with a
  // changed target set must not crash or resurrect cells).
  function readCells(model, matrix, state) {
    const keys = new Set(matrix.targets.map(t => t.key));
    const ids = new Set(model.items.map(i => i.id));
    const out = []; const seen = new Set();
    decodeCells(state.value).forEach(p => {
      const k = p[0] + '>' + p[1];
      if (ids.has(p[0]) && keys.has(p[1]) && !seen.has(k)) { seen.add(k); out.push(p); }
    });
    return out;
  }
  function proposalPairs(model, matrix) {
    const keys = new Set(matrix.targets.map(t => t.key));
    return model.proposal.filter(p => (p[2] || null) === matrix.ctx && keys.has(p[1])).map(p => [p[0], p[1]]);
  }
  const orderKey = (matrix, target) => target.key + (matrix.ctx ? '@' + matrix.ctx : '');
  const splitOrder = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  // Order input = the checked items of that target in their existing order,
  // newcomers appended. `silent` skips the events (initial render, restore).
  function syncOrder(section, model, matrix, target, pairs, silent) {
    const input = stateInput(section, model.id, 'order', orderKey(matrix, target));
    const checked = pairs.filter(p => p[1] === target.key).map(p => p[0]);
    const kept = splitOrder(input.value).filter(id => checked.includes(id));
    const next = kept.concat(checked.filter(id => !kept.includes(id))).join(',');
    if (next === input.value) return;
    if (silent) input.value = next; else writeState(input, next);
  }

  // --- the single write path -------------------------------------------------
  function setCell(sectionOrId, itemId, targetKey, ctx, on) {
    const section = sectionOf(sectionOrId);
    const model = section && MODELS.get(section); if (!model) return false;
    if (!writeCell(section, model, itemId, targetKey, ctx, on)) return false;
    refreshAll(section, model);
    return true;
  }
  // The write without the refresh (bulk callers refresh once); returns the
  // matrix that changed, or null when nothing was written.
  function writeCell(section, model, itemId, targetKey, ctx, on) {
    if (isFrozen(section)) return null;
    const matrix = matrixOf(model, targetKey, ctx); if (!matrix) return null;
    const target = matrix.targets.find(t => t.key === targetKey);
    const state = stateInput(section, model.id, 'cells', matrix.key);
    let pairs = decodeCells(state.value);
    const has = pairs.some(p => p[0] === itemId && p[1] === targetKey);
    if (on === has) return null;
    if (on) {
      if (target.accepts === 'one') pairs = pairs.filter(p => p[1] !== targetKey);                       // slot swap
      if (matrix.src.itemTargets === 'one') pairs = pairs.filter(p => p[0] !== itemId);                  // row swap
      pairs.push([itemId, targetKey]);
    } else pairs = pairs.filter(p => !(p[0] === itemId && p[1] === targetKey));
    writeState(state, encodeCells(pairs));
    if (target.ordered) syncOrder(section, model, matrix, target, pairs);
    return matrix;
  }
  // After any write: EVERY matrix is re-projected, not just the one written —
  // the Σ flag of a `required` item reads assignedAnywhere(), so unchecking
  // its last cell in one context must flag its row in the others at once.
  // ≤ 4 matrices × ≤ 60 items × ≤ 20 targets (§ Authoring rule): cheap.
  function refreshAll(section, model) {
    model.matrices.forEach(mx => projectMatrix(section, model, mx));                                   // checkboxes + counts + markers
    refreshSchema(section, model);                                                                      // slot chips + palette badges
    updateSummary(section, model);
    if (typeof updateSectionNavState === 'function') updateSectionNavState();
  }
  function writeState(input, value) {
    input.value = value;
    input.dataset.touched = 'true';
    if (typeof _userInteracted !== 'undefined') _userInteracted = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --- validation (never blocks, always flags) --------------------------------
  function assignedAnywhere(section, model) {
    const set = new Set();
    model.matrices.forEach(mx => readCells(model, mx, stateInput(section, model.id, 'cells', mx.key)).forEach(p => set.add(p[0])));
    return set;
  }
  // The violations of ONE matrix (the tab counts); `required` is mapping-wide
  // and lives in violationsOf only.
  function matrixViolations(section, model, mx) {
    const out = [];
    const withCtx = v => { if (mx.ctx) v.ctx = mx.ctx; return v; };
    const pairs = readCells(model, mx, stateInput(section, model.id, 'cells', mx.key));
    mx.targets.forEach(t => {
      const have = pairs.filter(p => p[1] === t.key).length;
      if (t.accepts === 'one' && have > 1) out.push(withCtx({ target: t.key, kind: 'one', have, want: 1 }));
      if (t.min && have < t.min) out.push(withCtx({ target: t.key, kind: 'min', have, want: t.min }));
      if (t.max && have > t.max) out.push(withCtx({ target: t.key, kind: 'max', have, want: t.max }));
    });
    if (mx.src.itemTargets === 'min1') {
      model.items.forEach(it => {
        if (!pairs.some(p => p[0] === it.id)) out.push(withCtx({ item: it.id, kind: 'min1', source: mx.src.id }));
      });
    }
    return out;
  }
  function violationsOf(section, model) {
    const out = model.matrices.flatMap(mx => matrixViolations(section, model, mx));
    const anywhere = assignedAnywhere(section, model);
    model.items.forEach(it => { if (it.required && !anywhere.has(it.id)) out.push({ item: it.id, kind: 'required' }); });
    return out;
  }
  function mappingProgress(sectionOrId) {
    const section = sectionOf(sectionOrId);
    const model = section && MODELS.get(section);
    if (!model) return { assigned: 0, total: 0, violations: 0 };
    return { assigned: assignedAnywhere(section, model).size, total: model.items.length, violations: violationsOf(section, model).length };
  }

  // --- matrix view (§ Matrix view) -------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  // Column order: spec order within a tier, first tier before after tier, so
  // the tier band spans contiguous columns.
  const orderedTargets = matrix => matrix.targets.filter(t => t.tier === 'first').concat(matrix.targets.filter(t => t.tier === 'after'));
  function contextLabel(model, ctx) {
    const c = ctx && (model.contexts || []).find(x => x.id === ctx);
    return c ? c.label : '';
  }
  const ADHOC_GROUP = '__adhoc';
  const groupLabel = group => group === ADHOC_GROUP ? MAP_LOCALE.added_group : group;
  const isFrozen = section => section.dataset.mapFrozen === 'true';
  // Shared by the matrix's group rows and the palette's groups.
  function groupToggle(group, count) {
    const btn = el('button', 'map-group-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'true');
    btn.appendChild(el('span', 'map-group-glyph', '▾'));
    btn.appendChild(document.createTextNode(' ' + groupLabel(group) + ' '));
    btn.appendChild(el('span', 'map-group-count', String(count)));
    return btn;
  }
  function slotNoteButton() {
    const note = el('button', 'map-slot-note-btn', '✎');
    note.type = 'button';
    note.dataset.tip = MAP_LOCALE.slot_note;
    note.setAttribute('aria-label', MAP_LOCALE.slot_note);
    return note;
  }
  function renderMatrix(section, model, matrix) {
    const targets = orderedTargets(matrix);
    const nFirst = targets.filter(t => t.tier === 'first').length;
    const nAfter = targets.length - nFirst;
    const bothTiers = nFirst > 0 && nAfter > 0;
    const headRows = bothTiers ? 3 : 2;

    const wrap = el('div', 'map-matrix');
    wrap.dataset.mapMatrix = matrix.key;
    const scroll = el('div', 'map-scroll');
    const table = el('table', 'map-table');
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', matrix.src.label + (matrix.ctx ? ' · ' + contextLabel(model, matrix.ctx) : ''));
    if (targets.length > 18) table.dataset.dense = 'true';
    table.dataset.headRows = String(headRows);                                                      // sticky offsets + scroll padding (CSS)

    const thead = el('thead');
    const srcRow = el('tr', 'map-head-src');
    const corner = el('th', 'map-corner'); corner.rowSpan = headRows; srcRow.appendChild(corner);
    const srcTh = el('th', 'map-src', matrix.src.label); srcTh.colSpan = targets.length; srcRow.appendChild(srcTh);
    const sumHead = el('th', 'map-sum-head', 'Σ'); sumHead.rowSpan = headRows; srcRow.appendChild(sumHead);
    thead.appendChild(srcRow);
    if (bothTiers) {
      const tierRow = el('tr', 'map-head-tier');
      const first = el('th', null, MAP_LOCALE.tier_first); first.colSpan = nFirst; first.dataset.tier = 'first'; tierRow.appendChild(first);
      const after = el('th', null, MAP_LOCALE.tier_after); after.colSpan = nAfter; after.dataset.tier = 'after'; tierRow.appendChild(after);
      thead.appendChild(tierRow);
    }
    const targetRow = el('tr', 'map-head-targets');
    targets.forEach(t => {
      const th = el('th');
      th.dataset.mapTarget = t.key;
      th.dataset.colTier = t.tier;
      if (t.accepts === 'one') th.dataset.accepts = 'one';
      th.appendChild(el('span', 'map-col-label', t.label));
      th.appendChild(document.createTextNode(' '));
      th.appendChild(el('span', 'map-col-count', ''));
      if (model.slotNotes) th.appendChild(slotNoteButton());
      targetRow.appendChild(th);
    });
    thead.appendChild(targetRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    const proposed = new Set(proposalPairs(model, matrix).map(p => p[0] + '>' + p[1]));
    model.groups.forEach(group => {
      const members = model.items.filter(i => i.group === group);
      if (group) tbody.appendChild(groupRow(group, members.length, targets.length));
      members.forEach(item => tbody.appendChild(itemRow(section, matrix, targets, item, proposed)));
    });
    table.appendChild(tbody);
    const firstBox = table.querySelector('input[data-map-cell]');
    if (firstBox) firstBox.tabIndex = 0;                 // roving tabindex entry point
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    return wrap;
  }
  function groupRow(group, count, nTargets) {
    const gr = el('tr', 'map-group-row');
    gr.dataset.group = group;
    const td = el('td'); td.colSpan = nTargets + 2;
    td.appendChild(groupToggle(group, count));
    gr.appendChild(td);
    return gr;
  }
  function itemRow(section, matrix, targets, item, proposed) {
    const tr = el('tr', 'map-item-row');
    tr.dataset.item = item.id;
    tr.dataset.group = item.group;
    const th = el('th', 'map-item-label');
    th.setAttribute('scope', 'row');
    th.appendChild(el('span', null, item.label));
    if (item.hint) th.dataset.tip = item.hint;
    tr.appendChild(th);
    targets.forEach(t => {
      const td = el('td', 'map-cell-td');
      if (t.accepts === 'one') td.dataset.accepts = 'one';
      const label = el('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.mapCell = item.id + '>' + t.key;
      cb.dataset.proposed = proposed.has(item.id + '>' + t.key) ? '1' : '0';
      cb.tabIndex = -1;
      cb.disabled = isFrozen(section);                                                              // a checkbox cannot be readonly
      cb.setAttribute('aria-label', item.label + ' → ' + t.label);
      label.appendChild(cb);
      label.appendChild(el('span', 'map-cell'));
      td.appendChild(label);
      tr.appendChild(td);
    });
    tr.appendChild(el('td', 'map-sum', '0'));
    return tr;
  }
  function matrixEl(section, key) {
    return [...section.querySelectorAll('[data-map-matrix]')].find(d => d.dataset.mapMatrix === key) || null;
  }
  // Checkboxes, per-column counts, per-row Σ and change markers from the state
  // input — the only direction: the state string is read, never derived from
  // the boxes.
  function projectMatrix(section, model, matrix) {
    const wrap = matrixEl(section, matrix.key);
    if (!wrap) return;
    const pairs = readCells(model, matrix, stateInput(section, model.id, 'cells', matrix.key));
    const on = new Set(pairs.map(p => p[0] + '>' + p[1]));
    const anywhere = assignedAnywhere(section, model);
    wrap.querySelectorAll('input[data-map-cell]').forEach(cb => {
      cb.checked = on.has(cb.dataset.mapCell);
      cb.closest('td').classList.toggle('is-changed', cb.checked !== (cb.dataset.proposed === '1'));
    });
    wrap.querySelectorAll('th[data-map-target]').forEach(th => {
      const t = matrix.targets.find(x => x.key === th.dataset.mapTarget);
      const n = pairs.filter(p => p[1] === t.key).length;
      const count = th.querySelector('.map-col-count');
      count.textContent = t.accepts === 'one' ? n + '/1' : String(n);
      th.classList.toggle('is-under', !!t.min && n < t.min);
      th.classList.toggle('is-over', (!!t.max && n > t.max) || (t.accepts === 'one' && n > 1));
      th.dataset.tip = th.classList.contains('is-under') ? fmt(MAP_LOCALE.slot_empty_min, { n: t.min })
               : th.classList.contains('is-over') ? fmt(MAP_LOCALE.slot_over_max, { n: t.max || 1 }) : '';
      markNoteButton(section, model, th);
    });
    const min1 = matrix.src.itemTargets === 'min1';
    wrap.querySelectorAll('tr.map-item-row').forEach(tr => {
      const item = model.items.find(i => i.id === tr.dataset.item);
      const n = pairs.filter(p => p[0] === tr.dataset.item).length;
      const sum = tr.querySelector('.map-sum');
      sum.textContent = String(n);
      const flagged = (item.required && !anywhere.has(item.id)) || (min1 && n === 0);
      sum.classList.toggle('is-under', flagged);
      sum.dataset.tip = flagged ? MAP_LOCALE.item_required : '';
    });
  }
  function updateSummary(section, model) {
    const line = section.querySelector('.map-root > .map-summary');
    if (!line) return;
    const p = mappingProgress(section);
    const parts = [];
    if (p.total - p.assigned > 0) parts.push(fmt(MAP_LOCALE.summary_unassigned, { n: p.total - p.assigned }));
    if (p.violations > 0) parts.push(fmt(MAP_LOCALE.summary_violations, { n: p.violations }));
    line.textContent = parts.length ? parts.join(' · ') : MAP_LOCALE.summary_ok;
    line.dataset.ok = String(!parts.length);
    section.querySelectorAll('.map-tab').forEach(tab => {
      const mx = model.matrices.find(x => x.key === tab.dataset.mapTab);
      const n = mx ? matrixViolations(section, model, mx).length : 0;
      tab.querySelector('.map-tab-count').textContent = n ? fmt(MAP_LOCALE.tab_open, { n }) : '';
    });
  }

  // --- keyboard: arrows move, Home/End jump; Space is the native toggle -------
  function moveFocus(cb, dx, dy, edge) {
    const row = cb.closest('tr');
    const table = cb.closest('table');
    const rows = [...table.querySelectorAll('tr.map-item-row:not([hidden])')];
    const boxes = r => [...r.querySelectorAll('input[data-map-cell]')];
    const col = boxes(row).indexOf(cb);
    let r = rows.indexOf(row) + dy;
    let c = col + dx;
    if (edge === 'home') c = 0;
    if (edge === 'end') c = boxes(row).length - 1;
    r = Math.max(0, Math.min(rows.length - 1, r));
    c = Math.max(0, Math.min(boxes(rows[r]).length - 1, c));
    const next = boxes(rows[r])[c];
    if (!next || next === cb) return;
    setEntryPoint(table, next);
    next.focus();
    if (typeof next.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // Exactly one box per table carries tabindex 0 — reset all before promoting.
  function setEntryPoint(table, box) {
    table.querySelectorAll('input[data-map-cell]').forEach(b => { b.tabIndex = -1; });
    if (box) box.tabIndex = 0;
  }
  const KEYS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  // --- view state: `mode=schema|matrix;tab=<matrixKey>` in map-{m}-ui ----------
  const encodeUi = ui => Object.keys(ui).filter(k => ui[k]).map(k => k + '=' + ui[k]).join(';');
  const uiInput = (section, model) => stateInput(section, model.id, 'ui');
  // A frozen section keeps its view state in memory (`model.ui`): the readonly
  // ui input is never written there.
  function readUi(section, model) {
    const ui = isFrozen(section) && model.ui ? model.ui : parseUi(uiInput(section, model).value);
    return Object.assign({}, ui, { mode: model.hasElements && ui.mode !== 'matrix' ? 'schema' : 'matrix',
                                   tab: model.matrices.some(mx => mx.key === ui.tab) ? ui.tab : model.matrices[0].key });
  }
  // What is on screen: an axis has no schematic, so its tab shows the matrix
  // whatever `mode=` says (the stored mode survives for the element tabs).
  function visibleMode(model, ui) {
    const active = model.matrices.find(mx => mx.key === ui.tab);
    return active.src.kind === 'element' ? ui.mode : 'matrix';
  }
  // The one write path for the ui input: merge, never drop other keys.
  function writeUi(section, model, patch) {
    const ui = Object.assign(readUi(section, model), patch);
    if (isFrozen(section)) model.ui = ui;
    else writeState(uiInput(section, model), encodeUi(ui));
    applyView(section, model);
  }
  function activateTab(section, key) {
    const model = MODELS.get(section);
    if (!model || !model.matrices.some(mx => mx.key === key)) return;
    writeUi(section, model, { tab: key });
  }
  function renderTabs(model) {
    const strip = el('div', 'map-tabs');
    const multiSrc = model.sources.length > 1;
    // Group labels: "Context" once before the element tabs (only when a context
    // exists), "Axis" once before the first axis tab. Elements without a
    // context get no label.
    let contextLabelled = !model.contexts, axisLabelled = false;
    model.matrices.forEach(mx => {
      if (mx.src.kind === 'element' && !contextLabelled) { strip.appendChild(el('span', 'map-tabs-label', MAP_LOCALE.context)); contextLabelled = true; }
      if (mx.src.kind !== 'element' && !axisLabelled) { strip.appendChild(el('span', 'map-tabs-label', MAP_LOCALE.axis)); axisLabelled = true; }
      const btn = el('button', 'map-tab');
      btn.type = 'button';
      btn.dataset.mapTab = mx.key;
      btn.setAttribute('aria-pressed', 'false');
      const parts = [];
      if (multiSrc) parts.push(mx.src.label);
      if (mx.ctx) parts.push(contextLabel(model, mx.ctx));
      btn.appendChild(el('span', 'map-tab-label', parts.join(' · ') || mx.key));
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(el('span', 'map-tab-count', ''));
      strip.appendChild(btn);
    });
    return strip;
  }
  function renderTools(model) {
    const tools = el('div', 'map-tools');
    const ctxs = model.contexts || [];
    ctxs.forEach(from => ctxs.forEach(to => {
      if (from === to) return;
      const btn = el('button', 'map-copy', '⧉ ' + fmt(MAP_LOCALE.copy, { from: from.label, to: to.label }));
      btn.type = 'button';
      btn.dataset.from = from.id;
      btn.dataset.to = to.id;
      tools.appendChild(btn);
    }));
    const reset = el('button', 'map-reset', '↺ ' + MAP_LOCALE.reset);
    reset.type = 'button';
    tools.appendChild(reset);
    if (model.adhocItems) {
      const add = el('button', 'map-add-item', '+ ' + MAP_LOCALE.add_item);
      add.type = 'button';
      tools.appendChild(add);
    }
    const status = el('div', 'map-status map-tools-status');
    status.setAttribute('role', 'status');
    tools.appendChild(status);
    return tools;
  }
  function renderViewToggle() {
    const wrap = el('div', 'map-view-toggle');
    wrap.setAttribute('role', 'group');
    [['schema', MAP_LOCALE.view_schema], ['matrix', MAP_LOCALE.view_matrix]].forEach(([mode, label]) => {
      const btn = el('button', 'map-view-btn', label);
      btn.type = 'button';
      btn.dataset.mapMode = mode;
      btn.setAttribute('aria-pressed', 'false');
      wrap.appendChild(btn);
    });
    return wrap;
  }
  // The schematic of the active tab's context or the active matrix is on
  // screen; everything else stays in the DOM, hidden. On an axis tab the
  // view toggle is marked aria-disabled (no schematic to switch to).
  function applyView(section, model) {
    const ui = readUi(section, model);
    const active = model.matrices.find(mx => mx.key === ui.tab);
    const mode = visibleMode(model, ui);
    const axis = active.src.kind !== 'element';
    section.querySelectorAll('.map-view-btn').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.mapMode === mode));
      if (axis) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    });
    section.querySelectorAll('.map-tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mapTab === ui.tab)));
    section.querySelectorAll('.map-schema').forEach(s => { s.hidden = !(mode === 'schema' && s.dataset.mapCtx === (active.ctx || '')); });
    section.querySelectorAll('[data-map-matrix]').forEach(w => { w.hidden = !(mode === 'matrix' && w.dataset.mapMatrix === ui.tab); });
    section.querySelectorAll('.map-row-filters').forEach(f => { f.hidden = mode !== 'matrix'; });    // the palette filters the schematic
  }

  // --- schematic view (§ Schematic view) --------------------------------------
  function renderSchema(section, model, ctx) {
    const schema = el('div', 'map-schema');
    schema.dataset.mapCtx = ctx || '';
    if (ctx) schema.setAttribute('aria-label', contextLabel(model, ctx));
    model.sources.filter(s => s.kind === 'element').forEach(src => {
      const element = el('div', 'map-element');
      element.dataset.mapElement = src.id;
      element.appendChild(el('div', 'map-element-caption', src.label));
      const tiers = el('div', 'map-tiers');
      ['first', 'after'].forEach(tier => {
        const targets = src.targets.filter(t => t.tier === tier);
        if (!targets.length) return;
        const col = el('div', 'map-tier');
        col.dataset.tier = tier;
        col.appendChild(el('div', 'map-tier-label', tier === 'first' ? MAP_LOCALE.tier_first : MAP_LOCALE.tier_after));
        rowsOf(targets).forEach(([row, members]) => {
          const r = el('div', 'map-row');
          r.dataset.row = row;
          members.forEach(t => r.appendChild(renderSlot(model, t)));
          col.appendChild(r);
        });
        tiers.appendChild(col);
      });
      element.appendChild(tiers);
      schema.appendChild(element);
    });
    schema.appendChild(renderPalette(model));
    const status = el('div', 'map-status');
    status.setAttribute('role', 'status');
    schema.appendChild(status);
    return schema;
  }
  // Parts sharing a `row` sit side by side, rows in numeric order; a part
  // without one gets its own row after the numbered ones.
  function rowsOf(targets) {
    const rows = new Map();
    targets.forEach(t => {
      const key = t.row === null ? t.id : String(t.row);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(t);
    });
    const rank = ([, members]) => members[0].row === null ? Number.MAX_SAFE_INTEGER : members[0].row;
    return [...rows.entries()].sort((a, b) => rank(a) - rank(b));
  }
  function renderSlot(model, t) {
    const slot = el('div', 'map-slot');
    slot.dataset.mapTarget = t.key;
    slot.dataset.accepts = t.accepts;
    const label = el('button', 'map-slot-label');
    label.type = 'button';
    label.appendChild(el('span', null, t.label));
    label.appendChild(document.createTextNode(' '));
    label.appendChild(el('span', 'map-slot-count', ''));
    slot.appendChild(label);
    slot.appendChild(el('div', 'map-slot-chips'));
    if (model.slotNotes) slot.appendChild(slotNoteButton());
    return slot;
  }
  // One note per target (not per context), revealed by the ✎ on a slot or a
  // column header. Plain `data-comment` textareas — no `data-attachable`.
  function renderSlotNotes(section, model) {
    const wrap = el('div', 'map-slot-notes');
    model.sources.flatMap(s => s.targets).forEach(t => {
      const label = el('label', 'map-slot-note');
      label.appendChild(el('span', 'map-slot-note-label', t.label));
      const ta = document.createElement('textarea');
      ta.dataset.comment = 'map-' + model.id + '-note-' + t.key;
      ta.rows = 2;
      ta.hidden = true;
      ta.readOnly = isFrozen(section);
      label.appendChild(ta);
      wrap.appendChild(label);
    });
    return wrap;
  }
  function slotNoteArea(section, model, key) {
    return [...section.querySelectorAll('.map-slot-notes textarea')].find(ta => ta.dataset.comment === 'map-' + model.id + '-note-' + key) || null;
  }
  function toggleSlotNote(section, model, key) {
    const ta = slotNoteArea(section, model, key);
    if (!ta) return;
    ta.hidden = !ta.hidden;
    if (!ta.hidden && !isFrozen(section)) ta.focus();
  }
  // The ✎ of a slot or a column header carries `has-note` while its target's
  // note has text — set on every projection and on each keystroke in the note.
  function markNoteButton(section, model, holder) {
    const btn = holder.querySelector('.map-slot-note-btn');
    if (!btn) return;
    const ta = slotNoteArea(section, model, holder.dataset.mapTarget);
    btn.classList.toggle('has-note', !!ta && ta.value.trim() !== '');
  }
  function markNoteHolders(section, model, key) {
    section.querySelectorAll('.map-slot[data-map-target], th[data-map-target]').forEach(h => { if (h.dataset.mapTarget === key) markNoteButton(section, model, h); });
  }
  function renderPalette(model) {
    const pal = el('div', 'map-palette');
    const head = el('div', 'map-palette-head');
    head.appendChild(el('span', 'map-palette-title', MAP_LOCALE.items + ' (' + model.items.length + ')'));
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'map-search';
    search.placeholder = MAP_LOCALE.search;
    search.setAttribute('aria-label', MAP_LOCALE.search);
    head.appendChild(search);
    const filters = el('div', 'map-filters');
    [['all', MAP_LOCALE.filter_all], ['unassigned', MAP_LOCALE.filter_unassigned],
     ['multiple', MAP_LOCALE.filter_multiple], ['changed', MAP_LOCALE.filter_changed]].forEach(([f, label]) => {
      const btn = el('button', 'map-filter');
      btn.type = 'button';
      btn.dataset.filter = f;
      btn.setAttribute('aria-pressed', String(f === 'all'));
      btn.appendChild(el('span', null, label));
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(el('span', 'map-filter-count', ''));
      filters.appendChild(btn);
    });
    head.appendChild(filters);
    const collapse = el('button', 'map-palette-collapse', '▴');
    collapse.type = 'button';
    collapse.setAttribute('aria-expanded', 'true');
    collapse.setAttribute('aria-label', MAP_LOCALE.items);
    head.appendChild(collapse);
    pal.appendChild(head);
    const groups = el('div', 'map-groups');
    model.groups.forEach(group => groups.appendChild(paletteGroup(model, group)));
    pal.appendChild(groups);
    return pal;
  }
  function paletteGroup(model, group) {
    const members = model.items.filter(i => i.group === group);
    const g = el('div', 'map-group');
    g.dataset.group = group;
    if (group) g.appendChild(groupToggle(group, members.length));
    const chips = el('div', 'map-group-chips');
    members.forEach(item => chips.appendChild(itemChip(item)));
    g.appendChild(chips);
    return g;
  }
  function itemChip(item) {
    const chip = el('button', 'map-item-chip');
    chip.type = 'button';
    chip.dataset.item = item.id;
    chip.setAttribute('aria-pressed', 'false');
    chip.appendChild(el('span', 'map-item-label', item.label));
    chip.appendChild(el('span', 'map-item-count', ''));
    return chip;
  }
  // Slot chips, counts and palette badges from the state strings plus the
  // matrix's `data-proposed` stamps; the armed cue and the view last.
  function refreshSchema(section, model) {
    const stats = itemStats(section, model);                                                        // after projectMatrix: reads the boxes
    if (model.hasElements) {
      section.querySelectorAll('.map-schema').forEach(schema => {
        const ctx = schema.dataset.mapCtx || null;
        schema.querySelectorAll('.map-slot').forEach(slot => refreshSlot(section, model, slot, ctx));
        refreshPalette(model, schema, stats);
        refreshArmed(model, schema);
      });
    }
    applyRowFilter(section, model, stats);                                                          // matrix rows, every tab
    applyView(section, model);
  }
  function refreshSlot(section, model, slot, ctx) {
    const key = slot.dataset.mapTarget;
    const matrix = matrixOf(model, key, ctx);
    if (!matrix) return;
    const target = matrix.targets.find(t => t.key === key);
    const pairs = readCells(model, matrix, stateInput(section, model.id, 'cells', matrix.key));
    let items = pairs.filter(p => p[1] === key).map(p => p[0]);
    if (target.ordered) {
      const ord = splitOrder(stateInput(section, model.id, 'order', orderKey(matrix, target)).value).filter(id => items.includes(id));
      items = ord.concat(items.filter(id => !ord.includes(id)));
    }
    const proposed = new Set();
    const wrap = matrixEl(section, matrix.key);
    if (wrap) wrap.querySelectorAll('input[data-map-cell][data-proposed="1"]').forEach(cb => {
      const p = cb.dataset.mapCell.split('>');
      if (p[1] === key) proposed.add(p[0]);
    });
    const chips = slot.querySelector('.map-slot-chips');
    chips.textContent = '';
    const labelOf = id => (model.items.find(i => i.id === id) || { label: id }).label;
    items.forEach(id => {
      const chip = el('button', 'map-chip');
      chip.type = 'button';
      chip.dataset.item = id;
      chip.classList.add(proposed.has(id) ? 'is-proposed' : 'is-changed');
      chip.appendChild(el('span', 'map-chip-label', labelOf(id)));
      if (!isFrozen(section)) {
        const x = el('span', 'map-chip-remove', '×');
        x.setAttribute('aria-label', MAP_LOCALE.remove);
        x.dataset.tip = MAP_LOCALE.remove;
        chip.appendChild(x);
      }
      chips.appendChild(chip);
    });
    proposed.forEach(id => {                                                                         // removed proposal → ghost
      if (items.includes(id)) return;
      const ghost = el('span', 'map-chip is-removed');
      ghost.dataset.item = id;
      ghost.appendChild(el('span', 'map-chip-label', labelOf(id)));
      chips.appendChild(ghost);
    });
    const n = items.length;
    const count = slot.querySelector('.map-slot-count');
    count.textContent = target.accepts === 'one' ? n + '/1' : String(n);
    const under = !!target.min && n < target.min;
    const over = (!!target.max && n > target.max) || (target.accepts === 'one' && n > 1);
    slot.classList.toggle('is-under', under);
    slot.classList.toggle('is-over', over);
    count.dataset.tip = under ? fmt(MAP_LOCALE.slot_empty_min, { n: target.min }) : over ? fmt(MAP_LOCALE.slot_over_max, { n: target.max || 1 }) : '';
    markNoteButton(section, model, slot);
  }
  // Per item across ALL matrices: where it sits and whether any cell differs
  // from the proposal.
  function itemStats(section, model) {
    const stats = new Map(model.items.map(i => [i.id, { places: [], changed: false }]));
    model.matrices.forEach(mx => {
      readCells(model, mx, stateInput(section, model.id, 'cells', mx.key)).forEach(p => {
        const t = mx.targets.find(x => x.key === p[1]);
        stats.get(p[0]).places.push(t.label + (mx.ctx ? ' (' + contextLabel(model, mx.ctx) + ')' : ''));
      });
      const wrap = matrixEl(section, mx.key);
      if (wrap) wrap.querySelectorAll('input[data-map-cell]').forEach(cb => {
        if (cb.checked !== (cb.dataset.proposed === '1')) stats.get(cb.dataset.mapCell.split('>')[0]).changed = true;
      });
    });
    return stats;
  }
  // One predicate for the palette's filter pills AND the matrix row filter:
  // unassigned = nowhere across ALL matrices, changed = any cell differs from
  // the proposal (both straight from itemStats()).
  const filterPass = (filter, s) => filter === 'unassigned' ? s.places.length === 0
    : filter === 'multiple' ? s.places.length >= 2
    : filter === 'changed' ? s.changed : true;
  function filterCounts(model, stats) {
    const counts = { all: 0, unassigned: 0, multiple: 0, changed: 0 };
    model.items.forEach(item => {
      const s = stats.get(item.id);
      counts.all++;
      if (filterPass('unassigned', s)) counts.unassigned++;
      if (filterPass('multiple', s)) counts.multiple++;
      if (filterPass('changed', s)) counts.changed++;
    });
    return counts;
  }
  function refreshPalette(model, schema, stats) {
    const active = schema.querySelector('.map-filter[aria-pressed="true"]');
    const filter = active ? active.dataset.filter : 'all';
    const q = schema.querySelector('.map-search').value.trim().toLowerCase();
    const counts = filterCounts(model, stats);
    schema.querySelectorAll('.map-item-chip').forEach(chip => {
      const item = model.items.find(i => i.id === chip.dataset.item);
      const s = stats.get(item.id);
      const n = s.places.length;
      chip.querySelector('.map-item-count').textContent = n ? n + '×' : '○';
      chip.dataset.tip = s.places.join(', ');
      chip.classList.toggle('is-changed', s.changed);
      chip.classList.toggle('is-unassigned', n === 0);
      const hit = !q || (item.label + ' ' + groupLabel(item.group)).toLowerCase().includes(q);
      chip.hidden = !(filterPass(filter, s) && hit);
    });
    schema.querySelectorAll('.map-filter').forEach(b => { b.querySelector('.map-filter-count').textContent = String(counts[b.dataset.filter]); });
    schema.querySelectorAll('.map-group').forEach(g => { g.hidden = ![...g.querySelectorAll('.map-item-chip')].some(c => !c.hidden); });
    schema.querySelector('.map-palette-title').textContent = MAP_LOCALE.items + ' (' + model.items.length + ')';
  }
  // Matrix row filter (spec § 7 "Rows: All / Unassigned / Changed") — the
  // toolbar pills, one set per mapping, in-memory (`model.rowFilter`), never
  // persisted. Rows hide when they fail the filter OR their group is
  // collapsed; a group row hides when none of its members pass. Applied to
  // EVERY matrix, not just the visible tab, so switching tabs keeps the view.
  function renderRowFilters() {
    const wrap = el('div', 'map-row-filters');
    wrap.setAttribute('role', 'group');
    [['all', MAP_LOCALE.filter_all], ['unassigned', MAP_LOCALE.filter_unassigned], ['changed', MAP_LOCALE.filter_changed]].forEach(([f, label]) => {
      const btn = el('button', 'map-row-filter');
      btn.type = 'button';
      btn.dataset.filter = f;
      btn.setAttribute('aria-pressed', String(f === 'all'));
      btn.appendChild(el('span', null, label));
      btn.appendChild(document.createTextNode(' '));
      btn.appendChild(el('span', 'map-filter-count', ''));
      wrap.appendChild(btn);
    });
    return wrap;
  }
  function applyRowFilter(section, model, stats) {
    const filter = model.rowFilter || 'all';
    const counts = filterCounts(model, stats);
    section.querySelectorAll('.map-row-filter').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
      b.querySelector('.map-filter-count').textContent = String(counts[b.dataset.filter]);
    });
    section.querySelectorAll('[data-map-matrix] table').forEach(table => {
      const collapsed = new Set([...table.querySelectorAll('tr.map-group-row')]
        .filter(gr => gr.querySelector('.map-group-toggle').getAttribute('aria-expanded') !== 'true')
        .map(gr => gr.dataset.group));
      const passing = new Set();
      table.querySelectorAll('tr.map-item-row').forEach(tr => {
        const s = stats.get(tr.dataset.item);
        const pass = !!s && filterPass(filter, s);
        if (pass) passing.add(tr.dataset.group);
        tr.hidden = !pass || collapsed.has(tr.dataset.group);
      });
      table.querySelectorAll('tr.map-group-row').forEach(gr => { gr.hidden = !passing.has(gr.dataset.group); });
      // The keyboard entry point must sit on a visible row.
      const entry = table.querySelector('input[data-map-cell][tabindex="0"]');
      if (!entry || entry.closest('tr').hidden) setEntryPoint(table, table.querySelector('tr.map-item-row:not([hidden]) input[data-map-cell]'));
    });
  }

  // --- arm, then tap: one in-memory `armed` per mapping ------------------------
  function refreshArmed(model, schema) {
    const a = model.armed || null;
    const ctx = schema.dataset.mapCtx || null;
    schema.querySelectorAll('.map-item-chip').forEach(c => c.setAttribute('aria-pressed', String(!!a && a.kind === 'item' && a.id === c.dataset.item)));
    schema.querySelectorAll('.map-slot').forEach(s => s.classList.toggle('is-armed', !!a && a.kind === 'slot' && a.id === s.dataset.mapTarget && a.ctx === ctx));
    schema.dataset.armed = a ? a.kind : '';
    let text = '';
    if (a && a.kind === 'item') text = fmt(MAP_LOCALE.armed_item, { label: (model.items.find(i => i.id === a.id) || { label: a.id }).label });
    if (a && a.kind === 'slot') text = fmt(MAP_LOCALE.armed_slot, { label: (model.sources.flatMap(s => s.targets).find(t => t.key === a.id) || { label: a.id }).label });
    schema.querySelector('.map-status').textContent = text;
  }
  function setArmed(section, model, armed) {
    model.armed = armed;
    section.querySelectorAll('.map-schema').forEach(schema => refreshArmed(model, schema));
  }
  function tapItem(section, model, id) {
    if (isFrozen(section)) return;
    const a = model.armed;
    if (a && a.kind === 'slot') { toggleCell(section, model, id, a.id, a.ctx); return; }
    setArmed(section, model, a && a.id === id ? null : { kind: 'item', id });
  }
  function tapSlot(section, model, key, ctx) {
    if (isFrozen(section)) return;
    const a = model.armed;
    if (a && a.kind === 'item') { toggleCell(section, model, a.id, key, ctx); return; }             // item stays armed
    setArmed(section, model, a && a.kind === 'slot' && a.id === key && a.ctx === ctx ? null : { kind: 'slot', id: key, ctx });
  }
  function toggleCell(section, model, item, key, ctx) {
    const matrix = matrixOf(model, key, ctx);
    if (!matrix) return;
    const pairs = readCells(model, matrix, stateInput(section, model.id, 'cells', matrix.key));
    const has = pairs.some(p => p[0] === item && p[1] === key);
    const target = matrix.targets.find(t => t.key === key);
    const swaps = !has && target.accepts === 'one' && pairs.some(p => p[1] === key);
    if (setCell(section, item, key, ctx, !has) && swaps) flashSlot(section, key, ctx);
  }
  const FLASH = new WeakMap();       // slot → pending timeout
  function flashSlot(section, key, ctx) {
    section.querySelectorAll('.map-schema').forEach(schema => {
      if ((schema.dataset.mapCtx || null) !== ctx) return;
      const slot = [...schema.querySelectorAll('.map-slot')].find(s => s.dataset.mapTarget === key);
      if (!slot) return;
      clearTimeout(FLASH.get(slot));
      slot.classList.add('is-swapped');
      FLASH.set(slot, setTimeout(() => { slot.classList.remove('is-swapped'); FLASH.delete(slot); }, 700));
    });
  }
  function reorderChip(section, model, slot, ctx, id, dir) {
    const key = slot.dataset.mapTarget;
    const matrix = matrixOf(model, key, ctx);
    const target = matrix && matrix.targets.find(t => t.key === key);
    if (!target || !target.ordered || section.dataset.mapFrozen === 'true') return;
    const ids = [...slot.querySelectorAll('button.map-chip')].map(c => c.dataset.item);
    const i = ids.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1); ids.splice(j, 0, id);
    writeState(stateInput(section, model.id, 'order', orderKey(matrix, target)), ids.join(','));
    refreshSchema(section, model);
    const chip = [...slot.querySelectorAll('button.map-chip')].find(c => c.dataset.item === id);
    if (chip) chip.focus();
  }
  // Toolbar, tabs, ✎ and the palette collapse — true when the click was consumed.
  function toolClick(section, model, t) {
    const hit = sel => { const n = t.closest(sel); return n && section.contains(n) ? n : null; };
    const viewBtn = hit('.map-view-btn');
    if (viewBtn) {                                                                                  // inert on an axis tab (aria-disabled)
      if (viewBtn.getAttribute('aria-disabled') !== 'true') writeUi(section, model, { mode: viewBtn.dataset.mapMode });
      return true;
    }
    const tab = hit('.map-tab');
    if (tab) { activateTab(section, tab.dataset.mapTab); return true; }
    const rowFilter = hit('.map-row-filter');
    if (rowFilter) {                                                                                // in memory, frozen or live
      model.rowFilter = rowFilter.dataset.filter;
      applyRowFilter(section, model, itemStats(section, model));
      return true;
    }
    const note = hit('.map-slot-note-btn');
    if (note) {
      const holder = note.closest('.map-slot') || note.closest('th[data-map-target]');
      if (holder) toggleSlotNote(section, model, holder.dataset.mapTarget);
      return true;
    }
    const collapse = hit('.map-palette-collapse');
    if (collapse) {
      const open = collapse.getAttribute('aria-expanded') !== 'true';
      collapse.setAttribute('aria-expanded', String(open));
      collapse.textContent = open ? '▴' : '▾';
      collapse.closest('.map-palette').querySelector('.map-groups').hidden = !open;
      return true;
    }
    if (isFrozen(section)) return false;                                                            // no tools on a frozen section
    const copy = hit('.map-copy');
    if (copy) { copyContext(section, model, copy.dataset.from, copy.dataset.to); return true; }
    if (hit('.map-reset')) { resetMatrix(section, model, readUi(section, model).tab); return true; }
    if (hit('.map-add-item')) { addItemPrompt(section, model); return true; }
    return false;
  }
  function wireSchema(section, model) {
    section.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (toolClick(section, model, t)) return;
      const schema = t.closest('.map-schema');
      if (!schema || !section.contains(schema)) return;
      const ctx = schema.dataset.mapCtx || null;
      const remove = t.closest('.map-chip-remove');
      if (remove) { setCell(section, remove.closest('.map-chip').dataset.item, remove.closest('.map-slot').dataset.mapTarget, ctx, false); return; }
      const itemChip = t.closest('.map-item-chip');
      if (itemChip) { tapItem(section, model, itemChip.dataset.item); return; }
      const slot = t.closest('.map-slot');
      if (slot) { tapSlot(section, model, slot.dataset.mapTarget, ctx); return; }
      const filter = t.closest('.map-filter');
      if (filter) {
        schema.querySelectorAll('.map-filter').forEach(b => b.setAttribute('aria-pressed', String(b === filter)));
        refreshPalette(model, schema, itemStats(section, model));
        return;
      }
      if (t.closest('button, input, label')) return;
      if (model.armed) setArmed(section, model, null);                                              // empty space disarms
    });
    section.addEventListener('input', e => {
      const s = e.target;
      if (s instanceof HTMLInputElement && s.classList.contains('map-search')) refreshPalette(model, s.closest('.map-schema'), itemStats(section, model));
      const prefix = 'map-' + model.id + '-note-';
      if (s instanceof HTMLTextAreaElement && s.closest('.map-slot-note') && String(s.dataset.comment || '').startsWith(prefix)) markNoteHolders(section, model, s.dataset.comment.slice(prefix.length));
    });
    section.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (model.armed) { setArmed(section, model, null); e.stopPropagation(); }
        return;
      }
      const chip = e.target instanceof Element ? e.target.closest('button.map-chip') : null;
      if (!chip || !section.contains(chip)) return;
      const slot = chip.closest('.map-slot');
      const ctx = chip.closest('.map-schema').dataset.mapCtx || null;
      if (e.key === 'Delete') {
        e.preventDefault();
        setCell(section, chip.dataset.item, slot.dataset.mapTarget, ctx, false);
        slot.querySelector('.map-slot-label').focus();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        reorderChip(section, model, slot, ctx, chip.dataset.item, e.key === 'ArrowLeft' ? -1 : 1);
      }
    });
  }

  // --- tools: copy context, reset, ad-hoc items (§ Proposal, reset, ad-hoc) --
  // Clears every matrix of the target context, then replays the source pairs
  // through the cell write path in source order (so accepts:one swaps stay
  // deterministic); order inputs follow; one refresh at the end.
  function copyContext(section, model, from, to) {
    if (from === to || !model.contexts) return;
    if (!window.confirm(fmt(MAP_LOCALE.copy_confirm, { from: contextLabel(model, from), to: contextLabel(model, to) }))) return;
    model.matrices.filter(mx => mx.ctx === to).forEach(mx => writeState(stateInput(section, model.id, 'cells', mx.key), '-'));
    model.matrices.filter(mx => mx.ctx === from).forEach(src => {
      const pairs = readCells(model, src, stateInput(section, model.id, 'cells', src.key));
      pairs.forEach(p => writeCell(section, model, p[0], p[1], to, true));
      const dst = model.matrices.find(mx => mx.ctx === to && mx.src === src.src);
      if (dst) src.targets.filter(t => t.ordered).forEach(t => {
        writeState(stateInput(section, model.id, 'order', orderKey(dst, t)), stateInput(section, model.id, 'order', orderKey(src, t)).value);
      });
    });
    refreshAll(section, model);
  }
  function resetMatrix(section, model, key) {
    const matrix = model.matrices.find(mx => mx.key === key);
    if (!matrix || !window.confirm(MAP_LOCALE.reset_confirm)) return;
    const pairs = proposalPairs(model, matrix);
    writeState(stateInput(section, model.id, 'cells', matrix.key), encodeCells(pairs));
    matrix.targets.filter(t => t.ordered).forEach(t => {
      writeState(stateInput(section, model.id, 'order', orderKey(matrix, t)), (model.proposalOrder[orderKey(matrix, t)] || []).join(','));
      syncOrder(section, model, matrix, t, pairs);
    });
    refreshAll(section, model);
  }
  const ADHOC_MAX = 20, ADHOC_LABEL_MAX = 60;
  const adhocLabels = model => model.items.filter(i => i.adhoc).map(i => i.label);
  const adhocLabel = raw => String(raw).trim().slice(0, ADHOC_LABEL_MAX).trim();                 // one normalisation for prompt and restore
  function syncAddButton(section, model) {
    const add = section.querySelector('.map-add-item');
    if (add) add.disabled = adhocLabels(model).length >= ADHOC_MAX;
  }
  function addItemPrompt(section, model) {
    if (!model.adhocItems || adhocLabels(model).length >= ADHOC_MAX) return;
    const status = section.querySelector('.map-tools-status');
    const raw = window.prompt(MAP_LOCALE.add_item_prompt);
    if (raw === null) return;
    const label = adhocLabel(raw);
    if (!label) return;
    if (model.items.some(i => i.label.trim().toLowerCase() === label.toLowerCase())) {
      if (status) status.textContent = MAP_LOCALE.add_item_duplicate;
      return;
    }
    if (status) status.textContent = '';
    addAdhocItem(section, model, label);
    writeState(stateInput(section, model.id, 'adhoc'), JSON.stringify(adhocLabels(model)));
    refreshAll(section, model);
    syncAddButton(section, model);
  }
  // Model + DOM for one ad-hoc item: a row in every matrix, a chip in every
  // palette, both inside the implicit "Added by you" group.
  function addAdhocItem(section, model, label) {
    const id = 'u' + (adhocLabels(model).length + 1);
    const item = { id, label, group: ADHOC_GROUP, hint: '', required: false, adhoc: true };
    model.items.push(item);
    if (!model.groups.includes(ADHOC_GROUP)) model.groups.push(ADHOC_GROUP);
    const count = adhocLabels(model).length;
    model.matrices.forEach(mx => {
      const wrap = matrixEl(section, mx.key);
      if (!wrap) return;
      const tbody = wrap.querySelector('tbody');
      const targets = orderedTargets(mx);
      let gr = [...tbody.querySelectorAll('tr.map-group-row')].find(r => r.dataset.group === ADHOC_GROUP);
      if (!gr) { gr = groupRow(ADHOC_GROUP, 0, targets.length); tbody.appendChild(gr); }
      gr.querySelector('.map-group-count').textContent = String(count);
      const row = itemRow(section, mx, targets, item, new Set());
      row.hidden = gr.querySelector('.map-group-toggle').getAttribute('aria-expanded') !== 'true';
      tbody.appendChild(row);
      if (!wrap.querySelector('input[data-map-cell][tabindex="0"]')) setEntryPoint(wrap.querySelector('table'), row.querySelector('input[data-map-cell]'));
    });
    section.querySelectorAll('.map-schema .map-groups').forEach(groups => {
      let g = [...groups.querySelectorAll('.map-group')].find(x => x.dataset.group === ADHOC_GROUP);
      if (!g) { g = paletteGroup(model, ADHOC_GROUP); groups.appendChild(g); }
      else {
        g.querySelector('.map-group-count').textContent = String(count);
        g.querySelector('.map-group-chips').appendChild(itemChip(item));
      }
    });
  }
  function removeAdhocItems(section, model) {
    const ids = new Set(model.items.filter(i => i.adhoc).map(i => i.id));
    if (!ids.size) return;
    model.items = model.items.filter(i => !i.adhoc);
    model.groups = model.groups.filter(g => g !== ADHOC_GROUP);
    if (model.armed && model.armed.kind === 'item' && ids.has(model.armed.id)) model.armed = null;
    section.querySelectorAll('tr.map-item-row, tr.map-group-row, .map-palette .map-group').forEach(n => {
      if (n.dataset.group === ADHOC_GROUP) n.remove();
    });
  }
  // The `map-{m}-adhoc` input is the truth for ad-hoc items (restore may
  // overwrite it): re-create them from it before the cells are decoded.
  function syncAdhoc(section, model) {
    if (!model.adhocItems) return;
    const input = stateInput(section, model.id, 'adhoc');
    let labels = [];
    try { labels = JSON.parse(input.value || '[]'); } catch { labels = []; }
    labels = (Array.isArray(labels) ? labels : []).map(adhocLabel).filter(Boolean).slice(0, ADHOC_MAX);
    const current = adhocLabels(model);
    if (labels.length !== current.length || labels.some((l, i) => l !== current[i])) {
      removeAdhocItems(section, model);
      labels.forEach(l => addAdhocItem(section, model, l));
      const enc = JSON.stringify(labels);
      if (input.value !== enc) input.value = enc;
    }
    syncAddButton(section, model);
  }

  // --- section rendering -----------------------------------------------------
  function readSpec(section) {
    const script = section.querySelector('script[data-mapping-spec]');
    if (!script) throw new Error('no spec');
    return normalizeSpec(JSON.parse(script.textContent));
  }
  function wireSection(section, model) {
    section.addEventListener('change', e => {
      const cb = e.target;
      if (!(cb instanceof HTMLInputElement) || !cb.dataset.mapCell) return;
      const parts = cb.dataset.mapCell.split('>');
      const wrap = cb.closest('[data-map-matrix]');
      const matrix = model.matrices.find(m => m.key === wrap.dataset.mapMatrix);
      // The click already flipped the box; setCell reads `has` from the state
      // string, so a refused write (frozen, unknown target) must re-project.
      if (!setCell(section, parts[0], parts[1], matrix.ctx, cb.checked)) projectMatrix(section, model, matrix);
    });
    section.addEventListener('click', e => {
      const btn = e.target.closest('button.map-group-toggle');
      if (!btn || !section.contains(btn)) return;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      btn.querySelector('.map-group-glyph').textContent = open ? '▾' : '▸';
      const row = btn.closest('tr.map-group-row');
      if (!row) {                                                                                   // palette group
        btn.closest('.map-group').querySelector('.map-group-chips').hidden = !open;
        return;
      }
      // Row visibility = collapse state ∧ row filter, recomputed in one place
      // (applyRowFilter also keeps the keyboard entry point on a visible row).
      applyRowFilter(section, model, itemStats(section, model));
    });
    section.addEventListener('keydown', e => {
      const cb = e.target;
      if (!(cb instanceof HTMLInputElement) || !cb.dataset.mapCell) return;
      if (KEYS[e.key]) { e.preventDefault(); moveFocus(cb, KEYS[e.key][0], KEYS[e.key][1]); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); moveFocus(cb, 0, 0, e.key.toLowerCase()); }
    });
    wireSchema(section, model);
  }
  // The mapping (or its error box) renders IN PLACE of the spec script: a free
  // round's authored note follows the spec, and appending at the section's
  // end put the note above the matrix and its tools (browser-verified).
  function mount(section, node) {
    const spec = section.querySelector('script[data-mapping-spec]');
    if (spec) spec.after(node); else section.appendChild(node);
  }
  // One broken mapping must never abort renderMappings() — it is the first
  // statement of the persistence handler, and ensureCommentSlots() plus
  // restoreState() for the WHOLE page follow it. A spec that does not parse
  // or normalise fails in readSpec; one that passes but breaks the builder
  // (a malformed `proposalOrder`, say) fails inside buildSection. Both end
  // the same way: the half-built DOM is dropped, the error box is mounted
  // in place of the spec and the section is marked rendered.
  function renderSection(section) {
    try { buildSection(section, readSpec(section)); }
    catch (e) {
      MODELS.delete(section);
      delete section.dataset.mapFrozen;
      section.querySelectorAll('.map-root, .map-states').forEach(n => n.remove());                   // mappings never nest
      const banner = el('div', 'map-error', fmt(MAP_LOCALE.spec_error, { error: e.message }));
      banner.setAttribute('role', 'alert');
      mount(section, banner);
    }
    section.dataset.mapRendered = 'true';
  }
  function buildSection(section, model) {
    const m = section.dataset.mapping;
    model.id = m;
    MODELS.set(section, model);

    // Frozen = inside an iteration that is not the active one: the baked
    // `submitted` state is shown read-only; without it the proposal is shown
    // behind a visible banner (never silently as the user's decision).
    const iteration = section.closest('section[data-iteration]');
    const frozen = !!iteration && !iteration.hasAttribute('data-active');
    if (frozen) section.dataset.mapFrozen = 'true';
    // A submission is only trusted when it carries every matrix key (the
    // payload always does) — a partial or stale one is treated as missing.
    const complete = s => !!s && typeof s === 'object' && !!s.cells && typeof s.cells === 'object'
      && model.matrices.every(mx => Array.isArray(s.cells[mx.key]));
    const submitted = frozen && complete(model.submitted) ? model.submitted : null;
    if (frozen && !submitted) {
      const banner = el('div', 'map-error', MAP_LOCALE.frozen_missing);
      banner.setAttribute('role', 'alert');
      section.prepend(banner);
    }

    // State inputs first (the persistence block may overwrite them right after),
    // initialised from the proposal (or the submission) — value only, no
    // events, nothing touched. Ad-hoc items before cells so their ids resolve.
    if (model.adhocItems) stateInput(section, m, 'adhoc').value = JSON.stringify(submitted && Array.isArray(submitted.adhoc) ? submitted.adhoc : []);
    model.matrices.forEach(mx => {
      const state = stateInput(section, m, 'cells', mx.key);
      const src = submitted ? submitted.cells[mx.key] : null;
      const pairs = src ? src.filter(p => Array.isArray(p) && p.length === 2).map(p => [String(p[0]), String(p[1])]) : proposalPairs(model, mx);
      state.value = encodeCells(pairs);
      mx.targets.filter(t => t.ordered).forEach(t => {
        const input = stateInput(section, m, 'order', orderKey(mx, t));
        const order = submitted && submitted.order && Array.isArray(submitted.order[orderKey(mx, t)]) ? submitted.order[orderKey(mx, t)] : model.proposalOrder[orderKey(mx, t)];
        input.value = (order || []).join(',');
      });
    });
    stateInput(section, m, 'ui').value = encodeUi({ mode: model.hasElements ? 'schema' : 'matrix', tab: model.matrices[0].key });

    const root = el('div', 'map-root');
    const toolbar = el('div', 'map-toolbar');
    if (model.hasElements) toolbar.appendChild(renderViewToggle());
    if (model.matrices.length > 1) toolbar.appendChild(renderTabs(model));
    toolbar.appendChild(renderRowFilters());                                                        // browsable on a frozen section too
    if (!frozen) toolbar.appendChild(renderTools(model));
    root.appendChild(toolbar);
    const summary = el('div', 'map-summary');
    summary.setAttribute('aria-live', 'polite');
    root.appendChild(summary);
    if (model.hasElements) (model.contexts || [null]).forEach(c => root.appendChild(renderSchema(section, model, c ? c.id : null)));
    const matrices = el('div', 'map-matrices');
    model.matrices.forEach(mx => matrices.appendChild(renderMatrix(section, model, mx)));
    root.appendChild(matrices);
    if (model.slotNotes) {
      const notes = renderSlotNotes(section, model);
      const texts = submitted && submitted.slotNotes && typeof submitted.slotNotes === 'object' ? submitted.slotNotes : {};
      notes.querySelectorAll('textarea').forEach(ta => {
        const key = ta.dataset.comment.slice(('map-' + m + '-note-').length);
        if (typeof texts[key] === 'string') ta.value = texts[key];
      });
      root.appendChild(notes);
    }
    mount(section, root);
    syncAdhoc(section, model);
    model.matrices.forEach(mx => {
      const state = stateInput(section, m, 'cells', mx.key);
      const pairs = readCells(model, mx, state);
      state.value = encodeCells(pairs);                                                             // unknown ids dropped (a stale submission)
      mx.targets.filter(t => t.ordered).forEach(t => syncOrder(section, model, mx, t, pairs, true));
    });
    if (frozen) section.querySelectorAll('input.map-state').forEach(i => { i.readOnly = true; });
    model.matrices.forEach(mx => projectMatrix(section, model, mx));
    refreshSchema(section, model);
    updateSummary(section, model);
    wireSection(section, model);
  }
  function renderMappings(root) {
    const scope = root || document;
    scope.querySelectorAll('section[data-mapping]:not([data-map-rendered])').forEach(renderSection);
    // The TOC may already be built (IIFE order): mirror the fresh progress
    // now — restoreState() returns early without a stored blob, so this is
    // the only refresh a first visit gets.
    if (typeof updateSectionNavState === 'function') updateSectionNavState();
  }
  // Re-reads every state input (restoreState() sets values without events),
  // normalises the string back, re-sets the boxes and recomputes the counts.
  function refreshMappings(root) {
    const scope = root || document;
    scope.querySelectorAll('section[data-mapping][data-map-rendered]').forEach(section => {
      const model = MODELS.get(section);
      if (!model) return;
      syncAdhoc(section, model);                                                                       // before the cells: `u2>…` must resolve
      model.matrices.forEach(mx => {
        const state = stateInput(section, model.id, 'cells', mx.key);
        const pairs = readCells(model, mx, state);
        const enc = encodeCells(pairs);
        if (state.value !== enc) state.value = enc;
        mx.targets.filter(t => t.ordered).forEach(t => syncOrder(section, model, mx, t, pairs, true));
        projectMatrix(section, model, mx);
      });
      refreshSchema(section, model);                                                                    // re-applies the restored ui mode too
      updateSummary(section, model);
    });
    if (typeof updateSectionNavState === 'function') updateSectionNavState();                          // TOC progress mirror after a restore
  }

  // --- payload (§ Payload) ---------------------------------------------------
  function parseUi(value) {
    const out = {};
    String(value || '').split(';').forEach(kv => { const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1); });
    return out;
  }
  function collectMappings(scope) {
    const root = scope || document;
    const out = [];
    root.querySelectorAll('section[data-mapping][data-map-rendered]').forEach(section => {
      const model = MODELS.get(section);
      if (!model || section.querySelector('.map-error') || section.dataset.mapFrozen === 'true') return;   // a past round is never a current decision
      const m = model.id;
      const entry = { id: m, label: section.dataset.navLabel || m };
      const view = section.closest('section[data-view]');
      if (view) {
        entry.view = view.dataset.view;
        if (view.dataset.viewFor) entry.design = view.dataset.viewFor;
      }
      const ui = parseUi(([...section.querySelectorAll('input.map-state')].find(i => i.id === 'map-' + m + '-ui') || {}).value);
      entry.mode = !model.hasElements ? 'matrix' : (ui.mode === 'matrix' ? 'matrix' : 'schema');
      entry.assigned = {};
      entry.order = {};
      entry.diff = [];
      model.matrices.forEach(mx => {
        const pairs = readCells(model, mx, stateInput(section, m, 'cells', mx.key));
        entry.assigned[mx.key] = pairs.map(p => [p[0], p[1]]);
        mx.targets.filter(t => t.ordered).forEach(t => {
          const checked = pairs.filter(p => p[1] === t.key).map(p => p[0]);
          const input = stateInput(section, m, 'order', orderKey(mx, t));
          entry.order[orderKey(mx, t)] = splitOrder(input.value).filter(id => checked.includes(id));
        });
        const wrap = matrixEl(section, mx.key);
        if (!wrap) return;
        wrap.querySelectorAll('input[data-map-cell]').forEach(cb => {
          const proposed = cb.dataset.proposed === '1';
          if (cb.checked === proposed) return;
          const parts = cb.dataset.mapCell.split('>');
          const d = { item: parts[0], target: parts[1] };
          if (mx.ctx) d.ctx = mx.ctx;
          d.proposed = proposed; d.now = cb.checked;
          entry.diff.push(d);
        });
      });
      const anywhere = assignedAnywhere(section, model);
      entry.unassigned = model.items.filter(i => !anywhere.has(i.id)).map(i => i.id);
      entry.violations = violationsOf(section, model);
      let adhoc = [];
      const adhocInput = [...section.querySelectorAll('input.map-state')].find(i => i.id === 'map-' + m + '-adhoc');
      if (adhocInput) { try { adhoc = JSON.parse(adhocInput.value || '[]'); } catch { adhoc = []; } }
      entry.adhocItems = Array.isArray(adhoc) ? adhoc : [];
      const noteEl = view ? document.querySelector('[data-comment="view-' + view.dataset.view + '"]')
                          : section.querySelector('[data-comment="map-' + m + '-note"]');
      entry.note = noteEl ? String(noteEl.value || '').trim() : '';
      entry.slotNotes = {};
      section.querySelectorAll('[data-comment^="map-' + m + '-note-"]').forEach(ta => {
        const text = String(ta.value || '').trim();
        if (text) entry.slotNotes[ta.dataset.comment.slice(('map-' + m + '-note-').length)] = text;
      });
      out.push(entry);
    });
    return out;
  }

  window.renderMappings = renderMappings;
  window.refreshMappings = refreshMappings;
  window.setCell = setCell;
  window.collectMappings = collectMappings;
  window.mappingProgress = mappingProgress;
})();
```

