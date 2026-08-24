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
> **Never divide either side by 1000.** A snippet copied from elsewhere that
> assumes seconds-since-epoch (`claude_ts / 1000`, `Date.now() / 1000`) flips
> the staleness math negative and silently renders "Claude verbunden" forever
> while submissions rot in the bridge. This is the single most expensive
> silent-failure mode of the whole concept system, because neither the user
> nor Claude notices anything is wrong until days later.
>
> `_processed_at` and `_picked_up_at` are **ISO-8601 UTC strings** (parsed
> client-side via `Date.parse`). The split is deliberate: heartbeat math
> needs cheap numeric comparisons every 5 s, while the processed/pickup
> markers are read once per cycle and benefit from human-readable
> serialization in `/decisions` payloads.

1. Find the bridge server script:
   ```bash
   PLUGIN_ROOT=$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-server.py 2>/dev/null | head -1)
   ```

2. Start the bridge server in the **project root** (NOT the worktree root —
   the watchdog resolves `--html` against the cwd, and concept HTML lives in
   the main project tree):
   **Launch it via the Bash tool's `run_in_background: true`** — NOT
   `nohup … &` (or any `&`-backgrounded child) inside a single foreground
   Bash call. A child backgrounded inside one tool call is reaped when that
   call's shell is torn down, so the server dies a few calls later, mid-
   session, with no error — the page then silently loses its bridge. Only a
   detached background task survives across turns:
   ```bash
   # Bash tool, run_in_background: true  (no trailing &, no nohup)
   python "$PLUGIN_ROOT" {port} "{project-root}" \
       --html "docs/concepts/{date}-{slug}.html"
   ```

   **Pick the port via the cross-session registry — never a bare random number
   (Defect B: cross-session collision).** Two concurrent concept sessions in
   different worktrees that both picked the same random 8700-8999 port used to
   sweep and kill each other's live bridge. Every live bridge now advertises
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
   removes it on `/shutdown`; a hard-killed server leaves a stale entry that the
   picker ignores automatically (it gates on pid liveness, not file presence).

   **Sweep the port BEFORE launching — exactly one instance must own it.**
   A prior instance that did not fully die (its listening socket lingers in
   TIME_WAIT/CLOSE_WAIT) plus a fresh launch used to leave **two** servers
   bound to the same port (Windows permitted this via `SO_REUSEADDR`). `curl`
   then hit whichever accepted the connection — sometimes the healthy one
   (200), sometimes the wedged one (HTTP 000 / timeout) — surfacing as a
   connection indicator that flickers between connected and "Claude nicht
   verbunden" for no apparent reason.

   **The server now binds the port EXCLUSIVELY** (`SO_EXCLUSIVEADDRUSE` on
   Windows, `allow_reuse_address=False`; see `concept-server.py` §
   `ConceptBridgeServer`), so a silent double-bind can no longer happen — a
   duplicate launch instead **fails loudly** (`cannot bind port … exit 1`).
   That turns the old silent flicker into a clear error, but you still MUST
   sweep a lingering prior instance of YOUR OWN before launching — a socket
   stuck in TIME_WAIT would make the fresh bind fail.

   **Only ever sweep a port THIS session owns — NEVER a foreign one (Defect
   B).** The old guidance blindly `Stop-Process`-ed every listener on the port,
   which is exactly how one session killed another's live bridge. Gate the
   sweep on the registry: `can-claim` exits 0 when the port is free, ours, or
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
   "0.0.0.0:{port}"` → exactly one LISTENING row) before opening the browser.
   If the bind still fails because a foreign session grabbed the port in the
   race window, re-run `node "$REG" pick "{project-root}"` for a fresh port and
   retry — never force the sweep.

   **The server must be threaded.** `concept-server.py` uses
   `http.server.ThreadingHTTPServer` (not the single-threaded `HTTPServer`).
   A single-threaded server serves one request at a time, so the browser's
   own poll loops (it hits `/heartbeat`, `/decisions`, `/reload` every few
   seconds) plus the background watcher plus any manual `curl` collide: one
   slow or held connection blocks the serve loop and **every** subsequent
   request times out — the socket still accepts (LISTENING) but returns
   nothing, so `curl` reports HTTP 000 for 15 s+ and the page reads
   "Claude nicht verbunden" even though the process is alive. This is a
   distinct cause of HTTP 000 from the duplicate-instance case above; both
   present identically. If you ever fork the script, keep it threaded.
   `$PORT` is written to `.claude/concept-active.json` in step 6 so the
   SessionStart resume hook can find this server again after a Claude restart.

   **The `--html` flag is mandatory.** It arms the server-side watchdog:
   if the concept HTML file disappears for > 10 s, the watchdog terminates
   the bridge automatically — no orphan server can survive a manual
   `rm docs/concepts/…`, a failed disposition step, or a worktree wipe.
   The watchdog ALSO terminates if Claude's heartbeat goes stale for > 30
   min (`--heartbeat-timeout-ms` default `1800000`), catching the dead-cron
   case (session closed without /shutdown, cron prompt loop dropped). Both
   conditions independently guarantee the server cannot become a ghost.

   The 30 min default is calibrated for concept-review flows where the user
   may read, think, and annotate for an extended period before submitting —
   short idle pauses are expected and should not kill the server. Active
   coding sessions with a tighter watchdog requirement can pass a lower value
   (e.g. `--heartbeat-timeout-ms 300000` for 5 min) explicitly.

3. Set up the **combined heartbeat + auto-poll cron**. This single cron keeps
   the connection indicator green AND automatically picks up user submissions
   — no manual trigger needed from the user.

   **The prompt is two sentences — the procedure is a script.** Claude Code
   renders a cron's *entire* prompt text as its card in the background tasks
   panel, so the old inline body (gate + heartbeat + `curl | python -c` probe +
   the whole pending-branch procedure, 1128 characters) made one card fill the
   panel and hid every other background task from the user. Nothing was
   dropped: `scripts/concept-tick.js` performs every one of those steps and
   prints an instruction only on the ticks that need one, so an ordinary idle
   tick now costs zero tokens instead of re-reading the procedure every minute.

   **Resolve the script at run time, never bake in a versioned path.** A cron
   outlives a plugin rebuild: an in-session `/ship` writes the new version under
   a fresh `.../devops/<version>/` directory and deletes the old one, so an
   absolute path baked into the prompt dangles from that moment and every tick
   fails MODULE_NOT_FOUND — once a minute, silently, for the rest of the
   session. In the versioned cache layout emit the same `ls -d … | head -1`
   prefix `ss.git.sync` uses (the rebuild leaves exactly one version directory,
   so the glob is unambiguous), with the literal path as the fallback:
   `f="$(ls -d "{cache-root}/devops"/*/scripts/concept-tick.js 2>/dev/null | head -1)"; node "${f:-{literal}}"`.
   A dev/marketplace checkout has no version directory and just uses the
   literal path, which is the form shown below.

   ```
   CronCreate(cron: "* * * * *", recurring: true, prompt: <<EOF
   Silently run via Bash: node "{plugin-root}/scripts/concept-tick.js" --port {port} --state "{project-root}/.claude/concept-active.json" — this services the concept bridge on port {port}. No output → produce NO output (silent tick). Any output IS your instruction for this tick: follow it exactly.
   EOF)
   ```

   **Two phrasings in that prompt are load-bearing — do not tidy them up.**
   - It MUST **start** with `Silently run`. The `prompt.flow.silent-turn` hook
     marks a cron tick as a silent turn only when the prompt *opens* with a
     silence marker. Put anything in front of it — a `Concept bridge, port N — `
     lead-in reads nicely and is exactly the trap — and every tick is treated as
     a real user turn: the completion-card reminder fires and the stop hook
     blocks the turn to force a card, once a minute, for the whole session.
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
         - `state.html_path` does not exist on disk (resolved against the
           state file's grandparent, i.e. the project root).
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

   (1) **Heartbeat POST** to `/heartbeat`. A failure here is reported on
       stderr only, never as an instruction: bridge liveness is owned by the
       keepalive pulser and the server-side `--html` watchdog, and a per-tick
       complaint about a dying bridge would spam the transcript once a minute.

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
             - "finalize"       → the final report's close-out wizard, ONE
                                  payload carrying issues{} + ship{} +
                                  disposition{}. Run the selected parts in a
                                  FIXED order: (A) issues — user-value gate
                                  (merges combination-only items silently),
                                  then `gh issue create` per gated item;
                                  (B) ship — the full /ship pipeline, stop +
                                  report on a hard gate failure and skip (C);
                                  (C) Step 6 cleanup with the disposition
           Legacy pages generated before the wizard still send "create-issues",
           "ship" or "dispose-concept" one at a time — map each onto the
           matching part above (SKILL.md § Legacy final-report actions).
           Process per Step 5 (Live Feedback Loop) — act on the user's choices
           (approve/tweak/reject, included options, comment-driven tweaks).
           Step 5c writes the new iteration to the HTML file and POSTs
           `/reload` BEFORE the reset below. Reset is the LAST action.

         • **Zero-prompt invariant for finalize (and its legacy variants).**
           This branch MUST complete end-to-end without asking the user
           anything. The payload (issues.items[], ship.run, disposition{}) is
           self-sufficient by design; any missing optional field falls back to
           a sane default. If you catch yourself reaching for AskUserQuestion,
           stop — the answer is in the payload, the concept HTML, or the
           project's new-issue extension. The user signed off on the wizard's
           review screen, which named every consequence before the click.
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
         • Re-launch the pickup waker immediately after `/reset`, then report
           the outcome to the user. The visible panel reset happens via the
           `/reload`-triggered `location.reload()` in the browser — the page
           reloads onto the new iteration with a fresh ready panel. The
           `_processed_at` poll is only a safety-net for stuck states.

   **Why `/pending` and not a substring check on `/decisions`?** The
   `/decisions` JSON response is formatted via Python's default `json.dumps`,
   which emits `"submitted": true` **with** a space after the colon — a literal
   `contains "submitted":true` test silently misses every submission.
   `/pending` collapses the signal to a strict boolean, and `concept-tick.js`
   parses it as JSON rather than string-matching it, so the check cannot drift
   into false negatives between ticks.

   **Why a script and not a Read per tick.** The other way to shorten the
   prompt would be to have the cron read the procedure from a file. That costs
   tokens on *every* tick, and the idle tick is the overwhelmingly common case
   — a submission arrives once every few minutes at best. A Bash call that
   prints nothing costs nothing, and it replaces the TWO curl calls the old
   body already made per tick, so this is strictly cheaper than what it
   replaced rather than a new per-tick cost.

   **Side effect — submit-panel progress list.** The first `/pending=true`
   response also stamps `_picked_up_at` on the server. The browser reads
   that field from `/decisions` and advances the "Claude verarbeitet" step
   in the submitted panel — no extra Claude action required. For the
   implement branch, additionally POST `/status` once code changes are done
   (see SKILL.md Step 5b · implement, sub-step 3) so the third step
   ("Implementierung abgeschlossen") lights up before the page reloads.

   **Why combined, not two crons?** One cron minimizes race conditions and makes
   the contract explicit: every tick does both. Minimum cron resolution is 1 min,
   so the max submit-to-process lag is ~60 s — acceptable for interactive flows.

   **The cron alone does NOT keep the indicator green — add TWO decoupled
   background tasks.** The page flips to "Claude nicht verbunden" as soon as
   Claude's last `/heartbeat` POST is older than `HEARTBEAT_STALE_MS` (90 s).
   The once-a-minute cron is the documented keepalive, but session-only crons
   fire ONLY while the REPL is idle and have multi-minute gaps in practice
   (observed: a 638 s gap with the cron registered and the session idle) — so
   during normal reading/thinking the indicator goes red.

   **Keepalive and pickup MUST be separate tasks.** The naive single watcher
   (pulse + `exit 0` on pending) has a load-bearing flaw: `exit 0` is how it
   wakes Claude, so the instant a submission lands the watcher is *gone* — and
   for an `implement` submission Claude then processes for many minutes with
   NOTHING pulsing `/heartbeat` (the idle-only cron can't fire during a busy
   `implement` turn). The indicator goes red *precisely during implementation*
   — exactly when the user is watching for progress. Splitting the two roles
   removes that coupling.

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
   node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js 2>/dev/null | head -1)" --mode pulse --port {port} --state "{project-root}/.claude/concept-active.json"
   ```

   **(2) Pickup waker — wakes Claude the instant a submission lands.** Its
   `exit 0` re-invokes the model immediately instead of waiting up to 60 s for
   the next cron tick. Re-launched after each processing round. It does NOT
   pulse the heartbeat (that is the pulser's job) — it only watches `/pending`:
   ```bash
   node "$(ls -d ~/.claude/plugins/cache/dotclaude/devops/*/scripts/concept-watch.js 2>/dev/null | head -1)" --mode watch --port {port} --state "{project-root}/.claude/concept-active.json"
   ```

   **Verify both actually started.** They are the only launches in this document
   whose failure would be silent — the server has a heartbeat round-trip, the
   port has a single-listener assert, the page has a 200-gate, and these had
   nothing. Read each task's output once after launching: a `*_EXIT reason=`
   line within seconds means it never got going. `STATE_NEVER_APPEARED` in
   particular means the launch outran step 4 — write the state file, then
   re-launch.

   **Why a script and not an inline `while true; do … sleep 20; done`.** The
   loop shape is easy to write and was wrong in four independent ways, each of
   which silently reproduced the bug the watchers exist to prevent:
   - it tested a **relative** `.claude/concept-active.json`, but this document
     mandates the state file at the project root, which is not always the
     task's cwd — both watchers then exited `STATE_GONE` on iteration 1;
   - it was launched here, in step 3, **before** step 4 writes that file, so a
     literal reading killed both at t=0. `--state` is absolute and `--grace`
     (60 s) waits for the file instead of treating its absence as terminal, so
     the step 3 → step 4 order is safe as written;
   - its port guard `grep -qE '"port"…\b'` depended on JSON spacing and on
     `\b`, a GNU extension — on BSD/macOS grep it never matched, so both
     watchers exited `PORT_CHANGED` immediately. The script compares the port
     numerically;
   - `allowed-tools` matches command *prefixes*, and a multi-line loop has no
     usable prefix, so the only grant that covered it was a blanket one. A
     `node …` invocation is already covered by `Bash(node *)`.

   Behaviour is otherwise unchanged: both poll every ~20 s (well under the 90 s
   threshold), and **tolerate transient blips** — `SERVER_DEAD` only after ≥4
   consecutive failures, because a single failed request (server busy, a
   competing request, a duplicate-instance wedge per step 2) must NOT tear a
   task down, or the page goes stale on every hiccup. Both self-terminate when
   the state file is gone, its port changed, or the server is truly
   unreachable, so neither can become a ghost (the `--html` watchdog still
   backs them up). The exit lines (`PULSER_EXIT reason=…` / `WAKER_EXIT
   reason=…`) are unchanged, so the reason → action table in SKILL.md Step 5d
   applies verbatim.

   **Lifecycle:** launch BOTH at concept open. On `PENDING_SUBMISSION` the
   waker exits and wakes Claude; Claude processes the payload and
   **re-launches only the waker** — immediately after `/reset` (SKILL.md 5c
   step 7), not at the end of the round. The pulser is still running and must
   not be duplicated (a second pulser on the same port is harmless but
   wasteful; if unsure, the pulser's `STATE_GONE`/`PORT_CHANGED` guards make a
   stale one exit on its own). Keep the cron too — but as a **partial** backup
   only: it fires solely while the REPL is idle, so it cannot cover the window
   between the waker exiting and being re-launched, because during a
   processing round the REPL is busy. That window is closed by re-launching
   early, not by the cron.

4. **Persist active-concept state.** Write `.claude/concept-active.json` in
   the project root with the metadata the SessionStart resume hook
   (`ss.concept.resume`) needs to recover this concept after a Claude
   restart. Do this BEFORE the first heartbeat — once the file exists, any
   subsequent SessionStart can rediscover the running server.

   ```json
   {
     "port": 8742,
     "html_path": "docs/concepts/2026-04-12-auth-middleware-redesign.html",
     "slug": "auth-middleware-redesign",
     "server_pid": 12345,
     "cron_id": "ab12cd34",
     "started_at": "2026-04-12T14:30:00.000Z"
   }
   ```

   - `port` — the bridge port chosen in step 2.
   - `html_path` — relative path inside the project; the hook uses it to
     verify the concept file still exists.
   - `slug` — kebab-case topic from the filename, used in resume messaging.
   - `server_pid` — captured via `echo $!` after the `python … &` launch.
   - `cron_id` — the ID `CronCreate` returned in step 3. A new session
     refreshes the polling cron, the old ID is just informational (the old
     session-only cron died with the prior session and cannot be reaped).
   - `started_at` — ISO-8601 UTC. Lets the hook age-out stale state after
     ~24 h even if cleanup did not run.

   Path: ALWAYS `<project-cwd>/.claude/concept-active.json` (NOT a worktree
   subpath, NOT under `docs/`). The hook reads this exact path and silently
   exits when missing. Create `.claude/` if needed; do not commit the file
   (add `concept-active.json` to `.gitignore` if not already covered by
   `.claude/`).

4b. **The durable store — nothing to launch, but know it exists (#284).**
   The server creates `.claude/concepts/<html-basename>/` on startup, derived
   from `--html`, and **refuses to start (exit 1) if it cannot write there**.
   That is deliberate: a bridge without durability looks perfectly healthy
   right up until it eats a submission, so the failure belongs at launch time
   where the 200-gate and the single-listener assert already catch problems.
   Override the location with `--store <path>` only if you have a reason to.

   ```
   .claude/concepts/{date}-{slug}/
     journal.jsonl    append-only, fsynced: submissions, pickups, progress
                      checkpoints, attachments, resets, teardowns
     state.json       atomically-replaced snapshot; restored on boot
     attachments/     <sha256>.<ext> — pasted/dropped/uploaded files, any
                      type (#312). Extension is derived, never trusted
                      verbatim — see § Attachment HTTP contract.
       index.json     id -> {name, mime, size, sha256, added_at} — the
                      only place the ORIGINAL filename survives; the
                      on-disk name is purely content-addressed.
     UNPROCESSED      present iff a submission has not been processed yet
   ```

   What this buys, concretely: `POST /decisions` fsyncs the payload BEFORE it
   acks the browser, and the server reloads `state.json` on boot. A bridge
   that dies for any reason — PC restart, crash, or the watchdog reaping it
   because Claude hit a usage limit and the session-scoped pulser stopped
   heartbeating — comes back serving the SAME `pending: true` and the same
   `_version`. Before this, `GET /pending` answered `false` afterwards, which
   is indistinguishable from "the user never submitted".

   **Restart on the same port, always.** The store is keyed to the concept,
   not the port, but the open tab and `concept-active.json` both point at the
   old port. A new port orphans them and makes fresh watchers exit
   `PORT_CHANGED`.

   **Ask the server where you stand** before processing anything on a resumed
   session:
   ```bash
   curl -s http://localhost:{port}/recovery
   ```
   It returns `{unprocessed, version, marker, progress[], last_checkpoint,
   attachments[]}`. A non-null `marker` means the previous process was torn
   down hard rather than exiting cleanly.

   **Checkpoint as you process.** For `implement` and for each part of a
   `finalize`, POST each real artifact as it comes into existence. Namespace
   the `action` per finalize part (`finalize:issues`, `finalize:ship`,
   `finalize:cleanup`) — a bare `"ship"` is indistinguishable from a legacy
   stand-alone ship submission, and a resumed session would then stop after
   verifying the release instead of running the cleanup part:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
     -d '{"action":"finalize:ship","step":"pr-opened","status":"done","version":<v>,"artifacts":{"branch":"feat/x","pr":42}}' \
     http://localhost:{port}/progress
   ```
   A recovered run reads these to find out how far the dead run got — and
   then **verifies each artifact against reality** (`git rev-parse`,
   `gh pr view`, `gh issue view`) before continuing, because the checkpoint
   records what the previous run believed, and it died for a reason. The
   checkpoint says where to look; git and gh say what is true.

   The store is disposed of by SKILL.md § Step 6a alongside the concept HTML —
   `discard` removes the whole directory, guarded so an `UNPROCESSED` marker
   is never deleted silently.

4c. **Attachment HTTP contract (#312).** The bridge accepts arbitrary file
   attachments — "basically any file type, size does not matter" — through
   two request shapes on the SAME endpoint, `POST /attachments`, dispatched
   on `Content-Type`. Both shapes return the identical response body on
   success, so a client implementer only needs to pick a shape once, per
   file size, and everything downstream (read-back URL, dedup handling) is
   the same.

   **Limits and how to change them.**

   | Constant                       | Default   | CLI flag                          | Env var                              |
   |---------------------------------|-----------|------------------------------------|----------------------------------------|
   | Per-file cap (streaming path)   | 256 MiB   | `--max-attachment-bytes <n>`       | `CONCEPT_MAX_ATTACHMENT_BYTES`         |
   | Total store cap (all files)     | 4 GiB     | `--max-attachment-total-bytes <n>` | `CONCEPT_MAX_ATTACHMENT_TOTAL_BYTES`   |
   | Per-file cap (legacy JSON path) | 32 MiB    | *(fixed, not configurable)*        | *(fixed, not configurable)*            |
   | `/decisions` payload cap        | 32 MiB    | *(fixed — JSON only carries references now, not blobs)* | |

   Resolution order for the two configurable caps: CLI flag > env var >
   default. The legacy base64-in-JSON path is memory-bound (the whole file
   is base64-decoded into RAM before it touches disk), so it keeps its own
   fixed, lower 32 MiB cap regardless of `--max-attachment-bytes` — files
   above that MUST use the streaming path.

   Before accepting any upload the server checks free disk space on the
   store volume (`shutil.disk_usage`) against the declared/decoded size plus
   a 64 MiB safety margin, and refuses with `507 disk_full` if it would not
   fit — this protects `state.json`/`journal.jsonl` from landing a write on
   a full disk mid-mutation.

   **Shape A — legacy base64-in-JSON** (existing pages; kept working
   unchanged). `Content-Type: application/json` (or no `Content-Type` at
   all — an empty header also routes here):
   ```json
   POST /attachments
   Content-Type: application/json

   {"name": "shot.png", "mime": "image/png", "data": "<base64>"}
   ```
   Rejects a decoded payload above 32 MiB with `413` and a `hint` field
   pointing at Shape B.

   **Shape B — streaming raw body** (any Content-Type other than
   `application/json`, e.g. the file's real MIME or
   `application/octet-stream`). Metadata travels in headers instead of the
   JSON envelope so the body can be piped straight to disk without ever
   being fully materialised in memory:
   ```
   POST /attachments
   Content-Type: application/octet-stream        (or the file's real MIME)
   X-Attach-Name: spec.pdf                        (percent-encoded UTF-8,
                                                    i.e. encodeURIComponent(name))
   X-Attach-Mime: application/pdf
   Content-Length: 8421553                        (REQUIRED — no chunked
                                                    transfer-encoding support;
                                                    the cap and disk-space
                                                    checks both run against
                                                    this value BEFORE any
                                                    body byte is read)

   <raw file bytes>
   ```
   Server behaviour: reads the body in ~1 MiB chunks into a temp file
   (`attachments/.upload-<uuid>.tmp`) inside the store dir, hashing with
   `sha256` as it streams — the process never holds the full file in memory.
   `Content-Length > MAX_ATTACHMENT_BYTES` is rejected with `413`
   immediately, before any read. A missing `Content-Length` is rejected with
   `411`. On success the temp file is `fsync`ed then `os.replace`d onto the
   content-addressed final name; on ANY failure (client aborts mid-upload,
   the per-file cap is exceeded, the disk fills, a dedup hit makes the temp
   file redundant) the temp file is removed — no orphaned `.tmp` is ever
   left in the store, even across a hard kill (a leftover `.upload-*.tmp`
   from an unclean process death is swept at the NEXT server startup, since
   it was never finalised — no journal line, no quota accounting — so
   discarding it is always safe).

   **Response — identical for both shapes:**
   ```json
   {
     "ok": true,
     "durable": true,
     "id": "<sha256>.<ext>",
     "sha256": "<sha256>",
     "mime": "image/png",
     "size": 8421553,
     "url": "/attachments/<sha256>.<ext>",
     "deduplicated": false
   }
   ```
   `deduplicated: true` means the sha256 already existed on disk — the
   upload was a no-op past the hash compare, no bytes were rewritten, and
   quota was not incremented a second time. This applies across BOTH shapes:
   the same content uploaded once via Shape A and again via Shape B (or
   under an entirely different claimed filename) still resolves to one file
   and one quota charge.

   **Error responses** (`{"ok": false, "reason": "...", ...}` JSON body,
   except `411`/`403` which use the plain `send_error` HTML body):

   | Status | `reason`             | When | Extra fields |
   |--------|-----------------------|------|---------------|
   | 400    | `empty`               | zero-byte upload (both shapes) | |
   | 400    | `bad_json`            | Shape A body is not valid JSON | |
   | 400    | `bad_base64`          | Shape A `data` does not decode | |
   | 400    | `bad_content_length`  | Shape B `Content-Length` is not an integer | |
   | 400    | `client_aborted`      | Shape B: connection closed before all declared bytes arrived | `detail` |
   | 403    | *(none — `send_error`)* | cross-origin request (see § same-origin gate below) | |
   | 411    | `length_required`     | Shape B has no `Content-Length` header | |
   | 413    | `too_large`           | over the applicable per-file cap | `size`\*, `max_bytes`, `hint`\*\* |
   | 507    | `disk_full`           | free space would drop below the safety margin | `free_bytes`, `needed_bytes` |
   | 507    | `quota_exceeded`      | would exceed `MAX_ATTACHMENT_TOTAL_BYTES` | `total_bytes`, `max_total_bytes` |
   | 507    | `store_write_failed`  | write/rename failed for a reason other than disk-full | `detail` |
   | 507    | `store_unavailable`   | the durable store itself failed to initialise at boot | |

   \* `size` is present when the actual/decoded size is known (Shape A, or
   Shape B's declared `Content-Length` check); \*\* `hint` is present only
   when the legacy path's fixed 32 MiB cap was hit, pointing at Shape B.

   **Same-origin gate.** `POST /attachments` uses the same `_same_origin_ok`
   check as `/reload` and `/shutdown`: no `Origin` header (curl, Claude's own
   requests) or an `Origin` matching the bridge's own host/localhost/127.0.0.1
   is accepted; anything else gets a bare `403`.

   **`GET /attachments/<sha256>.<ext>` — serving policy.** The identifier is
   shape-validated (`^[0-9a-f]{64}\.[a-z0-9]{1,12}$`) before it ever touches
   the filesystem — traversal-proof regardless of stored extension. Only the
   four raster image types are ever served **inline**:

   | Extension | Content-Type |
   |-----------|---------------|
   | `.png`  | `image/png`  |
   | `.jpg`  | `image/jpeg` |
   | `.gif`  | `image/gif`  |
   | `.webp` | `image/webp` |

   For those four, the response is `Content-Type: <real mime>` +
   `Content-Disposition: inline`. **Every other extension** — `.svg`,
   `.html`, `.js`, `.pdf`, office formats, archives, media, anything with an
   unrecognised or absent extension (`.bin`) — is always served as
   `Content-Type: application/octet-stream` with
   `Content-Disposition: attachment; filename="<sanitised original name>";
   filename*=UTF-8''<percent-encoded original name>` (RFC 5987, so non-ASCII
   names still round-trip in browsers that support the extended parameter,
   with a safe ASCII fallback for those that don't). `filename` comes from
   `attachments/index.json` when known, falling back to the blob id.
   `X-Content-Type-Options: nosniff` is set on EVERY response, inline or not.

   This is what replaces the old outright SVG ban: an uploaded SVG (or HTML
   or JS file) can only execute script against the bridge's own origin if
   the browser renders it in place, and a forced download served as an inert
   content-type can't do that — so accepting the type and controlling how
   it's served is strictly safer than a growing list of type-specific
   rejections, and it is what makes "basically any file type" possible
   without reopening the XSS risk the old allowlist existed to close.

   **Stored extension derivation.** Never trusts the client's filename
   extension blindly — only its *shape*. Given the client-supplied `name`
   and `mime`: (1) if `name` contains a `.`, take the substring after the
   last `.`, lowercase it, and use it if it matches `^[a-z0-9]{1,12}$`;
   (2) else if the declared `mime` is one of the four raster types above,
   use that type's canonical extension; (3) else fall back to Python's
   stdlib `mimetypes.guess_extension(mime)` if it produces something matching
   the same shape; (4) else `.bin`. The stored filename is always
   `<sha256><ext>` — the client-supplied name is NEVER used as a filesystem
   path component, only as free text in `index.json` and the
   `Content-Disposition` header.

   **`attachments/index.json`.** The blob store is purely content-addressed,
   so the original filename would otherwise be unrecoverable outside the
   journal. `index.json` is a flat `{ "<id>": {"name", "mime", "size",
   "sha256", "added_at"} }` map, read-modify-write merged (never replaced
   wholesale) and atomically written (`_durable_write`: tmp + fsync +
   `os.replace`) under the SAME `_attachment_quota_lock` that already
   serialises quota-check → write → accounting for attachments — so
   concurrent uploads under `ThreadingHTTPServer` cannot race each other's
   index entries. Entries are written only for a NEW blob (a dedup hit
   leaves the original entry as-is). `GET /recovery`'s `attachments[]` now
   also carries `name`/`mime` from this index for each entry, so a resumed
   session can say "you attached spec.pdf" instead of a hash.

5. **Verified heartbeat round-trip.** A naked `POST /heartbeat` with no
   read-back is not enough — if the server failed to bind, never started,
   or crashed on the first request, the POST exits 0 and the next step
   opens a tab against a dead bridge with no error surfaced. The whole
   concept session then sits behind a green "Claude verbunden" indicator
   that never actually was true.

   Do a **pre/post compare**, not just `claude_ts > 0`. A bare check
   passes on any process that has ever seen a heartbeat — including a
   stale bridge left running on the same port from a prior session. We
   need proof that *our* POST landed on the running handler.

   ```bash
   # (a) Read claude_ts BEFORE our POST.
   pre=$(curl -s --max-time 3 http://localhost:$PORT/heartbeat \
     | python -c "import sys,json; print(int(json.load(sys.stdin).get('claude_ts') or 0))" \
     2>/dev/null)
   pre=${pre:-0}

   # (b) Send Claude pulse.
   curl -s -X POST http://localhost:$PORT/heartbeat > /dev/null

   # (c) Read claude_ts AFTER our POST. The server returns ms since epoch
   #     (same units as JS Date.now()) — see § Timestamp unit convention
   #     above. Our POST must have advanced the timestamp; if post <= pre,
   #     either the POST never landed on the intended fresh bridge or the
   #     bridge is wedged.
   post=$(curl -s --max-time 3 http://localhost:$PORT/heartbeat \
     | python -c "import sys,json; print(int(json.load(sys.stdin).get('claude_ts') or 0))" \
     2>/dev/null)
   post=${post:-0}

   if [ "$post" -le "$pre" ]; then
     echo "Bridge server on port $PORT did not advance claude_ts ($pre -> $post) — aborting."
     kill $SERVER_PID 2>/dev/null
     rm -f .claude/concept-active.json
     # Tell the user; DO NOT proceed to step 6 (opening the browser would
     # land on a dead or stale bridge).
     exit 1
   fi
   ```

   The 3-second timeout matters: a hung TCP connect is the failure mode
   we are trying to catch, not a slow JSON response. If you cannot run
   the `python -c` snippet for some reason (locked-down environment),
   substitute any tool that parses the JSON and compares `claude_ts`
   numerically — never accept HTTP 200 alone, because the daemon
   self-pulse keeps `server_ts` fresh even when the request-handling
   thread is wedged.

6. **Verify the concept URL serves 200, THEN open it in the user's real
   Edge browser** (reuses the running instance, adds a tab). Both halves are
   non-negotiable. The 200-gate exists because opening a tab on a 404 IS the
   "concept url not found" the user sees, and that 404 has three independent
   causes the bare open command cannot tell apart:
   - wrong URL path — a bare filename instead of the full project-relative
     `{html_path}` (`SimpleHTTPRequestHandler` serves from the server's cwd,
     so `/foo.html` 404s when the file is at `docs/concepts/foo.html`);
   - the server's cwd does not contain `{html_path}` — e.g. the bridge was
     started in the worktree root while the HTML was written to the main
     project tree, or vice-versa;
   - empty `{port}`/`{html_path}` — the values were left as shell vars that
     did not survive into this command, collapsing the URL to
     `http://localhost:/`.

   Gate the open on a real 200 so any of these aborts loudly with the
   offending URL instead of opening a silent broken tab:

   ```bash
   # Substitute {port} and {html_path} with CONCRETE literal values — do NOT
   # rely on $PORT/$HTML_PATH surviving from an earlier command; each Bash
   # tool call is a fresh shell with no inherited state.
   URL="http://localhost:{port}/{html_path}"
   CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$URL")
   if [ "$CODE" != "200" ]; then
     echo "Concept URL $URL -> HTTP $CODE (expected 200) - NOT opening a tab."
     echo "Fix: ensure the bridge server's cwd is the project root holding {html_path}, and that {port}/{html_path} are concrete values."
     exit 1
   fi

   # Windows (primary target)
   start "" msedge "$URL"
   ```
   On macOS: `open -a "Microsoft Edge" "$URL"`, on Linux: `microsoft-edge "$URL" &`.

   The empty `""` is required on Windows — without it, `cmd.exe` interprets
   the first quoted argument as a window title.

   **NEVER substitute one of these instead of the shell command above:**
   - `mcp__Claude_Preview__preview_start` / `preview_*` — sandboxed iframe,
     no heartbeat, user cannot use it as the concept page.
   - `mcp__plugin_playwright_playwright__browser_navigate` — opens a
     separate Playwright-controlled browser the user does not see.
   - Just printing the `http://localhost:{port}/…` URL to the user — the
     user expects the page to open automatically, not to copy-paste a URL.

   If `start "" msedge …` exits non-zero (Edge missing / not in PATH),
   surface the exact error to the user and ask them how to proceed
   (Edge protocol handler `start microsoft-edge:"http://…"`, manually
   pasting the URL, or another installed browser). Do NOT silently fall
   back to the preview MCP — the concept flow needs a real visible
   browser window with an active tab.

7. After monitoring ends (user says "fertig"/"done", aborts, finishes the
   final report's close-out wizard, or Step 6 of SKILL.md fires the
   completion card), run the bridge-side cleanup:
   ```bash
   # Graceful shutdown via HTTP — survives PID recycling on Windows where
   # `kill $SERVER_PID` may target a process that already exited and got
   # its PID reused by an unrelated program. The server replies 200 then
   # calls os._exit(0); the listening socket is released within ~100 ms.
   curl -s -X POST http://localhost:$PORT/shutdown > /dev/null 2>&1 || true
   rm -f .claude/concept-active.json
   ```
   Also delete the polling cron via `CronDelete <cron_id>`. The state file
   MUST be removed when the concept session is intentionally ended,
   otherwise the next SessionStart will surface a phantom resume hint for a
   server that no longer exists.

   **Fallback if /shutdown fails.** If the curl POST returns non-zero (server
   already dead, port unbound, etc.) just continue — the state file removal
   and cron deletion still need to happen. A PID-kill is no longer required
   because the watchdog (added in step 2) would terminate any surviving
   process within 30 s when the cron stops POSTing heartbeats.

   The **on-disk concept artefacts** (`docs/concepts/{date}-{slug}.html`
   and the matching `-decisions.json`) are handled by `SKILL.md` § Step 6a
   — Cleanup-By-Disposition. The bridge-side cleanup above is concerned
   only with the server / state file / cron; disposition of the HTML
   itself is driven by the user's final-report choice (`discard` /
   `keep` / `gitignore` + optional `moveTo`) and runs as part of the
   same Step 6 in SKILL.md.
