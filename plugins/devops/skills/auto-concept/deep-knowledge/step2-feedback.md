# Concept step 2 — feedback surfaces, persistence, file location

Feedback dock, annotation layer, views, reload resilience, comment durability, page version, feedback mechanism, file naming and iteration tabs — execution detail of `SKILL.md` Step 2, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Feedback dock, persistence, feedback mechanism

### Feedback Dock (all templates)

A **speech-bubble feedback dock** anchored to the 💬 FAB (bottom-right) is
page chrome on every concept page (#399), like the ☰ panel: the same markup
(`templates-common.md` § Common Structure, § Panel Chrome (all templates) → Feedback
dock) on a `decision`, `free` and `design` round. In a **document round** it
holds exactly one thing — the general-notes textarea with its attachment
slot — and renders `compact`; the itemised notes of such a round are the
inline `textarea[data-comment]` fields next to the cards. Every payload
carries the note the same way: `comments.general = { text, attachments }`,
next to `comments.items[]` for the itemised fields (§ Feedback Mechanism below).

The **design template** has no tri-state on its screens. Its dock holds the
structured feedback instead, ordered **specific → general, top to bottom**:

- One textarea per `<section data-screen>` inside the active design,
  auto-populated by the dock (label = `data-nav-label` of that screen) — first
- One textarea per `data-design` (only when the iteration has ≥2 designs) —
  second
- The general-notes textarea that stays visible regardless of the active
  screen — last, because it is the one field that never disappears or
  changes label as the user navigates (and the one field every other
  template's dock has too)

While a view is active (§ Views (optional) below), the design and per-screen
rows are replaced by a single per-view textarea, so the visible order
becomes view → general.

The dock is toggled via the 💬 FAB and starts **collapsed** — the artefact,
not an empty form, is what a concept opens on. The FAB stays visible AND
clickable while the dock is open (clicking it toggles closed again). The
close button is a **minimise** (`−`), not a destroy: text content stays
intact in `localStorage` when the dock is closed.

Both FABs are labelled by **tooltip only** (`data-tip` + `aria-label` from the
locale table, swapped between the open and close wording as the control
toggles) — no visible text, because a label inside the button would break the
shared circle. The 💬 FAB additionally carries `data-untouched="true"` for a
one-shot attention pulse (box-shadow/scale only, suppressed under
`prefers-reduced-motion`) that the JS clears on the first dock open or the
first keystroke inside the dock.

**Fixed chrome geometry — do not restyle per page.** Both FABs are one 60px
accent circle differing only in glyph and corner, and the open dock has
exactly two widths (compact 420px / wide 560px, picked by `applyDockSize()`).
Copy these verbatim; hand-tuning them per concept is what made the two FABs
different sizes and the dock alternately a mini-box and a full-width bar. See
`deep-knowledge/templates-panel.md` § Panel Chrome (all templates) for the dock's
HTML/CSS/JS and the geometry rationale, and § Template: design for the
per-screen / per-design / per-view rows only a design round adds.

### Annotation Layer (optional)

A second, independent feedback channel for the design template: instead of
(or alongside) the dock's free-form notes, pin a numbered question directly
onto a concrete element of a screen — "should this list auto-refresh?", "is
this the right empty state?" — and the user answers it right there, next to
the thing it's about. **Every component-level question goes here — top 3 to
top 7 per design (Step 0.5 count preferences), ranked by how much the answer
changes the design.** Pins carry questions, not decoration: a pin with no
real question behind it is noise, and a component question carried off into
a view or a `decision` round is the reverse mistake — the user has to answer
it away from the thing it is about. A design with genuinely nothing
element-level to ask simply has no `[data-anno-layer]` — nothing degrades,
nothing is missing — but that is the exception, not the default.

- A pin sits on the element, connected by a short leader line to a speech
  bubble beside it. Collapsed, the bubble shows a truncated question line;
  clicking it (or the pin) expands to the full question, an answer
  textarea, and an attachment bar — any file type, drag & drop / Ctrl+V /
  picker, same as every other feedback field (`deep-knowledge/templates-attachments.md`
  § Attachments).
- The **eye pill** (top-left, directly below the screen-position indicator)
  toggles the whole layer for the whole page. It looks like a pin with an
  eye inside (struck through while hidden) and is the only thing left
  visible once the layer is hidden, so the user can always bring it back.
- **The ☰ and 💬 FABs are completely unaffected** — they keep working
  exactly as before, independently of whether the annotation layer is shown
  or hidden. The feedback dock stays the normal, always-available way to
  leave general notes.

See `deep-knowledge/templates-design.md` § Annotation Layer (optional) for the
full HTML/CSS/JS reference, the payload shape (`annotations[]`), and how a
frozen iteration keeps its annotations browsable and read-only.

### Views (optional)

A third, independent thing a `design` iteration may hold: fullscreen,
**general** questions — ones that do not point at any one design or any
one component of it — that still belong in the SAME round as the artefact
they sit next to — `section[data-view]`, a top-level sibling of `section[data-design]`,
switched exactly like a design (its own switcher segment, its own second
`#screen-nav` group). Two kinds: `data-view-kind="decision"` (2..n named
alternatives, bi-state per alternative) and `data-view-kind="comparison"`
(2..n concrete candidates side by side, verdict per option, optional
criteria matrix — mandatory skeleton, free interior). See § Step 1a above
for when to use a view instead of a separate `decision` iteration, and
`deep-knowledge/templates-design.md` § Views (optional) for the full HTML/CSS/JS
reference and the payload shape (`decisions[].view`, `comments.views`).
**≥1 `data-design` stays mandatory** — views augment a design iteration,
they never replace it. **And a view never re-asks the design choice** — the
alternatives of a view are orthogonal to the designs on the same page (1a
§ Orthogonality); which design wins is read from the dock's per-design
notes, not from a view that lists the designs again.

### Reload Resilience

The HTML page MUST persist interactive element state via `localStorage` (with
a 24-hour TTL) so that user selections survive page reloads, accidental tab
closes, and even browser restarts. Include the state persistence pattern from
`deep-knowledge/templates-persistence.md` § State Persistence in every generated concept
page. Theme preference is also persisted to prevent flash.

The `concept-submitted` class is NOT persisted — after a reload the page is
back to "not yet submitted" (correct behavior, the user can re-submit).

### Comments are never lost — the one non-negotiable

A concept round is hours of the user's thinking, typed into a page. Losing it
is the worst thing this skill can do, and it is worse than every rendering
defect combined, so the persistence engine is copied **verbatim** from
`templates.md` — never abbreviated, never "simplified for this page".

Four properties carry the guarantee (gate entries 49–53,
`deep-knowledge/validation-gate.md`):

1. **Nothing deletes the state blob.** No `localStorage.removeItem(STORAGE_KEY)`
   anywhere — not on TTL expiry, not on a page-version change, not on a panel
   reset. Stale state is pruned key by key; typed text is always kept.
2. **Typed keys are namespaced per round** (`text:i3:d1-s1`), so the shared
   feedback dock cannot show or overwrite one round's notes under another's.
3. **A frozen round is never persisted**, so browsing an earlier tab — which is
   what the tabs are for — cannot write its submitted answers over the live
   round's unsent ones.
4. **Every autosave is mirrored to the bridge** (`POST /draft`, fsynced before
   the ack, append-only log). That is the copy that survives a power cut, a
   wiped browser profile, and a Claude that has stopped answering mid-round.

When a user reports missing comments, the first action is always
`GET /draft?slug={slug}` and reading `recovered` back to them — never asking
them to retype. See `deep-knowledge/monitoring.md` § failure table.

### Page Version Tag

Set `data-page-version="{timestamp}"` on the `<html>` element (use the
ISO timestamp of generation, e.g. `2026-04-15T14:30:00`). This value is
stored alongside localStorage state. When the page version changes (new
generation), the stale half of the stored state (checkbox states, navigation
positions) is dropped so the user sees a clean new version instead of stale
selections from a previous page — but **everything the user typed is carried
over and restored**, with a strip on the page saying so, and the original blob
is archived under `{key}-archive`. A version bump is a reason to discard
selections, never a reason to discard comments.

**Rules:**
- Every iteration append (Step 5c): keep the SAME `data-page-version`
  → user selections on earlier frozen tabs survive the reload
- A fresh `data-page-version` is only ever set if the user explicitly
  starts a brand-new concept session for the same slug (rare — usually
  a new date means a new file anyway)

Additionally, the offline submit queue (`localStorage` key `{slug}-pending`)
caches decisions submitted while Claude is disconnected and auto-delivers
them when the connection is restored (see `templates-submit.md` § Offline Submit Queue).

### Feedback Mechanism

The HTML page MUST include a feedback data layer:

```html
<!-- Hidden container for structured decisions -->
<script type="application/json" id="concept-decisions">
  { "submitted": false, "decisions": [], "comments": { "general": { "text": "", "attachments": [] }, "items": [] } }
</script>
```

The submit button collects all interactive element states into this JSON
and adds the CSS class `concept-submitted` to `<body>`. This is the
signal Claude monitors.

**Submit button behavior:**
1. Collect all toggle/checkbox states → `decisions[]`
2. Collect all comment field values → `comments` = `{ general: { text, attachments }, items: [ { id, text, attachments } ] }` — the 💬 dock's general note plus every itemised field of the live round, the same shape in every template (design adds `designs` / `screens` / `views`)
3. Set `submitted: true` in the JSON block
4. Add classes `concept-submitted` and `content-dimmed` to `<body>` and
   reveal `#content-dimmer` so the content area visually fades. The decision
   panel + FABs sit at higher z-index and stay clear + interactive. The
   dimmer is click-to-dismiss; otherwise it auto-clears on the next page
   reload (next iteration / final report). The same dimmer doubles as the
   **frozen veil**: `showIteration()` re-arms it on every non-live tab and
   shows the `#frozen-bar` floating pill with a back-to-live button (see
   `deep-knowledge/iteration-rules.md` § Rules, "Veil + floating bar").
5. Switch the decision panel from "ready" to "submitted" state — showing a
   clear "Entscheidungen übermittelt" indicator with a hint to switch to the
   Claude chat (see `deep-knowledge/templates-submit.md` § Submit Handler)

**Decision panel states** (the foot + the pinned status line above it):
- **Ready**: split button active, decision summary visible; the status line
  reads "✓ Gespeichert · verbunden" (or "… Speichert" while the draft mirror
  flushes, "◐ Gespeichert · verbinde…" before the first heartbeat)
- **Disconnected**: the buttons stay ENABLED (a click is cached and delivered
  on reconnect, the cache badge on the button says so); the status line flips
  to the one categorically different state, "⚠ Nur lokal gespeichert ·
  getrennt" on a warning background (Claude heartbeat stale or three failed
  draft flushes — see `deep-knowledge/templates-utilities.md` § Claude Connection
  Heartbeat)
- **Submitted**: "Entscheidungen übermittelt" + "Wechsle zum Claude Chat"
  hint in the foot; the status line reads "⏳ Übermittelt · Claude arbeitet"
  with one progress dot per step (the step list expands under it)
- **Frozen** (any non-live tab): `#panel-frozen` with the back-link; the
  status line reads "🕘 Iteration N · nur lesen"
- After Claude processes and resets the page → back to **Ready**

## File naming and iteration tabs

**Fixed naming pattern** (both segments mandatory, in this order):

| Segment | Format | Example |
|---------|--------|---------|
| `{timestamp}` | ISO date `YYYY-MM-DD` | `2026-04-12` |
| `{slug}` | kebab-case topic summary, max 40 chars | `auth-middleware-redesign` |

Full example: `docs/concepts/2026-04-12-auth-middleware-redesign.html`

- Create the `docs/concepts/` directory if it doesn't exist
- The directory is git-tracked by default, but **individual concept files
  default to discard**. See § Disposition Control in
  `deep-knowledge/templates.md` and Step 6a. Concepts are project artifacts
  only when the user explicitly chooses "Im Projekt behalten" on the
  final-report panel; the default cleanup deletes both HTML and decisions
  JSON. Power users may also opt for "Nur lokal / .gitignore" to keep
  files locally without polluting the repo
- **One file per concept session** — all iterations live inside the same
  HTML file as separate `<section data-iteration="N">` blocks, switched via
  tabs in the decision panel (see "Iteration Tabs" below). There are no
  `-v2`, `-v3` files.
- If a file for the same slug already exists on the same day and the user
  starts a genuinely new topic, append a short disambiguator (e.g.
  `…-auth-middleware-redesign-2.html`) — do NOT treat this as a version bump.

### Iteration Tabs (single file, many iterations)

Every concept page is a stack of iteration tabs. The tab bar lives at the
**top of the right-side decision panel** (compact vertical chip list) —
NOT in the left-hand content area. Only the active iteration accepts input;
earlier ones are clickable but frozen. See `deep-knowledge/iteration-rules.md`
for the full rules (panel placement, freeze behavior, single-file invariant)
and `deep-knowledge/templates-rounds.md` § Iteration Tabs for the reference HTML.
