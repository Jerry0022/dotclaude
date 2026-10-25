# Concept templates, part 20 of 41: Template: free

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
            <h2>{{iteration.tab}} 1 · {subject}</h2>
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
            <textarea data-comment="finding-1" placeholder="Notiz…"></textarea>
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
    <span class="frozen-bar-text">🕘 <strong data-frozen-bar-title>{{iteration.tab}} 1</strong> {{frozen.bar_hint}}</span>
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

## Report / audit rounds — overview with recommendation (mandatory)

A `free` round that closes out an analysis — a report, audit, review or
findings round with several evaluable items, not a prototype and not a pure
choice between alternatives — opens with an **overview table** that lists
every evaluable item with:

- a **recommendation column** (`Empfehlung` / `Recommendation`): whether and
  when to tackle it (e.g. wave 1 / wave 2 / your action / drop), and
- a **jump link** (`<a href="#{section-id}">`) to the item's own section with
  its bi-state and note field.

Every **additional decision** of the round (a choice that is not one of the
items — a radio group, a number, a PR split) gets its own row in a second
table of the same style directly below, again with recommendation and jump
link. Item ids stay round-unique (`r2-v1`) so the links never hit a frozen
round.

Why: the user reads the overview first and starts writing into the general
note of the 💬 dock — and only further down finds that every item already has
a recommendation, a verdict and its own note field, so the general note has to
be moved item by item. The table shows that up front.

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

## Document pins — own notes in decision / free rounds (`wireDocumentPins()`)

The document-round counterpart of the design round's own Ctrl + click pins
(§ Variant overview JS, "User pins"). In a `decision` or `free` round
(never the final report, never a design round) **Ctrl + click** — a long
press (~500 ms) on touch — on a paragraph, list item or table row sets the
user's own note pin there. The pin looks and behaves like the design pin
(same `.upin*` classes: note field, Enter saves, Esc discards, delete,
📎 attachments); only the host differs — a `.dpin-layer` inside the round
section, positioned by measuring the block, so the document flow is never
touched. **Pins are not draggable** in a document (the anchor is the block).

- **Anchor** (what survives a rebuild of the round): `anchor = { section,
  kind, index, ref?, text }` — `section` is the id of the nearest
  `section[id]` inside the round (`''` = the round itself), `kind` is
  `p` / `li` / `tr`, `index` the block's position among the eligible blocks
  of that kind in that section, `ref` the block's own `id` (when the author
  gave it one), `text` its first 80 normalised characters. Resolving tries
  `ref`, then `index` + matching `text`, then the first block with the same
  `text`, then `index` alone; a pin whose block is gone sits at the top of
  its section (`data-orphan`). A `p` / `li` inside a table cell anchors to
  its row. Blocks inside links, buttons, fields, labels, `summary`,
  device clones and engine stores are never targets (Ctrl + click there
  keeps its native meaning).
- **Engine store.** The live round's pins live in a hidden
  `textarea#doc-pins-store[data-engine-store="doc-pins"]` (direct child of
  the live `section[data-iteration]`, created at boot) holding
  `{"pins":[…]}` — the same path as the design store: persisted by
  `saveState()`, mirrored to the bridge draft, restored by `restoreState()`
  (which calls `window.refreshDocumentPins()`), skipped by
  `collectAllFormFields()`. Pin shape = the design pin plus the anchor:
  `{ id, design: '', screen: <section id>, x, y, target, text, anchor }`
  (`x` / `y` = percent of the block's box).
- **Payload.** `collectDecisions()` adds `userPins[]` to every non-design
  payload (`[]` when there are none) via `window.documentPinsPayload()`:
  the pins with text, each with `attachments` (slot `upin-ta-<id>`).
- **Frozen rounds** read `userPins` from `data-frozen-feedback`
  (`concept-build.js bake` writes it) and render the pins read-only in that
  round's section; entries without an `anchor` (design pins) are ignored.
- **Eye + Alt.** `#dpin-eye` (shown once any pin exists) toggles
  `body.anno-hidden` like the design eye and persists with it. Holding Alt
  shows the same badge overlay as everywhere, plus the example pin
  "Ctrl + click" (`wireChromeHotkeys()`, via `window.documentPinsActive()`).
  While Ctrl is held a hint pill names the gesture.

```javascript
(function wireDocumentPins() {
  const L = {
    ctrl: '{{design.key_ctrl}}', hint: '{{doc.pin_hint}}', label: '{{design.upin_label}}',
    placeholder: '{{design.upin_placeholder}}', keys: '{{design.upin_keys}}', del: '{{design.upin_delete}}',
    show: '{{anno.toggle_show}}', hide: '{{anno.toggle_hide}}'
  };
  const body = document.body;
  const BLOCK = 'p, li, tr';
  const NATIVE = 'a, button, input, select, textarea, label, summary, [contenteditable=""], [contenteditable="true"]';
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const iterations = () => [...document.querySelectorAll('section[data-iteration]')];
  const liveIt = () => document.querySelector('section[data-iteration][data-active]');
  const isLive = it => !!(it && it.hasAttribute('data-active'));
  const templateOf = it => (typeof resolveIterationTemplate === 'function' ? resolveIterationTemplate(it) : (it.dataset.iterationTemplate || 'decision'));
  const isDocIt = it => !!it && !it.hasAttribute('data-final-report') && templateOf(it) !== 'design';
  window.documentPinsActive = () => isDocIt(liveIt());

  // ── Store ────────────────────────────────────────────────────────────
  const EMPTY = () => ({ pins: [] });
  const storeOf = it => (it ? it.querySelector(':scope > textarea[data-engine-store="doc-pins"]') : null);
  function ensureStore(it) {
    if (!isLive(it) || !isDocIt(it) || storeOf(it)) return;
    const ta = document.createElement('textarea');
    ta.id = 'doc-pins-store';
    ta.dataset.engineStore = 'doc-pins';
    ta.hidden = true;
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    it.appendChild(ta);
  }
  function normalise(list) {
    return (Array.isArray(list) ? list : []).filter(p => p && typeof p.id === 'string' && p.anchor && typeof p.anchor === 'object')
      .map(p => ({
        id: p.id, design: '', screen: String(p.screen || ''), x: Number(p.x) || 0, y: Number(p.y) || 0,
        target: String(p.target || ''), text: String(p.text || ''),
        anchor: {
          section: String(p.anchor.section || ''), kind: String(p.anchor.kind || 'p'), index: Number(p.anchor.index) || 0,
          ref: p.anchor.ref ? String(p.anchor.ref) : '', text: String(p.anchor.text || '')
        }
      }));
  }
  function readPins(it) {
    if (!it) return [];
    if (!isLive(it)) {
      const node = it.querySelector(':scope > script[type="application/json"][data-frozen-feedback]');
      if (!node) return [];
      try { return normalise((JSON.parse(node.textContent) || {}).userPins); } catch (e) { return []; }
    }
    const ta = storeOf(it);
    if (!ta || !ta.value) return [];
    try { return normalise((JSON.parse(ta.value) || {}).pins); } catch (e) { return []; }
  }
  function writePins(it, pins) {
    ensureStore(it);
    const ta = storeOf(it);
    if (!ta) return;
    ta.value = JSON.stringify({ pins: normalise(pins) });
    ta.setAttribute('data-touched', 'true');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    try { _userInteracted = true; } catch (e) { /* not initialised yet */ }
    render();
  }
  window.documentPinsPayload = function(it) {
    const r = it || liveIt();
    return readPins(r).filter(p => p.text.trim()).map(p => ({
      id: p.id, design: '', screen: p.screen, x: p.x, y: p.y, target: p.target, text: p.text.trim(), anchor: p.anchor,
      attachments: (typeof attachmentsFor === 'function') ? attachmentsFor('upin-ta-' + p.id) : []
    }));
  };

  // ── Anchors ──────────────────────────────────────────────────────────
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  // A row reads cell by cell ("stop.flow.guard | hoch"), not run together.
  const textOf = n => (n.tagName === 'TR' ? [...n.children].map(c => c.textContent).join(' | ') : n.textContent);
  const eligible = (n, it) => it.contains(n) && !n.closest('.dpin-layer, [data-device-clone], [data-engine-store], script, template');
  const scopeOf = (n, it) => {
    const s = n.parentElement && n.parentElement.closest('section[id]');
    return s && s !== it && it.contains(s) ? s : it;
  };
  const blocksOf = (scope, it, kind) =>
    [...scope.querySelectorAll(kind)].filter(n => eligible(n, it) && scopeOf(n, it) === scope);
  function blockOf(target, it) {
    let b = target.closest && target.closest(BLOCK);
    if (!b || !eligible(b, it)) return null;
    const row = b.closest('tr');
    if (row && b !== row && b.closest('td, th') && eligible(row, it)) b = row;
    return b;
  }
  function anchorOf(block, it) {
    const scope = scopeOf(block, it);
    const kind = block.tagName.toLowerCase();
    return {
      section: scope === it ? '' : scope.id, kind,
      index: Math.max(0, blocksOf(scope, it, kind).indexOf(block)),
      ref: block.id || '', text: norm(textOf(block))
    };
  }
  function resolve(it, a) {
    if (a.ref) {
      const byId = [...it.querySelectorAll('[id]')].find(n => n.id === a.ref);
      if (byId) return byId;
    }
    const scope = a.section ? [...it.querySelectorAll('section[id]')].find(n => n.id === a.section) : it;
    if (!scope) return null;
    const list = blocksOf(scope, it, a.kind);
    let hit = list[a.index];
    if (hit && norm(textOf(hit)) === a.text) return hit;
    hit = list.find(n => norm(textOf(n)) === a.text);
    return hit || list[a.index] || scope;
  }
  function describe(block) {
    const text = norm(textOf(block)).slice(0, 40);
    const s = block.tagName.toLowerCase();
    return text ? s + ' "' + text + '"' : s;
  }

  // ── Rendering ────────────────────────────────────────────────────────
  let draft = null;           // { pin, it } until saved or discarded
  let placed = [];            // [{ wrap, pin, it }]
  const watched = new WeakSet();
  const pct = (v, lo, size) => Math.round(Math.min(100, Math.max(0, ((v - lo) / size) * 100)) * 10) / 10;
  function place() {
    placed.forEach(({ wrap, pin, it }) => {
      const block = resolve(it, pin.anchor);
      const ir = it.getBoundingClientRect();
      const r = block ? block.getBoundingClientRect() : null;
      if (!r || !ir.width || !r.width) { wrap.hidden = true; return; }
      wrap.hidden = false;
      wrap.dataset.orphan = block.tagName.toLowerCase() !== pin.anchor.kind ? 'true' : 'false';
      wrap.style.setProperty('--upin-x', Math.round(r.left - ir.left + (pin.x / 100) * r.width) + 'px');
      wrap.style.setProperty('--upin-y', Math.round(r.top - ir.top + (pin.y / 100) * r.height) + 'px');
    });
  }
  function placeEditor(wrap) {
    const ed = wrap.querySelector('.upin-editor');
    if (!ed || ed.hidden) return;
    delete wrap.dataset.flipX;
    delete wrap.dataset.flipY;
    let r = ed.getBoundingClientRect();
    if (r.right > innerWidth - 8) { wrap.dataset.flipX = 'true'; r = ed.getBoundingClientRect(); }
    if (r.bottom > innerHeight - 8 && r.height < wrap.getBoundingClientRect().top) wrap.dataset.flipY = 'true';
  }
  function setEditing(wrap, on) {
    if (on) wrap.dataset.editing = 'true'; else delete wrap.dataset.editing;
    body.dataset.noteEditing = document.querySelector('.dpin-layer .upin[data-editing]') ? 'true' : 'false';
  }
  const slotOf = id => 'upin-ta-' + id;
  function savePin(it, pin, text) {
    const t = String(text || '').trim();
    const pins = readPins(it);
    const i = pins.findIndex(p => p.id === pin.id);
    if (!t) { if (i >= 0) pins.splice(i, 1); }
    else if (i >= 0) pins[i].text = t;
    else pins.push({ ...pin, text: t });
    if (draft && draft.pin.id === pin.id) draft = null;
    writePins(it, pins);
  }
  function discardDraft() { draft = null; render(); }
  function closeEditors(except) {
    document.querySelectorAll('.dpin-layer .upin-editor').forEach(x => {
      if (x === except || x.hidden) return;
      const wrap = x.closest('.upin');
      const ta = x.querySelector('textarea');
      const live = ta && !ta.readOnly;
      const id = wrap && wrap.dataset.upinId;
      if (live && draft && draft.pin.id === id) { if (ta.value.trim()) savePin(draft.it, draft.pin, ta.value); else draft = null; }
      else if (live) {
        const it = wrap.closest('section[data-iteration]');
        const p = readPins(it).find(q => q.id === id);
        if (p && ta.value.trim() !== p.text.trim()) savePin(it, p, ta.value);
      }
      x.hidden = true;
      if (wrap) setEditing(wrap, false);
    });
    if (typeof window.closeAnnoBubbles === 'function') window.closeAnnoBubbles();
  }
  function pinNode(it, pin, k, live, isDraft) {
    const wrap = el('div', 'upin');
    wrap.dataset.upinId = pin.id;
    wrap.dataset.dpin = 'true';
    const label = L.label.replace('{n}', String(k));
    const btn = el('button', 'upin-pin');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.dataset.tip = pin.text || label;
    const ed = el('div', 'upin-editor');
    ed.hidden = !isDraft;
    ed.appendChild(el('div', 'upin-editor-head', label));
    const ta = el('textarea');
    ta.id = slotOf(pin.id);
    ta.setAttribute('data-attachable', '');
    ta.placeholder = L.placeholder;
    ta.value = pin.text;
    ta.readOnly = !live;
    ta.setAttribute('aria-label', label);
    ed.appendChild(ta);
    const slot = el('div', 'attach-slot');
    slot.dataset.attachSlot = slotOf(pin.id);
    const foot = el('div', 'upin-editor-foot');
    foot.appendChild(el('span', 'upin-editor-keys', live ? L.keys : ''));
    foot.appendChild(slot);
    if (live && !isDraft) {
      const del = el('button', 'upin-delete', L.del);
      del.type = 'button';
      del.addEventListener('click', () => savePin(it, pin, ''));
      foot.appendChild(del);
    }
    ed.appendChild(foot);
    wrap.append(btn, ed);
    if (isDraft) wrap.dataset.editing = 'true';
    btn.addEventListener('click', () => {
      const wasHidden = ed.hidden;
      closeEditors(ed);
      if (!wasHidden) { ed.hidden = true; setEditing(wrap, false); return; }
      // Committing another editor re-rendered the layer: open the fresh node.
      const w = ed.isConnected ? wrap : [...document.querySelectorAll('.dpin-layer .upin')].find(n => n.dataset.upinId === pin.id);
      const e2 = w && w.querySelector('.upin-editor');
      if (!e2) return;
      e2.hidden = false;
      setEditing(w, true);
      placeEditor(w);
      w.querySelector('textarea').focus();
    });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isDraft) discardDraft();
        else { ta.value = pin.text; ed.hidden = true; setEditing(wrap, false); btn.focus(); }
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (live) savePin(it, pin, ta.value); else { ed.hidden = true; setEditing(wrap, false); }
      }
    });
    ed.addEventListener('focusout', e => {
      if (!live || ed.contains(e.relatedTarget)) return;
      setTimeout(() => {
        if (ed.contains(document.activeElement) || !ed.isConnected) return;
        if (isDraft) { if (ta.value.trim()) savePin(it, pin, ta.value); else discardDraft(); }
        else if (ta.value.trim() !== pin.text.trim()) savePin(it, pin, ta.value);
      }, 0);
    });
    return { wrap, ta };
  }
  const eye = (() => {
    const b = el('button', 'dpin-eye');
    b.id = 'dpin-eye';
    b.type = 'button';
    b.hidden = true;
    b.innerHTML = '<svg class="anno-eye-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
      + '<svg class="anno-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>';
    b.addEventListener('click', () => {
      body.classList.toggle('anno-hidden');
      if (body.classList.contains('anno-hidden')) closeEditors(null);
      syncEye();
      if (typeof saveState === 'function') saveState();
    });
    body.appendChild(b);
    return b;
  })();
  function syncEye() {
    const off = body.classList.contains('anno-hidden');
    const text = off ? L.show : L.hide;
    eye.setAttribute('aria-pressed', String(!off));
    eye.setAttribute('aria-label', text);
    eye.dataset.tip = text;
  }
  function render() {
    document.querySelectorAll('.dpin-layer').forEach(n => n.remove());
    placed = [];
    let total = 0;
    const toFocus = [];
    iterations().forEach(it => {
      const live = isLive(it) && isDocIt(it);
      const pins = readPins(it);
      const showDraft = live && draft && draft.it === it;
      if (!pins.length && !showDraft) return;
      if (it.getClientRects().length) total += pins.length;   // the eye answers for what is on screen
      it.classList.add('dpin-host');
      const layer = el('div', 'dpin-layer');
      pins.forEach((p, i) => {
        const n = pinNode(it, p, i + 1, live, false);
        layer.appendChild(n.wrap);
        placed.push({ wrap: n.wrap, pin: p, it });
      });
      if (showDraft) {
        const n = pinNode(it, draft.pin, pins.length + 1, true, true);
        layer.appendChild(n.wrap);
        placed.push({ wrap: n.wrap, pin: draft.pin, it });
        toFocus.push(n);
      }
      it.appendChild(layer);
      if (typeof ResizeObserver === 'function' && !watched.has(it)) {
        watched.add(it);
        new ResizeObserver(() => place()).observe(it);
      }
    });
    eye.hidden = total === 0 || document.documentElement.dataset.template === 'design';
    syncEye();
    place();
    // The attachment engine is a later part of the script: before it has run
    // (first boot render) there is nothing to wire yet.
    try { if (typeof initCommentAttachments === 'function') initCommentAttachments(); } catch (e) { /* not initialised yet */ }
    toFocus.forEach(n => { placeEditor(n.wrap); n.ta.focus(); });
  }
  window.refreshDocumentPins = render;
  ['resize', 'load'].forEach(ev => window.addEventListener(ev, place));
  document.addEventListener('iteration:changed', () => requestAnimationFrame(render));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);

  // ── Ctrl + click (and long press) ────────────────────────────────────
  let hint = null;
  const fieldFocused = t => !!(t && t.closest && t.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"], #feedback-dock, .anno-bubble, .upin-editor'));
  function armed(on) {
    body.classList.toggle('dpin-armed', on);
    if (!on) { if (hint) hint.hidden = true; return; }
    if (!hint) {
      hint = el('div', 'dpin-hint');
      hint.setAttribute('role', 'status');
      hint.append(el('kbd', 'app-kbd', L.ctrl), document.createTextNode(' ' + L.hint));
      body.appendChild(hint);
    }
    hint.hidden = false;
  }
  const usable = () => {
    const it = liveIt();
    return isDocIt(it) && !body.classList.contains('viewing-frozen') ? it : null;
  };
  document.addEventListener('keydown', e => {
    if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat && usable() && !fieldFocused(e.target)) armed(true);
  });
  document.addEventListener('keyup', e => { if (e.key === 'Control' || e.key === 'Meta') armed(false); });
  window.addEventListener('blur', () => armed(false));
  document.addEventListener('pointermove', e => { if (body.classList.contains('dpin-armed') && !e.ctrlKey && !e.metaKey) armed(false); });
  document.addEventListener('click', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const it = usable();
    if (!it || !it.contains(e.target)) return;
    if (e.target.closest('.upin, .dpin-layer, ' + NATIVE)) return;
    const block = blockOf(e.target, it);
    if (!block) return;
    const r = block.getBoundingClientRect();
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    ensureStore(it);
    if (body.classList.contains('anno-hidden')) { body.classList.remove('anno-hidden'); if (typeof saveState === 'function') saveState(); }
    closeEditors(null);
    const a = anchorOf(block, it);
    draft = {
      it, pin: {
        id: 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        design: '', screen: a.section, x: pct(e.clientX, r.left, r.width || 1), y: pct(e.clientY, r.top, r.height || 1),
        target: describe(block), text: '', anchor: a
      }
    };
    render();
  }, true);
  const LONG_PRESS_MS = 500, LONG_PRESS_SLOP = 10;
  let lp = null, swallowClickUntil = 0;
  const cancelLongPress = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
  document.addEventListener('pointerdown', e => {
    cancelLongPress();
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const it = usable();
    if (!it || !it.contains(e.target) || e.target.closest('.upin, .dpin-layer, ' + NATIVE) || !blockOf(e.target, it)) return;
    const x = e.clientX, y = e.clientY, target = e.target;
    lp = { x, y, timer: setTimeout(() => {
      lp = null;
      swallowClickUntil = Date.now() + 1500;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, ctrlKey: true, view: window }));
    }, LONG_PRESS_MS) };
  }, true);
  document.addEventListener('pointermove', e => {
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) cancelLongPress();
  }, true);
  ['pointerup', 'pointercancel', 'scroll'].forEach(t => document.addEventListener(t, cancelLongPress, true));
  document.addEventListener('contextmenu', e => { if (lp || Date.now() < swallowClickUntil) e.preventDefault(); }, true);
  document.addEventListener('click', e => {
    if (e.isTrusted && Date.now() < swallowClickUntil) { swallowClickUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Boot: the store exists before restoreState() (a later part) fills it; the
  // first render waits for DOMContentLoaded, when every part of the script ran.
  iterations().forEach(ensureStore);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
```

```css
/* ── Document pins (decision / free rounds) ── same pin look as the design's
   own pins (.upin*); the host is a layer inside the round section. */
.dpin-host { position: relative; }
.dpin-layer { position: absolute; inset: 0; pointer-events: none; z-index: 30; }
.dpin-layer .upin-pin { cursor: pointer; touch-action: manipulation; }
.dpin-layer .upin[hidden] { display: none; }
.dpin-layer:has(.upin[data-editing="true"]) { z-index: 45; }
.dpin-layer .upin[data-orphan="true"] .upin-pin { opacity: 0.6; }
body.dpin-armed section[data-iteration][data-active] :is(p, li, tr) { cursor: crosshair; }
body.anno-hidden .dpin-layer, body.anno-hidden .dpin-hint { display: none !important; }
.dpin-hint {
  position: fixed; left: 50%; bottom: 2rem; transform: translateX(-50%); z-index: 99;
  padding: 0.4rem 0.9rem; border-radius: 999px; white-space: nowrap; max-width: calc(100vw - 12rem);
  overflow: hidden; text-overflow: ellipsis;
  background: color-mix(in srgb, var(--panel-bg, #0d1117) 92%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent-color, #58a6ff) 60%, transparent);
  color: var(--text-color, #c9d1d9); font-size: 0.82rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.dpin-hint[hidden] { display: none; }
body:has(.draft-offline-strip:not([hidden])) .dpin-hint { bottom: 4.75rem; }
/* The eye: shaped like the annotation eye of design rounds, left of the ☰ FAB. */
.dpin-eye {
  position: fixed; top: 2.9rem; right: 6.6rem; z-index: 96; box-sizing: border-box;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  color: var(--accent-color, #58a6ff);
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 20%, var(--panel-bg, #161b22));
  box-shadow: 0 0 14px color-mix(in srgb, var(--accent-color, #58a6ff) 32%, transparent);
  transition: opacity 0.15s, transform 0.15s;
}
.dpin-eye:hover { transform: scale(1.08); }
.dpin-eye[hidden], html[data-template="design"] .dpin-eye { display: none; }
.dpin-eye svg { width: 15px; height: 15px; display: block; }
.dpin-eye .anno-eye-off { display: none; }
.dpin-eye:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
body.anno-hidden .dpin-eye { color: var(--text-secondary, #8b949e); opacity: 0.75; }
body.anno-hidden .dpin-eye .anno-eye-on { display: none; }
body.anno-hidden .dpin-eye .anno-eye-off { display: block; }
body.panel-open .dpin-eye { opacity: 0; pointer-events: none; }
```

---

