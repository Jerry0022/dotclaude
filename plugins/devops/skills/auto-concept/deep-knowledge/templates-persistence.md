# Concept templates, part 11 of 16: Shared systems — state persistence, comment slots

## State Persistence (localStorage + TTL)

Interactive element state MUST survive page reloads AND accidental tab closes
via `localStorage` with a time-to-live (TTL). This prevents the user from
losing selections, comments, and ratings.

**Storage key:** `concept-state-{slug}` (derived from the page's filename slug)
**TTL:** 24 hours — auto-clears stale state from previous days

```javascript
const STORAGE_KEY = 'concept-state-' + location.pathname.split('/').pop().replace('.html', '');
const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// A QuotaExceededError from localStorage.setItem, unguarded, throws OUT of
// every change/input handler — one oversized state (e.g. a very long
// session with many iterations) then silently kills ALL persistence for the
// rest of the page, with nothing telling the user their edits stopped being
// saved. Every setItem call site in this file (saveState, both `-pending`
// writes near the submit handler) MUST go through this wrapper rather than
// calling localStorage.setItem directly.
let _persistWarnEl = null;
let _persistWarned = false;
function _showPersistWarning() {
  // Once is enough — re-showing it on every subsequent failed write would
  // spam the page while the underlying problem (storage full) persists
  // across many `input` events in a row.
  if (_persistWarned) return;
  _persistWarned = true;
  if (!_persistWarnEl) {
    _persistWarnEl = document.createElement('div');
    _persistWarnEl.className = 'persist-warning-banner';
    _persistWarnEl.setAttribute('role', 'alert');
    _persistWarnEl.textContent = '{{state.persist_failed}}';
    document.body.appendChild(_persistWarnEl);
  }
  _persistWarnEl.hidden = false;
}
function _guardedSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    // QuotaExceededError (or, rarely, a disabled/private-mode store) — the
    // in-memory state (and the IndexedDB attachment mirror, § Attachments)
    // is unaffected, only this localStorage mirror failed to write.
    _showPersistWarning();
    return false;
  }
}

// --- Durable draft mirror (bridge) ---------------------------------------
// localStorage is a CACHE, never the record of truth. It is wiped by a profile
// reset, refused in private mode, capped by quota, flushed to disk lazily (a
// power cut takes the last writes with it) — and, as every data-loss bug this
// block guards against showed, one wrong line of page JS can clear the whole
// key outright. So every autosave is ALSO mirrored to the bridge, which
// fsyncs it before acking (§ Draft store in scripts/concept-server.py).
//
// The bridge is a plain Python process with no dependency on Claude: it keeps
// accepting drafts long after Claude has stopped answering, which is exactly
// the situation — a usage limit hit mid-round — where hours of typing used to
// sit in a single browser key with nothing behind it.
//
// Debounced, because `input` fires per keystroke. Flushed via sendBeacon on
// pagehide/hidden so a closed tab, a crash or a reload cannot outrun the last
// write.
const DRAFT_SLUG = STORAGE_KEY.replace(/^concept-state-/, '');
const DRAFT_DEBOUNCE_MS = 1000;
// A page opened as a file:// URL has no bridge by construction — every POST
// would fail and the "no durable mirror" strip would be permanent noise.
const DRAFT_ENABLED = /^https?:$/.test(location.protocol);
let _draftTimer = null;
let _draftCleared = [];      // keys the user emptied on purpose since last flush
let _draftFailures = 0;
let _draftStripEl = null;
// While the strip is up, retry the flush on a slow timer so a recovered bridge
// clears the warning by itself — otherwise it only goes away once the user
// types again, and a healthy bridge keeps looking dead.
const DRAFT_RETRY_MS = 30000;
let _draftRetryTimer = null;
// Draft-mirror phase for the pinned status line (§ Claude Connection
// Heartbeat, renderPanelStatus): 'saving' while a flush is queued or in
// flight, 'saved' once the bridge acked it, 'local' after three consecutive
// failures (the same threshold as the offline strip).
let _draftPhase = 'saved';
function _setDraftPhase(phase) {
  _draftPhase = phase;
  if (typeof renderPanelStatus === 'function') renderPanelStatus();
}

function _readStoredState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

function _draftPayload(cleared) {
  const live = document.querySelector('section[data-iteration][data-active]');
  return JSON.stringify({
    slug: DRAFT_SLUG,
    page_version: document.documentElement.dataset.pageVersion || '',
    iteration: live ? String(live.dataset.iteration || '') : '',
    state: _readStoredState(),
    cleared: cleared,
  });
}

// Handed over, not copied: a key reported as deliberately cleared must be
// reported exactly once, or a later flush would re-clear a note the user has
// since retyped. A FAILED flush hands them back, so a dead bridge does not
// turn "the user deleted this" into a fact nobody ever hears about — the
// union would then resurrect the note on the next reload.
function _takeCleared() { return _draftCleared.splice(0); }
function _returnCleared(keys) { if (keys.length) _draftCleared.unshift(...keys); }

// The strip names the failure truthfully. Only a transport error while the
// heartbeat does not vouch for the bridge is "unreachable"; an HTTP refusal
// (507 disk, 413, 400) means the bridge WAS reached, and a transport error
// under a connected heartbeat is the browser refusing the request, not the
// bridge being gone. Both used to read "die Bridge ist nicht erreichbar" —
// over a bridge answering 200 to everything else, which sent the user after
// a server that was running fine.
function _draftStripText(why) {
  let conn = '';
  try {
    const line = document.getElementById('connection-status');
    conn = (line && line.dataset.state) || '';
  } catch (e) { /* no status line — fall back to the transport verdict */ }
  return (why === 'unreachable' && conn !== 'connected')
    ? '{{state.draft_local_only}}'
    : '{{state.draft_save_failed}}';
}

// Only after three consecutive failures, so a single blip does not flash a
// warning at the user; cleared again on the next success.
function _setDraftHealth(ok, why) {
  _draftFailures = ok ? 0 : _draftFailures + 1;
  const show = _draftFailures >= 3;
  if (show && !_draftStripEl) {
    _draftStripEl = document.createElement('div');
    _draftStripEl.className = 'draft-offline-strip';
    _draftStripEl.setAttribute('role', 'status');
    document.body.appendChild(_draftStripEl);
  }
  if (show) _draftStripEl.textContent = _draftStripText(why);
  if (_draftStripEl) _draftStripEl.hidden = !show;
  // The status line follows the same three-strike rule: a single blip stays
  // "Gespeichert" (the local copy IS saved), three in a row read "Nur lokal".
  _setDraftPhase(show ? 'local' : 'saved');
  // Retry only while the strip is showing; a hidden strip has nothing to clear.
  if (show && !_draftRetryTimer) {
    _draftRetryTimer = setTimeout(() => { _draftRetryTimer = null; flushDraft(); }, DRAFT_RETRY_MS);
  } else if (!show && _draftRetryTimer) {
    clearTimeout(_draftRetryTimer); _draftRetryTimer = null;
  }
}

// Every /draft response is read to the end, and the live autosave carries no
// `keepalive`. Chromium books each keepalive request body against a 64 KiB
// per-page quota and gives it back only once the response has COMPLETED — and
// under the bridge's `Cache-Control: no-store` a body nobody reads never
// completes. The old fire-and-forget flush pinned ~2.4 KB per autosave: after
// ~27 of them every further keepalive fetch failed inside the browser
// ("TypeError: Failed to fetch", nothing on the wire), the strip announced an
// unreachable bridge over a bridge answering 200 to everything else, and
// nothing typed from then on reached disk until a reload reset the quota.
// A live page does not need its request to outlive it; keepalive belongs to
// the teardown path (flushDraftBeacon), which drains its response as well.
function _drainDraftResponse(res) {
  try { return res.text().catch(() => ''); }
  catch (e) { return Promise.resolve(''); }
}

async function flushDraft() {
  if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
  if (!DRAFT_ENABLED) return;
  const cleared = _takeCleared();
  let res;
  try {
    res = await fetch('/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: _draftPayload(cleared),
    });
  } catch (e) {
    _returnCleared(cleared);
    _setDraftHealth(false, 'unreachable');
    return;
  }
  await _drainDraftResponse(res);
  // A 507 means the bridge could not reach disk. Same rule as POST
  // /decisions: that is NOT a success, and the local copy stays the only
  // one — so the user is told rather than left believing it is safe.
  if (!res.ok) _returnCleared(cleared);
  _setDraftHealth(res.ok, res.ok ? '' : 'refused');
}

function queueDraftSync() {
  if (!DRAFT_ENABLED) return;
  if (_draftTimer) clearTimeout(_draftTimer);
  _setDraftPhase('saving');   // "… Speichert" until flushDraft's ack lands
  _draftTimer = setTimeout(flushDraft, DRAFT_DEBOUNCE_MS);
}

// Teardown path. sendBeacon is queued by the browser itself and survives the
// document being discarded, which `fetch` — even with keepalive — does not
// reliably do on every engine; the fetch below is the fallback for browsers
// that refuse the beacon (payload too large). It still drains its response:
// `visibilitychange` → hidden runs this on a page that lives on, and an
// undrained keepalive response keeps its body booked against the quota.
function flushDraftBeacon() {
  if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
  if (!DRAFT_ENABLED) return;
  // No response to inspect on this path, so the cleared list is handed over
  // unconditionally — a beacon the browser accepted is the best signal there is.
  const body = _draftPayload(_takeCleared());
  try {
    if (navigator.sendBeacon &&
        navigator.sendBeacon('/draft', new Blob([body], { type: 'application/json' }))) return;
  } catch (e) { /* fall through to fetch */ }
  try {
    fetch('/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
    }).then(_drainDraftResponse, () => { /* the localStorage copy stands */ });
  } catch (e) { /* the localStorage copy stands — nothing else left to try */ }
}
window.addEventListener('pagehide', flushDraftBeacon);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDraftBeacon();
});

// Merge the bridge's durable copy into localStorage on load. Order matters:
//   1. a key the local blob does not have at all is taken from the bridge;
//   2. a key the local blob has EMPTY while the bridge has text is taken from
//      the bridge — this is the shape EVERY past data-loss bug produced;
//   3. a non-empty local value always wins: it is the newer one, and it is
//      what the user can currently see on screen.
// The source is `recovered` (not `state`): the union of the last non-empty
// value ever posted per key, so even a run of blank autosaves from a broken
// client cannot erase anything.
async function hydrateDraftFromBridge() {
  if (!DRAFT_ENABLED) return;
  let data = null;
  try {
    const res = await fetch('/draft?slug=' + encodeURIComponent(DRAFT_SLUG), { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) { return; }
  if (!data || !data.found) return;
  const local = _readStoredState();
  let changed = false;
  Object.entries(data.recovered || {}).forEach(([k, v]) => {
    // Only typed text is mirrored back (#347). The bridge already limits
    // `recovered` to `text:` keys, but an older bridge — or any future key
    // the server lets through — must never steer THIS browser: `_activeView`,
    // `_activeScreen*`, `_viewportMode` and every other `_`-prefixed
    // navigation / preference key belong to the tab that wrote them. A
    // second browser on the same page (a screenshot-verification tab) would
    // otherwise be pulled onto whatever the user is reading.
    if (typeof k !== 'string' || !k.startsWith('text:')) return;
    if (typeof v !== 'string' || !v) return;
    if (typeof local[k] === 'string' && local[k] !== '') return;
    local[k] = v;
    changed = true;
  });
  if (!changed) return;
  local._savedAt = Date.now();
  local._pageVersion = document.documentElement.dataset.pageVersion || '';
  _guardedSetItem(STORAGE_KEY, JSON.stringify(local));
  restoreState();
  if (typeof updateNoteMarkers === 'function') updateNoteMarkers();
}

// Text keys are namespaced per iteration (`text:i3:d1-s1`). Without the
// namespace the SAME key means different things in different rounds — screen
// ids, `{decisionId}-note` and annotation ids all repeat — so iteration N+1
// opened pre-filled with N's notes, and the workaround for that (emptying the
// dock at submit time) destroyed the text the user had just sent before they
// could read it back. See § Iteration Tabs.
function _iterationPrefix() {
  const live = document.querySelector('section[data-iteration][data-active]');
  return live ? 'i' + String(live.dataset.iteration) + ':' : '';
}

function saveState() {
  const _pageVersion = document.documentElement.dataset.pageVersion || '';
  // MERGE over the stored blob; never rebuild it from the DOM alone. The scans
  // below only see nodes that exist RIGHT NOW, and the design template's dock
  // is built by a different script block (§ Layout JS `buildDesignUI()`) whose
  // DOMContentLoaded listener may not have run yet, and is torn down and
  // rebuilt on every iteration switch. A from-scratch rebuild therefore wrote
  // a blob with no `text:{screen-id}` keys on the first `input` event after
  // load — deleting the user's notes rather than merely failing to show them.
  // Keys whose node IS present are overwritten below as before, so this only
  // ever preserves entries the current DOM has nothing to say about.
  let state = {};
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Same two rejections restoreState() makes. Without them a merge would
    // resurrect an expired or foreign-version blob that the restore path
    // would have deleted, and carry its dead keys forward for another day.
    if (prev && typeof prev === 'object'
        && !(prev._savedAt && (Date.now() - prev._savedAt) > STATE_TTL_MS)
        && !(prev._pageVersion && prev._pageVersion !== _pageVersion)) {
      state = prev;
    }
  } catch (e) { /* corrupt storage — start from an empty blob */ }
  state._savedAt = Date.now();
  state._pageVersion = _pageVersion;
  // Device-view frames are CLONES of a mockup (§ Responsive device views).
  // They carry namespaced ids, so persisting them would fill the blob with
  // dead `dv1-*` / `dv2-*` keys — and, worse, the next screen switch tears the
  // stage down before saveState() runs, which would DELETE those keys again.
  // The authored original is still in the DOM (display:none) and is the one
  // legitimate copy, so skipping the clones loses nothing.
  // A FROZEN iteration's fields carry the values the user already submitted,
  // and the shared feedback dock is painted with that same frozen text while
  // a past tab is on screen (applyDockFreezeState, § Panel Chrome). Persisting
  // either writes round N's answers over round N+1's — silently, because
  // navigating a frozen design tab is allowed and every showScreen() ends in
  // saveState(). Measured symptom: click an old tab, click a screen, come
  // back, the live round's notes are the old round's notes.
  const _frozenView = document.body.classList.contains('viewing-frozen');
  const persistable = el => !el.closest('[data-device-clone]')
    && !el.closest('section[data-iteration]:not([data-active])')
    && !(_frozenView && el.closest('#feedback-dock'));
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    // data-no-persist opts a control out of reload restoration. Used by the
    // close-out sheet's ship question and its follow-up routes, which must
    // be answered fresh every time: a restored "yes" from hours ago would
    // sail through a later close-out and trigger a real release — or build a
    // follow-up — that the user never re-authorised.
    if (el.dataset.noPersist !== undefined) return;
    if (!persistable(el)) return;
    if (el.name || el.id) state['input:' + (el.name || el.id) + ':' + el.value] = el.checked;
  });
  const _ns = _iterationPrefix();
  document.querySelectorAll('textarea, input[type="text"], input[type="number"]').forEach(el => {
    if (!persistable(el)) return;
    const _key = el.id || el.dataset.comment;
    if (!_key) return;
    // Belt-and-braces for the dock rebuild: buildDesignUI() re-creates every
    // dock textarea EMPTY, so a saveState() that runs between the rebuild and
    // the restore would blank a stored note (the merge above only protects
    // keys whose node is ABSENT — these nodes are present). An empty field
    // therefore may only overwrite a non-empty stored value once the user has
    // actually typed into it: `data-touched` is stamped from a TRUSTED input
    // event (see the capture-phase listener at the bottom of this block), so
    // deliberately clearing a note — type, then delete — still persists "".
    const _sk = 'text:' + _ns + _key;
    if (el.value === '' && state[_sk] && el.dataset.touched === undefined) return;
    // Report a deliberate clear to the bridge, whose `recovered` union would
    // otherwise resurrect the note on the next reload, forever. Only a value
    // that WAS stored and is now empty counts — never a field that was empty
    // all along.
    if (el.value === '' && state[_sk]) _draftCleared.push(_sk);
    state[_sk] = el.value;
  });
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (!persistable(el)) return;
    if (el.id || el.name) state['range:' + (el.id || el.name)] = el.value;
  });
  document.querySelectorAll('select').forEach(el => {
    if (!persistable(el)) return;
    if (el.id || el.name) state['select:' + (el.id || el.name)] = el.value;
  });
  // Design template only, and read off the DOM rather than passed in: the
  // design layout keeps its viewport state inside its own IIFE, and
  // applyViewport() mirrors it onto the body precisely so this one writer can
  // see it. Absent on every other template, where the key is simply not
  // written. It persists the PREFERENCE (data-viewport-pref), not the mode
  // currently rendered — saving while a decision-template tab is open would
  // otherwise write back the clamped `desktop` and lose the user's choice.
  if (document.body.dataset.viewportPref) state['_viewportMode'] = document.body.dataset.viewportPref;
  state['theme'] = document.documentElement.getAttribute('data-theme');
  // Same non-form-state precedent as 'theme' above: the (optional)
  // annotation layer's show/hide toggle is global and outlives a single
  // element, so it is keyed directly rather than through the input/text/
  // range/select scans. Written unconditionally (not just when true) so
  // toggling back to visible also persists past a reload.
  state['annoHidden'] = document.body.classList.contains('anno-hidden');
  // Work package B — the dock's user-controlled maximise override (a DOM
  // attribute, not a JS closure variable, so it can be read/written from
  // this script block even though applyDockSize() lives in a different
  // IIFE — § Panel Chrome (all templates) → Feedback dock). The dock is page
  // chrome in every template (#399); the `?.` guard only covers a page whose
  // dock markup is missing, where it degenerates to `undefined` -> falsy.
  state['dockMaximized'] = document.getElementById('feedback-dock')?.dataset.userMaximized === 'true';
  // Work package C — persist the active VIEW (§ Views (optional)) the same
  // DOM-read way: a view's active state lives on the element itself
  // (data-view-active), so this needs no dependency on wireDesignLayout()'s
  // closures despite living in a different script block. Absent on pages
  // with no views, or while a design (not a view) is on screen.
  // Explicitly DELETED when no view is active — this key means "the user was
  // reading a view when they left", and under the merge above an absent write
  // would silently keep the last one, sending every later reload back into a
  // view the user had already navigated away from.
  const _activeViewEl = document.querySelector('section[data-view][data-view-active="true"]:not([hidden])');
  if (_activeViewEl) state['_activeView'] = _activeViewEl.dataset.view;
  else delete state['_activeView'];
  // Persist the user-interacted flag so a reload while the user has unsaved
  // edits does not re-arm the empty-submit confirm dialog. Restored values
  // would otherwise look like "untouched defaults" because change/input
  // events fire from restoreState() (isTrusted=false) and are ignored.
  // Deleted rather than left alone when false, for the same reason as
  // _activeView above: the merge would otherwise make the flag permanent
  // once set, surviving the panel reset that is supposed to clear it.
  if (typeof _userInteracted !== 'undefined' && _userInteracted) {
    state['_userInteracted'] = true;
  } else {
    delete state['_userInteracted'];
  }
  _guardedSetItem(STORAGE_KEY, JSON.stringify(state));
  // Mirror it to disk. Debounced, never awaited: persistence must not make
  // typing feel slow, and a failed mirror is reported by its own strip rather
  // than by throwing out of an input handler.
  queueDraftSync();
}

// TTL expiry and a page-version change used to DELETE the whole blob. Those
// were the two most expensive lines in this file: both triggers are perfectly
// ordinary — leaving the tab open overnight, and regenerating the page — and
// the blob they deleted was the only copy of everything the user had typed and
// not yet submitted.
//
// Nothing is deleted any more. The genuinely stale half (checkbox states, nav
// positions, theme) is dropped, every `text:` key is carried over and
// restored, a strip says so, and the untouched original is kept one key
// sideways in case this page turns out to be a different concept that happens
// to share the slug. A note that comes back where the user left it is never
// worse than a note that is gone.
let _recoveredStripEl = null;
function _showRecoveredStrip() {
  if (_recoveredStripEl) return;
  _recoveredStripEl = document.createElement('div');
  _recoveredStripEl.className = 'recovered-notes-strip';
  _recoveredStripEl.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = '{{state.recovered_found}}';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '{{state.recovered_dismiss}}';
  btn.addEventListener('click', () => { _recoveredStripEl.hidden = true; });
  _recoveredStripEl.appendChild(span);
  _recoveredStripEl.appendChild(btn);
  document.body.appendChild(_recoveredStripEl);
}

function _carryOverTypedWork(state) {
  const typed = {};
  Object.keys(state).forEach(k => {
    if (k.indexOf('text:') === 0 && typeof state[k] === 'string' && state[k]) {
      typed[k] = state[k];
    }
  });
  const carried = Object.assign({
    _savedAt: Date.now(),
    _pageVersion: document.documentElement.dataset.pageVersion || '',
    _carriedOver: true,
  }, typed);
  _guardedSetItem(STORAGE_KEY + '-archive', JSON.stringify(state));
  _guardedSetItem(STORAGE_KEY, JSON.stringify(carried));
  if (Object.keys(typed).length) _showRecoveredStrip();
  return carried;
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    let state = JSON.parse(raw);
    const currentVersion = document.documentElement.dataset.pageVersion || '';
    if ((state._savedAt && (Date.now() - state._savedAt) > STATE_TTL_MS) ||
        (state._pageVersion && state._pageVersion !== currentVersion)) {
      state = _carryOverTypedWork(state);
    }
    // Restore targets the LIVE round only. Frozen rounds carry their submitted
    // values in the HTML, and their form-element names/ids repeat across
    // rounds — a page-wide `querySelector` returns the OLDEST match (document
    // order), so an unscoped restore wrote the live round's answers into
    // iteration 1 and left the live round blank.
    const _live = document.querySelector('section[data-iteration][data-active]');
    const _ns = _live ? 'i' + String(_live.dataset.iteration) + ':' : '';
    const _pick = sel => (_live && _live.querySelector(sel)) || document.querySelector(sel);
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    // Mirror of the theme restore above — see saveState(). Only ADDS the
    // class; never removes it here, since the default (no class) already
    // means "visible" and a missing/false key must not fight that default.
    if (state.annoHidden) document.body.classList.add('anno-hidden');
    // Mirror of the annoHidden restore above — see saveState(). Re-applies
    // sizing immediately (not just on the next iteration switch) because
    // this script block's DOMContentLoaded listener is not guaranteed to
    // run after the dock block's own initial applyDockSize() call.
    if (state.dockMaximized) {
      const dockEl = document.getElementById('feedback-dock');
      if (dockEl) dockEl.dataset.userMaximized = 'true';
    }
    if (typeof window.applyDockSize === 'function') window.applyDockSize();
    // Preserve the user's prior interaction flag across reloads — see saveState().
    if (state._userInteracted && typeof _userInteracted !== 'undefined') {
      _userInteracted = true;
    }
    Object.entries(state).forEach(([key, value]) => {
      if (key.startsWith('_')) return;
      const [type, ...rest] = key.split(':');
      if (type === 'input') {
        const [name, val] = [rest.slice(0, -1).join(':'), rest[rest.length - 1]];
        const el = _pick(`input[name="${name}"][value="${val}"], input[id="${name}"][value="${val}"]`);
        // Mirror of the saveState() guard — also covers stale entries written
        // before a control was marked data-no-persist. `touched` is the same
        // re-entrancy guard the text branch below documents: restoreState()
        // runs again when hydrateDraftFromBridge() merges the durable copy,
        // and a late re-run must not flip a box the user has since changed —
        // it changes no radio the close-out sheet mirrors, so the sheet and
        // the payload would then describe different things.
        if (el && el.dataset.noPersist === undefined && el.dataset.touched === undefined) {
          el.checked = value;
        }
      } else if (type === 'text') {
        let id = rest.join(':');
        // Namespaced key (`text:i3:d1-s1`). Only the live round's own keys may
        // be applied: screen ids, `{decisionId}-note` and annotation ids all
        // repeat across rounds, so an unnamespaced restore filled the shared
        // feedback dock with a previous round's notes. A legacy key with no
        // namespace (written by pages generated before this) is treated as
        // belonging to the live round — which is exactly what it meant then.
        const nsMatch = /^i([^:]+):([\s\S]*)$/.exec(id);
        if (nsMatch) {
          if ('i' + nsMatch[1] + ':' !== _ns) return;
          id = nsMatch[2];
        }
        // The page-wide fallback is what the feedback dock needs — it is an
        // overlay that lives outside section[data-iteration].
        const el = _pick(`[data-comment="${id}"]`)
          || _pick(`textarea#${CSS.escape(id)}, input#${CSS.escape(id)}`);
        // Never overwrite a field the user has already typed into during THIS
        // page life. restoreState() is re-entrant (the design layout re-runs
        // it after building the dock, and hydrateDraftFromBridge() runs it
        // again when the durable copy adds anything), and a late re-run must
        // not stamp a stored value over newer keystrokes.
        if (el && el.dataset.touched === undefined) el.value = value;
      } else if (type === 'range') {
        const id = rest.join(':');
        const el = _pick(`input#${CSS.escape(id)}, input[name="${id}"]`);
        if (el) { el.value = value; el.dispatchEvent(new Event('input')); }
      } else if (type === 'select') {
        const id = rest.join(':');
        const el = _pick(`select#${CSS.escape(id)}, select[name="${id}"]`);
        if (el) el.value = value;
      }
    });
  } catch (e) { /* corrupt storage — ignore */ }
  // The text branch above sets mapping state inputs by value, without events
  // (§ Information Mapping (engine)) — re-project the boxes, chips and counts
  // from them, same precedent as updateNoteMarkers() after a dock restore.
  if (typeof refreshMappings === 'function') refreshMappings();
}

document.addEventListener('DOMContentLoaded', () => {
  // FIRST: the mapping state inputs (§ Information Mapping (engine)) must
  // exist before the restore writes into them — script order is not
  // guaranteed across the page's IIFEs, so the engine is not asked to time it.
  if (typeof renderMappings === 'function') renderMappings();
  // Inject missing per-decision comment slots BEFORE restoring state so the
  // restored textarea values land on real DOM nodes. See § Comment Slot
  // Injection for why this safety net exists.
  if (typeof ensureCommentSlots === 'function') ensureCommentSlots();
  restoreState();
  // Then top up from the bridge's durable copy — the half that survives a
  // wiped profile, a private window, a storage quota error and a power cut.
  // Deliberately not awaited: the local restore has already painted the page,
  // and this only ever ADDS keys the local blob is missing or has empty.
  hydrateDraftFromBridge();
  // Re-sync the (optional) annotation eye pill's aria-label/aria-pressed
  // AFTER restoreState() has applied the persisted body.anno-hidden class —
  // wireAnnotationLayer()'s own DOMContentLoaded-time updateAnnoUI() call
  // may run before this listener (script order is not guaranteed across
  // the page's several IIFEs), so relying on that alone would read the
  // toggle's pre-restore state. See § Annotation Layer JS.
  if (typeof updateAnnoUI === 'function') updateAnnoUI();
});
// Stamps the field the user is actually typing in, so saveState()'s
// empty-value guard can tell "cleared on purpose" from "not restored yet".
// CAPTURE phase, so it runs before the bubble-phase saveState below no matter
// what else listens. isTrusted filters out the synthetic events restoreState()
// dispatches — a restore must never count as user input.
document.addEventListener('input', e => {
  if (e.isTrusted && e.target && e.target.dataset) e.target.dataset.touched = 'true';
}, true);
document.addEventListener('change', saveState);
document.addEventListener('input', saveState);
```

**Rules:**
- Use `localStorage` with a 24-hour TTL
- Save on every `change` and `input` event — not just on submit
- Restore runs on `DOMContentLoaded` — before the user sees the page. The
  design template re-runs it once more from § Layout JS, IMMEDIATELY after
  `buildDesignUI()` has created the dock textareas and before anything that can
  call `saveState()` (`showScreen()`, `primeDock()`): the two script blocks'
  listeners have no guaranteed order, so the restore here may have scanned a
  dock that did not exist yet
- An empty `text:` field never overwrites a non-empty stored value unless the
  user has typed into it (`data-touched`) — a rebuilt, not-yet-restored dock
  textarea must not be mistaken for a cleared note
- `saveState()` MERGES over the stored blob and never rebuilds it from the DOM
  alone — a key whose node is currently absent must survive the write
- `ensureCommentSlots()` runs IMMEDIATELY before `restoreState()` — see
  § Comment Slot Injection for the rationale (must inject the slots before
  the restore step rehydrates their values)
- The `concept-submitted` class is NOT persisted
- Theme preference IS persisted — prevents dark/light flash on reload
- The (optional) annotation layer's global show/hide state IS persisted the
  same way (`state['annoHidden']`) — see § Annotation Layer (optional).
  Individual answers persist for free via the ordinary `text:` scan since
  their textareas carry `data-comment`.
- Every `localStorage.setItem` call site (here and the two `-pending` writes
  near the submit handler) goes through `_guardedSetItem()`, never a bare
  `localStorage.setItem` — a `QuotaExceededError` is caught, surfaces a
  visible `.persist-warning-banner` (`{{state.persist_failed}}`) instead of
  throwing out of the `change`/`input` handler, and further writes keep
  being attempted (a later one may succeed once the user frees up space).

**Durability rules — the ones that exist because work was actually lost:**

- **Nothing in this page may ever call `localStorage.removeItem(STORAGE_KEY)`.**
  Not on TTL expiry, not on a page-version change, not on a panel reset, not
  on submit. Each of those was once a one-line "clean up local state" that
  deleted every comment on the page, and two of them fired precisely when
  things were already going wrong (a bridge that could not persist; Claude
  stuck on a usage limit for longer than `PROCESSED_SAFETY_MS`). Stale state
  is pruned key by key — `_carryOverTypedWork()` keeps every `text:` entry and
  drops the rest — never by dropping the blob.
- **Text keys are namespaced per iteration** (`text:i3:d1-s1`,
  `_iterationPrefix()`). Screen ids, `{decisionId}-note` keys and annotation
  ids all repeat across rounds, and the shared feedback dock lives outside
  `section[data-iteration]` entirely, so an unnamespaced key means different
  things in different rounds. `restoreState()` applies only the live round's
  keys; a legacy key with no namespace is treated as the live round's.
- **A frozen round is never persisted.** `persistable()` excludes
  `section[data-iteration]:not([data-active])` always, and the dock while
  `body.viewing-frozen` — otherwise browsing an old tab (which is allowed, and
  ends every `showScreen()` in a `saveState()`) writes the old round's
  submitted answers over the live round's unsent ones.
- **The dock is not emptied on submit.** It is marked read-only
  (`markDockSubmitted()`); the round stays live until Claude appends the next
  section, and its comments are the only on-screen record of what was sent.
- **Every save is mirrored to the bridge** (`queueDraftSync()` → `POST /draft`,
  fsynced before the ack), flushed with `sendBeacon` on `pagehide`/`hidden`,
  and merged back on load by `hydrateDraftFromBridge()`. `localStorage` is the
  cache; the bridge's append-only draft log is the record that survives a
  wiped profile, a private window, a quota error, a power cut, and a Claude
  that has stopped answering.
- **The live autosave never uses `keepalive`, and every draft response is
  read to the end** (`_drainDraftResponse()`). Chromium books a keepalive
  request's body against a 64 KiB per-page quota until its response
  completes, and a `no-store` response nobody reads never completes: a
  fire-and-forget `fetch('/draft', { keepalive: true })` silently stopped
  mirroring after ~27 autosaves — every later request failed inside the
  browser while the bridge kept answering 200 — and stayed dead until a
  reload. `keepalive` is for the teardown fallback only, and that drains too.
- `restoreState()` never overwrites a field carrying `data-touched` — it is
  re-entrant (the design layout re-runs it; so does the bridge hydrate), and a
  late re-run must not stamp a stored value over newer keystrokes.

### Persist Warning Banner CSS

`_showPersistWarning()` (above) creates this element on first failure —
there is no static markup for it, it never appears unless a write actually
fails, so nothing needs to reserve space for it up front.

```css
.persist-warning-banner {
  position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
  z-index: 10000; max-width: min(480px, calc(100vw - 2rem));
  background: var(--danger-color, #f85149); color: #fff;
  padding: .6rem 1rem; border-radius: 8px; font-size: .82rem;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}

/* Same family, lower urgency: the work is safe, the user is only being told
   where it currently lives (`.draft-offline-strip`) or that older notes were
   brought back (`.recovered-notes-strip`). Both sit BELOW the frozen bar's
   z-index band so they never cover the way back to the live round. */
.draft-offline-strip,
.recovered-notes-strip {
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
  z-index: 9000; max-width: min(560px, calc(100vw - 2rem));
  display: flex; align-items: center; gap: .75rem;
  background: var(--panel-bg, #1c2128); color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d);
  padding: .55rem .9rem; border-radius: 8px; font-size: .8rem;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}
/* `display: flex` above outranks the UA `[hidden] { display: none }`, so the
   attribute alone would never hide either strip once shown — same override
   every other toggled bar carries (`.frozen-bar[hidden]`, `.hint-cache[hidden]`). */
.draft-offline-strip[hidden],
.recovered-notes-strip[hidden] { display: none; }
.recovered-notes-strip button {
  background: none; border: 1px solid var(--border-color, #30363d);
  color: inherit; border-radius: 6px; padding: .2rem .6rem;
  font-size: .75rem; cursor: pointer; white-space: nowrap;
}
```

## Comment Slot Injection

Every Bi-State `[data-decision]` group SHOULD ship with an inline adjacent
`<textarea data-comment="$decisionId-note">` so the user can attach a
free-form override to their include/discard choice (e.g. "only for X",
"with variant Y", or any open question that does not fit a binary toggle).

Generated pages must emit the textarea inline. To upgrade older pages that
were generated before this rule existed — and as a runtime safety net if
Claude forgets to add it during a one-off generation — every concept page
also ships `ensureCommentSlots()`. It iterates over every `[data-decision]`
group and injects a textarea where one is missing. The function runs once
on `DOMContentLoaded` BEFORE `restoreState()` so the restore step can
rehydrate previously typed comments into the newly-injected nodes.

The catch-all `collectAllFormFields` picks up the textareas via
`data-comment` without any collector change (see § collectDecisions
dispatcher — the dispatcher already reads `el.dataset.comment` as a
fallback key).

```javascript
function ensureCommentSlots() {
  document.querySelectorAll('[data-decision]').forEach(group => {
    // Anchor: prefer the surrounding card/section so the textarea ends up
    // inside the same visual unit. Fall back to the group's parent if no
    // recognised wrapper exists.
    const card = group.closest('.pattern-card, .role-card, .variant-evaluation, section[id]')
              || group.parentElement;
    if (!card) return;

    // Skip if the card already has a comment slot — works for both inline
    // emission and prior runs of ensureCommentSlots().
    if (card.querySelector('textarea[data-comment]')) return;

    const id = (group.dataset.decision || group.id || '').trim();
    if (!id) return;  // unnamed group — nothing useful to key the textarea by
    const commentKey = id + '-note';

    const row = document.createElement('div');
    row.className = 'field-row decision-comment-row';

    const label = document.createElement('label');
    label.setAttribute('for', commentKey);
    label.textContent = '{{decision.comment_label}}';

    const ta = document.createElement('textarea');
    ta.id = commentKey;
    ta.dataset.comment = commentKey;
    ta.dataset.attachable = '';
    ta.placeholder = '{{decision.comment_placeholder}}';
    ta.rows = 2;

    row.appendChild(label);
    row.appendChild(ta);
    // Attachments for this comment (§ Attachments) — initCommentAttachments()
    // (called at the bottom of this function) mounts the bar itself; it is
    // the single place a bar is ever created, so it is not built here too.

    // Insert right after the bi-state group when both share the same parent;
    // otherwise append to the card so the override is visually attached.
    if (group.nextSibling && group.parentNode === card) {
      group.parentNode.insertBefore(row, group.nextSibling);
    } else {
      card.appendChild(row);
    }
  });
  // Wire paste / drop / button on every comment textarea, including the ones
  // emitted inline by the generator rather than injected above.
  initCommentAttachments();
}
```

**Notes:**
- `{{decision.comment_label}}` and `{{decision.comment_placeholder}}` MUST be
  replaced with the locale-resolved strings at generation time (see § UI Locale).
- `ensureCommentSlots()` is idempotent — re-running it does nothing once
  every group has a textarea, so it is safe to call multiple times (e.g.
  after a Claude-driven iteration append).
- Iteration appends MUST also call `ensureCommentSlots()` after the new
  section is inserted; the `DOMContentLoaded` hook only fires on full
  reloads. Either trigger it manually or rely on the next `/reload` POST
  which forces a `location.reload()`.

