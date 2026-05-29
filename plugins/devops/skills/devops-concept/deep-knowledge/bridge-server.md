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

2. Start the bridge server in the **project root** (NOT the worktree root —
   the watchdog resolves `--html` against the cwd, and concept HTML lives in
   the main project tree):
   ```bash
   python "$PLUGIN_ROOT" {random-port} "{project-root}" \
       --html "docs/concepts/{date}-{slug}.html" &
   ```
   Use a random port (8700-8999) to avoid conflicts. Store the port as `$PORT`
   and the spawned background PID as `$SERVER_PID` (`echo $!` immediately
   after the `&`-launch). Both are written to `.claude/concept-active.json`
   in step 6 so the SessionStart resume hook can find this server again
   after a Claude restart.

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

   ```
   CronCreate(cron: "* * * * *", recurring: true, prompt: <<EOF
   Silently service the concept bridge on port {port}.

   (0) Self-cleanup gate (FIRST step every tick).
       Read `.claude/concept-active.json` from the project root. Cleanup
       triggers when ANY of these is true:
         - The state file is missing.
         - State.port ≠ {port} (this cron is for a stale session — a
           newer concept overwrote the state file with a different port).
         - State.html_path does not exist on disk.
       On trigger:
         - Bash: curl -s -X POST http://localhost:{port}/shutdown > /dev/null 2>&1 || true
         - Then call CronDelete with the id from the (still-readable)
           state file's `cron_id` field — OR, if the state file is gone
           entirely, list crons via CronList and delete every cron whose
           prompt mentions `port {port}` (a missing state file proves
           the session is unrecoverable; sweeping by-port catches the
           orphan even when the id is lost).
       Produce NO user-visible output. Skip steps 1 and 2.

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
           before treating the rest as decision data. Read `action` — it is
           one of FOUR values, each with its own SKILL.md Step 5b branch:
             - "iterate"        → next iteration on the concept page only
             - "implement"      → apply real code changes + final-report
             - "create-issues"  → autonomously run `gh issue create` for each
                                  payload item; NO AskUserQuestion, the user
                                  already committed by clicking the button
             - "dispose-concept"→ record disposition, advance to Step 6
           Process per Step 5 (Live Feedback Loop) — act on the user's choices
           (approve/tweak/reject, included options, comment-driven tweaks).
           Step 5c writes the new iteration to the HTML file and POSTs
           `/reload` BEFORE the reset below. Reset is the LAST action.

         • **Zero-prompt invariant for create-issues + dispose-concept.**
           These two branches MUST complete end-to-end without asking the
           user anything. The payload (items[] for create-issues,
           disposition{} for dispose-concept) is self-sufficient by design;
           any missing optional field falls back to a sane default. If you
           catch yourself reaching for AskUserQuestion in either branch,
           stop — the answer is in the payload, the concept HTML, or the
           project's new-issue extension. The user signed off by clicking
           the button.

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

7. After monitoring ends (user says "fertig"/"done", aborts, clicks
   "Concept beenden" on the final-report panel, or Step 6 of SKILL.md
   fires the completion card), run the bridge-side cleanup:
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
