---
description: "Start the dev server / app for manual testing. Use when the user says 'dev start', 'starte die app', 'app starten', 'run it', 'start the dev server', 'start', or any variation requesting to launch the application. This is the USER-triggered app start — not for Claude-initiated testing (that's /test). Executes immediately without confirmation."
user_invocable: true
---

# /start — Launch App for Manual Testing

Start the development app immediately when the user requests it. No confirmation, no questions.

## Execution Steps

1. **Clean stale build caches** — project-specific cache paths are defined in the project's `/dev-start` skill extension. If no project extension exists, skip this step.

2. **Start the app** — the launch method is project-specific (defined in `/dev-start` extension or `.claude/launch.json`). If no project extension exists, use `preview_start` with the first available launch config.

3. **Get the build ID**: `git write-tree | cut -c1-7`

4. **Show the test prompt card** as the last thing in the response (format in deep-knowledge `test-prompt-card.md`).

## Rules

- Execute immediately — the user expects no delay or discussion.
- The test prompt card is **mandatory** after every start. Never skip it.
- If code changes were made in this session, include test steps in the card.
- If no code changes (standalone start), show the minimal card (no test steps).
- Project-level `/dev-start` skills **extend** this skill with project-specific launch methods, cache paths, and worktree rules.
