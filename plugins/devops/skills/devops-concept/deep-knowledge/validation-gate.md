# Post-Generation Validation Gate

After writing the HTML file, validate that all mandatory interactive patterns
are present. **Grep the generated file** for each required pattern. The check
runs in three phases: first the forbidden patterns (hard fail), then the
shared patterns (all templates), then the template-specific extras selected
by `<html data-template="...">`.

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

Every concept page must contain these 38 patterns, regardless of template:

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-warning` | Disconnection warning element (overlay on #panel-ready) |
| 3b | `connection-connecting` | Bootstrap "Claude is connecting" overlay (shown by default; stays until first heartbeat) |
| 4 | `checkClaudeConnection` | Heartbeat checker function |
| 5 | `HEARTBEAT_STALE_MS` | Heartbeat staleness threshold |
| 6 | `SERVER_STALE_MS` | Bridge-process staleness threshold (distinguishes bootstrap from dead bridge) |
| 7 | `pollHeartbeat` | HTTP heartbeat polling function |
| 8 | `panel-ready` | Ready-state panel element |
| 9 | `panel-submitted` | Submitted-state panel element |
| 10 | `localStorage` | Reload resilience (state persistence with TTL) |
| 11 | `data-page-version` | Page version tag for localStorage invalidation |
| 12 | `data-iteration` | Iteration section marker |
| 13 | `iteration-tabs` | Tab bar container in the decision panel |
| 14 | `pollReload` | Reload-signal poller (picks up file rewrites) |
| 15 | `sec.hidden` | Tab-switch JS toggles the `hidden` attribute |
| 16 | `pollProcessedState` | Auto-reset poll handler |
| 17 | `section-nav` OR `screen-nav` | Panel navigation (TOC for decision/free, screen list for prototype) |
| 18 | `data-nav-label` | Marker on nav-eligible sections |
| 19 | `submit-iterate-btn` | Primary submit: iterate action (no code changes) |
| 20 | `submit-implement-btn` | Secondary submit: implement action (real changes) |
| 21 | `querySelectorAll('input, select, textarea')` inside `collectDecisions` | Generic form catch-all (no hand-listed selectors per field) |
| 22 | `data-active]` selector inside `collectDecisions` | Catch-all is scoped to the active iteration only |
| 23 | `status-steps` | Submit-panel progress list (Übermittelt → Verarbeitet → Implementiert) — see templates.md § Submit Progress Steps |
| 24 | `updateStatusSteps` | Wires `_picked_up_at` / `_phase` from `/decisions` polling into the progress list |
| 25 | `data.claude_ts` inside `pollHeartbeat` | The poller MUST read JSON and assign `claude_ts` (not `server_ts`, not the raw response object). HTTP-200 alone is not enough — the daemon self-pulse keeps `server_ts` fresh forever, so an HTTP-only check leaves the indicator green while Claude's cron is dead. |
| 26 | `b.disabled = ` (or `btn.disabled = `) inside `checkClaudeConnection` | The heartbeat checker MUST actually toggle the submit buttons' `disabled` property — a visual-only warning lets the user keep submitting into a black hole during a stale heartbeat. |
| 27 | `Date.now() - _lastHeartbeatTs` (millis vs. millis) | Both sides of the staleness comparison MUST be in milliseconds since the Unix epoch. Server returns `claude_ts` in ms; browser uses `Date.now()`. Never divide either side by 1000 — a millis-vs-seconds mix-up produces a giant negative age that always evaluates as "fresh" and silently hides outages. |
| 28 | `panel-final-report` | Final-report panel element. Auto-shown by `showIteration()` when the active section carries `data-final-report`; replaces `panel-ready` (no iterate/implement buttons). |
| 29 | `updateCreateIssuesPanel` | Gating function that toggles the "Issues erstellen" button visibility + enabled state based on the active section's `[data-open-questions]` content. Must be called from `showIteration()` so panel state stays consistent on tab switch. |
| 30 | `content-dimmer` | Shared post-submit focus overlay. After a submit, `body.content-dimmed` flips it on; the decision panel + FABs sit at higher z-index and paint above it. Click-to-dismiss; auto-clears on page reload. See `templates.md` § Common Structure (HTML) and § Decision Panel State CSS for the reference implementation. |
| 31 | `ensureCommentSlots` | Auto-injects an adjacent `<textarea data-comment="$decisionId-note">` for every `[data-decision]` bi-state group that lacks one. MUST be called from `DOMContentLoaded` BEFORE `restoreState` so the restore step rehydrates the typed values onto real nodes. See templates.md § Comment Slot Injection. |
| 32 | `panel-dispose-concept` | Disposition fieldset on the final-report panel. Always visible while `panel-final-report` is active; carries the discard / keep / gitignore radio group + optional `moveTo` input. See templates.md § Disposition Control. |
| 33 | `submitDisposeConcept` | JS handler wired to `#dispose-concept-btn`. POSTs `action: "dispose-concept"` with the current disposition payload so Step 6a can run the cleanup branch. |
| 34 | `submitCreateIssues` | JS handler wired to `#create-issues-btn`. POSTs `action: "create-issues"` with the selected open-question items plus the current disposition payload. Dropping this leaves the button visible but inert — no console error, no network request on click. |
| 35 | `collectDisposition` | Reads the disposition fieldset (`dispose-mode` radio + optional `dispose-move-to` input) into the `{ mode, moveTo }` shape required by `submitCreateIssues`, `submitShip`, and `submitDisposeConcept` payloads. Without this, those buttons throw at submit time. |
| 36 | `status-channel` | Persistent status channel on the final-report panel — the always-visible pipeline recap (Übermittelt → verarbeitet → implementiert → Bereit) that leads to the ship CTA. DOM-driven so it survives reload + stale heartbeat. See templates.md § Final Report Panel. |
| 37 | `ship-btn` | The persistent channel's primary "🚀 Shippen" CTA. Fires `action: "ship"` (real release pipeline). |
| 38 | `submitShip` | JS handler wired to `#ship-btn`. POSTs `action: "ship"` with the current disposition. Dropping it leaves the ship button visible but inert (no console error, no network request on click). |

**Failure for 21 / 22:** if either pattern is missing, the page is rejected
at the post-generation gate. See § Generic Form Collection below for the
required pattern.

**Failure for 31:** if the page renders bi-state cards without comment slots
AND `ensureCommentSlots` is missing, the user has nowhere to attach
free-form overrides to their include/discard choices. Fix the HTML (emit
the textarea inline per § Bi-State Variant Evaluation) and ship the JS
safety net (per § Comment Slot Injection) before opening.

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

### Required pattern (free, decision, and prototype branches)

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

Additionally, the `<html>` element MUST carry `data-template="decision"` (or
`prototype`, or `free`) so `collectDecisions()` dispatches to the correct
branch. The submit payload MUST include an `action` field with value
`"iterate"` or `"implement"`.

## Phase 2 — Template-specific patterns

Run the subset matching the template picked in Step 1a of `SKILL.md`.

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

### Template: prototype

| # | Pattern | Purpose |
|---|---------|---------|
| P1 | `feedback-dock` | Collapsible bottom dock container |
| P2 | `feedback-toggle` | FAB that opens the dock |
| P3 | `feedback-screen-list` | Auto-populated per-screen comment list |
| P4 | `data-screen` | Marker on screen sections that feed the dock |
| P5 | `proto-general-feedback` | General-notes textarea |
| P6 | `panel-fab` | FAB that opens the decision overlay |
| P7 | `panel-backdrop` | Overlay backdrop element |
| P8 | `collectPrototypeDecisions` | Prototype branch of `collectDecisions` |

At least one `<section data-screen id="…" data-nav-label="…">` MUST exist
inside the active iteration. A prototype with zero screens can't collect
per-screen feedback.

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
- Connection warning missing → user gets no feedback when Claude disconnects
- Panel states missing → no visual transition on submit/reset cycle
- localStorage missing → user selections lost on reload or tab close
- `data-template` missing → `collectDecisions` can't pick the right branch
- Prototype without `data-screen` → feedback dock renders empty
- Heartbeat poller does an HTTP-only check (no `await r.json()` + `claude_ts` assignment) → indicator stays green forever because the server self-pulse always returns 200, even when Claude's cron is dead
- Heartbeat checker only toggles a CSS class, never sets `disabled` on the submit buttons → user can keep clicking submit during a stale heartbeat, every click rots in the bridge unnoticed
- Staleness math mixes seconds and milliseconds (`Date.now() / 1000`, or `_lastHeartbeatTs * 1000`) → comparison flips negative, page renders "Claude verbunden" even when the heartbeat is hours old
- `submitCreateIssues` / `collectDisposition` missing → final-report panel renders correctly but the "Issues erstellen" button does nothing on click (silent failure — no console error, no network request); same silent failure for "Concept beenden" if `collectDisposition` is missing from `submitDisposeConcept`

The patterns in `templates.md` (§ Claude Connection Heartbeat, § Submit
Handler, § State Persistence, § Template: prototype, § Template: free)
provide the reference implementations.
