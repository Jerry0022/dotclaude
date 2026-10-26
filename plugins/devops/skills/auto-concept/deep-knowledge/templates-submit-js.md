# Concept templates, part 35 of 42: Shared systems — two-button submit JS

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
// The panel of a final report is a TO-DO INBOX, not a questionnaire. Its
// history, in short: four buttons at once (no order, no way to want more than
// one), a four-step wizard (every "Weiter" looked like it already did
// something), a wall of questions, and a sequential accordion with "n von N"
// and "Weiter ›" (one line per question, still a staged form). What the user
// actually has to do at the end of a concept is smaller than any of those:
//   🧭 Du entscheidest  the Funde — each PRE-SELECTED (⚡ / 📌 / ✕) with a
//                       one-word reason; a tap opens a bottom sheet to change it
//   🧪 Du testest       what Claude could not verify — Muss nicht · Mit
//                       Anleitung · Mach ich selbst, pre-selected
//   👉 Du machst danach the manual hand-offs — the same three-way choice
// and under the divider the 🤖 group (what Claude does on the click, the
// disposition as one editable line) plus TWO buttons that ARE the ship answer:
// "🏁🚀 Abschließen & shippen" / "🏁 Nur abschließen, nicht shippen". Both
// submit `finalize`; there is nothing else to confirm, so there is no
// progress counter and no "Weiter ›". Claude runs the parts in a fixed order
// (issues → implement → ship → cleanup, § One submission, four consequences).
//
// Pre-selection is AUTHORED, not guessed here: Claude writes
// data-route-default / data-route-reason on every Fund and data-crit /
// data-guide on every 🧪/👉 item (step5-update-page.md § Final-report append).
// The engine only falls back to the harmless choice when an attribute is
// missing: 📌 Issue for a Fund (writes no code), and "Mach ich selbst" for a
// to-do whose criticality is not low.
const CLOSEOUT_DEFAULT_ROUTE = 'issue';
const CLOSEOUT_ROUTES = ['implement', 'issue', 'ignore'];
const CLOSEOUT_MODES = ['skip', 'guide', 'self'];
// At most three rows per group — the inbox must stay readable at a glance.
// More than three Funde: the first two keep their own row and the rest
// become ONE Sammel-Issue row (closeoutFundeSplit()).
const CLOSEOUT_GROUP_MAX = 3;
const CLOSEOUT_SAMMEL_KEY = '__sammel';
// The user's choices on the sheet, in memory only. Never localStorage and
// never a named, persisted radio: saveState() restores named radios
// document-wide, and a remembered "⚡ Jetzt umsetzen" would sail through a
// later close-out and write code nobody re-authorised. A reload falls back to
// what Claude authored; a tab switch (refreshCloseout({ reset: true })) keeps
// the choices, keyed by item id.
const _closeoutChoices = { route: {}, mode: {} };

function finalReportSection() {
  const active = document.querySelector('section[data-iteration][data-active]');
  return (active && active.hasAttribute('data-final-report')) ? active : null;
}

// The Funde are NON-INTERACTIVE elements in the report body — any element in
// the [data-open-questions] block that carries data-issue-title (normally the
// <li> of the 🔍 fold). The report body has no checkboxes any more: the FAB
// is the only place to answer. A Fund Claude has already routed carries
// data-routed (it writes the issue link / "umgesetzt" note at the same time)
// and drops out here; once every Fund is routed the 🧭 group disappears.
// A legacy report's checkbox still counts while it is enabled.
function openQuestionBoxes() {
  const active = finalReportSection();
  const block = active ? active.querySelector('[data-open-questions]') : null;
  if (!block) return [];
  return Array.from(block.querySelectorAll('[data-issue-title]'))
    .filter(el => !el.disabled && !el.hasAttribute('data-routed'));
}

// The id Claude gets back in the payload: whatever the report declared.
function followUpId(el) {
  return el.dataset.oqId || el.getAttribute('name') || el.id || '';
}

// The key the in-memory choice is stored under — which is not the same thing.
// A hand-written report can repeat an id or leave it off; two Funde sharing a
// key would answer for each other. So the key is the declared id when it is
// usable and a disambiguated one when it is not — the payload keeps the
// declared value either way.
function followUpKeys(items) {
  const seen = {};
  return items.map((el, i) => {
    const raw = followUpId(el);
    if (!raw) return 'pos-' + i;
    seen[raw] = (seen[raw] || 0) + 1;
    return seen[raw] === 1 ? raw : raw + '~' + seen[raw];
  });
}

// What Claude pre-selected. `now` is the authored spelling of ⚡ (the
// payload bucket is `implement`); a legacy unchecked checkbox meant "drop".
function routeDefault(el) {
  if (el.type === 'checkbox' && !el.checked) return 'ignore';
  const raw = String(el.dataset.routeDefault || '').toLowerCase();
  if (raw === 'now' || raw === 'implement') return 'implement';
  if (raw === 'issue' || raw === 'ignore') return raw;
  return CLOSEOUT_DEFAULT_ROUTE;
}
function followUpRoute(key, el) {
  const chosen = _closeoutChoices.route[key];
  if (CLOSEOUT_ROUTES.includes(chosen)) return chosen;
  return el ? routeDefault(el) : CLOSEOUT_DEFAULT_ROUTE;
}

// The short, plain-language name of a Fund: the visible .oq-label, else the
// issue title without its "[TYPE] " prefix.
function followUpLabel(el) {
  const labelEl = el.querySelector('.oq-label') || el.closest('label')?.querySelector('.oq-label');
  if (labelEl) return labelEl.textContent.trim();
  return String(el.dataset.issueTitle || '').replace(/^\[[A-Z]+\]\s*/, '').trim();
}

// One payload item. `description` = explicit data-issue-body, else the
// visible label. Either is enough for Claude to skip the auto-issue
// AskUserQuestion path — the user committed against the plan on screen, so
// we MUST NOT ask again. The same shape feeds both buckets: a Fund routed to
// ⚡ carries exactly the context an implementing agent needs.
function followUpItem(el) {
  const labelText = followUpLabel(el);
  return {
    id: followUpId(el),
    title: el.dataset.issueTitle || labelText,
    type: el.dataset.issueType || 'chore',
    description: el.dataset.issueBody || labelText,
    // Optional project-specific label hints — picked up by Claude when
    // present, silently ignored when absent.
    role: el.dataset.issueRole || null,
    module: el.dataset.issueModule || null,
    milestone: el.dataset.issueMilestone || null,
    selected: true
  };
}

// ≤ 3 Funde: one row each. More: the first two keep their row, the rest are
// ONE Sammel-Issue row — the order is the report's, so Claude lists the Funde
// that most need a decision first.
function closeoutFundeSplit() {
  const items = openQuestionBoxes();
  const keys = followUpKeys(items);
  const all = items.map((el, i) => ({ el, key: keys[i] }));
  if (all.length <= CLOSEOUT_GROUP_MAX) return { rows: all, rest: [] };
  return { rows: all.slice(0, CLOSEOUT_GROUP_MAX - 1), rest: all.slice(CLOSEOUT_GROUP_MAX - 1) };
}
// The Sammel row is an issue or nothing — building a bundle of unrelated
// Funde in one go is not a route this sheet offers.
function sammelRoute() {
  return _closeoutChoices.route[CLOSEOUT_SAMMEL_KEY] === 'ignore' ? 'ignore' : 'issue';
}
function sammelItem(rest) {
  const sheet = document.getElementById('closeout-sheet');
  const tpl = (sheet && sheet.dataset.labelSammelTitle) || '{n}';
  return {
    id: CLOSEOUT_SAMMEL_KEY,
    title: tpl.replace('{n}', String(rest.length)),
    type: 'chore',
    description: rest.map(r => {
      const it = followUpItem(r.el);
      return '- ' + it.title + (it.description && it.description !== it.title ? ': ' + it.description : '');
    }).join('\n'),
    role: null,
    module: null,
    milestone: null,
    selected: true,
    collected: rest.map(r => followUpItem(r.el))
  };
}

function collectFollowUps(route) {
  const { rows, rest } = closeoutFundeSplit();
  const out = rows.filter(r => followUpRoute(r.key, r.el) === route).map(r => followUpItem(r.el));
  if (rest.length && sammelRoute() === route) out.push(sammelItem(rest));
  return out;
}

// Two buckets out of one list. They are disjoint by construction — a row has
// exactly one route — so a Fund can never be filed AND built.
function collectIssueItems() { return collectFollowUps('issue'); }
function collectImplementItems() { return collectFollowUps('implement'); }

// --- 🧪 / 👉 to-dos ---
// 🧪 = what Claude could not verify ([data-tests]), 👉 = what the user does by
// hand afterwards ([data-handoffs]). One <li> each, non-interactive, with
// data-crit (low | mid | high) and data-guide (web | desktop | empty).
const CLOSEOUT_TODO_BLOCK = { tests: '[data-tests]', handoffs: '[data-handoffs]' };
function todoItems(kind) {
  const section = finalReportSection();
  const block = section && section.querySelector(CLOSEOUT_TODO_BLOCK[kind]);
  return block ? Array.from(block.querySelectorAll('li')) : [];
}
function todoId(kind, el, i) {
  return el.dataset.todoId || el.id || (kind + '-' + (i + 1));
}
function todoKey(kind, el, i) { return kind + ':' + todoId(kind, el, i); }
// Criticality decides first: low → "Muss nicht". Needed and guidable (a web
// task → auto-guide, a PC task → desktop scripts / takeover help) → "Mit
// Anleitung"; needed and not guidable → "Mach ich selbst". An explicit
// data-mode-default wins. "Not guidable" is never shown — choosing "Mit
// Anleitung" there simply means written steps (guide: "inline").
function todoDefaultMode(el) {
  const explicit = el.dataset.modeDefault;
  if (CLOSEOUT_MODES.includes(explicit)) return explicit;
  if (String(el.dataset.crit || '').toLowerCase() === 'low') return 'skip';
  const g = el.dataset.guide;
  return (g === 'web' || g === 'desktop') ? 'guide' : 'self';
}
// Chosen on the sheet, else what Claude stamped after the close-out
// (data-mode, the done state), else the authored default.
function todoMode(kind, el, i) {
  const chosen = _closeoutChoices.mode[todoKey(kind, el, i)];
  if (CLOSEOUT_MODES.includes(chosen)) return chosen;
  if (CLOSEOUT_MODES.includes(el.dataset.mode)) return el.dataset.mode;
  return todoDefaultMode(el);
}
function todoGuide(el, mode) {
  if (mode !== 'guide') return null;
  const g = el.dataset.guide;
  return (g === 'web' || g === 'desktop') ? g : 'inline';
}
function todoText(el) {
  const t = el.querySelector('.todo-text');
  return (t ? t.textContent : el.textContent).trim().replace(/\s+/g, ' ');
}
function collectTodos(kind) {
  return todoItems(kind).map((el, i) => {
    const mode = todoMode(kind, el, i);
    return { id: todoId(kind, el, i), text: todoText(el), mode, guide: todoGuide(el, mode) };
  });
}

function collectDisposition() {
  const sheet = document.getElementById('closeout-sheet');
  const scope = sheet || document;
  const radio = scope.querySelector('input[name="dispose-mode"]:checked');
  const moveEl = document.getElementById('dispose-move-to');
  const mode = radio ? radio.value : 'discard';
  const moveTo = (moveEl && moveEl.value.trim()) ? moveEl.value.trim() : null;
  return { mode, moveTo };
}
```

