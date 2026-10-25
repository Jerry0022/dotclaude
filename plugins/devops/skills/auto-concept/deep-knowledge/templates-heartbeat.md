# Concept templates, part 31 of 33: Claude Connection Heartbeat (HTTP Bridge)

## Claude Connection Heartbeat (HTTP Bridge)

The server response splits the heartbeat into TWO timestamps:

- `claude_ts` — last `POST /heartbeat` from Claude (the polling cron is alive
  and Claude will pick up submissions). This is the field the indicator must
  gate on.
- `server_ts` — daemon-thread self-pulse (the bridge process is alive). The
  GREEN/connected state still gates exclusively on `claude_ts` — `server_ts`
  is never sufficient to show "connected". It is used to distinguish the
  bootstrap window (`claude_ts==0`, server alive → "connecting" indefinitely)
  from a genuinely dead bridge (`server_ts` stale → disconnected warning).
- `ts` — legacy alias of `claude_ts` for back-compat with older pages that
  pre-date the split. Always equal to `claude_ts` on a current server.

Gating on `server_ts` would keep the indicator green even after Claude's
session restarts (cron is session-only and dies with the session) — silently
hiding the case where submissions fall into a black hole. The bug that
motivated the split: `_heartbeat_ts` used to be a single field that the
self-pulse refreshed every 30s, so the page showed "Claude verbunden"
indefinitely no matter what Claude was actually doing.

**Tab liveness — three page-side duties (#397).** The pickup waker re-opens
the page when the user closed its last tab (no tab registered + `/bye`). For that verdict to be
right the page must (a) identify itself, (b) keep polling while hidden, and
(c) say goodbye when it really closes:

- `_tabId` — a per-load random id, appended as `?tab=<id>` to every
  `GET /heartbeat` and `GET /reload`, so the server keeps a per-tab
  registry instead of one anonymous `browser_ts`. Two tabs are two entries;
  a reload is a new id.
- `startHeartbeatWorker` — the `/heartbeat` poll runs in a dedicated
  `Worker` (blob URL). Chromium's intensive wake-up throttling coalesces a
  hidden page's DOM timers to one wake-up per minute after 5 min; worker
  timers are exempt, so the registry stays fresh while the tab is merely in
  the background. Falls back to the main-thread interval when the worker
  cannot start.
- `sendTabBye` — on `pagehide` with `event.persisted === false` the page
  POSTs `/bye` via `navigator.sendBeacon`. Never on `visibilitychange`:
  hidden is not closed. This is the only signal that distinguishes a closed
  tab from a throttled or sleeping one, and it is what lets the waker act
  within a minute of a real close instead of guessing from silence.

**Freeze-aware verdict.** The checker looks at the age of the last *sample*
before it looks at `claude_ts`. A page that was frozen — Edge Sleeping Tabs
or efficiency mode, a PC suspend, a worker that died without `onerror` —
wakes up holding a sample from before the nap, and judging `claude_ts` from
it painted "Nur lokal gespeichert · getrennt" on every return to the tab
(the reported "connection keeps dropping"). `recoverFromFreeze` re-polls at
once, replaces a worker that stayed silent for a minute, and opens a
`WAKE_GRACE_MS` window in which a stale `claude_ts` reads "connecting" —
the pulser's timers were suspended with the machine and need one cycle too.
"disconnected" is painted only after two consecutive stale evaluations, so a
single late pulse from a busy bridge is a blip, not a warning.

```javascript
const HEARTBEAT_STALE_MS = 90000;  // claude_ts older than this → nothing is pulsing
const SERVER_STALE_MS    = 90000;  // server_ts older than this → bridge process down
// HEARTBEAT_GRACE_MS / _pageLoadedAt removed — the bootstrap window is now
// keyed on claude_ts==0 && fresh server_ts (mirrors the concept-server
// watchdog, which tolerates claude_ts==0 indefinitely), not a fixed timer.
let _lastHeartbeatTs = 0;
let _lastServerTs    = 0;
// True once /heartbeat has returned a parseable response at least once. Until
// then the connection state is treated as "connecting" (unknown), NEVER
// "disconnected" — this is the fix for the fresh-page connect→disconnect→
// connect flash: before the first poll lands, _lastServerTs is still 0, so the
// old code mis-classified the unknown window as a dead bridge.
let _everPolled      = false;
// Wall-clock time the last /heartbeat SAMPLE arrived (worker or main thread)
// — as opposed to what the sample said. A gap here means this page was not
// running: Edge put the tab to sleep, the PC suspended, or the worker died.
// None of those is a dead bridge, and the verdict must not say so from a
// sample that predates the gap (see checkClaudeConnection).
let _lastSampleAt    = 0;
const SAMPLE_STALE_MS = 15000;   // > 3 worker ticks without a sample → we were frozen
// After a detected freeze the pulser needs one cycle of its own to catch up
// (its timers were suspended with the machine), so a stale claude_ts inside
// this window is "connecting", not "disconnected".
const WAKE_GRACE_MS   = 45000;
let _wakeGraceUntil   = 0;
// A single stale evaluation never paints the warning: the line flips to
// "getrennt" only when two consecutive checks (≥ 5 s apart) agree.
let _disconnectStreak = 0;
let _lastState        = 'connecting';
let _pollInFlight     = null;

// Per-load tab identity (#397). Rides on every browser-only poll as
// `?tab=<id>` so the bridge can tell two tabs apart and notice when THIS one
// leaves (see sendTabBye). Random per document on purpose: a reload is a new
// tab from the server's point of view — its bye is immediately followed by
// the fresh load's first poll, which is exactly what the waker expects.
const _tabId = (() => {
  try { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
  catch (e) { return Math.random().toString(36).slice(2, 18); }
})();
const _tabQuery = '?tab=' + _tabId;

function applyHeartbeat(data) {
  if (!data || typeof data !== 'object') return;
  // Prefer `claude_ts` (post-split server); fall back to `ts` for
  // back-compat with legacy server builds that only expose the merged field.
  // NEVER use `server_ts` here — the daemon self-pulse would falsely
  // light up the indicator while Claude's polling cron is dead.
  _lastHeartbeatTs = data.claude_ts || data.ts || 0;
  // Consumed by checkClaudeConnection to tell the bootstrap window
  // (claude_ts==0, server alive → "connecting") apart from a dead bridge.
  // NEVER drives the green/connected state — that still gates on claude_ts.
  // Legacy servers without server_ts leave this 0 → serverAlive=false → the
  // bootstrap path is inert and behavior falls back to the old timing.
  _lastServerTs = data.server_ts || 0;
  _everPolled = true;   // we now have real evidence of the bridge state
  _lastSampleAt = Date.now();
}

// Single-flight: a wake-up can fire the visibility handler, the main-thread
// interval and the worker's first message within the same second — one poll
// answers all of them.
function pollHeartbeat() {
  if (_pollInFlight) return _pollInFlight;
  _pollInFlight = (async () => {
    try {
      const res = await fetch('/heartbeat' + _tabQuery, { cache: 'no-store' });
      applyHeartbeat(await res.json());
    } catch (e) { /* server unreachable — leave _everPolled unchanged */ }
    finally { _pollInFlight = null; }
  })();
  return _pollInFlight;
}

// The heartbeat poll lives in a dedicated Worker (#397). A hidden tab's DOM
// timers are throttled by Chromium to ONE wake-up per minute after 5 min in
// the background; worker timers are not. Without this the server saw a
// backgrounded page poll once a minute (or never, with Edge Sleeping Tabs),
// concluded "closed" and opened another tab — every few minutes, all session.
// The worker only fetches and reports; the connection verdict stays on the
// main thread. Absolute URL: a blob worker cannot resolve a relative path.
let _hbWorker = null;
function startHeartbeatWorker() {
  try {
    if (_hbWorker) { try { _hbWorker.terminate(); } catch (e) {} _hbWorker = null; }
    const url = JSON.stringify(location.origin + '/heartbeat' + _tabQuery);
    const src = 'const u=' + url + ';async function p(){try{const r=await fetch(u,{cache:"no-store"});postMessage(await r.json())}catch(e){}}p();setInterval(p,5000);';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (ev) => { applyHeartbeat(ev.data); checkClaudeConnection(); };
    w.onerror = () => { _hbWorker = null; };   // main-thread interval takes over
    _hbWorker = w;
    return true;
  } catch (e) { _hbWorker = null; return false; }
}

// Called from every wake-up path (visibility, main-thread tick, worker
// message) when the last sample is older than the worker's cadence allows:
// re-poll NOW instead of waiting for the next tick, and open the grace
// window so the verdict reads "connecting" until the pulser has had its
// turn. A worker that has been silent for a minute is not trusted to come
// back — it is replaced.
let _lastRecoverAt = 0;
function recoverFromFreeze(now) {
  // Rate-limited: a bridge that is really unreachable makes every poll fail,
  // and each failed poll ends in checkClaudeConnection — without this guard
  // that would be a tight poll loop.
  if (now - _lastRecoverAt < SAMPLE_STALE_MS) return;
  _lastRecoverAt = now;
  if (now - _lastSampleAt > 60000) startHeartbeatWorker();
  _wakeGraceUntil = now + WAKE_GRACE_MS;
  pollHeartbeat().then(checkClaudeConnection);
}

// Unload beacon (#397). `pagehide` with `persisted === false` is the one
// moment a document is really going away (close, navigate, reload); a
// bfcache freeze (`persisted === true`) and a visibility change are not.
// sendBeacon is queued by the browser and survives the document being
// discarded. The server drops this tab from its registry; the waker reopens
// the page only when no tab is left — so hiding the tab never reopens it,
// closing the last one does, once.
function sendTabBye(ev) {
  if (ev && ev.persisted) return;
  try {
    const body = new Blob([JSON.stringify({ tab: _tabId })], { type: 'application/json' });
    if (navigator.sendBeacon && navigator.sendBeacon('/bye', body)) return;
  } catch (e) { /* fall through */ }
  // Drained like every keepalive response (§ State Persistence,
  // _drainDraftResponse): a bfcache-restored page lives on, and an unread
  // keepalive response keeps its body booked against the 64 KiB quota.
  try {
    fetch('/bye', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab: _tabId }), keepalive: true })
      .then(r => r.text(), () => '').catch(() => '');
  }
  catch (e) { /* the server's TAB_STALE_MS prune is the backstop */ }
}
window.addEventListener('pagehide', sendTabBye);

// Safety-net timeout — if Claude /reset stamped _processed_at but no
// reload counter advance ever followed (closed tab, JS error, server
// went down between /reload and /reset), we still want to recover the
// panel rather than leaving the user stuck staring at "submitted".
// 5 minutes is long enough that any well-behaved iteration will have
// reloaded the page first, and short enough that a real stuck state
// recovers without manual intervention.
const PROCESSED_SAFETY_MS = 5 * 60 * 1000;

async function pollProcessedState() {
  if (!_submittedAt) return;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    const data = await res.json();
    // Advance the submit-panel progress list based on the per-submission
    // signals on the server. Done before the processed_at gate so the
    // user sees pickup/implementation states even while the panel is
    // still in the submitted state (i.e. before /reset).
    updateStatusSteps(data);
    const processedIso = data && data._processed_at;
    if (!processedIso) return;
    const processedMs = Date.parse(processedIso);
    if (!Number.isFinite(processedMs) || processedMs <= _submittedAt) return;

    // _processed_at IS newer than submission. Two paths to actually
    // restore the panel:
    //   (a) The reload counter has advanced past submit-time → Claude
    //       wrote a new iteration; pollReload will trigger location.reload()
    //       within 3s. Restoring eagerly here is a no-op visually but
    //       cleans local state.
    //   (b) A long safety timeout elapsed → reload never fired (closed
    //       tab, JS error, network blip); recover so the user is not
    //       stuck on a frozen "submitted" panel.
    // Otherwise: Claude is mid-processing (e.g. /reset arrived but file
    // write + /reload is still pending, or the protocol order was wrong).
    // Keep the panel in "submitted" state so the user cannot duplicate-
    // submit on the still-active old iteration.
    let reloadAdvanced = false;
    try {
      const r2 = await fetch('/reload' + _tabQuery, { cache: 'no-store' });
      if (r2.ok) {
        const { counter } = await r2.json();
        reloadAdvanced = (_submittedReloadCounter !== null) &&
                         (counter > _submittedReloadCounter);
      }
    } catch (_) { /* ignore — fall back to safety timer */ }

    const longStale = (Date.now() - _submittedAt) > PROCESSED_SAFETY_MS;
    if (reloadAdvanced || longStale) {
      restorePanelToReady();
      // Processed but no new round ever loaded: never flip back silently.
      // The round the user sent is on screen again with its answers intact
      // (restorePanelToReady keeps every field), so say so — a quiet revert
      // reads as "my decision was lost" and gets sent twice.
      if (!reloadAdvanced && typeof showSubmitWarning === 'function') {
        showSubmitWarning('{{panel.processed_no_round}}');
      }
    }
  } catch (e) { /* retry next tick */ }
}

function _setCacheHints(visible) {
  document.querySelectorAll('[data-cache-hint]').forEach(el => {
    el.hidden = !visible;
  });
}

// --- Status line (all templates) ---
// The one renderer for the pinned .panel-status line. Inputs, in priority:
//   frozen tab (body.viewing-frozen)        → 🕘 {tab label} · nur lesen
//   submission in flight (_submittedAt)     → 🤖 überdenkt | setzt um · gespeichert
//   disconnected                            → 👉 Du bist dran · alles gespeichert · verbinde…
//   draft mirror failing, not disconnected  → 👉 Du bist dran · nur in diesem Browser gespeichert
//   draft flush pending                     → 👉 Du bist dran · speichert…
//   heartbeat still connecting              → 👉 Du bist dran · verbindet…
//   otherwise                               → 👉 Du bist dran · gespeichert
// The turn half (.status-turn, created on first render) and
// #panel-status[data-turn] = you | rethinking | implementing | frozen feed the
// journey row (§ Submit → Journey row); data-status keeps its six values.
// The raw heartbeat stays on #connection-status[data-state] (written by
// checkClaudeConnection); the draft phase comes from § State Persistence
// (_draftPhase). Every writer of those inputs calls this, so the line can
// never show a stale state — and it renders in EVERY panel state, submitted
// and frozen included.
function renderPanelStatus() {
  const host = document.getElementById('panel-status');
  const line = document.getElementById('connection-status');
  if (!host || !line) return;
  const conn = line.dataset.state || 'connecting';
  const draft = (typeof _draftPhase === 'string') ? _draftPhase : 'saved';
  const submitted = (typeof _submittedAt === 'number' && _submittedAt > 0)
    || document.body.classList.contains('concept-submitted');
  const frozen = document.body.classList.contains('viewing-frozen');
  const implementing = submitted && typeof _submittedAction === 'string' && _submittedAction === 'implement';
  let status, glyph, text, turn = '', turnKey;
  if (frozen) {
    const tab = document.querySelector('.iteration-tab[aria-selected="true"]');
    const label = tab ? (tab.dataset.tabLabel || tab.textContent.trim()) : '';
    status = 'frozen'; glyph = '🕘'; text = label + ' · {{panel.status_frozen}}';
    turnKey = 'frozen';
  } else if (submitted) {
    // "🤖 überdenkt · gespeichert" / "🤖 setzt um · gespeichert" — the save
    // half says "verbinde…" while the bridge is away.
    status = 'submitted'; glyph = '🤖';
    turn = implementing ? '{{panel.turn_implementing}}' : '{{panel.turn_rethinking}}';
    text = conn === 'disconnected' ? '{{panel.status_reconnecting}}' : '{{panel.status_working}}';
    turnKey = implementing ? 'implementing' : 'rethinking';
  } else {
    glyph = '👉'; turn = '{{panel.turn_you}}'; turnKey = 'you';
    if (conn === 'disconnected') {
      status = 'local-only'; text = '{{panel.status_local_only}}';
    } else if (draft === 'local') {
      // Same state, no "· verbinde…": the heartbeat reports no disconnect, so
      // the draft mirror failed for another reason (§ State Persistence,
      // _draftStripText). Claiming a disconnect here is what made a running
      // bridge look dead.
      status = 'local-only'; text = '{{panel.status_local_only_connected}}';
    } else if (draft === 'saving') {
      status = 'saving'; text = '{{panel.status_saving}}';
    } else if (conn === 'connecting') {
      status = 'connecting'; text = '{{panel.status_connecting}}';
    } else {
      status = 'saved'; text = '{{panel.status_saved}}';
    }
  }
  host.dataset.status = status;
  host.dataset.turn = turnKey;
  const glyphEl = line.querySelector('.status-glyph');
  const labelEl = line.querySelector('.conn-label');
  let turnEl = line.querySelector('.status-turn');
  if (!turnEl && labelEl) {
    turnEl = document.createElement('b');
    turnEl.className = 'status-turn';
    line.insertBefore(turnEl, labelEl);
  }
  if (glyphEl) glyphEl.textContent = glyph;
  if (turnEl) turnEl.textContent = turn;
  if (labelEl) labelEl.textContent = text;
  // The heartbeat wording lives in the tooltip — the line itself says what
  // the user wants to know (is my work safe / delivered), not what the
  // bridge is doing.
  line.dataset.tip = conn === 'connected'    ? '{{panel.connected_title}}'
             : conn === 'disconnected' ? '{{panel.disconnected_title}}'
             :                           '{{panel.connecting_title}}';
  const detail = document.getElementById('status-detail');
  if (detail) detail.hidden = (status !== 'submitted');
  if (typeof renderStatusDots === 'function') renderStatusDots();
  if (typeof renderJourney === 'function') renderJourney();
  // Toast: while the round is in flight, and while it is the user's turn but
  // the bridge is away ("👉 Du bist dran · alles gespeichert" + verbinde…).
  if (typeof renderSubmittedToast === 'function') {
    renderSubmittedToast(status === 'submitted' || (!frozen && conn === 'disconnected'));
  }
}

// --- Status toast (all templates) ---
// The veil after a submit is clicked away by reflex, and with the panel
// closed nothing on the page said the round was already sent. A bottom-centre
// toast repeats the panel's pill — the SAME run bar (buildRunBar), the same
// counter — under a small caption ("Runde 3" / "Neue Runde"). No ring, no
// box, no open button; a click on it opens the panel. Disconnected while 🤖
// runs: the pill dims (last known state) and "verbinde…" floats below it.
// Disconnected on the user's turn: the blue pill stays bright ("👉 Du bist
// dran · alles gespeichert") with the same floating "verbinde…". A finished
// implement bar hides itself after it has been visible with focus ~2.5 s.
// CSS hides it while the panel is open and on a past tab.
function _liveRound() {
  const live = document.querySelector('section[data-iteration][data-active]');
  return live ? live.dataset.iteration : '';
}
function _ensureStatusToast() {
  let toast = document.getElementById('submitted-toast');
  if (toast) return toast;
  toast = document.createElement('div');
  toast.id = 'submitted-toast';
  toast.className = 'jr-toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.dataset.tip = '{{panel.toast_open}}';
  const cap = document.createElement('small');
  cap.className = 'jr-toast-cap';
  const you = document.createElement('span');
  you.className = 'jr-toast-you';
  const run = (typeof buildRunBar === 'function') ? buildRunBar('') : document.createElement('span');
  run.classList.add('jr-toast-run');
  const fl = document.createElement('span');
  fl.className = 'jr-float';
  fl.innerHTML = '{{panel.toast_reconnecting}}<i>.</i><i>.</i><i>.</i>';
  toast.append(cap, run, you, fl);
  toast.addEventListener('click', () => {
    if (typeof openPanel === 'function') openPanel();
    else document.getElementById('panel-toggle')?.click();
  });
  document.body.appendChild(toast);
  return toast;
}
let _toastShow = false;
let _toastMode = null;        // 'status' | 'new-round' | null
let _toastDoneMs = 0;
let _toastDoneTimer = null;
function renderSubmittedToast(show) {
  _toastShow = !!show;
  if (show) _toastMode = 'status';
  else if (_toastMode === 'status') _toastMode = null;
  refreshStatusToast();
}
function refreshStatusToast() {
  const toast = _toastMode ? _ensureStatusToast() : document.getElementById('submitted-toast');
  if (!toast) return;
  if (!_toastMode) { toast.hidden = true; return; }
  const phase = (typeof journeyPhase === 'function') ? journeyPhase() : 'you';
  const conn = (document.getElementById('connection-status') || { dataset: {} }).dataset.state;
  const away = conn === 'disconnected';
  const cap = toast.querySelector('.jr-toast-cap');
  const run = toast.querySelector('.jr-toast-run');
  const you = toast.querySelector('.jr-toast-you');
  const fl = toast.querySelector('.jr-float');
  const round = _liveRound();
  const running = _toastMode === 'status' && (phase === 'rethinking' || phase === 'implementing');
  toast.dataset.mode = running ? phase : (_toastMode === 'new-round' ? 'new-round' : 'you');
  if (cap) cap.textContent = _toastMode === 'new-round'
    ? '{{panel.toast_new_round}}' : '{{panel.toast_round}}'.replace('{n}', round);
  if (run) {
    run.hidden = !running;
    if (running) {
      const lab = run.querySelector('.jr-run-label');
      if (lab) lab.textContent = phase === 'implementing' ? '{{panel.journey_implement}}' : '{{panel.journey_rethinking}}';
      if (typeof paintRunBar === 'function') paintRunBar(run, phase, away);
    }
  }
  if (you) {
    you.hidden = running;
    you.innerHTML = '👉 <b>{{panel.turn_you}}</b>' + (away ? ' <span>· {{panel.toast_all_saved}}</span>' : '');
  }
  if (fl) fl.hidden = !(away && _toastMode === 'status');
  toast.hidden = false;
  // Green "done" auto-hide: count only time the toast is actually seen.
  const done = running && phase === 'implementing' && typeof _journeyDone !== 'undefined' && _journeyDone;
  if (done && !_toastDoneTimer) {
    _toastDoneMs = 0;
    _toastDoneTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && document.hasFocus()
          && !document.body.classList.contains('panel-open')) _toastDoneMs += 250;
      if (_toastDoneMs >= 2500) {
        clearInterval(_toastDoneTimer); _toastDoneTimer = null;
        _toastMode = null; toast.hidden = true;
      }
    }, 250);
  }
}
// "Neue Runde": the first load of a round later than the last one this
// browser saw shows the blue pill for ~4 s of focused time.
function maybeShowNewRoundToast() {
  const round = _liveRound();
  if (!round || document.body.classList.contains('viewing-final')) return;
  const base = (typeof STORAGE_KEY === 'string') ? STORAGE_KEY : 'concept';
  let last = null;
  // Key deliberately NOT prefixed "concept": tools and tests take the first
  // "concept*" localStorage key to be the page state blob.
  const key = 'jr-last-round:' + base;
  try { last = localStorage.getItem(key); _guardedSetItem(key, round); }
  catch (e) { return; }
  if (last === null || Number(round) <= Number(last) || _toastMode === 'status') return;
  _toastMode = 'new-round';
  refreshStatusToast();
  let seen = 0;
  const t = setInterval(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) seen += 250;
    if (seen >= 4000 || _toastMode !== 'new-round') {
      clearInterval(t);
      if (_toastMode === 'new-round') { _toastMode = null; refreshStatusToast(); }
    }
  }, 250);
}

function checkClaudeConnection() {
  const now = Date.now();

  // Connected: Claude has pinged AND that ping is recent. (gate unchanged —
  // never gates on server_ts, or a dead pulser would read green forever.)
  const isConnected = _lastHeartbeatTs && (now - _lastHeartbeatTs) < HEARTBEAT_STALE_MS;

  // Server liveness via the daemon self-pulse. Mirrors the concept-server
  // watchdog: claude_ts==0 is the legitimate bootstrap window, tolerated
  // indefinitely while server_ts proves the bridge is alive.
  const serverAlive = _lastServerTs && (now - _lastServerTs) < SERVER_STALE_MS;

  // "connecting" covers TWO not-connected-but-not-dead windows — NEITHER may
  // be classified as disconnected:
  //   (a) !_everPolled — no /heartbeat response has come back yet (the first
  //       ~1 network RTT after load). Calling this disconnected IS the
  //       fresh-page connect→disconnect→connect flash; it is "connecting".
  //   (b) claude_ts==0 while server_ts is fresh — Claude has never pinged but
  //       the bridge is alive; the pickup waker (~20s), the backup cron tick (<=60s), or the setup-time
  //       POST flips us to connected.
  const bootstrapping = !_everPolled || ((_lastHeartbeatTs === 0) && serverAlive);

  // Freeze detection. Every one of these was reported as "die Verbindung
  // bricht dauernd ab" and none of them was a dead bridge:
  //   - Edge Sleeping Tabs / efficiency mode froze this page (worker
  //     included); on return the DOM interval fires FIRST, with a sample
  //     from before the nap, and read a stale claude_ts as "disconnected"
  //     for the 5 s until the worker's next fetch;
  //   - the PC slept: same thing, plus the pulser's own timers were
  //     suspended, so even a fresh sample shows a stale claude_ts for up to
  //     one pulser cycle (20 s) after wake;
  //   - the worker died silently (no onerror): the main-thread fallback
  //     never engaged because _hbWorker was still set.
  // A sample older than SAMPLE_STALE_MS is evidence about THIS PAGE, not the
  // bridge: re-poll now, replace a worker that stayed silent, and hold
  // "connecting" through WAKE_GRACE_MS. Only a bridge that stays silent past
  // SERVER_STALE_MS after that is "disconnected".
  const sampleAge = _everPolled ? (now - _lastSampleAt) : 0;
  const frozen = _everPolled && sampleAge > SAMPLE_STALE_MS;
  if (frozen) recoverFromFreeze(now);
  const inGrace = now < _wakeGraceUntil;
  const unreachable = _everPolled && sampleAge > SERVER_STALE_MS && !inGrace;

  let state = isConnected ? 'connected'
            : (bootstrapping || ((frozen || inGrace) && !unreachable)) ? 'connecting'
            : 'disconnected';
  // Two-strike rule: a stale verdict has to repeat on the next evaluation
  // (≥ 5 s later) before the warning paints. One late pulse — the bridge
  // answering a heartbeat in 12 s because the machine is busy — is a blip.
  if (state === 'disconnected' && ++_disconnectStreak < 2) {
    state = _lastState === 'connected' ? 'connecting' : _lastState;
  } else if (state !== 'disconnected') {
    _disconnectStreak = 0;
  }
  _lastState = state;

  const pill = document.getElementById('connection-status');
  const btns = ['submit-iterate-btn', 'submit-implement-btn']
    .map(id => document.getElementById(id)).filter(Boolean);
  const panelSubmitted = document.getElementById('panel-submitted');

  // Drive the status line FIRST, in every panel state: [data-state] is the
  // raw heartbeat contract, renderPanelStatus composes the visible line from
  // it. The line lives in .panel-status, OUTSIDE #panel-ready, so it stays
  // on screen — and must stay truthful — while the submitted panel is up.
  // Purely informational, never a blocker.
  if (pill) pill.dataset.state = state;
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
  // The final report hides the status line (§ CSS body.viewing-final
  // .panel-status); its execute button carries the disconnected case as its
  // own label instead, so it has to follow the heartbeat too.
  if (typeof updateCloseoutButton === 'function') updateCloseoutButton();

  // Deliver a queued payload BEFORE the submitted-panel return below: an
  // offline submit leaves exactly that panel up, and pollProcessedState() only
  // releases it once Claude stamps _processed_at — which a payload that never
  // reached the bridge cannot produce. retryPendingSubmission() is idempotent
  // (one at a time, never beside submitWithAction), so every beat may call it.
  if (isConnected) retryPendingSubmission();

  // While the submitted panel is up, leave the ready-panel BUTTONS alone —
  // only the button handling below is skipped, never the line above.
  if (panelSubmitted && panelSubmitted.style.display !== 'none') return;

  // Submit buttons stay ENABLED in every state. A disconnected click is not a
  // black hole: the POST either lands on the live bridge (picked up when
  // Claude's cron next polls) or, if the server is down, throws and is cached
  // in localStorage, then auto-delivered by retryPendingSubmission on
  // reconnect. The per-button cache hint shows only while disconnected so the
  // user knows the click will be queued rather than lost.
  _setCacheHints(state === 'disconnected');
  btns.forEach(b => { b.disabled = false; });
}

// Kick an immediate heartbeat poll on load so the pill resolves to
// "connected" within one network RTT instead of sitting on "connecting" for
// the full 5 s interval. The shorter the connecting window, the less the user
// notices the bootstrap at all.
pollHeartbeat().then(checkClaudeConnection);
startHeartbeatWorker();

// Coming back to the tab is the moment the user looks at the status line —
// and, after a nap, the moment the stale-sample verdict would have shown.
// Poll first, judge second. Both paths go through checkClaudeConnection,
// which handles the frozen case itself; this only shortens the wait.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  pollHeartbeat().then(checkClaudeConnection);
});

// Main-thread cadence. When the worker is alive it owns the /heartbeat fetch
// (unthrottled in a hidden tab); this loop then only re-evaluates the verdict
// and the processed-state poll. Throttling here is harmless — the indicator
// it drives is not visible in a hidden tab anyway.
setInterval(async () => {
  if (!_hbWorker) await pollHeartbeat();
  checkClaudeConnection();
  await pollProcessedState();
}, 5000);
```

**Claude-side heartbeat** (executed by Claude via Bash or CronCreate):
```bash
curl -s -X POST http://localhost:{port}/heartbeat
```

