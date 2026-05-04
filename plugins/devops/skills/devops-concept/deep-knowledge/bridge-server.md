# Concept Bridge Server + Edge

The **concept bridge server** (`scripts/concept-server.py`) serves static files
AND provides HTTP endpoints for heartbeat and decision exchange.

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

5. Send the first heartbeat immediately (POST = Claude pulse, not the
   server self-pulse — see `templates.md` § Claude Connection Heartbeat):
   ```bash
   curl -s -X POST http://localhost:{port}/heartbeat
   ```

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
