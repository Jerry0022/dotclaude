# Automated Desktop Testing (Computer Use)

Rules for when and how Claude takes over the desktop to run visual UI tests
automatically using the Computer Use MCP tools.

**Important:** For browser-based UI testing, prefer the Browser Tool Strategy
(`browser-tool-strategy.md`) over computer-use. Computer-use has read-only tier
for browsers (no clicks/typing). Only use computer-use for native desktop apps.

**Before offering desktop takeover**, always attempt **snapshot-based testing**
first (see `test-strategy.md` § Browser Testing without Desktop Takeover).
Snapshots verify element presence, text, roles, and interactive state without
interrupting the user. Only escalate to desktop takeover when pixel-level
visual verification is genuinely required (layout, styling, image rendering).

## When to Offer

All three conditions must be true:

1. **5+ code edits** in the current session (tracked by `post.flow.completion` hook)
2. **test variant** selected (code edits + app-relevant work)
3. **UI project detected** — at least one of:
   - Preview server already running (`preview_list` returns active server)
   - `package.json` has dev/start script with UI deps (react, vue, angular,
     next, nuxt, vite, svelte, solid, astro, electron, tauri, remix, gatsby)
   - Project contains `index.html`, `App.tsx`, `App.vue`, or similar entry points

If all three are met → ask the user before proceeding with desktop tests.

## User Consent Flow

Use `AskUserQuestion` with exactly this structure:

```
Question: "Soll ich den Desktop übernehmen, um die Änderungen automatisch
           visuell zu testen?"

Header: "Desktop-Test"

Options:
  1. "Ja, Desktop übernehmen"
     Description: "Claude steuert Browser/App automatisch und prüft die
                   Änderungen visuell. Dauert ca. 1-2 Minuten."

  2. "Nein, manuell testen"
     Description: "Testschritte werden wie gewohnt in der Completion Card
                   aufgelistet."

Warning (in question text, MANDATORY):
  "WARNUNG: Während der automatischen Tests wird der Desktop periodisch
   gesteuert — Maus und Tastatur werden automatisch bewegt. Du kannst
   weiterarbeiten, aber deine Arbeit wird dabei kurzzeitig unterbrochen.
   Spiele, Videocalls oder zeitkritische Aufgaben sollten in diesem
   Zeitraum NICHT laufen."
```

- If user picks "Ja" → proceed with Desktop Test Flow below
- If user picks "Nein" → fall back to manual `userTest` steps in completion card
- If user provides custom text → interpret as additional test instructions

## Desktop Test Flow

### Step 1 — Request Access

Call `request_access` with the required applications:

- **Microsoft Edge** (the ONLY browser — see `browser-tool-strategy.md` § Edge Credo)
- Any other application visible in the test (if known)

Reason: "Automatische visuelle Tests der UI-Änderungen durchführen"

If the user denies access → fall back to manual test steps. Do not ask again.

### Step 2 — Ensure App is Running

- Check if preview server is already running (`preview_list`)
- If not → start it (`preview_start` or appropriate dev command)
- Wait for the app to be accessible

### Step 3 — Execute Visual Tests

Run tests as a sequence of Computer Use actions:

1. **Screenshot** — capture initial state
2. **Navigate** — open the relevant page/view where changes are visible
3. **Interact** — click buttons, fill forms, trigger the changed functionality
4. **Screenshot** — capture result state
5. **Verify** — compare expected vs. actual behavior visually

Use `computer_batch` to combine predictable action sequences and minimize
round-trips.

**What to test:**
- Changed UI components render correctly
- Interactive elements respond to clicks
- Form inputs accept and validate data
- Navigation flows work end-to-end
- No visual regressions in surrounding areas

**What NOT to test:**
- Backend-only logic (use unit tests instead)
- Authentication flows requiring real credentials
- Payment or sensitive data flows
- Third-party service integrations

### Step 4 — Collect Results

Format test results as `tests` array for the completion card:

```javascript
tests: [
  { method: "Visual: Landing Page", result: "pass" },
  { method: "Visual: Form Submit", result: "pass" },
  { method: "Visual: Error State", result: "fail — button misaligned" }
]
```

### Step 5 — Report

- If all tests pass → proceed to completion card with `variant: "test"` or
  `variant: "ready"` (depending on whether manual verification is still needed)
- If any test fails → report failures, offer to fix, render `variant: "test"`
  with failures noted

## Safety Rules

1. **Max duration**: 2 minutes total for all desktop tests. If exceeded → abort
   and report what was tested so far.
2. **User abort**: If the user interacts with the mouse/keyboard during testing,
   respect their input — do not fight for control. Pause and ask if they want
   to continue.
3. **No sensitive data**: Never enter passwords, API keys, or personal data
   during automated tests.
4. **No external actions**: Never submit forms to external services, make
   purchases, or send messages during automated tests.
5. **Screenshot privacy**: Screenshots taken during tests are ephemeral — they
   are used only for verification within the current session and not stored
   permanently.
6. **Cleanup**: After testing, return the app to a clean state (close modals,
   reset forms, navigate back to start page).

## Non-UI Projects

If the project has no UI (pure backend, CLI tool, library) → skip desktop
testing entirely. Use unit/integration tests from `ship_build` instead.

Exception: CLI tools with terminal output can be visually verified via
`preview_screenshot` of the terminal — but this does not require desktop
takeover and should use the standard visual verification flow instead.
