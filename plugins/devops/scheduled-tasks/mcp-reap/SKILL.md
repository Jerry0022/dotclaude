---
name: mcp-reap
description: Reclaims orphaned Claude Desktop MCP server processes leaked by previously-closed sessions, in the background, without a restart.
version: 0.1.0
trigger: ss.mcp.reap.js (SessionStart, every session) AND stop.mcp.reap.js (Stop, ~20-minute per-worktree cooldown)
scope: per-worktree (Stop cooldown), machine-wide (the scan itself)
---

# MCP Reap

Reclaims orphaned Claude Desktop MCP server child processes — leftovers from
previously-closed sessions that were never reliably terminated and linger,
accumulating RAM. Driven by two hooks so it runs both once per session
**and** periodically thereafter, without requiring a restart:

- **`hooks/session-start/ss.mcp.reap.js`** — fires once, every `SessionStart`.
- **`hooks/stop/stop.mcp.reap.js`** — fires on `Stop` (end of a response
  turn), gated by a ~20-minute per-worktree cooldown so it doesn't scan
  every turn. The cooldown marker uses the same atomic write-temp-then-
  rename pattern as `self-calibration`, keyed to an md5 hash of
  `process.cwd()` in `os.tmpdir()`.

Both hooks spawn `scripts/mcp-reap.js --apply --json` **detached,
fire-and-forget, windowless** (`{ detached: true, stdio: 'ignore',
windowsHide: true }` + `.unref()`) and exit immediately — reaping never
delays a session start or a response turn.

## Safety model

The scan-and-kill logic lives in `hooks/lib/mcp-reaper.js` (fully unit
tested, 46/46 in `mcp-reaper.test.js`) and is **Windows-only** — the
dead-parent-PID orphan signal only means anything on Windows, so the module
is a documented no-op on macOS/Linux. A process is only ever a reap
candidate when it matches an MCP-server launcher signature, its parent PID
is confirmed dead, AND it falls outside the live-Claude census (every
currently-live `claude`/`claude.exe` process plus its full descendant
subtree) and the caller's own process subtree — an empty/unbuildable census
means "protection unknown" and refuses to produce any candidates at all.
Every candidate is re-validated against a fresh process snapshot immediately
before both the SIGTERM and any SIGKILL escalation (TOCTOU-safe), so a pid
reused for something else between scan and kill is skipped, never touched.
The `reap()` module itself defaults to dry-run — nothing is ever terminated
unless a caller explicitly passes `--apply`; both hooks opt into it
deliberately, on the reasoning that a leaked orphan is safe to reclaim
automatically once the safety net above holds. Any enumeration or kill
failure fails safe (skip, never throw).

## Run manually

```
node scripts/mcp-reap.js               # dry-run, human summary
node scripts/mcp-reap.js --json        # dry-run, JSON output
node scripts/mcp-reap.js --apply       # reclaim now — sofort ohne Neustart
node scripts/mcp-reap.js --apply --json
```

Every run — including the detached ones spawned by the hooks — persists its
result to `dotclaude-mcp-reap-status.json` in `os.tmpdir()`, so "what did it
reap (or not)?" is inspectable after the fact even though the hooks discard
stdout (`stdio: 'ignore'`).

## Constraints

- Silent unless it reaps — no console noise on a clean scan, no window ever
  (windowless spawn on both the hook side and inside the reaper's own
  `powershell.exe`/`wmic` process-enumeration calls).
- Never blocks session start or a response turn — both hooks are wrapped in
  try/catch and always exit 0, even if spawning the detached CLI fails.
- Non-Windows platforms: both hooks Windows-gate cheaply before spawning
  anything (the reaper is a no-op there anyway).
- Cooldown degrades safely: if `os.tmpdir()` is unwritable, the Stop hook's
  marker write fails silently and the hook simply fires every turn instead
  of crashing.
