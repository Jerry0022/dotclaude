# Concept templates, part 35 of 43: Shared systems — two-button submit JS

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
  // a Claude turn on accidental clicks. A changed page implements without a
  // dialog: the implement button already sits behind its own second step
  // (the journey's 🔒 unlock, the split button's caret menu).
  if (!_userInteracted) {
    const msg = (action === 'implement')
      ? '{{panel.empty_implement_confirm}}'
      : '{{panel.empty_iterate_confirm}}';
    if (!window.confirm(msg)) return;
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
  // The offline queue's replay guard (§ Offline Submit Queue): a round the
  // bridge stored before its answer was lost must not be POSTed a second time.
  if (typeof newSubmissionId === 'function') data.submission_id = newSubmissionId();
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
      // The heartbeat retry keeps offering the local copy, but nothing says
      // when the store recovers — so do NOT leave a "sent" panel standing
      // over it: hand control back and say why (a later delivery veils the
      // round again, _pendingDelivered()).
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
// over a round already in flight. So ask the bridge (and, ONLY when the bridge
// cannot be reached, the local queue) whether a payload for the live round is
// still pending, and if so put the round back exactly as submitWithAction()
// left it. The veil is then
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
  let bridgeThrew = false;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch (e) { bridgeThrew = true; }
  // The local queue speaks only for an UNREACHABLE bridge. A bridge that
  // answers and reports nothing pending is the truth: a `-pending` copy next
  // to it is a payload that never arrived (or one already processed), and
  // veiling the round over it promised "Claude arbeitet" for a round Claude
  // never received. retryPendingSubmission() delivers that copy on the next
  // connected heartbeat instead.
  if (bridgeThrew) {
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
// Shippen, Issues erstellen, Concept beenden, Runden ansehen — each with
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
```

