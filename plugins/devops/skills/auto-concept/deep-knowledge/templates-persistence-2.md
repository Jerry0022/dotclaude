# Concept templates, part 28 of 43: Shared systems — state persistence (continued 2)

```javascript
// `text:iN:` keys with N below the live round = drafts of a submitted
// round. Removes them from `state` in place; true when anything went.
function _pruneSpentDrafts(state) {
  const live = document.querySelector('section[data-iteration][data-active]');
  const cur = live ? Number(live.dataset.iteration) : NaN;
  if (!state || !isFinite(cur)) return false;
  let pruned = false;
  Object.keys(state).forEach(k => {
    const m = /^text:i(\d+):/.exec(k);
    if (m && Number(m[1]) < cur) { delete state[k]; pruned = true; }
  });
  return pruned;
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

