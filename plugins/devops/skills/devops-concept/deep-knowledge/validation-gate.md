# Post-Generation Validation Gate

After writing the HTML file, validate that all mandatory interactive patterns
are present. **Grep the generated file** for each required pattern:

| # | Pattern to grep | Purpose |
|---|----------------|---------|
| 1 | `concept-decisions` | Decision data JSON container |
| 2 | `concept-submitted` | CSS class for monitoring detection signal |
| 3 | `connection-warning` | Disconnection warning element |
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
| 15 | `sec.hidden` | Tab-switch JS toggles the `hidden` attribute — prevents all iterations rendering at once |
| 16 | `pollProcessedState` | Auto-reset poll handler — restores the ready panel when the server's `_processed_at` advances past the local `_submittedAt` |
| 17 | `section-nav` | Generalised panel TOC — every `data-nav-label` section (variants AND plain sections) gets a scroll anchor |
| 18 | `data-nav-label` | Marker on nav-eligible sections — required so `buildSectionNav()` can populate the TOC |

**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. This is a **blocking gate** — no exceptions, no "this
page doesn't need it". Every concept page needs monitoring, every monitored
page needs the heartbeat guard.

**Common failures this gate catches:**
- Heartbeat system omitted → submit button stays clickable without monitoring
- Connection warning missing → user gets no feedback when Claude disconnects
- Panel states missing → no visual transition on submit/reset cycle
- localStorage missing → user selections lost on reload or tab close

The patterns in `templates.md` (§ Claude Connection Heartbeat,
§ Submit Handler, § State Persistence) provide the reference implementations.
