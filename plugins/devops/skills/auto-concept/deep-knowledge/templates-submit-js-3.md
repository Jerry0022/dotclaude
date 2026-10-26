# Concept templates, part 37 of 43: Shared systems — two-button submit JS (continued 3)

```javascript
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

// No "Runden ansehen" link under the sheet: earlier rounds are one click
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
  // An active choice in a single-choice row confirms it like "Weiter ›"
  // (closeoutChoiceClick()). `click`, not `change`: re-clicking the
  // pre-selected default fires no change but is just as much an answer.
  document.getElementById('closeout-sheet')?.addEventListener('keydown', closeoutChoiceKeydown, true);
  document.getElementById('closeout-sheet')?.addEventListener('click', closeoutChoiceClick);
  refreshCloseout({ reset: true });
  restoreInFlightCloseout();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireCloseout);
} else {
  wireCloseout();
}

// --- Offline Submit Queue ---
// Runs on EVERY connected heartbeat — also while the submitted panel is up,
// because that is exactly when an offline submit sits queued. So it must be
// idempotent: one retry at a time (a slow POST outlives the 5 s heartbeat),
// and never alongside submitWithAction()'s own POST of the same payload.
let _pendingRetryInFlight = false;
async function retryPendingSubmission() {
  if (_pendingRetryInFlight || _submitInFlight) return;
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  _pendingRetryInFlight = true;
  try { await _deliverPending(pendingKey, pending); }
  finally { _pendingRetryInFlight = false; }
  // Images that never made it up get another attempt on the same trigger.
  if (typeof restoreAttachments === 'function') restoreAttachments();
}
// A bridge that accepts the connection and never answers must not hold the
// retry forever: _pendingRetryInFlight is released only when this settles, so
// every later heartbeat would skip the queued payload until a reload. One
// deadline covers the whole attempt, body reads included.
const PENDING_RETRY_TIMEOUT_MS = 15000;
async function _deliverPending(pendingKey, pending) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), PENDING_RETRY_TIMEOUT_MS) : null;
  const signal = ctl ? ctl.signal : undefined;
  try {
    // Did this exact payload already land? `fetch` can throw after the bridge
    // has fsynced (tab closed, Wi-Fi drop mid-response), which queues a payload
    // that is already being processed. Re-POSTing a finalize that way runs its
    // side effects — issue creation, a real release, file deletion — a second
    // time, and an iterate/implement round twice. Every payload carries a
    // submission_id (submitWithAction, submitFinalize); only a payload from a
    // page generated before that keeps the old unconditional retry.
    try {
      const id = JSON.parse(pending).submission_id;
      if (id) {
        const cur = await fetch('/decisions', { cache: 'no-store', signal });
        const seen = cur.ok ? await cur.json().catch(() => ({})) : {};
        if (seen.submission_id === id) { _pendingDelivered(pendingKey); return; }
      }
    } catch (e) { /* unparseable or bridge unreachable — fall through and retry */ }
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending,
      signal
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    // Drop the local copy ONLY once the bridge confirms it reached disk.
    // `res.ok` alone is not that confirmation — see submitWithAction — and
    // neither is a body the deadline cut off.
    if (res.ok && body.durable !== false && !(signal && signal.aborted)) _pendingDelivered(pendingKey);
  } catch (e) { /* still offline, or the deadline hit */ }
  finally { if (timer) clearTimeout(timer); }
}
// The queued round reached the bridge: drop the local copy, retire the
// "bridge unreachable, will retry" note (only the attachments note can still
// hold), and veil the round again — a reload while it sat in the queue came
// back unveiled, because the bridge had nothing yet (restoreInFlightRound
// does nothing while the round is already shown as sent).
function _pendingDelivered(pendingKey) {
  localStorage.removeItem(pendingKey);
  if (typeof clearSubmitWarning === 'function') clearSubmitWarning();
  if (typeof unsyncedAttachmentCount === 'function' && unsyncedAttachmentCount() > 0
      && typeof showSubmitWarning === 'function') showSubmitWarning('{{panel.attachments_not_synced}}');
  if (typeof restoreInFlightRound === 'function') restoreInFlightRound();
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

