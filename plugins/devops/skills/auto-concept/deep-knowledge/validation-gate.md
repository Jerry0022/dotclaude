# Post-Generation Validation Gate

After writing the HTML file, validate that all mandatory interactive patterns
are present. **Grep the generated file** for each required pattern. The check
runs in three phases: first the forbidden patterns (hard fail), then the
shared patterns (all templates), then the template-specific extras selected
by the **active iteration's** template — `data-iteration-template` on
`section[data-iteration]`, projected onto `<html data-template="...">` by
`applyIterationTemplate()`. Each iteration on the page may carry a different
template; validate every iteration's section against its own
`data-iteration-template`, not just the one currently mirrored onto `<html>`.

> **Built pages (`step2-build.md`):** `concept-build.js build` copies the
> engine verbatim from the current templates and runs the deterministic gate
> before it writes the page. Phase 1 and the engine entries of Phase 2 are
> then satisfied by construction. Engine drift on iteration append cannot
> occur, because every build re-syncs. What stays Claude's to check, on the
> round fragment before building: Phase 0 (forbidden), Phase 2 for the round's
> own template, § Frozen/Active Mismatch (the build derives `data-template`
> from the live round) and § Mappings. Grep the built page only for an entry
> the build output names.
>
> **Deterministic backstop:** the `post.concept.gate` PostToolUse hook
> re-checks a critical subset of this gate (the live decision panel + bridge
> submit markers + the forbidden clipboard list below) on every write to a
> concept HTML and **blocks** if the page is invalid. The hook is the safety
> net, not a license to skip this manual gate. Run the full sweep BEFORE
> opening the page.

## Phase 0 — Forbidden patterns (hard fail)

A concept page is driven **exclusively** by the live bridge: the decision
panel's submit buttons POST to the bridge server and Claude picks the
decisions up via heartbeat + cron. The page MUST therefore contain **none**
of the following manual-handoff anti-patterns. Any match = reject the page
and regenerate with the live submit, exactly like a missing required pattern.

| Forbidden grep (case-insensitive) | Why it's banned |
|---|---|
| `navigator.clipboard` / `clipboard.writeText` / `clipboard.readText` / "copy to clipboard" | A "copy the decisions JSON" button is the regression this gate exists to kill — the live bridge already delivers decisions. |
| `zwischenablage` | German variant of the same clipboard-copy fallback. |
| `in den chat ein` / "paste … into chat" | Instructing the user to paste anything into chat means the live submit was never wired. |

There are no legitimate matches for the copy-out API or wording — do not
"keep it as a convenience".

**Not forbidden — the bare word is not the pattern (#330).** The attachment
engine (`templates-attachments.md` § Attachments, `initCommentAttachments()`) reads
`ev.clipboardData` in its Ctrl/Cmd+V paste handler. That is a paste *into* the
page, the opposite direction, and every page generated verbatim from the
reference contains it. Grep for the copy-out forms above, never for a bare
`clipboard`; `post.concept.gate` (`hooks/lib/concept-gate.js`) uses the same
narrowed pattern.

## Phase 0b — Structural integrity (hard fail, #346)

Every grep in Phase 1 and 2 passes on a page whose `<style>` block is broken
(a nested `<style>` swallows the `:root` token block while every marker is
still present). So before the pattern sweep, check the tag structure:

| Check | Rule |
|---|---|
| Balance | count of `<style` equals `</style>`; count of `<script` equals `</script>` (tag-open form only — `<style>` / `<style …>` — never the bare word in prose or a `style="…"` attribute) |
| No nesting | no `<style` opens while a `<style>` block is open; no `<script` opens while a `<script>` or `<style>` block is open |
| No strays | no `</style>` / `</script>` without an open block; no block left open at end of file |

```bash
# quick balance check — must print two equal pairs
grep -oiE '<style[[:space:]>]' "$HTML" | wc -l; grep -oi '</style>' "$HTML" | wc -l
grep -oiE '<script[[:space:]>]' "$HTML" | wc -l; grep -oi '</script>' "$HTML" | wc -l
```

`post.concept.gate` runs the same walk (`findStructural()` in
`hooks/lib/concept-gate.js`) on every write and blocks with the offending
offsets. A `<style` token inside an open `<script>` block is JS string content
(template literals that build markup) and is ignored.

**Then confirm the tokens actually applied — in the browser, before the page is
shown (SKILL.md Step 3).** Evaluate
`getComputedStyle(document.documentElement).getPropertyValue('--accent-color')`
on the loaded page; it MUST be non-empty. An empty value means the design-token block was swallowed even though the file
looks balanced (a stray `{`, an unterminated comment) — regenerate the block
from `templates.md` § Layout before opening the tab.

## Phase 1 — Shared patterns (ALL templates)

Every concept page must contain these 81 patterns, regardless of template
(the numbering carries `b` suffixes where a pattern was added next to a
related one — count the rows, not the highest number):

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-status` | The status line inside `.panel-status` — OUTSIDE `#panel-ready`, pinned above the CTA foot (glyph + label; the raw heartbeat on `data-state` = connecting / connected / disconnected, written by `checkClaudeConnection` in EVERY panel state, the visible line composed by `renderPanelStatus`). NOT an overlay, NO acknowledge button. |
| 3b | `_everPolled` | Pre-first-poll guard: the connection checker treats the window before the first `/heartbeat` response as "connecting", never "disconnected". Missing → the fresh-page connect→disconnect→connect flash returns. |
| 3c | `_tabId` AND `startHeartbeatWorker` AND `sendTabBye` | Tab liveness (#397): every browser poll carries `?tab=<id>`, the `/heartbeat` poll runs in a Worker so a hidden tab keeps polling under Chromium timer throttling, and `pagehide` (persisted=false) beacons `/bye`. Missing → the waker cannot tell a hidden tab from a closed one and re-opens the page every few minutes (tab storm). |
| 3d | `_lastSampleAt` AND `recoverFromFreeze` AND `WAKE_GRACE_MS` | Freeze-aware verdict: the checker judges the AGE OF THE SAMPLE before it judges `claude_ts`. A sample older than `SAMPLE_STALE_MS` means this page was frozen (Edge Sleeping Tabs, PC suspend, dead worker) — it re-polls at once, replaces a worker silent for a minute, and holds "connecting" through the grace window; "disconnected" needs two consecutive stale evaluations. Missing → every return to the tab and every PC wake flashes "Nur lokal gespeichert · getrennt" for 5–20 s although nothing is wrong. |
| 4 | `checkClaudeConnection` | Heartbeat checker function |
| 5 | `HEARTBEAT_STALE_MS` | Heartbeat staleness threshold |
| 6 | `SERVER_STALE_MS` | Bridge-process staleness threshold (distinguishes bootstrap from dead bridge) |
| 7 | `pollHeartbeat` | HTTP heartbeat polling function |
| 8 | `panel-ready` | Ready-state panel element |
| 9 | `panel-submitted` | Submitted-state panel element |
| 10 | `localStorage` | Reload resilience (state persistence with TTL) |
| 11 | `data-page-version` | Page version tag for localStorage invalidation |
| 12 | `data-iteration` | Iteration section marker |
| 12b | `data-iteration-template` on every `section[data-iteration]` | Authoritative per-iteration template. **Hard fail on the section carrying `data-active` and on any `data-final-report` section**; a warning on older frozen sections, whose legacy fallback (the concept's base template, `resolveIterationTemplate()`) still resolves. Every section you append carries the attribute. |
| 12c | `baseIterationTemplate` AND `_pageTemplateAtLoad` inside `resolveIterationTemplate`'s fallback chain — AND NOT `document.documentElement.dataset.template` as that fallback | Deterministic template resolution. The fallback is the concept's BASE template (the first iteration section that declares one), captured independently of the live projection. Falling back to `<html data-template>` makes an undeclared section's layout depend on navigation history. ENGINE entry — see § Engine drift on iteration append. |
| 13 | `iteration-tabs` | Tab bar container in the decision panel |
| 14 | `pollReload` | Reload-signal poller (picks up file rewrites) |
| 15 | `sec.hidden` | Tab-switch JS toggles the `hidden` attribute |
| 16 | `pollProcessedState` | Auto-reset poll handler |
| 17 | `section-nav` OR `screen-nav` | Panel navigation (TOC for decision/free, screen/design list for `design`, legacy alias `prototype`) |
| 18 | `data-nav-label` | Marker on nav-eligible sections |
| 19 | `submit-iterate-btn` | Primary submit: iterate action (no code changes) |
| 20 | `submit-implement-btn` | Secondary submit: implement action (real changes) |
| 21 | `querySelectorAll('input, select, textarea')` inside `collectDecisions` | Generic form catch-all (no hand-listed selectors per field) |
| 22 | `data-active]` selector inside `collectDecisions` | Catch-all is scoped to the active iteration only |
| 23 | `status-steps` | Progress list (Übermittelt → Verarbeitet → Realitäts-Check → Implementiert) — a real `<ol>` inside `.panel-status` under the status line, in a `<details class="status-detail">` hidden until submit; the dots on the line (`renderStatusDots`) only mirror its `data-state`s — see templates-submit-journey.md § Submit Progress Steps |
| 24 | `updateStatusSteps` | Wires `_picked_up_at` / `_phase` from `/decisions` polling into the progress list |
| 25 | `data.claude_ts` inside `pollHeartbeat` | The poller MUST read JSON and assign `claude_ts` (not `server_ts`, not the raw response object). HTTP-200 alone is not enough — the daemon self-pulse keeps `server_ts` fresh forever, so an HTTP-only check leaves the indicator green while Claude's cron is dead. |
| 26 | `_setCacheHints(` inside `checkClaudeConnection` | The checker MUST wire the per-button cache hint to the disconnected state, so a click made while Claude is offline reads as visibly queued (then auto-delivered by the Offline Submit Queue) rather than lost. Submit buttons stay enabled in every state — the queue, not a disabled button, is what prevents a black hole. |
| 27 | `Date.now() - _lastHeartbeatTs` (millis vs. millis) | Both sides of the staleness comparison MUST be in milliseconds since the Unix epoch. Server returns `claude_ts` in ms; browser uses `Date.now()`. Never divide either side by 1000 — a millis-vs-seconds mix-up produces a giant negative age that always evaluates as "fresh" and silently hides outages. |
| 28 | `panel-final-report` | Final-report panel element. Auto-shown by `showIteration()` when the active section carries `data-final-report`; replaces `panel-ready` (no iterate/implement buttons). Also on a page whose ONLY round is the final report (report-only entry, `concept-build.js init --report`) — the bridge, panel and close-out are the same as after a concept. |
| 28b | `panel-frozen` | Frozen panel state, shown on every non-live iteration tab. `showIteration()` switches to it unconditionally. Must include the `#back-to-live-btn`. |
| 29 | `refreshCloseout({ reset: true })` — grep the CALL, not the symbol | Re-renders the close-out inbox from the report body (the 🧭 group exists only while the active section has un-routed Funde in `[data-open-questions]`, 🧪/👉 only while `[data-tests]` / `[data-handoffs]` have items). The call must appear inside `showIteration()`, or a tab switch leaves the sheet describing the previous round. A page that defines the function but never calls it passes a symbol-only grep and renders a sheet that never updates. |
| 30 | `content-dimmer` | Shared post-submit focus overlay AND frozen veil. After a submit, `body.content-dimmed` flips it on; `showIteration()` re-arms it via `lockFrozenView()` on every entry into a non-live tab (so at most the one past round on screen is ever unlocked, and every tab switch relocks). The decision panel + FABs sit at higher z-index and paint above it. Click/Escape-to-dismiss; the submit role comes back on a reload while the live round is still sent (row 30c) and clears on the Claude-driven reload onto the next round. See `templates-common-structure.md` § Common Structure (HTML) and § Decision Panel State CSS for the reference implementation. |
| 30b | `frozen-bar` (the element) AND `lockFrozenView` (the CALL inside `showIteration()`) | Frozen-iteration floating bar + veil relock. The bar is page-level chrome (outside `section[data-iteration]`, next to the dimmer) that `showIteration()` unhides on every non-live tab with the tab's chip label in `[data-frozen-bar-title]` and a `#frozen-bar-back` button to the live round. Both halves ENGINE entries — see § Engine drift on iteration append. |
| 30c | `restoreInFlightRound` (the function, wired on DOMContentLoaded) AND `payload.iteration` inside `collectDecisions` | A sent round survives a manual reload. `concept-submitted` is not persisted, so without this a reload while Claude still works on the round drops the grey veil and re-arms the submit buttons over a payload already in flight. The function asks `GET /decisions` (offline: the `-pending` local queue) and restores the sent state only when the pending payload's `iteration` names the LIVE round — Claude posts `/reload` before `/reset`, so the next round briefly loads while the previous payload is still pending. `restoreInFlightCloseout()` does the same for a finalize (veil included). ENGINE entry — see § Engine drift on iteration append. |
| 30d | `_pendingRetryInFlight` (the guard, inside `retryPendingSubmission`) AND `if (isConnected) retryPendingSubmission();` ABOVE the submitted-panel return in `checkClaudeConnection` AND `bridgeThrew` inside `restoreInFlightRound` | A round whose submit never reached the bridge is delivered, not stranded on "Übermittelt · Claude arbeitet". An offline submit leaves the submitted panel up and queues the payload in `-pending`; `pollProcessedState()` only releases that panel once Claude stamps `_processed_at`, which an undelivered payload never produces — so the connected heartbeat must retry the queue BEFORE its submitted-panel early return. The retry is idempotent (one at a time, never beside `submitWithAction()`'s own POST). And `restoreInFlightRound()` reads the local queue only when `GET /decisions` THREW: a reachable bridge reporting nothing pending is the truth, and a `-pending` copy beside it is a payload the retry delivers, not a round Claude is working on. ENGINE entry — see § Engine drift on iteration append. |
| 31 | `ensureCommentSlots` | Auto-injects an adjacent `<textarea data-comment="$decisionId-note">` for every `[data-decision]` bi-state group that lacks one. MUST be called from `DOMContentLoaded` BEFORE `restoreState` so the restore step rehydrates the typed values onto real nodes. See templates-persistence-comments.md § Comment Slot Injection. |
| 32 | `panel-dispose-concept` AND `closeout-dispose-edit` | Disposition fieldset behind the 🤖 group's "🧹 Diese Seite wird gelöscht · ändern" line. Carries the discard / keep / gitignore radio group + optional `moveTo` input. See templates-final-report.md § Disposition Control. |
| 33 | `renderCloseout` AND `renderDecideGroup` AND `renderTodoGroup` AND `openRouteSheet` AND `closeoutFundeSplit` AND `setCloseoutButtonState` | The inbox renderers: the 🧭 rows with their pre-selected route pill + reason chip and the bottom sheet, the max-three cap with the Sammel-Issue row, the 🧪/👉 rows with Muss nicht · Mit Anleitung · Mach ich selbst, the done state, and the clicked button's post-click states (running/stalled, done = `#closeout-close`). |
| 33b | `data-oq-origin="deferred"` or `data-oq-origin="found"` on EVERY Fund (element with `data-issue-title`) inside `[data-open-questions]` — plus `data-route-default` (`now` / `issue` / `ignore`) and a one-word `data-route-reason` — and NO `input[type="checkbox"]` inside that block; checked only when a `data-final-report` section carries it | The open-points admission gate made structural (`SKILL.md` § Open points admission gate): a Fund is admissible only as a point the user deferred during this concept or as something found on the way and unrelated to its scope. A Fund without an origin — or with any other value — skipped the gate, typically a piece of approved scope that was not built and got re-labelled as a follow-up. A Fund without a route default is one Claude did not pre-answer (the panel then falls back to 📌 Issue). A checkbox in the report body is the old interaction — the FAB is the only place to answer now. Hard fail on the final-report section. A report with no `[data-open-questions]` block passes — that is the normal case, not a gap. |
| 34 | `collectIssueItems` AND `collectImplementItems` AND `collectTodos` | The two disjoint buckets the sheet produces from the Funde — `finalize.issues.items[]` (file it, incl. the one Sammel-Issue) and `finalize.implement.items[]` (build it now) — and the `tests[]` / `handoffs[]` lists with `mode` (`skip` / `guide` / `self`) and `guide` (`web` / `desktop` / `inline` / null). Without them the close-out ships empty lists and silently drops the user's answers. |
| 35 | `collectDisposition` | Reads the disposition fieldset (`dispose-mode` radio + optional `dispose-move-to` input) into the `{ mode, moveTo }` shape the `finalize` payload requires. Without this, submit throws. |
| 36 | `body.viewing-final .panel-status` AND `body.viewing-final .panel-nav-scroll` (both CSS rules, `display: none`) — and NO `id="status-channel"`, NO `applyNavWindow`, NO `mountFinalJourney` anywhere in the file | The final-report panel is the close-out inbox and nothing else: no status line, no TOC window, no journey row — the panel head's phase icon ("🏁 Abschluss" instead of "🧭 Runde N") says where the session is, and the clicked button says the rest (a disconnected bridge is its "· wird zwischengespeichert" label, a running close-out its state). A page still carrying any of the three is an older skeleton and fails this entry. See templates-final-report.md § Final Report Panel. |
| 37 | `closeout-sheet` — AND all three of `data-closeout-group="decide"`, `"tests"`, `"handoffs"` — AND `closeout-route-sheet` AND both `id="closeout-ship"` and `id="closeout-noship"` — and NO `data-closeout-block`, `closeout-execute`, `closeout-progress` or `name="closeout-ship"` | The close-out inbox: the `data-label-*` localised strings it renders from, the three to-do groups, the bottom sheet for one Fund, and the two buttons that are the ship answer. Its absence means the final report has no way to close out at all. A page still carrying `data-closeout-block` / `closeout-execute` is the sequential accordion ("Weiter ›", "n von N"), one with `wizard-next` the older step chain — both fail this entry. |
| 37b | `closeout-handoffs-list` AND `closeout-tests-list` — and, when the final report carries a `[data-handoffs]` / `[data-tests]` list, every `<li>` has `data-crit` (`low` / `mid` / `high`) and `data-guide` (`web` / `desktop` / empty), at most three each, and no text "nicht führbar" anywhere on the page | The 🧪 / 👉 mirrors: what Claude could not verify and what the user does by hand afterwards, each pre-selected from criticality then guidability, and the only items left in the panel after `data-closed`. Without `data-crit` / `data-guide` the pre-selection falls back to "Mach ich selbst" for everything. "Nicht führbar" is never shown — "Mit Anleitung" on such an item means written steps. A report without the section passes — most concepts hand nothing over. |
| 38 | `addEventListener('click', closeoutSheetClick)` — grep the WIRING, not the symbol | The one delegated handler behind the sheet. A click on `#closeout-ship` / `#closeout-noship` (`[data-closeout-go]`) calls `submitFinalize(true / false)`, which POSTs the single `action: "finalize"` payload (`issues` + `implement` + `ship` + `tests` + `handoffs` + `disposition` + `submission_id`) and requires the bridge's durable ack; the same handler opens the bottom sheet for a 🧭 row, applies a tile, and toggles the disposition edit. A frozen sheet or one already carrying a finalize state ignores every click — no second payload. |
| 38b | `submission_id` inside `submitFinalize` | Client-side replay guard. `POST /decisions` has no version guard, so a payload the bridge fsynced before the response was lost sits in the offline queue too; without the id, `retryPendingSubmission()` re-delivers it and the close-out creates its issues and runs its release a second time. |
| 39 | `installScrollSpy` called from **inside** `buildSectionNav` | Scroll-position marker for the panel TOC. `buildSectionNav()` replaces the nav DOM on every iteration switch, so the spy MUST be rebound as its last step. Binding it once from `DOMContentLoaded` instead leaves the highlight dead on every tab except the initially loaded one. See templates-section-nav.md § Section Navigation. |
| 40 | `revealNavItem` — AND `getClientRects().length === 0` as its first guard | Auto-scrolls the TOC's own scroll box so the active entry stays visible in long lists. Must scroll only `nearestScrollBox(item.parentElement)` — never `scrollIntoView()` on the item, which drags the content column along and fights the user's scrolling. The zero-rect guard returns early for an entry inside a closed `<details>` (folded group or archive): measuring its (0,0) rect would drag the scroll box to the top on every frame. |
| 41 | `data-attachable` | The ONE marker `initCommentAttachments()` matches to decide which fields get an attachment bar. MUST NOT be `data-comment`. See templates-attachments.md § Attachments. |
| 42 | `initCommentAttachments` | Wires the 📎 button, drag & drop, and Ctrl/Cmd+V paste onto every `textarea[data-attachable]`. Missing → attachment bars render (if emitted inline) but do nothing. |
| 43 | `_guardedSetItem` | Every `localStorage.setItem` call site (state persistence + both `-pending` submit-queue writes) MUST go through this wrapper, never a bare `localStorage.setItem`. A `QuotaExceededError` thrown out of an unguarded call kills ALL further persistence for the rest of the page with nothing telling the user — see templates-persistence.md § State Persistence. |
| 44 | ALL FOUR of `textarea[hidden] + .attach-slot`, `textarea[hidden] + .attach-bar`, `insertAdjacentElement('afterend', bar)` (inside `_mountAttachmentBar`), `attach-visibility-styles` — AND NEITHER of `parentElement.appendChild(bar)` NOR `attach-hint` | The attachment engine's four halves; any one missing puts the 📎 stack back. The dock builds one textarea per screen / design / view and hides all but the active one, but a `.attach-slot` mount is that textarea's SIBLING — and `.attach-slot:empty` stops covering it the moment `initCommentAttachments()` mounts a bar into it. `.attach-bar` covers the mountless path, `afterend` is what makes that path an adjacent sibling at all, and `attach-visibility-styles` is the JS-injected copy of both rules (`_ensureAttachStyles()`) for a page that took the engine without the Layout CSS. The two negatives are the legacy shapes: `parentElement.appendChild(bar)` mounts the bar out of reach of every rule above, `attach-hint` is the removed per-field shortcut label. See templates-attachments.md § Attachments. |
| 44b | `ATTACH_LOCALE` (the object) AND `attachStatusText` — AND NOT `'{{attach.' +` | The chip tooltip's runtime locale (#343). Every other `{{key}}` is swapped at generation time, but the upload-failure reason is only known in the browser, so the old engine composed `{{attach.<reason>}}` at render time and the reviewer saw a raw token. `ATTACH_LOCALE` carries one substituted string per bridge reason (plus `uploading` / `error_offline`) and `attachStatusText()` falls back to `error_generic` for anything unknown. After generation the object's values must be real text — a `{{attach.` left anywhere in the JS means the swap was skipped. ENGINE entry — see § Engine drift on iteration append. |
| 46 | `html[data-template="design"] .concept-content > header` AND `.iteration-intro { display: none` in the same rule | Design mode's iteration sections are `position: absolute; inset: 0`, but a page that started as `decision` or `free` keeps a `<header>` (h1 + subtitle — no controls; the theme toggle is in the ☰ panel head) in `.concept-content` and an `<header class="iteration-intro">` per iteration, both in normal flow. Without this rule the canvas paints straight over them and their text bleeds through the mockup under the fixed screen indicator. Mandatory on every page that mixes `design` with `decision`/`free`. See templates-design-css.md § Layout CSS → "Document chrome vs. the fullscreen canvas". |
| 47 | `html[data-template="design"] section[data-iteration]:not([data-active])` with `opacity: 1` | The exemption from § Tab Bar CSS's generic `opacity: 0.85` frozen-iteration cue. On an absolute/inset:0 design section that cue is a see-through, not a dim. Frozen state is already carried by the panel's frozen state and the read-only dock (`applyDockFreezeState`). Missing → hard fail, same as 46: the two defects only ever appear together. |
| 48 | `scrollbar-width: thin` + `::-webkit-scrollbar` on the universal `*` selector (plus `color-scheme` per theme) — reaching `.feedback-dock`, `.panel-nav-scroll`, `section[data-screen]` and every scroll box the content adds | **Warning, not a hard fail** — the page is usable without it. The three chrome boxes legitimately carry `overflow-y: auto` (the panel aside itself no longer scrolls — its tree box does, see entry 56), page content adds more (code blocks, mapping tables, textareas), and the default Chromium/Windows bar is an opaque 16px slab inside a 430px dark dock. Skinned thin with a `var(--border-color)` thumb on a transparent track, once, for every element (`ui-defaults.md` R5) — a box list goes stale the moment content adds a scroll container. Both syntaxes required (`scrollbar-*` for Firefox/modern Chromium, `::-webkit-scrollbar*` for WebKit). See templates-design-css.md § Layout CSS → "Scrollbars". |
| 48b | `wireAppTooltips` AND `.app-tip` — AND no ` title="` attribute outside `<title>` | The app tooltip engine (`ui-defaults.md` R0/R1, templates-utilities.md § App Tooltips). Every hover hint is `data-tip` rendered in the page's tokens with the two delay tiers — Info 1500 ms by default, Label 500 ms only for an icon-only control, cut-off text or a disabled control. A native `title` shows the OS tooltip, cannot be delayed and never opens on keyboard focus; the engine converts a stray one on sight, but generated markup MUST NOT emit it. Missing engine → every `data-tip` in the page is silent. |
| 49 | `_iterationPrefix` — AND every `state['text:` write going through it | Per-iteration namespace for typed keys (`text:i3:d1-s1`). Screen ids, `{decisionId}-note` keys and annotation ids all repeat across rounds, and the feedback dock is one shared overlay outside `section[data-iteration]` — so an unnamespaced key means a different note in every round. Without it, round N+1 opens pre-filled with N's text. ENGINE entry — see § Engine drift on iteration append. |
| 50 | `queueDraftSync` AND `hydrateDraftFromBridge` AND `flushDraftBeacon` | The durable mirror: every autosave is POSTed to the bridge's `/draft` (fsynced before the ack), flushed by `sendBeacon` on `pagehide`/`hidden`, and merged back on load. `localStorage` alone does not survive a wiped profile, a private window, a quota error or a power cut — and it is the ONLY copy of work that has not been submitted yet. All three halves required: without the flush a closed tab outruns the last write; without the hydrate the durable copy is never read back. |
| 51 | `markDockSubmitted` AND `unmarkDockSubmitted` (the latter CALLED from `restorePanelToReady`) — AND NOT `clearDock()` anywhere on the submit path | The dock keeps every character when a round is submitted; only editing is taken away. The un-mark is not optional: every path that hands control back on a round that did not go through (507, or the safety timeout when Claude stopped answering) re-arms the submit buttons, and a ready panel over a read-only comment surface lets the user re-submit without being able to change anything first. |
| 52 | `_carryOverTypedWork` — AND NO `removeItem(STORAGE_KEY)` anywhere | Nothing may delete the state blob. TTL expiry and a page-version change prune it key by key (every `text:` entry is kept, the rest is dropped, the original is archived under `-archive`); the panel reset clears panel flags only. |
| 53 | `section[data-iteration]:not([data-active])` inside `saveState`'s `persistable` — AND a `viewing-frozen` guard on `#feedback-dock` | A frozen round is never persisted. Browsing an old tab is allowed and ends every `showScreen()` in a `saveState()`, and `applyDockFreezeState()` has painted that round's submitted comments into the shared dock — so without both exclusions the old round's answers are written over the live round's unsent ones, silently. ENGINE entry. Since #399 the dock exists on every page, so this guard is exercised on every template — a decision page browsing an old round with the pre-#399 persistence block writes the frozen general note over the live one. |
| 54 | `data-step="reality-check"` in the `#status-steps` list — AND a `_phase === 'reality-check'` branch in `updateStatusSteps` | The implement gate's progress step. The reality check sits between the pickup and the first code write, so without it a minutes-long check reads as a stalled submission. The `<li>` must ship `hidden` and be unhidden ONLY by that branch: pre-arming it would advertise a check on every implement, and the overwhelmingly common case is a branch that has not moved. See templates-submit-journey.md § Submit Progress Steps. ENGINE entry — see § Engine drift on iteration append. |
| 55 | `iteration-tab[data-reality-check]` (the CSS) — required on any page that already contains a `section[data-iteration][data-reality-check]` | The reality-check round's tab marker. `data-reality-check` on the section is what tells the implement path "this round WAS the check, implement straight through"; the chip styling is how the user understands why an implement click produced another round instead of code. A page carrying the section without the styling still behaves correctly but looks like an unexplained extra iteration. Both the section and its chip carry the attribute — see reality-check.md § The forced round. |
| 62 | `panel-toggle` AND `panel-backdrop` AND `panel-close` in the markup, `window.openPanel` in the JS — on EVERY page, whatever its templates — AND NEITHER `.panel-fab` inside any `html:not([data-template="design"])` rule NOR a `.concept-decision-panel` rule carrying `position: sticky` or `width: 20%` | The ☰ decision panel is page chrome. The panel wiring must also live OUTSIDE the design layout IIFE, which a document-only page never runs. The residual-sidebar negative is what catches the dangerous mixed page: both `.concept-decision-panel` rules have the same specificity, so a leftover `position: sticky; width: 20%` wins on source order — the FAB then renders, `.open { right: 0 }` does nothing to a sticky element, and the backdrop (z-index 150) covers the panel. Dark screen, no way in, every literal above still present. See templates-panel.md § Panel Chrome (all templates). ENGINE entry — see § Engine drift on iteration append. |
| 62b | `id="theme-toggle"` inside `#decision-panel`, in a `.panel-head` row together with `#panel-close`, carrying `data-label-light` + `data-label-dark`; `html[data-theme="dark"] .theme-toggle-btn [data-glyph="sun"]` in the CSS; `<html … data-theme="dark"` unless the project's `reference.md` overrides the default — AND NOT `theme-toggle` anywhere inside `.concept-content > header` | The theme toggle is panel chrome, not content. The header negative is what catches a regenerated page that copied an old header: two toggles, one of them dead in design mode. See templates-utilities.md § Theme Toggle. |
| 45 | `section[data-design]:not([data-design-active="true"])` | The CSS backstop for "exactly one design and one screen paint". Designs and screens are `position:absolute; inset:0`, so a single inactive section that ships without `hidden` does not sit somewhere wrong — it paints on top of the active one. `hidden` cannot be the only guard because the markup is merely ASKED to emit it. Must be `:has()`-guarded, together with the matching `section[data-screen]:not([data-screen-active="true"])` rule and `body:not([data-view-active="true"]) section[data-view]`. See templates-design-css.md § Layout CSS. |

| 56 | `panel-nav-scroll` (the element) AND `min-height: 0` inside its CSS rule | The panel's flex split. `.concept-decision-panel` is a flex column that never scrolls itself; `.panel-nav-scroll` (`flex: 1 1 auto; min-height: 0; overflow-y: auto`) holds the (hidden) iteration tabs + the live round's TOC only — the other rounds live in the pinned head's 🕘 rounds list now — so `.panel-status` and `.panel-cta` stay pinned at the bottom. `min-height: 0` is load-bearing: without it the flex child refuses to shrink, the tree grows past the viewport and the call to action leaves the screen — the exact "scroll the menu to find the button" defect the anatomy removes. No page reserves a 💬 FAB gutter under `.panel-cta` any more — the FAB hides while the panel is open. ENGINE entry — see § Engine drift on iteration append. See templates-panel-state.md § Decision Panel State CSS "Panel anatomy". |
| 57 | `submit-menu-btn` AND `submit-menu` (with `role="menu"`) — and `submit-implement-btn` INSIDE it | The split button. The implement action lives one level deeper behind the ▾ caret (`aria-haspopup="menu"`, `aria-expanded` mirrors the menu's `[hidden]`; Escape / outside click close it). The misclick barrier is colour + border + the extra click, not distance — no `.submit-gap` in `#panel-ready`, which is what keeps the foot ≤120px (`max-height: 120px` on `.panel-cta`). The two hint paragraphs are gone (they are `title` tooltips now); `[data-cache-hint]` stays, twice, still toggled by `_setCacheHints`. #367 (two rounds): `#submit-menu` MUST be `position: absolute` with `.concept-decision-panel` as its containing block, computed panel-relative by `wireSubmitMenu()` — `.panel-cta` MUST NOT carry `position: relative` (it stays un-positioned on purpose). `.panel-cta` carries `overflow-y: auto` as its own ≤120px safety net (entry 56 / #341); if the menu's containing block were `.panel-cta`, that overflow would clip/scroll the popover away — the caret would toggle `aria-expanded` with nothing visible or clickable on screen. Never `position: fixed` off a viewport rect sampled at open time: the ☰ panel can still be sliding in, so the menu opens off-screen; anchored to the panel it moves with it. |
| 58 | `panel-status` (the element) AND `renderPanelStatus` (the function, CALLED from `checkClaudeConnection`, `_setDraftPhase`, `submitWithAction`, `restorePanelToReady` and `showIteration`) | The pinned status line: one line, six mutually exclusive states on `data-status` (saved / saving / connecting / local-only / submitted / frozen), composed from the heartbeat, the draft mirror (`_draftPhase`) and the panel state. `checkClaudeConnection` MUST write `#connection-status[data-state]` and call the renderer BEFORE its `#panel-submitted` early return — the old pill went stale the moment the submitted panel came up. "Nur lokal gespeichert" is the one state with a background: it is the only line that means "your work is not delivered". |

| 59 | `buildIterationTree` (CALLED from `buildSectionNav`) AND `buildRoundsChip` (CALLED from `buildIterationTree`) | The Kompass tree. `buildSectionNav()` builds `#section-nav` for the live round only, inside the (visible) scroll box; every other chip gets a generated `.iteration-tab-summary`, and `buildRoundsChip()` turns that + the previous chips into the pinned head's 🕘 rounds chip (count of PREVIOUS rounds, hidden when none) and its toggled list, each row tagged `{{nav.archived}}` and driving `showIteration()` on click. The chips stay plain string-appended `<button class="iteration-tab">`s inside a hidden `.iteration-tabs` — a page with hand-written summaries or a hand-built rounds list in its HTML is re-derived on load, a page whose JS lacks this is the old flat column. ENGINE entry — see § Engine drift on iteration append. See templates-section-nav.md § Section Navigation. |
| 60 | `NAV_GROUP_OVER_ENTRIES` AND `nav-group` AND `dataset.navGroup` AND `computeSelectedVariant` inside `buildSectionNav` | TOC grouping. When ≥2 variant sections exist and `computeSelectedVariant` finds an unambiguous one (one "Miteinbeziehen" while every other variant is "Verwerfen", or the reading-line fallback), that variant renders as an OPEN `details.nav-group.nav-variant-open` with its own nested sections, every other variant collapses into one `details.nav-group.nav-other-variants` row, and context sections stay flat — the size-based rule (`details.nav-group` only when ≥2 kinds are present AND the round has >12 entries; kinds derive from the existing `eval-{id}` contract plus the optional `data-nav-group="…"` override) applies only when no variant is selected. Grouping from any attribute that does not exist in the markup, or unconditional grouping, is a failure. The one-open `toggle` listener and the summary-click "manual close" stamp MUST be bound inside `buildSectionNav` on every `.nav-group` except `.nav-variant-open` (nothing may close it), and the scroll spy (`openNavGroupFor`) may OPEN a group but never close one. |
| 60b | `navOverflowFloor` (the function, CALLED from `applyNavOverflow`) | The "+N weitere" overflow cut never hides the TOC child that holds the active entry (with none active: the first child) or anything above it; the scroll box scrolls for the rest. Without the floor, an open group taller than `.panel-nav-scroll` made the cut hide EVERY child and the panel showed nothing but the toggle (#541). ENGINE entry — see § Engine drift on iteration append. |
| 61 | `data-here-section` (the element) AND `openNavGroupFor` (CALLED from `setActiveNavItem`) AND `updateHereRoundParenthesis` (CALLED from `setActiveNavItem`) AND `pickInitialNavTarget` (CALLED from `buildSectionNav`) | The pinned "you are here" breadcrumb is written by the scroll spy (`setActiveNavItem`), which also updates the head's `data-here-round` parenthesis — "Iteration N (Variante)" — ONLY when the entry under the reading line carries `data-variant`, and opens the group that holds the active entry, honouring a deliberate close for `NAV_MANUAL_CLOSE_GRACE_MS` (4 s). The group state cannot wait for the spy, though: on a fresh build no item may be `.is-active` yet (first paint, an async/IntersectionObserver spy, or a `getBoundingClientRect()` read that predates layout), so `buildSectionNav()` calls `pickInitialNavTarget()` synchronously — `.is-active` if any, else the reading-line entry from real geometry, else the FIRST entry — and opens ITS group unconditionally, on load and on every rebuild, before the spy runs at all. `[data-here-section]` is dropped entirely on the final report (`showIteration` hides it under `isFinal`). Missing → the head never names the section under the reading line, never shows the variant parenthesis, and the TOC opens empty (both groups collapsed) until the user scrolls. |
| 63 | `.draft-offline-strip[hidden]` AND `.recovered-notes-strip[hidden]` (the CSS rule, `display: none`) — required wherever the `.draft-offline-strip, .recovered-notes-strip` rule exists | The two bottom strips are `display: flex` by their base rule, which outranks the UA `[hidden] { display: none }` — so `_setDraftHealth(true)` and the recovered-strip dismiss button set the attribute and nothing happens on screen. Without the override a momentary bridge blip (three debounced saves in ~3 s) leaves a permanent, false „Bridge nicht erreichbar" strip over a bridge that answers 200 (#362). Same pattern every other toggled bar carries (`.frozen-bar[hidden]`, `.content-dimmer[hidden]`, `.hint-cache[hidden]`). ENGINE entry — see § Engine drift on iteration append. |
| 64 | `.concept-decision-panel {` (the CSS rule) AND `async function submitWithAction` AND `async function retryPendingSubmission` (the functions) — on EVERY page; plus, keyed on `<html data-template>`: decision / free / prototype → `.concept-layout {` AND `.concept-content {` (§ Layout — Document rounds); design → see P33 | **Engine integrity (#430).** Entries 56 / 59 / 62 prove the page was generated from the CURRENT templates.md; this one proves the engine blocks are still INTACT afterwards. Enforced by `hooks/lib/concept-gate.js` (`findStaleEngine`, `ENGINE` + `ENGINE_DOCUMENT` / `ENGINE_DESIGN`) under the STALE ENGINE block — the fix is the same as for drift: re-sync the whole engine from templates.md, keep the content sections. Never edit the engine `<style>` / `<script>` with a splice script; append rounds by inserting content sections only (SKILL.md Step 5c). ENGINE entry — see § Engine drift on iteration append. |
| 65 | `_drainDraftResponse` (the function, CALLED from `flushDraft` and from the `flushDraftBeacon` fallback) — AND NO `keepalive` inside `flushDraft` | The draft mirror must never pin Chromium's keepalive quota. A keepalive request's body stays booked against a 64 KiB per-page quota until its response completes, and a `no-store` response nobody reads never completes — so a fire-and-forget keepalive `/draft` stopped mirroring after ~27 autosaves. The live autosave is a plain fetch whose response is read to the end; `keepalive` stays on the teardown fallbacks (`flushDraftBeacon`, `sendTabBye`), which drain their responses too. Enforced by `hooks/lib/concept-gate.js` (`ENGINE`, STALE ENGINE block). ENGINE entry — see § Engine drift on iteration append. |

**Feedback dock — page chrome in every template (#399).** The 💬 FAB and its
dock used to be checked under § Template: design only. They are part of the
shared engine now (templates-panel.md § Panel Chrome (all templates) → Feedback
dock): the same markup, CSS and JS on a `decision`, `free` or `design` page, a
document round showing only the general-notes section. Run these on EVERY
page, whatever its templates:

| # | Pattern | Purpose |
|---|---------|---------|
| P1 | `feedback-dock` | Speech-bubble dock anchored to the 💬 FAB (bottom-right) — page chrome in EVERY template (#399): a document round shows its general section only, a design round adds the per-screen / per-design / per-view rows |
| P2 | `feedback-toggle` | The 💬 FAB that opens the dock — exactly one per page, never inside `html:not([data-template="design"])`-hidden chrome |
| P5 | `design-general-feedback` OR `proto-general-feedback` | General-notes textarea inside the dock, `data-comment="general"` + `data-attachable` + its `.attach-slot` (legacy pages use the `proto-` name). This is the `comments.general` of every payload |
| P11 | `data-open="false"` on `#feedback-dock` | The dock MUST start collapsed. A page that ships `data-open="true"` opens onto three empty textareas covering the artefact. |
| P12 | `applyDockSize` (exported as `window.applyDockSize` from § Panel Chrome (all templates) → Feedback dock, NOT inside `wireDesignLayout()`) | Picks the dock's size: `compact` on every document round, from `body[data-single-*]` on a design round. Missing → the dock falls back to whatever width the page's CSS happens to declare, which is how the same concept renders as a mini-box in one iteration and a full-width bar in the next. |
| P13 | `.panel-fab,` + `.feedback-fab` sharing ONE size/shape rule | Both FABs are one component with two positions. A page that declares separate `width`/`height`/`border-radius` per FAB has the 56-vs-64px mismatch back. |
| P13b | `feedback-maximize` | Dock maximise/restore control — a DISTINCT button from `feedback-close` (minimise closes, this only resizes). Mandatory on every page: the dock has no other way to grow past its automatic compact/wide size. |
| P13c | `data-user-maximized` on `#feedback-dock` | The persisted maximise override. Deliberately a SEPARATE attribute from `data-size` (which `applyDockSize()` still only ever sets to `compact`/`wide` — exactly two automatic sizes, unchanged): the maximised CSS rule (`.feedback-dock[data-user-maximized="true"]`) composes on top of whichever of the two is current. Missing → the maximise button toggles the DOM but nothing resizes, or a reload silently drops the user's choice. |
| P13d | `data-tip=` AND `aria-label=` on BOTH `#panel-toggle` and `#feedback-toggle`, plus `data-untouched` on the 💬 FAB | Two halves of the "unlabelled emoji circle" fix. **Labels are tooltip-only:** both FABs carry `data-tip` (the app tooltip, § App Tooltips) + `aria-label` sourced from the locale table (never a baked-in literal such as "Feedback"), swapped between `data-label-open` / `data-label-close` together with `aria-expanded` by the toggle JS. No visible pill text — a label rendered inside the button changes the box and breaks P13's shared geometry. **The pulse may not touch geometry either:** `@keyframes fabPulse` + `.feedback-fab[data-untouched="true"]` may animate `box-shadow` and `transform` ONLY — any `width`, `height`, `border-radius` or `padding` in the keyframes or the rule re-opens the 56-vs-64px drift P13 exists to prevent. It must be a one-shot (finite iteration count), cleared by the JS on the first dock open and on the first keystroke inside the dock, and disabled under `@media (prefers-reduced-motion: reduce)`. |
| P13e | `--dock-ceiling:` declared on `.feedback-dock` AND `var(--dock-ceiling)` inside EVERY `max-height` of `.feedback-dock` / `[data-size="wide"]` / `[data-user-maximized="true"]` / the ≤560px media rule, AND `.panel-fab { z-index: 220; }`, AND `closeDock?.(true)` inside `window.openPanel` | The dock and the ☰ FAB share the right-edge column. Three locks: the ceiling (viewport − ☰ band − dock bottom offset) ends the dock just below the ☰; the ☰ FAB's z-index keeps it clickable even on a page whose ceiling was lost to an old rule; the reciprocal `closeDock(true)` in `openPanel()` folds the dock away the moment the ☰ is clicked (the user wants the panel, not both). A `max-height` that names a bare `vh` without the ceiling re-opens the overlap. |
| P13f | `html:not([data-template="design"]) .feedback-dock .feedback-section:not(:has(#design-general-feedback))` (the compact rule) — AND NEITHER `.feedback-fab` NOR `.feedback-dock` inside the `html:not([data-template="design"])` chrome hide list | What a document round shows of the dock is decided by folding the design-only rows, never by hiding the dock. A page that still lists `.feedback-fab` / `.feedback-dock` in the hide list has the pre-#399 engine: the dock vanishes on every document round of a mixed concept, together with the note typed into it. ENGINE entry — see § Engine drift on iteration append. |
| P13g | `function collectComments(` — AND `comments: { general: { text, attachments }, items: [ … ] }` as the shape every branch returns (grep `collectComments(active` inside `collectDecisionDecisions`, `collectFreeDecisions` AND `collectDesignDecisions`) | One payload shape for the note the dock carries in every template (§ collectDecisions (dispatcher)). A branch still pushing a flat `comments[]` array ships the general note nowhere on a document round. ENGINE entry. |

**Required for new pages, tolerated on legacy ones.** Every page generated
from the current reference carries all of the above — a fresh `decision` or
`free` page without `#feedback-dock` is a hard fail exactly like a design
page without it. A page whose `data-page-version` (pattern 11) predates the
dock becoming page chrome (#399, generated on plugin < 0.184) and whose
base template is `decision` / `free` legitimately has no dock yet: do not
fail it, re-sync it on its next append — § Common Structure's FAB + dock
markup, § Panel Chrome (all templates) CSS + JS and § collectDecisions
(dispatcher) as one unit (§ Engine drift on iteration append) — and only
then run P1–P13g against it. The same version path is what already keeps
the P3 / P5 legacy ids acceptable.

**Failure for 21 / 22:** if either pattern is missing, the page is rejected
at the post-generation gate. See § Generic Form Collection below for the
required pattern.

**Failure for 59 / 60 / 61:** re-sync § Section Navigation (CSS + JS) and
§ Iteration Tabs → Tab Bar CSS verbatim from templates.md. Check the
negatives too: any `.iteration-tab-summary`, `.iteration-archive` or
`.nav-group` literal in the page's MARKUP (not its JS) means a hand-built
tree that will be thrown away on load — remove it and let the JS derive it.

**Failure for 56 / 57 / 58:** these three are one anatomy — a page with the
old scrolling aside and the stacked buttons has the CTA below the fold on
every long concept. Re-sync § Common Structure (both skeletons), § Panel
Chrome (all templates), § Layout — Document rounds / the overlay panel rule,
§ Decision Panel State CSS "Panel
anatomy", § Two-Button Submit and § Claude Connection Heartbeat verbatim from
templates.md. A `checkClaudeConnection` that returns before writing
`data-state` is a hard fail even if every element is present: the line
would freeze on whatever it said at submit time.

**Failure for 31:** if the page renders bi-state cards without comment slots
AND `ensureCommentSlots` is missing, the user has nowhere to attach
free-form overrides to their include/discard choices. Fix the HTML (emit
the textarea inline per § Bi-State Variant Evaluation) and ship the JS
safety net (per § Comment Slot Injection) before opening.

**Failure for 41 / 42:** if a page contains ANY `.attach-bar` /
`.attach-thumbs` markup or ANY `textarea[data-comment]` that is clearly
meant to take a file (an annotation answer, a decision note, a dock field)
but lacks `data-attachable`, or if `initCommentAttachments` matches
`data-comment` instead of `data-attachable`, treat it as a missing
mandatory pattern — either fields double-wire a second bar, or a field the
user expects to attach a file to silently accepts none.

**Failure for 45:** a page missing the rule is not merely un-hardened — grep
its markup for `section[data-design]` and `section[data-screen]` and check
that every inactive one carries `hidden`. If any does not, the page is
already stacking sections on top of each other and must be regenerated, not
just patched with the rule.

**Failure for 43:** grep every `localStorage.setItem(` occurrence in the
rendered page; each one MUST read `_guardedSetItem(`, no exceptions. One
unguarded call site reintroduces the exact silent-persistence-death defect
this pattern exists to catch.

**Failure for 49–53 — hard fail, always.** These five are one contract: the
user's comments are never lost, in whatever state they are, against a power
cut, a wiped browser store, and a Claude that has stopped answering. Any one
of them missing can silently destroy hours of work. Do not "note it and
continue" — re-sync § State Persistence, § Layout JS and the submit handler
verbatim from templates.md, then re-check.

Grep for the negatives too, not just the positives: a page containing
`removeItem(STORAGE_KEY)`, a bare `state['text:' + _key]` with no namespace,
or `clearDock()` on the submit path is a page with the old defect in it,
however many of the positive patterns it also has.

**Failure for 44:** the rule is an ADJACENT sibling combinator, so its
presence is only half the check — every `.attach-slot` in the page must also
sit directly after the textarea it belongs to. Grep the mounts: any one
separated from its field by another element is hidden by nothing and puts a
duplicate bar back on screen.

The four-literal form of 44 is deliberate. The entry used to grep for
`textarea[hidden] + .attach-slot` alone, and a real page with 18 attachable
fields PASSED it while rendering 12 stacked 📎 bars for 3 visible textareas
(dock content 1062px inside a 430px box): it had the `.attach-slot` half of
the CSS but not the `.attach-bar` half, its `_mountAttachmentBar()` still did
`ta.parentElement.appendChild(bar)`, and its bars still carried
`.attach-hint`. One literal out of an engine with four moving parts is not a
check, it is a coincidence — a page can satisfy it and be maximally broken.
Grep for all four positives and both negatives, every time.

**Failure for 46 / 47:** both are hard fails, and they are one defect —
patch both rules together. 48 is a warning: note it, add the rule, but do
not block on it.

## Engine drift on iteration append

**This gate runs against the WHOLE existing file on every append, not only
on first generation.** A concept page carries its shared engine — the
Attachments JS + CSS, the § Layout CSS chrome rules, the tab-switch JS —
from the day it was generated, and an iteration append (SKILL.md Step 5c)
re-uses that engine forever. So a page generated before a templates.md fix
keeps the old defect through every later round.

Before appending, run the gate over the existing HTML. When any ENGINE entry
fails — 12c (deterministic template resolution), 30b (frozen bar + veil
relock), 30c (sent round survives a reload), 30d (an undelivered round is retried, not stranded), 60b (TOC overflow keeps the active entry), 44 (attachments), 44b (attachment locale), 46 / 47 (design-mode
chrome), 48 (scroll boxes), 49–53 (comment durability), 54 (reality-check
progress step), 56 (panel anatomy), 59 (Kompass tree), 62 (panel chrome), 63 (strip
`[hidden]` override), 64 / P33 (engine integrity — a rule or function cut out of the
engine block by a later edit), 65 (drained draft flush — a page whose autosave
still posts with `keepalive` stops mirroring after ~27 saves), P13e (dock ceiling below the ☰ FAB — a page
whose dock still caps at a bare `80vh` covers the menu FAB on every later
round), P13f / P13g (dock as page chrome + the unified `comments` shape —
a page that still hides the dock outside design rounds or ships a flat
`comments[]`), or
the tab-switch patterns — re-sync that whole
shared block **verbatim from templates.md** BEFORE the new section goes in.
Re-sync the block, not the one line the grep flagged: these blocks fail in
halves, and a page missing one literal is a page carrying a stale copy of
everything around it. Appending first and patching after leaves the freshly
appended iteration wired to the old engine.

**Pre-Kompass pages are converted wholesale on their next append — no
opt-out (#344).** A page generated before the pinned-foot panel and the
Kompass tree (0.149.0, entries 56 and 59–61) still carries the old scrolling
decision panel. Its next append fails those entries, and the answer is the
same as for every other engine entry: re-sync the **whole panel block** as one
unit — the panel skeleton (`.panel-here` / `.panel-nav-scroll` /
`.panel-status` / `.panel-cta`), § Layout (panel anatomy CSS), § Section
Navigation (`buildSectionNav` + `buildIterationTree` + tab-bar CSS) and
§ Two-Button Submit (split button + status line) — verbatim from templates.md,
before the new section goes in. The anatomy spans HTML skeleton, CSS and JS
across those sections and fails in halves; a page with the new JS on the old
skeleton has no `.panel-cta` to pin, and a page with the new skeleton on the
old JS never builds the tree. There is no "keep the old panel until this session closes" carve-out. The
re-sync never edits `section[data-iteration]`.

**Re-syncing must never touch `section[data-iteration]` attributes.** Entry 54
lives in the panel skeleton and the status-step JS, both of which the re-sync
replaces wholesale; `data-reality-check` lives on the iteration sections and
their chips, which it does not. Keep it that way — a re-sync that rewrote a
section's attributes would erase the marker that stops an already-answered
reality check from being asked again.

**49–53 come first, before any other repair, and before the append.** The
append is exactly the moment they fire. A page carrying the old § State Persistence
block loses those comments *during your append*, so re-syncing afterwards
recovers nothing. Re-sync § State Persistence, the § Panel Chrome dock block and
the submit handler as one unit — they share the namespace contract and a
half-updated page is worse than an untouched one.

## Generic Form Collection (mandatory for all templates)

**Problem:** When iterations are appended, custom `collectDecisions()` code
written for an earlier iteration silently misses new fields added in later
iterations. The user submits, sees the panel turn green, but Claude
receives incomplete data.

**Rule:** `collectDecisions()` MUST collect every form element inside the
active iteration via a generic selector — NOT via hand-listed selectors
per field. Specific selectors (for grouped sub-objects like `decisions[]`,
`comments` — `{ general, items }` in every branch) are allowed *in addition*
but must never replace the catch-all.

### Required pattern (free, decision, and design branches)

```javascript
function collectAllFormFields(scope) {
  const fields = {};
  // Catch-all: every named input, select, textarea inside scope
  scope.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.closest('[data-device-clone]')) return;      // device-frame copies of the mockup
    if (el.dataset.engineStore !== undefined) return;   // engine stores are typed by their own collector
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

function collectDecisions(action) {
  const active = document.querySelector('section[data-iteration][data-active]')
              || document.body;
  const allFields = collectAllFormFields(active);
  // Optional: also build typed sub-objects (decisions[], comments{}, …)
  // for ergonomics — but NEVER as a replacement for allFields.
  return { submitted: true, action, allFields, /* …typed objects… */ };
}
```

See `templates-submit.md` § collectDecisions (dispatcher) for the live reference
implementation that wires this into the per-template branches.

Additionally, every `section[data-iteration]` MUST carry
`data-iteration-template="decision"` (or `design`, or `free`; `prototype` is
accepted as a legacy alias for `design`), and `applyIterationTemplate()`
MUST mirror the active iteration's value onto `<html data-template="...">`
so `collectDecisions()` dispatches to the correct branch. **`<html
data-template>` not matching the active iteration's
`data-iteration-template` is an error** — it means the projection did not
run before first paint (see § Frozen/Active Mismatch below). The submit
payload MUST include an `action` field with value `"iterate"` or
`"implement"`.

> Phase 2 (template-specific patterns) and Failure handling continue in [validation-gate-phase2.md](validation-gate-phase2.md).
