# Task Completion Signal (Completion Card)

When a task is complete, **always** end with a completion card. This is the only place where emojis are always allowed. The signal must be consistent and recognizable across all sessions. Note: `<details>` tags do NOT render in Claude Code — use blockquotes for the details section instead.

## Variants Overview

| # | Scenario | Title icon | Status icon | Status text |
|---|---|---|---|---|
| 1 | Feature shipped via PR | ✅ | 🚀 | `Shipped · PR #N · Version X → Y (bump) · Tag vY` |
| 2 | Hotfix direct push | ✅ | 🚀 | `Shipped · Direct Push auf main · Version X → Y (bump) · Tag vY` |
| 3 | Implementierung fertig, nicht shipped | ✅ | 📦 | `Nicht shipped · Branch \`name\` — Soll ich shippen?` |
| 4 | Ship blockiert | ✅ | ⛔ | `Ship blockiert · <reason> — Soll ich fixen und erneut shippen?` |
| 5 | Config/Docs erledigt | ✅ Erledigt | 📦 | `Nicht shipped · Branch \`name\` — Soll ich shippen?` |
| 6 | Skill/Template-Änderung | ✅ Erledigt | 📦 | `Nicht shipped · Branch \`name\` — Soll ich shippen?` |
| 7 | Auto-Start nach Implementierung | 🧪 | — | Test Prompt Card (see test-prompt-card.md), then Completion Card |
| 8 | User-triggered App-Start | 🧪 | — | Test Prompt Card only (see test-prompt-card.md) |

## Format

```markdown
---

## ✅ <build-id> · <short summary, max ~10 words>

<conventional-commit-title>

**Changes**
* First major change — short description
* Second major change — short description

**Tests**
* What was tested — method and result

**Cleanup**
* Branch <name> gelöscht (lokal + remote)
* Main synced: <hash>

## <status-icon> <status-text>

🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym> | Weekly: <pct>% (+<delta>%) · Reset <Xd Yh> | Sonnet: <pct>% (+<delta>%)

---
```

## Title line

- **With build ID** (code changes that produced a testable state): `## ✅ a3f9b21 · Bank-Setup ins Dashboard verlagert`
- **Without build ID** (no testable state — docs, config, research): `## ✅ Erledigt · CLAUDE.md aktualisiert`
- Build ID via `node ~/.claude/scripts/build-id.js`.

## Status line (mandatory)

The status line is a `##` heading — same visual weight as the title. It always appears after all content sections, right before the usage line.

### Shipped

```markdown
## 🚀 Shipped · PR #30 · Version 0.5.5 → 0.6.0 (minor) · Tag v0.6.0
```

Fields (omit any that don't apply):
- `PR #N` — if shipped via PR. Omit for direct push.
- `Direct Push auf main` — if pushed directly without PR.
- `Version <old> → <new> (<bump>)` — if version was bumped.
- `Tag v<new>` — if a git tag was created.

### Nicht shipped

```markdown
## 📦 Nicht shipped · Branch `feature/dark-mode` — Soll ich shippen?
```

### Ship blockiert

```markdown
## ⛔ Ship blockiert · pytest failure in test_push_handler — Soll ich fixen und erneut shippen?
```

## Sections

### Changes (mandatory)
Bullet list (`*`) of what changed, grouped logically. Each bullet: component/area → what happened. Keep concise but specific enough to understand the scope.

### Tests (include when tests were run)
Bullet list of what was tested and how. Include: quality gate results, manual verification, preview screenshots taken. Omit section entirely if no tests were run (e.g. pure docs change).

### Cleanup (include when cleanup happened)
Branch deletion, worktree removal, main sync. Omit section entirely if no cleanup was needed.

## Usage line

Always the last line before the closing `---`.

- **Always** run `/refresh-usage` (no caching — always scrape live data) right before rendering the completion card.
- Read `usage-live.json` **before** the refresh to capture the previous state. After the refresh, read the new state. Compute the delta (`new_pct - old_pct`) for each metric.
- Format: `🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym> | Weekly: <pct>% (+<delta>%) · Reset <Xd Yh> | Sonnet: <pct>% (+<delta>%)`
- **Reset times**: Read `session.resetInMinutes` and `weekly.resetInMinutes` from `usage-live.json`. Format: `<24h` → `Xh Ym`, `>=24h` → `Xd Yh`. If a reset value is missing, omit the `· Reset ...` part for that metric.
- If the delta is 0, show `(+0%)`. If the previous file was missing (first refresh of the session), show `(+0%)` as well — never use `(—)` which looks like an error.
- If the refresh fails, show `🔋 [no data]` — do not block the completion card.
- This is the **only** place where usage is displayed — no session start display, no background refresh.
- **Raw data is internal only.** The before/after values from `/refresh-usage` must never appear in the visible response. Consume them silently to compute the delta — only the formatted `🔋` line is user-facing.
- **Never estimate or recall usage numbers.** Every value in the `🔋` line must come directly from the script's output — never from memory, interpolation, or earlier conversation context.

## Rules

- The completion card is **always** the last thing in the response — nothing after it. If additional context arises after composing the card (hook output, afterthoughts, caveats), place it **before** the card block, never after. The `---` closing line is the absolute end of the response.
- **No preamble** before the card. No "Hier die Completion Card:", no "Usage ist live:". The `---` opening line starts immediately.
- Use `##` heading for the title line — gives it visual weight and spacing.
- **Status line is also a `##` heading** — same visual prominence as the title. It is always present (shipped, not shipped, or blocked).
- Section headers (**Changes**, **Tests**, **Cleanup**) use bold text, not markdown headings.
- Bullet items use `*` prefix, plain text. No nested bullets.
- The summary and all section content is in the user's language (German), max ~10 words for the title summary.
- Keep it factual — no commentary, no praise, no filler.
