# Concept templates, part 36 of 42: Shared systems — two-button submit JS (continued 2)

```javascript
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
  confirmCloseoutRow(open);
}
// Marks one row answered and opens the next unanswered one (or keeps this
// one open when nothing is left — the button then reads "⚠ Ausführen").
// Shared by "Weiter ›" and an active choice inside a single-choice row
// (closeoutChoiceClick()); it never submits, so confirming the LAST row by
// a choice click can never also fire the finalize.
function confirmCloseoutRow(block) {
  block.dataset.answered = 'true';
  const answered = loadCloseoutAnswered();
  answered[block.dataset.closeoutBlock] = true;
  saveCloseoutAnswered(answered);
  const next = closeoutRows().find(r => r.dataset.answered !== 'true');
  openCloseoutRow(next || block);
  refreshCloseoutRows();
}
// The rows whose whole answer is ONE radio choice. Actively clicking one of
// their options — also the pre-selected default — IS the answer, the same as
// "Weiter ›": the user said "Ship" or "Seite löschen", making them click a
// second button to mean it was pure friction. "Weiter ›" stays as the way to
// take the default without touching it. The followups row is deliberately
// not one of them: it holds one route per open point, so a click on the
// first point's route must not collapse the row before the others are seen.
const CLOSEOUT_SINGLE_CHOICE = { ship: 'closeout-ship', files: 'dispose-mode' };
// Arrow keys move a radio group's selection AND dispatch a click — that is
// browsing the options, not choosing one, so it must not advance the sheet
// (otherwise the middle option of three could never be passed by keyboard).
// Space/Enter and pointer clicks stay active choices.
let _closeoutArrowNav = false;
function closeoutChoiceKeydown(e) {
  if (/^Arrow/.test(e.key)) {
    _closeoutArrowNav = true;
    setTimeout(() => { _closeoutArrowNav = false; }, 0);
  }
}
function closeoutChoiceClick(e) {
  const input = e.target;
  if (!input || !input.matches || !input.matches('input[type="radio"]')) return;
  if (_closeoutArrowNav) return;
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet || sheet.dataset.frozen === 'true') return;
  const block = input.closest('.closeout-block');
  if (!block || block.dataset.open !== 'true') return;
  if (CLOSEOUT_SINGLE_CHOICE[block.dataset.closeoutBlock] !== input.name) return;
  const req = document.getElementById('closeout-ship-required');
  if (req && block.dataset.closeoutBlock === 'ship') req.hidden = true;
  confirmCloseoutRow(block);
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
```

