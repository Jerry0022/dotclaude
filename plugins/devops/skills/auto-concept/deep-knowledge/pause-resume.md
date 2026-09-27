# Pause and resume an open concept (#555)

Referenced from `SKILL.md` § 6c. A pause stops every process of an open concept and keeps the concept itself; a resume brings it back on the same port with every decision intact.

## Pause — stop everything, keep the concept

The user pauses in chat ("pausieren", "machen wir später weiter", "ist
pausiert") — the same way "fertig" starts the close-out. A pause is not a
close-out: nothing is disposed, only the processes stop. Leaving them running
keeps the bridge, the pulser, the waker and the backstop cron alive for
nothing, and a later session start would relaunch them while the user is away.

In this order — the waker treats an unexpected bridge exit as a signal, so it
goes before the bridge:

1. `TaskStop` the keepalive pulser and the pickup waker (their background task
   ids from Step 3 / the last resume).
2. `CronDelete <cron_id>` — the backstop cron.
3. Mark the state file, read-modify-write so owner, `baseline_sha` and every
   other field stay:
   ```bash
   node -e "const f='.claude/concept-active.json',fs=require('fs');const s=JSON.parse(fs.readFileSync(f,'utf8'));if(!s.owner||s.owner===process.argv[1]){s.paused_at=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(s,null,2))}" "$OWNER"
   ```
4. `curl -s -X POST http://localhost:$PORT/shutdown > /dev/null 2>&1 || true`.

Keep the page, the decisions file, the durable store and
`concept-active.json`. While `paused_at` is set, `ss.concept.resume` prints a
one-line resume hint on every session start and compact and relaunches
nothing; the 24 h prune never touches a paused concept; the completion card
shows no concept link and no compass; strict mode bound to the concept is
released. End the pausing turn with the `paused` card, without a `concept`
field — its `[SESSION TITLE]` block sets `⏸️ Paused – `.

## Resume from pause

Resume only when the user's prompt continues this concept ("weiter mit dem
Concept", "Concept fortsetzen", an answer about its open decisions). Any
other prompt leaves the pause alone — the hint is information, not a mandate.

1. Relaunch the bridge on the **same** port with the recorded `--html`
   (bridge-server.md step 4 — the command `buildDeadBridgeRelaunch` prints),
   verify the heartbeat round-trips, and re-arm the pulser, the waker and the
   backstop cron.
2. Rewrite the state file: delete `paused_at`, set `started_at` = now and the
   new `server_pid` and `cron_id`.
3. The earlier decisions come back from the durable store. End the turn with
   the `concept: { phase: "waiting" }` card; the compass returns.
