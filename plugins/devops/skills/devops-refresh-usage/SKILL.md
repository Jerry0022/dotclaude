---
name: devops-refresh-usage
version: 0.2.0
description: >-
  Fetch live token usage for completion card battery line. Reads the native
  statusLine-written usage file first (no scrape), falls back to the Edge CDP
  scraper or cached data. Run silently pre-card, or manually:
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

### 1·0. Native source first (no scrape)

`~/.claude/usage-live.json` is kept **minute-fresh by the native statusLine
writer** ([statusline-usage.js](../../scripts/statusline-usage.js), registered by
`ss.statusline.ensure`) — it maps Claude Code's `rate_limits` JSON onto the
usage schema with **no browser and no extra Claude turn**. If the file's
`timestamp` is recent (≤ a couple of minutes), just **read it — you are done**;
skip the Edge scrape entirely. Only when it is stale/absent (pre-first-API
response, an unsupported login, `weeklySonnet` needed, or a host without
the statusLine writer) fall through to the Edge scraper below. The
`dotclaude-completion` MCP server applies this same warm-read-first logic
automatically in `get_usage` / `render_completion_card`.

**Automatic path is zero-interaction.** The MCP fallback always runs the scraper
with `--no-login`, so the completion card **never opens a login window** — a
logged-out profile just serves statusLine/cached data. A one-time login is
offered **only** when you run this skill manually (the command in 1a omits
`--no-login`). The card itself renders only the 5h + weekly numbers, which the
native statusLine source already provides token-free; `weeklySonnet` is a
manual-summary extra, not a card field.

### 1·1. Edge CDP fetcher (fallback)

The script spawns a **dedicated, isolated Edge instance** with its own
`user-data-dir` under `~/.claude/edge-usage-profile`. It is completely
independent from the user's main Edge — separate cookies, separate
processes, no tabs touched. It fetches usage via a cookie-authed in-page
call to the internal API (`GET /api/organizations/{id}/usage` +
`/rate_limits`) — the settings page became an SPA overlay (2026-05) that
never renders headless, so DOM parsing is only a single-grab last resort.
Runs headless; the hidden instance is reused across runs.

The script path is `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js` (use the plugin root, NOT a relative path).

### 1a. Run the scraper (manual run — login allowed)

This skill is the **manual** entry point (the user explicitly asked for usage /
weeklySonnet), so the command deliberately omits `--no-login`: a one-time login
window may open here. The automatic card path uses `--no-login` and never does.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js" --quiet --summary
```

Exit codes:
- `0` → success. Usage written to `~/.claude/usage-live.json`.
- `2` → **scraper profile is not logged in**. On this manual run a visible Edge window has been opened at `https://claude.ai/login`. **Tell the user inline**, e.g.:
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

- **Never touch the user's main Edge.** The scraper always spawns a dedicated, isolated Edge instance with its own user-data-dir (`~/.claude/edge-usage-profile`). It reaps **only that profile's** instances — matched by the `--user-data-dir` on the live command line, not by a stored PID (which dies on Windows when Edge re-execs into its singleton, the bug that let orphan instances pile up). The user's main Edge is never matched.
- **Login windows only on manual runs.** The automatic card path passes `--no-login`, so it **never** opens a window (a logged-out profile just serves cache). On a manual run (this skill, no `--no-login`) a one-time login is expected, opened at most once: on first run (or after a profile wipe) the scraper profile has no cookies, so the script opens a visible login window, writes a sticky `edge-usage-login-pending.json` marker, and exits code `2`. While that marker is fresh (≤ 30 min) **no** session opens another window — so parallel sessions can't stack login windows. Tell the user inline — do NOT retry silently.
- **Silent after first login.** A successful scrape clears the marker immediately; once the profile has cookies, all subsequent runs are invisible and reuse the one hidden instance.
- **Transient render failures never open a window.** A slow/unrendered page returns a scrape error (cache fallback), not code `2`. Only an explicit `/login` redirect or login UI counts as logged-out.
- **Playwright fallback is acceptable** — if the scraper fails, opening a browser tab via Playwright to scrape is fine.
- **Delta computation**: Read `usage-live.json` before and after refresh. Delta = new_pct - old_pct.
- **Script path**: Always use `${CLAUDE_PLUGIN_ROOT}/scripts/refresh-usage-headless.js`, never a relative path.
