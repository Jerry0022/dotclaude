# Ship — Composed ships and run flags

Referenced by `/do-ship` § Composed ships. The `--cwd`, `--keep` and
`--queued` rows stay in SKILL.md; this is the queue marker and the remaining
run flags.

## Queue marker

| Signal | Effect on this run |
|---|---|
| `.claude/.ship-queue` marker in the target repo root (`{ owner, since }`) | Written by the orchestrator before its first ship, deleted after its own finalizer. Project ship extensions MUST skip any post-ship step that mutates this install (plugin self-sync, cache rebuild, MCP restart) while it exists — the orchestrator runs that step exactly once at the end. Not a lockout: `AskUserQuestion` gates stay interactive unless Pre-Step A says otherwise. **Stale rule:** a marker whose `since` is older than 6 h belongs to a queue that died; a plain `/do-ship` (no `--queued`) deletes it and proceeds as if absent, so one crashed cleanup run never defers finalizers forever. |

## Run flags

| Signal | Effect on this run |
|---|---|
| `--delegated` | This run is the fresh-context subagent of a delegated ship (Pre-Step 0). Follow `modes/delegated.md` → *Subagent*: gates return a decision instead of asking, the card comes back as JSON. |
| `--card-data` | Passed by the /auto-concept finalize (part C). With `--delegated`: stop before the render and return the card data, the caller renders after its close-out (`modes/delegated.md` § Card data instead of a card). Inline: parsed and ignored — the finalize already orders close-out before the render. |
| `--resume` | Continue an interrupted ship from its checkpoint (Pre-Step R). Sent by `prompt.ship.detect`'s `[ship-resume]` block when the user continues ("weiter", "continue", a ship prompt) and a ship stopped half-way. |
| `--inline` (old: `--no-compact`) | Keep this one ship in the main context even when the context is large (Pre-Step 0). Parsed and dropped — it changes nothing else. |
