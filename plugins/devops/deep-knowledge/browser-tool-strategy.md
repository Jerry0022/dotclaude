# Browser Tool Strategy

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
extension** running in Edge (or the Playwright/Preview fallback chain).

**Exception:** Computer-use (`mcp__computer-use__*`) MAY be used for browser
interaction **only** when the user explicitly requests desktop takeover:
- User chooses "Desktop übernehmen" in `/devops-autonomous` Step 2
- User explicitly asks for computer-use / desktop control
- User explicitly invokes a flow that requires mouse/keyboard on the browser

In all other cases — especially background mode, concept monitoring, autonomous
background testing, silent operations — **never** use computer-use for browser
interaction. Use the Claude extension or the waterfall fallback chain instead.

**If the Claude extension is not connected and desktop takeover was NOT
requested:** follow the waterfall fallback (Playwright → Preview). Do NOT
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

### 4. Tab Reuse — No New Windows

When Edge is already running:
- **Open a new tab** in the existing Edge window — never a new Edge window
- Use `tabs_create_mcp` (Chrome MCP) or `start "" msedge "{url}"` (which
  adds a tab to the running instance, not a new window)

When Edge is NOT running:
- Launch a new Edge instance: `start "" msedge "{url}"`
- This is the ONLY case where a new Edge window is acceptable

**Never use `--new-window` or `--app=` flags** — they create isolated windows
outside the user's normal tab context.

### 5. Background and Autonomous Mode — Same Rules

These rules apply identically regardless of execution context:
- **Foreground** (user is present, interactive)
- **Background** (concept monitoring, autonomous testing, burn mode)
- **Autonomous** (user is AFK, `/devops-autonomous`)
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

## Primary Tool: Claude-in-Chrome Extension in Edge

The **Claude-in-Chrome MCP** (`mcp__Claude_in_Chrome__*`) is the primary and
preferred browser tool. It runs as a browser extension in **Microsoft Edge**
(Chromium-based, fully compatible). It provides full DOM-based read+write access:
navigation, clicking, typing, JavaScript evaluation, form filling, tab management.

**Key properties:**
- No desktop takeover — runs in the browser process, not via mouse/keyboard
- Works in both foreground and background/autonomous mode
- User can continue working while Claude interacts with browser tabs
- Full read+write: navigate, click, type, evaluate JS, read DOM, fill forms

## Waterfall: Silent Fallback

If the primary tool is not connected, fall through silently. No warnings, no
"extension not connected" messages. Use the **first tool that responds**:

| Priority | Tool | Probe call | Variable value |
|----------|------|-----------|----------------|
| 1 | Claude-in-Chrome | `tabs_context_mcp` | `chrome-mcp` |
| 2 | Playwright | `browser_snapshot` | `playwright` |
| 3 | Preview | `preview_screenshot` | `preview` |

Set `$BROWSER_TOOL` to the value from the first successful probe. Skills
reference `$BROWSER_TOOL` to pick the right calls.

If **none** respond → this is a hard error. Do not fall back to computer-use
for browser tasks. Display:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  BROWSER TOOL NICHT VERFÜGBAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Kein Browser-Tool konnte verbunden werden.

Geprüft:
  ✗ Claude-in-Chrome Extension (Edge) — nicht erreichbar
  ✗ Playwright MCP — nicht erreichbar
  ✗ Preview MCP — nicht erreichbar

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

## Computer-Use: Native Apps Only

`computer-use` is **exclusively** for native desktop applications (file explorer,
system settings, desktop apps). Never use it for:
- Browser navigation or clicking
- Web page interaction
- Form filling in web apps
- Reading web page content

Browsers have read-only tier in computer-use — visible in screenshots but all
interaction (clicks, typing) is blocked by the MCP server.

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
