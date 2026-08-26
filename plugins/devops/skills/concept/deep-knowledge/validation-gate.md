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

> **Deterministic backstop:** the `post.concept.gate` PostToolUse hook
> re-checks a critical subset of this gate (the live decision panel + bridge
> submit markers + the forbidden clipboard list below) on every write to a
> concept HTML and **blocks** if the page is invalid. The hook is the safety
> net for the "skill only half-used" regression — but it is not a license to
> skip this manual gate. Run the full sweep BEFORE opening the page.

## Phase 0 — Forbidden patterns (hard fail)

A concept page is driven **exclusively** by the live bridge: the decision
panel's submit buttons POST to the bridge server and Claude picks the
decisions up via heartbeat + cron. The page MUST therefore contain **none**
of the following manual-handoff anti-patterns. Any match = reject the page
and regenerate with the live submit, exactly like a missing required pattern.

| Forbidden grep (case-insensitive) | Why it's banned |
|---|---|
| `clipboard` (`navigator.clipboard`, "copy to clipboard") | A "copy the decisions JSON" button is the regression this gate exists to kill — the live bridge already delivers decisions. |
| `zwischenablage` | German variant of the same clipboard-copy fallback. |
| `in den chat ein` / "paste … into chat" | Instructing the user to paste anything into chat means the live submit was never wired. |

A valid live-bridge page never copies anything to the clipboard, so there are
no legitimate matches — do not "keep it as a convenience". The decision panel
+ live submit is the only sanctioned mechanism, and it may never be omitted.

## Phase 1 — Shared patterns (ALL templates)

Every concept page must contain these 47 patterns, regardless of template
(the numbering carries `b` suffixes where a pattern was added next to a
related one — count the rows, not the highest number):

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-status` | Inline connection status pill in #panel-ready (animated dot + label; state via `data-state`, driven by `checkClaudeConnection`). NOT an overlay, NO acknowledge button. |
| 3b | `_everPolled` | Pre-first-poll guard: the connection checker treats the window before the first `/heartbeat` response as "connecting", never "disconnected". Missing → the fresh-page connect→disconnect→connect flash returns. |
| 4 | `checkClaudeConnection` | Heartbeat checker function |
| 5 | `HEARTBEAT_STALE_MS` | Heartbeat staleness threshold |
| 6 | `SERVER_STALE_MS` | Bridge-process staleness threshold (distinguishes bootstrap from dead bridge) |
| 7 | `pollHeartbeat` | HTTP heartbeat polling function |
| 8 | `panel-ready` | Ready-state panel element |
| 9 | `panel-submitted` | Submitted-state panel element |
| 10 | `localStorage` | Reload resilience (state persistence with TTL) |
| 11 | `data-page-version` | Page version tag for localStorage invalidation |
| 12 | `data-iteration` | Iteration section marker |
| 12b | `data-iteration-template` on every `section[data-iteration]` | Authoritative per-iteration template. **Missing → warning, not a hard fail** — the legacy fallback (page-level `<html data-template>` written at generation time) still works for pages predating this attribute. New pages MUST carry it on every iteration section. |
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
| 23 | `status-steps` | Submit-panel progress list (Übermittelt → Verarbeitet → Implementiert) — see templates.md § Submit Progress Steps |
| 24 | `updateStatusSteps` | Wires `_picked_up_at` / `_phase` from `/decisions` polling into the progress list |
| 25 | `data.claude_ts` inside `pollHeartbeat` | The poller MUST read JSON and assign `claude_ts` (not `server_ts`, not the raw response object). HTTP-200 alone is not enough — the daemon self-pulse keeps `server_ts` fresh forever, so an HTTP-only check leaves the indicator green while Claude's cron is dead. |
| 26 | `_setCacheHints(` inside `checkClaudeConnection` | The checker MUST wire the per-button cache hint to the disconnected state, so a click made while Claude is offline reads as visibly queued (then auto-delivered by the Offline Submit Queue) rather than lost. Submit buttons stay enabled in every state — the queue, not a disabled button, is what prevents a black hole. |
| 27 | `Date.now() - _lastHeartbeatTs` (millis vs. millis) | Both sides of the staleness comparison MUST be in milliseconds since the Unix epoch. Server returns `claude_ts` in ms; browser uses `Date.now()`. Never divide either side by 1000 — a millis-vs-seconds mix-up produces a giant negative age that always evaluates as "fresh" and silently hides outages. |
| 28 | `panel-final-report` | Final-report panel element. Auto-shown by `showIteration()` when the active section carries `data-final-report`; replaces `panel-ready` (no iterate/implement buttons). |
| 28b | `panel-frozen` | Frozen panel state, shown on every non-live iteration tab. `showIteration()` switches to it unconditionally, so a page without it loses the panel's whole lower half whenever the user reviews an earlier round — no controls, no explanation, and no way back to the live tab except guessing which chip it is. Must include the `#back-to-live-btn`. |
| 29 | `refreshFinalizeWizard({ reset: true })` — grep the CALL, not the symbol | Recomputes the close-out wizard's step list (the issues step exists only while the active section has un-routed `[data-open-questions]` checkboxes) and re-renders. The call must appear inside `showIteration()` so a tab switch restarts the flow at step 1. A page that defines the function but never calls it passes a symbol-only grep and renders a wizard that never updates. |
| 30 | `content-dimmer` | Shared post-submit focus overlay. After a submit, `body.content-dimmed` flips it on; the decision panel + FABs sit at higher z-index and paint above it. Click-to-dismiss; auto-clears on page reload. See `templates.md` § Common Structure (HTML) and § Decision Panel State CSS for the reference implementation. |
| 31 | `ensureCommentSlots` | Auto-injects an adjacent `<textarea data-comment="$decisionId-note">` for every `[data-decision]` bi-state group that lacks one. MUST be called from `DOMContentLoaded` BEFORE `restoreState` so the restore step rehydrates the typed values onto real nodes. See templates.md § Comment Slot Injection. |
| 32 | `panel-dispose-concept` | Disposition fieldset — the wizard's `files` step. Carries the discard / keep / gitignore radio group + optional `moveTo` input. See templates.md § Disposition Control. |
| 33 | `renderWizard` | Renders exactly one wizard step, the `Schritt n/m` counter, and the back/next/execute button set. Missing → every step renders at once and the flow is back to the wall of buttons the wizard replaced. |
| 34 | `collectIssueItems` | Reads the selected `[data-open-questions]` checkboxes into the `items[]` shape carried by `finalize.issues`. Without it the wizard ships an empty issue list and silently drops the user's follow-ups. |
| 35 | `collectDisposition` | Reads the disposition fieldset (`dispose-mode` radio + optional `dispose-move-to` input) into the `{ mode, moveTo }` shape the `finalize` payload requires. Without this, submit throws. |
| 36 | `status-channel` | Persistent status channel on the final-report panel — the always-visible pipeline recap (Übermittelt → verarbeitet → implementiert → Bereit) that hands over to the wizard. DOM-driven so it survives reload + stale heartbeat. See templates.md § Final Report Panel. |
| 37 | `finalize-wizard` | The close-out wizard container, carrying the `data-plan-*` / `data-word-step` localised strings the review screen renders from. Its absence means the final report has no way to close out at all. |
| 38 | `addEventListener('click', submitFinalize)` — grep the WIRING, not the symbol | The handler behind `#wizard-execute`. POSTs the single `action: "finalize"` payload (`issues` + `ship` + `disposition` + `submission_id`) and requires the bridge's durable ack. A defined-but-unwired handler leaves the execute button visible and completely inert — no console error, no network request — which is exactly the silent class this gate exists for. |
| 38b | `submission_id` inside `submitFinalize` | Client-side replay guard. `POST /decisions` has no version guard, so a payload the bridge fsynced before the response was lost sits in the offline queue too; without the id, `retryPendingSubmission()` re-delivers it and the close-out creates its issues and runs its release a second time. |
| 39 | `installScrollSpy` called from **inside** `buildSectionNav` | Scroll-position marker for the panel TOC. `buildSectionNav()` replaces the nav DOM on every iteration switch, so the spy MUST be rebound as its last step. Binding it once from `DOMContentLoaded` instead leaves the highlight dead on every tab except the initially loaded one. See templates.md § Section Navigation. |
| 40 | `revealNavItem` | Auto-scrolls the TOC's own scroll box so the active entry stays visible in long lists. Must scroll only `nearestScrollBox(item.parentElement)` — never `scrollIntoView()` on the item, which drags the content column along and fights the user's scrolling. |
| 41 | `data-attachable` | The ONE marker `initCommentAttachments()` matches to decide which fields get an attachment bar. MUST NOT be `data-comment` — several fields carry `data-comment` without being attachable (plain text-only comments), and several carry both (annotation answers, decision notes); matching on `data-comment` wires a bar onto every one of those a second time or onto fields that were never meant to take a file. See templates.md § Attachments. |
| 42 | `initCommentAttachments` | Wires the 📎 button, drag & drop, and Ctrl/Cmd+V paste onto every `textarea[data-attachable]`. Missing → attachment bars render (if emitted inline) but do nothing. |
| 43 | `_guardedSetItem` | Every `localStorage.setItem` call site (state persistence + both `-pending` submit-queue writes) MUST go through this wrapper, never a bare `localStorage.setItem`. A `QuotaExceededError` thrown out of an unguarded call kills ALL further persistence for the rest of the page with nothing telling the user — see templates.md § State Persistence. |

**Failure for 21 / 22:** if either pattern is missing, the page is rejected
at the post-generation gate. See § Generic Form Collection below for the
required pattern.

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

**Failure for 43:** grep every `localStorage.setItem(` occurrence in the
rendered page; each one MUST read `_guardedSetItem(`, no exceptions. One
unguarded call site reintroduces the exact silent-persistence-death defect
this pattern exists to catch.

## Generic Form Collection (mandatory for all templates)

**Problem:** When iterations are appended, custom `collectDecisions()` code
written for an earlier iteration silently misses new fields added in later
iterations. The user submits, sees the panel turn green, but Claude
receives incomplete data.

**Rule:** `collectDecisions()` MUST collect every form element inside the
active iteration via a generic selector — NOT via hand-listed selectors
per field. Specific selectors (for grouped sub-objects like `decisions[]`,
`comments[]`) are allowed *in addition* but must never replace the
catch-all.

### Required pattern (free, decision, and design branches)

```javascript
function collectAllFormFields(scope) {
  const fields = {};
  // Catch-all: every named input, select, textarea inside scope
  scope.querySelectorAll('input, select, textarea').forEach(el => {
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
  // Optional: also build typed sub-objects (decisions[], comments[], …)
  // for ergonomics — but NEVER as a replacement for allFields.
  return { submitted: true, action, allFields, /* …typed objects… */ };
}
```

See `templates.md` § collectDecisions (dispatcher) for the live reference
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

## Phase 2 — Template-specific patterns

Run the subset matching the template picked per-iteration in Step 1a of
`SKILL.md`, using each iteration's own `data-iteration-template`.

### Template: decision

| # | Pattern | Purpose |
|---|---------|---------|
| D1 | `eval-group` OR `tri-state-group` | Bi-state evaluation container (tri-state-* is legacy alias) |
| D2 | `eval-` (as input name prefix) | Bi-state radio name convention (`eval-{variant-id}`) |
| D3 | `data-decision` | Variant card marker for `collectDecisionDecisions()` |
| D4 | `value="include"` | One of exactly two allowed radio values |
| D5 | `value="discard"` | The other allowed value |

The selector MUST have exactly two radio inputs per variant (no `value="only"`).
If the page contains no variants (unusual for the decision template), D1–D5
may be skipped — but in that case the content likely belongs in the `free`
template instead. Reconsider the template pick before suppressing these.

### Template: design (legacy alias: prototype)

| # | Pattern | Purpose |
|---|---------|---------|
| P1 | `feedback-dock` | Speech-bubble dock anchored to the 💬 FAB (bottom-right) |
| P2 | `feedback-toggle` | FAB that opens the dock |
| P3 | `screen-textareas` OR `feedback-screen-list` | Auto-populated per-page comment container (legacy pages use `feedback-screen-list`) |
| P4 | `data-screen` | Marker on screen sections that feed the dock |
| P5 | `design-general-feedback` OR `proto-general-feedback` | General-notes textarea (legacy pages use the `proto-` name) |
| P6 | `panel-fab` | FAB that opens the decision overlay |
| P7 | `panel-backdrop` | Overlay backdrop element |
| P8 | `collectDesignDecisions` OR `collectPrototypeDecisions` | Design branch of `collectDecisions` (legacy pages may still name it `collectPrototypeDecisions`) |
| P9 | `data-design` | Design wrapper marker — required even for a single design (uniform markup shape) |
| P10 | `data-design-comment` | Design-level feedback textarea — required only when the iteration has ≥2 `data-design` wrappers |
| P11 | `data-open="false"` on `#feedback-dock` | The dock MUST start collapsed. A page that ships `data-open="true"` opens onto three empty textareas covering the artefact. |
| P12 | `applyDockSize` | Picks the dock's size from `body[data-single-*]`. Missing → the dock falls back to whatever width the page's CSS happens to declare, which is how the same concept renders as a mini-box in one iteration and a full-width bar in the next. |
| P13 | `.panel-fab,` + `.feedback-fab` sharing ONE size/shape rule | Both FABs are one component with two positions. A page that declares separate `width`/`height`/`border-radius` per FAB has the 56-vs-64px mismatch back. |
| P13b | `feedback-maximize` | Dock maximise/restore control — a DISTINCT button from `feedback-close` (minimise closes, this only resizes). Mandatory on every `design` page: the dock has no other way to grow past its automatic compact/wide size. |
| P13c | `data-user-maximized` on `#feedback-dock` | The persisted maximise override. Deliberately a SEPARATE attribute from `data-size` (which `applyDockSize()` still only ever sets to `compact`/`wide` — exactly two automatic sizes, unchanged): the maximised CSS rule (`.feedback-dock[data-user-maximized="true"]`) composes on top of whichever of the two is current. Missing → the maximise button toggles the DOM but nothing resizes, or a reload silently drops the user's choice. |

Both dock textareas (P5 general field, `design-textareas`/`screen-textareas`/`view-textareas`) and every attachable field inside them MUST carry `data-attachable` per pattern 41 — the dock is the field most likely to be missed since it is rebuilt by `buildDesignUI()` rather than authored once inline.

**Why P3/P5 carry alternates:** the dock was rebuilt for the design layer and
its ids changed (`feedback-screen-list` → `screen-textareas`,
`proto-general-feedback` → `design-general-feedback`). A gate pinned to the old
ids alone hard-fails every freshly generated page, and the likely "repair" is
Claude inventing two dead elements to satisfy the checker. Accept both, prefer
the new ones.

At least one `<section data-screen id="…" data-nav-label="…">` MUST exist
inside the active design. A design iteration with zero screens can't collect
per-screen feedback. With ≥2 `data-design` wrappers, exactly one MUST carry
`data-design-active="true"` and the rest `hidden`.

**Annotation layer (conditional — only when the page contains
`[data-anno-layer]`):** the layer is optional (§ Annotation Layer
(optional), templates.md); a design page with none of these patterns is not
a failure. Once a page contains `data-anno-layer` anywhere, run this subset:

| # | Pattern | Purpose |
|---|---------|---------|
| P14 | `anno-toggle` | The eye pill that toggles the whole layer — must exist once the page has any `[data-anno-layer]`, and must NOT be inside `html:not([data-template="design"])`-hidden chrome. |
| P15 | `anno-hidden` | Body class the eye pill toggles; drives the `body.anno-hidden .anno-layer { display: none }` pixel-clean hide. |
| P16 | `data-anno-pin` | Pin marker inside each `.anno` wrapper. |
| P17 | `data-anno-bubble` | Bubble marker, `id` MUST match the pin's `aria-controls`. |
| P18 | `data-annotation` on a `textarea` | The answer field the payload scan (`collectDesignDecisions`) reads. |
| P19 | `data-comment="anno-` (prefix) on that same textarea | Required for `saveState()`/`restoreState()` to persist the answer — a `data-annotation` textarea without a matching `data-comment` loses its answer on reload. |
| P20 | `data-attach-slot="anno-` (prefix) | Dedicated attachment mount next to the answer textarea. `initCommentAttachments()` (pattern 42) places the bar inside this mount rather than appending after the textarea — see templates.md § Attachments. |
| P21 | `wireAnnotationLayer` | The JS that wires pins, bubbles, the eye pill and the counter. Missing → every pin renders inert. |
| P21b | **every `data-anno` value is unique page-wide** | **Structural assertion, not a grep for a token:** collect all `data-anno="..."` values and fail on any duplicate. Two annotations sharing an id share ONE `text:anno-{id}` storage slot — the last one saved wins, the other answer is lost on reload, and both pins come back showing the same text. Their `annotations[]` payload entries collide too. Prefix ids with the screen id (`d1-s2-a1`) so uniqueness is structural. Caught in a browser on a page that numbered them `a1` per screen. |

**Failure for P14–P21:** if `[data-anno-layer]` is present anywhere on the
page but any of these is missing, treat it the same as a missing mandatory
pattern for that iteration — a half-wired annotation layer (pins that don't
open, or open onto a bubble that never persists) is worse than no layer at
all. A page with **zero** `[data-anno-layer]` occurrences skips P14–P21
entirely; it is not a design without opinions, it is a design with no
element-level questions to ask.

**Views (conditional — only when the page contains `data-view=`):** views
are optional (§ Views (optional), templates.md); a design page with none of
these patterns is not a failure. Once a page contains `data-view` anywhere,
run this subset:

| # | Pattern | Purpose |
|---|---------|---------|
| P22 | `section[data-design]` — at least one, count ≥1 | **Structural assertion, always run once `data-view=` is present:** a design iteration with views MUST still carry ≥1 `data-design`. Views never stand alone — a page with `data-view` and zero `data-design` picked the wrong template; it belongs in `decision`. |
| P23 | `data-view-kind="decision"` OR `data-view-kind="comparison"` | Every `[data-view]` MUST declare its kind — an unrecognised or missing kind means the page invented a third shape with no reference implementation. |
| P24 | `view-switch-item` | View segments in the top-centre switcher — required once any view exists, so switching to it is reachable without opening the ☰ panel. |
| P25 | `screen-nav-view-item` | View entries in the panel's second `#screen-nav` group. |
| P26 | `showView` | The JS that switches the active top-level item to a view — missing means the switcher/nav segments render but do nothing. |
| P27 | `data-decision` inside every `[data-view-kind="decision"]` — at least one, count ≥2 | A decision-kind view with fewer than two alternatives is not a decision; reconsider whether it belongs in the artefact's mockup notes instead. |
| P28 | `data-compare-option` inside every `[data-view-kind="comparison"]` — count ≥2 | A comparison-kind view MUST have ≥2 `article[data-compare-option]` — see § Views (optional) → View kind `comparison`. |
| P29 | `data-decision` inside every `[data-compare-option]`'s owning `[data-view-kind="comparison"]` — one per option | Each comparison option's verdict reuses the bi-state `[data-decision]` markup, not a bespoke control. |
| P30 | `view-textareas` | Dock mount for the per-view feedback textarea (general + per-view shown while a view is active, § Layout — Fullscreen…). |
| P30b | `_activeView` inside the `DOMContentLoaded` restore block | Reload persistence for the active view (Work package C) — without it, a reload always drops back to design mode even if the user was reading a question view when they left. Must be tried BEFORE the pre-existing `_activeScreen` restore, with a defensive fallback to it when the stored view id no longer resolves. |

**Failure for P22–P30:** if `data-view` is present anywhere on the page but
any of these is missing (scoped to the view kind that requires it — P27 only
applies to `decision`-kind views, P28/P29 only to `comparison`-kind views),
treat it the same as a missing mandatory pattern for that iteration. P22 is
the hardest failure of the set: it means the page should not have used the
`design` template at all.

### Frozen/Active Mismatch

For every `section[data-iteration]`: if it carries `data-active`, its
`data-iteration-template` MUST equal `<html data-template>` at validation
time (simulate a tab switch to it, or check the generation-time initial
state if it is the only active one). A mismatch is a **hard-fail error** —
it means either `applyIterationTemplate()` was not wired into
`showIteration()`, or the initial `<html data-template>` written at
generation time does not match the active iteration, which produces a
flash-of-wrong-layout on load.

### Template: free

| # | Pattern | Purpose |
|---|---------|---------|
| F1 | `collectFreeDecisions` | Free branch of `collectDecisions` |

The free template has no mandatory body structure. Tri-state (`tri-state-group`,
`eval-` radio names) is opt-in — include it only where a section needs
user evaluation. The decision panel (sticky sidebar) is reused from the
decision template with no changes.

## Failure handling

**If ANY forbidden pattern (Phase 0) is present, OR any shared pattern is
missing, OR any template-specific mandatory pattern is missing → DO NOT open
the page.** Fix the HTML first, then re-validate. This is a **blocking gate**
— no exceptions, no "this page doesn't need it". The `post.concept.gate` hook
enforces the same on write.

**Common failures this gate catches:**
- Clipboard / paste-into-chat submit baked in instead of the live bridge →
  the user is told to copy a JSON by hand, defeating the whole monitoring loop
- Decision panel omitted entirely → no submit buttons, nothing to monitor
- Heartbeat system omitted → submit button stays clickable without monitoring
- Connection status pill missing → user gets no feedback on connecting / connected / disconnected state
- Panel states missing → no visual transition on submit/reset cycle
- localStorage missing → user selections lost on reload or tab close
- `data-template` missing → `collectDecisions` can't pick the right branch
- `data-iteration-template` missing on a section → warning; legacy fallback
  used, but new pages should always carry it
- `<html data-template>` mismatched with the active section's
  `data-iteration-template` → error; `applyIterationTemplate()` not wired or
  fired too late, causing a flash of the wrong layout
- Design iteration without `data-screen` → feedback dock renders empty
- Heartbeat poller does an HTTP-only check (no `await r.json()` + `claude_ts` assignment) → indicator stays green forever because the server self-pulse always returns 200, even when Claude's cron is dead
- Disconnected classified before the first `/heartbeat` response (no `_everPolled` guard) → a fresh page flashes connecting→disconnected→connected; with the old overlay it also forced two "Got it" clicks
- Cache hint not wired to the disconnected state (`_setCacheHints` missing from `checkClaudeConnection`) → a click made while Claude is offline looks lost instead of visibly queued (the Offline Submit Queue still delivers it on reconnect, but the user gets no signal)
- Staleness math mixes seconds and milliseconds (`Date.now() / 1000`, or `_lastHeartbeatTs * 1000`) → comparison flips negative, page renders "Claude verbunden" even when the heartbeat is hours old
- `submitFinalize` / `collectDisposition` / `collectIssueItems` missing → the final-report panel renders correctly but "Alles ausführen" does nothing on click (silent failure — no console error, no network request), or ships a payload with the user's issue selection silently emptied
- `renderWizard` missing or never called → all wizard steps render at once, which is exactly the undifferentiated button wall the wizard replaced
- `data-anno-layer` present but `anno-toggle` / `wireAnnotationLayer` missing → pins render but never open, or open onto a bubble whose answer is never persisted

The patterns in `templates.md` (§ Claude Connection Heartbeat, § Submit
Handler, § State Persistence, § Template: design, § Template: free)
provide the reference implementations.
