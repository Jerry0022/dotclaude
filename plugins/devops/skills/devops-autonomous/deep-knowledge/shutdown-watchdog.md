# Watchdog Arming & Shutdown — Full Mechanics

Low-level mechanics for `devops-autonomous` Step 4d (arm watchdog) and Step 8
(finalization / shutdown). Read this when you reach Step 4d. It is split out of
SKILL.md so the trigger-time body stays lean (progressive disclosure) — the Bash
below is only needed at run time.

## External Watchdog — Always Armed

The watchdog is a Windows Scheduled Task that fires after N hours **outside**
Claude — it cannot be blocked by anything inside the session. It is armed in
**both** shutdown choices, with a different recovery action:

| Step 2 Q3 choice | Watchdog `action` | On firing with flag missing |
|------------------|-------------------|-----------------------------|
| "Ja, herunterfahren" | `shutdown` | Force-shuts the PC down |
| "Nein, nur Bericht"  | `notify`   | Writes a visible `AUTONOMOUS-STALLED.txt` next to the flag — **no** power-off |

The `notify` arm closes the gap where a "report-only" run wedges (Anthropic API
hang, stuck subagent) and would otherwise hang **forever with zero external
signal** — the user returns to a frozen session and no clue why. With the notify
watchdog, they instead find a dated `AUTONOMOUS-STALLED.txt` pointing at
`AUTONOMOUS-RESUME.json`.

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

The absolute `$FLAG_PATH` is **persisted in the watchdog sentinel** (TEMP file)
at registration time. Step 8c reads it back from the sentinel rather than
recomputing it from `$PWD` — that way a later `cd` in some tool step can't make
Step 8c write a flag the watchdog doesn't check.

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

## Step 8 — Finalization & Shutdown

Runs after Step 7 (Report). Behavior depends on `$WATCHDOG_ACTION`:

- **notify mode** (shutdown=no): the PC stays on. Skip 8a and 8b entirely — go
  straight to 8c and write the done-flag so the health-watchdog stands down. The
  flag here simply means "the session reached completion and is not wedged".
- **shutdown mode** (shutdown=yes): run 8a → 8b → 8c, but only when status is
  COMPLETED or INTERRUPTED. BLOCKED skips 8b (see below).

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

Command (only when writing the flag) — **omit the path** so the script reads the
persisted `flagPath` from the sentinel rather than re-deriving it from `$PWD`:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/autonomous-watchdog.js" flag
```

We deliberately do NOT call `unregister` on the scheduled task — leaving it armed
but flag-satisfied is simpler and self-cleans (the task fires once, sees the flag,
exits, and removes its helper script). If you ever need to clean it up earlier
(e.g. user manually resumes), use the `unregister` subcommand.
