# Task Completion Signal (Completion Card)

When a task is complete, **always** end with a completion card. This is the only place where emojis are always allowed. The signal must be consistent and recognizable across all sessions. Note: `<details>` tags do NOT render in Claude Code — use blockquotes for the details section instead.

**Format:**
```markdown
---

## ✨ <build-id> · <short summary, max ~10 words>

<status> auf remote `<branch>` via <ship method>
\
First change or action
Second change or action

file1 — what changed
file2 — what changed

🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym> | Weekly: <pct>% (+<delta>%) · Reset <Xd Yh> | Sonnet: <pct>% (+<delta>%)

---
```

**Title line logic:**
- **With build ID** (code changes that produced a testable state): `## ✨ a3f9b21 · Filter UI implementiert`
- **Without build ID** (no testable state — docs, config, research): `## ✨ Erledigt · CLAUDE.md aktualisiert`

**Status line variants:**
- **Shipped** — work is merged and live. Format: `Shipped auf remote <branch> via <method>`.
- **Nicht shipped** — work is done but not shipped. Append: "Soll ich shippen?" (or ship automatically per §Completion Flow rules).
- **Ship blockiert** — done but ship failed (tests, merge conflict, etc.). Explain why.
- **Erledigt** — for tasks without code changes (config, research, explanation). Omit status line.

**Ship methods:** `direct push` (pushed without PR), `Pull-Request-Merge (PR #N)` (merged via PR).

**Usage line (always last line before closing `---`):**
- **Always** run `/refresh-usage` (no caching — always scrape live data) right before rendering the completion card.
- Read `usage-live.json` **before** the refresh to capture the previous state. After the refresh, read the new state. Compute the delta (`new_pct - old_pct`) for each metric.
- Format: `🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym> | Weekly: <pct>% (+<delta>%) · Reset <Xd Yh> | Sonnet: <pct>% (+<delta>%)`
- **Reset times**: Read `session.resetInMinutes` and `weekly.resetInMinutes` from `usage-live.json`. Format: `<24h` → `Xh Ym`, `>=24h` → `Xd Yh`. If a reset value is missing, omit the `· Reset ...` part for that metric.
- If the delta is 0, show `(+0%)`. If the previous file was missing (first refresh of the session), show `(+0%)` as well — never use `(—)` which looks like an error.
- If the refresh fails, show `🔋 [no data]` — do not block the completion card.
- This is the **only** place where usage is displayed — no session start display, no background refresh.
- **Raw data is internal only.** The before/after values from `/refresh-usage` (e.g., "Previous: 5h 11%... New: 5h 13%...") must never appear in the visible response. Consume them silently to compute the delta — only the formatted `🔋` line is user-facing.
- **Never estimate or recall usage numbers.** Every value in the `🔋` line must come directly from the script's output — never from memory, interpolation, or earlier conversation context. If the script cannot run and no cached data exists, show `🔋 [no data]`.

**Rules:**
- The completion card is **always** the last thing in the response — nothing after it. If additional context arises after composing the card (hook output, afterthoughts, caveats), place it **before** the card block, never after. The `---` closing line is the absolute end of the response.
- Use `##` heading for the title line — gives it visual weight and spacing.
- Use a backslash `\` on its own line after the status line to force a visual break before the plain-text details (blank lines alone get swallowed by the renderer).
- The summary is in the user's language (German), max ~10 words.
- Branch info is omitted for branchless tasks.
- Plain text (no bold, no inline code, no bullet markers) for actions and files — this renders in the terminal's default gray, visually subdued compared to the bold title and status line. Actions first, then files below (separated by a blank line). The usage line comes after files (or after actions if no files). End the entire card with a `---` line at the very bottom. For non-code tasks, omit the files section but still show the usage line.
- Keep it factual — no commentary or praise.
