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

1. **SessionStart** writes `~/.claude/governor/sessions/<id>.json` and starts
   the watcher detached. A second watcher exits at once (lock file with
   heartbeat; a dead or silent holder is taken over; a newer plugin version
   asks the running one to hand over). The watcher puts the session's claude
   process into the named job `Local\dotclaude-gov-s-<id>` (no limits).
2. **Every tick** (3 s) the helper samples processes, GPU engines, disk
   latency (raw counters), available RAM, paging and the foreground window.
   Claude's processes are the descendants of `claude.exe` plus the session
   job members; processes that start with a session (and MCP servers) are
   infrastructure. A job is the subtree of one tool call.
3. A job is **heavy** after 20 s over 25 % CPU, 20 % GPU or high disk IO while
   the disk is pressed. Kinds: server (listens on a port), foreground (Claude
   waits on it), generator (heavy > 2 min), build.
4. **Pressure** = foreign priority per resource (decays 10 min after the
   app's last load; all resources while it is the interactive foreground app;
   game-library, learned and `alwaysPriority` apps from process start; manual
   switch) ∪ over budget (CPU/GPU 80/65 hysteresis, disk latency > 4× idle
   baseline with a queue, RAM free < max(15 %, 4096 MB) or hard paging; 10 s
   smoothing).
5. **Plan**: on priority every heavy job on that resource yields at once —
   CPU generators are paused, everything else (servers, foreground, builds,
   GPU generators — flagged `requeue`) is capped (CPU hard cap 10 %,
   below-normal priority, very-low IO priority). Over budget: one step per
   10 s, newest job first. Relax one step per 30 s, oldest first.
6. Every throttle is written to `state.json` **before** the OS call. On start
   the watcher reverses every recorded throttle. When the watcher dies, the
   helper sees its stdin close and resumes/uncaps what it applied.
7. **PreToolUse** gates heavy-looking starts (and escape routes such as
   `wsl`, `schtasks`, `Start-Process -Verb`, `sc` while pressure is active):
   allowed → RAM reservation (expected peak per command kind + 4096 MB
   headroom); deferred → queued with cwd/branch/HEAD and the call is refused
   with the queue id and log path. The watcher runs queued commands when
   nothing presses, after a drift check.

## Commands

```
node <plugin>/scripts/governor/cli.js status
node <plugin>/scripts/governor/cli.js priority on|off
node <plugin>/scripts/governor/cli.js not-priority "<app folder or exe>"
node <plugin>/scripts/governor/cli.js always-priority "<app folder or exe>"
node <plugin>/scripts/governor/cli.js queue
node <plugin>/scripts/governor/cli.js stop
```

Config: `~/.claude/governor/config.json`, merged over the defaults in
`scripts/governor/config.js`; `"enabled": false` switches everything off.
Inline `DOTCLAUDE_GOVERNOR=off` in a command skips the gate for that call.

## Limits (v1)

- Windows only. Linux and macOS have no adapter yet: the hooks and the
  watcher do nothing there.
- Restored priority class is always Normal (the original is not recorded).
- Docker containers are not attributed (vmmem counts as OS load).
- GPU generators are capped, never killed and re-queued.
