# Watchdog Arming & Shutdown — Full Mechanics

Low-level mechanics for `devops-autonomous` Step 4d (arm watchdog), Step 5.0 (arm
fail-safe shutdown timer) and Step 8 (finalization / shutdown). Read this when you
reach Step 4d. It is split out of SKILL.md so the trigger-time body stays lean
(progressive disclosure) — the Bash below is only needed at run time.

## Three Shutdown Layers (shutdown mode)

When the user chose "Ja, herunterfahren", three independent layers guarantee the PC
powers off — each covers a failure the others can't:

| Layer | Armed at | Fires | Covers |
|-------|----------|-------|--------|
| **Fail-safe timer** (`autonomous-shutdown-timer.js`) | Step 5.0, run start | `shutdown /s /t` after 90 min–5 h | Session wedges before Step 8 (token exhaustion, API hang) — early & OS-level |
| **In-session shutdown** (Step 8b) | Step 8, after work | `shutdown /s /t 60`, 60 s after completion | The normal happy path; cancels the fail-safe first |
| **External watchdog** (`autonomous-watchdog.js`) | Step 4d | Scheduled Task after 8 h | Even the fail-safe `shutdown.exe` call could not be placed |

The fail-safe timer is the answer to "tokens ran out mid-run, the session froze, and
the PC stayed on all night". It is armed **unconditionally** and **early**, so it does
not depend on Claude reaching any later step. Step 8 cancels it the instant it runs,
because by then the session has proven it is alive and the deliberate Step 8 decision
(graceful 60 s shutdown, or *no* shutdown for BLOCKED) supersedes the blind timer.

## External Watchdog — Always Armed

The watchdog is a Windows Scheduled Task that fires after N hours **outside**
Claude — it cannot be blocked by anything inside the session. It is armed in
**both** shutdown choices, with a different recovery action:

| Registered `action` | Used by | On firing with flag missing |
|---------------------|---------|-----------------------------|
| `shutdown` | shutdown=yes runs | Force-shuts the PC down |
| `notify`   | shutdown=no runs (autonomous) | Writes a visible `AUTONOMOUS-STALLED.txt` next to the flag — **no** power-off |
| `resume`   | shutdown=no runs (backlog-runner) | Notify **and** attempt a guarded one-shot relaunch of `claude` to continue — **no** power-off |

The `notify` arm closes the gap where a "report-only" run wedges (Anthropic API
hang, stuck subagent) and would otherwise hang **forever with zero external
signal** — the user returns to a frozen session and no clue why. With the notify
watchdog, they instead find a dated `AUTONOMOUS-STALLED.txt` pointing at
`AUTONOMOUS-RESUME.json`.

The `resume` arm goes one step further for a **shutdown=no** run that must keep
making progress unattended (the backlog-runner night loop): on firing with the flag
missing it writes the same stalled marker **and** actively revives the work by
launching a fresh `claude` with a caller-supplied resume prompt. It is the answer
to "the PC stayed on all night but the wedged session did nothing" — notify alone
leaves a note; resume tries to finish the job. Hard safety properties, all
enforced in `autonomous-watchdog.js` and unit-tested:

- **One-shot, guarded.** The relaunch runs at most once per registration — it drops
  an `AUTONOMOUS-RECOVERY.flag` next to the done-flag and refuses to relaunch if
  that flag already exists. A repeatedly-firing task can never fork-bomb `claude`.
- **Notify-fallback.** If `claude` is not on `PATH` (or `Start-Process` throws), it
  degrades to notify-only — the stalled marker is still written, nothing else
  happens. `resume` is therefore never *less* safe than `notify`.
- **Requires a resume prompt.** `register … resume <resume-prompt>` fails without
  one, because there is nothing to hand the fresh session otherwise. The relaunch
  starts headless (`claude -p "<prompt>"`) in the flag's project directory.

Arm it exactly like the others, with the prompt as the 4th argument:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-watchdog.js" register "$FLAG_PATH" 8 resume "$RESUME_PROMPT"
```

**Known limitation (documented, not a bug).** The relaunched headless session
inherits only permissions already granted in `~/.claude/settings.json`; anything
that was only primed interactively in the parent session will not re-prompt (no
one is there) and that step degrades per the late-permission protocol. `resume` is
best-effort revival, not a guarantee — but strictly better than a silent all-night
stall.

It is the last line of defense against:
- Anthropic API rate-limit hangs (Step 6 retry exhaustion or unhandled cases)
- Subagent crashes that leave the orchestrator waiting
- Wakelocks, hung file handles, any "session alive but not progressing" mode
- Bash quoting bugs in the in-session shutdown command itself

### Arming (Step 4d)

```bash
FLAG_PATH="$PWD/AUTONOMOUS-DONE.flag"
# action = "shutdown" if Step 2 Q3 was "Ja, herunterfahren", else "notify"
WATCHDOG_OUT=$(node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-watchdog.js" register "$FLAG_PATH" 8 "$ACTION")
echo "$WATCHDOG_OUT"  # → {"ok":true,"taskName":"ClaudeAutonomousWatchdog-...","action":"...",...}
```

The absolute `$FLAG_PATH` is **persisted in a per-registration watchdog
sentinel** (TEMP file, one per registration). Parallel autonomous sessions in
other projects keep their own sentinels and scheduled tasks — registering never
deletes or shadows a sibling session's watchdog (the pre-fix single global
sentinel caused the 2026-07-05 incident: one session's pathless `flag` wrote
the done-flag into the other session's project). Step 8c reads the flag path
back from the sentinel rather than recomputing it from `$PWD` — that way a
later `cd` in some tool step can't make Step 8c write a flag the watchdog
doesn't check.

Parse the JSON output:
- `ok: true` → save `taskName` as `$WATCHDOG_TASK`, save `action` as
  `$WATCHDOG_ACTION`, set `$WATCHDOG_REGISTERED=true`
- `ok: false` or `skipped: true` (non-Windows) → set `$WATCHDOG_REGISTERED=false`,
  log a one-line warning into the report ("⚠ External watchdog konnte nicht
  angelegt werden — in-session shutdown ist alleinige Absicherung" for shutdown
  mode, or "⚠ Health-Watchdog konnte nicht angelegt werden — ein Hang bliebe
  unsichtbar" for notify mode). Continue.

**Budget tuning**: 8h covers realistic autonomous-task durations (analysis +
implement + tests + build + verify + report) with headroom that includes the
worst-case Step 8a wait (30 min) plus the API-error backoff schedule (~12 min)
without crowding the firing window. Override only if the user declared an
explicitly long task during intake ("12h migration", "run overnight benchmark")
— bump to `12` or `24` (script enforces ≤ 24h).

## Fail-Safe Shutdown Timer (Step 5.0)

Armed as the **first action** of Step 5 when shutdown=yes, before any task work.
It is the inner, early net (the watchdog above is the outer one): a hard OS-level
`shutdown.exe /s /t <seconds>` placed immediately, so the PC powers off even if the
session later wedges and never reaches Step 8.

### Arming

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-shutdown-timer.js" arm
```

Parse the JSON:
- `ok:true` → log `armed {minutes} min (source={source})` to `AUTONOMOUS-LOG.md`.
  `source` is `reset-window` | `reset-window-floored` | `reset-window-capped` |
  `fallback-5h` — useful when the user asks on return why the timer was that length.
- `ok:false` → log `⚠ Fail-safe-Timer konnte nicht gesetzt werden — 8h-Watchdog ist
  alleinige Absicherung` and continue. Never abort the run over it.
- `skipped:true` (non-Windows) → silent, continue.

### Timer length — "remaining 5h-period + floor"

Before reading usage, `arm` (no override) **freshens** `~/.claude/usage-live.json`
when the cached snapshot is stale (older than `REFRESH_MAX_AGE_MIN`, or absent): it
best-effort runs the headless `refresh-usage` scraper (`--no-login`, 90 s-bounded,
all failures swallowed). This is what makes the timer track the **real** remaining
window instead of silently defaulting to the flat-5h fallback in desktop sessions,
where the native statusLine writer never keeps the file warm. A warm cache (terminal
session) is younger than `REFRESH_MAX_AGE_MIN`, so the scrape is skipped entirely.

The script then resolves the delay purely (`computeShutdownDelaySeconds`, unit-tested):

1. Take `session.resetInMinutes`, **age-correct** it by the snapshot `timestamp`
   (`effective = resetInMinutes − minutesSinceSnapshot`). `now` is read *after* the
   scrape, so a fresh snapshot is never misread as future-dated.
2. **Clamp to [90 min, 5 h].** The 90-min FLOOR stops a near-empty token window from
   cutting off still-running work; the 5 h CAP is one full token period.
3. **Fall back to 5 h** when usage data is missing, unparsable, stale (>5 h old),
   future-dated (clock skew), or the period already elapsed — *"5h passt im
   Zweifelsfall immer"*.

Why the refresh is **bounded and skippable**: a scrape costs up to ~60 s and spins up
the Edge scraper. Capping it at 90 s and gating it on cache staleness keeps arming
prompt in the common (warm-cache) case, and the 5 h fallback stays safe whenever the
refresh yields nothing — so accuracy is gained without weakening the fail-safe.

### Robustness

`shutdown.exe` is invoked directly (not through cmd/PowerShell) with an absolute path
(`%SystemRoot%\System32\shutdown.exe`) and a guaranteed-local CWD — a UNC working
directory (session on `\\nas\share\...`) cannot break it. `arm` runs `/a` first, so a
re-arm is idempotent.

### Cancellation (Step 8.0)

Because the timer is unconditional, **Step 8 cancels it before deciding anything**:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-shutdown-timer.js" cancel
```

`cancel` runs `shutdown /a`; a "nothing scheduled" result (error 1116) is treated as
success. This is what lets a **BLOCKED** run stay powered on (the fail-safe would
otherwise force it off) and lets the graceful 60 s shutdown replace the longer
fail-safe window on the happy path.

## Step 8 — Finalization & Shutdown

Runs after Step 7 (Report). Behavior depends on `$WATCHDOG_ACTION`:

- **notify mode** (shutdown=no): the PC stays on. No fail-safe timer was armed, so
  skip 8.0/8a/8b entirely — go straight to 8c and write the done-flag so the
  health-watchdog stands down. The flag here simply means "the session reached
  completion and is not wedged".
- **shutdown mode** (shutdown=yes): run 8.0 → 8a → 8b → 8c, but 8a/8b only when
  status is COMPLETED or INTERRUPTED. BLOCKED still runs 8.0, then skips to 8c.

### 8.0 — Cancel the Fail-Safe Timer (shutdown mode only)

Always the first finalization step in shutdown mode — for **every** status,
including BLOCKED. Reaching Step 8 proves the session is alive, so the Step 5.0
fail-safe must hand control back to the deliberate decision here:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-shutdown-timer.js" cancel
```

Skipping this for BLOCKED would force the very power-off that BLOCKED forbids;
skipping it for COMPLETED/INTERRUPTED would leave the long fail-safe countdown
racing the graceful 60 s shutdown (whichever Windows scheduled first wins, and a
second `shutdown /s` errors with "a shutdown is already scheduled"). A
"nothing scheduled" result is benign — the script reports `noPending:true`.

### 8a — Wait for Other Active Claude Sessions (shutdown mode only)

Never cut off another running Claude session — any project, any worktree. Before
the shutdown command, poll `~/.claude/projects/**/*.jsonl` mtimes. A jsonl
modified within the last 2 minutes means that session is mid-thought or
mid-tool-call. Exclude our own project tree entirely (our main session + any
subagents we spawned).

Self-detection: env vars like `CLAUDE_SESSION_ID` are not exposed to Bash.
Reconstruct the encoded project-dir name from `$PWD` — Claude encodes the Windows
path under `~/.claude/projects/` by replacing `\`, `:`, `.` with `-`
(e.g. `C:\…\eager-rubin-98f8d6` → `C--…--claude-worktrees-eager-rubin-98f8d6`).

Loop max 30 minutes, then proceed regardless (avoid indefinite hang):

```bash
PROJECTS="$HOME/.claude/projects"
ENCODED=$(cygpath -w "$PWD" 2>/dev/null | sed 's/[\\:.]/-/g')
[ -z "$ENCODED" ] && ENCODED=$(basename "$PWD")  # non-Windows fallback
SELF_DIR="$PROJECTS/$ENCODED"
[ -d "$SELF_DIR" ] || SELF_DIR=""
# Sentinel prevents grep -vF '/' from filtering ALL absolute paths when SELF_DIR is empty
SELF_PATTERN="${SELF_DIR:+${SELF_DIR}/}"
[ -z "$SELF_PATTERN" ] && SELF_PATTERN="@@NO_SELF_MATCH@@"
for i in $(seq 1 60); do
  active=$(find "$PROJECTS" -name '*.jsonl' -newermt '2 minutes ago' 2>/dev/null \
            | grep -vF -- "$SELF_PATTERN" | head -1)
  [ -z "$active" ] && break
  sleep 30
done
```

Failure mode: if encoding doesn't match (unexpected path layout), `SELF_DIR`
stays empty and the sentinel falls through. The loop then waits on its own
session too — burns the full 30 min cap before shutdown. Safer than cutting off
other sessions by accident.

### 8b — Execute Shutdown (COMPLETED / INTERRUPTED, shutdown mode)

**Always shell out via PowerShell with an absolute path to `shutdown.exe`.**
The naked Bash form (`shutdown /s /t 60 /c "..."`) is unreliable in two cases
seen in production:

1. **UNC CWD** (e.g. session running from `\\nas\share\...`): cmd.exe rejects
   UNC paths as CWD ("UNC-Pfade werden nicht unterstützt") and silently switches
   to `%SystemRoot%`, breaking the rest of the command line.
2. **Bash quoting**: single-quoted args (`'shutdown /s /t 60'`) work in Bash but
   CMD treats `'` as a literal — the whole token becomes one unknown command.

PowerShell tolerates UNC CWDs natively, and the absolute
`$env:SystemRoot\System32\shutdown.exe` path bypasses any PATH/CWD interaction:

```bash
powershell.exe -NoProfile -Command '& "$env:SystemRoot\System32\shutdown.exe" /s /t 60 /c "Autonomous task completed. Shutting down in 60s. shutdown /a to abort."; exit $LASTEXITCODE'
SHUTDOWN_EXIT=$?
```

**Capture the exit code** as `$SHUTDOWN_EXIT`. The trailing `; exit $LASTEXITCODE`
is **mandatory** — without it, `$?` in Bash captures `powershell.exe`'s own exit
(usually 0 even when the inner native call failed), not `shutdown.exe`'s exit.
`shutdown.exe` returns 0 on success; anything else means the call did NOT
schedule a shutdown. Step 8c uses this to decide whether to disarm the watchdog.

**INTERRUPTED:** Shutdown is safe because progress is saved in
`AUTONOMOUS-RESUME.json` and committed locally. The user can resume on next boot
via Step 0.5.

**BLOCKED:** Do NOT run 8b at all — jump straight to 8c. Original rule stands:
data integrity may be at risk, user must intervene.

**Never ask about shutdown inline.** The decision was made in Step 2 (or Step 0.5
on resume). Just execute it (after the 8a wait).

### 8c — Watchdog Done-Flag Handling

Only relevant if Step 4d armed a watchdog (`$WATCHDOG_REGISTERED == true`).
Skip entirely if registration failed.

Decision matrix — when to write `AUTONOMOUS-DONE.flag` (which tells the watchdog
to **not** act when it fires):

| `$WATCHDOG_ACTION` | Status | Step 8b exit | Write flag? | Why |
|--------------------|--------|--------------|-------------|-----|
| shutdown | COMPLETED   | 0 (success)  | **Yes** | In-session shutdown handled it; watchdog must stand down |
| shutdown | INTERRUPTED | 0 (success)  | **Yes** | Same — shutdown is happening, watchdog redundant |
| shutdown | COMPLETED   | ≠ 0 (failed) | **No**  | In-session shutdown failed → watchdog is the fallback, let it fire |
| shutdown | INTERRUPTED | ≠ 0 (failed) | **No**  | Same — watchdog enforces what 8b couldn't |
| shutdown | BLOCKED     | (skipped)    | **Yes** | BLOCKED never shuts down. Stand the watchdog down too |
| notify   | COMPLETED / INTERRUPTED / BLOCKED | (no 8b) | **Yes** | Report was reached → the run is not wedged → no stalled marker needed |

The notify row is the key change: reaching Step 8 at all proves the session did
not wedge, so the flag is always written and the health-watchdog finds it and
stands down. The watchdog only writes `AUTONOMOUS-STALLED.txt` when Step 7/8 was
**never reached** — i.e. a genuine hang.

Command (only when writing the flag) — **run it from the project root and omit
the path** so the script resolves this session's own sentinel (single sentinel →
used directly; multiple parallel sessions → the one whose flag directory
contains the cwd):

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-watchdog.js" flag
```

If it fails with "Multiple watchdog sentinels exist … none matches the current
directory unambiguously", do NOT guess — pass this run's flag path explicitly
(`flag "$FLAG_PATH"` from Step 4d). The hard failure is intentional: writing the
flag into a sibling session's project would silently mute that session's
watchdog.

We deliberately do NOT call `unregister` on the scheduled task — leaving it armed
but flag-satisfied is simpler and self-cleans (the task fires once, sees the flag,
exits, and removes its helper script). If you ever need to clean it up earlier
(e.g. user manually resumes), use the `unregister` subcommand.
