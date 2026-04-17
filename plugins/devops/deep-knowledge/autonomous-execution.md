# Autonomous Execution — Gate, Guardrails, Late-Permission Protocol

Detailed execution rules for `devops-autonomous` Step 5. Read this at the start of
autonomous execution.

## Execution Mode Gate

Behavior depends on `$EXEC_MODE` from Step 2.

### `analyze` mode
- **Allowed:** Read, Glob, Grep, WebFetch, WebSearch, Agent (research only),
  screenshots (visual inspection), git log/blame/diff.
- **Forbidden:** Write, Edit, Bash (except read-only commands like `ls`, `git log`,
  `npm list`, `cat`), git commit, any file modification.
- **Output:** Analysis report with findings, architecture insights, recommendations,
  code-quality observations, potential improvements — but NO changes applied.
- Desktop (if chosen): take screenshots for visual verification, never interact.

### `implement` mode
- **Phase 1 — Analyse:** full analysis like `analyze` mode (read code, understand
  architecture, check dependencies, decide strategy).
- **Phase 2 — Implement:** implement, test, build, verify.
- No ship — all changes stay local until the user returns.

## Safety Guardrails (both modes)

**Forbidden (always):**
- git push (any branch), force-push
- /ship or /devops-ship
- creating PRs
- external communications (Discord, email, Slack, GitHub comments/issues)
- purchases, account creation
- destructive git ops (`reset --hard`, `clean -f`, `branch -D`)
- deleting files outside project
- modifying system config

All changes stay local — the user reviews and decides to ship when they return.
Log as "blocked action" in the report if the task required one.

**Additional allowed in `implement` mode:** git commit (current sub-branch),
git pull/fetch, file ops within project, browser/desktop automation, builds,
tests, linters, installing dev deps.

## Late Permission Handling

If during autonomous execution a permission is needed that wasn't primed in Step 3:

1. **Do NOT ask the user.** They are AFK. The Post-Confirmation Lockout is absolute.
2. Log the missing permission and what it was needed for.
3. Complete as much remaining work as possible WITHOUT the missing permission.
4. Commit all progress locally (implement mode) or save analysis state.
5. Write `AUTONOMOUS-RESUME.json` to project root:
   ```json
   {
     "task": "<original goal>",
     "mode": "<implement|analyze>",
     "missingPermission": "<what was needed and why>",
     "progress": "<summary of what was completed>",
     "remaining": "<what couldn't be done>",
     "shutdownRequested": true,
     "branch": "<current-branch-name>",
     "timestamp": "<ISO-8601>"
   }
   ```
6. Proceed to Step 7 (Report) with status **INTERRUPTED**.
7. Proceed to Step 8 (Shutdown) — **shutdown IS executed** if the user chose it.
   The resume file ensures continuity on next boot.
