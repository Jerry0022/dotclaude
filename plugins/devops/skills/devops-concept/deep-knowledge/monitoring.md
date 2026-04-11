# Concept Browser Monitoring

How Claude monitors the concept page for user decisions, processes them
**live**, and updates the page for further interaction.

## Monitoring Architecture

```
[Claude generates HTML] → [Opens in browser] → [User interacts]
                                                       ↓
[Claude polls page state] ←←←←←←←←←←←←←←←←← [User clicks Submit]
         ↓
[Parse decisions JSON] → [Process decisions] → [Update page in browser]
         ↑                                              ↓
         └←←←←←←←← [User reviews update] ←←←←←←←←←←←←┘
                     [User can submit again]
```

This is an **iterative loop**, not a one-shot. After each submission,
Claude processes the feedback, updates the page, and monitors again.
The loop continues until the user is done (closes page or says "fertig").

## Detection Signal

The submit action adds a CSS class to `<body>`:

```javascript
document.body.classList.contains('concept-submitted')  // → true when submitted
```

Decision data lives in a hidden JSON block:

```javascript
JSON.parse(document.getElementById('concept-decisions').textContent)
```

## Tool Selection

Follow the **Browser Tool Strategy** (`deep-knowledge/browser-tool-strategy.md`)
for tool selection. Use the waterfall to set `$BROWSER_TOOL`, then use the tool
mapping table to pick the correct call for each action.

## Known Limitation: `file://` URLs

Browser tools (Chrome MCP, Playwright) **cannot open or interact with `file://`
URLs**. Chrome MCP's `navigate` tool always prepends `https://`, and Playwright
blocks the `file:` protocol entirely. Additionally, tabs opened via `start ""
msedge` land **outside the MCP tab group** and are invisible to monitoring.

**Required workaround:** Serve concept pages via a local HTTP server (see
SKILL.md Step 3). This makes the page accessible at `http://localhost:<port>/`
which all browser tools can handle.

## Pre-Monitoring Setup

Before starting the monitoring loop, establish and validate the browser connection:

1. Run the **Browser Tool Strategy waterfall** (`deep-knowledge/browser-tool-strategy.md`)
   to set `$BROWSER_TOOL`
2. If `$BROWSER_TOOL` is `chrome-mcp`:
   - The concept page must already be open via `navigate` in the MCP tab group
     (opened in Step 3 via localhost HTTP server). Do NOT look for tabs opened
     via `start "" msedge` — those are outside the MCP group.
   - Call `tabs_context_mcp` to get the current tab group
   - Identify the concept page tab (by URL or title) and store its ID as `$TAB_ID`
   - **Validate the type:** `$TAB_ID` must be a number — if it was captured as a
     string, coerce immediately: `$TAB_ID = Number($TAB_ID)`
   - A string tabId causes MCP validation errors on every subsequent call
3. If `$BROWSER_TOOL` is `playwright` or `preview`:
   - Tab management is implicit — no explicit `$TAB_ID` needed
4. If the waterfall fails entirely:
   - Skip browser-based monitoring
   - Fall back to the manual AskUserQuestion flow (see below)

### Concept-Specific Calls

Using `$BROWSER_TOOL`, execute:

**Heartbeat injection (every poll, BEFORE checking submission):**
- chrome-mcp: `javascript_tool("document.body.dataset.claudeHeartbeat = Date.now()")`
- playwright: `browser_evaluate("document.body.dataset.claudeHeartbeat = Date.now()")`
- preview: `preview_eval("document.body.dataset.claudeHeartbeat = Date.now()")`

This tells the page that Claude is actively monitoring. The page's JS uses
this to enable/disable the submit button and show a connection warning when
the heartbeat goes stale (>45 seconds). See `templates.md` § Claude Connection
Heartbeat. **Always inject the heartbeat first** — even before checking
`concept-submitted`, because the heartbeat keeps the UI in a valid state.

**Check submission:**
- chrome-mcp: `javascript_tool("document.body.classList.contains('concept-submitted')")`
- playwright: `browser_evaluate("document.body.classList.contains('concept-submitted')")`
- preview: `preview_eval("document.body.classList.contains('concept-submitted')")`

**Read decisions:**
- chrome-mcp: `javascript_tool("document.getElementById('concept-decisions').textContent")`
- playwright: `browser_evaluate("document.getElementById('concept-decisions').textContent")`
- preview: `preview_eval("document.getElementById('concept-decisions').textContent")`

**WARNING:** NEVER use `get_page_text`, `browser_snapshot`, or `preview_snapshot`
to read decisions. Concept pages contain large inline CSS/JS (self-contained HTML).
These "read page" tools strip scripts and may fail with "page body too large".
Always use the eval-based tools above for structured data extraction.

### Manual Fallback (no browser tool available)

If the browser tool strategy waterfall fails entirely:

```
AskUserQuestion:
  question: "Hast du deine Entscheidungen auf der Concept-Seite abgeschickt?"
  options:
    - "Ja, fertig"
    - "Brauche noch Zeit"
    - "Abbrechen"
```

If user picks "Ja" but no browser tool can read the page, ask the user to
copy-paste the JSON from the page's developer console:

```
console.log(document.getElementById('concept-decisions').textContent)
```

## Polling Strategy

### Timing
- **Initial wait**: 10 seconds after opening (give the page time to load and
  the user time to orient)
- **Poll interval**: 15 seconds
- **Timeout**: 5 minutes (300 seconds)
- **Max polls**: 20 attempts

### Non-Blocking Behavior

Monitoring MUST NOT block the conversation:

1. After opening the page, inform the user and **wait for their next message**
2. If the user sends a message → respond normally, then resume monitoring
3. If the user says "fertig" / "done" / "abgeschickt" → immediately read decisions
4. If the user asks for something unrelated → pause monitoring, handle request

### Per-Poll Validation (chrome-mcp only)

Before each poll attempt:
1. Call `tabs_context_mcp`
2. Verify `$TAB_ID` is still in the returned tab list
3. If missing → tab was closed → stop monitoring, inform user:
   > "Die Concept-Seite wurde geschlossen. Monitoring beendet."
4. If `tabs_context_mcp` itself fails → extension disconnected → attempt reconnection
   per the Mid-Session Reconnection Protocol in `deep-knowledge/browser-tool-strategy.md`

This check ensures monitoring stops ONLY when the tab is actually closed,
never because the extension had a transient hiccup.

### Page Reload Detection

A page reload (F5 or user-triggered) keeps the tab alive but temporarily makes
the page unreachable. This is **not** a tool failure — it's a transient state.

**Detection signal:** The eval call fails (error, timeout, or returns
`undefined`/`null`) BUT `tabs_context_mcp` confirms `$TAB_ID` is still in the
list. This means the tab exists but the page content is not ready.

**Recovery protocol:**

1. Eval fails → call `tabs_context_mcp`
2. `$TAB_ID` still in list → **page reload detected** (not tab closed, not
   extension disconnected)
3. Wait **3 seconds** (page needs time to load and execute inline JS)
4. Retry eval — if it succeeds, resume normal polling
5. If still failing → wait another **3 seconds**, retry once more
6. If still failing after 3 retries (total ~9 seconds) → re-run the full
   waterfall probe as a last resort, then retry
7. **NEVER stop monitoring** due to a reload — the tab is alive, the page
   will come back

**Key distinction from other failures:**

| Symptom | Diagnosis | Action |
|---------|-----------|--------|
| Eval fails + tab missing | Tab closed | Stop monitoring |
| Eval fails + `tabs_context_mcp` fails | Extension disconnected | Reconnection protocol |
| Eval fails + tab still alive | **Page reload** | Wait and retry (this section) |

After a successful retry, the page is back to its initial state. This is
expected behavior — `sessionStorage` persistence in the HTML ensures user
selections survive the reload (see `deep-knowledge/templates.md` § State
Persistence). The `concept-submitted` class will be `false` (correct — the
user hasn't re-submitted), so normal polling continues.

**Do NOT use sleep loops.** Instead, check the page state:
- When the user sends a message that could indicate completion
- When the user explicitly says they're done
- Periodically if the conversation is idle (via cron or tool-based check)

### Timeout Handling

After 5 minutes without submission:

```
AskUserQuestion:
  question: "Die Concept-Seite ist seit 5 Minuten offen. Wie soll ich weiter?"
  options:
    - "Brauche mehr Zeit" → extend by 5 minutes
    - "Ergebnisse jetzt auslesen" → read current state even if not submitted
    - "Abbrechen" → proceed without decisions
```

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

After processing a submission, Claude MUST update the browser page:

1. **Reset submission state and decision panel:**
   ```javascript
   // Via browser tool (javascript_tool / browser_evaluate / preview_eval)
   document.body.classList.remove('concept-submitted');
   document.getElementById('concept-decisions').textContent =
     JSON.stringify({submitted: false, round: N+1, decisions: [], comments: []});
   // Switch panel back from "submitted" to "ready" state
   document.getElementById('panel-submitted').style.display = 'none';
   document.getElementById('panel-ready').style.display = 'block';
   document.getElementById('submit-btn').disabled = false;
   document.getElementById('submit-btn').textContent = 'Entscheidungen abschicken';
   ```

2. **Update content to reflect processed state:**
   - Mark processed items visually (checkmark, "Verarbeitet" badge)
   - Show results of the processing (e.g., generated code, updated plan)
   - Add new decision points if the processing revealed further choices
   - Gray out discarded variants

3. **Resume monitoring** — return to the polling loop for the next round

### Persistence

Write processed decisions to:
`{project}/.claude/devops-concept/{same-timestamp}-{same-slug}-decisions.json`

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
| tabId type error | MCP validation: "expected number, received string" | Coerce `$TAB_ID = Number($TAB_ID)`, retry |
| Extension disconnected | Tool call times out or returns connection error | Re-run waterfall probe, update `$BROWSER_TOOL` and `$TAB_ID` |
| Tab closed by user | `tabs_context_mcp` succeeds but `$TAB_ID` not in list | Stop monitoring, inform user: "Die Concept-Seite wurde geschlossen. Monitoring beendet." |
| **Page reload** | Eval fails but `$TAB_ID` still in tab list | **Wait 3s → retry up to 3 times** (see § Page Reload Detection). NEVER stop monitoring — the page will come back. |
| JS eval returns null/undefined | Element not found on page | Retry once (page might still be loading), then show raw error |
| JSON parse error | `JSON.parse()` throws | Show raw content to user, ask to verify |
| Empty decisions array | Parsed but `decisions.length === 0` | Ask if intentional (all defaults accepted) |
| `get_page_text` used accidentally | "page body too large" or stripped content | Switch to `javascript_tool`/`browser_evaluate`/`preview_eval` — NEVER use `get_page_text` for concept pages |
| All tools fail | Waterfall exhausted | Fall back to manual AskUserQuestion flow |

### Retry Protocol

1. **Single tool failure**: Check tab alive first (§ Page Reload Detection)
   - Tab alive → page reload — wait 3s, retry up to 3 times
   - Tab missing → tab closed — stop monitoring, inform user
   - `tabs_context_mcp` fails → extension disconnected — go to step 2
2. **Repeated failure after reload recovery (3x)**: Re-probe waterfall, switch `$BROWSER_TOOL`
3. **Waterfall failure**: Manual fallback (AskUserQuestion + console.log)
4. **NEVER silently stop monitoring** — always inform the user why monitoring ended

## Security

- Never execute arbitrary JavaScript from the page — only read known elements
- The HTML file is local-only — no data leaves the machine
- Decision JSON is never sent to external services
- Clean up HTML files periodically (suggest during `/devops-repo-health`)
