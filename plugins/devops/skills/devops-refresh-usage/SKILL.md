---
name: devops-refresh-usage
version: 0.1.0
description: >-
  Fetch live token usage for completion card battery line. Supports CLI-native,
  Edge CDP, or graceful fallback. Run silently pre-card, or manually on request.
allowed-tools: Bash(node *), Read
---

# Refresh Usage Data

Fetch live token usage for the completion card's battery line.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/refresh-usage/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/refresh-usage/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Fetch data (aggressive fallback chain)

**NEVER show `[no data]` without exhausting ALL fallbacks first.**
Run this chain top-to-bottom. Stop at first success.

The script path is `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js` (use the plugin root, NOT a relative path).

### 1a. Try Edge CDP directly

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --check-only
```
- Exit 0 → CDP ready → scrape:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
  ```
  → Done. Read `~/.claude/usage-live.json`.

### 1b. Edge not running (exit 7) → auto-start

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --auto-start --quiet --summary
```
- Starts Edge with CDP in background, scrapes, done.
- No user interaction needed.

### 1c. Edge running without CDP (exit 5) → activate CDP

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --activate-cdp --quiet
```
- Restarts Edge with CDP flag (restores tabs via `--restore-last-session`).
- Then scrape:
  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
  ```
- This is autonomous — do NOT ask the user for permission. Edge restart is fast and restores all tabs.

### 1d. CDP still failed → open browser tab as fallback

If all CDP attempts fail, use the Playwright browser tools:
```
browser_navigate → https://claude.ai/settings/usage
```
Wait for page load, read the usage text from the page, parse it manually using the same percentage/reset patterns from Step 2.

### 1e. Last resort — cached data

Read `~/.claude/usage-live.json`. If it exists and is less than 30 minutes old, use it with `[cached Xm ago]` label.

### 1f. No data

Only after ALL of 1a–1e fail: show `[no data]` with the specific reason (e.g., "Edge not installed", "not logged in to claude.ai").

## Step 2 — Parse and store

Write results to `~/.claude/usage-live.json`:

```json
{
  "session": { "used_pct": 42, "resetInMinutes": 192 },
  "weekly": { "used_pct": 18, "resetInMinutes": 2885 },
  "timestamp": "2026-03-27T10:30:00Z",
  "_cached": false
}
```

## Step 3 — Compute burn rate

Used by the completion card's battery line:

```
burn_ratio = token_pct / elapsed_pct

5h window:  elapsed_pct = (300 - resetInMinutes) / 300 * 100
Weekly:     elapsed_pct = (10080 - resetInMinutes) / 10080 * 100

ratio < 0.5  → 🔋 + "Viel Spielraum"
ratio 0.5-1.3 → 🔋 (no hint)
ratio > 1.3  → 🪫 + "Hoher Verbrauch — neue Session oder Haiku empfohlen"
```

## Rules

- **NEVER give up early** — exhaust the full fallback chain (1a→1b→1c→1d→1e) before showing `[no data]`.
- **Always attempt fresh data** — cached data only as automatic fallback after all live methods fail.
- **Silent execution** — CDP operations are invisible. Edge restart is autonomous (restores tabs).
- **Playwright fallback is acceptable** — if CDP fails, opening a browser tab to scrape is fine.
- **Delta computation**: Read `usage-live.json` before and after refresh. Delta = new_pct - old_pct.
- **Script path**: Always use `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js`, never a relative path.
