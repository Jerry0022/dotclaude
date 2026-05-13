# Concept Bridge Server + Edge

The **concept bridge server** (`scripts/concept-server.py`) serves static files
AND provides HTTP endpoints for heartbeat and decision exchange.

> **Timestamp unit convention (read before writing any client code).**
> Every timestamp the server exposes — `server_ts`, `claude_ts`, `ts` —
> is **milliseconds since the Unix epoch**, byte-compatible with JavaScript's
> `Date.now()`. The browser compares them directly, with no conversion:
> ```js
> Date.now() - _lastHeartbeatTs < HEARTBEAT_STALE_MS   // both in ms
> ```
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

2. Start the bridge server in the concept directory:
   ```bash
   python "$PLUGIN_ROOT" {random-port} "{concept-dir}" &
   ```
   Use a random port (8700-8999) to avoid conflicts. Store the port as `$PORT`
   and the spawned background PID as `$SERVER_PID` (`echo $!` immediately
   after the `&`-launch). Both are written to `.claude/concept-active.json`
   in step 6 so the SessionStart resume hook can find this server again
   after a Claude restart.

3. Set up the **combined heartbeat + auto-poll cron**. This single cron keeps
   the connection indicator green AND automatically picks up user submissions
   — no manual trigger needed from the user.

   ```
   CronCreate(cron: "* * * * *", recurring: true, prompt: <<EOF
   Silently run both steps for the concept bridge on port {port}:

   (1) Heartbeat POST:
       Bash: curl -s -X POST http://localhost:{port}/heartbeat > /dev/null

   (2) Pending check — use the deterministic /pending endpoint, NOT a
       substring match on /decisions. The response is a strict JSON object
       `{"pending": true|false, "version": N}` with no free-form content.
       Bash (produces ONLY the literal string "true" or "false"):
         curl -s http://localhost:{port}/pending | python -c "import sys,json; d=json.load(sys.stdin); print('true' if d.get('pending') else 'false')"

       If the output is exactly "false" → produce NO user-visible output. Silent tick.

       If the output is exactly "true" → fetch the full payload and process:
         Bash: curl -s http://localhost:{port}/decisions
         • Parse the JSON. Note `_version`. Strip `_version` and `_processed_at`
           before treating the rest as decision data.
         • Process per Step 5 (Live Feedback Loop) — act on the user's choices
           (approve/tweak/reject, included options, comment-driven tweaks).
           Step 5c writes the new iteration to the HTML file and POSTs
           `/reload` BEFORE the reset below. Reset is the LAST action.
         • After the file rewrite AND the `/reload` POST have completed,
           reset conditionally — pass the noted version:
           Bash: curl -s -o /dev/null -w "%{http_code}" -X POST \
                       -H "Content-Type: application/json" \
                       -d '{"version": <noted>}' http://localhost:{port}/reset
         • If the HTTP code is 409 (version mismatch) → the user submitted
           again while you were processing. Re-fetch /decisions, process the
           new payload (which supersedes what you just finished), then retry
           the conditional reset with the new `_version`.
         • Report the outcome to the user. The visible panel reset happens
           via the `/reload`-triggered `location.reload()` in the browser —
           the page reloads onto the new iteration with a fresh ready panel.
           The `_processed_at` poll is only a safety-net for stuck states.
   EOF)
   ```

   **Why `/pending` + `python -c` instead of a substring check?** The
   `/decisions` JSON response is formatted via Python's default
   `json.dumps`, which emits `"submitted": true` **with** a space after the
   colon — a literal `contains "submitted":true` test silently misses every
   submission. `/pending` collapses the signal to a strict boolean so the
   cron body cannot drift into false negatives between ticks.

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

6. Open in Edge (reuses the running instance, adds a tab):
   ```bash
   # Windows
   start "" msedge "http://localhost:{port}/{filename}"
   ```
   On macOS: `open -a "Microsoft Edge" "http://…"`, on Linux: `microsoft-edge "http://…"`.

   The empty `""` is required on Windows — without it, `cmd.exe` interprets
   the first quoted argument as a window title.

7. After monitoring ends (user says "fertig"/"done", aborts, or Step 6 of
   SKILL.md fires the completion card), clean up in this order:
   ```bash
   kill $SERVER_PID 2>/dev/null  # or `kill %1` if still in shell scope
   rm -f .claude/concept-active.json
   ```
   Also delete the polling cron via `CronDelete <cron_id>`. The state file
   MUST be removed when the concept session is intentionally ended,
   otherwise the next SessionStart will surface a phantom resume hint for a
   server that no longer exists.
