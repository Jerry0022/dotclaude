---
description: "Scrape live usage data from claude.ai/settings/usage via browser and save to usage-live.json. Run silently in the background."
---

Silently scrape the real Claude usage limits from the browser. Do this WITHOUT showing the browser to the user — work in background.

Steps:
1. Use `mcp__Claude_in_Chrome__tabs_context_mcp` with `createIfEmpty: true`
2. Use `mcp__Claude_in_Chrome__tabs_create_mcp` to create a new tab
3. Navigate to `https://claude.ai/settings/usage`
4. Wait 3 seconds for page load
5. Use `mcp__Claude_in_Chrome__get_page_text` to extract the page text
6. Parse the text using this logic (handles both German and English UI):

```
// Split by 'verwendet' or 'used' to get sections
const sections = text.split(/verwendet|used/);

// Extract pcts: after optional HH:MM, grab last 1-3 digits before ' %'
const pcts = [];
for (const s of sections.slice(0, -1)) {
  const m = s.match(/(?:\d{1,2}:\d{2})?(\d{1,3})\s*%\s*$/);
  if (m) pcts.push(parseInt(m[1]));
}
// pcts[0] = session, pcts[1] = weekly all, pcts[2] = weekly sonnet

// Session reset: 'Zurücksetzung in X Std. Y Min.' or 'Resets in X hr Y min'
const resetMatch = text.match(/(?:Zurücksetzung in|Resets? in)\s+(\d+)\s*(?:Std\.|hr)\.?\s*(\d+)?\s*(?:Min\.|min)?/);
const resetMinutes = resetMatch ? (parseInt(resetMatch[1]) || 0) * 60 + (parseInt(resetMatch[2]) || 0) : null;

// Weekly reset: after 'Alle Modelle' or 'All Models'
const weeklyMatch = text.match(/(?:Alle Modelle|All Models)\s*(?:Zurücksetzung|Reset)\s+(\w+)\.?,?\s*(\d{1,2}:\d{2})/);
```

7. Write the results as JSON to `~/.claude/scripts/usage-live.json`:
```json
{
  "timestamp": "<ISO 8601 now>",
  "session": { "pct": <pcts[0]>, "resetInMinutes": <resetMinutes> },
  "weekly": { "pct": <pcts[1]>, "resetDay": "<day>", "resetTime": "<HH:MM>" },
  "weeklySonnet": { "pct": <pcts[2]> },
  "plan": "Max Plan"
}
```

8. Close the tab with `mcp__Claude_in_Chrome__tabs_close_mcp`

IMPORTANT: Do NOT report anything to the user unless there's an error. Silent background operation.
IMPORTANT: If browser is not available or not logged in, silently skip — do not error out.
