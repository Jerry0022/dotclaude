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

Claude's cron polls the bridge server for the deterministic pending flag:

```bash
curl -s http://localhost:$PORT/pending
# → {"pending": true|false, "version": N}
```

`/pending` is a strict, machine-readable one-shot signal — use it instead
of substring-matching `/decisions`. The `/decisions` JSON response is
formatted via `json.dumps` which emits `"submitted": true` **with** a space
after the colon, so a literal `contains "submitted":true` check silently
misses every real submission. The cron in SKILL.md Step 3 pipes `/pending`
through `python -c` and only falls back to `/decisions` when pending is
true, eliminating that class of bug.

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

### 2. Start heartbeat cron

Set up a recurring heartbeat so the page knows Claude is monitoring:

```
CronCreate(cron: "* * * * *", prompt: "Run silently: curl -s -X POST http://localhost:{port}/heartbeat > /dev/null. Output nothing.")
```

Also send the first heartbeat immediately:

```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```

Store the cron job ID as `$HEARTBEAT_CRON_ID` for cleanup.

### HTTP Bridge Monitoring

**Heartbeat** (keeps the connection indicator green on the page):
```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```
Sent by the cron job every ~60s, and additionally on each manual poll cycle.

**Check submission** (poll for user decisions):
```bash
curl -s http://localhost:$PORT/decisions
```
Returns JSON. Check the `submitted` field:
- `true` → user has submitted, read the decisions from the same response
- `false` → not yet submitted, wait and retry

**Read decisions** — they're in the same JSON response from `GET /decisions`:
```json
{"submitted": true, "decisions": [...], "comments": [...]}
```

No browser eval needed. The bridge server handles everything.

**Reset after processing** — tell the bridge server to clear decisions.
Always pass the captured `_version` so a submission that races with your
reset is not silently dropped (409 = retry):
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
     -H "Content-Type: application/json" \
     -d '{"version": <noted>}' http://localhost:$PORT/reset
```

On success the server stamps `_processed_at` with the current UTC time.
The browser polls `/decisions` every 5 s, compares `_processed_at` against
its local `_submittedAt`, and — when the server stamp is newer — flips the
panel back to the ready state by itself. **No JS eval injection from
Claude required.** See `templates.md` § Panel State Reset for the client
contract.

### Legacy Fallback: JS Eval (for page updates)

For live page updates (Step 5c — updating content after processing decisions),
browser eval tools are still useful:

- playwright: `browser_evaluate("...")`
- preview: `preview_eval("...")`

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
- **Initial wait**: 10 seconds after opening (give the page time to load and
  the user time to orient)
- **Poll interval**: 15 seconds
- **Timeout**: NONE — monitoring runs indefinitely until the user explicitly
  ends it (says "fertig"/"done", closes the page, or closes Claude). The
  heartbeat cron keeps the connection alive. Never impose artificial timeouts.

### Non-Blocking Behavior

Monitoring MUST NOT block the conversation:

1. After opening the page, inform the user and **wait for their next message**
2. If the user sends a message → respond normally, then resume monitoring
3. If the user says "fertig" / "done" / "abgeschickt" → immediately read decisions
4. If the user asks for something unrelated → pause monitoring, handle request

### Per-Poll Validation

On each poll cycle:

1. **Send heartbeat**: `curl -s -X POST http://localhost:$PORT/heartbeat`
2. **Check decisions**: `curl -s http://localhost:$PORT/decisions`
3. If curl fails → bridge server may have crashed → attempt restart

**Tab-alive check** (via HTTP):
- If `curl /heartbeat` or `curl /decisions` fails with connection refused →
  bridge server crashed → attempt restart
- If bridge server responds but page never submits past timeout → user may
  have closed the tab → ask via AskUserQuestion

### Page Reload Handling

A page reload (F5) is **not a problem** with the HTTP bridge:
- The bridge server keeps running independently of the page
- Heartbeat cron keeps posting → page reconnects automatically after reload
- `localStorage` preserves user selections (see `templates.md` § State Persistence)
- The `concept-submitted` class resets (correct — user can re-submit)
- Decisions in the bridge server persist across reloads

**No special recovery needed** — the HTTP bridge makes page reloads transparent.

**Do NOT use sleep loops.** Instead, check the page state:
- When the user sends a message that could indicate completion
- When the user explicitly says they're done
- Periodically if the conversation is idle (via cron or tool-based check)

### No Timeout Policy

There is **no timeout**. The user decides when to submit — whether that takes
2 minutes or 2 hours. Claude keeps the heartbeat cron alive and responds
whenever the user submits or sends a chat message.

The monitoring loop ends ONLY when:
- The user says "fertig" / "done" / "abbrechen" in chat
- The user closes the browser tab (detected when bridge server stays alive
  but no submissions arrive and the user confirms in chat)
- The user closes Claude Desktop
- The heartbeat cron expires after 7 days (platform limit, effectively infinite)

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

After processing a submission, Claude MUST reset the bridge server and
update the browser page:

1. **Reset bridge server state (conditional on `_version`):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -d '{"version": <noted>}' http://localhost:$PORT/reset
   ```
   A 200 stamps `_processed_at`; a 409 means a newer submission arrived —
   re-fetch `/decisions` and process that instead.

2. **Page UI auto-resets** — the browser's 5 s heartbeat tick sees the
   new `_processed_at` and calls `restorePanelToReady()` locally. No
   browser eval needed from Claude. If the page is disconnected (closed
   tab / crashed tool), the reset still applies server-side and will take
   effect the next time the page loads.

3. **Update content to reflect processed state** (via browser eval if available):
   - Mark processed items visually (checkmark, "Verarbeitet" badge)
   - Show results of the processing (e.g., generated code, updated plan)
   - Add new decision points if the processing revealed further choices
   - Gray out discarded variants

4. **Resume monitoring** — return to the polling loop for the next round

### Persistence

Write processed decisions to:
`docs/concepts/{same-timestamp}-{same-slug}-v{same-version}-decisions.json`

Each round appends to the same file (array of rounds), preserving full history:

```json
{
  "rounds": [
    { "round": 1, "timestamp": "...", "decisions": [...], "comments": [...] },
    { "round": 2, "timestamp": "...", "decisions": [...], "comments": [...] }
  ]
}
```

## Error Handling

### Error Recovery Matrix

| Error | Symptom | Recovery |
|-------|---------|----------|
| Bridge server not responding | `curl /heartbeat` fails or times out | Check if server process is alive, restart if needed |
| Bridge server crashed | Connection refused on all endpoints | Re-run `python concept-server.py $PORT "$DIR" &` |
| Heartbeat cron stopped | Page shows "nicht verbunden" despite server running | Send manual `curl -s -X POST /heartbeat`, re-create cron |
| Decisions JSON parse error | `curl /decisions` returns malformed JSON | Show raw content to user, ask to verify |
| Empty decisions array | Parsed but `decisions.length === 0` | Ask if intentional (all defaults accepted) |
| Tab closed by user | Bridge server alive but no activity | Ask user via AskUserQuestion when they send a chat message |
| Offline submission | User submitted while Claude was disconnected | Decisions cached in localStorage, auto-delivered on reconnect via `retryPendingSubmission()` |
| JS eval broken (page updates) | `javascript_tool` returns "Cannot access chrome-extension://" | Expected — page updates not possible, inform user via chat |
| `get_page_text` used accidentally | "page body too large" or stripped content | Use HTTP bridge endpoints instead |
| All tools fail | Bridge server + browser tools both unavailable | Fall back to manual AskUserQuestion flow |

### Retry Protocol

1. **Bridge server failure**: Restart the server, re-create heartbeat cron
2. **Browser tool failure** (for page updates): Inform user, continue monitoring via HTTP
3. **Both fail**: Manual fallback (AskUserQuestion + console.log)
4. **NEVER silently stop monitoring** — always inform the user why monitoring ended

## Security

- Never execute arbitrary JavaScript from the page — only read known elements
- The HTML file is local-only — no data leaves the machine
- Decision JSON is never sent to external services
- Clean up HTML files periodically (suggest during `/devops-repo-health`)
