---
name: completion-card
description: Master template for task completion cards — all variants derive from this single source.
version: 0.7.0
used-by: ship, test, start, commit, review, research, and any skill/agent that completes work
---

# Completion Card — Master Template

The completion card is the **last thing** in every response that completes a task.
No text after the closing `---`. No preamble before the opening `---`.

---

## Master Structure

Every card follows the same three-block layout. Blocks are never reordered.
Sections within a block may be omitted per variant rules — but the block order is fixed.

```
┌─────────────────────────────────────────────────────┐
│  BLOCK A — What was done                            │
│  Title · Usage · Changes · Tests                    │
├─────────────────────────────────────────────────────┤
│  BLOCK B — End state                                │
│  State (one-liner)                                  │
├─────────────────────────────────────────────────────┤
│  BLOCK C — What happens now                         │
│  User test · CTA (one-liner)                        │
├─────────────────────────────────────────────────────┘
```

---

## Rendered Template

All variables in `{{...}}`. Sections wrapped in `{{#if}}` are conditional per variant.

```markdown
{{#if usage}}
```
5h  {{bar-5h}}  {{pct-5h}} ({{delta-5h}})  · Reset {{reset-5h}}{{pace-warn-5h}}
    {{elapsed-arrow-5h}}

Wk  {{bar-wk}}  {{pct-wk}} ({{delta-wk}})  · Reset {{reset-wk}}{{pace-warn-wk}}
    {{elapsed-arrow-wk}}
```
{{else}}
```
⚠ Usage data unavailable — monitoring issue
```
{{/if}}

---

## ✨✨✨ {{summary}} · {{build-id}} ✨✨✨

{{#if changes}}
**Changes**
* {{max 3: area → description}}
{{/if}}

{{#if tests}}
**Tests**
* {{max 3: method → result}}
{{/if}}

{{state-icon}} {{state-text}}

{{#if user-test}}
**Please test**
1. {{each: test-step}}
{{/if}}

## {{cta-icon}} {{cta-text}}

---
```

---

## Block A — What was done

### Title line

`## ✨✨✨ {{summary}} · {{build-id}} ✨✨✨`

- `✨✨✨` before and after — "done, look here".
- Summary first — the important part. Build-ID after as reference.
- Summary in user's language, max ~10 words, factual.
- Build-ID via `node scripts/build-id.js` (7-char hash). **Always include** — even for docs/config.

| Condition | Example |
|-----------|---------|
| Code changes | `## ✨✨✨ Filter dialog moved to settings · a3f9b21 ✨✨✨` |
| No code changes | `## ✨✨✨ README updated · a3f9b21 ✨✨✨` |

### Usage meter

Directly under the title. Two ASCII bars with elapsed-time arrow, in a code block.
If `usage-live.json` is missing: show error message instead of bars.

**Example rendering:**

```
5h  ▓▓▓▓▓▓▓▓░░░░   67% (+1%   )  · Reset 1h 42m
          ↑

Wk  ▓▓▓░░░░░░░░░   25% (+8% !!)  · Reset 4d 11h  ⚠ Sonnet or new session
        ↑
```

**Error rendering (no data):**

```
⚠ Usage data unavailable — monitoring issue
```

- `↑` sits directly below the bar position of elapsed time.
- No text, no label — just the arrow.
- Arrow right of filled area = under budget, left = over budget.

**Bar rendering:**

```
total_blocks = 12
filled       = round(usage_pct / 100 * total_blocks)
empty        = total_blocks - filled
bar          = "▓" × filled + "░" × empty
```

**Elapsed-time arrow:**

```
elapsed_pct (5h):  (300 - reset_minutes) / 300 * 100
elapsed_pct (Wk):  (10080 - reset_minutes) / 10080 * 100

arrow_pos = round(elapsed_pct / 100 * 12)
arrow_line = " " × (4 + arrow_pos) + "↑"
```

- `4` = offset for label + gap ("5h  ").
- Arrow line directly below bar line. Blank line only after the arrow, before next window.

**Delta display rules:**

Only show the delta parenthetical when a previous `usage-live.json` snapshot exists **and** is less than 8 hours old. If no previous snapshot exists or it is stale (>8h), omit the parenthetical entirely — pad with 8 spaces to preserve column alignment.

When shown, delta uses color coding (marker suffix in code block):

| Delta | Marker | Example |
|-------|--------|---------|
| +0 – 1% | no marker | `(+1%   )` |
| +2 – 5% | `!` suffix | `(+4% ! )` |
| +6%+ | `!!` suffix | `(+8% !!)` |

Delta field is always 8 characters wide: `(+N% XX)`, right-padded with spaces inside.
When omitted, 8 spaces are used instead to keep `· Reset` aligned.

**Implementation:** Pass `delta5h: null` / `deltaWk: null` in the render-card input JSON when no valid previous snapshot is available. The renderer will omit the parenthetical and pad for alignment.

**Pace comparison (usage vs. elapsed time):**

```
pace_delta = usage_pct - elapsed_pct
```

| pace_delta | Display |
|------------|---------|
| ≤ +10pp | _(nothing)_ |
| > +10pp | `  ⚠ Sonnet or new session` at end of affected line |

- Evaluated per window individually (5h, Wk, or both).
- Never suggest reducing skills/agents — model switch is the lever (Opus → Sonnet).
- Data source: `usage-live.json` (via `/refresh-usage` before rendering).

**Column alignment:**

All columns fixed width so `· Reset` aligns in both lines.

```
Column       Width    Content
──────────   ──────   ──────────────────────────
Label         3 chr   "5h " / "Wk "
Gap           1 chr   " "
Bar          12 chr   ▓▓▓░░░ (always 12)
Gap           3 chr   "   "
Pct           3 chr   right-aligned, space-padded
Pct-suffix    1 chr   "%"
Space         1 chr   " "
Delta         8 chr   "(+N% XX)"
Gap           2 chr   "  "
Separator     2 chr   "· "
Reset-label   6 chr   "Reset "
Reset-value   var.    "1h 42m" / "4d 11h"
Warn          var.    "  ⚠ Sonnet or new session" or empty
```

- Fixed total width up to delta: **35 characters** → `· Reset` aligns.

| Variants | Behavior |
|----------|----------|
| shipped, ready, test, blocked, research, aborted, fallback | **Show** |
| minimal-start | **Omit** |

### Changes

Bullet list (`*`), each bullet: `area → what happened`.
**Max 3 bullets.** Summarize if more than 3 changes. No nested bullets.

| Variants | Behavior |
|----------|----------|
| shipped, ready, test, blocked | **Required** |
| research, fallback | **Required** — describes what was investigated/answered |
| minimal-start | **Omit** |
| aborted | **Optional** — only if work happened before abort |

### Tests

Bullet list: what was tested, method and result.
**Max 3 bullets.** Summarize if more than 3 tests ran.

| Variants | Behavior |
|----------|----------|
| shipped, ready, test | **If tests/builds ran** — otherwise omit |
| research, minimal-start, aborted, fallback | **Omit** |

---

## Block B — End state

### State

One-liner, no section header. Directly after Changes/Tests.

`{{state-icon}} {{state-text}}`

**Schema — all fields always present:**

Every state line contains the same fields in the same order.
Fields that don't apply are shown with explicit negative values.

```
{{state-icon}} {{branch}} · {{commit}} · {{push}} · {{pr}} · {{merge}}
```

| Field | Positive | Negative |
|-------|----------|----------|
| branch | `feat/xyz` or `feat/xyz (worktree)` | `main` (no feature branch) |
| commit | `abc1234` (committed hash) | `uncommitted` |
| push | `pushed` | `not pushed` |
| pr | `PR #N "Title"` | `no PR` |
| merge | `merged → remote/main` | `not merged` |

**Examples — all states:**

| State | One-liner |
|-------|-----------|
| Fresh, nothing committed | 🔀 `feat/xyz` · uncommitted · not pushed · no PR · not merged |
| Committed, not pushed | 🔀 `feat/xyz` · abc1234 · not pushed · no PR · not merged |
| Pushed, no PR | 🔀 `feat/xyz` · abc1234 · pushed · no PR · not merged |
| PR open | 🔀 `feat/xyz` · abc1234 · pushed · PR #42 "Filter refactor" · not merged |
| Merged via PR | ✅ `feat/xyz` · abc1234 · pushed · PR #42 "Filter refactor" · merged → remote/main |
| Direct push | ✅ `main` · abc1234 · pushed · no PR · remote/main |
| Worktree, not pushed | 🔀 `feat/xyz` (worktree) · abc1234 · not pushed · no PR · not merged |
| Worktree, PR open | 🔀 `feat/xyz` (worktree) · abc1234 · pushed · PR #42 "Filter refactor" · not merged |
| App running (after edits) | 🟢 `feat/xyz` · abc1234 · not pushed · no PR · not merged · app running |
| App needs start | 🟡 `feat/xyz` · abc1234 · not pushed · no PR · not merged · app not started |
| No changes | ➖ No changes to repo |

**State icons:**

| Icon | Meaning |
|------|---------|
| ✅ | Final — on remote/main, all done |
| 🔀 | In progress — branch/worktree, not on main yet |
| 🟢 | App running — user must test |
| 🟡 | App not started — user must start |
| ➖ | Neutral — nothing happened |

| Variants | Behavior |
|----------|----------|
| shipped, ready, test, blocked | **Required** |
| research | Shows `➖ No changes to repo` |
| minimal-start | **Omit** |
| aborted, fallback | **Dependent** — show what exists |

---

## Block C — What happens now

### User test

Numbered steps the user must perform manually.

| Variants | Behavior |
|----------|----------|
| test | **Required** |
| all others | **Omit** |

### CTA (Call to Action)

One-liner as `##` heading.

Format: `## {icon} {STATUS}. {short-info} — {sentence with VERB}`

- Status word: always English, always UPPERCASE.
- Short-info: factual context (version, reason, etc.).
- CTA sentence after `—`: translated to user's language. Action verb UPPERCASE.

**CTA definitions (EN master):**

| # | Variant | CTA |
|---|---------|-----|
| 1 | shipped (with bump) | `## 🚀 SHIPPED. {{vOld}} → {{vNew}} ({{bump}}) — RELAX, all done` |
| 1 | shipped (no bump) | `## 🚀 SHIPPED. {{version}} — RELAX, all done` |
| 2 | ready | `## 📦 READY. {{info}} — SHIP or CHANGE?` |
| 3 | blocked | `## ⛔ BLOCKED. {{reason}} — FIX or SKIP?` |
| 4 | test | `## 🧪 DONE. {{info}} — SHIP after your TEST?` |
| 5 | minimal-start | `## 🧪 STARTED. {{user-facing-description}} — HAVE FUN` |
| 6 | research | `## 📋 DONE. {{info}} — READ through` |
| 7 | aborted | `## 🚫 ABORTED. {{reason}} — What should I TRY?` |
| 8 | fallback | `## 📋 DONE — Anything ELSE?` |

**CTA translations (DE):**

| # | Variant | CTA |
|---|---------|-----|
| 1 | shipped (with bump) | `## 🚀 SHIPPED. {{vOld}} → {{vNew}} ({{bump}}) — LEHN dich zurueck, alles erledigt` |
| 1 | shipped (no bump) | `## 🚀 SHIPPED. {{version}} — LEHN dich zurueck, alles erledigt` |
| 2 | ready | `## 📦 READY. {{info}} — SHIP oder AENDERN?` |
| 3 | blocked | `## ⛔ BLOCKED. {{reason}} — FIX oder SKIP?` |
| 4 | test | `## 🧪 DONE. {{info}} — SHIP nach deinem TEST?` |
| 5 | minimal-start | `## 🧪 STARTED. {{user-facing-description}} — VIEL SPASS` |
| 6 | research | `## 📋 DONE. {{info}} — LIES dir durch` |
| 7 | aborted | `## 🚫 ABORTED. {{reason}} — Was soll ich VERSUCHEN?` |
| 8 | fallback | `## 📋 DONE — Noch was ANDERES?` |

---

## Variant Table

| # | Variant | CTA-Icon | Changes | Tests | User-Test | State | Usage |
|---|---------|---------|---------|-------|-----------|-------|-------|
| 1 | shipped | 🚀 | yes | yes | — | final | yes |
| 2 | ready | 📦 | yes | if ran | — | branch | yes |
| 3 | blocked | ⛔ | yes | if ran | — | branch | yes |
| 4 | test | 🧪 | yes | if ran | yes | app-status | yes |
| 5 | minimal-start | 🧪 | — | — | — | — | — |
| 6 | research | 📋 | yes | — | — | none | yes |
| 7 | aborted | 🚫 | opt. | — | — | dep. | yes |
| 8 | **fallback** | 📋 | yes | — | — | dep. | yes |

- **shipped (1)**: PR vs. direct push → state line shows the difference.
- **test (4)**: App running vs. needs start → state line shows the difference.

### CTA Icons

| Icon | Meaning | Variants |
|------|---------|----------|
| 🚀 | Delivered — all done | shipped |
| 📦 | Ready — user decides next step | ready |
| 🧪 | Test — user must verify | test, minimal-start |
| ⛔ | Blocked — needs fix | blocked |
| 🚫 | Aborted — not feasible | aborted |
| 📋 | Info — purely informational | research, fallback |

### Variant Selection Rules

```
if   ship succeeded                 → shipped (1)
elif build/gate/merge failed        → blocked (3)
elif task aborted or not feasible   → aborted (7)
elif code edits + app relevant      → test (4)
elif app started, no code edits     → minimal-start (5)
elif code/doc changes, no app       → ready (2)
elif research/review/explanation    → research (6)
else                                → fallback (8)
```

---

## Rules

1. Completion card is **always the last thing** in the response. Nothing after closing `---`.
2. **No preamble.** The opening `---` starts immediately.
3. Section headers use **bold** (`**Changes**`), not markdown headings.
4. CTA line uses `##` heading for visual weight.
5. Title icon (`✨✨✨`) is fixed — variant is distinguished via CTA icon.
6. Bullet items use `*`, plain text. Max 3 per section.
7. Content in user's language. Status words (SHIPPED, READY, etc.) stay English.
8. Factual — no commentary, praise, or filler.
9. Omit sections that don't apply (don't render empty).
10. Usage meter always in code block, never as plain text.
11. If `usage-live.json` is missing: show `⚠ Usage data unavailable — monitoring issue`.
12. Build-ID always included — even for pure docs/config changes.
13. State line always with all fields (branch, commit, push, PR, merge).
14. Minimal-start `{{user-facing-description}}`: Prefer user-facing descriptions ("Website opens in Edge", "Window appears") over technical details ("Dev server on :3000"). Fall back to technical only when no user-visible outcome exists.
