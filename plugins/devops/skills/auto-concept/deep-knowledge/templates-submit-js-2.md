# Concept templates, part 36 of 43: Shared systems — two-button submit JS (continued 2)

```javascript
// Every user-facing string comes from the sheet's data-label-* attributes,
// baked in from the locale table at generation time.
function closeoutLabel(name, fallback) {
  const sheet = document.getElementById('closeout-sheet');
  const key = 'label' + name.charAt(0).toUpperCase() + name.slice(1);
  return (sheet && sheet.dataset[key]) || fallback || '';
}
const CLOSEOUT_ROUTE_GLYPH = { implement: '⚡', issue: '📌', ignore: '✕' };
function closeoutRouteText(route) {
  return CLOSEOUT_ROUTE_GLYPH[route] + ' ' + closeoutLabel('route' + route.charAt(0).toUpperCase() + route.slice(1), route);
}
function closeoutEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// 🧭 One line per Fund: name · reason chip · route pill. The whole line is
// the button — it opens the bottom sheet (openRouteSheet()).
function decideRow(key, el) {
  const row = closeoutEl('button', 'closeout-todo closeout-decide');
  row.type = 'button';
  row.dataset.routeOpen = key;
  row.dataset.followup = followUpId(el) || key;
  // One line per row: the full name is the tooltip, so an ellipsis never
  // hides anything for good.
  row.dataset.tip = followUpLabel(el);
  row.appendChild(closeoutEl('span', 'closeout-todo-title', followUpLabel(el)));
  const reason = el.dataset.routeReason;
  if (reason) row.appendChild(closeoutEl('span', 'closeout-why', reason));
  const pill = closeoutEl('span', 'closeout-pill');
  pill.dataset.routePill = '';
  row.appendChild(pill);
  return row;
}
function sammelRow(rest) {
  const row = closeoutEl('button', 'closeout-todo closeout-decide closeout-sammel');
  row.type = 'button';
  row.dataset.routeOpen = CLOSEOUT_SAMMEL_KEY;
  row.appendChild(closeoutEl('span', 'closeout-todo-title',
    closeoutLabel('sammelRow', '{n}').replace('{n}', String(rest.length))));
  const pill = closeoutEl('span', 'closeout-pill');
  pill.dataset.routePill = '';
  row.appendChild(pill);
  return row;
}
function syncDecideRows() {
  const host = document.getElementById('closeout-decide-list');
  if (!host) return;
  const { rows } = closeoutFundeSplit();
  const byKey = {};
  rows.forEach(r => { byKey[r.key] = r.el; });
  host.querySelectorAll('[data-route-open]').forEach(row => {
    const key = row.dataset.routeOpen;
    const route = key === CLOSEOUT_SAMMEL_KEY ? sammelRoute() : followUpRoute(key, byKey[key]);
    const pill = row.querySelector('[data-route-pill]');
    if (pill) {
      pill.dataset.route = route;
      // The pill is short ("⚡ Jetzt ▾"); the bottom sheet names the route in full.
      pill.textContent = (route === 'implement'
        ? CLOSEOUT_ROUTE_GLYPH.implement + ' ' + closeoutLabel('routeImplementShort', 'implement')
        : closeoutRouteText(route)) + ' ▾';
    }
  });
}

// 🧪 / 👉 One line per to-do: text · criticality chip, then the three-way
// choice, then — only for "Mit Anleitung" — which kind of guidance it gets.
// Real radios (keyboard: Tab into the group, arrows to choose), unnamed in
// the persistence sense: data-no-persist keeps saveState() off them.
function todoRow(kind, el, i) {
  const key = todoKey(kind, el, i);
  const row = closeoutEl('div', 'closeout-todo closeout-todo-mode');
  row.dataset.todoKey = key;
  const head = closeoutEl('div', 'closeout-todo-head');
  const title = closeoutEl('span', 'closeout-todo-title', todoText(el));
  title.dataset.tip = title.textContent;
  head.appendChild(title);
  const crit = String(el.dataset.crit || '').toLowerCase();
  if (crit === 'low' || crit === 'mid' || crit === 'high') {
    const chip = closeoutEl('span', 'closeout-crit',
      closeoutLabel('crit' + crit.charAt(0).toUpperCase() + crit.slice(1), crit));
    chip.dataset.crit = crit;
    head.appendChild(chip);
  }
  row.appendChild(head);
  const seg = closeoutEl('div', 'closeout-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', title.textContent);
  CLOSEOUT_MODES.forEach(mode => {
    const label = closeoutEl('label', 'closeout-seg-opt');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'td-' + key;
    input.value = mode;
    input.dataset.noPersist = '';
    input.dataset.todoMode = key;
    label.appendChild(input);
    label.appendChild(closeoutEl('span', '',
      closeoutLabel('mode' + mode.charAt(0).toUpperCase() + mode.slice(1), mode)));
    seg.appendChild(label);
  });
  row.appendChild(seg);
  const kindLine = closeoutEl('div', 'closeout-guide-kind');
  kindLine.dataset.guideKind = '';
  row.appendChild(kindLine);
  return row;
}
// Done state (data-closed): the chosen mode as a plain line, no controls.
function todoDoneRow(kind, el, i) {
  const mode = todoMode(kind, el, i);
  const row = closeoutEl('div', 'closeout-todo closeout-todo-done');
  row.dataset.mode = mode;
  row.appendChild(closeoutEl('span', 'closeout-todo-title', todoText(el)));
  const g = todoGuide(el, mode);
  const text = closeoutLabel('mode' + mode.charAt(0).toUpperCase() + mode.slice(1), mode);
  row.appendChild(closeoutEl('span', 'closeout-pill', g === 'web' ? '🧭 ' + text
    : g === 'desktop' ? '🖥 ' + text : g === 'inline' ? '📄 ' + text : text));
  return row;
}
function syncTodoRows(kind) {
  const host = document.getElementById('closeout-' + kind + '-list');
  if (!host) return;
  const items = todoItems(kind);
  host.querySelectorAll('[data-todo-key]').forEach(row => {
    const i = items.findIndex((el, j) => todoKey(kind, el, j) === row.dataset.todoKey);
    if (i < 0) return;
    const mode = todoMode(kind, items[i], i);
    row.querySelectorAll('input[type="radio"]').forEach(inp => { inp.checked = inp.value === mode; });
    const line = row.querySelector('[data-guide-kind]');
    const g = todoGuide(items[i], mode);
    if (line) {
      line.hidden = !g;
      line.textContent = g ? closeoutLabel('guide' + g.charAt(0).toUpperCase() + g.slice(1), g) : '';
    }
  });
}

// Rebuild a group only when its item SET changes (by key, never by count) —
// a rebuild on every change would tear the row out from under the cursor or
// the keyboard focus mid-choice. Answers live in _closeoutChoices, so a
// rebuild never loses one.
function renderGroup(kind, keys, build) {
  const host = document.getElementById('closeout-' + kind + '-list');
  const group = host && host.closest('[data-closeout-group]');
  if (!host || !group) return 0;
  const sig = JSON.stringify(keys);
  if (host.dataset.itemKey !== sig) {
    host.dataset.itemKey = sig;
    host.textContent = '';
    build(host);
  }
  group.hidden = keys.length === 0;
  return keys.length;
}
function renderDecideGroup(closed) {
  const { rows, rest } = closeoutDecideSplit(closed);
  const keys = rows.map(r => r.key).concat(rest.length ? [CLOSEOUT_SAMMEL_KEY + ':' + rest.length] : []);
  const n = renderGroup('decide', keys, host => {
    rows.forEach(r => host.appendChild(decideRow(r.key, r.el)));
    if (rest.length) host.appendChild(sammelRow(rest));
  });
  const count = document.querySelector('[data-closeout-group="decide"] [data-closeout-count]');
  if (count) count.textContent = n ? String(rows.length + rest.length) : '';
  syncDecideRows();
  return n;
}
// The done state shows no Funde in the FAB — the report body says what
// became of each one (issue link / "umgesetzt").
function closeoutDecideSplit(closed) {
  return closed ? { rows: [], rest: [] } : closeoutFundeSplit();
}
function renderTodoGroup(kind, closed) {
  const items = todoItems(kind);
  const shown = items.slice(0, CLOSEOUT_GROUP_MAX);
  const keys = shown.map((el, i) => todoKey(kind, el, i)).concat(closed ? ['closed'] : []);
  const n = renderGroup(kind, items.length ? keys : [], host => {
    shown.forEach((el, i) => host.appendChild(closed ? todoDoneRow(kind, el, i) : todoRow(kind, el, i)));
    // More than three: the rest keep their authored default and stay in the
    // payload; the line only says they exist.
    if (items.length > shown.length) {
      host.appendChild(closeoutEl('p', 'closeout-more',
        closeoutLabel('todoMore', '{n}').replace('{n}', String(items.length - shown.length))));
    }
  });
  const count = document.querySelector('[data-closeout-group="' + kind + '"] [data-closeout-count]');
  if (count) count.textContent = items.length ? String(items.length) : '';
  if (!closed) syncTodoRows(kind);
  return n;
}

// --- Bottom sheet: one Fund, its reason, three big tiles ---
let _routeSheetKey = null;
function openRouteSheet(key) {
  const sheet = document.getElementById('closeout-sheet');
  const box = document.getElementById('closeout-route-sheet');
  if (!sheet || !box || sheet.dataset.frozen === 'true') return;
  const { rows, rest } = closeoutFundeSplit();
  const isSammel = key === CLOSEOUT_SAMMEL_KEY;
  const hit = rows.find(r => r.key === key);
  if (!isSammel && !hit) return;
  _routeSheetKey = key;
  const el = hit ? hit.el : null;
  const route = isSammel ? sammelRoute() : followUpRoute(key, el);
  const authored = isSammel ? 'issue' : routeDefault(el);
  box.querySelector('[data-route-title]').textContent = isSammel
    ? closeoutLabel('sammelRow', '{n}').replace('{n}', String(rest.length))
    : followUpLabel(el);
  const origin = box.querySelector('[data-route-origin]');
  const o = el ? el.dataset.oqOrigin : '';
  origin.hidden = !(o === 'deferred' || o === 'found');
  origin.textContent = o === 'deferred' ? closeoutLabel('originDeferred') : o === 'found' ? closeoutLabel('originFound') : '';
  const body = box.querySelector('[data-route-body]');
  body.textContent = isSammel
    ? rest.map(r => followUpLabel(r.el)).join(' · ')
    : (el.dataset.issueBody || '');
  body.hidden = !body.textContent;
  const reason = el ? el.dataset.routeReason : '';
  box.querySelector('[data-route-why]').textContent = closeoutLabel('routeRecommended')
    + ' ' + closeoutRouteText(authored) + (reason ? ' · ' + reason : '');
  box.querySelectorAll('[data-route-tile]').forEach(tile => {
    const v = tile.dataset.routeTile;
    tile.hidden = isSammel && v === 'implement';
    tile.setAttribute('aria-checked', v === route ? 'true' : 'false');
  });
  box.hidden = false;
  sheet.dataset.routeSheet = 'open';
  const current = box.querySelector('[data-route-tile][aria-checked="true"]');
  if (current) current.focus();
}
function closeRouteSheet() {
  const sheet = document.getElementById('closeout-sheet');
  const box = document.getElementById('closeout-route-sheet');
  if (box) box.hidden = true;
  if (sheet) delete sheet.dataset.routeSheet;
  const key = _routeSheetKey;
  _routeSheetKey = null;
  // Focus goes back to the row it came from, so the keyboard path continues.
  if (key != null) {
    const row = document.querySelector('#closeout-decide-list [data-route-open="' + CSS.escape(key) + '"]');
    if (row) row.focus();
  }
}
function chooseRoute(route) {
  if (_routeSheetKey == null || !CLOSEOUT_ROUTES.includes(route)) return;
  if (_routeSheetKey === CLOSEOUT_SAMMEL_KEY && route === 'implement') return;
  _closeoutChoices.route[_routeSheetKey] = route;
  closeRouteSheet();
  refreshCloseout();
}

// --- 🤖 Claude macht beim Klick ---
// The plan line ("⚡ 2 × jetzt umsetzen · 📌 1 × Issue anlegen") is the
// readout of the inbox above — re-rendered on every change, so it can never
// describe an older answer than the one on screen.
function renderCloseoutPlan() {
  const el = document.getElementById('closeout-plan');
  if (!el) return;
  const impl = collectImplementItems().length;
  const iss = collectIssueItems().length;
  const parts = [];
  if (impl) parts.push('⚡ ' + closeoutLabel('planImplement', '{n}').replace('{n}', String(impl)));
  if (iss) parts.push('📌 ' + closeoutLabel('planIssue', '{n}').replace('{n}', String(iss)));
  el.textContent = parts.join(' · ');
  el.hidden = parts.length === 0;
}
// The disposition as ONE line with its default — "🧹 Diese Seite wird
// gelöscht · ändern"; "ändern" opens the radios + moveTo inline.
function renderDisposeLine() {
  const el = document.querySelector('[data-dispose-summary]');
  if (!el) return;
  const d = collectDisposition();
  const name = d.mode === 'keep' ? 'disposeLineKeep' : d.mode === 'gitignore' ? 'disposeLineGitignore' : 'disposeLineDiscard';
  el.textContent = closeoutLabel(name, d.mode) + (d.moveTo ? ' → ' + d.moveTo : '');
}
function toggleDisposeEdit(open) {
  const btn = document.getElementById('closeout-dispose-edit');
  const set = document.getElementById('panel-dispose-concept');
  if (!btn || !set) return;
  const next = typeof open === 'boolean' ? open : set.hidden;
  set.hidden = !next;
  btn.setAttribute('aria-expanded', next ? 'true' : 'false');
}

// --- The two buttons: the ship answer, then the status ---
// Before the click: "🏁🚀 Abschließen & shippen" (warning fill) and "🏁 Nur
// abschließen, nicht shippen" (ghost). While the bridge is disconnected both
// say "· wird zwischengespeichert" — the final report has no status line
// (§ CSS body.viewing-final .panel-status), so the buttons are the one place
// left to say the click will be queued. checkClaudeConnection() calls this
// on every heartbeat for that reason. Never touches a sheet that already
// carries a finalize state.
function closeoutGoButtons() {
  return Array.from(document.querySelectorAll('#closeout-sheet [data-closeout-go]'));
}
function updateCloseoutButton() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet || sheet.dataset.finalizeState) return;
  const conn = document.getElementById('connection-status');
  const offline = !!conn && conn.dataset.state === 'disconnected';
  closeoutGoButtons().forEach(btn => {
    btn.hidden = false;
    delete btn.dataset.finalizeState;
    const label = btn.querySelector('[data-closeout-btn-label]');
    const icon = btn.querySelector('[data-closeout-btn-icon]');
    if (label) label.textContent = (btn.dataset.label || '') + (offline ? ' ' + (btn.dataset.labelOffline || '') : '');
    if (icon) icon.textContent = btn.dataset.icon || '';
    if (btn.dataset.titleReady) btn.dataset.tip = btn.dataset.titleReady;
  });
  const done = document.getElementById('closeout-close');
  if (done) done.hidden = true;
}
// After the click the CLICKED button is the status — running → done, or
// stalled — and the other one steps aside. Done collapses both into the one
// "✓ Concept abgeschlossen · schließen" button (it closes the panel). `null`
// clears the state again (restoreCloseoutToReady). The stalled state also
// keeps the one paragraph under the buttons: it carries an instruction.
function setCloseoutButtonState(state, which) {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  sheet.querySelectorAll('.hint[data-finalize-state]').forEach(el => {
    el.hidden = el.dataset.finalizeState !== state;
  });
  if (!state) {
    delete sheet.dataset.finalizeState;
    delete sheet.dataset.go;
    updateCloseoutButton();
    return;
  }
  sheet.dataset.finalizeState = state;
  if (which) sheet.dataset.go = which;
  const go = sheet.dataset.go || 'no';
  const done = document.getElementById('closeout-close');
  if (done) { done.hidden = state !== 'done'; done.disabled = false; }
  const glyph = state === 'running' ? '⏳' : state === 'done' ? '✓' : '⚠';
  const key = 'label' + state.charAt(0).toUpperCase() + state.slice(1);
  closeoutGoButtons().forEach(btn => {
    const mine = btn.dataset.closeoutGo === go;
    btn.hidden = state === 'done' || !mine;
    btn.disabled = true;
    btn.dataset.finalizeState = state;
    btn.removeAttribute('data-tip');
    const label = btn.querySelector('[data-closeout-btn-label]');
    const icon = btn.querySelector('[data-closeout-btn-icon]');
    if (label) label.textContent = btn.dataset[key] || '';
    if (icon) icon.textContent = glyph;
  });
}

// Freezing is not cosmetic: after a submit the payload is fixed, so a live
// choice or a re-enabled button would let the user act on a screen that no
// longer describes what was sent. Scoped to the sheet's own controls.
function setCloseoutFrozen(frozen) {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  sheet.dataset.frozen = frozen ? 'true' : 'false';
  if (frozen) closeRouteSheet();
  sheet.querySelectorAll('input, button').forEach(el => {
    if (el.id === 'closeout-close') return;
    el.disabled = frozen;
  });
}

// Re-arm after a finalize that did not complete — a blocked ship, a stale
// processed state, a bridge that could not persist. Without this the buttons
// stay disabled forever and the user's only way out is a reload.
function restoreCloseoutToReady() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  setCloseoutButtonState(null);
  setCloseoutFrozen(false);
  renderCloseout();
}

function renderCloseout() {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  // A closed-out report is done. Claude stamps data-closed on the section
  // before the final /reload (and data-mode on every 🧪/👉 item), so the
  // reloaded page shows the outcome instead of re-arming a sheet whose bridge
  // is already gone: only the 🧪/👉 items with their chosen mode, and the one
  // "✓ Concept abgeschlossen · schließen" button.
  const section = finalReportSection();
  const closed = !!(section && section.hasAttribute('data-closed'));
  sheet.dataset.closed = closed ? 'true' : 'false';
  const decided = renderDecideGroup(closed);
  const todos = renderTodoGroup('tests', closed) + renderTodoGroup('handoffs', closed);
  const claude = sheet.querySelector('.closeout-claude');
  if (claude) claude.hidden = closed;
  const empty = document.getElementById('closeout-empty');
  if (empty) empty.hidden = closed || decided + todos > 0;
  renderCloseoutPlan();
  renderDisposeLine();
  if (closed) {
    closeRouteSheet();
    setCloseoutButtonState('done');
    return;
  }
  // Re-apply after a rebuild: fresh rows would otherwise come back live on a
  // frozen sheet.
  if (sheet.dataset.frozen === 'true') setCloseoutFrozen(true);
  updateCloseoutButton();
}

// Called from showIteration() with { reset: true } (a tab switch re-reads the
// report from scratch) and from the change listener without it. "reset" is
// about the row SET only — the choices are kept, by id.
function refreshCloseout(opts) {
  const sheet = document.getElementById('closeout-sheet');
  if (!sheet) return;
  if (opts && opts.reset) {
    sheet.querySelectorAll('[data-closeout-group] [id$="-list"]').forEach(host => { host.dataset.itemKey = ''; });
  }
  renderCloseout();
}

// One submit for the whole close-out. POST /decisions has NO version guard
// (that lives on /reset and /status), so a payload the bridge already fsynced
// but whose response never reached the browser sits in two places at once.
// For an iterate that is harmless; for a finalize it means a second
// `gh issue create` run and a second real release. The id is what lets
// retryPendingSubmission() recognise its own payload on the bridge and drop
// the local copy instead of re-sending it.
function newSubmissionId() {
  return 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
```

