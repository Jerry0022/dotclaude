# Concept Bridge Server + Edge

The **concept bridge server** (`scripts/concept-server.py`) serves static files
AND provides HTTP endpoints for heartbeat and decision exchange.

> **Timestamp unit convention (read before writing any client code).**
> Every timestamp the server exposes — `server_ts`, `claude_ts`, `ts` —
> is **milliseconds since the Unix epoch**, byte-compatible with JavaScript's
> `Date.now()`. The browser compares them directly, with no conversion:
> ```js
> Date.now() - _lastHeartbeatTs < HEARTBEAT_STALE_MS   // both in ms
> Date.now() - _lastServerTs    < SERVER_STALE_MS       // same unit contract
> ```
> `_lastServerTs` (cached from `server_ts`) is compared against `SERVER_STALE_MS`
> to distinguish the bootstrap window from a dead bridge — same ms-since-epoch
> unit, same staleness-comparison pattern as `_lastHeartbeatTs`.
> **Never divide either side by 1000.** A seconds-since-epoch mix-up
> (`claude_ts / 1000`, `Date.now() / 1000`) flips the staleness math negative
> and silently renders "Claude verbunden" forever.
>
> `_processed_at` and `_picked_up_at` are **ISO-8601 UTC strings** (parsed
> client-side via `Date.parse`).

1. Find the bridge server script — the **highest** cached version, never the
   first `ls` hit:
   ```bash
   # Prefer the hook runtime's root; otherwise version-sort the glob
   # (`sort -V` orders 0.9 < 0.10) and take the last entry, never `head -1`.
   PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/concept-server.py}"
   [ -f "$PLUGIN_ROOT" ] || PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-server.py 2>/dev/null | sort -V | tail -1)
   ```
   The same rule applies to every other script resolved from the cache in
   this document (`concept-port-registry.js`, `concept-watch.js`,
   `concept-tick.js`, `concept-drift.js`): `sort -V | tail -1`, never
   `head -1`. See CONVENTIONS.md § Scripts → Path rule.

2. Start the bridge server in the **session cwd** — the worktree when this
   session runs in one (the watchdog resolves `--html` against the cwd, the
   concept HTML is written into THIS checkout, and the state file of step 4
   lives here too, #417):
   **Launch it via the Bash tool's `run_in_background: true`** — NOT
   `nohup … &` (or any `&`-backgrounded child) inside a single foreground
   Bash call. A child backgrounded inside one tool call is reaped with that
   call's shell; only a detached background task survives across turns:
   ```bash
   # Bash tool, run_in_background: true  (no trailing &, no nohup)
   python "$PLUGIN_ROOT" {port} "{session-cwd}" \
       --html "docs/concepts/{date}-{slug}.html"
   ```

   **Pick the port via the cross-session registry — never a bare random number
   (Defect B: cross-session collision).** Every live bridge advertises
   `{port, pid, worktree, …}` at `~/.claude/concept-bridges/<port>.json`; the
   picker skips any port owned by a LIVE FOREIGN session (and any bound port):
   ```bash
   REG="$(dirname "$PLUGIN_ROOT")/concept-port-registry.js"
   PORT="$(node "$REG" pick "{project-root}")"   # a free, foreign-safe port
   ```
   Record `$PORT`. An exact OS PID is not reliably knowable from a detached
   task, so `server_pid` in the state file is best-effort — cleanup targets the
   server by **port** via `/shutdown`, never by PID, so the precise PID is not
   required. `concept-server.py` writes its own registry entry on bind and
   removes it on `/shutdown`, on a watchdog reap, at interpreter exit and on
   SIGINT/SIGTERM. A hard-killed server (TerminateProcess, power loss) still
   leaves a stale entry; `pick` therefore sweeps the registry first
   (`pruneStale`): an entry is deleted when its port no longer accepts a TCP
   connect — a live foreign bridge is never touched, and the recorded pid is
   deliberately not trusted (Windows reuses pids within days).
   `node "$REG" prune` runs the same sweep on its own. Both the server and the
   picker honour `CONCEPT_BRIDGE_REGISTRY_DIR`, which the test suites set to a
   temp directory so hard-killed test servers cannot silt the real registry.

   **Sweep the port BEFORE launching — exactly one instance must own it.**
   The server binds the port EXCLUSIVELY (`SO_EXCLUSIVEADDRUSE` on Windows,
   `allow_reuse_address=False`; see `concept-server.py` §
   `ConceptBridgeServer`), so a duplicate launch **fails loudly** (`cannot
   bind port … exit 1`) — you still MUST sweep a lingering prior instance of
   YOUR OWN before launching, or a socket stuck in TIME_WAIT fails the bind.

   **Only ever sweep a port THIS session owns — NEVER a foreign one (Defect
   B).** Gate the sweep on the registry: `can-claim` exits 0 when the port is free, ours, or
   held by a dead owner, and non-zero when a LIVE FOREIGN session owns it. The
   picker already avoids foreign ports, so this is a belt-and-braces check on
   the exact port you are about to bind:
   ```bash
   # Bash: bail out rather than kill another session's bridge
   node "$REG" can-claim "$PORT" "{project-root}" \
     || { echo "port $PORT now owned by another session — re-run the picker"; exit 1; }
   ```
   ```powershell
   # PowerShell tool — safe now: the port is provably ours / free
   Get-NetTCPConnection -LocalPort $PORT -State Listen -EA SilentlyContinue |
     ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
   ```
   After launch, assert a **single** listener (`netstat -ano | grep
   "127.0.0.1:{port}"` → exactly one LISTENING row — the server binds
   loopback-only, see § Loopback-only bind below, so it will NOT show up
   under `0.0.0.0:{port}`) before opening the browser.
   If the bind still fails because a foreign session grabbed the port in the
   race window, re-run `node "$REG" pick "{project-root}"` for a fresh port and
   retry — never force the sweep.

   **The server must be threaded.** `concept-server.py` uses
   `http.server.ThreadingHTTPServer` (not the single-threaded `HTTPServer`).
   A single-threaded server lets one held connection block every poll
   (HTTP 000 while LISTENING). If you ever fork the script, keep it threaded.
   `$PORT` is written to `.claude/concept-active.json` in step 6 so the
   SessionStart resume hook can find this server again after a Claude restart.

   **Loopback-only bind, origin gate on every data-bearing endpoint, no CORS
   wildcard (#312 red-team F1).** `concept-server.py` binds `127.0.0.1`, not
   all interfaces — the server holds the user's full review notes and every
   file attached to the concept with no authentication beyond origin
   checking, so it must not be reachable from other hosts on the LAN. The
   single origin check, `_same_origin_ok` (no `Origin` header — curl, i.e.
   Claude's own polling — or an `Origin` matching the bridge's own
   host/localhost/127.0.0.1; anything else 403s), gates every endpoint that
   returns or accepts real content: `GET /decisions`, `GET /pending`,
   `GET /recovery`, `GET /draft`, `GET /attachments/<id>`, `POST /decisions`,
   `POST /draft`, `POST /attachments`, `POST /reload`, `POST /shutdown`. It deliberately
   does NOT gate `GET /heartbeat` or `GET /reload` (a bare counter, nothing
   sensitive) — those stay reachable from same-origin without a check so the
   page's own poll loop never has an extra failure mode. `Access-Control-
   Allow-Origin` is never a wildcard: the server echoes the request's own
   `Origin` back only when `_same_origin_ok` accepts it, and omits the CORS
   headers entirely for a request with no `Origin` (CORS is a browser-only
   concept; `curl` never needs it). **A missing `Origin` header always
   passes** — that is Claude's own `curl` polling, and the whole monitoring
   loop depends on it continuing to work with no header at all.

   **The `--html` flag is mandatory.** It arms the server-side watchdog:
   if the concept HTML file disappears for > 10 s, the watchdog terminates
   the bridge automatically — no orphan server can survive a manual
   `rm docs/concepts/…`, a failed disposition step, or a worktree wipe.
   The watchdog ALSO terminates if Claude's heartbeat goes stale for > 30
   min (`--heartbeat-timeout-ms` default `1800000`), catching the dead-cron
   case (session closed without /shutdown, cron prompt loop dropped). Both
   conditions independently guarantee the server cannot become a ghost.

   A tighter watchdog can pass a lower value explicitly (e.g.
   `--heartbeat-timeout-ms 300000` for 5 min).

3. **No polling cron.** The two token-free watchers below own the whole
   monitoring duty - heartbeat, self-cleanup, page liveness, pickup - and the
   old 15-minute backstop cron is gone: measured, 113 of 126 fires woke the
   model (a full context re-read) for nothing. Redundancy now lives between
   the watchers: the waker stamps a beat file (`concept-waker-{port}.json`,
   next to the state file) on every poll, and the pulser - an independent
   long-lived task - exits `PULSER_EXIT reason=WAKER_MISSING version=N` (a
   wake) when a submission sits unattended for two polls while that beat is
   stale and the waker never woke the session for that version. A pending
   submission therefore always yields exactly one wake. A session restart
   kills both tasks; `ss.concept.resume` re-arms them. Do NOT call
   `CronCreate` in step 3. If a cron is ever reinstated for a case this
   design cannot cover, it must be hourly with an off-minute (`17 * * * *`)
   and the tick stays silent when nothing is pending.

   **Legacy cron (state file with `cron_id`, sessions started before this
   change).** Such a cron keeps working: it runs `concept-tick.js` below and is
   silent when idle. On resume the hook tells the model to `CronDelete` it and
   drop `cron_id`. The documented tick prompt is kept for that case:

   **The prompt is two sentences — the procedure is a script.** Claude Code
   renders a cron's entire prompt as its background-task card;
   `scripts/concept-tick.js` performs every step and prints an instruction
   only on the ticks that need one, so an idle tick costs zero tokens.

   **Resolve the script at run time, never bake in a versioned path.** A cron
   outlives a plugin rebuild, so a baked versioned path dangles and every tick
   fails MODULE_NOT_FOUND. In the versioned cache layout emit a version-sorted
   glob that picks the HIGHEST version directory, with the literal path as the
   fallback:
   `f="$(ls -d "{cache-root}/devops"/*/scripts/concept-tick.js 2>/dev/null | sort -V | tail -1)"; node "${f:-{literal}}"`.
   A dev/marketplace checkout has no version directory and just uses the
   literal path, which is the form shown below.

   ```
   legacy prompt of the retired */15 cron, <<EOF
   Silently run via Bash: node "{plugin-root}/scripts/concept-tick.js" --port {port} --state "{session-cwd}/.claude/concept-active.json" --owner {owner} — this services the concept bridge on port {port}. No output → produce NO output (silent tick). Any output IS your instruction for this tick: follow it exactly.
   EOF
   ```

   **Two phrasings in that prompt are load-bearing — do not tidy them up.**
   - It MUST **start** with `Silently run`. The `prompt.flow.silent-turn` hook
     marks a cron tick as a silent turn only when the prompt *opens* with a
     silence marker. Put anything in front of it and every tick is treated as a real
     user turn: the stop hook blocks it to force a completion card.
   - It MUST contain the literal `port {port}`. Step (0)'s orphan sweep deletes
     "every cron whose prompt mentions `port {port}`" when the state file, and
     with it `cron_id`, is gone. `--port {port}` alone does not match that
     phrasing, so the trailing clause is what keeps the sweep able to find this
     cron.

   **`--state` must be ABSOLUTE**, for the same reason it is absolute for the
   watchers below: a relative `.claude/concept-active.json` is resolved against
   the cron task's cwd, which is not always the project root the state file
   lives in.

   **What `concept-tick.js` does on each tick** — the same three steps, in the
   same order, with the same triggers:

   (0) **Self-cleanup gate (FIRST step every tick).** It reads the state file
       at `--state`. Cleanup triggers when ANY of these is true:
         - The state file is missing.
         - `state.port` ≠ `{port}` (this cron is for a stale session — a newer
           concept overwrote the state file with a different port).
         - `state.html_path` is set but does not exist on disk (resolved against the
           state file's grandparent, i.e. the session cwd). An unset `html_path` is NOT a trigger.
         A trigger must hold on 3 looks in a row (initial + 2 re-checks, 5 s apart) before
         `/shutdown` — the watcher's 3-polls rule — so a rewrite window never tears the bridge down.
         A state file that names another port AND another `owner` is a
         sibling session's (#417): NOT a trigger — the tick reports it on
         stderr and keeps servicing its own port.
       A state file that is present but *unreadable* (EBUSY/EPERM during a
       rewrite on Windows, EMFILE under load) or half-written is explicitly
       NOT a trigger — one unlucky tick must not tear down a live concept.
       On trigger the script POSTs `/shutdown` itself, then prints the one
       instruction it cannot execute, because `CronDelete` is a tool:
       delete `cron_id` from the still-readable state file — or, if the state
       file is gone entirely, `CronList` and delete every cron whose prompt
       mentions `port {port}` (a missing state file proves the session is
       unrecoverable; sweeping by-port catches the orphan even when the id is
       lost). Steps 1 and 2 are skipped.

   (1) **Heartbeat POST** to `/heartbeat`. A single failure is reported on
       stderr only: bridge liveness is owned by the keepalive pulser and the
       server-side `--html` watchdog, and a per-tick complaint about a dying
       bridge would spam the transcript once a minute. **The second
       consecutive failure prints the relaunch instruction — once (#348).**
       A bridge that dies *without* a session restart (a crash, a manual
       kill, the watchdog) had nobody to bring it back: the pulser only
       notices while its own session is alive. The tick therefore keeps a
       consecutive-miss counter (`tick_heartbeat_failures`) and a one-shot
       marker (`relaunch_requested_at`) in the state file; the instruction
       — relaunch on the SAME port with the recorded `--html`, re-arm pulser
       and waker — fires on the tick that crosses two misses with no marker
       set, every later miss is silent again, and the next successful
       heartbeat clears both fields so a later death fires it again. One
       transient miss between good ticks never fires. The instruction says
       what to do when the port is already bound (another session brought
       the bridge back): skip the relaunch, only re-arm the watchers.

   (2) **Pending check** against the deterministic `/pending` endpoint — a
       strict `{"pending": true|false, "version": N}` with no free-form
       content, **never** a substring match on `/decisions`. Not pending →
       the script prints nothing at all and the tick is silent.

       Pending → it prints the processing instruction, carrying the version
       from `/pending`. That instruction is the branch procedure that used to
       sit in the cron prompt, and it is unchanged:
         • Fetch `curl -s http://localhost:{port}/decisions`. Parse the JSON.
           Note `_version`. Strip `_version` and `_processed_at` before
           treating the rest as decision data. Read `action` — it is one of
           THREE values, each with its own SKILL.md Step 5b branch:
             - "iterate"        → next iteration on the concept page only
             - "implement"      → apply real code changes + final-report
             - "finalize"       → the final report's close-out sheet, ONE
                                  payload carrying issues{} + implement{} +
                                  ship{} + disposition{}. Run the selected
                                  parts in a FIXED order: (A) issues —
                                  user-value gate (merges combination-only
                                  items silently), then `/auto-issue` (hand-over,
                                  no prompt) per gated item; (B) implement — the follow-ups
                                  routed to "jetzt umsetzen", built through
                                  the devops role agents, then noted in the
                                  report; (C) ship — the full /do-ship pipeline,
                                  stop + report on a hard gate failure and
                                  skip (D); (D) Step 6 cleanup with the
                                  disposition
           Legacy pages generated before the sheet still send "create-issues",
           "ship" or "dispose-concept" one at a time — map each onto the
           matching part above (SKILL.md § Legacy final-report actions).
           Process per Step 5 (Live Feedback Loop) — act on the user's choices
           (approve/tweak/reject, included options, comment-driven tweaks).
           Step 5c writes the new iteration to the HTML file and POSTs
           `/reload` BEFORE the reset below. Reset is the LAST action.

         • **Zero-prompt invariant for finalize (and its legacy variants).**
           This branch MUST complete end-to-end without asking the user
           anything. The payload (issues.items[], implement.items[], ship.run,
           disposition{}) is self-sufficient by design; any missing optional
           field falls back to a sane default. If you catch yourself reaching
           for AskUserQuestion, stop — the answer is in the payload, the
           concept HTML, or the project's new-issue extension. The user signed
           off on the sheet's live plan, which named every consequence in
           execution order before the click.
           (Exception: the ship part MUST still stop and surface a hard
           ship-pipeline gate failure, and a force-push to main/master still
           needs explicit confirmation.)

         • After the file rewrite AND the `/reload` POST have completed,
           reset conditionally — pass the noted version:
           `curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"version": <noted>}' http://localhost:{port}/reset`
         • If the HTTP code is 409 (version mismatch) → the user submitted
           again while you were processing. Re-fetch /decisions, process the
           new payload (which supersedes what you just finished), then retry
           the conditional reset with the new `_version`.
         • If the HTTP code is 428 (`no_reload_since_submission`) → the
           round was never delivered (no `/reload` since this
           iterate/implement submission). Bake, write the next round,
           `build`, `/reload`, then reset again. Only a round that truly ends
           without a new page sends `{"version": N, "no_round": "<reason>"}`.
         • Re-launch the pickup waker immediately after `/reset`, then report
           the outcome to the user. The visible panel reset happens via the
           `/reload`-triggered `location.reload()` in the browser — the page
           reloads onto the new iteration with a fresh ready panel. The
           `_processed_at` poll is only a safety-net for stuck states.

   **Why `/pending` and not a substring check on `/decisions`?** `json.dumps`
   emits `"submitted": true` with a space, so a literal substring test misses
   every submission; `/pending` is a strict boolean, parsed as JSON.

   **Side effect — submit-panel progress list.** The first `/pending=true`
   response also stamps `_picked_up_at` on the server. The browser reads
   that field from `/decisions` and advances the "Claude verarbeitet" step
   in the submitted panel — no extra Claude action required. For the
   implement branch, additionally POST `/status` once code changes are done
   (see SKILL.md Step 5b · implement, sub-step 3) so the third step
   ("Implementierung abgeschlossen") lights up before the page reloads.
   `/status` also takes an optional `"progress": {"done": n, "total": m}`
   (validated, transient, cleared with `_phase`) that the browser reads as
   `_progress` to draw the "Umsetzung n/m" bar; absent = indeterminate bar.

   The waker (below) makes the submit-to-process lag ~20 s; the cron's
   15-min cadence is the lag only when both watchers are gone.

   **The cron alone does NOT keep the indicator green — add TWO decoupled
   background tasks.** The page flips to "Claude nicht verbunden" as soon as
   Claude's last `/heartbeat` POST is older than `HEARTBEAT_STALE_MS` (90 s).
   Session-only crons fire ONLY while the REPL is idle and have multi-minute
   gaps, so the cron cannot be the keepalive.

   **Keepalive and pickup MUST be separate tasks.** A single watcher exits on
   pending to wake Claude, leaving nothing to pulse `/heartbeat` during a long
   `implement` — the indicator would go red exactly then.

   Launch both as **detached background tasks** (Bash tool,
   `run_in_background: true`, no trailing `&`, no `nohup`). Both are the same
   script in two modes — `scripts/concept-watch.js`, resolved the same way as
   the server in step 1.

   **Resolve the path INSIDE each launch command.** Every Bash tool call is a
   fresh shell (see § Troubleshooting), so a `WATCH=$(...)` assignment in one
   call is empty in the next — `node "" --mode pulse` dies in under 100 ms and,
   unlike every other launch in this document, does so silently.

   **(1) Keepalive pulser — pulses only, NEVER exits on pending.** Launched
   once at concept open; runs for the whole session so `claude_ts` stays warm
   even across a long `implement`. Exits only when the concept is truly gone:
   ```bash
   node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js 2>/dev/null | sort -V | tail -1)" --mode pulse --port {port} --state "{session-cwd}/.claude/concept-active.json" --owner {owner}
   ```

   **(2) Pickup waker — wakes Claude the instant a submission lands.** Its
   `exit 0` re-invokes the model immediately instead of waiting up to 60 s for
   the next cron tick. Re-launched after each processing round. It does NOT
   pulse the heartbeat (that is the pulser's job) — it only watches `/pending`:
   ```bash
   node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js 2>/dev/null | sort -V | tail -1)" --mode watch --port {port} --state "{session-cwd}/.claude/concept-active.json" --owner {owner}
   ```

   **Verify both actually started.** Their failure is otherwise silent. Read each task's output once after
   launching: a `*_EXIT reason=`
   line within seconds means it never got going. `STATE_NEVER_APPEARED` in
   particular means the launch outran step 4 — write the state file, then
   re-launch.

   **A script, never an inline `while true; do … sleep 20; done`.** `--state`
   is absolute, `--grace` (60 s) waits for the state file so the step 3 →
   step 4 order is safe, the port is compared numerically, and `node …` is
   covered by `Bash(node *)`.

   Behaviour is otherwise unchanged: both poll every ~20 s (well under the 90 s
   threshold), and **tolerate a slow or absent bridge**: requests wait up to 30 s (`--timeout`), the **pulser never exits on request
   failures** while the state file is there (it reconnects when the bridge
   is back or relaunched on the same port), and the waker reports
   `SERVER_DEAD` only after `--dead-after` (300 s) of continuous failure.
   **Cleanup verdicts are debounced** (`--confirm`, 3 polls): a tmp+rename on Windows
   briefly hides the file. A real end still takes the server down
   within ~1 min. **Two watchers of one kind on one port** find each other through the
   id echo (`POST /heartbeat?pulser=<id>` → `prev_pulser`,
   `GET /pending?waker=<id>` → `prev_waker`): the younger pulser exits
   `DUPLICATE_PULSER`, the OLDER waker exits `DUPLICATE_WAKER` (its owner is
   the superseded session; two wakers woke two Claudes for one submission) —
   `ss.concept.resume` re-arms the watchers on every session start, and on
   Windows the old detached tasks survive it.
   The exit lines (`PULSER_EXIT reason=…` / `WAKER_EXIT reason=…`) keep
   their shape, so the reason → action table in SKILL.md Step 5d applies
   verbatim.

   **The waker owns the monitoring duty (#363).** Three things the per-minute
   cron used to carry live in `--mode watch` now, token-free:
   - **Self-cleanup gate.** Every poll re-reads the state file: gone, foreign
     port, or `html_path` no longer on disk (resolved against the project
     root) ⇒ the waker POSTs `/shutdown` itself and exits `STATE_GONE` /
     `PORT_CHANGED` / `HTML_GONE`. No cron is needed for a dead concept to
     take its server down.
   - **Foreign-bridge guard (C1).** The bridge reports the absolute `--html`
     path as `html_path` on GET/POST `/heartbeat`, GET `/pending` and the
     side-effect-free GET `/identity`. When it differs from the state file's
     `html_path` (resolved against the project root), another session's
     bridge reused the port after ours died: both watchers exit
     `FOREIGN_BRIDGE port=N` without `/shutdown` and without waking as
     pending, and the concept-tick prints a `FOREIGN_BRIDGE:` instruction
     instead of the pending branch. Before a cleanup `/shutdown` the waker and
     the tick probe `/identity` and skip the shutdown for a foreign bridge
     (exit suffix ` bridge=foreign`). Unknown on either side (an older server,
     no `html_path` in the state file) is never foreign. The response to
     `FOREIGN_BRIDGE` is a restart on a **fresh** port — the same-port
     relaunch rule applies only to our own dead bridge.
   - **Page liveness.** The server keeps a per-tab registry: every browser
     poll (GET `/heartbeat`, GET `/reload`) carries the page's `?tab=<id>`,
     and a real unload beacons `POST /bye` (`pagehide`, persisted=false).
     `/pending` reports `browser_ts` (last poll from any tab),
     `browser_tabs` (tabs registered) and `browser_bye_ts`. The waker
     re-opens `http://localhost:{port}/{html_path}` in the user's Edge only
     when the user **closed the last tab**: no tab registered and a `/bye`
     after the last poll, 60 s ago (grace for a reload). Silence never
     reopens, however long — a throttled or Sleeping Tab is dropped from the
     registry after 15 min without being closed (#397). A tab that dies without a beacon is not reopened —
     the completion card prints the URL. Once per close, re-armed only after
     a tab is seen again. `--liveness 0` switches it off.
   - **Structured exit.** A submission exits with
     `WAKER_EXIT reason=PENDING_SUBMISSION version=N action=iterate|implement|finalize`
     (`/pending` carries the submission's `action`), so the woken Claude reads
     ONE line and branches on it instead of re-probing.

   **Lifecycle:** launch BOTH at concept open. On `PENDING_SUBMISSION` the
   waker exits and wakes Claude; Claude processes the payload and
   **re-launches only the waker** — immediately after `/reset` (SKILL.md 5c
   step 7), not at the end of the round. The pulser is still running and must
   not be duplicated (a second pulser on the same port is harmless but
   wasteful; if unsure, the pulser's `STATE_GONE`/`PORT_CHANGED` guards make a
   stale one exit on its own). No cron backs this up: re-launch
   early (the pulser's `WAKER_MISSING` wake covers a waker that died instead).

   **None of the three is pending work.** The server, the pulser and the waker
   run for the whole concept and never yield a result — they are the waiting
   itself. `stop.flow.guard` recognizes them (by `concept-server.py` /
   `concept-watch.js` in the command, or by the role the launch description
   names) and ignores them; a completion card must never list them under
   `pending`. A card rendered while the concept is open carries
   `concept: { phase }` instead (SKILL.md § Completion cards while the concept
   is open).

Steps 4 to 7 (active-concept state file, the attachment HTTP contract, the verified heartbeat round-trip, opening the page, cleanup) continue in [bridge-server-state.md](bridge-server-state.md).
