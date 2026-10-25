# Concept templates, part 33 of 41: Shared systems — collectDecisions, two-button submit (HTML, CSS)

## collectDecisions (dispatcher)

The submit handler picks the branch from the **active iteration's**
`data-iteration-template` (via `resolveIterationTemplate()`, § Tab Switch JS),
not from the `<html data-template>` projection — that projection follows the
tab the user is *looking at* and would mis-route the payload when a frozen tab
of a different template is open. An `action` (`iterate` | `implement`) is passed in from the button that was
clicked and merged into the payload.

The dispatcher ALSO runs a generic catch-all scoped to the active
iteration (`section[data-iteration][data-active]`) so every named form
element ships in `allFields`, regardless of whether the template-specific
branch was updated for new fields. This is the safety net mandated by
`validation-gate.md` § Generic Form Collection — never remove it, never
replace it with hand-listed selectors. The typed sub-objects (`decisions`,
`comments`) live alongside `allFields` for ergonomics; they do not
substitute for it.

`comments` has ONE shape in every branch — `collectComments()` below builds
it: `{ general: { text, attachments }, items: [ { id, text, attachments } ] }`.
`general` is the 💬 dock's general note (page chrome, every template) and is
always present; `items` lists every other commented field of the live round.
The design branch keeps its `designs` / `screens` / `views` maps next to
them. Note that the dock lives OUTSIDE `section[data-iteration]`, so
`allFields` (scoped to the active section) does not carry the general note —
`comments.general` is its typed home.

```javascript
function collectAllFormFields(scope) {
  const fields = {};
  // Catch-all: every named input, select, textarea inside scope.
  scope.querySelectorAll('input, select, textarea').forEach(el => {
    // Device-view frames are CLONES of the mockup (§ Responsive device views)
    // and they live inside section[data-iteration][data-active], i.e. exactly
    // this scope. Without this filter a login mock ships `email`, `dv1-email`
    // and `dv2-email` — three fields for one control, under names no human
    // ever typed into, and the panel goes green either way. The authored
    // original is untouched and still collected; only the copies are dropped.
    // Additive on purpose: the selector string above is pinned by
    // validation-gate.md pattern 21 and must stay literal.
    if (el.closest('[data-device-clone]')) return;
    // Engine stores (the variant overview's favourite + user pins,
    // § Variant overview JS) are typed into the payload by their own
    // collector; their raw JSON is not a field the user filled in.
    if (el.dataset.engineStore !== undefined) return;
    const key = el.dataset.field
             || el.dataset.v4
             || el.dataset.confirm
             || el.dataset.rename
             || el.dataset.entities
             || el.dataset.comment
             || el.name
             || el.id;
    if (!key) return;  // unnamed control — skip
    if (el.type === 'checkbox') {
      fields[key] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) fields[el.name] = el.value;
    } else {
      fields[key] = el.value;
    }
  });
  return fields;
}

// Comments in ONE shape for every template (#399):
//   { general: { text, attachments }, items: [ { id, text, attachments } ] }
// `general` is the 💬 dock's general-notes textarea (data-comment="general",
// § Panel Chrome (all templates) → Feedback dock) — ALWAYS present, empty
// strings and all, so no consumer branches on the template to find the note.
// `items` holds every other [data-comment] field that carries text or an
// attachment: the inline notes of a decision/free round, the {id}-note of a
// view decision, a mapping note, and on a design round the dock's per-design /
// per-screen / per-view rows (the design branch additionally keys those into
// its `designs` / `screens` / `views` maps).
// The dock lives OUTSIDE section[data-iteration], so the scan covers the live
// round AND the dock — never the whole document: ids repeat across rounds, and
// a frozen round's fields must not ship as this round's. The dock cannot leak
// a frozen round either: its rows are rebuilt per round (§ Layout JS) and its
// general field is stashed/restored around every frozen visit
// (applyDockFreezeState). A page that also carries an inline
// data-comment="general" (older document rounds) contributes to the same
// note — the texts are joined, nothing is dropped.
function collectComments(active) {
  const attachmentsOf = key => (typeof attachmentsFor === 'function') ? attachmentsFor(key) : [];
  const generalTexts = [];
  const items = [];
  const seen = new Set();
  const fields = [
    ...active.querySelectorAll('[data-comment]'),
    ...document.querySelectorAll('#feedback-dock [data-comment]'),
  ];
  fields.forEach(el => {
    if (seen.has(el)) return;
    seen.add(el);
    const id = el.dataset.comment;
    const text = (el.value || '').trim();
    if (id === 'general') { if (text) generalTexts.push(text); return; }
    const attachments = attachmentsOf(id);
    // An image with no prose is a complete comment — a screenshot often says
    // it better than a sentence. Gating on `text` alone (as this did before
    // attachments existed) would silently drop an image-only remark.
    if (text || attachments.length) items.push({ id, text, attachments });
  });
  return {
    general: { text: generalTexts.join('\n\n'), attachments: attachmentsOf('general') },
    items,
  };
}

function collectDecisions(action = 'iterate') {
  const active = document.querySelector('section[data-iteration][data-active]')
              || document.body;
  const allFields = collectAllFormFields(active);

  // Resolve the template from the ACTIVE iteration, never from <html>: the
  // projection there could be stale (e.g. the user is viewing a frozen tab
  // with a different layout) and would mis-route the payload.
  const template = resolveIterationTemplate(active);
  let payload;
  if (template === 'design') payload = collectDesignDecisions();
  else if (template === 'free') payload = collectFreeDecisions();
  else payload = collectDecisionDecisions();
  // Own note pins of a document round (§ Document pins); design rounds
  // build their own `userPins` in collectDesignDecisions().
  if (template !== 'design') {
    payload.userPins = (typeof window.documentPinsPayload === 'function') ? window.documentPinsPayload(active) : [];
  }
  payload.action = action;
  payload.allFields = allFields;
  // The round this payload answers. restoreInFlightRound() needs it after a
  // reload: Claude posts /reload BEFORE /reset, so the NEXT round loads while
  // this payload is still pending on the bridge — only the round number tells
  // "this round is still sent" apart from "the previous round's payload".
  payload.iteration = (active.dataset && active.dataset.iteration) || null;
  return payload;
}

// Verdict + note of one bi-state group (§ Bi-State Variant Evaluation). The
// radio ships `include` checked by default, so a group the user never touched
// still reports `include` rather than dropping out of the payload. The
// adjacent `{id}-note` textarea sits inside the group, or next to it when
// ensureCommentSlots() injected it at runtime — look inside first, then one
// level up (same lookup as the design branch's view decisions).
function getElementState(el) {
  const checked = el.querySelector('input[type="radio"]:checked');
  const noteId = `${el.dataset.decision}-note`;
  const noteEl = el.querySelector(`[data-comment="${noteId}"]`)
    || (el.parentElement && el.parentElement.querySelector(`[data-comment="${noteId}"]`));
  return {
    evaluation: checked ? checked.value : 'include',
    note: ((noteEl && noteEl.value) || '').trim()
  };
}

function collectDecisionDecisions() {
  const decisions = [];
  // Scoped to the LIVE round — decision ids and comment keys repeat across
  // rounds (same reasoning as collectFreeDecisions()).
  const active = document.querySelector('section[data-iteration][data-active]') || document;

  active.querySelectorAll('[data-decision]').forEach(el => {
    decisions.push({
      id: el.dataset.decision,
      label: el.dataset.label || '',
      ...getElementState(el)
    });
  });

  // { general: { text, attachments }, items: [ … ] } — the live round's
  // inline notes plus the 💬 dock's general note (collectComments above).
  const comments = collectComments(active);

  // `mappings` is always present (§ Information Mapping (engine), uniform
  // payload shape); the decision template hosts no mapping section.
  return { submitted: true, template: 'decision', decisions, comments, mappings: [] };
}
```

## Two-Button Submit (iterate vs. implement)

> **Since the journey row (§ Journey row below)** the two buttons below are
> adopted at boot as the halves of the round toggle and the implement
> toggle; the split/caret/menu wrapper is retired (hidden). Their ids,
> `wireSubmit` handlers, confirms and payloads are unchanged. The markup and
> menu CSS below remain as the no-JS source both skeletons share.

Every decision panel carries **two** submit actions, not one, in a
**split button**. The primary button ("Zur nächsten Runde") fills the
row and fires `action: "iterate"` — a Claude turn that never touches code.
The ▾ caret next to it opens a small menu (`#submit-menu`, `role="menu"`)
holding the secondary action ("Mit Feedback implementieren"), which fires
`action: "implement"` — a Claude turn that DOES apply real file/code
changes. The misclick barrier is the extra click plus colour + border
(warning outline, ⚠ icon), not distance: there is no `.submit-gap` anywhere
any more — the final-report close-out sheet dropped its own copy too, in
favour of the accordion rows in front of its single button (§ The close-out
sheet). The hint lines moved into `data-tip` tooltips; the one line that stays
visible is inside the menu ("Kein Code beim Primär-Button").

### HTML

```html
<div id="panel-ready">
  <div id="decision-summary"><!-- auto-summary --></div>

  <div class="submit-split">
    <!-- Primary: safe, never implements. The hint is its tooltip; the cache
         badge inside it shows only while disconnected (_setCacheHints). -->
    <button id="submit-iterate-btn" class="primary submit-btn" data-tip="{{panel.submit_iterate_hint}}">
      <span class="submit-label">{{panel.submit_iterate}}</span>
      <span class="hint-cache" data-cache-hint="iterate" hidden>
        <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
      </span>
    </button>
    <!-- Caret: opens the menu. aria-expanded mirrors the menu's [hidden]. -->
    <button type="button" id="submit-menu-btn" class="submit-menu-btn"
            aria-haspopup="menu" aria-expanded="false" aria-controls="submit-menu"
            aria-label="{{panel.submit_menu}}" data-tip="{{panel.submit_menu}}">
      <span aria-hidden="true">▾</span>
    </button>
  </div>

  <!-- One level deeper: the explicit implementation commit. Opens UPWARD
       over the status line; Escape / outside click closes it. -->
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
```

### CSS

```css
.submit-btn, .implement-btn {
  width: 100%;
  padding: 0.8rem 1rem;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 0.5rem;
}
.submit-btn {
  border: none;
  background: var(--accent-color, #58a6ff);
  color: white;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Split button: primary + caret share one rounded pill. */
.submit-split { display: flex; align-items: stretch; margin-top: 0.4rem; }
.submit-split .submit-btn {
  flex: 1 1 auto;
  min-width: 0;
  margin-top: 0;
  padding: 0.65rem 0.9rem;
  border-radius: 10px 0 0 10px;
  display: flex; flex-direction: column; align-items: center; gap: 0.1rem;
}
.submit-menu-btn {
  flex: none;
  width: 2.5rem;
  margin-top: 0;
  border: none;
  border-left: 1px solid color-mix(in srgb, #fff 28%, transparent);
  border-radius: 0 10px 10px 0;
  background: var(--accent-color, #58a6ff);
  color: white;
  font-size: 1rem;
  cursor: pointer;
}
.submit-menu-btn:hover,
.submit-menu-btn[aria-expanded="true"] { filter: brightness(1.15); }
/* position: absolute, with `.concept-decision-panel` (already `position:
   fixed`, § Panel Chrome) as its containing block — NOT `.panel-cta`, which
   deliberately stays un-positioned (see the comment on `.panel-cta` above)
   so its own `overflow-y: auto` foot-safety-net cannot clip this popover.
   #367 (two rounds): a first fix made the menu `position: fixed` anchored to
   the VIEWPORT, sampled from the split button's rect once at open time —
   that broke on the design layout, where the panel can still be mid
   slide-in transition when the caret is clicked, so the sampled viewport
   rect went stale the instant the transition finished and the menu opened
   up to 400px off-screen. Anchoring to the panel instead means the menu
   moves WITH the panel for free (it is laid out relative to the same
   containing block), so no re-sampling on transition is needed — only on
   open and on resize. wireSubmitMenu() computes left/width/bottom relative
   to the panel from both rects sampled in the same frame (see JS). */
.submit-menu {
  position: absolute;
  z-index: 5;
  padding: 0.6rem;
  border-radius: 10px;
  border: 1px solid var(--warning-color, #d29922);
  background: var(--panel-bg, #161b22);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.submit-menu[hidden] { display: none; }
.submit-menu .implement-btn { margin-top: 0; }
.submit-menu-hint {
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  margin: 0.4rem 0 0;
}

.implement-btn {
  background: transparent;
  color: var(--warning-color, #d29922);
  border: 1px solid var(--warning-color, #d29922);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.implement-btn:hover {
  background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent);
}
.implement-btn .warn-icon { font-size: 1rem; }
.hint-warn { color: var(--warning-color, #d29922); }

/* Durability warning strip — shown when a submission or an attachment did
   not reach the bridge's durable store. Deliberately loud: a silent failure
   here is the exact bug the store exists to remove. */
.submit-warning {
  display: none;
  margin: 0 0 .75rem;
  padding: .5rem .7rem;
  border: 1px solid var(--warning-color, #d29922);
  border-left-width: 3px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--warning-color, #d29922) 12%, transparent);
  color: var(--text-primary);
  font-size: .8rem;
  line-height: 1.4;
}
```

