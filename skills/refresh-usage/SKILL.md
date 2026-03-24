---
description: Scrape live usage data from claude.ai/settings/usage via browser and save to usage-live.json. Run silently in the background.
---

# Refresh Usage Data

Scrapes live token usage from claude.ai via Edge CDP (Chrome DevTools Protocol).

## When to run

- **Automatically** at session start as a background agent, if `~/.claude/scripts/usage-live.json` is missing or older than 10 minutes.
- **Manually** when the user asks for fresh usage data.

## Steps

1. Check if `~/.claude/scripts/usage-live.json` exists and is less than 10 minutes old.
   - If fresh: skip, no refresh needed. Exit silently.

2. Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --check-only` to test if CDP is available.

3. **CDP available** (exit code 0):
   Run `node ~/.claude/scripts/refresh-usage-headless.js --quiet` to scrape in the background.
   - Exit code 0: success, done.
   - Exit code 2: not logged in — inform user: "Bitte bei claude.ai einloggen, dann /refresh-usage erneut."
   - Exit code 3/4: scrape failed — silently skip, will retry next session.

4. **CDP not available** (exit code 5):
   Ask the user via AskUserQuestion:
   - Label: "Edge CDP aktivieren"
   - Description: "Edge wird einmal sichtbar neu gestartet mit CDP-Port 9223. Danach läuft alles unsichtbar im Background."
   - Options: "Ja, Edge neu starten" / "Nein, überspringen"

   If approved: run `node ~/.claude/scripts/refresh-usage-headless.js --quiet --activate-cdp`
   If declined: skip silently.

## Important

- Never restart Edge without explicit user consent (AskUserQuestion).
- This skill runs as a **background agent** at session start — do not block the main conversation.
- The startup-summary.js hook reads the cached data — it never triggers a refresh itself.
- Edge only needs to be restarted once per PC session. After that, CDP stays active.
