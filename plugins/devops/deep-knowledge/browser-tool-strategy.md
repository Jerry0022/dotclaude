# Browser Tool Strategy

> **Single-Source-of-Truth for test autonomy decisions:** see [test-autonomy.md](test-autonomy.md).
> This file retains Edge Credo + tool waterfall (Chrome-MCP → Preview → Playwright).

Cross-cutting rules for browser interaction across all skills. Every skill that
needs to read, navigate, click, or evaluate JavaScript in a browser MUST follow
this strategy. Do NOT duplicate browser tool selection logic in individual skills.

---

## Edge Credo — Hard Rules

These rules are **absolute and non-negotiable**. Every skill, agent, hook, and
autonomous flow MUST comply. No exceptions, no silent fallback to other browsers.

### 1. Edge Only — No Other Browser

Microsoft Edge is the **exclusive** browser. Never launch, control, or interact
with Chrome, Firefox, or any other browser. The Chrome MCP extension
(`mcp__Claude_in_Chrome__*`) is installed **in Edge** — its name contains
"Chrome" because it's a Chromium extension, but it runs in Edge.

### 2. Claude Extension First — Computer-Use for Browser Only on Explicit Request

**Default:** All browser interaction goes through the **Claude-in-Chrome
extension** running in Edge (or the Preview/Playwright fallback chain).

**Exception:** Computer-use (`mcp__computer-use__*`) MAY be used for browser
interaction **only** when the user explicitly requests desktop takeover:
- User chooses "Desktop übernehmen" in `/run-autonomous` Step 2
- User explicitly asks for computer-use / desktop control
- User explicitly invokes a flow that requires mouse/keyboard on the browser

In all other cases — especially background mode, concept monitoring, autonomous
background testing, silent operations — **never** use computer-use for browser
interaction. Use the Claude extension or the waterfall fallback chain instead.

**If the Claude extension is not connected and desktop takeover was NOT
requested:** follow the waterfall fallback (Preview → Playwright). Do NOT
silently fall back to computer-use mouse clicks on the Edge window.

### 3. User's Installed Edge — Always With User Context

Always use the user's **installed Edge instance** with their active profile
(login sessions, cookies, extensions, saved passwords). Never:
- Create a sandboxed or anonymous browser window via MCP
- Launch a headless Edge instance without user context
- Open a separate Edge profile or InPrivate window
- Use Playwright's own browser instance for user-facing pages

The user's context (logged-in state on claude.ai, GitHub, etc.) is essential.
MCP-created browser windows run without this context and break authentication.

### 4. Testing Window — Always Separate

Claude's test work runs in a **separate Edge window** from the user's working
tabs, using the user's main profile so logins/cookies still work.

When Edge is already running:
- **Always open a new Edge window** via
  `start "" msedge --new-window "{url}"` for test/automation work
- The new window inherits the user's profile → all cookies, logins, and
  extensions are available (including the Chrome-MCP extension itself)
- Edge groups same-profile windows under one taskbar icon — that's a Windows+Edge
  design limitation. Visual separation via Alt-Tab and window list is preserved.
- Once Claude's testing window exists, **reuse tabs within it** via Chrome MCP
  `tabs_create_mcp` / `tabs_context_mcp`. Do NOT spawn additional windows per tab.

When Edge is NOT running:
- Launch normally: `start "" msedge "{url}"` — the new instance is the only window.
- Subsequent test tabs reuse this window (no further `--new-window` flag needed).

**Never use `--app=` flag** — it produces a chromeless window that loses tab
context and confuses tab-group deduplication.

**Rationale for the separation:** Before this rule, Claude's test tabs landed
inside the user's working window — confusing because Tab Group color helped
but didn't prevent accidental tab switching. The separate window gives a clean
visual handoff while keeping the shared profile so HA, GitHub, Supabase, etc.
logins continue to work without per-service re-authentication.

### 5. Background and Autonomous Mode — Same Rules

These rules apply identically regardless of execution context:
- **Foreground** (user is present, interactive)
- **Background** (concept monitoring, autonomous testing, burn mode)
- **Autonomous** (user is AFK, `/run-autonomous`)
- **Headless/silent** (refresh-usage CDP scraping, health checks)

Background mode does NOT mean "use a different browser" or "use computer-use
instead". The Claude extension works in background — it operates via DOM/protocol,
not mouse/keyboard, so it doesn't interfere with the user's work.

### Quick Reference — What to Use When

| Scenario | Default tool | Desktop-Takeover tool | Without takeover: NEVER use |
|----------|-------------|----------------------|----------------------------|
| Open URL in browser | Chrome MCP `navigate` / `start "" msedge` | Computer-use | Computer-use |
| Read page content | Chrome MCP `get_page_text` / `read_page` | Computer-use screenshot | Computer-use |
| Click in browser | Chrome MCP `computer` (click) | Computer-use `left_click` | Computer-use |
| Fill form in browser | Chrome MCP `form_input` | Computer-use `type` | Computer-use |
| Run JS in browser | Chrome MCP `javascript_tool` | Chrome MCP (still preferred) | — |
| Test native desktop app | Computer-use (always) | Computer-use (always) | — |

---

## Primary Tool (localhost app): Chrome-MCP when connected, else Preview

For testing **the project's own running app on a local dev server**, the tool
order is set by the waterfall below. There are two first-class primaries:

- **Claude-in-Chrome MCP** (`mcp__Claude_in_Chrome__*`) runs as an extension in
  **Microsoft Edge** (Chromium, fully compatible). Full DOM read+write: navigate,
  click, type, evaluate JS, read DOM, fill forms, manage tabs. No desktop
  takeover; works foreground + background; uses the user's real Edge context.
  **When the extension is connected it stays primary** — it is the most capable
  tool (multi-tab, file upload, external origins, real login context).
- **Claude Preview** (`preview_*`) attaches to the local dev server. **When the
  Chrome extension is not connected, Preview is the primary tool** for the
  localhost app (no longer a last resort): it needs no extension setup, persists
  login **per-baseRepo** across worktrees/chats, and ships native viewport presets
  (`preview_resize` mobile/tablet/desktop + `colorScheme` dark/light), CSS
  `preview_inspect`, `preview_console_logs`, and `preview_network`. See
  [preview-testing.md](preview-testing.md).

> **Scope — Preview is localhost-only.** Preview is origin-locked to the local
> dev server and **refuses external navigation**. It is **N/A** for external /
> third-party sites (e.g. the claude.ai usage scraper), native desktop apps,
> multi-tab flows, file uploads to third parties, and external-provider auth —
> those stay on Chrome-MCP (Edge) / computer-use regardless of this waterfall.
> **When Preview is insufficient for a localhost app** (multi-tab, upload,
> complex cross-origin), fall to Chrome-MCP (Edge) → Playwright.

## Waterfall: Silent Fallback

If a tool is not connected, fall through silently. No warnings, no "extension
not connected" messages. Use the **first tool that responds**:

| Priority | Tool | Probe call | Variable value |
|----------|------|-----------|----------------|
| 1 | Claude-in-Chrome (Edge) | `tabs_context_mcp` | `chrome-mcp` |
| 2 | Preview | `preview_list` | `preview` |
| 3 | Playwright | `browser_snapshot` | `playwright` |

This order keeps **Chrome-MCP primary when the extension is connected** (probe 1
succeeds) and makes **Preview the primary** for the localhost app whenever the
extension is off (probe 1 fails, probe 2 succeeds). Set `$BROWSER_TOOL` to the
value from the first successful probe. Skills reference `$BROWSER_TOOL` to pick
the right calls.

If **none** respond → this is a hard error. Do not fall back to computer-use
for browser tasks. Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  BROWSER TOOL NICHT VERFÜGBAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Kein Browser-Tool konnte verbunden werden.

Geprüft:
  ✗ Claude-in-Chrome Extension (Edge) — nicht erreichbar
  ✗ Preview MCP — nicht erreichbar
  ✗ Playwright MCP — nicht erreichbar

Fix:
  1. Edge öffnen → Extension-Icon klicken → prüfen ob "Connected"
  2. Falls nicht: edge://extensions → Claude Extension → "Neu laden"
  3. Falls immer noch nicht: Edge komplett neu starten
  4. Claude Code Session ggf. neu starten (WebSocket-Reconnect)

Browser-Aufgaben können ohne aktives Tool nicht ausgeführt werden.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then abort the browser-dependent part of the task. Do NOT attempt to use
`computer-use` for browser interaction — browsers are locked to **read-only tier**
in computer-use (screenshots only, no clicks or typing).

## Silent Edge Restart (optional recovery)

Before showing the error, attempt ONE silent recovery if Edge is not responding:

```bash
# Only if no Edge process is running at all
tasklist | grep -qi msedge || start msedge --restore-last-session
```

Wait 5 seconds, then retry `tabs_context_mcp`. If still no response → show the
error block above.

## Tab Group Deduplication (Chrome MCP only)

Applies only when `$BROWSER_TOOL = chrome-mcp`. Playwright and Preview do not
manage tab groups — this section does not apply to those fallback paths.

The Chrome MCP extension creates a **tab group** per Claude Code session. If the
MCP connection drops and reconnects mid-session, the extension may treat the
reconnection as a new session and create a **second group** — resulting in
duplicate tab groups in Edge.

**Rule:** Before creating any new tab, always check for existing tabs first:

1. Call `tabs_context_mcp` to list current tabs
2. If tabs already exist from this session → reuse them
3. Only if no existing tabs are found → create a new tab

**When opening a URL and a session tab already exists:**
- Prefer navigating the existing tab (`navigate` with the existing `$TAB_ID`)
  over creating a new tab — unless multiple tabs are genuinely needed
- If a new tab IS needed, check the `tabs_context_mcp` response for the
  existing group's ID and pass it to `tabs_create_mcp` so the new tab joins
  the same group (verify the extension's actual parameter name at runtime)

**After MCP reconnection:**
- Re-probe with `tabs_context_mcp` to discover existing tabs and groups
- Do NOT create new tabs without first checking — this is the primary cause
  of duplicate groups
- If duplicate groups are detected, work only with the first group. Do NOT
  automatically close tabs from the duplicate — they may contain user content.
  Instead, ignore the duplicate group and let the user clean it up

**Concurrent agents (known limitation):** When multiple agents (e.g., from
`/run-burn` or `/run-autonomous`) open browser tabs simultaneously, a
race condition can occur: both agents probe, find no group, and each creates
one. Mitigation: in multi-agent sessions, designate one agent as the tab
manager, or add a short jitter (1-2 seconds) and re-probe before creating.

This is a **hard rule** — duplicate tab groups confuse the user and waste screen
space. One session = one group, always.

## tabId Type Invariant

`tabId` MUST always be a **number**. The `tabs_context_mcp` call returns tab IDs
as numbers. Any instruction or code that passes `tabId` to a browser tool must
ensure the value is a number, not a string.

**If a tabId was stored as a string** (e.g., extracted from text parsing), coerce
it before any tool call:

```javascript
$TAB_ID = Number($TAB_ID);  // coerce — never pass a string tabId
```

This is a **hard rule** — passing a string tabId to chrome-mcp tools causes
MCP validation errors (`expected number, received string`) that are difficult
to debug mid-session.

## Tab Alive Detection

Before relying on a previously opened tab, verify it is still alive:

1. Call `tabs_context_mcp` to retrieve the current tab list
2. Check whether the stored `$TAB_ID` appears in the returned list
3. Interpret the result:

| Outcome | Meaning |
|---------|---------|
| `$TAB_ID` found in list | Tab is alive — continue normally |
| `$TAB_ID` missing from list | Tab was **closed by the user** — stop monitoring |
| `tabs_context_mcp` call itself fails | Extension **disconnected** (not the same as tab closed) |

The distinction between "tab closed" and "extension disconnected" is critical:
- **Tab closed** → stop the monitoring loop, inform the user
- **Extension disconnected** → attempt reconnection (see Mid-Session Reconnection Protocol below)

## Split-Capability Detection

A browser tool can be **partially functional**: tab management works but JS eval
doesn't. Known case: Chrome MCP's `tabs_context_mcp`, `navigate`, and `read_page`
succeed while `javascript_tool` fails with "Cannot access a chrome-extension://
URL of different extension".

The waterfall probe (`tabs_context_mcp`) only tests connectivity — it does NOT
validate JS eval capability. Skills that need eval (concept monitoring, heartbeat
injection) MUST run a test eval immediately after the waterfall and fall through
to the next tool's eval if it fails. See concept skill's `monitoring.md`
§ Pre-Monitoring Setup step 5 for the implementation.

## Mid-Session Reconnection Protocol

When a browser tool call fails **mid-session** (after the initial waterfall probe
already succeeded), follow this recovery sequence:

1. **First failure**: Retry the exact same call once — transient hiccups happen
2. **Second failure**: Re-run the full waterfall probe to find a working tool
3. **Waterfall finds a tool**:
   - Update `$BROWSER_TOOL` to the newly working tool
   - Call `tabs_context_mcp` (if chrome-mcp) to get a fresh `$TAB_ID`
   - Continue monitoring from where you left off
4. **Waterfall fails entirely**: Show the browser-unavailable error block (see above)
5. **Before retrying**, distinguish the failure type via Tab Alive Detection:
   - If extension disconnected → reconnect via waterfall, do NOT stop monitoring
   - If tab closed by user → stop monitoring, inform user:
     > "Die Concept-Seite wurde geschlossen. Monitoring beendet."

**NEVER silently stop monitoring** — always inform the user why monitoring ended.

## Computer-Use: No-DOM Floor, Not "No Browser"

The precise rule is in [test-autonomy.md](test-autonomy.md) (Surface axis):
computer-use is the **pixel floor**, reached only when no structured surface is
readable. That makes it the *primary* tool for genuinely no-DOM frontends
(native GUI, games, canvas) — and the *last resort* for a DOM frontend whose
renderer is unreachable (e.g. a packaged Electron build with no debug port).

For any reachable DOM surface it is **never** used:
- Browser navigation or clicking
- Web page interaction
- Form filling in web apps
- Reading web page content

A packaged desktop app still has a DOM — prefer attaching via
`--remote-debugging-port` (then Chrome-MCP/Playwright/Preview) over driving it
with pixels. Browsers have read-only tier in computer-use — visible in
screenshots but all interaction (clicks, typing) is blocked by the MCP server.
"No DOM" is not "no structured surface": a TUI's text output is readable via the
terminal (Bash), which is cheaper than pixel control.

## Tool Mapping Reference

For skills that need to call browser tools, use `$BROWSER_TOOL` to select:

| Action | chrome-mcp | playwright | preview |
|--------|-----------|------------|---------|
| Open URL | `tabs_create_mcp` + `navigate` | `browser_navigate` | `preview_start` |
| Screenshot | `computer` (screenshot) | `browser_take_screenshot` | `preview_screenshot` |
| Click | `computer` (click) | `browser_click` | `preview_click` |
| Type text | `form_input` | `browser_fill_form` / `browser_type` | `preview_fill` |
| Eval JS | `javascript_tool` | `browser_evaluate` | `preview_eval` |
| Read page | `get_page_text` | `browser_snapshot` | `preview_snapshot` |
| Read DOM | `read_page` | `browser_snapshot` | `preview_snapshot` |

**CRITICAL — Read page vs Eval JS:**

- **"Read page"** (`get_page_text` / `browser_snapshot` / `preview_snapshot`) extracts
  visible text content. It **strips scripts, CSS, and structured data**. Use ONLY for
  reading article-like content where raw text is sufficient.
- **"Eval JS"** (`javascript_tool` / `browser_evaluate` / `preview_eval`) executes
  JavaScript in the page context and returns the result. Use for **ALL structured data
  reading** (JSON blocks, DOM state, form values, element attributes, computed values).

**NEVER use "Read page" tools to extract structured data from self-contained HTML
pages.** Self-contained pages contain large inline CSS and JS that cause these tools
to fail with "page body too large" errors — and even when they succeed, the inline
script content is stripped, making the structured data unreadable. Always use "Eval JS"
for structured data.
