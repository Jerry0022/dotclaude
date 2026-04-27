---
name: completion-card
description: Master template for task completion cards — all variants derive from this single source.
version: 0.9.0
used-by: ship, test, start, commit, review, analysis, and any skill/agent that completes work
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
│  Title · Changes · Tests · State · User test        │
├─────────────────────────────────────────────────────┤
│  BLOCK B — Usage + Context health                   │
│  Health warning · Usage meter                       │
├─────────────────────────────────────────────────────┤
│  BLOCK C — Footer + CTA                             │
│  📌 Version + Build-ID · CTA (one-liner)            │
├─────────────────────────────────────────────────────┘
```

---

## Rendered Template

All variables in `{{...}}`. Sections wrapped in `{{#if}}` are conditional per variant.

```markdown
---

## ✨✨✨ {{summary}} ✨✨✨

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

{{#if user-final-test}}
🧑 **TESTE bitte noch:**
* {{each: action}}{{#if afterDeployment}} — nach Deployment{{/if}}
{{/if}}

{{#if usage}}
{{context-health-line}}

```
5h  {{bar-5h}}  {{pct-5h}}{{delta-5h}}  · {{reset-5h}} left{{pace-warn-5h}}

Wk  {{bar-wk}}  {{pct-wk}}{{delta-wk}}  · {{reset-wk}} left{{pace-warn-wk}}
```
{{/if}}

---

📌 {{version-bump-info}} · {{build-id}}

## {{cta-icon}} {{cta-text}}

---
```

---

## Block A — What was done

### Title line

`## ✨✨✨ {{summary}} ✨✨✨`

- `✨✨✨` before and after — "done, look here".
- Summary only — no build-ID (moved to footer line).
- Summary in user's language, max ~10 words, factual.

| Condition | Example |
|-----------|---------|
| Code changes | `## ✨✨✨ Filter dialog moved to settings ✨✨✨` |
| No code changes | `## ✨✨✨ README updated ✨✨✨` |

### Usage meter

Directly under the title. Two usage bars with inline elapsed-time marker, in a code block.
If `usage-live.json` is missing: show error message instead of bars.

**Example rendering:**

```
5h  ━━━━━━━━━╏────   67%  +1%  · 1h 42m left
Wk  ━━━━╇━━━──────   60%  +8% !!  · 4d 11h left  ⚠ Pace!
```

**Error rendering (no data):**

```
⚠ Usage data unavailable
```

**Bar rendering:**

```
total_blocks = 14
filled       = round(usage_pct / 100 * total_blocks)
elapsed_pos  = round(elapsed_pct / 100 * total_blocks)
```

Each position in the 14-character bar is one of:
- `━` (heavy horizontal) — used area
- `─` (light horizontal) — free area
- `╇` (heavy + marker) — elapsed position within the used (filled) area
- `╏` (light + marker) — elapsed position within the free (empty) area

The elapsed marker replaces the character at `elapsed_pos` regardless of fill. No separate arrow line is used.

**Elapsed-time calculation:**

```
elapsed_pct (5h):  (300 - reset_minutes) / 300 * 100
elapsed_pct (Wk):  (10080 - reset_minutes) / 10080 * 100
```

**Delta display rules:**

Only show the delta when a previous `usage-live.json` snapshot exists **and** is within the current reset window. If no previous snapshot exists or it is outside the current reset window, omit the delta entirely — no padding.

Delta format: `+N%` optionally followed by a severity marker:

| Threshold | Marker | Example |
|-----------|--------|---------|
| delta < 2pp | _(none)_ | `+1%` |
| delta ≥ 2pp | `!` | `+3% !` |
| delta ≥ 6pp | `!!` | `+8% !!` |

**Implementation:** Pass `delta5h: null` / `deltaWk: null` in the render-card input JSON when no valid previous snapshot is available. The renderer will omit the delta field entirely.

**Pace comparison (usage vs. elapsed time):**

```
pace_delta = usage_pct - elapsed_pct
```

| pace_delta | Display |
|------------|---------|
| ≤ +10pp | _(nothing)_ |
| > +10pp | `  ⚠ Pace!` at end of affected line |

- Evaluated per window individually (5h, Wk, or both).
- Data source: `usage-live.json` (via `/devops-refresh-usage` before rendering).

**Column alignment:**

```
Column       Width    Content
──────────   ──────   ──────────────────────────
Label         2 chr   "5h" / "Wk"
Gap           2 chr   "  "
Bar          14 chr   ━━━╇── (always 14)
Gap           2 chr   "  "
Pct           3 chr   right-aligned, space-padded
Pct-suffix    1 chr   "%"
Delta         var.    "  +N%" / "  +N% !" / "  +N% !!" — omitted when null
Gap           2 chr   "  "
Separator     2 chr   "· "
Reset-value   var.    "1h 42m" / "4d 11h"
Reset-suffix  5 chr   " left"
Warn          var.    "  ⚠ Pace!" or empty
```

- `· {reset} left` aligns when delta is present; when delta is absent the `·` shifts left.

| Variants | Behavior |
|----------|----------|
| ship-successful, ready, test, ship-blocked, analysis, aborted, fallback | **Show** |
| test-minimal | **Omit** |

### Changes

Bullet list (`*`), each bullet: `area → what happened`.
**Max 3 bullets.** Summarize if more than 3 changes. No nested bullets.

**Both `area` AND description must be functional.** Keep the `area → description`
pattern — it's the strength of this section. But both halves describe what the
user perceives or what behaves differently, not how the code is structured.
Use technical wording only when the topic itself is genuinely technical (a
build flag, a parser bug, a protocol detail) — never as a default.

- ✅ `Completion card → Changes-Bullets sind jetzt funktional formuliert`
- ✅ `Branch cleanup → fragt vor dem Entfernen eines Worktrees nach`
- ✅ `Ship pipeline → versionsbump überspringt unveränderte Plugins`
- ❌ `mcp-server/index.js → renderChanges() angepasst`
- ❌ `templates, schema → Beschreibung erweitert`

**File names only when the file is the artifact itself.** A skill, a keybindings
file, a settings.json entry, a CLAUDE.md, a hook script — these *are* the
deliverable, so naming them is the functional description. Implementation files
(renderers, helpers, internal modules) are not.

- ✅ `keybindings.json → Ctrl+S auf Submit umgemappt` (file = deliverable)
- ✅ `Skill devops-ship → Pre-flight prüft jetzt branch protection` (skill = deliverable)
- ❌ `lib/card-guard.js → neue Validierung hinzugefügt` (internal module)

**Purely technical topic = technical wording is fine.** If the change really is
about a parser, a flag, a protocol, a perf fix — describe it as such. The rule
is "default to functional", not "forbid technical".

- ✅ `JSON parser → akzeptiert jetzt trailing commas`
- ✅ `Build cache → invalidiert bei plugin.json-Änderung`

**`area`** is the functional surface (what the user perceives or what the change
is *about*), e.g. `Completion card`, `Ship pipeline`, `Branch cleanup`,
`Skill devops-flow`. Not a file path, not an internal module name.

| Variants | Behavior |
|----------|----------|
| ship-successful, ready, test, ship-blocked | **Required** |
| analysis, fallback | **Required** — describes what was investigated/planned/answered |
| test-minimal | **Omit** |
| aborted | **Optional** — only if work happened before abort |

### Tests

Bullet list: what was tested, method and result.
**Max 3 bullets.** Summarize if more than 3 tests ran.

| Variants | Behavior |
|----------|----------|
| ship-successful, ready, test, ship-blocked | **If tests/builds ran** — otherwise omit |
| analysis, test-minimal, aborted, fallback | **Omit** |

---

## Block B — End state

### State

One-liner, no section header. Directly after Changes/Tests.

`{{state-icon}} {{state-text}}`

**Schema — all fields always present, most important first:**

Every state line contains the same fields in the same order.
Fields that don't apply are shown with explicit negative values.

```
{{state-icon}} {{merge}} · {{pr}} · {{push}} · {{commit}} · {{branch}}
```

Elements are linked to their GitHub page when the repo URL can be resolved:
- commit hash → `[abc1234](https://github.com/owner/repo/commit/abc1234)`
- branch → [`feat/xyz`](https://github.com/owner/repo/tree/feat/xyz)
- PR → [PR #N "Title"](https://github.com/owner/repo/pull/N)
- merge target → [origin/main](https://github.com/owner/repo/tree/main)

Falls back to plain text when no GitHub remote is detected.

| Field | Positive | Negative |
|-------|----------|----------|
| merge | `merged → [origin/main](…/tree/main)` | `not merged` |
| pr | `[PR #N "Title"](…/pull/N)` | `no PR` |
| push | `pushed` | `not pushed` |
| commit | `[abc1234](…/commit/abc1234)` | `uncommitted` |
| branch | [`feat/xyz`](…/tree/feat/xyz) or [`feat/xyz (worktree)`](…/tree/feat/xyz) | [`main`](…/tree/main) |

**Examples — all states:**

| State | One-liner |
|-------|-----------|
| Fresh, nothing committed | 🔀 not merged · no PR · not pushed · uncommitted · [`feat/xyz`](…/tree/feat/xyz) |
| Committed, not pushed | 🔀 not merged · no PR · not pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) |
| Pushed, no PR | 🔀 not merged · no PR · pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) |
| PR open | 🔀 not merged · [PR #42 "Filter refactor"](…/pull/42) · pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) |
| Merged via PR | ✅ merged → [origin/main](…/tree/main) · [PR #42 "Filter refactor"](…/pull/42) · pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) |
| Direct push | ✅ merged → [origin/main](…/tree/main) · no PR · pushed · [abc1234](…/commit/abc1234) · [`main`](…/tree/main) |
| Worktree, not pushed | 🔀 not merged · no PR · not pushed · [abc1234](…/commit/abc1234) · [`feat/xyz (worktree)`](…/tree/feat/xyz) |
| Worktree, PR open | 🔀 not merged · [PR #42 "Filter refactor"](…/pull/42) · pushed · [abc1234](…/commit/abc1234) · [`feat/xyz (worktree)`](…/tree/feat/xyz) |
| App running (after edits) | 🟢 not merged · no PR · not pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) · app running |
| App needs start | 🟡 not merged · no PR · not pushed · [abc1234](…/commit/abc1234) · [`feat/xyz`](…/tree/feat/xyz) · app not started |
| No changes | ➖ No changes to repo |

**State icons:**

| Icon | Meaning |
|------|---------|
| ✅ | Final — on origin/main, all done |
| 🔀 | In progress — branch/worktree, not on main yet |
| 🟢 | App running — user must test |
| 🟡 | App not started — user must start |
| ➖ | Neutral — nothing happened |

| Variants | Behavior |
|----------|----------|
| ship-successful, ready, test, ship-blocked | **Required** |
| analysis | Shows `➖ No changes to repo` |
| test-minimal | **Omit** |
| aborted, fallback | **Dependent** — show what exists |

---

## Block C — What happens now

### User test

Numbered steps the user must perform manually.

| Variants | Behavior |
|----------|----------|
| test | **Required** |
| all others | **Omit** |

### User-final-test

Flags work that **cannot be automated** — even when automated tests pass. Two
sources (see `deep-knowledge/test-strategy.md` § Electron / Native UI and
§ Third-Party Integrations):

- **Packaged Electron/Tauri without desktop takeover** → a final check on the
  real app that only the user can click through.
- **Third-party integrations** (OAuth, payments, webhooks, external APIs) → mocks
  covered the shape, but real endpoints need real credentials in a deployed env.

Wording is identical across both cases — only the `— nach Deployment` / `— after
deployment` suffix distinguishes the 3rd-party case:

```
🧑 **TESTE bitte noch:**
* Electron-App öffnen → Settings-Dialog testen
* Login mit Google in Prod-Umgebung testen — nach Deployment
```

```
🧑 **Please TEST:**
* Open Electron app → test Settings dialog
* Test Google login in prod environment — after deployment
```

**Input contract:** `userFinalTest` is an array; each item is either a plain
string (no deployment suffix) or `{ action: string, afterDeployment: true }`.
The header is always rendered once; the suffix is attached per bullet.

| Variants | Behavior |
|----------|----------|
| ship-successful, ready, ship-blocked, test, analysis, aborted, fallback | **If QA flagged one** — otherwise omit |
| test-minimal | **Omit** (session greeting, no QA context) |

Rendered between state/user-test and the usage meter so it sits in Block A's
"what you still need to do" region, not buried in CTA.

### CTA (Call to Action)

One-liner as `##` heading.

Format: `## {icon} {STATUS}. {context} — {sentence with VERB}`

- Status word: always English, always UPPERCASE.
- Context: merge target (shipped), reason (blocked/aborted), or empty. **No version info** — version is in the footer line.
- CTA sentence after `—`: translated to user's language. Action verb UPPERCASE.

**CTA definitions (EN master):**

| # | Variant | CTA |
|---|---------|-----|
| 1 | ship-successful (merged) | `## 🚀 SHIPPED. merged → {{merged}} — RELAX, all done` |
| 1 | ship-successful (plain) | `## 🚀 SHIPPED — RELAX, all done` |
| 2 | ready | `## 📦 READY — SHIP or CHANGE?` |
| 3 | ship-blocked | `## ⛔ BLOCKED. {{reason}} — FIX or SKIP?` |
| 4 | test | `## 🧪 DONE — SHIP after your TEST?` |
| 5 | test-minimal | `## ▶️ STARTED. {{user-facing-description}} — HAVE FUN` |
| 6 | analysis | `## 📋 DONE — READ through` |
| 7 | aborted | `## 🚫 ABORTED. {{reason}} — What should I TRY?` |
| 8 | fallback | `## 🔧 DONE — Anything ELSE?` |

**CTA translations (DE):**

| # | Variant | CTA |
|---|---------|-----|
| 1 | ship-successful (merged) | `## 🚀 SHIPPED. merged → {{merged}} — LEHN dich zurück, alles erledigt` |
| 1 | ship-successful (plain) | `## 🚀 SHIPPED — LEHN dich zurück, alles erledigt` |
| 2 | ready | `## 📦 READY — SHIP oder ÄNDERN?` |
| 3 | ship-blocked | `## ⛔ BLOCKED. {{reason}} — FIX oder SKIP?` |
| 4 | test | `## 🧪 DONE — SHIP nach deinem TEST?` |
| 5 | test-minimal | `## ▶️ STARTED. {{user-facing-description}} — VIEL SPASS` |
| 6 | analysis | `## 📋 DONE — LIES dir durch` |
| 7 | aborted | `## 🚫 ABORTED. {{reason}} — Was soll ich VERSUCHEN?` |
| 8 | fallback | `## 🔧 DONE — Noch was ANDERES?` |

### Footer line

`📌 {{version-bump}} · {{build-id}}`

The footer line sits between the separator and the CTA. It contains:
- **📌** — pin icon, fixed
- **Version bump** (if available): `{{vOld}} → {{vNew}} ({{bump}})` — only for ship-successful with bump
- **Build-ID**: always present, 7-char hash or `no build id`

| Condition | Footer |
|-----------|--------|
| Ship with bump | `📌 0.38.4 → 0.38.5 (patch) · 3a16efe` |
| Ship without bump | `📌 3a16efe` |
| Any other variant | `📌 3a16efe` |
| No build ID | `📌 no-build-id` |

---

## Variant Table

| # | Variant | CTA-Icon | Changes | Tests | User-Test | User-Final-Test | State | Usage |
|---|---------|---------|---------|-------|-----------|-----------------|-------|-------|
| 1 | ship-successful | 🚀 | yes | yes | — | if flagged | final | yes |
| 2 | ready | 📦 | yes | if ran | — | if flagged | branch | yes |
| 3 | ship-blocked | ⛔ | yes | if ran | — | if flagged | branch | yes |
| 4 | test | 🧪 | yes | if ran | yes | if flagged | app-status | yes |
| 5 | test-minimal | ▶️ | — | — | — | — | — | — |
| 6 | analysis | 📋 | yes | — | — | if flagged | none | yes |
| 7 | aborted | 🚫 | opt. | — | — | if flagged | dep. | yes |
| 8 | **fallback** | 🔧 | yes | — | — | if flagged | dep. | yes |

- **ship-successful (1)**: ONLY after /devops-ship + successfully merged to origin/main. PR vs. direct push → state line shows the difference.
- **ship-blocked (3)**: ONLY after /devops-ship + NOT merged (PR open, build fail, etc.).
- **test (4)**: Code edits + app/service started or startable. Applies to ANY project type (web, CLI, desktop, API, game — not just UI). If user needs to test, always use this variant and try to start the app.
- **test-minimal (5)**: User starts app via prompt, no edits done yet. Minimal greeting card.
- **analysis (6)**: No file changes — covers audit, plan, review, explanation, investigation.

### CTA Icons

| Icon | Meaning | Variants |
|------|---------|----------|
| 🚀 | Delivered — all done | ship-successful |
| 📦 | Ready — user decides next step | ready |
| 🧪 | Test — user must verify | test |
| ▶️ | Started — app launched | test-minimal |
| ⛔ | Blocked — needs fix | ship-blocked |
| 🚫 | Aborted — not feasible | aborted |
| 📋 | Info — purely informational | analysis |
| 🔧 | Default — miscellaneous/other | fallback |

### Variant Selection Rules

```
if   ship pipeline ran + merged to origin/main  → ship-successful (1)
elif ship pipeline ran + NOT merged              → ship-blocked (3)
elif task aborted / infeasible / rate-limited    → aborted (7)
elif code edits + app/service started or startable → test (4)
elif user started app via prompt, no edits yet     → test-minimal (5)
elif code/doc changes (>=1 edit), no app         → ready (2)
elif NO code changes (analysis/explanation/...)  → analysis (6)
else                                             → fallback (8)
```

**STRICT variant rules (never violate):**

- **ship-successful**: ONLY after `/devops-ship` ran `ship_release` and it was merged to origin/main. A commit, push, or PR alone is NEVER "ship-successful". Use `ready` instead.
- **ship-blocked**: ONLY after `/devops-ship` ran but did NOT merge (build failed, PR open, gate failed). Never use for plain uncommitted/unpushed state.
- **test-minimal**: ONLY when the user freshly starts the app via a prompt and no code edits have been made yet. Never after a commit, task completion, or any other action. This is a session-start greeting, nothing else.
- **ready**: Default for any completed code/doc change (>=1 edit) that hasn't gone through the ship pipeline. Threshold is >=1 edit — not >5.

**Key rule — `ready` vs `analysis`:**
- `ready`: at least one file was modified/created/deleted → user can ship
- `analysis`: zero files changed → read-only outcome (audit, plan, review, explain, investigate)
- When in doubt: if `git status` would be clean → `analysis`, not `ready`

**Key rule — `test` variant:**
- Use `test` when code edits were made AND the result can be tested by the user.
  This is NOT limited to UI/web projects — applies to ANY project type: web apps,
  CLI tools, APIs, desktop apps, games, scripts. If the user should test it, use `test`.
- When possible, start the app/service for the user before rendering the card.
- If 5+ code edits AND Desktop Testing available → offer automated visual testing
  via Computer Use before rendering the card (see `deep-knowledge/desktop-testing.md`).
- Desktop testing is optional — user can always decline and test manually.

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
13. State line always with all fields (merge, pr, push, commit, branch) — most important first.
14. test-minimal `{{user-facing-description}}`: Prefer user-facing descriptions ("Website opens in Edge", "Window appears") over technical details ("Dev server on :3000"). Fall back to technical only when no user-visible outcome exists.
