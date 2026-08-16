# Concept Browser Monitoring

How Claude monitors the concept page for user decisions, processes them
**live**, and updates the page for further interaction.

## Monitoring Architecture

```
[Claude generates HTML] → [Bridge Server serves page] → [User interacts]
                                                               ↓
                         ┌─── HTTP ───┐                [User clicks Submit]
                         │             │                       ↓
Claude ──POST /heartbeat─→ Bridge     ←─POST /decisions── Page JS
Claude ──GET /decisions──→ Server     ←─GET /heartbeat─── Page JS
                         │             │
                         └─────────────┘

[Claude reads decisions via HTTP] → [Process] → [Update page via browser tool]
```

The **concept bridge server** (`scripts/concept-server.py`) acts as the
communication hub. Both Claude and the page talk to the server via HTTP —
no browser tool injection needed for heartbeat or decision exchange.

This is an **iterative loop**, not a one-shot. After each submission,
Claude processes the feedback, updates the page, and monitors again.
The loop continues until the user is done (closes page or says "fertig").

## Detection Signal

### Primary: HTTP Bridge (preferred)

The pickup waker polls the bridge server for the deterministic pending flag
(the backup cron does the same, once a minute):

```bash
curl -s http://localhost:$PORT/pending
# → {"pending": true|false, "version": N}
```

`/pending` is a strict, machine-readable one-shot signal — use it instead
of substring-matching `/decisions`. The `/decisions` JSON response is
formatted via `json.dumps` which emits `"submitted": true` **with** a space
after the colon, so a literal `contains "submitted":true` check silently
misses every real submission. Both the waker and the backup cron (bridge-server.md § step 3) pipe
`/pending` through `python -c` and only fall back to `/decisions` once
pending is true, eliminating that class of bug.

Once pending is true, Claude fetches the full payload:

```bash
curl -s http://localhost:$PORT/decisions
```

The response contains the user's decisions plus two metadata fields:
- `_version` — monotonic counter. Pass back to POST /reset for
  optimistic-concurrency checking.
- `_processed_at` — ISO-8601 UTC timestamp of the last successful /reset.
  The **browser** uses this to self-restore the panel; Claude can ignore it.

### Fallback: JS eval (when bridge server unavailable)

If the bridge server is not running (legacy concept pages, direct file open),
fall back to the JS eval approach:

```javascript
document.body.classList.contains('concept-submitted')  // → true when submitted
```

Decision data lives in a hidden JSON block:

```javascript
JSON.parse(document.getElementById('concept-decisions').textContent)
```

## Tool Selection

**For heartbeat and decision reading:** Use HTTP (`curl` via Bash). No browser
tool needed — this works entirely via the bridge server.

**For page updates (Step 5c):** Use Playwright or Preview eval tools for
JS-based page updates. Page updates are optional enhancements — if no eval
tool works, inform the user via chat instead.

## Why HTTP Server is Required

Concept pages must be served via the bridge server (`http://localhost:<port>/`)
rather than opened as `file://` URLs. The bridge server provides heartbeat and
decision endpoints that the page relies on for Claude connectivity.

## Pre-Monitoring Setup

### 1. Verify bridge server is running

The bridge server should already be started in SKILL.md Step 3. Verify:

```bash
curl -s http://localhost:$PORT/heartbeat
```

If this returns `{"ts": ...}` → bridge is running. If it fails → the server
didn't start; debug before proceeding.

### 2. Arm the cron and the two background tasks

**Single source of truth: `bridge-server.md` § step 3.** Do not redefine any of
them here. That section carries the combined heartbeat **+ auto-poll** cron
body, and the two detached background tasks — the keepalive pulser and the
pickup waker — that do the actual work.

A heartbeat-only cron is NOT enough and is actively misleading: it advances
`_claude_ts`, which is the only thing the page's connection indicator gates on,
so the indicator turns green while nothing is watching for submissions. That
combination is precisely how a submitted decision goes unnoticed.

Send the first heartbeat immediately and verify it round-trips:

```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```

Store the cron job ID as `$HEARTBEAT_CRON_ID` for cleanup.

### HTTP Bridge Monitoring

**Heartbeat** (keeps the connection indicator green on the page):
```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```
Sent by the keepalive pulser every ~20s — the cron every ~60s is only a
backup, and fires solely while the REPL is idle.

The bridge server self-pulses `_server_ts` (NOT the heartbeat) every 30s
from a daemon thread. That proves the *server process* is alive — it does
**not** keep the indicator green, because the connection indicator gates
exclusively on `claude_ts`, which ONLY a Claude-side `POST /heartbeat`
advances. This split is deliberate: a server-only pulse used to render as
"Claude verbunden" and hid the case where Claude's polling cron had died.

Consequently the green indicator requires something Claude-side to POST
`/heartbeat` at least every `HEARTBEAT_STALE_MS` (90s). The cron alone is
NOT enough (idle-only, multi-minute gaps), so the **keepalive pulser**
background task (see `bridge-server.md` § step 3, task 1) is the primary
keepalive — it pulses every ~20s for the whole session and, crucially, does
NOT exit when a submission is pending, so `claude_ts` stays warm even during
a long `implement`.

**Check submission** — poll `/pending`, never `/decisions`:
```bash
curl -s http://localhost:$PORT/pending
```
Returns a strict `{"pending": true|false, "version": N}`.
- `true` → fetch the full payload from `GET /decisions` and process it
- `false` → not yet submitted, keep watching

`/pending` is the **only** endpoint that acks a pickup — it stamps
`_picked_up_at`, which is what advances the "Claude verarbeitet" step in the
submitted panel. Polling `/decisions` returns the same data but acks nothing,
so the user sees a progress list frozen at step 1 even though Claude is
working. A `submitted: true` alongside an empty `_picked_up_at` is therefore
proof that no `/pending` call ever ran while that submission was current.

**Read decisions** — they're in the same JSON response from `GET /decisions`:
```json
{"submitted": true, "decisions": [...], "comments": [...]}
```

No browser eval needed. The bridge server handles everything.

**Reset after processing** — tell the bridge server to clear decisions.
Always pass the captured `_version` so a submission that races with your
reset is not silently dropped (409 = retry). **`/reset` is the LAST step
of every processing cycle, after the file rewrite and `/reload`** — see
§ Live Page Update below.
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
     -H "Content-Type: application/json" \
     -d '{"version": <noted>}' http://localhost:$PORT/reset
```

On success the server stamps `_processed_at` with the current UTC time.
The visible panel reset already happened via `location.reload()` (triggered
by `/reload` in the previous step). The browser's `pollProcessedState` only
flips the panel locally as a safety-net — when a reload counter advance
has been observed OR a long stale timeout elapses. See `templates.md`
§ Panel State Reset for the client contract.

### Legacy Fallback: JS Eval (for page updates)

For live page updates (Step 5c — updating content after processing decisions),
browser eval tools are still useful:

- playwright: `browser_evaluate("...")`
- preview: `preview_eval("...")`

**Scope warning:** `preview_eval` is allowed here for evaluating JS inside
the **already-open** Edge tab. It is NEVER allowed for *opening* the
concept page — see SKILL.md § Step 3 (MANDATORY — Real Edge browser only)
and bridge-server.md § Step 6. Opening via the preview MCP would replace
the user's real Edge tab with a sandboxed in-IDE iframe that has no
heartbeat connection and breaks the whole concept flow.

If no eval tool works, inform the user via chat what was processed instead
of updating the page live. The page can be manually refreshed.

**WARNING:** NEVER use `get_page_text`, `browser_snapshot`, or `preview_snapshot`
to read decisions. Concept pages contain large inline CSS/JS (self-contained HTML).
These "read page" tools strip scripts and may fail with "page body too large".

### Manual Fallback (bridge server AND browser tools unavailable)

If both the bridge server and browser tools are unavailable (very rare — would
require the HTTP server to crash):

```
AskUserQuestion:
  question: "Hast du deine Entscheidungen auf der Concept-Seite abgeschickt?"
  options:
    - "Ja, fertig"
    - "Brauche noch Zeit"
    - "Abbrechen"
```

If user picks "Ja" but no tool can read decisions, ask the user to
copy-paste the JSON from the page's developer console:

```
console.log(document.getElementById('concept-decisions').textContent)
```

## Polling Strategy

### Timing

Three tiers, and only one of them is primary:

- **Initial wait**: 10 seconds after opening (give the page time to load and
  the user time to orient), then one manual heartbeat + `/pending` check.
- **Pickup waker — 20 s, primary.** The detached background task from
  `bridge-server.md` § step 3, task 2. 20 s is not arbitrary: it sits well
  under the 90 s `HEARTBEAT_STALE_MS` the page uses to decide the indicator.
- **Cron — 60 s, backup only, and only a partial one.** Session-only crons fire
  only while the REPL is idle, so it cannot cover the window it looks like it
  covers: during a processing round the REPL is busy. Re-launch the waker at
  SKILL.md 5c step 7 instead of leaving that gap to the cron.
- **Timeout**: NONE — monitoring runs indefinitely until the user explicitly
  ends it (says "fertig"/"done", closes the page, or closes Claude). Never
  impose artificial timeouts.

### Non-Blocking Behavior

Monitoring must not block the conversation — and must not depend on one
either. **The bridge page IS the submission channel.** A user who clicks
"Entscheidungen abschicken" has no reason to also type "fertig" in chat, and
expects Claude to react to the click itself.

1. After opening the page, confirm that the **pickup waker is running** (Step 3,
   task 2). It watches `/pending` detached and exits the instant a submission
   lands, which wakes Claude with no user message involved. This is step 1 —
   not "wait for their next message".
2. Re-launch the waker after **every** processing round (SKILL.md Step 5d). It
   exited to wake you; until it is restarted, nothing is watching.
3. If the user sends a message → respond normally. The waker keeps running; it
   is a separate process, not a turn.
4. If the user says "fertig" / "done" / "abgeschickt" → read decisions
   immediately rather than waiting for the next waker cycle. This is a
   shortcut, never the trigger.

Ending the turn with nothing watching is the failure this section exists to
prevent: the pulser keeps the indicator green, so the page looks connected
while the submission sits unread.

**Do not poll in the foreground.** A `sleep` loop inside a normal Bash call
blocks the turn and the conversation with it. The pulser and the waker are the
sanctioned form: the same loop, launched **detached** with
`run_in_background: true`, so it watches without occupying a turn. See
`bridge-server.md` § step 3 for both bodies.

### Per-Poll Validation

On each poll cycle:

1. **Send heartbeat**: `curl -s -X POST http://localhost:$PORT/heartbeat`
2. **Check pending**: `curl -s http://localhost:$PORT/pending` — then fetch
   `/decisions` only once `pending` is `true`
3. If curl fails → bridge server may have crashed → attempt restart

**Tab-alive check** (via HTTP):
- If `curl /heartbeat` or `curl /decisions` fails with connection refused →
  bridge server crashed → attempt restart
- If bridge server responds but page never submits past timeout → user may
  have closed the tab → ask via AskUserQuestion

### Page Reload Handling

A page reload (F5) is **not a problem** with the HTTP bridge:
- The bridge server keeps running independently of the page
- The keepalive pulser keeps posting → page reconnects automatically after reload
- `localStorage` preserves user selections (see `templates.md` § State Persistence)
- The `concept-submitted` class resets (correct — user can re-submit)
- Decisions in the bridge server persist across reloads

**No special recovery needed** — the HTTP bridge makes page reloads transparent.

### No Timeout Policy

There is **no timeout**. The user decides when to submit — whether that takes
2 minutes or 2 hours. The pulser and the waker keep running, so Claude
responds to the submission itself — no chat message required.

The monitoring loop ends ONLY when:
- The user says "fertig" / "done" / "abbrechen" in chat
- The user closes the browser tab (detected when bridge server stays alive
  but no submissions arrive and the user confirms in chat)
- The user closes Claude Desktop
- The backup cron expires after 7 days (platform limit, effectively infinite)

## Decision Processing

### Parsing

The JSON from `#concept-decisions` follows this schema:

```json
{
  "submitted": true,
  "round": 1,
  "decisions": [
    {
      "id": "string — element identifier",
      "label": "string — human-readable label",
      "evaluation": "include | discard | only (for variant-bearing types)",
      "...": "variant-specific fields (accepted, included, selected, rating, etc.)"
    }
  ],
  "comments": [
    {
      "id": "string — section identifier",
      "text": "string — user comment"
    }
  ]
}
```

### Summarization

After parsing, produce a brief summary:

```markdown
## Concept-Ergebnisse (Runde 1)

**Akzeptiert:** Finding 1, Finding 3, Finding 5
**Abgelehnt:** Finding 2, Finding 4
**Varianten:** Variant A → Miteinbeziehen, Variant B → Verworfen, Variant C → Exakt diese
**Kommentare:**
- Finding 1: "Focus on this first, highest business impact"
- Finding 4: "Not relevant for current sprint"
```

### Workflow Continuation

Map decisions back to the original context:

| Variant | Accept/Include action | Reject/Discard action | "Only" action |
|---------|----------------------|----------------------|---------------|
| analysis | Prioritize finding | Deprioritize, skip | N/A |
| plan | Include step in execution | Remove step | N/A |
| concept | Consider variant | Archive alternative | Develop ONLY this variant |
| comparison | Keep in evaluation | Remove from comparison | Proceed with ONLY this option |
| prototype | Approve screen/flow | Flag for redesign | N/A |
| dashboard | Confirm action item | Remove from list | N/A |
| creative | Keep idea in working set | Archive idea | N/A |

### Live Page Update (after each round)

After processing a submission, Claude MUST update the browser page and
THEN reset the bridge server. **Order is mandatory** — resetting before
the new iteration is on disk causes a phantom "ready" panel on the still
active old iteration, allowing duplicate submissions before the reload
lands.

1. **Rewrite the HTML file** with the new iteration appended (Step 5c
   in `SKILL.md`).

2. **Trigger reload** — bump the reload counter:
   ```bash
   curl -s -X POST http://localhost:$PORT/reload
   ```
   The browser's `pollReload` (every 3 s) sees the counter advance and
   calls `location.reload()`. The freshly loaded page is in ready state
   automatically (`concept-submitted` is not persisted).

3. **Reset bridge server state (conditional on `_version`)** — LAST step:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{"version": <noted>}' http://localhost:$PORT/reset
   ```
   A 200 stamps `_processed_at`; a 409 means a newer submission arrived —
   re-fetch `/decisions` and process that instead.

4. **Page UI** — the visual reset already happened via `location.reload()`
   in step 2. The `_processed_at` stamp from step 3 is a safety-net read
   by the browser's `pollProcessedState` only when a reload counter
   advance has been observed OR a long stale timeout elapses (recovery
   for the rare case where reload didn't fire — closed tab, JS error).

5. **Update content to reflect processed state** (via browser eval if available):
   - Mark processed items visually (checkmark, "Verarbeitet" badge)
   - Show results of the processing (e.g., generated code, updated plan)
   - Add new decision points if the processing revealed further choices
   - Gray out discarded variants

6. **Resume monitoring** — return to the polling loop for the next round

### Persistence

Two layers, and it matters which one is load-bearing.

**1. The bridge's durable store — automatic, Claude-independent (#284).**
`.claude/concepts/{date}-{slug}/` is written by the SERVER, not by Claude:
`POST /decisions` fsyncs the payload before it acks the browser, `/progress`
journals each processing checkpoint, `/attachments` persists pasted images on
attach. This is the layer that survives the failures that matter — a PC
restart, a crash, or the watchdog reaping the bridge because Claude hit a
usage limit and stopped heartbeating. Nothing Claude does or fails to do can
lose a submission any more.

Read the store when resuming: `GET /recovery` on a live bridge, or the files
directly when the bridge is gone (which is what `ss.concept.resume` does).

**2. The readable round history — written by Claude after processing.**
`docs/concepts/{same-timestamp}-{same-slug}-v{same-version}-decisions.json`,
appending one entry per round:

```json
{
  "rounds": [
    { "round": 1, "timestamp": "...", "decisions": [...], "comments": [...] },
    { "round": 2, "timestamp": "...", "decisions": [...], "comments": [...] }
  ]
}
```

This is a human-readable artefact for the repo, subject to the Step 6a
disposition rules — **not** a safety net. It is written only after a round
completes, so it covers none of the window where work is actually at risk.
Treating it as the persistence layer is what left that window open in the
first place.

### Checkpointing while processing

For anything longer than an `iterate` — `implement`, `create-issues`, `ship` —
POST a checkpoint as each real-world artifact comes into existence:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"action":"ship","step":"pr-opened","status":"done","version":<v>,"artifacts":{"branch":"feat/x","pr":42}}' \
  http://localhost:$PORT/progress
```

A resumed session replays these to find out where the previous run stopped.
Without them, recovering a half-finished `ship` means either re-running it
blind or giving up — which is why the checkpoint is not optional for the
non-`iterate` branches. See SKILL.md Step 5b.

## Error Handling

### Error Recovery Matrix

| Error | Symptom | Recovery |
|-------|---------|----------|
| Bridge server not responding | `curl /heartbeat` fails or times out | Check if server process is alive, restart if needed |
| Bridge server crashed | Connection refused on all endpoints | Relaunch per `bridge-server.md` § step 2 — same port, `run_in_background: true`, `--html` set. Never the `&` form: a child backgrounded inside one Bash call is reaped when that call ends. Then re-launch both watchers. The restarted server restores its state from the store, so a submission made before the crash is served again as `pending: true` |
| Bridge reaped while a submission was unprocessed | New session, `.claude/concepts/<slug>/UNPROCESSED` exists | The usage-limit path: the pulser died with the turn and the watchdog reaped the bridge 30 min later. Nothing is lost — relaunch on the same port, `GET /recovery`, verify the last checkpoint against reality, resume. `ss.concept.resume` emits these instructions automatically |
| Submission rejected as not durable | Page shows the durability warning strip, HTTP 507 | The bridge could not write its store (disk full, store directory removed). The payload is still in the page's localStorage and the panel is back in ready state — fix the disk/path, then re-submit. Do NOT tell the user to retype anything |
| Keepalive pulser stopped (`PULSER_EXIT`) | Page shows "nicht verbunden" despite server running | Send a manual `curl -s -X POST /heartbeat`, then re-launch the pulser (bridge-server.md § step 3, task 1) |
| Pickup waker stopped without a submission (`WAKER_EXIT reason=SERVER_DEAD`) | Submissions go unnoticed while the indicator may still be green | Restart the bridge server ON THE SAME PORT (a new one orphans the state file, the open tab, and makes fresh watchers exit PORT_CHANGED), then re-launch BOTH background tasks |
| Decisions JSON parse error | `curl /decisions` returns malformed JSON | Show raw content to user, ask to verify |
| Empty decisions array | Parsed but `decisions.length === 0` | Ask if intentional (all defaults accepted) |
| Tab closed by user | Bridge server alive but no activity | Ask user via AskUserQuestion when they send a chat message |
| Offline submission | User submitted while Claude was disconnected | Decisions cached in localStorage, auto-delivered on reconnect via `retryPendingSubmission()` |
| JS eval broken (page updates) | `javascript_tool` returns "Cannot access chrome-extension://" | Expected — page updates not possible, inform user via chat |
| `get_page_text` used accidentally | "page body too large" or stripped content | Use HTTP bridge endpoints instead |
| All tools fail | Bridge server + browser tools both unavailable | Fall back to manual AskUserQuestion flow |

### Retry Protocol

1. **Bridge server failure**: restart the server on the SAME port, re-arm the
   backup cron, and re-launch BOTH background tasks (pulser + waker). A new
   port orphans the state file and the user's open tab; restarting the server
   alone leaves nothing watching `/pending`, so the page goes green again while
   submissions rot.
2. **Browser tool failure** (for page updates): Inform user, continue monitoring via HTTP
3. **Both fail**: Manual fallback (AskUserQuestion + console.log)
4. **NEVER silently stop monitoring** — always inform the user why monitoring ended

## Security

- Never execute arbitrary JavaScript from the page — only read known elements
- The HTML file is local-only — no data leaves the machine
- Decision JSON is never sent to external services
- Clean up HTML files periodically (suggest during `/setup-cleanup`)
