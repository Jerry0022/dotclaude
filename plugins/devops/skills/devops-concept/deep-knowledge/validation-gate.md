# Post-Generation Validation Gate

After writing the HTML file, validate that all mandatory interactive patterns
are present. **Grep the generated file** for each required pattern. The check
runs in two phases: first the shared patterns (all templates), then the
template-specific extras selected by `<html data-template="...">`.

## Phase 1 — Shared patterns (ALL templates)

Every concept page must contain these 20 patterns, regardless of template:

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-warning` | Disconnection warning element (overlay on #panel-ready) |
| 3b | `connection-connecting` | Grace-period "Claude is connecting" overlay (shown by default) |
| 4 | `checkClaudeConnection` | Heartbeat checker function |
| 5 | `HEARTBEAT_STALE_MS` | Heartbeat staleness threshold |
| 6 | `HEARTBEAT_GRACE_MS` | Grace period — suppresses warning during startup |
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

**If ANY shared pattern is missing, or any template-specific mandatory pattern
is missing → DO NOT open the page.** Fix the HTML first, then re-validate.
This is a **blocking gate** — no exceptions, no "this page doesn't need it".

**Common failures this gate catches:**
- Heartbeat system omitted → submit button stays clickable without monitoring
- Connection warning missing → user gets no feedback when Claude disconnects
- Panel states missing → no visual transition on submit/reset cycle
- localStorage missing → user selections lost on reload or tab close
- `data-template` missing → `collectDecisions` can't pick the right branch
- Prototype without `data-screen` → feedback dock renders empty

The patterns in `templates.md` (§ Claude Connection Heartbeat, § Submit
Handler, § State Persistence, § Template: prototype, § Template: free)
provide the reference implementations.
