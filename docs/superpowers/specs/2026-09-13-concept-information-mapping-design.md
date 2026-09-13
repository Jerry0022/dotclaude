# Concept — Information Mapping (items → targets, schematic + matrix)

*Date: 2026-09-13 · Skill: `plugins/devops/skills/concept`*

Builds on [2026-08-24 — Question Views, Screen Annotations & Universal Attachments](2026-08-24-concept-design-question-views-design.md)
and keeps its non-goal "no new iteration template".

## Problem

A concept round often ends with *"which of these many things goes where"*: 40 entity fields
onto the parts of a list card and its detail tabs, 30 requirements onto 6 release trains,
permissions onto roles, features onto platforms. Today's toolkit has no home for that:

- `decision` cards evaluate alternatives (include / discard per card). 40 items are not 40
  alternatives, and a card cannot say *where* an item goes.
- The `comparison` view's `cmp-matrix` is options × criteria with a rating — a judgement, not
  an assignment — it lives only inside a design round, and its controls are explicitly untyped.
- A `free` round can hold a hand-written table of checkboxes. It persists and ships, but as flat
  `allFields` booleans Claude has to reverse-engineer: no proposal, no diff, no "unassigned"
  list, nothing Step 5b can branch on. And 40 × 15 hand-written cells is exactly where a
  mis-numbered column hides from the validation gate.

So the user writes prose ("VIN in the header, status as badge, …") and Claude parses prose.

## Goal

A **mapping**: Claude proposes an assignment of many **items** to a set of **targets**; the user
corrects it in either of two synchronized views — a **schematic view** (targets drawn as
labelled UI elements composed of slots, "at first glance" and "after click" side by side) and a
**matrix view** (items × targets, one matrix per extra dimension) — and submits it. The payload
carries the final assignment, the diff against Claude's proposal, what is unassigned and which
constraints are violated — typed, in every template's payload.

A mapping is a **subpage** inside a design iteration (next to the mockups and the
decision / comparison views) and a **block** inside a free iteration. Like every other subpage
it is a recommendation, never a must.

## Decisions taken with the user (2026-09-13)

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | **Content, not layout.** View kind `mapping` inside `design` iterations; block `section[data-mapping]` inside `free` iterations. No 4th iteration template. | `data-iteration-template="mapping"`: same layout, same payload, more maintenance surface, and a hole in the template-continuity rule (a mapping *tab* in a design concept swaps the 💬 dock for inline fields). View-only: no home in decision-mode concepts. |
| 2 | **Schematic view is generated** from a declarative spec by a shared renderer. | "The schematic is a design screen with anchors": tiers not side by side, unavailable in free rounds, assignment surface tied to a hand-drawn mock. A later cross-highlight between a mapping and a design screen stays possible; out of scope here. |
| 3 | **Full scope**: schematic + matrix + context tabs + proposal / diff + cardinality + order inside a slot + ad-hoc items + per-slot notes + copy-context. | Matrix-only MVP. |
| 4 | **Optional `data-view-for="{designId}"` on any view** (decision / comparison / mapping): the panel TOC lists the view under that design, the payload tags it with `design`. Absent → variant-independent, as today. | Label-only association. |
| 5 | In a design round the **dock's view-level note is the mapping note**; the inline note exists only in free-round blocks. Per-slot notes are inline in both. | Two note fields for one question. |
| 6 | The renderer block is **always copied** into every page (early return without `[data-mapping]`) — the annotation-layer / views precedent. | Conditional copy + engine-drift-list entry. |
| 7 | Settled by evidence: no drag & drop (arm-then-tap); a cell is boolean; no bi-state verdict on a mapping; tabs, not stacked matrices. | |

Checked against prior art (research, 2026-09-13): schematic + matrix switch is the established
combination (Salesforce page-layout editor + compact layout; RACI / traceability matrices);
click / toggle beats drag on speed and error rate; showing both tiers side by side goes beyond
prior art and is the part of the idea that is genuinely new.

## Non-goals

- No new iteration template; no change to the tab model or the submit protocol beyond the
  additive `mappings[]` key and `design` on view-scoped entries.
- No drag & drop, no pivoting of axes (rows are always items, columns always targets), no typed
  cells (priority, R/A/C/I — a separate named input if ever needed), no user-authored slots.
- No mapping inside `decision` rounds (layout collision with 340 px cards — a round that needs
  both becomes `free` with opt-in bi-state sections, or two rounds) and none in the final report.
- No cross-highlight between a mapping and a design screen.

---

## 1. Vocabulary and data model

| Term | Meaning | Spec field |
|---|---|---|
| **item** | one unit of information to place | `items[]: {id, label, group?, hint?, required?}` |
| **group** | optional grouping of items, collapsible in both views | `items[].group` (order of first appearance) |
| **element** | a schematic UI element (list card, detail page, form, tile…) made of parts | `elements[]: {id, label, itemTargets?, parts[]}` |
| **part / slot** | a target inside an element | `parts[]: {id, label, tier?, row?, accepts?, min?, max?, ordered?}` |
| **tier** | `"first"` (at first glance, default) or `"after"` (after click). Splits the element's parts into two side-by-side columns. A tier is an attribute of the target, not a dimension | `parts[].tier` |
| **row** | layout hint: parts sharing a row sit side by side inside their tier column; rows stack. That alone gives a card its silhouette (header + badge on row 1, line 1, line 2, footer). Default: one row per part | `parts[].row` |
| **axis** | an abstract target axis for non-UI mappings: named columns, no schematic | `axes[]: {id, label, itemTargets?, columns[]: {id, label, accepts?, min?, max?}}` |
| **target key** | `{elementId}.{partId}` or `{axisId}.{columnId}` | derived |
| **context** | optional extra dimension (device, role, screen…). Every value yields a full copy of the target set → one matrix per value | `context: {id, label, values[]: {id, label}}` |
| **cell** | item × target (× context) → boolean | rendered checkbox |
| **cardinality, target side** | `accepts: "one"` (exactly one item; checking another swaps) or `"many"` (default); `min` / `max` soft, flagged | `parts[]`, `columns[]` |
| **cardinality, item side** | per element / axis: `itemTargets: "one"` (an item goes to exactly one target there; checking another swaps along the row), `"min1"` (flag when unassigned) or `"any"` (default); `items[].required: true` flags an item that is unassigned everywhere | |
| **ordered part** | a part whose items have a meaningful order | `parts[].ordered: true` |
| **proposal** | Claude's pre-filled assignment — mandatory (empty only when Claude honestly has none) | `proposal: [[item, target, ctx?], …]`, `proposalOrder?: {"target[@ctx]": [itemIds]}` |
| **submitted** | the user's submitted state, written by Claude into the spec when the round is frozen (§ 8) | `submitted: {cells: {"matrixKey": [[item, target]…]}, order: {…}, adhoc: [labels], slotNotes: {…}}` |
| **options** | `slotNotes: true`, `adhocItems: true` (≤ 20 user-added items) | |

Rules: ids match `^[a-z0-9_]+$` (no `-`, `.`, `@`, `:`, `>` — the encodings below split on them);
item / element / axis ids unique within a mapping, part ids unique within their element;
**mapping ids unique page-wide** (they are DOM ids: the section's `id`, the TOC anchor, the
`label for`); `elements` and `axes` may coexist; at least one is required. A **matrix key** is
`{elementId|axisId}` or `{elementId|axisId}@{ctx}`. A mapping without `elements` renders the
matrix only and no view toggle.

Cleaner statement of the user's framing: *targets may be grouped hierarchically (element → part)
and tagged with a tier; any further axis is a context that yields one matrix per value; a cell is
yes / no; "once or several times" is cardinality.* An item assigned nowhere is reported
(`unassigned`), not an error — unless it is `required` or its element / axis says `min1`.

## 2. Where a mapping lives

### 2a. As a subpage of a `design` iteration

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

Everything a view already gets applies unchanged: switcher segment, `.screen-nav-view-item`,
screen indicator label, dock with general + view-level textarea (`view-fields_a` — this is the
mapping note), `_activeView` restore, view switching on frozen tabs. `.view-mapping` lifts the
frame's width (`max-width: none; padding: 1rem 1.5rem`). ≥ 1 `data-design` stays mandatory.
Views are never cloned into device-view frames (`renderDeviceStage` clones active screens only),
so ids and the JSON block inside a view are safe.

**`data-view-for` (all view kinds).** `buildSectionNav()` renders a view carrying
`data-view-for="{designId}"` as a `.screen-nav-view-item` inside that design's nav group, after
its screens; the top-centre switcher stays one flat row (the label carries the variant name).
`collectDesignDecisions()` adds `design: "{designId}"` to every `decisions[]` and `mappings[]`
entry from such a view. An unknown design id is a gate warning and falls back to the views group.

### 2b. As a block inside a `free` iteration

```html
<section data-iteration="2" data-iteration-template="free" data-active>
  <header class="iteration-intro">…</header>
  <section id="context" data-nav-label="Context">…</section>

  <section data-mapping="req_trains" id="req_trains" data-nav-label="Requirements → release trains">
    <h2>Which requirement lands in which train?</h2>
    <script type="application/json" data-mapping-spec>{ … }</script>
    <div class="field-row decision-comment-row">
      <label for="req_trains-note">{{decision.comment_label}}</label>
      <textarea id="req_trains-note" data-comment="map-req_trains-note" data-attachable rows="3"
                placeholder="{{decision.comment_placeholder}}"></textarea>
    </div>
  </section>
</section>
```

Panel TOC entry like any `section[id][data-nav-label]`, with a **progress mirror** where a
bi-state section shows its state: `31/40 · 2 ⚠` (assigned items / items · violations), refreshed
on every change. The block keeps the 1100 px column: the matrix is its own two-axis scroll box
(`max-height: 80vh`), the two tier columns fit side by side (≈ 530 px each, chips wrap).
`data-map-wide` on the section widens the whole column via
`.concept-content:has([data-map-wide]) { max-width: 1600px }` (never `100vw` — the column is
`overflow-y: auto` and would grow a horizontal bar). Claude sets it only for ≥ 20 columns.

Template pick (SKILL.md 1a) gains one sentence under step 3 (free): *"An iteration whose question
is 'which of these many items goes where' — an assignment, not a choice between alternatives — is
a `free` round carrying ≥ 1 `section[data-mapping]`; inside a design concept it is a
`data-view-kind="mapping"` subpage instead."* No new step, no new mode.

## 3. Authoring: declarative spec + shared renderer

Claude writes **only** the wrapper section, the JSON spec and (free rounds) the note textarea.
One shared engine block — `renderMappings()` and friends, copied verbatim into every page like
the annotation layer, early-returning without `[data-mapping]` — builds both views, all
matrices, the palette, the toggle, the tabs and every input. 40 × 15 hand-written cells are
600 `<td>`s whose column consistency no gate can check; a 2 KB spec is checkable, and a parse
failure renders a visible `.map-error` box (red, with the JSON error) in place of the mapping —
never a silent blank.

`<script type="application/json">` is inert and allowed anywhere except inside
`section[data-screen]` (gate P18). The deterministic gate's balance / nesting check counts it as
an ordinary open / close pair (verified in `hooks/lib/concept-gate.js`). Labels must not contain
`</script>` (the JSON block would end early; the parse then fails visibly). Locale placeholders
(`{{…}}`) never appear inside a spec — labels are content, not UI strings.

### Spec example — UI case (abridged)

```json
{
  "items": [
    {"id":"plate","label":"Licence plate","group":"Identity","required":true},
    {"id":"model","label":"Model","group":"Identity"},
    {"id":"vin","label":"VIN","group":"Identity"},
    {"id":"status","label":"Status","group":"Status"},
    {"id":"mileage","label":"Mileage","group":"Telemetry"},
    {"id":"holder","label":"Holder","group":"Ownership"}
  ],
  "elements": [
    {"id":"card","label":"List card","itemTargets":"any","parts":[
      {"id":"header","label":"header","tier":"first","row":1,"min":1},
      {"id":"badge","label":"badge","tier":"first","row":1,"accepts":"one","min":1},
      {"id":"line1","label":"line 1","tier":"first","row":2,"min":1,"ordered":true},
      {"id":"line2","label":"line 2","tier":"first","row":3,"ordered":true},
      {"id":"footer","label":"footer","tier":"first","row":4},
      {"id":"overview","label":"Tab: Overview","tier":"after","row":1},
      {"id":"history","label":"Tab: History","tier":"after","row":2},
      {"id":"docs","label":"Tab: Documents","tier":"after","row":3}
    ]}
  ],
  "context": {"id":"device","label":"Context","values":[{"id":"phone","label":"Phone"},{"id":"desktop","label":"Desktop"}]},
  "proposal": [
    ["plate","card.header","phone"], ["model","card.header","phone"], ["status","card.badge","phone"],
    ["mileage","card.line1","phone"], ["vin","card.overview","phone"], ["holder","card.overview","phone"],
    ["plate","card.header","desktop"], ["model","card.header","desktop"], ["status","card.badge","desktop"]
  ],
  "proposalOrder": {"card.line1@phone": ["mileage"]},
  "slotNotes": true,
  "adhocItems": true
}
```

### Spec example — matrix-only case (abridged)

```json
{
  "items": [
    {"id":"req01","label":"REQ-01 SSO login","group":"Requirements"},
    {"id":"rsk01","label":"RSK-01 Data migration","group":"Risks"}
  ],
  "axes": [
    {"id":"train","label":"Release train","itemTargets":"one","columns":[
      {"id":"r1","label":"R1"},{"id":"r2","label":"R2"},{"id":"r3","label":"R3"}]},
    {"id":"owner","label":"Owner","itemTargets":"min1","columns":[
      {"id":"platform","label":"Platform"},{"id":"web","label":"Web"},{"id":"mobile","label":"Mobile"}]}
  ],
  "proposal": [["req01","train.r1"],["req01","owner.platform"],["rsk01","train.r2"]]
}
```

Two axes → two matrices (tabs "Release train | Owner"), no schematic, no view toggle.

## 4. State model — DOM truth vs. persisted form

**The matrix's checkboxes are the DOM truth**; the schematic is a projection that toggles them.
But the checkboxes are **unnamed** (`data-map-cell="{item}>{target}"` only), so the generic
scans ignore them: `saveState()` skips inputs without `name`/`id`, `collectAllFormFields()`
skips unnamed controls. Persisting 40 × 15 × 2 named checkboxes was red-teamed and rejected: the
whole state blob is mirrored to the bridge on every flush (≈ 330 KB per round, cumulative), the
`sendBeacon` flush on tab close has a 64 KB limit and would fail silently, every keystroke in a
note would re-scan 6 000 nodes, and booleans break the bridge's string-only `recovered` union
(`GET /recovery` would throw).

**The persisted form is one compact string per matrix**, held in a CSS-hidden text input the
renderer creates inside the mapping section:

| Input (`type="text"`, `.map-state`, visually hidden, `tabindex="-1"`) | id | Value |
|---|---|---|
| cells | `map-{m}-cells-{matrixKey}` | space-separated `item>target` pairs of the checked cells, e.g. `plate>card.header model>card.header status>card.badge`; a deliberately empty matrix is the sentinel `-` (never `""` — the bridge's recovery union keeps only non-empty strings, and an empty string would come back as "no key" → proposal) |
| order | `map-{m}-order-{target}[@ctx]` (ordered parts only) | comma-separated item ids |
| ad-hoc items | `map-{m}-adhoc` | JSON array of labels |
| UI state | `map-{m}-ui` | `mode=schema;tab=card@phone` |

Text inputs ride the existing `text:` path unchanged: `saveState()` keys them
`text:i{N}:{id}` (iteration-namespaced), `restoreState()` applies only the live round's keys,
the bridge's durable draft mirror recovers them, `_carryOverTypedWork()` carries them across a
page-version bump, and `collectAllFormFields()` ships them in `allFields` (compact — every
assignment is still in `allFields`, just encoded). `concept-server.py` is untouched.

**Load order (every page, every iteration, frozen or live):** script order across the page's
IIFEs is not guaranteed, so `renderMappings()` is called as the **first statement of the
persistence block's own `DOMContentLoaded` handler** — the one that already runs
`ensureCommentSlots()` and then `restoreState()` — guarded with `typeof … === 'function'` like
`ensureCommentSlots`. It creates the state inputs (initialised from `submitted` on a frozen
section, else from `proposal`), renders the checkboxes from them and projects the schematic.
`restoreState()` may then overwrite a live state input's value — and **it runs three times**
(load, every `iteration:changed`, after `hydrateDraftFromBridge()`), setting values without
events — so `restoreState()` ends with a call to `refreshMappings()` (precedent:
`updateNoteMarkers()`), which re-reads every state input, re-sets the checkboxes and
re-projects. A restore never touches a state input the user has changed in this page life
(`data-touched`, § below) and never applies another round's keys (the `i{N}:` namespace), so a
frozen round's baked `submitted` state cannot be overwritten by a stale local key. Unknown item
/ target ids in a state string are dropped (a re-served round with a changed target set must
not crash or resurrect cells).

`setCell(mappingEl, itemId, targetKey, ctx, on)` — the **only** write path (schematic, matrix,
keyboard, reset, copy-context):

1. Flip the checkbox; apply cardinality swaps: `accepts: "one"` target + `on` → uncheck that
   target's previous item in this context; `itemTargets: "one"` element / axis + `on` → uncheck
   the item's previous target on that element / axis in this context. The replaced chip / cell
   flashes once, no dialog.
2. `min` / `max` / `min1` / `required` are **never blocked, always flagged** (amber / red counts,
   ⚠ on slot / column / item, summary line "9 items unassigned · line 2 empty"). Blocking
   creates dead ends while the user is still thinking.
3. Rewrite the affected state input(s); keep the order input consistent (append on check,
   remove on uncheck).
4. Stamp `data-touched` on the rewritten inputs, set `_userInteracted = true` (when defined),
   dispatch bubbling `input` and `change` events on them. Without this — red-teamed — a pure
   schematic session counts as "nothing changed" (`_userInteracted` is set from trusted events
   only), the document-level `saveState` listener never fires (non-bubbling events), and an
   emptied state string would not persist (the empty-overwrite guard requires `data-touched`).
5. Re-project: chips, counts, markers, TOC progress mirror.

Not state (in-memory only): search, filters, collapsed groups, the armed item / slot.

## 5. Rendered DOM contract

| Element | Identity | Count | Purpose |
|---|---|---|---|
| `input[type=checkbox]` | **no name / id**; `data-map-cell="{item}>{target}"`, `data-proposed="1|0"` | items × targets × contexts | DOM truth, keyboard + label semantics |
| `input[type=text].map-state` | ids per § 4 | 1 per matrix + ordered parts + adhoc + ui | persisted form, `allFields` |
| `button.map-view-toggle` × 2 | `aria-pressed` | with `elements` only | Schema \| Matrix |
| `button.map-tab` × n | `aria-pressed`, `data-map-tab="{matrixKey}"` | > 1 matrix | active matrix / context |
| `button.map-group-toggle`, `.map-filter`, `input.map-search` | | | palette / matrix controls |
| `textarea[data-comment="map-{m}-note"][data-attachable]` | **authored**, free rounds only | 1 | mapping note (design rounds: dock `view-{id}`) |
| `textarea[data-comment="map-{m}-note-{target}"]` | generated when `slotNotes` | per target (not per context) | per-slot note, revealed by ✎ |

Controls are `<button>`s, never radios: freezing is not a JS sweep but Claude's hand-edit of the
HTML plus `section[data-iteration]:not([data-active]) input { pointer-events: none }` — buttons
are untouched by that rule (like `.view-switch-item`), so a frozen mapping keeps its view toggle,
tabs, group collapse and filters. The schematic (`div.map-schema[data-map-ctx]`) and every
matrix (`div.map-matrix[data-map-matrix="{matrixKey}"]`, `hidden` when inactive — inputs must
exist regardless of what is on screen) are stateless generated DOM. The renderer **measures
nothing** (it runs while its view is `hidden`): `data-dense` (> 18 columns → vertical part
headers) is derived from the column count. The engine block is an IIFE like every other engine
block (`templates-reference.test.js` concatenates all JS blocks).

## 6. Schematic view

Rendered only when the spec has `elements`. One `.map-element` per element, stacked; with a
context axis the tabs above switch the whole schematic.

```
┌─ Vehicle · List card ──────────────────────────────── (Schema | Matrix)   Context: [Phone] Desktop ─┐
│ 9 items unassigned · line 2 empty                                                    ↺ Proposal    │
│  AT FIRST GLANCE ░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  AFTER CLICK ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│  ┌ header ················· 2 ┐ ┌ badge ·· 1/1 ┐ │  ┌ Tab: Overview ····························· 14 ┐ │
│  │ [Plate ×][Model ×]         │ │ [Status ×]   │ │  │ [VIN ×][Year ×][Holder ×][Mileage ×] … +8      │ │
│  └────────────────────────────┘ └──────────────┘ │  └───────────────────────────────────────────────┘ │
│  ┌ line 1 ······························ 2 ┐   │  ┌ Tab: History ······························· 2 ┐ │
│  │ [Location ×][Mileage ◆×]                 │   │  │ [Last service ×][Damage reports ×]             │ │
│  └──────────────────────────────────────────┘   │  └───────────────────────────────────────────────┘ │
│  ┌ line 2 ····························· 0 ⚠ ┐   │  ┌ Tab: Documents ····························· 2 ┐ │
│  │  empty – min. 1                          │   │  │ [Registration ×][Insurance ×]                  │ │
│  └──────────────────────────────────────────┘   │  └───────────────────────────────────────────────┘ │
│  ┌ footer ······························· 1 ┐   │                                                     │
│  │ [Last service ×]                         │   │                                                     │
│  └──────────────────────────────────────────┘   │                                                     │
├─ Items (40)  [Search…]  (All)(Unassigned 9)(Multiple 4)(Changed 3)                          ▴ ──────┤
│ ▾ Identity   [Plate 1×][Model 1×][VIN 1×][Year 1×][Colour ◆1×][Chassis ○] …                         │
│ ▾ Status     [Status 1×][Location 1×][Availability ○] …                                             │
│ ▾ Telemetry  [Mileage 2×][Fuel 1×][Battery ○][GPS ○] …                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
   ○ unassigned   n× assigned n times   ◆ differs from Claude's proposal   ⚠ required slot empty
```

- **Element**: caption + two tier columns side by side ("At first glance" accent-tinted band,
  "After click" neutral band); one column when every part is `first`. Below ~700 px the tiers
  stack; the page is a desktop review surface and must merely not break on smaller screens.
- **Slot**: dashed box with label, cardinality badge (`2`, `1/1`, `0 ⚠`, `4/3` red), the chips in
  order, each with ×. Parts sharing a `row` sit side by side; rows stack.
- **Palette**: sticky tray at the bottom of the mapping's scroll box (collapsible to a search
  line): search (label + group), filter pills All / Unassigned / Multiple / Changed, one
  collapsible row per group; chip = label + count badge (`○`, `1×`, `2×`), `title` lists the slots
  it is in. Bottom, not side: identical in the fullscreen view and the 1100 px column, reachable
  by thumb, keeps the element full width.
- **Interaction — "arm, then tap"**, one in-memory `armed = {kind, id}`:
  - item-first: tap a palette chip → armed (`aria-pressed`, accent ring, status line "Mileage:
    tap a slot — Esc ends"); tapping a slot (label or padding) toggles the item there; the item
    **stays armed**, so one field goes into three slots with three taps; Esc / tapping the chip
    again / tapping empty space disarms. While an item is armed a slot label **places**, it never
    arms the slot — the status line says so.
  - slot-first (nothing armed): tap a slot label → slot armed; palette chips become toggles for
    that slot.
  - remove: × on a chip inside a slot. Placing into a full `accepts: "one"` slot swaps and
    flashes the replaced chip — no dialog.
  - keyboard: chips and slot labels are `<button>`s (Enter / Space arms or places, Esc disarms —
    handled on the mapping element with `stopPropagation` when it disarmed something, so the
    panel's and the veil's Escape handlers do not fire on the same key); Delete on a slot chip
    removes it; Alt+←/→ reorders inside an ordered part.
  - touch: taps only.
- **Markers**: proposed-and-unchanged chip = faint dot; changed = ◆ + accent underline; a
  removed proposal shows as a ghost strike-through chip; armed target = solid accent border.

## 7. Matrix view

Always rendered (hidden behind the toggle while the schematic is active). One `<table>` per
matrix inside `div.map-scroll` — `overflow: auto; max-width: 100%; max-height: calc(100vh -
var(--map-chrome, 220px))` (`80vh` in the document column). Both axes scroll inside this one
box, which is what makes `position: sticky` work on the header rows and the first column at
once. The table is `width: max-content`; the page never widens.

```
Context: [Phone] Desktop   ⧉ copy Phone → Desktop      Rows: (All)(Unassigned 9)(Changed 3)     ↺ Proposal
┌──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┐
│                  │ List card                                                                     │     │
│                  │ AT FIRST GLANCE ░░░░░░░░░░░░░░░░░░░░░░░░ │ AFTER CLICK ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │     │
│ Item             │ header │ badge  │ line 1 │ line 2 │ foot │ Overview │ History │ Documents     │  Σ  │
│                  │   2    │ 1/1 ✓  │   2    │  0 ⚠   │  1   │    14    │    2    │     2         │     │
├──────────────────┼────────┼────────┼────────┼────────┼──────┼──────────┼─────────┼───────────────┼─────┤
│ ▾ Identity (6)   │        │        │        │        │      │          │         │               │     │
│   Plate          │  [■·]  │  ( )   │  [ ]   │  [ ]   │ [ ]  │   [ ]    │   [ ]   │    [ ]        │  1  │
│   VIN            │  [ ]   │  ( )   │  [ ]   │  [ ]   │ [ ]  │   [■·]   │   [ ]   │    [ ]        │  1  │
│   Colour         │  [ ]   │  ( )   │  [ ]   │  [ ]   │ [ ]  │   [■◆]   │   [ ]   │    [ ]        │ 1 ◆ │
│   Chassis        │  [ ]   │  ( )   │  [ ]   │  [ ]   │ [ ]  │   [ ]    │   [ ]   │    [ ]        │ 0 ⚠ │
│ ▸ Status (5)     │                            (collapsed: 5 items, 4 assigned)                       │
│ ▾ Telemetry (9)  │        │        │        │        │      │          │         │               │     │
│   Mileage        │  [ ]   │  ( )   │  [■◆]  │  [ ]   │ [ ]  │   [■·]   │   [ ]   │    [ ]        │  2  │
└──────────────────┴────────┴────────┴────────┴────────┴──────┴──────────┴─────────┴───────────────┴─────┘
  [■] set   ( ) exactly-one slot   · proposal, unchanged   ◆ differs from the proposal
```

- Header row 1: element (colspan = its parts) with the tier band; a second header row carries
  the tier labels when an element has parts in both tiers. Header row 2: part label + count
  (`n`, `n/1` for `accepts: one`), coloured muted / amber (under-filled required) / red
  (over-full).
- First column sticky: group rows (`<button aria-expanded>`, collapsible), item rows; last
  column `Σ` = the item's assignment count **on this matrix** (amber `0` for required items).
- Cell: `<td><label><input type="checkbox" …><span class="map-cell"></span></label></td>`; the
  whole 28 × 28 cell is the hit area; `accepts: one` columns render circles.
- Keyboard: `role="grid"`, roving tabindex, arrow keys move by cell, Space toggles, Home / End;
  focus uses `scrollIntoView({block:'nearest', inline:'nearest'})` plus `scroll-padding` on
  `.map-scroll` so a focused cell never hides under the sticky column.
- Density: rows 28 px, item column 220 px; > 18 columns → vertical part headers. 100 × 30 works
  with scrolling; groups do the vertical work.
- **Multiple matrices** (context values × elements / axes): a tab strip above the matrix, one
  `button.map-tab` per matrix, grouped when both kinds exist (`Context: Phone | Desktop` ·
  `Axis: Train | Owner`); every matrix stays in the DOM; each tab label carries a summary
  (`Owner · 6 open`) so a hidden matrix cannot be forgotten. Rejected: stacked (two 100 × 30
  walls, sticky headers of matrix 1 fight matrix 2) and an axis picker (hides that the matrices
  are independent).
- `⧉ copy {ctx} → {ctx}`: bulk `setCell()` — clears the target context first, then copies, so
  `accepts: one` swaps stay deterministic. Native `confirm()` guard.

## 8. Proposal, diff, reset, ad-hoc items, freezing

- The renderer initialises the state inputs from `proposal` and stamps `data-proposed="1|0"`
  on every cell. Restore may overwrite the state input; the stamp stays, so *changed* =
  `checked !== (data-proposed === "1")`, computed live, never stored.
- **↺ Proposal** per mapping (per active matrix when there are tabs): resets that matrix to the
  proposal; native `confirm()`. No per-cell reset — the toggle is the undo.
- **Ad-hoc items** (`adhocItems: true`): "+ item" adds a label-only item into an implicit group
  "Added by you" (ids `u1…`, ≤ 20, label ≤ 60 chars, duplicates of an existing label refused with
  an inline hint), stored in `map-{m}-adhoc`; the renderer re-creates the items and their cells
  from it on load and on `refreshMappings()`. Ad-hoc **slots: no** — a new slot is a design
  decision about the element and belongs in the note.
- **Freezing** (Step 5c, when the next round is appended): Claude writes the submitted state into
  every mapping spec of the frozen round — `"submitted": {cells, order, adhoc, slotNotes}` —
  taken 1:1 from the payload's `mappings[]` entry (`cells` grouped by matrix key exactly as the
  payload's `assigned` is). On a section without `data-active` the renderer initialises from
  `submitted`, keeps `data-proposed` from `proposal` so the ◆ markers stay visible, renders every
  checkbox `disabled` (a checkbox cannot be `readonly`), state inputs `readonly`, textareas
  `readonly` with the submitted text, hides ↺ / + item / ⧉ / chip ×, and keeps toggle, tabs,
  collapse, search and filters working (their UI state stays in memory on a frozen section —
  the `readonly` ui input is not written). A stale local key can never overwrite the baked
  submission: text keys are iteration-namespaced and `restoreState()` applies only the live
  round's. **A frozen mapping without `submitted` renders a visible `.map-error` banner**
  ("submitted state missing — showing Claude's proposal") and the deterministic gate fails the
  page: silently presenting the proposal as the user's decision is the one outcome this
  construct must never produce.

## 9. Payload

`collectDesignDecisions()` and `collectFreeDecisions()` call the shared
`collectMappings(activeSection)` and emit `mappings` (always present; `[]` when none — the
decision branch emits `[]` too, for the uniform-shape rule). `collectFreeDecisions()`'s
`[data-comment]` scan is scoped to the active iteration as part of this work (today it is
document-wide and would ship a frozen round's mapping notes as live comments — a pre-existing
defect this construct would amplify).

```json
"mappings": [{
  "id": "veh_a", "label": "Field mapping · Card A", "view": "fields_a", "design": "card_a",
  "mode": "schema",
  "assigned":   { "card@phone": [["plate","card.header"], ["status","card.badge"]],
                  "card@desktop": [["plate","card.header"]] },
  "order":      { "card.line1@phone": ["mileage","location"] },
  "diff":       [ {"item":"colour","target":"card.overview","ctx":"phone","proposed":false,"now":true},
                  {"item":"fuel","target":"card.line2","ctx":"phone","proposed":true,"now":false} ],
  "unassigned": ["chassis","battery"],
  "violations": [ {"target":"card.line2","ctx":"phone","kind":"min","have":0,"want":1},
                  {"item":"plate","kind":"required"} ],
  "adhocItems": ["Next inspection"],
  "note": "…",
  "slotNotes":  { "card.badge": "…" }
}]
```

`view` / `design` / `ctx` are present only when applicable; every other key is always present
(empty-array / empty-object convention). `assigned` is keyed by matrix key; `unassigned` means
*assigned nowhere across all matrices of the mapping*; `Σ` in the UI is per matrix. `note` is
the dock's view-level text in a design round and the inline textarea's text in a free round.
`diff` is what Claude reads first, `assigned` is the full truth, `allFields` carries the compact
state strings. Attachments on notes ride the existing `data-attachable` path.

## 10. SKILL.md changes

- **Step 1a**: the sentence under step 3 (free) quoted in § 2b; the views list in step 1 gains
  `mapping` (with `data-view-for` mentioned for all kinds); the layout-signature table stays
  three rows.
- **Step 1c (new, short) — authoring a mapping**: always pre-fill a proposal; ids per § 1; count
  preferences (recommendations, like 7 / 3): ≤ 60 items, ≤ 20 targets per matrix, ≤ 4 context
  values — split into several mappings beyond that; `tier: "after"` only for parts genuinely
  behind a click; `accepts: "one"` for single-value slots (badge, title); `elements` when the
  targets are UI, `axes` otherwise, both may coexist; a mapping subpage may name its variant
  with `data-view-for`.
- **Step 2 · Localisation**: new `map.*` keys (view toggle, tier labels, palette filters, counts,
  status line, reset, copy, add item, "Added by you", violation texts, the frozen-without-
  submitted banner) in the locale table.
- **Step 5a**: unchanged — the coverage check compares authored fields; generated inputs are
  covered by the jsdom suite instead.
- **Step 5b**: read `mappings[]` before `decisions[]`. `iterate` → the next round's proposal is
  the user's `assigned` (never re-propose what they moved away from; `diff` entries are what the
  intro acknowledges); `implement` → the assignment IS the spec: generate the component / view /
  data projection per target with exactly the assigned items in `order`; `unassigned` and
  `violations` become open questions in the final report.
- **Step 5c**: when freezing a round, write `submitted` into every mapping spec of that round
  (§ 8); the `data-frozen-feedback` blob is unchanged (the dock's view note is already covered).
- **Post-generation validation**: the conditional M-set (§ 11).

## 11. Validation gate

`validation-gate.md` P23 admits `mapping` (`data-view-kind="decision|comparison|mapping"`).
New conditional set, applied only when the page contains `[data-mapping]`:

| # | Pattern | Why |
|---|---|---|
| M1 | every `[data-mapping]` has exactly one `[data-mapping-spec]` child that parses as JSON | the renderer's input |
| M2 | ids match `^[a-z0-9_]+$`; item / element / axis ids unique per mapping, part ids per element; **mapping ids unique page-wide** | name grammar, DOM ids, TOC anchors |
| M3 | every `proposal` / `submitted` reference resolves; `ctx` present iff the spec has `context` | silent no-ops otherwise |
| M4 | ≥ 1 of `elements` / `axes`; every element ≥ 1 part; every axis ≥ 1 column | an empty mapping renders nothing |
| M5 | free-round block: `textarea[data-comment="map-{m}-note"][data-attachable]` inside the section; design-round view: no inline note | the note channel per home |
| M6 | `renderMappings`, `refreshMappings`, `setCell`, `collectMappings` present; `renderMappings` is the first call in the persistence block's `DOMContentLoaded` handler (before `ensureCommentSlots` / `restoreState`); `refreshMappings` is called at the end of `restoreState` | engine + ordering |
| M7 | `collectDesignDecisions` and `collectFreeDecisions` both contain `mappings: collectMappings(` | payload in both homes |
| M8 | `.map-scroll` rule carries `overflow: auto` and `max-width: 100%`; no `100vw` in mapping CSS | the page never widens |
| M9 | a `:not([data-active])` iteration's spec carries `submitted` | frozen round shows the submission, not the proposal |
| M10 | `data-view-for` values name a `data-design` in the same iteration (warning) | TOC grouping falls back silently otherwise |

M1–M4 and M9 are mechanical and go into `hooks/lib/concept-gate.js` (`findMappingIssues`),
so a mis-typed id or a forgotten `submitted` blocks the write deterministically instead of
relying on the manual sweep. M5–M8, M10 stay in the manual gate like their P-set siblings.

## 12. Tests

- `mapping-renderer.test.js` (jsdom, like `panel-anatomy.test.js`): render both example specs;
  DOM contract (unnamed cells, state input ids, buttons not radios); `setCell()` swap semantics
  for `accepts: one` and `itemTargets: one`; min / max flag-not-block; order input; ad-hoc item
  round-trip incl. duplicate refusal; parse error → `.map-error`; frozen render from
  `submitted`, frozen without `submitted` → banner; `collectMappings()` shape incl. `diff`,
  `unassigned`, `violations`; **restore-then-project** (set a state input, call
  `refreshMappings()`, checkboxes and chips match); after `setCell` the `text:i{N}:map-…` key
  is in the blob and `_userInteracted` is true; copy-context over an `accepts: one` slot.
- `templates-reference.test.js` keeps parsing every new block; `template-continuity.test.js`
  unchanged (no new template); `section-nav.test.js` gains `data-view-for` grouping and the
  progress mirror.
- `hooks/lib/concept-gate.test.js`: M1–M4, M9 positive and negative cases; P23 accepts
  `mapping`.
- `build-concept-fixture.js --mapping` adds one mapping subpage (design mode) or block (free
  mode) with the vehicle spec, for real-browser checks of sticky headers, tier columns, the
  palette tray and frozen-tab browsing.

## Risks

| Risk | Mitigation |
|---|---|
| A refactor moves `renderMappings()` after `restoreState()` or drops the `refreshMappings()` call | M6 pins both; the jsdom restore-then-project test fails |
| Claude forgets `submitted` when freezing | visible banner + deterministic M9 in `concept-gate.js` |
| `submitted` typed wrongly by hand | M3 resolves every reference; frozen rounds never receive local keys (iteration namespace), so the local cache cannot mask the error in the author's own browser |
| Engine block grows every page by ~30 KB | accepted (decision 6); the block early-returns without `[data-mapping]` |
| A label containing `</script>` truncates the spec | JSON parse fails visibly (`.map-error`); authoring rule in Step 1c |
| Tabs hide a matrix with violations | tab labels carry the open count; the summary line counts across matrices |
| Small viewports | tiers stack below ~700 px, the matrix stays a scroll box; desktop review surface by design |
| Duplicate mapping id across rounds | M2 page-wide uniqueness (TOC anchor, `label for`) |
