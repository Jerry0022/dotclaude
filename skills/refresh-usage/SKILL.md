---
name: refresh-usage
version: 0.1.0
description: >-
  Fetch live token usage data for the completion card battery line. Supports
  multiple backends: CLI-native (/usage), Edge CDP scraping, or graceful fallback.
  Run silently before every completion card. Also manually: "refresh usage",
  "wie viel hab ich verbraucht", "token budget".
---

# Refresh Usage Data

Fetch live token usage for the completion card's battery line.

## Step 0 — Load Extensions

1. Read `~/.claude/skills/refresh-usage/SKILL.md` + `reference.md` if exists → global overrides
2. Read `{project}/.claude/skills/refresh-usage/SKILL.md` + `reference.md` if exists → project overrides
3. Merge: project > global > plugin defaults

## Step 1 — Detect backend

Choose the data source based on the execution environment:

### 1a. Claude Code CLI

If running in the Claude Code CLI (terminal/REPL):
- Use the built-in `/usage` command output
- Parse session usage, weekly usage, and model-specific data
- This is the preferred method — no external tools needed

### 1b. Edge CDP (fallback for non-CLI environments)

If `/usage` is not available (e.g., Claude Desktop, MCP):
- Run `node scripts/refresh-usage-headless.js --quiet --check-only`
- Exit 0 → CDP available → scrape via `--quiet --summary`
- Exit 7 → Edge not running → `--auto-start` (no user consent needed)
- Exit 5 → Edge without CDP → `--activate-cdp` (one-time restart)

### 1c. No data available

If neither CLI nor CDP works:
- Return `🔋 [no data]` for the completion card
- Non-blocking — never prevent completion card from rendering

## Step 2 — Parse and store

Write results to `scripts/usage-live.json`:

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

- **Always attempt fresh data** — no caching by default. Cached data only as automatic fallback.
- **Silent execution** — no visible browser activity except one-time CDP activation.
- **Never use Claude in Chrome MCP tools** as a scraping fallback.
- **Delta computation**: Read `usage-live.json` before and after refresh. Delta = new_pct - old_pct.
