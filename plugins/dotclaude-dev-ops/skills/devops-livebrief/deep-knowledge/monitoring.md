# Livebrief Browser Monitoring

How Claude monitors the livebrief page for user decisions, processes them
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
document.body.classList.contains('livebrief-submitted')  // → true when submitted
```

Decision data lives in a hidden JSON block:

```javascript
JSON.parse(document.getElementById('livebrief-decisions').textContent)
```

## Tool Priority

Use the first available tool in this order:

### 1. Claude in Chrome/Edge (`mcp__Claude_in_Chrome__*`)

Best option — direct access to page DOM. Works with Edge (Chromium-based).

**Check submission:**
```
javascript_tool: "document.body.classList.contains('livebrief-submitted')"
```

**Read decisions:**
```
javascript_tool: "document.getElementById('livebrief-decisions').textContent"
```

### 2. Playwright (`mcp__plugin_playwright_playwright__*`)

Second best — headless or attached browser.

**Navigate to file:**
```
browser_navigate: "file:///{filepath}"
```

**Check submission:**
```
browser_evaluate: "document.body.classList.contains('livebrief-submitted')"
```

**Read decisions:**
```
browser_evaluate: "document.getElementById('livebrief-decisions').textContent"
```

### 3. Claude Preview (`mcp__Claude_Preview__*`)

Works for preview-based workflows.

**Check submission:**
```
preview_eval: "document.body.classList.contains('livebrief-submitted')"
```

### 4. Manual Fallback

If no browser tool is available:

```
AskUserQuestion:
  question: "Hast du deine Entscheidungen auf der Livebrief-Seite abgeschickt?"
  options:
    - "Ja, fertig"
    - "Brauche noch Zeit"
    - "Abbrechen"
```

If user picks "Ja" but no browser tool can read the page, ask the user to
copy-paste the JSON from the page's developer console:

```
console.log(document.getElementById('livebrief-decisions').textContent)
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

**Do NOT use sleep loops.** Instead, check the page state:
- When the user sends a message that could indicate completion
- When the user explicitly says they're done
- Periodically if the conversation is idle (via cron or tool-based check)

### Timeout Handling

After 5 minutes without submission:

```
AskUserQuestion:
  question: "Die Livebrief-Seite ist seit 5 Minuten offen. Wie soll ich weiter?"
  options:
    - "Brauche mehr Zeit" → extend by 5 minutes
    - "Ergebnisse jetzt auslesen" → read current state even if not submitted
    - "Abbrechen" → proceed without decisions
```

## Decision Processing

### Parsing

The JSON from `#livebrief-decisions` follows this schema:

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
## Livebrief-Ergebnisse (Runde 1)

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

1. **Reset submission state:**
   ```javascript
   // Via browser tool (javascript_tool / browser_evaluate / preview_eval)
   document.body.classList.remove('livebrief-submitted');
   document.getElementById('livebrief-decisions').textContent =
     JSON.stringify({submitted: false, round: N+1, decisions: [], comments: []});
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
`{project}/.claude/devops-livebrief/{same-timestamp}-{same-slug}-decisions.json`

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

| Error | Response |
|-------|----------|
| Browser tool unavailable | Fall back to next tool in priority list |
| Page closed before submit | Ask user to reopen or provide decisions manually |
| JSON parse error | Show raw content, ask user to verify |
| Empty decisions array | Ask if intentional (all defaults accepted) |
| Network/file access error | Retry once, then fall back to manual |

## Security

- Never execute arbitrary JavaScript from the page — only read known elements
- The HTML file is local-only — no data leaves the machine
- Decision JSON is never sent to external services
- Clean up HTML files periodically (suggest during `/devops-repo-health`)
