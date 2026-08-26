# Concept — Question Views, Screen Annotations & Universal Attachments

*Date: 2026-08-24 · Skill: `plugins/devops/skills/concept`*

Supersedes one explicit non-goal of
[2026-08-03 — Per-Iteration Layout & Fullscreen Design Mode](2026-08-03-concept-per-iteration-design-mode-design.md).

## Problem

A `design` iteration can today hold only one kind of thing: mockups. Everything
else the round needs — "which of these two card densities do you want?", "tabs
or drawer for the second level?" — has nowhere to go inside that iteration.

Three consequences, all observed in practice:

1. **Questions get deferred to a separate `decision` iteration.** The user
   answers them one round later, out of sight of the artefact they are about.
2. **Comparisons have no home at all.** The decision template's six content
   variants cover question/answer evaluation (`comparison` is a *criteria
   matrix over abstract options*), not "here are two concrete component ideas
   side by side, which one".
3. **Element-level questions are homeless.** When Claude needs to ask about one
   specific button in one specific screen, the only channel is the general
   feedback dock — the question loses its anchor, and the user has to describe
   in prose which element was meant.

Two smaller gaps, same area:

4. Attachments exist (`§ Comment Attachments`) but only on decision-template
   comment slots, and only for four image MIME types. The design template's
   feedback dock — the primary feedback surface of a design round — cannot take
   a file at all.
5. The feedback dock has two fixed widths (420 / 560 px). Writing more than a
   short remark in it is unpleasant, and there is no way to trade design
   real-estate for writing room.

The 2026-08-03 spec listed *"No variant tri-state inside the design layout —
non-visual decisions belong in a decision iteration, not squeezed into the
overlay panel"* as a non-goal. That reasoning holds only for its own premise:
squeezing a decision into the **360px overlay panel**. It does not hold for a
decision that gets the **whole viewport**, exactly like a design does.

## Goal

Inside one `design` iteration, alongside **at least one** fullscreen design,
Claude may place **any number of additional question views** — each a
first-class, fullscreen view with its own entry in the iteration's table of
contents, switched exactly like a design.

Two view kinds ship as templates:

| Kind | For |
|---|---|
| `decision` | A question with 2..n named alternatives, each evaluated bi-state, plus notes |
| `comparison` | 2..n concrete component/idea candidates side by side, optional criteria matrix, verdict |

Independently of that, a design screen may carry an **annotation layer**:
numbered pins on concrete elements, each with a question and an inline answer
field. Fully hideable via one eye control, so the screen can also be enjoyed
untouched.

Both are **optional**. A design iteration with one screen, no questions and no
annotations stays exactly what it is today.

## Non-goals

- No new *iteration* template. Question views live **inside** a `design`
  iteration; `decision` and `free` iterations are unchanged.
- No runtime layout maths for annotations. The bubble side is authored, not
  computed.
- No change to the iteration/tab model, the submit protocol, or the durability
  contract — payload additions are additive, and every new field is optional.
- Annotations are not a general commenting system: Claude authors the
  questions, the user answers them. No user-created pins.

---

## Architecture

### 1. Views as first-class children of a design iteration

Top-level children of `section[data-iteration][data-iteration-template="design"]`
become a **heterogeneous list**:

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

Invariants:

- **≥1 `data-design` is mandatory.** Views never stand alone — an iteration
  that is only questions is a `decision` iteration, not a `design` one.
- Exactly one top-level item is active at a time: either a design carrying
  `data-design-active="true"` or a view carrying `data-view-active="true"`.
  Every other top-level item is `hidden`.
- `data-view` ids are unique page-wide, like screen ids.
- A view is **scrollable**; a design screen is not. `body` keeps
  `overflow: hidden`; the active view scrolls inside its own box.
- The active top-level item survives a reload, like the active screen already
  does. Every iteration append reloads the page; landing back in design mode
  while the user was halfway through answering a question view is exactly the
  kind of small loss that makes a page feel unreliable.

Navigation — the iteration's table of contents (`#screen-nav` in the ☰ panel)
gains a second group below the designs group. The top-centre switcher lists
designs and views as one row of segments, separated by a divider, so switching
is one click from anywhere.

The screen indicator shows the view label instead of screen counters while a
view is active.

### 2. View kind `decision`

Reuses the decision template's proven mechanics rather than inventing new ones:
a `[data-decision]` group per alternative, bi-state (`Miteinbeziehen` /
`Verwerfen`), and the mandatory per-decision note textarea injected by
`ensureCommentSlots()`. What changes is only the frame: fullscreen, no sidebar,
authored freely above and between the alternatives.

### 3. View kind `comparison` — mandatory skeleton, free interior

Deliberately loose. Mandatory:

- a heading stating the question,
- ≥2 `article[data-compare-option]`, each with a title and a free body,
- a verdict control (bi-state per option; an additional "favourite" radio is
  allowed),
- one note textarea per option and one for the view as a whole, all
  `data-attachable`.

Optional and freely combinable: criteria matrix, per-criterion weights,
pros/cons lists, meta chips, live mockup fragments reusing `.device-frame`,
a "no preference" escape. Layout hint via `data-compare-layout`.

Options are a CSS-grid `repeat(auto-fit, minmax(280px, 1fr))`, so 2–4 candidates
sit side by side and wrap instead of shrinking below readability.

### 4. Annotation layer on design screens

```html
<div class="anno-layer" data-anno-layer>
  <div class="anno" data-anno="a1" data-anno-side="right"
       style="--anno-x:62.5%;--anno-y:31.2%">
    <button class="anno-pin" data-anno-pin="a1" aria-expanded="false"
            aria-controls="anno-bubble-a1">1</button>
    <div class="anno-bubble" id="anno-bubble-a1" data-anno-bubble="a1" data-open="false">
      … question · answer textarea (data-attachable) · attach slot …
    </div>
  </div>
</div>
```

- Position in **percentages of the screen box**, so it survives every viewport.
- `data-anno-side` is authored, never computed — no collision solver.
- Collapsed bubble = one truncated line + chevron. Expanded = full question,
  answer field, attachments.
- An answered pin is visually distinct (`data-answered="true"`).
- The answer textarea carries `data-comment="anno-{id}"`, which makes the
  existing `saveState()`/`restoreState()` persist it with zero extra code.

**The eye pill** sits on the left edge directly below the screen indicator —
*not* in the top-left corner, which the indicator already owns. It shows the
number of open questions on the active screen, hides the entire layer when
toggled, and stays visible as the only remnant so the layer can be brought
back. The state is global and persisted.

The two FABs are untouched: ☰ panel and 💬 feedback dock keep working
independently, whether the annotation layer is shown or hidden.

### 5. Universal attachments

Any `textarea[data-attachable]` gets an attachment bar — feedback dock (all
levels), annotation answers, comparison and decision notes. Three input paths,
all equivalent: drag & drop, `Ctrl+V`, and a file-picker button.

The durability contract from `§ Comment Attachments` is preserved verbatim:
**upload on attach, never on submit**, two independent copies (IndexedDB blob
written *before* the network call, fsynced content-addressed file on disk),
sha256 content addressing making every retry idempotent, unsynced blobs
re-uploaded by `restoreAttachments()` on every reconnect.

Extensions:

- **Any file type.** The acceptance allowlist is dropped. Safety moves to the
  serving side: only the four image types are served inline; everything else is
  `application/octet-stream` + `Content-Disposition: attachment` + `nosniff`.
  This is strictly safer than the old SVG ban, which only ever protected the
  inline path.
- **Streaming upload.** Base64-in-JSON inflates 4/3 and buffers the whole file;
  it stays as a fallback but the primary path streams the raw blob with the
  filename in a header, hashed and written chunk-wise.
- **Limits raised** to 256 MiB per file / 4 GiB per store, both configurable,
  with a free-disk check that refuses rather than corrupting the store.
- **`attachments/index.json`** maps the content hash back to the original
  filename — otherwise a `sha256.pdf` on disk tells Claude nothing.

Known ceiling, stated rather than hidden: video and audio can be stored and
referenced but not interpreted.

### 6. Dock sizing

`applyDockSize()`'s compact/wide automation stays, and gains a **user override**
on top: a maximise control in the dock header expands it to
`min(1100px, 100vw - 4rem)` with taller textareas, and back. The override is
persisted and wins over the automatic sizing until the user releases it.

---

## Data contract

Additive only. A design iteration's payload gains three optional members:

```json
{
  "template": "design",
  "iteration": 3,
  "decisions": [ { "id": "nav-tabs", "label": "Tabs", "evaluation": "include", "view": "nav-model" } ],
  "annotations": [
    { "id": "a1", "screen": "d1-s1", "design": "dispatch",
      "question": "Two buttons or one?", "answer": "One." }
  ],
  "comments": {
    "general": "…",
    "designs": { "dispatch": "…" },
    "screens": { "d1-s1": "…" },
    "views":   { "card-density": "…" }
  },
  "attachments": {
    "anno-a1": [ { "id": "…", "name": "sketch.png", "mime": "image/png", "size": 1234, "path": "…" } ],
    "general": [ … ]
  }
}
```

`evaluation` (`include` / `discard`) is the field name and vocabulary the
decision template already uses everywhere; question views match it rather than
inventing a second spelling for the same thing.

Attachments are one flat map keyed by slot — `general`, `design-{id}`,
`{screenId}`, `view-{id}`, `anno-{id}`, `{decisionId}-note` — rather than
duplicated into every typed structure that could carry a file. The decision
template keeps its existing inline `comments[].attachments` shape unchanged.

`decisions` was always `[]` for design iterations and now carries the
evaluations authored inside question views — each tagged with its `view` id so
Claude knows which question it answers. Consumers that ignore unknown members
are unaffected.

## Risks

| Risk | Mitigation |
|---|---|
| Freeze sweep kills view/annotation navigation on an earlier tab | Extend the existing exemption list; a frozen design iteration must stay fully browsable, textareas `readonly` not `disabled` |
| Dock textarea rebuild orphans attachment bars | Attachment state is keyed by slot in a Map that outlives the DOM; re-render after every dock rebuild |
| 256 MiB uploads block the single-threaded submit path | Streaming write, chunked hashing, per-chunk cap check, guaranteed temp cleanup on abort |
| `localStorage` quota exceptions killing every input handler | The three unguarded `setItem` call sites get try/catch with a visible warning |
| Question views make design iterations a dumping ground | ≥1 design remains mandatory; a question-only round is still a `decision` iteration |
