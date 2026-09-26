# Concept templates, part 14 of 16: Shared systems — collectDecisions, two-button submit, reset, progress

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

Every decision panel carries **two** submit actions, not one, in a
**split button**. The primary button ("Zur nächsten Iteration") fills the
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

### JS

```javascript
let _submittedAt = 0;
// Reload counter captured at submit time. The panel only flips back to
// "ready" via _processed_at when the server's reload counter has advanced
// past this — i.e. Claude has actually written the new iteration. Without
// this gate, /reset stamps _processed_at while Claude is still mid-write
// and the user sees re-enabled buttons on the still-active old iteration.
let _submittedReloadCounter = null;
let _submitInFlight = false;
// Action picked at submit time ("iterate" | "implement"). Drives whether
// the third progress step ("Implementierung abgeschlossen") is shown.
// Reset on restorePanelToReady.
let _submittedAction = null;
// Tracks whether the user has actually changed any field in the active
// iteration. restoreState() and DOMContentLoaded fire change/input events
// that are NOT user-driven, so we gate on event.isTrusted to ignore them.
// Reset to false on iteration-switch / reload — collectDecisions still
// ships the full payload, but submitWithAction asks for confirmation if
// the user clicks submit without having touched anything.
let _userInteracted = false;
function _markUserInteracted(e) {
  if (e && e.isTrusted) _userInteracted = true;
}
document.addEventListener('change', _markUserInteracted, true);
document.addEventListener('input', _markUserInteracted, true);
document.addEventListener('iteration:changed', () => { _userInteracted = false; });

const _emptyConfirmKey = {
  iterate: 'panel.empty_iterate_confirm',
  implement: 'panel.empty_implement_confirm'
};

function wireSubmit(btnId, action) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => submitWithAction(action));
}

async function submitWithAction(action) {
  // Belt-and-suspenders guard: if a submission is already in flight (panel
  // shows "submitted"), ignore further clicks. restorePanelToReady() resets
  // _submittedAt to 0, so this only blocks while we're actually waiting.
  if (_submitInFlight || _submittedAt) return;

  // Empty-submit guard: if the user clicks submit without having modified
  // any field in the active iteration, ask before sending. Avoids burning
  // a Claude turn on accidental clicks. Implement ALWAYS confirms — it is the
  // one action that writes code — but never twice: the empty-submit wording
  // already says so when nothing was changed.
  if (!_userInteracted) {
    const msg = (action === 'implement')
      ? '{{panel.empty_implement_confirm}}'
      : '{{panel.empty_iterate_confirm}}';
    if (!window.confirm(msg)) return;
  } else if (action === 'implement') {
    if (!window.confirm('{{panel.submit_implement_confirm}}')) return;
  }

  _submitInFlight = true;

  // A throwing collector must not wedge the button behind the in-flight
  // guard above (#383): release the flag, say what broke, hand control back.
  let data;
  try {
    data = collectDecisions(action);
  } catch (e) {
    _submitInFlight = false;
    console.error('collectDecisions failed', e);
    showSubmitWarning('{{panel.submit_collect_failed}}: ' + ((e && e.message) || e));
    return;
  }
  const container = document.getElementById('concept-decisions');
  container.textContent = JSON.stringify(data);
  // design template only: the feedback dock is a single overlay shared by
  // every iteration, and its field ids repeat per iteration (`d1-s1`) — so
  // iteration N+1 must not open pre-filled with N's notes. This used to be
  // solved by EMPTYING the dock here, at submit time, which destroyed the
  // text the user had just sent: switch to an older tab, switch back, and the
  // round they were still waiting on showed no comments at all. The keys are
  // namespaced per iteration now (§ State Persistence `_iterationPrefix`), so
  // nothing leaks forward and nothing has to be thrown away — the dock is only
  // marked read-only, so the user can read back what they sent while Claude
  // works. Runs AFTER collectDecisions(), never before. See § Panel Chrome
  // (all templates) → Feedback dock.
  if (typeof markDockSubmitted === 'function') markDockSubmitted();
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();
  _submittedAt = Date.now();
  _submittedReloadCounter = _bootReloadCounter;
  _submittedAction = action;

  // Reset progress list to the just-submitted baseline. The third step
  // is only revealed for implement-action submissions — iterate ends at
  // step 2 (panel reload onto the new iteration restores the ready panel).
  resetStatusSteps(action);

  document.getElementById('panel-ready').style.display = 'none';
  document.getElementById('panel-submitted').style.display = 'block';
  // The pinned status line flips to "Übermittelt · Claude arbeitet" + dots.
  if (typeof renderPanelStatus === 'function') renderPanelStatus();

  // The submitted panel is already on screen, and it is a promise that the
  // payload is safe. That promise must be backed by a DURABLE ack, not by
  // "the request did not throw". `fetch` rejects only on a transport failure,
  // so a 507 (bridge could not persist) resolved like any other response and
  // the old code counted it as success — then cleared the local copy. That is
  // the client-side half of #284.
  let durable = false;
  let transportFailed = false;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    durable = res.ok && body.durable !== false;
  } catch (e) {
    transportFailed = true;
  }

  if (!durable) {
    // Keep a local copy first, whatever went wrong.
    _guardedSetItem(STORAGE_KEY + '-pending', JSON.stringify(data));
    if (transportFailed) {
      // Offline / bridge down. This case self-heals — retryPendingSubmission()
      // fires on reconnect — so the submitted panel stays up and we only
      // explain the delay.
      showSubmitWarning('{{panel.submit_queued_offline}}');
    } else {
      // The bridge answered but could not persist (disk full, store gone).
      // Nothing retries this on its own, so do NOT leave a "sent" panel
      // standing over it: hand control back and say why.
      restorePanelToReady();
      showSubmitWarning('{{panel.submit_not_durable}}');
    }
  }

  const unsynced = (typeof unsyncedAttachmentCount === 'function')
    ? unsyncedAttachmentCount() : 0;
  if (unsynced > 0) showSubmitWarning('{{panel.attachments_not_synced}}');

  saveState();
  _submitInFlight = false;
}

wireSubmit('submit-iterate-btn', 'iterate');
wireSubmit('submit-implement-btn', 'implement');

// --- A sent round survives a reload ---
// `concept-submitted` is not persisted, on purpose: the Claude-driven reload
// onto the NEXT round must come back ready. But a manual reload while Claude
// is still working on THIS round used to drop the sent state with it — the
// grey veil over the content was gone and the submit buttons were live again
// over a round already in flight. So ask the bridge (and, offline, the local
// queue) whether a payload for the live round is still pending, and if so put
// the round back exactly as submitWithAction() left it. The veil is then
// click/Escape-dismissable as always — only a reload brings it back.
// A payload without `iteration` (a page generated before it carried one) is
// never restored: it cannot be told apart from the previous round's payload,
// which is still pending for a moment after every Claude-driven reload.
// A finalize is restoreInFlightCloseout()'s job (§ close-out sheet).
async function restoreInFlightRound() {
  const live = document.querySelector('section[data-iteration][data-active]');
  if (!live || live.hasAttribute('data-final-report')) return;
  if (_submittedAt || _submitInFlight) return;
  let data = null;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch (e) { /* bridge unreachable — the local queue below still knows */ }
  if (!(data && data.submitted === true)) {
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY + '-pending') || 'null'); }
    catch (e) { data = null; }
  }
  if (!data || data.submitted !== true) return;
  if (data.action !== 'iterate' && data.action !== 'implement') return;
  if (data.iteration == null || String(data.iteration) !== String(live.dataset.iteration)) return;
  // The user may have submitted from this tab while the fetch was out.
  if (_submittedAt || _submitInFlight) return;
  if (typeof markDockSubmitted === 'function') markDockSubmitted();
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();
  const ready = document.getElementById('panel-ready');
  const sent = document.getElementById('panel-submitted');
  const onLive = !document.body.classList.contains('viewing-frozen');
  if (ready) ready.style.display = 'none';
  if (sent && onLive) sent.style.display = 'block';
  // Re-join the submit-state machine so pollProcessedState() hands the panel
  // back once Claude is done (or the safety timeout fires).
  if (_bootReloadCounter === null && typeof pollReload === 'function') await pollReload();
  _submittedAt = Date.now();
  _submittedReloadCounter = _bootReloadCounter;
  _submittedAction = data.action;
  if (typeof resetStatusSteps === 'function') resetStatusSteps(data.action);
  if (typeof updateStatusSteps === 'function') updateStatusSteps(data);
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', restoreInFlightRound);
} else {
  restoreInFlightRound();
}

// --- Submit menu (the implement action lives one level deeper) ---
// ▾ toggles #submit-menu; aria-expanded mirrors [hidden]. Escape and any
// click outside close it; choosing the item closes it before the confirm
// dialog opens, so the menu never sits open behind a modal.
//
// #367 (two rounds): .panel-cta carries `overflow-y: auto` as its ≤120px
// foot safety net, so an `absolute` popover anchored to THAT box and opening
// upward gets clipped/scrolled away by it — round one fixed that by making
// the menu `position: fixed` off the split button's VIEWPORT rect sampled
// once at open time. That broke on the design layout: the ☰ panel is still
// sliding in (`transition: right 0.3s ease`, § Panel Chrome) when a fast
// click reaches the caret, so the sampled rect is stale the instant the
// transition finishes — measured 400px off-screen. Anchoring the menu to
// `.concept-decision-panel` instead (its containing block; `.panel-cta`
// deliberately drops `position: relative`, see its CSS comment) means the
// menu moves WITH the panel for free — no re-sampling needed mid-transition,
// only on open and on resize. Both rects below are read in the same frame,
// so the panel-relative offsets are correct whether or not the slide-in has
// finished.
(function wireSubmitMenu() {
  const btn = document.getElementById('submit-menu-btn');
  const menu = document.getElementById('submit-menu');
  if (!btn || !menu) return;
  const anchor = btn.closest('.submit-split') || btn;
  const panel = menu.closest('.concept-decision-panel') || menu.parentElement;
  const position = () => {
    const pr = panel.getBoundingClientRect();
    const sr = anchor.getBoundingClientRect();
    menu.style.left = (sr.left - pr.left) + 'px';
    menu.style.width = sr.width + 'px';
    menu.style.bottom = (pr.bottom - sr.top + 6) + 'px';
  };
  const setOpen = (open) => {
    if (open) position();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    setOpen(open);
    if (open) menu.querySelector('[role="menuitem"]')?.focus();
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('[role="menuitem"]')) setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (menu.hidden || menu.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    btn.focus();
  });
  window.addEventListener('resize', () => { if (!menu.hidden) position(); });
  // The panel's own slide-in/out transition (§ Panel Chrome, `right 0.3s`)
  // bubbles here; re-measuring on its end is cheap insurance if the menu was
  // opened while the panel was still moving.
  panel.addEventListener('transitionend', () => { if (!menu.hidden) position(); });
})();

// --- Submit warnings ---
// A submission that did not reach disk must SAY SO on the page. The whole
// failure mode this guards against is a confident "übermittelt" panel sitting
// on top of work that no longer exists anywhere, which is what sends the user
// away believing Claude will pick it up.
//
// Locale strings, resolved at generation time per § UI Locale:
//   {{panel.submit_queued_offline}}   — "Bridge nicht erreichbar — wird bei
//                                        Reconnect automatisch nachgeholt.
//                                        Deine Eingaben sind lokal gesichert."
//   {{panel.submit_not_durable}}      — "Die Bridge konnte die Übermittlung
//                                        nicht sichern (Speicherproblem).
//                                        Nichts ist verloren — deine Eingaben
//                                        liegen lokal. Bitte erneut absenden."
//   {{panel.attachments_not_synced}}  — "Ein Bild liegt noch nur lokal vor und
//                                        wird automatisch nachgereicht."
//   {{panel.submit_collect_failed}}   — "Entscheidungen konnten nicht
//                                        eingesammelt werden — nichts wurde
//                                        gesendet. …" (+ the error message)
function showSubmitWarning(msg) {
  // Host = whichever panel is ON SCREEN. Both panels exist at all times and
  // only `display` flips between them; a warning raised while the ready
  // panel is up (collector threw, restorePanelToReady() ran first) must not
  // land in the hidden submitted panel where nobody sees it.
  const submitted = document.getElementById('panel-submitted');
  const host = (submitted && submitted.style.display !== 'none') ? submitted
            : (document.getElementById('panel-ready') || submitted);
  if (!host) return;
  let strip = host.querySelector('.submit-warning');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'submit-warning';
    strip.setAttribute('role', 'alert');
    host.insertBefore(strip, host.firstChild);
  }
  strip.textContent = msg;
  strip.style.display = 'block';
}

function clearSubmitWarning() {
  document.querySelectorAll('.submit-warning').forEach(el => el.remove());
}

// --- Content dimmer (focus shifter after submit) ---
// After a submit the user's attention belongs on the decision panel / FAB,
// not on the now-frozen content. showContentDimmer reveals a fixed overlay
// over the content area; the panel + FABs sit at higher z-index and stay
// clear and clickable. The dimmer itself is click-to-dismiss — clicking
// anywhere on it removes `content-dimmed` and hides the overlay, letting
// the user re-engage with the content without losing the submitted state.
// The Claude-driven reload onto the next round comes back without the body
// class (it is not persisted); a manual reload while THIS round is still sent
// gets it back from restoreInFlightRound() / restoreInFlightCloseout().
function showContentDimmer() {
  const dim = document.getElementById('content-dimmer');
  if (dim) dim.hidden = false;
}
function hideContentDimmer() {
  const dim = document.getElementById('content-dimmer');
  if (dim) dim.hidden = true;
  document.body.classList.remove('content-dimmed');
}
// Frozen veil — the same overlay doubles as the lock over a past iteration.
// showIteration() calls this on EVERY entry into a non-live tab, so a veil the
// user lifted (click / Escape) comes back the moment they switch tabs: at most
// the one past round currently on screen is ever unlocked, and switching to
// the live tab hides the dimmer instead (see showIteration), so from the live
// round every past round is locked again.
function lockFrozenView() {
  document.body.classList.add('content-dimmed');
  showContentDimmer();
}
document.getElementById('content-dimmer')
  ?.addEventListener('click', hideContentDimmer);
// Keyboard escape — keyboard-only users can't click the dimmer, so let
// Escape dismiss it. Only acts while the dimmer is actually visible AND the
// panel is closed: with the panel open the same press is the dismissal of the
// panel (§ Panel Chrome (all templates)), and letting it through here would
// silently unlock the frozen round behind it instead.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.body.classList.contains('panel-open')) return;
  const dim = document.getElementById('content-dimmer');
  if (dim && !dim.hidden) hideContentDimmer();
});

// A user-changed checkbox/radio is `touched` from then on — the same mark
// the text fields carry (§ State Persistence). It is what stops a late
// restoreState() (the durable-draft merge) from silently reverting an answer
// the close-out sheet has already mirrored into its rows and its plan.
document.addEventListener('change', e => {
  const t = e.target;
  if (t && t.matches && t.matches('input[type="checkbox"], input[type="radio"]')) {
    t.dataset.touched = '1';
  }
}, true);

// --- Final-report close-out sheet (action: "finalize") ---
// The final report used to hand the user four independent controls at once —
// Shippen, Issues erstellen, Concept beenden, Iterationen ansehen — each with
// its own submit and an execution order nobody could see. A four-step wizard
// fixed the ordering but bought a new confusion: every "Weiter" looked like it
// might already have done something, and the consequence list — the thing
// that makes one irreversible click legitimate — sat three steps deep.
//
// This is ONE sheet, an ACCORDION of rows in the order Claude executes them
// (open points → ship → this page → hand-offs), one open at a time, a live
// plan BELOW the single button, and nothing that commits anything before that
// button. Claude then runs the parts in that same fixed order (SKILL.md
// Step 5b · finalize).
const CLOSEOUT_DEFAULT_ROUTE = 'issue';
// The rows in accordion/execution order. 'plan' is deliberately not one of
// them — it is the readout of the rows above, never a thing to answer.
const CLOSEOUT_ROW_KINDS = ['followups', 'ship', 'files', 'handoffs'];

function finalReportSection() {
  const active = document.querySelector('section[data-iteration][data-active]');
  return (active && active.hasAttribute('data-final-report')) ? active : null;
}

// The [data-open-questions] checkboxes in the REPORT BODY stay the single
// source of truth for which points are still open. Already-routed items carry
// `disabled` (Claude sets it when it writes the [Issue #NNN] link or the
// implemented note), so they drop out here and the whole block disappears
// once everything is routed.
function openQuestionBoxes() {
  const active = finalReportSection();
  const block = active ? active.querySelector('[data-open-questions]') : null;
  return block
    ? Array.from(block.querySelectorAll('input[type="checkbox"]:not(:disabled)'))
    : [];
}

// The id Claude gets back in the payload: whatever the report declared.
function followUpId(el) { return el.name || el.id || ''; }

// The key the ROW's radio group is named after — which is not the same thing.
// `name`/`id` are mandatory on an open-question checkbox and unique in
// practice, but a hand-written report breaks both assumptions, and a radio
// group is keyed by name document-wide: two rows sharing one make choosing a
// route on the second silently un-choose the first, and every nameless row
// would answer with the default no matter what the user clicked. So the key
// is the declared id when it is usable, and a disambiguated one when it is
// not — the payload keeps the declared value either way.
function followUpKeys(boxes) {
  const seen = {};
  return boxes.map((el, i) => {
    const raw = followUpId(el);
    if (!raw) return 'pos-' + i;
    seen[raw] = (seen[raw] || 0) + 1;
    return seen[raw] === 1 ? raw : raw + '~' + seen[raw];
  });
}

// Which of the three routes the user picked for one open point. Before the
// radios exist (first render) — and for any row whose group somehow lost its
// selection — the answer is the harmless default: file an issue, write no
// code.
function followUpRoute(key) {
  if (!key) return CLOSEOUT_DEFAULT_ROUTE;
  const host = document.getElementById('closeout-followup-list');
  const el = host && host.querySelector('input[name="fu-' + CSS.escape(key) + '"]:checked');
  return el ? el.value : CLOSEOUT_DEFAULT_ROUTE;
}

// One payload item. `description` = explicit data-issue-body, else the
// visible .oq-label text. Either is enough for Claude to skip the
// auto-issue AskUserQuestion path — the user committed against the plan on
// screen, so we MUST NOT ask again. The same shape feeds both buckets: an
// item the user routed to "jetzt umsetzen" carries exactly the context an
// implementing agent needs.
function followUpItem(el) {
  const labelEl = el.closest('label')?.querySelector('.oq-label');
  const labelText = labelEl ? labelEl.textContent.trim() : '';
  return {
    id: followUpId(el),
    title: el.dataset.issueTitle || labelText,
    type: el.dataset.issueType || 'chore',
    description: el.dataset.issueBody || labelText,
    // Optional project-specific label hints — picked up by Claude when
    // present, silently ignored when absent. Concept HTML is generated by
    // Claude, so these are populated from concept context.
    role: el.dataset.issueRole || null,
    module: el.dataset.issueModule || null,
    milestone: el.dataset.issueMilestone || null,
    selected: true
  };
}

function collectFollowUps(route) {
  const boxes = openQuestionBoxes();
  const keys = followUpKeys(boxes);
  return boxes
    .filter((el, i) => el.checked && followUpRoute(keys[i]) === route)
    .map(followUpItem);
}

// Two buckets out of one list. They are disjoint by construction — a row has
// exactly one route — so an item can never be filed AND built.
function collectIssueItems() { return collectFollowUps('issue'); }
function collectImplementItems() { return collectFollowUps('implement'); }

function collectDisposition() {
  const sheet = document.getElementById('closeout-sheet');
  const scope = sheet || document;
  const radio = scope.querySelector('input[name="dispose-mode"]:checked');
  const moveEl = document.getElementById('dispose-move-to');
  const mode = radio ? radio.value : 'discard';
  const moveTo = (moveEl && moveEl.value.trim()) ? moveEl.value.trim() : null;
  return { mode, moveTo };
}

function closeoutShipChoice() {
  // Scoped to the sheet: every one of these controls is the panel's own, and
  // a same-named control in the report body would otherwise win by document
  // order and answer for the user.
  const sheet = document.getElementById('closeout-sheet');
  const el = sheet && sheet.querySelector('input[name="closeout-ship"]:checked');
  return el ? el.value : null;
}

// --- Accordion rows: open/answered state, one row open at a time ---
// "Answered" survives a reload within the SAME session (sessionStorage,
// never localStorage — the route/ship radios stay data-no-persist by design,
// see § above, and this must not smuggle their choices back in). Keyed by
// iteration so a later final report (a resumed/second close-out on the same
// page) starts fresh rather than inheriting a prior round's progress.
function closeoutStorageKey() {
  const section = finalReportSection();
  const iter = section ? section.dataset.iteration : '0';
  return (typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'concept') + '-closeout-answered-' + iter;
}
function loadCloseoutAnswered() {
  try {
    const raw = sessionStorage.getItem(closeoutStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveCloseoutAnswered(map) {
  try { sessionStorage.setItem(closeoutStorageKey(), JSON.stringify(map)); } catch (e) { /* best effort */ }
}

// The rows currently on the sheet — every non-plan block that is not hidden.
// A block hides for a real reason (no open points, no hand-offs), so a
// hidden block is never counted against "every row answered".
function closeoutRows() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return [];
  return CLOSEOUT_ROW_KINDS
    .map(kind => sheet.querySelector('.closeout-block[data-closeout-block="' + kind + '"]'))
    .filter(el => el && !el.hidden);
}
function closeoutOpenRow() {
  return closeoutRows().find(el => el.dataset.open === 'true') || null;
}
function closeoutAllAnswered() {
  const rows = closeoutRows();
  return rows.length === 0 || rows.every(el => el.dataset.answered === 'true');
}
// Exactly one open row at a time — opening one closes the others. Opening a
// row never touches its answered state: re-opening an already-answered row
// (to look again, or change the answer) keeps it answered.
function openCloseoutRow(target) {
  closeoutRows().forEach(el => {
    const isTarget = el === target;
    el.dataset.open = isTarget ? 'true' : 'false';
    const head = el.querySelector('[data-closeout-row]');
    const body = el.querySelector('[data-closeout-row-body]');
    if (head) head.setAttribute('aria-expanded', isTarget ? 'true' : 'false');
    if (body) body.hidden = !isTarget;
  });
}
// The collapsed row's one-line answer, reusing the same collectors/labels the
// plan and the payload already read from — never a second source of truth.
function closeoutRowSummary(kind) {
  const sheet = document.getElementById('closeout-sheet');
  if (kind === 'followups') {
    const boxes = openQuestionBoxes();
    if (!boxes.length) return '';
    const keys = followUpKeys(boxes);
    const host = document.getElementById('closeout-followup-list');
    const labels = {
      issue: (host && host.dataset.labelIssue) || 'Issue',
      implement: (host && host.dataset.labelImplement) || '',
      ignore: (host && host.dataset.labelIgnore) || ''
    };
    const parts = boxes.map((b, i) => labels[followUpRoute(keys[i])] || '');
    return boxes.length + ' · ' + parts.join(', ');
  }
  if (kind === 'ship') {
    const choice = closeoutShipChoice();
    if (!choice) return (sheet && sheet.dataset.labelUnanswered) || '';
    return choice === 'yes'
      ? (sheet && sheet.dataset.labelShipYes) || ''
      : (sheet && sheet.dataset.labelShipNo) || '';
  }
  if (kind === 'files') {
    const mode = document.querySelector('input[name="dispose-mode"]:checked');
    return (mode && mode.closest('label')?.querySelector('strong')?.textContent.trim()) || '';
  }
  if (kind === 'handoffs') {
    const n = document.querySelectorAll('#closeout-handoffs-list li').length;
    return ((sheet && sheet.dataset.labelSteps) || '{n}').replace('{n}', String(n));
  }
  return '';
}
// Locked = not answered AND not the open row: every unanswered row after the
// current one. The order of the sheet is the order Claude executes it in, so
// a later row may only be reached through "Weiter ›" on the ones before it;
// an answered row stays reachable (closeoutRowClick()) to go back and change
// the answer. `disabled` on the head is what makes the lock real for
// keyboard and AT, the data-locked attribute is what the CSS dims.
function isCloseoutRowLocked(block) {
  return block.dataset.answered !== 'true' && block.dataset.open !== 'true';
}
function updateCloseoutRowSummary(block) {
  const summaryEl = block.querySelector('[data-closeout-summary]');
  if (summaryEl) summaryEl.textContent = closeoutRowSummary(block.dataset.closeoutBlock);
  const answered = block.dataset.answered === 'true';
  const open = block.dataset.open === 'true';
  const mark = block.querySelector('[data-closeout-mark]');
  if (mark) mark.textContent = answered ? '✓' : open ? '●' : '○';
  const locked = isCloseoutRowLocked(block);
  block.dataset.locked = locked ? 'true' : 'false';
  const head = block.querySelector('[data-closeout-row]');
  // A frozen sheet has already disabled every head (setCloseoutFrozen) —
  // never re-enable one from here.
  const sheet = document.getElementById('closeout-sheet');
  if (head && !(sheet && sheet.dataset.frozen === 'true')) head.disabled = locked;
}
function updateCloseoutProgress() {
  const sheet = document.getElementById('closeout-sheet');
  const el = document.getElementById('closeout-progress');
  if (!sheet || !el) return;
  const rows = closeoutRows();
  const done = rows.filter(r => r.dataset.answered === 'true').length;
  const tpl = sheet.dataset.labelProgress || '{n}/{total}';
  el.textContent = rows.length
    ? tpl.replace('{n}', String(done)).replace('{total}', String(rows.length))
    : '';
}
// The one button's pre-submit states — never two buttons. Ready = every
// visible row answered; only then does it read as the warning-coloured
// execute action, with the consequence warning as its data-tip tooltip. While
// the bridge is disconnected the ready label says so ("· wird
// zwischengespeichert"): the final report has no status line of its own
// (§ CSS body.viewing-final .panel-status), so the button is the one place
// left to say that the click will be queued rather than delivered.
// checkClaudeConnection() calls this on every heartbeat for that reason.
// Never touches a button that already carries a finalize state — after the
// click the button is the submission's status (setCloseoutButtonState()) and
// nothing on the sheet may repaint it as a live control again.
function updateCloseoutButton() {
  const btn = document.getElementById('closeout-execute');
  if (!btn || btn.dataset.finalizeState) return;
  const ready = closeoutAllAnswered();
  btn.dataset.ready = ready ? 'true' : 'false';
  const label = btn.querySelector('[data-closeout-btn-label]');
  const icon = btn.querySelector('[data-closeout-btn-icon]');
  const conn = document.getElementById('connection-status');
  const offline = !!conn && conn.dataset.state === 'disconnected';
  if (label) {
    label.textContent = !ready ? (btn.dataset.labelNext || '')
      : offline ? (btn.dataset.labelExecuteOffline || btn.dataset.labelExecute || '')
      : (btn.dataset.labelExecute || '');
  }
  // The icon is warning-only. "Weiter ›" already carries its own "›" inside
  // the label string — an always-visible icon glyph next to it used to
  // render "› Weiter ›". Hidden (not emptied) in the "next" state so no
  // stray gap/glyph is left in the flex row either.
  if (icon) {
    icon.hidden = !ready;
    icon.textContent = ready ? '⚠' : '';
  }
  // "Ein Klick, alles davon" only makes sense once the click it describes
  // can actually fire.
  if (ready) btn.dataset.tip = btn.dataset.titleExecute || '';
  else btn.removeAttribute('data-tip');
}
// After the click the button IS the status: running → done, or stalled.
// Sets [data-finalize-state] (the CSS colour), swaps the label/icon from the
// baked-in data-label-* strings and clears the execute title; `null` clears
// the state again (restoreCloseoutToReady) and hands the button back to
// updateCloseoutButton(). The stalled state is the only one that also keeps
// a paragraph under the button (`.hint[data-finalize-state="stalled"]`): it
// carries an instruction ("schau in den Chat"), not just a state.
function setCloseoutButtonState(state) {
  const btn = document.getElementById('closeout-execute');
  const sheet = document.getElementById('closeout-sheet');
  if (sheet) {
    sheet.querySelectorAll('.hint[data-finalize-state]').forEach(el => {
      el.hidden = el.dataset.finalizeState !== state;
    });
  }
  if (!btn) return;
  if (!state) {
    delete btn.dataset.finalizeState;
    updateCloseoutButton();
    return;
  }
  btn.dataset.finalizeState = state;
  btn.removeAttribute('data-tip');
  const glyph = state === 'running' ? '⏳' : state === 'done' ? '✓' : '⚠';
  const key = 'label' + state.charAt(0).toUpperCase() + state.slice(1);
  const label = btn.querySelector('[data-closeout-btn-label]');
  const icon = btn.querySelector('[data-closeout-btn-icon]');
  if (label) label.textContent = btn.dataset[key] || '';
  if (icon) { icon.hidden = false; icon.textContent = glyph; }
}
function refreshCloseoutRows() {
  closeoutRows().forEach(updateCloseoutRowSummary);
  updateCloseoutProgress();
  updateCloseoutButton();
}
// Called at the end of every non-closed renderCloseout(). Row DOM nodes are
// static (they live in the skeleton, not rebuilt per render), so
// `dataset.answered === undefined` is true only on the very first render —
// every later call leaves in-session progress alone and just re-derives the
// summaries/progress/button from current answers.
// Fixed to match the `min-height` on .closeout-row (§ CSS) — the two MUST
// agree, or consecutive stuck heads either gap or overlap.
const CLOSEOUT_HEAD_H_REM = 2.2;
// Sticky-both-edges: each head gets BOTH `top: i × H` and
// `bottom: (n-1-i) × H`. `top` alone piles heads at the TOP as the region
// scrolls down, but once the region is shorter than n × H (routine here —
// 4 heads is already ~9rem, and a live check found only 1 head fitting
// inside a fixed-height rows region before this), the LAST head(s) still get
// pushed out past the bottom of the scroll container while the earlier ones
// pile up top. Adding the symmetric `bottom` offset gives every head a
// second constraint pinning it from the other edge, so the browser keeps it
// inside a fixed HxH-tall "slot" regardless of scroll position or how short
// the region is — no scroll-listener, no measured layout, just two sticky
// constraints per element. Indices are over VISIBLE blocks only (computed
// fresh on every call): a hidden block (no open points, no hand-offs) must
// not leave a gap in the stack.
function layoutCloseoutRowHeads() {
  const rows = closeoutRows();
  const n = rows.length;
  rows.forEach((block, i) => {
    block.dataset.closeoutIndex = String(i);
    const head = block.querySelector('[data-closeout-row]');
    if (!head) return;
    head.style.top = (i * CLOSEOUT_HEAD_H_REM) + 'rem';
    head.style.bottom = ((n - 1 - i) * CLOSEOUT_HEAD_H_REM) + 'rem';
  });
}
function initCloseoutRows() {
  const rows = closeoutRows();
  if (!rows.length) return;
  const answered = loadCloseoutAnswered();
  rows.forEach(r => {
    if (r.dataset.answered === undefined) {
      r.dataset.answered = answered[r.dataset.closeoutBlock] ? 'true' : 'false';
    }
  });
  if (!closeoutOpenRow()) {
    openCloseoutRow(rows.find(r => r.dataset.answered !== 'true') || rows[0]);
  }
  // Re-run on every call, not just the first: the visible SET can change
  // (a followups/hand-offs block appearing or disappearing) and the offsets
  // above are only valid for the current set.
  layoutCloseoutRowHeads();
  refreshCloseoutRows();
}
// A row head click. Only an ANSWERED row (or the one already open) may be
// opened by hand — going back to change an answer; a locked row's head is
// `disabled` (updateCloseoutRowSummary()) so it never gets here from a real
// click, but the guard stays for programmatic callers. Going back leaves the
// rows in between exactly as they were: answered stays answered, and
// "Weiter ›" from the re-opened row lands on the first still-unanswered one
// again (closeoutButtonClick()).
function closeoutRowClick(block) {
  const sheet = document.getElementById('closeout-sheet');
  if (!block || !sheet || sheet.dataset.frozen === 'true') return;
  if (isCloseoutRowLocked(block)) return;
  openCloseoutRow(block);
  refreshCloseoutRows();
}
// The single button's click handler. Not yet all answered → confirm the open
// row (refusing on an unanswered ship question) and open the next unanswered
// one; all answered → this IS the execute click.
function closeoutButtonClick() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet || sheet.dataset.frozen === 'true') return;
  if (closeoutAllAnswered()) {
    submitFinalize();
    return;
  }
  const rows = closeoutRows();
  const open = closeoutOpenRow() || rows.find(r => r.dataset.answered !== 'true');
  if (!open) return;
  if (open.dataset.closeoutBlock === 'ship' && !closeoutShipChoice()) {
    const req = document.getElementById('closeout-ship-required');
    if (req) {
      req.hidden = false;
      req.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  open.dataset.answered = 'true';
  const answered = loadCloseoutAnswered();
  answered[open.dataset.closeoutBlock] = true;
  saveCloseoutAnswered(answered);
  const next = rows.find(r => r.dataset.answered !== 'true');
  openCloseoutRow(next || open);
  refreshCloseoutRows();
}

// Re-renders the sheet. Called from showIteration() with { reset: true } (a
// tab switch re-reads the report from scratch) and from the change listener
// without it. There are no steps to keep a position in any more — the reset
// flag only forces the follow-up rows to be rebuilt from the body.
function refreshCloseout(opts) {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  if (opts && opts.reset) {
    // Force the rows to be re-derived from the report body — the section may
    // have been rewritten under us. The user's answers are carried over by
    // buildFollowUpList(); "reset" is about the row SET, never about the
    // choices made on it.
    const host = document.getElementById('closeout-followup-list');
    if (host) host.dataset.itemKey = '';
  }
  renderCloseout();
}

// Freezing is not cosmetic: after a submit the payload is fixed, so a live
// radio or a re-enabled execute button would let the user act on a screen
// that no longer describes what was sent.
// Scoped to the sheet's own controls ONLY. Never touch the body's
// [data-open-questions] checkboxes here: Claude disables those permanently as
// it routes each item, and a blanket re-enable on unfreeze would hand back
// checkboxes for issues that already exist.
function setCloseoutFrozen(frozen) {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  sheet.dataset.frozen = frozen ? 'true' : 'false';
  sheet.querySelectorAll('input, button').forEach(el => { el.disabled = frozen; });
  // Unfreezing re-enabled every row head above — a locked row must not come
  // back clickable.
  if (!frozen) closeoutRows().forEach(updateCloseoutRowSummary);
}

// Re-arm after a finalize that did not complete — a blocked ship, a stale
// processed state, a bridge that could not persist. Without this the execute
// button stays disabled forever and the user's only way out is a reload.
function restoreCloseoutToReady() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  setCloseoutButtonState(null);
  setCloseoutFrozen(false);
  renderCloseout();
}

// What the user has to do by hand once the close-out is through — the one
// part of a concept nothing here can automate, so it must not disappear into
// the report body. Mirrors the report's [data-handoffs] list onto the sheet;
// renderCloseout() keeps this block after data-closed, when every other block
// is gone.
function renderHandoffs() {
  const sheet = document.getElementById('closeout-sheet');
  const block = sheet && sheet.querySelector('[data-closeout-block="handoffs"]');
  const host = document.getElementById('closeout-handoffs-list');
  if (!block || !host) return;
  const section = finalReportSection();
  const list = section ? section.querySelector('[data-handoffs]') : null;
  const items = list ? Array.from(list.querySelectorAll('li')) : [];
  host.textContent = '';
  items.forEach(li => {
    const el = document.createElement('li');
    el.textContent = li.textContent.trim().replace(/\s+/g, ' ');
    host.appendChild(el);
  });
  const count = document.getElementById('closeout-handoffs-count');
  if (count) count.textContent = items.length ? '(' + items.length + ')' : '';
  block.hidden = items.length === 0;
}

function renderCloseout() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;

  // A closed-out report is done. Claude stamps data-closed on the section
  // before the final /reload, so the reloaded page shows the outcome instead
  // of re-arming a sheet whose bridge has already been shut down — a live
  // execute button there would queue a submission nobody will ever pick up.
  const section = finalReportSection();
  if (section && section.hasAttribute('data-closed')) {
    sheet.querySelectorAll('.closeout-block').forEach(el => {
      el.hidden = el.dataset.closeoutBlock !== 'handoffs';
    });
    renderHandoffs();
    // Done means no controls at all — the hand-offs row keeps its icon +
    // label as a plain heading but loses every answerable affordance: no ○/✓
    // mark, no "current answer" summary, no aria-expanded, permanently
    // disabled so it neither opens/closes anything nor looks clickable
    // (§ CSS ":disabled" override — the row's own cursor:pointer would
    // otherwise survive `disabled`). Never `head.hidden`: [hidden] loses to
    // `.closeout-row`'s own `display: flex` in the cascade, which is what
    // left a live-looking "○ Danach von Hand" row after close in practice.
    const handoffsBlock = sheet.querySelector('[data-closeout-block="handoffs"]');
    if (handoffsBlock) {
      const head = handoffsBlock.querySelector('[data-closeout-row]');
      const body = handoffsBlock.querySelector('[data-closeout-row-body]');
      if (head) {
        head.disabled = true;
        head.removeAttribute('aria-expanded');
        const mark = head.querySelector('[data-closeout-mark]');
        if (mark) mark.hidden = true;
        const summary = head.querySelector('[data-closeout-summary]');
        if (summary) { summary.hidden = true; summary.textContent = ''; }
      }
      if (body) body.hidden = false;
    }
    // The button stays, as the outcome: "✓ Concept abgeschlossen." — disabled
    // (nothing left to click), never hidden (the done state must be visible
    // where the action was).
    setCloseoutButtonState('done');
    const exec = document.getElementById('closeout-execute');
    if (exec) { exec.hidden = false; exec.disabled = true; }
    const progress = document.getElementById('closeout-progress');
    if (progress) progress.textContent = '';
    return;
  }

  const boxes = openQuestionBoxes();
  const followBlock = sheet.querySelector('[data-closeout-block="followups"]');
  if (followBlock) followBlock.hidden = boxes.length === 0;
  const count = document.getElementById('closeout-followup-count');
  if (count) count.textContent = boxes.length ? '(' + boxes.length + ')' : '';

  if (boxes.length) buildFollowUpList();
  renderHandoffs();

  // Every point dropped is a legitimate answer, but it is worth saying out
  // loud: nothing at all will be carried out of this concept.
  const none = document.getElementById('closeout-followups-none');
  if (none) {
    none.hidden = !(boxes.length > 0
      && collectIssueItems().length === 0
      && collectImplementItems().length === 0);
  }
  const req = document.getElementById('closeout-ship-required');
  if (req && closeoutShipChoice()) req.hidden = true;

  // Re-apply after the rebuild above: buildFollowUpList() creates fresh
  // radios, which would otherwise come back live on a frozen sheet.
  if (sheet.dataset.frozen === 'true') setCloseoutFrozen(true);

  // Accordion state — row set may have just changed (a block appeared or
  // disappeared above), so re-derive open/answered/summaries/button every
  // time, not just on first render.
  initCloseoutRows();
}

// One row per still-open point: its title, then its three routes. The body
// checkbox stays authoritative for "is this point still open" — "Ignorieren"
// unchecks it, the other two check it — so Claude's routed-item rewrite keeps
// working unchanged.
function buildFollowUpList() {
  const host = document.getElementById('closeout-followup-list');
  if (!host) return;
  const boxes = openQuestionBoxes();
  // Only rebuild when the underlying item SET changed — a rebuild driven by a
  // route's own change event would tear the row out from under the user's
  // cursor mid-click. The comparison is by id, never by count: Claude can
  // route one item (it gains `disabled`, leaving openQuestionBoxes) while the
  // same rewrite appends another, and a count-keyed fast path would then sync
  // every row to the WRONG body checkbox — the user picks a route on a row
  // labelled A and files an issue for B.
  const keys = followUpKeys(boxes);
  const ids = JSON.stringify(keys);
  if (host.dataset.itemKey === ids) return;
  // Answers survive the rebuild. refreshCloseout({ reset: true }) runs on
  // EVERY tab switch, so without this a detour into an earlier round to
  // re-read something silently reset every row the user had set to "jetzt
  // umsetzen" back to Issue — and the plan above the execute button would
  // have agreed with the reset, not with what they chose. Keyed by the radio
  // group name, so an id that is gone drops its answer with its row.
  const previous = {};
  host.querySelectorAll('.followup-routes input[type="radio"]:checked')
      .forEach(el => { previous[el.name] = el.value; });
  host.dataset.itemKey = ids;
  host.textContent = '';
  const labels = {
    issue: host.dataset.labelIssue || 'Issue',
    implement: host.dataset.labelImplement || 'Implement now',
    ignore: host.dataset.labelIgnore || 'Drop',
    originDeferred: host.dataset.labelOriginDeferred || 'deferred by you',
    originFound: host.dataset.labelOriginFound || 'found on the way'
  };
  boxes.forEach((src, i) => {
    const key = keys[i];
    const row = document.createElement('div');
    row.className = 'followup';
    row.dataset.followup = followUpId(src) || key;
    const title = document.createElement('span');
    title.className = 'followup-title';
    const labelEl = src.closest('label')?.querySelector('.oq-label');
    title.textContent = src.dataset.issueTitle
      || (labelEl ? labelEl.textContent.trim() : '');
    row.appendChild(title);
    // Where a row came from is part of the decision: a point the user parked
    // themselves reads differently from one Claude stumbled over. The
    // admission gate (SKILL.md § Open points admission gate) allows exactly
    // these two origins; any other value is a report that skipped the gate,
    // and the row then carries no tag rather than a made-up one.
    const origin = src.dataset.oqOrigin;
    if (origin === 'deferred' || origin === 'found') {
      const tag = document.createElement('span');
      tag.className = 'followup-origin';
      tag.dataset.origin = origin;
      tag.textContent = origin === 'deferred' ? labels.originDeferred : labels.originFound;
      row.appendChild(tag);
    }
    const routes = document.createElement('div');
    routes.className = 'followup-routes';
    routes.setAttribute('role', 'radiogroup');
    routes.setAttribute('aria-label', title.textContent);
    ['issue', 'implement', 'ignore'].forEach(value => {
      const label = document.createElement('label');
      label.className = 'followup-route';
      const input = document.createElement('input');
      input.type = 'radio';
      // Named so the three form one radio group, but data-no-persist for the
      // same reason the ship radios carry it: saveState() otherwise restores
      // every named radio document-wide, and a remembered "jetzt umsetzen"
      // would sail through a later close-out and write code the user never
      // re-authorised. After a reload every row falls back to the default.
      input.name = 'fu-' + key;
      input.value = value;
      input.dataset.noPersist = '';
      // The body checkbox decides ignore-vs-not (it is the source of truth
      // for "still open"); a preserved answer only chooses between the two
      // routes that keep it open.
      const prior = previous['fu-' + key];
      const initial = !src.checked ? 'ignore'
        : (prior === 'implement' ? 'implement' : CLOSEOUT_DEFAULT_ROUTE);
      if (value === initial) input.checked = true;
      input.addEventListener('change', () => {
        src.checked = value !== 'ignore';
        src.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const text = document.createElement('span');
      text.textContent = labels[value];
      label.appendChild(input);
      label.appendChild(text);
      routes.appendChild(label);
    });
    row.appendChild(routes);
    host.appendChild(row);
  });
}

// One submit for the whole close-out. Claude executes the parts in a fixed
// order (issues → implement → ship → disposition), so the user never has to
// sequence outward-facing actions by clicking things in the right order.
// POST /decisions has NO version guard (that lives on /reset and /status), so
// a payload the bridge already fsynced but whose response never reached the
// browser sits in two places at once. For an iterate that is harmless; for a
// finalize it means a second `gh issue create` run and a second real release.
// The id is what lets retryPendingSubmission() recognise its own payload on
// the bridge and drop the local copy instead of re-sending it.
function newSubmissionId() {
  return 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function submitFinalize() {
  const active = finalReportSection();
  const sheet = document.getElementById('closeout-sheet');
  const btn = document.getElementById('closeout-execute');
  if (!active || !sheet || !btn) return;
  if (sheet.dataset.frozen === 'true') return;

  // The ship question has no preselected answer on purpose: a release must
  // never be the by-product of running the sheet. Explain the block instead
  // of disabling execute, which would look broken.
  if (!closeoutShipChoice()) {
    const req = document.getElementById('closeout-ship-required');
    if (req) {
      req.hidden = false;
      req.scrollIntoView({ block: 'nearest' });
    }
    return;
  }

  const issues = collectIssueItems();
  const implement = collectImplementItems();
  const payload = {
    submitted: true,
    action: 'finalize',
    submission_id: newSubmissionId(),
    iteration: active ? active.dataset.iteration : null,
    issues: { create: issues.length > 0, items: issues },
    implement: { run: implement.length > 0, items: implement },
    ship: { run: closeoutShipChoice() === 'yes' },
    disposition: collectDisposition()
  };

  setCloseoutFrozen(true);
  setCloseoutButtonState('running');

  const container = document.getElementById('concept-decisions');
  if (container) container.textContent = JSON.stringify(payload);
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();
  // Same submit-state bookkeeping submitWithAction does. Without it
  // pollProcessedState() returns at its first line, so a finalize gets no
  // `_picked_up_at` progress in the status channel and — worse — no
  // PROCESSED_SAFETY_MS recovery: a Claude that dies mid-finalize would leave
  // the sheet disabled under a spinner forever.
  _submittedAt = Date.now();
  _submittedReloadCounter = _bootReloadCounter;
  _submittedAction = 'finalize';

  // A finalize can ship. "The request did not throw" is not good enough here —
  // require the bridge's durable ack, exactly as submitWithAction does.
  let durable = false;
  let transportFailed = false;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    durable = res.ok && body.durable !== false;
  } catch (e) {
    transportFailed = true;
  }

  if (!durable) {
    _guardedSetItem(STORAGE_KEY + '-pending', JSON.stringify(payload));
    if (transportFailed) {
      // Offline / bridge down — retryPendingSubmission() delivers it on
      // reconnect, so leave the sent state up and just explain the delay.
      if (typeof showSubmitWarning === 'function') {
        showSubmitWarning('{{panel.submit_queued_offline}}');
      }
    } else {
      // The bridge answered but could not persist. Nothing retries that on its
      // own, so hand the sheet back rather than leave a "sent" state standing
      // over a payload that never landed.
      restoreCloseoutToReady();
      document.body.classList.remove('concept-submitted', 'content-dimmed');
      hideContentDimmer();
      _submittedAt = 0;
      _submittedReloadCounter = null;
      _submittedAction = null;
      if (typeof showSubmitWarning === 'function') {
        showSubmitWarning('{{panel.submit_not_durable}}');
      }
    }
  }
}

// A finalize takes minutes — issues, follow-ups built by agents, a release.
// If the tab is reloaded while it runs, the sheet would come back fully
// re-armed, and a second execute would carry a NEW submission_id that the
// replay guard cannot recognise as a duplicate: a second `gh issue create`
// run and a second real release. So ask the bridge what is in flight before
// arming anything.
async function restoreInFlightCloseout() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet || !finalReportSection()) return;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    // Processed means `submitted: false` — /reset replaces the payload. The
    // `_processed_at` stamp is NOT that signal: the bridge keeps the stamp of
    // the LAST /reset across new submissions, so every concept with an
    // earlier round carried one and this check used to bail on exactly the
    // reload it exists for.
    if (!data || data.submitted !== true || data.action !== 'finalize') return;
    // A payload that names another round is not this sheet's (older pages
    // sent none — kept as before).
    const live = finalReportSection();
    if (data.iteration != null && String(data.iteration) !== String(live.dataset.iteration)) return;
    setCloseoutFrozen(true);
    setCloseoutButtonState('running');
    // Same veil submitFinalize() put up — a reload must not lift it.
    document.body.classList.add('concept-submitted', 'content-dimmed');
    showContentDimmer();
    // Re-join the submit-state machine so pollProcessedState() keeps tracking
    // the round that outlived its tab.
    _submittedAt = Date.now();
    _submittedReloadCounter = _bootReloadCounter;
    _submittedAction = 'finalize';
    if (typeof renderPanelStatus === 'function') renderPanelStatus();
  } catch (e) { /* bridge unreachable — leave the sheet as the DOM has it */ }
}

// The safety net (pollProcessedState → restorePanelToReady) must NOT re-arm a
// finalize. It was delivered durably; Claude either finishes it and rewrites
// this page, or reports a blocker and sends /reload. Re-arming here would put
// a live execute button on a page whose file may already be deleted (the
// default disposition is "Seite löschen", which deliberately sends no
// /reload) and whose bridge is shutting down — a click there queues a payload
// nobody will ever pick up.
function markCloseoutStalled() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  setCloseoutFrozen(true);
  setCloseoutButtonState('stalled');
}

// No "Iterationen ansehen" link under the sheet: earlier rounds are one click
// away through the panel head's rounds chip (🕘 N, `#panel-here-rounds-btn`)
// and the tab bar, so a third way only cost the sheet a row of height.

// Recompute whenever an input the plan summarises changes — the open-questions
// checkboxes in the body, a follow-up route, the ship choice, the disposition
// mode. The generic change listener (for saveState) fires the same event, so
// we just hook into the same channel.
document.addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.matches) return;
  // A frozen sheet describes a payload that is already on its way — nothing
  // on screen may still re-render against newer input.
  if (document.getElementById('closeout-sheet')?.dataset.frozen === 'true') return;
  // Element-agnostic on purpose: openQuestionBoxes() and the gating contract
  // both accept ANY element carrying [data-open-questions]. A listener pinned
  // to `section[...]` silently stops updating the rows and the plan on a
  // report that used a div or ul — so the plan would name the wrong counts
  // right before the one irreversible click.
  if (t.matches('[data-open-questions] input[type="checkbox"]') ||
      t.matches('.followup-routes input[type="radio"]') ||
      t.matches('input[name="closeout-ship"]') ||
      t.matches('input[name="dispose-mode"]')) {
    refreshCloseout();
  }
});
// Wired on DOM-ready, not at parse time: this block is copied verbatim into
// generated pages, and one whose script ends up before the markup would
// otherwise get a rendered sheet whose execute button is inert — no console
// error, no request, nothing to see.
function wireCloseout() {
  document.getElementById('closeout-execute')?.addEventListener('click', closeoutButtonClick);
  // One delegated listener for every row head — the accordion body is
  // static (never rebuilt per render), so binding once here is enough; only
  // buildFollowUpList()'s OWN inner content is rebuilt, and its rows sit
  // inside the already-wired followups row body.
  document.getElementById('closeout-sheet')?.addEventListener('click', e => {
    const head = e.target.closest('[data-closeout-row]');
    if (!head) return;
    closeoutRowClick(head.closest('.closeout-block'));
  });
  refreshCloseout({ reset: true });
  restoreInFlightCloseout();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireCloseout);
} else {
  wireCloseout();
}

// --- Offline Submit Queue ---
async function retryPendingSubmission() {
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  // Did this exact payload already land? `fetch` can throw after the bridge
  // has fsynced (tab closed, Wi-Fi drop mid-response), which queues a payload
  // that is already being processed. Re-POSTing a finalize that way runs its
  // side effects — issue creation, a real release, file deletion — a second
  // time. Payloads without a submission_id (iterate/implement, legacy pages)
  // keep the old unconditional-retry behaviour.
  try {
    const id = JSON.parse(pending).submission_id;
    if (id) {
      const cur = await fetch('/decisions', { cache: 'no-store' });
      const seen = cur.ok ? await cur.json().catch(() => ({})) : {};
      if (seen.submission_id === id) { localStorage.removeItem(pendingKey); return; }
    }
  } catch (e) { /* unparseable or bridge unreachable — fall through and retry */ }
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    // Drop the local copy ONLY once the bridge confirms it reached disk.
    // `res.ok` alone is not that confirmation — see submitWithAction.
    if (res.ok && body.durable !== false) localStorage.removeItem(pendingKey);
  } catch (e) { /* still offline */ }
  // Images that never made it up get another attempt on the same trigger.
  if (typeof restoreAttachments === 'function') restoreAttachments();
}
```

Claude-side: on receiving the payload, branch on `action`:
- `iterate` → Step 5b iterate branch: summarize + append next iteration only
- `implement` → Step 5b implement branch: actually write code/files, then
  append the final-report section (frozen "implementiert" record)
- `finalize` → Step 5b finalize branch: run the selected close-out parts in a
  FIXED order — issues (`gh issue create` behind the user-value gate) →
  implement (the follow-ups routed to "jetzt umsetzen", built through the
  devops role agents) → ship (full `/do-ship` pipeline) → Step 6 cleanup with the
  bundled disposition
- `create-issues` / `ship` / `dispose-concept` → **legacy**, still accepted:
  pages generated before the sheet send these one at a time. Each maps onto
  the matching part of the finalize branch (see SKILL.md § Legacy final-report
  actions); never emit them from newly generated pages

## Panel State Reset

The primary reset is the page reload itself: Claude POSTs `/reload` after
writing the new iteration, the browser's `pollReload` calls
`location.reload()`, and the freshly loaded page is in ready state because
the `concept-submitted` class is not persisted.

`restorePanelToReady()` is a safety-net — only called when `_processed_at`
indicates Claude finished AND a reload counter advance has been observed
(i.e. a reload is imminent / about to happen) OR a long stale timeout has
elapsed (recovery for closed tabs / JS errors where reload never fired).

```javascript
function restorePanelToReady() {
  // A final report has no ready panel — its ready state is a re-armed sheet.
  // Un-hiding #panel-ready here would paint the iterate/implement buttons over
  // a final report and let the user submit `iterate` against a closed session,
  // which showIteration() forbids by construction.
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active && active.hasAttribute('data-final-report')) {
    // A delivered finalize is never re-armed by the safety net — see
    // markCloseoutStalled(). Every other stuck round on a final report is
    // handed back so the user can act.
    if (_submittedAction === 'finalize' && typeof markCloseoutStalled === 'function') {
      markCloseoutStalled();
    } else if (typeof restoreCloseoutToReady === 'function') {
      restoreCloseoutToReady();
    }
  } else {
    document.getElementById('panel-submitted').style.display = 'none';
    document.getElementById('panel-ready').style.display = 'block';
    ['submit-iterate-btn', 'submit-implement-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = false;
    });
  }
  document.body.classList.remove('concept-submitted', 'content-dimmed');
  hideContentDimmer();
  // Re-arm the dock together with the submit buttons. markDockSubmitted() made
  // it read-only on the way out; a ready panel over an uneditable comment
  // surface is worse than either state on its own.
  if (typeof unmarkDockSubmitted === 'function') unmarkDockSubmitted();
  _submittedAt = 0;
  _submittedReloadCounter = null;
  _submitInFlight = false;
  _submittedAction = null;
  // Status line back from "Übermittelt · Claude arbeitet" to the draft state.
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
  // PANEL state only. This used to end in
  //     localStorage.removeItem('concept-state-' + slug)
  // which deleted every comment, rating and selection on the page. Both paths
  // into this function make that catastrophic: it also runs when the bridge
  // answered 507 (nothing was persisted anywhere, and the local copy was the
  // only one left), and after the five-minute safety timeout — i.e. precisely
  // when Claude has stopped responding because of a usage limit. Losing the
  // user's work is never part of recovering a panel.
  try {
    const st = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (st && typeof st === 'object') {
      delete st._userInteracted;
      _guardedSetItem(STORAGE_KEY, JSON.stringify(st));
    }
  } catch (e) { /* corrupt blob — leave it alone, never delete it */ }
}
```

## Submit Progress Steps

After a submit the pinned status line reads "⏳ Übermittelt · Claude
arbeitet" and shows one progress dot per step; the four-step `#status-steps`
list itself sits in a `<details class="status-detail">` under the line
(hidden until submit), so the user can see exactly where the submission is
in Claude's pipeline. The states the list tracks:

| Step | Trigger | Visible? |
|---|---|---|
| 1 · Übermittelt | The user just clicked submit (POST /decisions succeeded) | Always |
| 2 · Claude verarbeitet | First `/pending=true` response on the server (the pickup waker, or the backup cron, picked up the submission) — surfaces via `_picked_up_at` in `/decisions` | Always |
| 3 · Realitäts-Check | Claude POSTs `/status {phase: "reality-check"}` before re-checking the concept against the default branch (`reality-check.md` § The check) — surfaces via `_phase === "reality-check"` | Only once that POST arrives — a check that resolves instantly, or is skipped outright, never shows a step |
| 4 · Implementierung abgeschlossen | Claude POSTs `/status {phase: "implemented"}` after the implement branch finishes — surfaces via `_phase === "implemented"` in `/decisions` | Only for `action: "implement"` submissions |

**Step 3 reveals itself, it is not pre-armed.** `resetStatusSteps` leaves it
hidden even for an implement submission, because the overwhelmingly common case
is a remote that has not moved — and a step that appears, sits at "pending" and
then flips straight to done would advertise work that never happened. It becomes
visible the moment the `reality-check` phase actually lands, which is also the
only moment its duration is worth showing.

The browser only writes step state in `submitWithAction` (reset to baseline)
and in `updateStatusSteps` (advance based on server fields). After
`/reload` lands, the freshly loaded page is in ready state, so the steps
naturally reset for the next submission.

```javascript
// Lookup helper — every step access goes through this.
function _stepEl(name) {
  return document.querySelector('#status-steps li[data-step="' + name + '"]');
}

function _setStep(name, state, icon) {
  const li = _stepEl(name);
  if (!li) return;
  li.dataset.state = state;
  const iconEl = li.querySelector('.step-icon');
  if (iconEl && icon) iconEl.textContent = icon;
  if (typeof renderStatusDots === 'function') renderStatusDots();
}

// Compact mirror of the <ol> for the pinned status line: one dot per VISIBLE
// step, carrying that step's data-state. The <ol> stays the source of truth
// (and stays in the DOM, expandable under the line) — the dots never hold
// state of their own, so they cannot disagree with the list.
function renderStatusDots() {
  const dots = document.getElementById('status-dots');
  const list = document.getElementById('status-steps');
  if (!dots || !list) return;
  dots.innerHTML = '';
  list.querySelectorAll('li[data-step]').forEach(li => {
    if (li.hidden) return;
    const dot = document.createElement('i');
    dot.dataset.state = li.dataset.state || 'pending';
    dots.appendChild(dot);
  });
}

// Baseline shown immediately after a submit click. Step 1 done, step 2
// active (waiting for /pending pickup), the implement step either hidden
// (iterate) or pending-and-visible (implement), and the reality-check step
// ALWAYS hidden — it reveals itself only if the check actually runs, see
// § Submit Progress Steps.
function resetStatusSteps(action) {
  _setStep('submitted', 'done', '✓');
  _setStep('received', 'active', '⏳');
  const rc = _stepEl('reality-check');
  if (rc) {
    rc.hidden = true;
    rc.dataset.state = 'pending';
    const rcIcon = rc.querySelector('.step-icon');
    if (rcIcon) rcIcon.textContent = '○';
  }
  const impl = _stepEl('implemented');
  if (impl) {
    impl.hidden = (action !== 'implement');
    impl.dataset.state = 'pending';
    const iconEl = impl.querySelector('.step-icon');
    if (iconEl) iconEl.textContent = '○';
  }
  if (typeof renderStatusDots === 'function') renderStatusDots();
}

// Called from pollProcessedState on every tick. Idempotent — re-applying
// the same server state is a no-op.
function updateStatusSteps(data) {
  if (!_submittedAt) return;
  if (data && data._picked_up_at) {
    const recv = _stepEl('received');
    if (recv && recv.dataset.state !== 'done') {
      _setStep('received', 'done', '✓');
      // If implement is the queued action, the third step now becomes
      // the active waiter. For iterate, step 3 stays hidden and the
      // /reload-driven page reload is the implicit "done".
      if (_submittedAction === 'implement') {
        const impl = _stepEl('implemented');
        if (impl && !impl.hidden && impl.dataset.state === 'pending') {
          _setStep('implemented', 'active', '⏳');
        }
      }
    }
  }
  if (data && data._phase === 'reality-check' && _submittedAction === 'implement') {
    // The check is running. Reveal the step now — this is the only place that
    // unhides it, so a skipped or instant check never advertises itself.
    // reality-check implies received, same monotonic argument as below.
    const recv = _stepEl('received');
    if (recv && recv.dataset.state !== 'done') {
      _setStep('received', 'done', '✓');
    }
    const rc = _stepEl('reality-check');
    if (rc && rc.dataset.state !== 'done') {
      rc.hidden = false;
      _setStep('reality-check', 'active', '⏳');
    }
  }
  if (data && data._phase === 'implemented' && _submittedAction === 'implement') {
    // implemented implies received — if /status arrives before the cron's
    // /pending=true has stamped _picked_up_at (rare but possible: Claude
    // POSTed /status before its first /pending fetch landed), step 2 must
    // still flip to done so the list stays monotonically consistent.
    const recv = _stepEl('received');
    if (recv && recv.dataset.state !== 'done') {
      _setStep('received', 'done', '✓');
    }
    // Same for the reality check, but only when it made itself visible — an
    // invisible step must not pop into existence already ticked.
    const rc = _stepEl('reality-check');
    if (rc && !rc.hidden && rc.dataset.state !== 'done') {
      _setStep('reality-check', 'done', '✓');
    }
    const impl = _stepEl('implemented');
    if (impl && !impl.hidden && impl.dataset.state !== 'done') {
      _setStep('implemented', 'done', '✓');
    }
  }
}
```

