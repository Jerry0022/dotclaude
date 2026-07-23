# Edge Profiles

Configuration and usage rules for the two Microsoft Edge profiles used by this plugin.

---

> **Edge-only notice**
>
> This plugin uses Microsoft Edge exclusively for all browser-based tasks.
> The "Chrome-MCP" extension is a Chromium extension that runs **inside Edge** —
> never in Google Chrome. Plugin consumers do **NOT** need Google Chrome installed.
> When instructions say "Chrome-MCP", they always mean the extension loaded into
> the user's Edge browser.

---

## Profile Comparison

| Aspect | Main Edge (Chrome-MCP) | Scraper Profile (refresh-usage) |
|--------|------------------------|----------------------------------|
| Profile path | User's normal Edge profile (`Default`) | `~/.claude/edge-usage-profile` |
| Used by | All testing and browsing tasks (Chrome-MCP extension) | `refresh-usage-headless.js` only |
| Cookies / logins | User's actual cookies, persistent across sessions | Isolated; one-time login required per machine |
| Tab interaction | DOM and CDP via Chrome-MCP extension | CDP via WebSocket on a dedicated port |
| Window placement | **Always a separate window** via `--new-window` flag (own Alt-Tab entry; shares taskbar icon with main Edge due to profile grouping) | Headless — no visible window |
| When triggered | Any test / browser task | `/devops-auto-usage` skill |
| Computer-use visibility | Visible in screenshots (read-only tier) | Not visible; headless CDP only |

---

## Why Two Profiles?

The scraper profile keeps automated usage-refresh traffic isolated from the
user's normal browsing session. The Chrome-MCP extension in the main profile
must not open automated tabs that clutter the user's workspace or risk
interfering with an active login flow.

Tests and dashboard navigation use the main profile because those tasks
require the user's persisted cookies (project sessions, GitHub login, SSO,
etc.). The scraper profile handles only the Claude-usage page, which needs its
own isolated session to avoid token conflicts.

**Preview vs Edge for localhost-app testing.** Claude Preview is the primary
tool for testing the project's own localhost app **when the Chrome extension is
not connected** (see [browser-tool-strategy.md](browser-tool-strategy.md)); the
main Edge / Chrome-MCP profile stays primary when the extension *is* connected
and for all external sites. Preview is **origin-locked to localhost and cannot
reach claude.ai** — the usage scraper (`refresh-usage-headless.js`,
`~/.claude/edge-usage-profile`) therefore stays on dedicated Edge CDP and must
never be routed to Preview.

---

## Computer-Use Interaction with Main Edge

When computer-use fires (Tier 3, Must-Ask only), it drives screenshots of the
user's normal Edge window. Computer-use operates at the **read** tier for
browsers — it can see Edge in screenshots but cannot send clicks or keystrokes
to it. For click-level interaction in the browser, use Chrome-MCP tools instead.

---

## Cross-References

| Topic | File |
|-------|------|
| Browser tool waterfall and tier rules | [browser-tool-strategy.md](browser-tool-strategy.md) |
| refresh-usage skill | `plugins/devops/skills/devops-auto-usage/` |
