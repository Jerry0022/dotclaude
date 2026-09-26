# Concept templates, part 08 of 16: Template: free

# Template: free

The same document layout as `decision`, but the body is Claude-authored free
content: analysis, walkthrough, brainstorm, explainer, timeline. Tri-state
evaluation is **opt-in** per section — Claude adds it only where it makes
sense.

## Layout — Document, freeform body

Identical to the decision layout (§ Layout — Document rounds: content column,
☰ overlay panel). The difference is in the body: no forced variant-card
framing, no mandatory bi-state. Claude chooses the structure that fits the
content.

```html
<html data-template="free">
<body>
  <div class="concept-layout">
    <div class="concept-content">
      <header>
        <h1>{title}</h1>
        <p class="subtitle">{optional}</p>
        <!-- no controls here — the theme toggle sits in the ☰ panel head -->
      </header>
      <main>
        <section data-iteration="1" data-iteration-template="free" data-active>
          <header class="iteration-intro">
            <h2>Iteration 1 · {subject}</h2>
            <p>Short intro paragraph.</p>
          </header>

          <!-- Freeform body. Every nested <section id data-nav-label> gets
               a scroll anchor in the panel TOC. A section becomes "evaluable"
               by adding an eval-{id} radio group inside it (optional). -->
          <section id="context" data-nav-label="Context">
            <p>…</p>
          </section>

          <section id="finding-1" data-nav-label="Finding: latency spike">
            <p>…</p>
            <!-- OPT-IN bi-state: only present when Claude wants the user to
                 confirm the finding is valid. Section id MUST match the
                 radio name suffix (eval-{id}). -->
            <div class="tri-state-group">
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="discard">
                <span class="tri-state-label">Verwerfen</span>
              </label>
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="include" checked>
                <span class="tri-state-label">Miteinbeziehen</span>
              </label>
            </div>
            <textarea data-comment="finding-1" placeholder="Anmerkung…"></textarea>
          </section>

          <section id="recommendation" data-nav-label="Recommendation">
            <!-- plain section, no bi-state — just content -->
            <p>…</p>
          </section>
        </section>
      </main>
    </div>

    <aside class="concept-decision-panel" id="decision-panel">
      <!-- Same structure as decision, including the .panel-head row
           (#theme-toggle + #panel-close). Panel TOC auto-detects which
           sections have eval-{id} radios and mirrors their current state. -->
    </aside>
    <!-- Page chrome, not design-only — see § Panel Chrome (all templates). -->
    <button id="panel-toggle" class="panel-fab"
            aria-label="{{panel.toggle_open}}"
            data-tip="{{panel.toggle_open}}"
            aria-expanded="false"
            data-label-open="{{panel.toggle_open}}"
            data-label-close="{{panel.toggle_close}}">☰</button>
    <div class="panel-backdrop" id="panel-backdrop"></div>
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

## Mapping block (optional)

A `free` round whose question is *"which of these many items goes where"* —
an assignment, not a choice between alternatives — carries ≥ 1
`section[data-mapping]` in its body. It is the same construct as the design
template's `data-view-kind="mapping"` view (§ View kind `mapping`), rendered
by the same engine (§ Information Mapping (engine)) from the same JSON spec;
the only authored difference is the **inline note textarea**, which a view
does not have because the dock provides it there.

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

**Rules:**
- **The inline note is mandatory** in a free-round block:
  `textarea[data-comment="map-{m}-note"][data-attachable]` inside the
  section (gate rule M5, validation-gate.md § Mappings). `collectMappings()` reads it into the
  entry's `note`; it also arrives in `comments.items[]` like every other
  `[data-comment]` of the live round, and attachments ride the existing
  `data-attachable` path. Per-slot notes (`slotNotes: true`) are generated
  by the engine, not authored.
- **Panel TOC entry** like any `section[id][data-nav-label]`, plus a
  **progress mirror** where a bi-state section shows its verdict:
  `31/40 · 2 ⚠` (assigned items / items · open constraints), refreshed
  after every cell write and every restore (§ Section Navigation,
  `updateSectionNavState()` → `mappingProgress()`).
- **Width.** The block keeps the 1100 px column: the matrix is its own
  two-axis scroll box (`max-height: 80vh` in the document column) and the
  two tier columns fit side by side (chips wrap). `data-map-wide` on the
  section widens the whole column via
  `.concept-content:has([data-map-wide]) { max-width: 1600px }` — never
  `100vw`, the column is `overflow-y: auto` and would grow a horizontal
  bar. Set it only for ≥ 20 columns.
- Ids and uniqueness as in § View kind `mapping`: `^[a-z0-9_]+$`, mapping
  ids unique page-wide, `data-mapping` = `id`.
- **Row filter.** A matrix-only block (`axes`, no schematic) has no palette,
  so the toolbar's row-filter pills (All / Unassigned / Changed, with live
  counts) are its only narrowing: they hide the rows — and whole groups —
  that fail the pill, in every matrix tab. In-memory only; the frozen block
  keeps them.
- **Never inside a `decision` round** (layout collision with the 340 px
  variant cards) **and never in the final report.** A round that needs
  both an assignment and verdicts becomes a `free` round with opt-in
  bi-state sections, or two rounds.
- The block is a section with content, not a bi-state section: it carries
  no `eval-{id}` radios and produces no `decisions[]` entry — its result is
  the `mappings[]` entry (§ Decision schema below).
- Freezing (Step 5c): Claude writes the payload's `mappings[]` entry back
  into the spec as `submitted` (§ Information Mapping (engine) →
  Freezing); the frozen block then shows the submission read-only. The
  note textarea is frozen like every other comment of that round
  (`iteration-rules.md` § Freezing Design Iterations).

## Optional bi-state auto-detection

The section nav auto-detects whether a `<section data-nav-label>` contains an
`eval-{id}` radio group and mirrors its current state (Miteinbeziehen /
Verwerfen). Sections without a radio group just get a scroll anchor. See
Shared Systems § Section Navigation for the implementation.

## Decision schema

The free template emits **only the sections that actually have bi-state
radios**, plus whatever comments the user typed — inline notes under
`items`, the 💬 dock's general note under `general` (same shape as every
other template, § collectDecisions (dispatcher)):

```json
{
  "template": "free",
  "decisions": [
    { "id": "finding-1", "label": "Finding: latency spike", "evaluation": "include" }
  ],
  "comments": {
    "general": { "text": "...", "attachments": [] },
    "items": [
      { "id": "finding-1", "text": "...", "attachments": [] },
      { "id": "recommendation", "text": "...", "attachments": [] }
    ]
  },
  "mappings": []
}
```

If no section has bi-state markers, `decisions` is an empty array and the
submit payload is effectively a general-notes post (`comments.general`).
`mappings` is always present — `[]` without a mapping block, otherwise one entry per live
`section[data-mapping]` in the shape documented under § Template: design →
Decision schema (`note` = the inline `map-{m}-note` text here; no `view` /
`design` keys in a free round).

## collectDecisions (free branch)

```javascript
function collectFreeDecisions() {
  // Both scans are scoped to the LIVE round: section ids, eval-{id} names and
  // data-comment keys repeat across rounds, so a document-wide scan shipped a
  // frozen round's verdicts and notes as this round's — and a frozen mapping
  // section carries a `map-{m}-note` textarea of its own.
  const active = document.querySelector('section[data-iteration][data-active]') || document;
  const decisions = [];
  active.querySelectorAll('section[id][data-nav-label]').forEach(sec => {
    const radio = sec.querySelector(`input[name="eval-${CSS.escape(sec.id)}"]:checked`);
    if (!radio) return;
    decisions.push({
      id: sec.id,
      label: sec.dataset.navLabel || sec.id,
      evaluation: radio.value
    });
  });
  // { general: { text, attachments }, items: [ … ] } — the live round's
  // inline notes plus the 💬 dock's general note (§ collectDecisions
  // (dispatcher), collectComments).
  const comments = collectComments(active);
  // Mappings (§ Information Mapping (engine)); `[]` without the engine block.
  // `window.` on purpose: a bare `typeof collectMappings` here hits the TDZ of this very const.
  const collectMappings = (typeof window.collectMappings === 'function') ? window.collectMappings : () => [];
  return { submitted: true, template: 'free', decisions, comments, mappings: collectMappings(active) };
}
```

---

