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
   Use a random port (8700-8999) to avoid conflicts. Store the port as `$PORT`.

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
         • After processing, reset conditionally — pass the noted version:
           Bash: curl -s -o /dev/null -w "%{http_code}" -X POST \
                       -H "Content-Type: application/json" \
                       -d '{"version": <noted>}' http://localhost:{port}/reset
         • If the HTTP code is 409 (version mismatch) → the user submitted
           again while you were processing. Re-fetch /decisions, process the
           new payload (which supersedes what you just finished), then retry
           the conditional reset with the new `_version`.
         • Report the outcome to the user. The browser's panel auto-resets
           within 5s via the `_processed_at` heartbeat poll — no browser-eval
           injection required.
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

4. Send the first heartbeat immediately:
   ```bash
   curl -s -X POST http://localhost:{port}/heartbeat
   ```

5. Open in Edge (reuses the running instance, adds a tab):
   ```bash
   # Windows
   start "" msedge "http://localhost:{port}/{filename}"
   ```
   On macOS: `open -a "Microsoft Edge" "http://…"`, on Linux: `microsoft-edge "http://…"`.

   The empty `""` is required on Windows — without it, `cmd.exe` interprets
   the first quoted argument as a window title.

6. After monitoring ends, clean up:
   ```bash
   kill %1  # or track the PID
   ```
   Also delete the heartbeat cron via `CronDelete`.
