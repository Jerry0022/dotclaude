---
name: devops-refresh-usage
version: 0.1.0
description: >-
  Fetch live token usage for completion card battery line. Supports CLI-native,
  Edge CDP, or graceful fallback. Run silently pre-card, or manually:
  "refresh usage", "wie viel hab ich verbraucht", "token budget".
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

## Step 1 — Fetch data

The script spawns a **dedicated, isolated Edge instance** with its own
`user-data-dir` under `~/.claude/edge-usage-profile`. It is completely
independent from the user's main Edge — separate cookies, separate
processes, no tabs touched. Scrapes headless, then kills only that
instance by PID tree.

The script path is `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js` (use the plugin root, NOT a relative path).

### 1a. Run the scraper

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
```

Exit codes:
- `0` → success. Usage written to `~/.claude/usage-live.json`.
- `2` → **scraper profile is not logged in**. A visible Edge window has been opened at `https://claude.ai/login`. **Tell the user inline**, e.g.:
  > ⚠️ Der Usage-Scraper hat ein eigenes Edge-Profil unter `~/.claude/edge-usage-profile`. Dieses ist noch nicht bei Claude eingeloggt — ein Edge-Fenster wurde gerade geöffnet. Bitte einmal einloggen (Cookies bleiben danach im Scraper-Profil persistent). Danach funktioniert der Scraper dauerhaft headless im Hintergrund.
  After the message, use cached data for this turn (see 1c).
- `3` / `4` / `5` → scrape/launch failure. Fall through to 1b.

### 1b. Browser fallback (optional)

If the scraper fails repeatedly, use the Playwright tools:
```
browser_navigate → https://claude.ai/settings/usage
```
Parse the page text using the same percentage/reset patterns from Step 2.

### 1c. Cached data (automatic)

The script already falls back to `~/.claude/usage-live.json` with a `[cached Xm ago]` label when scraping fails and a cache exists. You don't need to do anything extra — just read the file.

### 1d. No data

Only after 1a–1c all fail: show `[no data]` with the specific reason.

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

- **Never touch the user's main Edge.** The scraper always spawns a dedicated, isolated Edge instance with its own user-data-dir (`~/.claude/edge-usage-profile`) and kills only that instance by PID tree when done.
- **One-time login is expected.** On first run (or after a profile wipe) the scraper profile has no cookies. The script opens a visible login window and exits with code `2`. Tell the user inline — do NOT retry silently.
- **Silent after first login.** Once the user has logged in once, the scraper profile's cookies persist and all subsequent runs are invisible.
- **Playwright fallback is acceptable** — if the scraper fails, opening a browser tab via Playwright to scrape is fine.
- **Delta computation**: Read `usage-live.json` before and after refresh. Delta = new_pct - old_pct.
- **Script path**: Always use `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js`, never a relative path.
