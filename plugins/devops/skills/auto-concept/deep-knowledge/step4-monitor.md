# Concept step 4 — heartbeat, pickup and polling schedule

Heartbeat, `/pending` pickup and the polling schedule — execution detail of `SKILL.md` Step 4, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Heartbeat, pickup and polling schedule

**Heartbeat** is the keepalive pulser's job (Step 3, task 1), backed up by the
cron. Send an extra POST on any manual poll cycle:

```bash
curl -s -X POST http://localhost:$PORT/heartbeat
```

**Checking for a submission** — use `/pending`, not `/decisions`:

```bash
curl -s http://localhost:$PORT/pending
```

`/pending` is the only endpoint that acks a pickup: it stamps `_picked_up_at`,
which is what advances the "Claude verarbeitet" step in the page's submitted
panel. A poll of `/decisions` reads the same data but acks nothing, so the user
watches a progress list that never moves. Once `pending` is `true`, fetch the
full payload from `/decisions` and process it (Step 5).

**Polling schedule:**
- **Primary mechanism**: the **pickup waker** from Step 3. It exits the moment
  a submission lands, which wakes Claude — no user chat message required.
- **Backstop**: the cron from Step 3, every 15 minutes — and only a partial
  one. It covers the window between the waker exiting and being re-launched
  ONLY while the REPL is idle, which is exactly when that window is not open:
  during a processing round the REPL is busy and the cron cannot fire. That is
  why 5c step 7 re-launches the waker immediately rather than leaving the gap
  to the cron.
- **Initial wait**: 10 seconds after opening, then one manual heartbeat +
  `/pending` check to close the gap before the first waker cycle lands.
- **No timeout** — monitoring runs indefinitely until the user ends it
  (says "fertig"/"done", closes the page, or closes Claude).
- **On demand**: if the user asks "did my submission arrive?", poll
  `/pending` manually — do NOT wait for the next tick.

**Important:** monitoring MUST NOT block the conversation, and it must not
depend on one either. The waker runs detached, so an idle turn keeps watching
on its own; a user who clicks submit and types nothing still gets picked up.
If the user sends an unrelated message, respond normally — the waker keeps
running and wakes you when the submission arrives.
