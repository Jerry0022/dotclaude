# Concept templates, part 37 of 41: Shared systems — journey row, panel state reset, submit progress

## Journey row

The bottom of every live panel is ONE row plus ONE status line (CSS in
`templates-panel-state.md` § Journey row):

```
[ 👉 Zur nächsten Runde | 🤖 ] — 🔒 — 🤖 — 🏁        👉 Du bist dran · gespeichert
```

- **Round toggle** (`.jr-round`): left half = `#submit-iterate-btn` (the
  iterate submit, unchanged semantics), right half 🤖 (tooltip "Rethinking").
  After an iterate submit it mirrors: ✓ left, the right half fills as the
  **run bar** "Rethinking x/y" — `x/y` = done / visible steps of
  `#status-steps`, tooltip = the active step's label.
- **Lock** (`#jr-lock`, yellow circle, tooltip "Genug Runden? Jetzt
  umsetzen"): click = unlock (`data-phase="unlock"`, local UI state, never
  persisted). The round toggle shrinks into the mini toggle (`.jr-mini`,
  ↩ | 🤖) while the implement toggle (`.jr-impl`) grows out of the lock
  position; its left half is `#submit-implement-btn` ("🔓 Jetzt umsetzen /
  keine weitere Runde", implement semantics unchanged), right half 🤖
  "Umsetzung". ↩ (or Escape inside the row) reverts.
- **Implementing** (after an implement submit): the mini toggle shows two
  bold ✓ (SVG `.jr-chk`), the implement toggle shows ✓ + run bar
  "Umsetzung n/m" from the bridge's optional `_progress` (`/status`
  `progress: {done, total}`, step5-process.md); absent → indeterminate bar.
- **Build-up**: the first time the panel opens in a round the row assembles
  left → right (`.journey.jr-build`, 120 ms stagger); remembered per round in
  sessionStorage.
- The phase is mirrored on `body[data-journey]` (round chip colour) and
  `#panel-status[data-turn]` (you | rethinking | implementing | frozen).

The split-button markup (`.submit-split`, `#submit-menu`) stays in both
skeletons as the no-JS source; mountJourney() moves the two buttons into the
row and retires the rest (`.submit-split[hidden]` remains as the anchor the
design overview's open-questions hint inserts before).

```javascript
const _JR_CHK = '<svg class="jr-chk" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
let _journeyUnlocked = false;
let _journeyProgress = null;   // {done, total} from /decisions `_progress`
let _journeyDone = false;      // implement finished (`_phase === "implemented"`)

function _jrEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// The run bar — ONE builder for the panel halves and the toast, so both
// always look identical.
function buildRunBar(label) {
  const run = _jrEl('span', 'jr-run');
  const done = _jrEl('i', 'jr-run-done');
  done.appendChild(_jrEl('i', 'jr-shine'));
  run.append(done, _jrEl('span', 'jr-bot', '🤖'), _jrEl('b', 'jr-run-label', label), _jrEl('em', 'jr-count'));
  return run;
}

// {done, total, tip} for the current phase, or null (indeterminate).
function journeyCounter(phase) {
  if (phase === 'implementing') {
    const p = _journeyProgress;
    if (p && p.total > 0) {
      const n = _journeyDone ? p.total : p.done;
      return { done: n, total: p.total,
        tip: '{{panel.journey_req}}'.replace('{n}', String(Math.max(1, Math.min(p.total, n + (n < p.total ? 1 : 0))))).replace('{m}', String(p.total)) };
    }
    return _journeyDone ? { done: 1, total: 1, tip: '{{panel.step_implemented}}' } : null;
  }
  const list = document.getElementById('status-steps');
  if (!list) return null;
  const vis = [...list.querySelectorAll('li[data-step]')].filter(li => !li.hidden);
  if (!vis.length) return null;
  const done = vis.filter(li => li.dataset.state === 'done').length;
  const act = vis.find(li => li.dataset.state === 'active') || vis[vis.length - 1];
  const lab = act.querySelector('.step-label[data-state-label="active"]') || act.querySelector('.step-label');
  const idx = vis.indexOf(act) + 1;
  return { done, total: vis.length,
    tip: '{{panel.journey_step}}'.replace('{n}', String(idx)).replace('{m}', String(vis.length))
      .replace('{label}', lab ? lab.textContent.trim() : '') };
}

function paintRunBar(run, phase, paused) {
  if (!run) return;
  const c = journeyCounter(phase);
  const fill = run.querySelector('.jr-run-done');
  const em = run.querySelector('.jr-count');
  if (c) {
    run.removeAttribute('data-indeterminate');
    if (fill) fill.style.width = Math.round(100 * c.done / c.total) + '%';
    if (em) { em.textContent = c.done + '/' + c.total; em.dataset.tip = c.tip; }
  } else {
    run.setAttribute('data-indeterminate', '');
    if (fill) fill.style.width = '';
    if (em) { em.textContent = ''; delete em.dataset.tip; }
  }
  if (paused) run.setAttribute('data-paused', ''); else run.removeAttribute('data-paused');
}

function journeyPhase() {
  const submitted = (typeof _submittedAt === 'number' && _submittedAt > 0)
    || document.body.classList.contains('concept-submitted');
  const action = (typeof _submittedAction === 'string') ? _submittedAction : null;
  if (submitted) return action === 'implement' ? 'implementing' : 'rethinking';
  return _journeyUnlocked ? 'unlock' : 'you';
}

function mountJourney() {
  if (document.getElementById('journey')) return document.getElementById('journey');
  const host = document.getElementById('panel-status');
  const iterate = document.getElementById('submit-iterate-btn');
  const implement = document.getElementById('submit-implement-btn');
  if (!host || !iterate || !implement) return null;
  const row = _jrEl('div', 'journey');
  row.id = 'journey';
  row.dataset.phase = 'you';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '{{panel.journey_label}}');

  // Round toggle: full face (iterate | 🤖  ·  ✓ | Rethinking bar) + mini face.
  const round = _jrEl('span', 'jr-toggle jr-round');
  const full = _jrEl('span', 'jr-face jr-face-full');
  const rOther = _jrEl('span', 'jr-other jr-round-other', '🤖');
  rOther.dataset.tip = '{{panel.journey_rethinking}}';
  const rDone = _jrEl('span', 'jr-other jr-round-done');
  rDone.dataset.ok = '';
  rDone.innerHTML = _JR_CHK;
  const rRun = buildRunBar('{{panel.journey_rethinking}}');
  rRun.classList.add('jr-round-run');
  iterate.classList.add('jr-fill');
  full.append(rDone, iterate, rRun, rOther);
  const miniFace = _jrEl('span', 'jr-face jr-face-mini');
  const mini = _jrEl('button', 'jr-mini');
  mini.type = 'button';
  mini.id = 'jr-back';
  mini.dataset.tip = '{{panel.journey_back}}';
  mini.setAttribute('aria-label', '{{panel.journey_back}}');
  const d1 = _jrEl('span', 'jr-dot');
  d1.dataset.on = '';
  d1.innerHTML = '<span>↩</span>' + _JR_CHK;
  const d2 = _jrEl('span', 'jr-dot');
  d2.innerHTML = '<span>🤖</span>' + _JR_CHK;
  mini.append(d1, d2);
  miniFace.appendChild(mini);
  round.append(full, miniFace);

  // Implement toggle: lock face + implement face + implementing face.
  const impl = _jrEl('span', 'jr-toggle jr-impl');
  const lockFace = _jrEl('span', 'jr-face jr-face-lock');
  const lock = _jrEl('button', 'jr-lock', '🔒');
  lock.type = 'button';
  lock.id = 'jr-lock';
  lock.dataset.tip = '{{panel.journey_lock}}';
  lock.setAttribute('aria-label', '{{panel.journey_lock}}');
  lockFace.appendChild(lock);
  const implFace = _jrEl('span', 'jr-face jr-face-impl');
  implement.classList.add('jr-fill');
  implement.removeAttribute('role');
  implement.replaceChildren();
  const ico = _jrEl('span', 'jr-ul-ico', '🔓');
  ico.setAttribute('aria-hidden', 'true');
  const txt = _jrEl('span', 'jr-ul-txt');
  txt.append(_jrEl('b', '', '{{panel.submit_implement}}'), _jrEl('small', '', '{{panel.submit_implement_sub}}'));
  implement.append(ico, txt);
  const iOther = _jrEl('span', 'jr-other', '🤖');
  iOther.dataset.tip = '{{panel.journey_implement}}';
  implFace.append(implement, iOther);
  const runFace = _jrEl('span', 'jr-face jr-face-run');
  const iDone = _jrEl('span', 'jr-other');
  iDone.dataset.ok = '';
  iDone.dataset.tip = '{{panel.journey_done}}';
  iDone.innerHTML = _JR_CHK;
  const iRun = buildRunBar('{{panel.journey_implement}}');
  iRun.classList.add('jr-impl-run');
  runFace.append(iDone, iRun);
  impl.append(lockFace, implFace, runFace);

  const wire = (cls) => _jrEl('i', 'jr-wire' + (cls ? ' ' + cls : ''));
  const node = (glyph, tip, cls) => {
    const n = _jrEl('span', 'jr-node' + (cls ? ' ' + cls : ''), glyph);
    n.dataset.tip = tip;
    return n;
  };
  row.append(round, wire('jr-wire-a'), impl, wire('jr-fold'),
    node('🤖', '{{panel.journey_implement}}', 'jr-fold'), wire(), node('🏁', '{{panel.journey_finish}}'));
  host.insertBefore(row, host.firstChild);

  // Retire the split button + menu; keep the (empty, hidden) split as anchor.
  const split = document.querySelector('.submit-split');
  if (split) split.hidden = true;
  const menu = document.getElementById('submit-menu');
  if (menu) { menu.hidden = true; menu.classList.add('jr-retired'); }

  lock.addEventListener('click', () => setJourneyUnlocked(true));
  mini.addEventListener('click', () => setJourneyUnlocked(false));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && row.dataset.phase === 'unlock') { e.stopPropagation(); setJourneyUnlocked(false); }
  });
  renderJourney();
  return row;
}

function setJourneyUnlocked(on) {
  if (journeyPhase() !== 'you' && journeyPhase() !== 'unlock') return;
  _journeyUnlocked = !!on;
  renderJourney();
  const target = document.getElementById(on ? 'submit-implement-btn' : 'submit-iterate-btn');
  // Focus after the cross-fade so the ring never lands on an invisible face.
  if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); } catch (e) {} }, 420);
}

function renderJourney() {
  const row = document.getElementById('journey');
  const phase = journeyPhase();
  document.body.dataset.journey = phase;
  if (!row) return phase;
  row.dataset.phase = phase;
  const on = (sel, yes) => { const n = row.querySelector(sel); if (n) { if (yes) n.dataset.on = ''; else delete n.dataset.on; } };
  const mini = (phase === 'unlock' || phase === 'implementing');
  on('.jr-face-full', !mini);
  on('.jr-face-mini', mini);
  on('.jr-face-lock', !mini);
  on('.jr-face-impl', phase === 'unlock');
  on('.jr-face-run', phase === 'implementing');
  const show = (sel, yes) => { const n = row.querySelector(sel); if (n) n.hidden = !yes; };
  show('#submit-iterate-btn', phase !== 'rethinking');
  show('.jr-round-other', phase !== 'rethinking');
  show('.jr-round-done', phase === 'rethinking');
  show('.jr-round-run', phase === 'rethinking');
  const lock = row.querySelector('#jr-lock');
  if (lock) lock.disabled = (phase === 'rethinking');
  const back = row.querySelector('#jr-back');
  if (back) {
    back.disabled = (phase === 'implementing');
    back.tabIndex = (phase === 'unlock') ? 0 : -1;
  }
  const wa = row.querySelector('.jr-wire-a');
  if (wa) { if (phase === 'implementing') wa.dataset.ok = ''; else delete wa.dataset.ok; }
  const conn = (document.getElementById('connection-status') || {}).dataset;
  const paused = !!(conn && conn.state === 'disconnected');
  if (phase === 'rethinking') paintRunBar(row.querySelector('.jr-round-run'), phase, paused);
  if (phase === 'implementing') paintRunBar(row.querySelector('.jr-impl-run'), phase, paused);
  return phase;
}

// Build-up: once per round, on the first panel open (sessionStorage).
function _journeyBuildKey() {
  const live = document.querySelector('section[data-iteration][data-active]');
  const base = (typeof STORAGE_KEY === 'string') ? STORAGE_KEY : 'concept';
  return base + '-jr-built-' + (live ? live.dataset.iteration : '0');
}
function maybeBuildJourney() {
  const row = document.getElementById('journey');
  if (!row || !document.body.classList.contains('panel-open')) return;
  const key = _journeyBuildKey();
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) { return; }
  row.classList.remove('jr-build');
  void row.offsetWidth;
  row.classList.add('jr-build');
  setTimeout(() => row.classList.remove('jr-build'), 1400);
}

// Final report: the status line is hidden there (the sheet's button carries
// the state), so the journey shows as its own finished row at the top of
// #panel-final-report — ✓✓ · Umsetzung ✓ · 🏁 lit — not interactive, built
// up left → right the first time the final report opens.
function mountFinalJourney() {
  const host = document.getElementById('panel-final-report');
  if (!host || host.querySelector('.journey-final')) return null;
  const row = _jrEl('div', 'journey journey-final');
  row.dataset.phase = 'done';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', '{{panel.journey_done}}');
  const round = _jrEl('span', 'jr-toggle jr-round');
  const dots = _jrEl('span', 'jr-mini');
  for (let i = 0; i < 2; i++) { const d = _jrEl('span', 'jr-dot'); d.innerHTML = _JR_CHK; dots.appendChild(d); }
  round.appendChild(dots);
  const impl = _jrEl('span', 'jr-toggle jr-impl');
  const run = _jrEl('span', 'jr-run');
  const fill = _jrEl('i', 'jr-run-done');
  fill.style.width = '100%';
  const ok = _jrEl('span', 'jr-other');
  ok.dataset.ok = '';
  ok.innerHTML = _JR_CHK;
  run.append(fill, ok, _jrEl('b', '', '{{panel.journey_implement}}'));
  impl.appendChild(run);
  const finish = _jrEl('span', 'jr-node jr-finish', '🏁');
  finish.dataset.tip = '{{panel.journey_finish}}';
  const wire = () => { const w = _jrEl('i', 'jr-wire'); w.dataset.ok = ''; return w; };
  row.append(round, wire(), impl, wire(), finish);
  host.insertBefore(row, host.firstChild);
  return row;
}
function maybeBuildFinalJourney() {
  const row = document.querySelector('.journey-final');
  if (!row || !document.body.classList.contains('viewing-final')
    || !document.body.classList.contains('panel-open')) return;
  const base = (typeof STORAGE_KEY === 'string') ? STORAGE_KEY : 'concept';
  try { const k = base + '-jr-built-final'; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) { return; }
  row.classList.remove('jr-build');
  void row.offsetWidth;
  row.classList.add('jr-build');
  setTimeout(() => row.classList.remove('jr-build'), 1400);
}

function _bootJourney() {
  mountJourney();
  mountFinalJourney();
  maybeBuildJourney();
  maybeBuildFinalJourney();
  new MutationObserver(() => { maybeBuildJourney(); maybeBuildFinalJourney(); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
  if (typeof maybeShowNewRoundToast === 'function') maybeShowNewRoundToast();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bootJourney);
else _bootJourney();
```

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
  if (typeof _journeyUnlocked !== 'undefined') {
    _journeyUnlocked = false; _journeyProgress = null; _journeyDone = false;
  }
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

After a submit the journey row's run bar ("Rethinking x/y" / "Umsetzung
n/m", § Journey row) and the status toast show where the submission is. The
four-step `#status-steps` list stays in the DOM (inside the visually retired
`<details class="status-detail">`) as the data model: `x/y` = done / visible
steps, the bar's tooltip = the active step's label. The `#status-dots` mirror
is still rendered (renderStatusDots) but no longer drawn. The states the list tracks:

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
  // The journey bar and the toast read the same <ol> (x/y + tooltip).
  if (typeof renderJourney === 'function') renderJourney();
  if (typeof refreshStatusToast === 'function') refreshStatusToast();
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
  // Journey counter inputs (§ Journey row): the optional implement progress
  // and the implemented phase. Read before the step updates so the bar the
  // _setStep re-render paints is already current.
  if (data && typeof _journeyProgress !== 'undefined') {
    const p = data._progress;
    _journeyProgress = (p && typeof p.total === 'number' && p.total > 0) ? p : _journeyProgress;
    if (data._phase === 'implemented') _journeyDone = true;
  }
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

