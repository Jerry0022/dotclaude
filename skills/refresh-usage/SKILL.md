---
description: Scrape live usage data from claude.ai/settings/usage via browser and save to usage-live.json. Run silently in the background.
---

# Refresh Usage Data

Scrapes live token usage from claude.ai via Edge CDP (Chrome DevTools Protocol).

## When to run

- **Automatically** before every completion card (Task Completion Signal) — always, no caching.
- **Manually** when the user asks for fresh usage data.

## Steps

1. Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --check-only` to test CDP availability.

2. **Exit code 0** — CDP available:
   Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --summary` to scrape.
   - Exit code 0: success — read `usage-live.json` for the new values. Check `_cached` field: if true, data is stale (age in `_ageMinutes`).
   - Exit code 2: not logged in — inform user: "Bitte bei claude.ai einloggen, dann /refresh-usage erneut."
   - Exit code 3/4: scrape failed — the script auto-falls back to cached data if available.

3. **Exit code 7** — Edge not running at all:
   Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --summary --auto-start` to start Edge with CDP non-destructively (no kill, no user consent needed).
   - Exit code 0: success — Edge was started and data scraped (or cached fallback used).
   - Other: show `📊 [no data]` in the completion card.

4. **Exit code 5** — Edge running without CDP:
   Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --activate-cdp` automatically (no user consent needed).
   Then run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --summary` to scrape.
   - Exit code 0: success.
   - Other: show `📊 [no data]` in the completion card.

## Important

- **Auto-start (step 3) needs no user consent** — it only starts Edge when no Edge process exists. Nothing is killed or disrupted.
- **CDP activation (step 4) needs no user consent** — Edge restarts once visibly to add the CDP flag. This is a one-time event per PC session and fully automatic.
- **No caching by intent** — always attempt a fresh scrape first. Cached data is only used as automatic fallback when scraping fails.
- Edge only needs CDP activation once per PC session. After that, CDP stays active.
- Usage display is handled exclusively by the completion card (§Task Completion Signal) — not at session start.
- **Never use Claude in Chrome MCP tools** (navigate, read_page, computer, etc.) as a fallback for scraping usage data. The headless CDP script is the **only** allowed scraping method.
- **Silent execution**: This skill must produce zero visible browser activity (except the one-time --activate-cdp restart). If a visible browser window opens during auto-start, that's expected — Edge needs a window to function. But it should not steal focus from the user's current work.
