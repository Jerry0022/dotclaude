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

## API-Error-Handling

When an upstream API throttles or rate-limits during autonomous execution, the
session can't simply wait forever — the user is AFK, the watchdog is ticking,
and indefinite hangs are exactly what brought the PC down the wrong way last time.

### Detection — what counts as a rate-limit signal

Match against tool output (Bash stderr, MCP tool errors, HTTP responses) for any of:

- `Server is temporarily limiting requests`
- `not your usage limit` (Anthropic's specific phrasing for global throttle)
- `Rate limited`, `rate_limit_exceeded`, `429 Too Many Requests`
- `quota exceeded`, `RESOURCE_EXHAUSTED` (Google/GCP)
- `ThrottlingException` (AWS)
- `overloaded_error` (Anthropic's overload signal — different from rate-limit but same handling)

**False positives to ignore**: literal occurrences inside code being read/written
(source files, tests, docs about rate-limiting). Only treat as a signal when the
phrase appears in a tool *result* / error output, not in file content.

**Important limitation**: Anthropic API errors on Claude's OWN inference calls
are handled by the Claude Code client, NOT visible to in-skill code. The session
will appear to "hang" from the user's perspective. The external watchdog from
Step 4d is the only defense for that case — keep it armed.

### Backoff Schedule

On first detection, apply exponential backoff with three attempts:

| Attempt | Wait before retry | Total elapsed |
|---------|-------------------|---------------|
| 1 (initial fail) | 30 s | 30 s |
| 2 | 2 min | ~2.5 min |
| 3 | 10 min | ~12.5 min |

If the operation still fails after attempt 3, transition to **bail** below.

During each wait, log the attempt to the report and (if applicable) use the wait
time for non-API work — local linting, doc generation, file reorgs that don't
need network. Never spin-loop the API.

### Bail Protocol

After 3 failed attempts on the same operation, or immediately on a hard signal
(HTTP 401/403 indicating revoked credentials, not throttling):

1. **Do NOT ask the user.** AFK. Lockout applies.
2. Log to the report: the failing API, the signal observed, the wait/retry
   history, and what was supposed to happen next.
3. Commit all completed work locally (implement mode).
4. Write `AUTONOMOUS-RESUME.json` with `missingPermission` replaced by a
   `blockedOn` field describing the API failure:
   ```json
   {
     "task": "<original goal>",
     "mode": "<implement|analyze>",
     "blockedOn": {
       "type": "api-rate-limit",
       "service": "<anthropic|supabase|openai|...>",
       "signal": "<exact phrase observed>",
       "lastAttempt": "<ISO-8601>",
       "operation": "<what was being done>"
     },
     "progress": "<summary of what was completed>",
     "remaining": "<what couldn't be done>",
     "shutdownRequested": <true|false>,
     "branch": "<current-branch-name>",
     "timestamp": "<ISO-8601>"
   }
   ```
5. Generate the report (Step 7) with status **INTERRUPTED**.
6. Proceed to Step 8 (Shutdown) normally if the user chose it. Step 8c writes
   the done-flag only if Step 8b succeeded — so a failed in-session shutdown
   still leaves the watchdog armed.
7. **Critical**: if the rate-limit prevents Step 7 itself from running (e.g.
   `render_completion_card` MCP call also throttled), skip the HTML report and
   write a minimal `AUTONOMOUS-INTERRUPTED.txt` instead:
   ```
   STATUS: INTERRUPTED (API rate-limit during finalization)
   See AUTONOMOUS-RESUME.json for state.
   ```
   Then still attempt Step 8. If even Bash is unavailable, the external watchdog
   from Step 4d will fire at the 6h mark and force shutdown regardless.

### Why the watchdog is critical here

The whole reason Step 4d exists is the case "Claude's own inference API is
throttled and the session is wedged from the user's POV". In that scenario,
none of the above in-skill logic runs — Claude isn't making any tool calls
because the platform itself isn't dispatching to Claude. The Windows Scheduled
Task runs independently of Claude, checks for the done-flag, and forces
shutdown if the session never got far enough to write it.

This is **not** redundancy with the in-session shutdown — it's a different
layer protecting against a different failure mode.
