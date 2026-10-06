# Claude load governor

Only heavy load that Claude caused yields: to any foreign, non-OS app with
noticeable load, and always to the 80 % budget. Claude itself, its agents and
MCP servers are never throttled. Concept:
`docs/concepts/20261005-2144-game-aware-resource-governor.html` (iterations 2–6).

## Parts

| Part | File |
|---|---|
| Pure policy (classification, priority, budget, plan, admission) | `scripts/governor/policy.js` |
| State file, singleton lock, hook file lock | `scripts/governor/state.js` |
| Deferred-command queue (drift check, 24 h expiry) | `scripts/governor/queue.js` |
| Counters → rates | `scripts/governor/sample.js` |
| Game libraries (Steam, Epic, GOG, Ubisoft, EA, Xbox, GameConfigStore) | `scripts/governor/libraries.js` |
| Watcher loop (one for all sessions) | `scripts/governor/watcher.js` |
| CLI | `scripts/governor/cli.js` |
| Windows adapter + PowerShell helper | `scripts/governor/adapters/win32.js`, `win-helper.ps1` |
| Hooks | `ss.governor.attach`, `pre.governor.gate`, `post.governor.clear` |
| local-llm gate | `plugins/local-llm/hooks/lib/governor-gate.js` |

## Flow

1. **SessionStart** writes `~/.claude/governor/sessions/<id>.json` with the
   session's Claude Code pid (`CLAUDE_PID`, exported by Claude Code) and
   starts the watcher detached. A second watcher exits at once (lock file; a
   holder is taken over only when its pid is dead — an unknown start time is
   never treated as reuse; a newer plugin version asks the running one to hand
   over). A session expires when its claude pid is gone.
2. **Every tick** (3 s busy, 20 s idle — process list only, no GPU query) the
   helper samples processes, disk latency (raw counters), available RAM,
   paging and the foreground window. Attribution is **claude ancestry only**
   (no session job object): Claude's processes are the descendants of the
   Claude Code CLI; processes that start with a session (and MCP servers) are
   infrastructure. A job is the subtree of one tool call. The app **hosting**
   Claude — every ancestor of a Claude root (the Desktop `Claude.exe`, VS
   Code, a terminal, an IDE) and every process sharing its app folder — is the
   host: never priority, never learned.
3. A job is **heavy** after 20 s over 25 % CPU, 20 % GPU or high disk IO while
   the disk is pressed. Kinds: server (listens on a port), foreground (Claude
   waits on it), generator (heavy > 2 min), build.
4. **Pressure** = foreign priority per resource (decays 10 min after the
   app's last load; an unknown app's load counts only while the system uses
   ≥ `foreign.contendPct` (60 %) of that resource — disk: while pressed —
   and never for browsers, chat/IDE hosts or script runtimes such as
   node/python; all resources while it is the interactive foreground app;
   game-library, learned and `alwaysPriority` apps from process start; manual
   switch) ∪ over budget (CPU/GPU 80/65 hysteresis, disk latency > 4× idle
   baseline with a queue, RAM free < max(15 %, 4096 MB) or hard paging; 10 s
   smoothing).
5. **Plan**: on priority every heavy job on that resource yields at once —
   CPU generators are paused, everything else (servers, foreground, builds,
   GPU generators — flagged `requeue`) is capped (CPU hard cap 10 %,
   below-normal priority, very-low IO priority). Over budget: one step per
   10 s, newest job first. Relax one step per 30 s, oldest first.
6. Every throttle is written to `state.json` **before** the OS call, keyed by
   job. A record is removed **only after a successful release** — a crash or a
   failed release leaves it for the next start to reverse. The adapter reverts
   by key (`apply(key, level, pids)` / `release(key, pids)`, pid lists merged,
   never replaced, pruned each tick to live (pid, start time) pairs); on start
   the watcher adopts every recorded throttle and releases it (orphan
   reversal) — a failed revert stays recorded. Release always opens the cap
   job **by name** and sets its CPU rate to 0, so a cap survives no crash; the
   name outlives a killed helper because each capped process holds a
   duplicated handle to its cap job. When the watcher dies, the helper also
   sees its stdin close and reverts everything it applied; a helper that
   times out 3 times in a row is killed and restarted, and its records are
   released again. Disabling the governor, or `governor stop` with no watcher
   running, starts a revert-only watcher that reverses the records and exits.
7. **PreToolUse** gates generators and containers (ffmpeg, blender,
   whisper, llama/ollama, python train/render/generate, docker) and the
   minimal escape list (`wsl`, `schtasks`, `Start-Process -Verb`,
   `sc create`, `systemd-run`, segment-anchored) only when a resource that
   command would load is actually pressed. Builds, tests and browser checks
   (npm test/build, vitest, playwright, tsc, cargo …) never wait for
   pressure — the watcher caps them only if they turn heavy. Any recognised
   kind still waits while free RAM < expected-per-kind + 4096 MB. Foreign disk IO earns
   priority only while the disk budget is pressed (IO counters include
   network). Matching looks only at
   the LEADING command of each `;`/`&&`/`||`/`|` segment (quotes and heredocs
   stripped); `git`, `gh` and `--version`/`--help` invocations are never
   heavy.
8. **Deferred commands are recorded, never run by the governor** (spec change,
   R4): running them detached would bypass Claude's permission prompts and
   could execute against a stale working tree. The watcher marks a recorded
   command `ready` once resources free up; `prompt.governor.resume`
   (UserPromptSubmit) then tells the session — or the next session in the same
   repo — which commands can run again, with the branch/HEAD they were
   deferred at as a drift reminder, and Claude re-runs the ones still needed
   under normal permissions. Entries expire after 24 h.

## Commands

```
node <plugin>/scripts/governor/cli.js status
node <plugin>/scripts/governor/cli.js priority on|off
node <plugin>/scripts/governor/cli.js not-priority "<app folder or exe>"
node <plugin>/scripts/governor/cli.js always-priority "<app folder or exe>"
node <plugin>/scripts/governor/cli.js queue
node <plugin>/scripts/governor/cli.js log [--runs N] [--tail]
node <plugin>/scripts/governor/cli.js stop
```

Config: `~/.claude/governor/config.json`, merged over the defaults in
`scripts/governor/config.js`; `"enabled": false` switches everything off.
`notify: false` keeps notifications out of test/headless runs.

## Debug log

Bounded, so the last few sessions can always be debugged without filling the
disk (`scripts/governor/log.js`):

- **Where:** `~/.claude/governor/logs/`. One JSON-lines file per watcher run,
  `run-<ISO start>-<pid>.jsonl`. Hooks and local-llm write into the running
  watcher's file (named as `logFile` in `state.json`), otherwise into
  `hooks.jsonl` (rotated at 1 MB to `hooks.1.jsonl`).
- **Retention:** the newest `log.keepRuns` runs (default 10), then the oldest
  runs go until everything is ≤ `log.maxTotalMB` (default 20). A run file that
  reaches `log.maxFileMB` (default 2) gets one `log-truncated` line; after
  that only errors and start/stop are written.
- **What:** events, never raw samples — `start`/`stop`, `priority-gained` /
  `priority-lost` (resource, app), `budget-over` / `budget-ok`, `job-heavy` /
  `job-kind`, `throttle` (key, kind, name, resources, level), `release`
  (reason) / `release-failed`, `learned`, `queue-defer` / `queue-ready` /
  `queue-expired` / `queue-inject`, `admit` (gate decision, reason, command
  kind, command cut to 200 chars), `llm-defer`, `helper-timeout` /
  `helper-killed` / `helper-restart`, `tick-error`. While anything is tracked
  or pressed, one `summary` line per minute (budget means, priority apps,
  jobs, throttled); nothing when idle. Identical event + fields within 30 s
  are written once with `repeated: n`. No environment, no file contents.
- **Read:** `governor log` prints the newest run (plus `hooks.jsonl`) one
  event per line; `--runs N` for more runs, `--tail` to follow the current one.

## Learning rules

Learned priority is earned only by a **foreground** app showing **GPU (3D)**
load, after 60 s (15 s fullscreen). CPU-only load, background apps, launchers
(Steam/Epic/Ubisoft/EA/GOG/Xbox…), browsers, IDEs, chat/Electron hosts and
Claude-driven services (Ollama, AnythingLLM) are never learned. Library and
GameConfigStore apps get priority while in the foreground or with recent
measured load, not merely for running. RAM is never a priority trigger — it is
only a system-pressure signal of the 80 % rule.

## Limits (v1)

- Windows only. The Linux and macOS adapters are not in this change (a safety
  classifier blocked writing that adapter code mid-task); the shared key-based
  adapter interface and the OS-exclusion rules for both are in place, and the
  watcher/hooks are a no-op where `createAdapter` returns null.
- Restored priority class is always Normal (the original is not recorded).
- Docker containers are not attributed (vmmem counts as OS load).
- GPU generators are capped, never killed and re-queued (flagged `requeue`).
