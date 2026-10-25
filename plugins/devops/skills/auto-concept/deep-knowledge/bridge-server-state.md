# Concept Bridge Server + Edge, steps 4 to 7

Continues [bridge-server.md](bridge-server.md) (timestamp convention, steps 1 to 3).

4. **Persist active-concept state.** Write `.claude/concept-active.json` in
   the **session cwd** — the worktree when this session runs in one, the
   project root otherwise — with the metadata the SessionStart resume hook
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
     "owner": "a1b2c3d4",
     "started_at": "2026-04-12T14:30:00.000Z",
     "baseline_ref": "main",
     "baseline_sha": "4f2a1c9e77b3",
     "baseline_captured_at": "2026-04-12T14:30:02.000Z"
   }
   ```

   - `port` — the bridge port chosen in step 2.
   - `html_path` — relative path inside the project; the hook uses it to
     verify the concept file still exists.
   - `slug` — kebab-case topic from the filename, used in resume messaging.
   - `server_pid` — captured via `echo $!` after the `python … &` launch.
   - `cron_id` - OPTIONAL, legacy: present only in files written by older
     versions (their backstop cron). New files omit it; absent is valid.
     The resume hook deletes a listed legacy cron and drops the field.
   - `owner` — a random token minted when this file is written
     (`node -e "process.stdout.write(require('crypto').randomBytes(4).toString('hex'))"`),
     passed as `--owner {owner}` to the tick, the pulser and the waker.
     A tick or watcher that finds the file naming another owner AND another
     port leaves it alone — no `/shutdown`, no cleanup instruction — and
     keeps servicing its own port (#417). Without an owner on both sides the
     port rule alone decides, as before.
   - `started_at` — ISO-8601 UTC. When the concept was OPENED. Staleness is
     measured from the last activity (this stamp, the store's `state.json`
     `saved_at`, the newest draft, the journal tail — #426), never from the
     open alone, and a store holding a typed note is never stale.
   - `baseline_ref` / `baseline_sha` / `baseline_captured_at` — the reality
     check's anchor: the default branch and the **remote** tip this concept was
     written against, written by `scripts/concept-drift.js --capture` right
     after this file is created and advanced after every check. Remote rather
     than local, so it stays meaningful when the session runs inside a worktree
     while this file lives at the project root. Absent in a repo with no remote
     (and on pages generated before the gate existed) — the implement gate then
     skips silently rather than blocking. See `reality-check.md` § Baseline.
   - `tick_heartbeat_failures` / `relaunch_requested_at` — written by
     `concept-tick.js` only (#348): the consecutive heartbeat-miss count and
     the one-shot marker that makes the relaunch instruction fire once. Both
     are removed by the next successful heartbeat; nothing else reads them.
   - `paused_at` — ISO-8601 UTC, present only while the user has paused the
     concept (#555, `pause-resume.md`). Bridge, watchers and cron are stopped
     on purpose: `ss.concept.resume` prints a hint instead of relaunching, the
     24 h prune skips the file, the card shows no link and no compass, and
     strict mode bound to the concept is released. The resume deletes it.

   **What survives a Claude restart, and how it comes back (#348).** The
   bridge server, the keepalive pulser and the pickup waker are all
   background Bash tasks and die with the session — the cron too. At the next
   SessionStart the `ss.concept.resume` hook reads this file, probes
   `/heartbeat`, and hands the new session one of three mandates: a live
   bridge → re-arm the three watchers (and process a pending submission
   first); a dead bridge with an unprocessed submission on disk → the
   recovery mandate (relaunch on the same port, verify the store, process);
   a dead bridge with nothing pending → the relaunch mandate (same port,
   same `--html`, verified heartbeat round-trip, all three watchers). Only a
   concept with no activity for more than 24 h — measured against the durable
   store (last save, newest draft, journal tail), not the open — and no typed
   draft is pruned instead, and the hook prints one PRUNED line naming the
   state file, port and store dir, never a silent exit (#426). The page
   reconnects on its own once the heartbeat is back; the reviewer never has
   to reload or wait for someone to notice the red indicator.

   Path: ALWAYS `<session-cwd>/.claude/concept-active.json` — the cwd this
   Claude session runs in, i.e. the worktree for a worktree session (NOT the
   primary checkout's root, NOT under `docs/`). `ss.concept.resume` reads
   exactly `process.cwd()/.claude/concept-active.json`, and two sessions in
   sibling worktrees of one repo must not share a file: when they did, B's
   write made A's tick read "my concept ended", POST `/shutdown` and tell
   Claude to `rm` the file — B's page went "nicht verbunden" every 15 min
   (#417). The server may still be rooted anywhere; `--html` and
   `html_path` are relative to this cwd. Create `.claude/` if needed; do
   not commit the file (add `concept-active.json` to `.gitignore` if not
   already covered by `.claude/`).

4b. **The durable store — nothing to launch, but know it exists (#284).**
   The server creates `.claude/concepts/<html-basename>/` on startup, derived
   from `--html`, and **refuses to start (exit 1) if it cannot write there**.

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
     drafts/          UNSENT work, mirrored from the page on every autosave
       <slug>.jsonl   append-only revision log, fsynced per line
       <slug>.json    latest revision, atomically replaced
     UNPROCESSED      present iff a submission has not been processed yet
   ```

   **`drafts/` is for the half that was never submitted.** The page POSTs its whole state blob to `/draft` on every (debounced)
   autosave and flushes it with `sendBeacon` on `pagehide`, and the server
   fsyncs it before acking, exactly like a submission.

   **POST answers carry `Cache-Control: no-cache`, never `no-store`.** GET
   answers and the served HTML keep `no-store`. An unread `no-store` keepalive response pins Chromium's 64 KiB keepalive
   quota (gate 65); the header rule keeps pages on an older engine working.

   The log is **append-only on purpose**. `GET /draft?slug=<slug>` returns the
   latest revision *and* `recovered`: the per-key union of the last non-empty
   value ever posted, minus keys the page reported as deliberately cleared. A blank
   blob cannot destroy anything; the page merges `recovered` back on load into
   any key it is missing or holds empty.

   `GET /recovery` lists a one-line summary per draft (`slug`, `rev`,
   `saved_at`, `iteration`, `recoverable_keys`, `chars`). Read it on a resumed
   session. Never overwrite
   or regenerate a concept HTML file while a draft holds comments you have not
   accounted for.

   What this buys, concretely: `POST /decisions` fsyncs the payload BEFORE it
   acks the browser, and the server reloads `state.json` on boot. A bridge
   that dies for any reason — PC restart, crash, or the watchdog reaping it
   because Claude hit a usage limit and the session-scoped pulser stopped
   heartbeating — comes back serving the SAME `pending: true` and the same
   `_version`.

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
   attachments[], drafts[]}`. A non-null `marker` means the previous process
   was torn down hard rather than exiting cleanly; a `drafts[]` entry with
   `recoverable_keys > 0` means the user has typed comments that were never
   submitted — surface them, never silently discard or overwrite them.

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
   success.

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

   Free disk space on the store volume (`shutil.disk_usage`) is checked
   against the size plus a 64 MiB safety margin TWICE: once as an advisory
   pre-check (before decoding Shape A's base64, or before Shape B streams
   the body to a temp file at all — fails obviously-hopeless uploads fast),
   and once authoritatively inside `_attachment_quota_lock`, in the same
   critical section as the quota check and the write/rename. Either check failing refuses with
   `507 disk_full`.

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
   `411`, then the connection is closed gracefully (FIN, unread body bytes
   drained for up to 1 s) so the 411 is not lost to a TCP reset. On success the temp file is `fsync`ed then `os.replace`d onto the
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
   | 400    | `bad_content_length`  | `Content-Length` is not a non-negative integer (either shape; also guards `/decisions`, `/reset`, `/progress`, `/status`) | |
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
   check as every other data-bearing endpoint — see § Loopback-only bind,
   origin gate on every data-bearing endpoint above: no `Origin` header
   (curl, Claude's own requests) or an `Origin` matching the bridge's own
   host/localhost/127.0.0.1 is accepted; anything else gets a bare `403`.

   **`GET /attachments/<sha256>.<ext>` — serving policy.** The identifier is
   shape-validated (`^[0-9a-f]{64}\.[a-z0-9]{1,12}$`) before it ever touches
   the filesystem — traversal-proof regardless of stored extension. A query
   string on the request (e.g. a cache-busting `?v=2`) is stripped before
   this check, so it never 404s a valid id. Only the four raster image types
   are ever **candidates** for inline serving:

   | Extension | Content-Type |
   |-----------|---------------|
   | `.png`  | `image/png`  |
   | `.jpg`  | `image/jpeg` |
   | `.gif`  | `image/gif`  |
   | `.webp` | `image/webp` |

   Being one of those four extensions is necessary but not sufficient
   (#312 red-team F3). The stored extension comes from the uploader's
   claimed filename, not from the bytes. Before choosing the inline branch the server checks
   the blob's own leading bytes against that extension's magic-byte
   signature (PNG's 8-byte header, JPEG's `FF D8 FF`, GIF's `GIF87a`/
   `GIF89a`, WebP's `RIFF….WEBP` container) — see `_sniff_matches_ext` in
   `concept-server.py`. Only a match gets `Content-Type: <real mime>` +
   `Content-Disposition: inline`.

   **Everything else** — a signature mismatch on one of the four
   extensions, any other extension (`.svg`, `.html`, `.js`, `.pdf`, office
   formats, archives, media), and anything with an unrecognised or absent
   extension (`.bin`) — is always served as
   `Content-Type: application/octet-stream` with
   `Content-Disposition: attachment; filename="<sanitised original name>";
   filename*=UTF-8''<percent-encoded original name>` (RFC 5987, so non-ASCII
   names still round-trip in browsers that support the extended parameter,
   with a safe ASCII fallback for those that don't). `filename` comes from
   `attachments/index.json` when known, falling back to the blob id.
   `X-Content-Type-Options: nosniff` is set on EVERY response, inline or
   not, as defense in depth — but the signature check, not nosniff, is what
   actually decides whether a blob is ever offered inline.

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

   **`attachments/index.json`.** `index.json` is a flat `{ "<id>": {"name", "mime", "size",
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
   read-back is not enough — a dead bridge still lets the POST exit 0.

   Do a **pre/post compare**, not just `claude_ts > 0`. A bare check
   passes on a stale bridge from a prior session.

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
     # Only YOUR state file (#417): a sibling session may have written its own
     # since — compare the owner token before deleting.
     node -e "const f='.claude/concept-active.json',fs=require('fs');try{const s=JSON.parse(fs.readFileSync(f,'utf8'));if(!s.owner||s.owner===process.argv[1])fs.unlinkSync(f)}catch{}" "$OWNER"
     # Tell the user; DO NOT proceed to step 6 (opening the browser would
     # land on a dead or stale bridge).
     exit 1
   fi
   ```

   If you cannot run
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
   - `preview_start` / `preview_*` (`mcp__Claude_Browser__*`, formerly `mcp__Claude_Preview__*`) — sandboxed iframe,
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
   final report's close-out sheet, or Step 6 of SKILL.md fires the
   completion card), run the bridge-side cleanup:
   ```bash
   # Graceful shutdown via HTTP — survives PID recycling on Windows where
   # `kill $SERVER_PID` may target a process that already exited and got
   # its PID reused by an unrelated program. The server replies 200 then
   # calls os._exit(0); the listening socket is released within ~100 ms.
   curl -s -X POST http://localhost:$PORT/shutdown > /dev/null 2>&1 || true
   # Only YOUR state file (#417): a sibling session may have written its own
   # since — compare the owner token before deleting.
   node -e "const f='.claude/concept-active.json',fs=require('fs');try{const s=JSON.parse(fs.readFileSync(f,'utf8'));if(!s.owner||s.owner===process.argv[1])fs.unlinkSync(f)}catch{}" "$OWNER"
   ```
   If the state file names a legacy `cron_id`, `CronDelete` it too. The state file
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
