---
name: completion-card
description: Standardized task completion signal rendered at the end of every completed task.
version: 0.1.0
used-by: ship, test, start, commit, and any skill/agent that completes work
---

# Completion Card Template

The completion card is the **last thing** in every response that completes a task.
No text after the closing `---`. No preamble before the opening `---`.

## Structure

```markdown
---

## ✅ <build-id> · <summary, max ~10 words>

**Changes**
* <what changed — component/area → description>

**Tests**
* <what was tested — method and result>

**Bitte testen**                         ← only in Test variants (6a/6b)
1. <step-by-step test instructions>

**Branch**
* `<branch-name>` → <status>
* Main synced: <hash>                    ← only after ship

## <status-icon> <status-text>

🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym>
🔋 Wk: <pct>% (+<delta>%) · Reset <Xd Yh>
<optional: burn-rate hint>

---
```

## Sections

### Title line

- **With build-ID** (code changes): `## ✅ a3f9b21 · Filter-Dialog ins Settings verlegt`
- **Without build-ID** (docs, config): `## ✅ Erledigt · README aktualisiert`
- Build-ID via `node scripts/build-id.js` (content hash over source files).
- Summary in user's language, max ~10 words, factual.

### Changes (mandatory)

Bullet list (`*`) of what changed. Each bullet: area → what happened.
Keep concise but specific. No nested bullets.

### Tests (include when tests/builds were run)

Bullet list of what was tested. Include: build result, preview verification,
quality gate outcomes. Omit section entirely for pure docs changes.

### Bitte testen (only for Test variants 6a/6b)

Numbered list of specific test steps the user should perform.
Only include when the user needs to manually verify before shipping.

### Branch (include when branch exists)

- Branch name with status (pushed, deleted, not pushed)
- Main sync hash after successful ship
- Omit for direct-push or no-branch scenarios

### Status line (mandatory)

Always a `##` heading. Action verbs are CAPITALIZED for attention.

| # | Variant | Status line |
|---|---|---|
| 1 | Shipped via PR | `## 🚀 Shipped · PR #N · vOLD → vNEW (bump)` |
| 2 | Shipped direct | `## 🚀 Shipped · Direct Push · vOLD → vNEW (bump)` |
| 3 | Ready (code) | `## 📦 Ready — Soll ich SHIPPEN?` |
| 4 | Blocked | `## ⛔ Blocked · <reason> — Soll ich FIXEN?` |
| 5 | Erledigt (no-code) | `## 📦 Ready — Soll ich SHIPPEN?` |
| 6a | Test (app running) | `## 🧪 App gestartet — Bitte TESTEN — Soll ich nach Test SHIPPEN?` |
| 6b | Test (app not running) | `## 🧪 Bitte App STARTEN und TESTEN — Soll ich nach Test SHIPPEN?` |
| 7 | App gestartet (minimal) | `## 🧪 <build-id> · App gestartet` |

**Variant selection rules:**
- Shipped (1/2): after successful PR merge or direct push
- Ready (3/5): implementation complete, user decides to ship
- Blocked (4): quality gate, build, or merge failed
- Test (6a): app was started by AI after code changes, user should verify
- Test (6b): app needs to be started by user (e.g., mobile, specific env)
- Use 6a/6b whenever the change is user-visible and testable
- Minimal start (7): user explicitly requested app start, no code changes in session. No Changes/Tests/Branch sections. No Usage line. Just build-ID and "App gestartet".

### Usage line (mandatory)

Two lines, one per window. Uses battery emoji as status indicator.

```
🔋 5h: <pct>% (+<delta>%) · Reset <Xh Ym>
🔋 Wk: <pct>% (+<delta>%) · Reset <Xd Yh>
```

**Burn-rate analysis:**

```
burn_ratio = token_pct / elapsed_pct

elapsed_pct (5h window):
  = (300 - reset_minutes) / 300 * 100

elapsed_pct (weekly window):
  = (10080 - reset_minutes) / 10080 * 100
```

| Burn ratio | Battery | Hint |
|---|---|---|
| < 0.5 | 🔋 | `Viel Spielraum — du könntest intensiver arbeiten` |
| 0.5 – 1.3 | 🔋 | _(no hint — everything normal)_ |
| > 1.3 | 🪫 | `Hoher Verbrauch — neue Session oder Haiku empfohlen` |

- Hints only at extremes. Normal = no comment.
- Hint appears as third line below the two battery lines.
- Never suggest reducing skills/agents — suggest session restart or model switch.
- Data source: `usage-live.json` (refreshed via `/refresh-usage` before rendering).
- Delta = current_pct - previous_pct. If no previous data: `(+0%)`.

## Rules

- Completion card is **always the last thing** in the response. Nothing after closing `---`.
- **No preamble.** The opening `---` starts immediately, no "Hier die Card:".
- Section headers use **bold** (`**Changes**`), not markdown headings.
- Status line uses `##` heading for visual weight.
- Bullet items use `*`, plain text.
- Content in user's language (German for Jerry0022).
- Keep factual — no commentary, praise, or filler.
- Omit sections that don't apply (e.g., no Tests section for pure docs).
