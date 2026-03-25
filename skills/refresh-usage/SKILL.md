---
description: Scrape live usage data from claude.ai/settings/usage via browser and save to usage-live.json. Run silently in the background.
---

# Refresh Usage Data

Scrapes live token usage from claude.ai via Edge CDP (Chrome DevTools Protocol).

## When to run

- **Automatically** before every completion card (Task Completion Signal) — always, no caching.
- **Manually** when the user asks for fresh usage data.

## Steps

1. Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --check-only` to test if CDP is available.

2. **CDP available** (exit code 0):
   Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --summary` to scrape.
   - Exit code 0: success — the script updates `usage-live.json`. Read the file for the new values.
   - Exit code 2: not logged in — inform user: "Bitte bei claude.ai einloggen, dann /refresh-usage erneut."
   - Exit code 3/4: scrape failed — show `📊 [no data]` in the completion card.

3. **CDP not available** (exit code 5):
   Ask the user via AskUserQuestion:
   - Label: "Edge CDP aktivieren"
   - Description: "Edge wird einmal sichtbar neu gestartet mit CDP-Port 9223. Danach läuft alles unsichtbar im Background."
   - Options: "Ja, Edge neu starten" / "Nein, überspringen"

   If approved: run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --activate-cdp`
   If declined: show `📊 [no data]` in the completion card.

## Important

- Never restart Edge without explicit user consent (AskUserQuestion).
- **No caching** — always scrape fresh data, regardless of file age.
- Edge only needs to be restarted once per PC session. After that, CDP stays active.
- Usage display is handled exclusively by the completion card (§Task Completion Signal) — not at session start.
- **Never use Claude in Chrome MCP tools** (navigate, read_page, computer, etc.) as a fallback for scraping usage data. The headless CDP script is the **only** allowed scraping method. If CDP is unavailable and the user declines Edge restart, show `📊 [no data]` — do not attempt browser automation.
- **Silent execution**: This skill must produce zero visible browser activity. If a visible browser window opens during execution, the implementation is wrong — stop and report the issue instead of continuing.
