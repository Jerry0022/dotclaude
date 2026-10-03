# Concept step 5c–5d — appending rounds, the final report, resuming the watch

Appending rounds, the final report and its open points, re-confirming wakes and acting on exit reasons — execution detail of `SKILL.md` Step 5c and 5d, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Reality-check round — template and markers

**It also keeps the concept's template** (§ Step 1a · Template continuity): in
a `design` concept the collision cards go into a
`section[data-view] data-view-kind="decision"` alongside the design the round
is about, NOT into a `decision` round — a gate that swaps the reviewer's
feedback surface mid-session reads as the page breaking.
**Read the file back and confirm both attributes landed before `/reload`** — a
marker that silently failed to write re-arms a check the user already answered.
See `deep-knowledge/reality-check.md` § The forced round.

## 5c · Append procedure

1. Read the existing HTML file (same path, always).
2. Freeze the currently-active iteration section per the rules in
   `deep-knowledge/templates-rounds.md` § Freezing Past Iterations (authoritative
   source). In short: remove `data-active`, add `hidden`, disable every
   `input`/`textarea`/`select`/`button` inside the section, set `readonly`
   on text inputs and textareas, preserve the submitted values exactly
   (read them from the just-processed decisions JSON).
   **Mappings:** for every `[data-mapping]` in the frozen section write
   `"submitted": {cells, order, adhoc, slotNotes}` into its JSON spec from
   the payload's `mappings[]` entry — `cells` = `assigned` (keyed by matrix
   key, verbatim), `order` = `order`, `adhoc` = `adhocItems`, `slotNotes` =
   `slotNotes`. The renderer disables the cells itself from `submitted`; a
   frozen mapping without a complete `submitted` (every matrix key present
   under `cells`) renders the red `map.frozen_missing` banner over the
   proposal and fails the deterministic gate (M9). See
   `deep-knowledge/iteration-rules.md` § Freezing Design Iterations →
   Mappings and `deep-knowledge/templates-mapping.md` § Information Mapping
   (engine) → Freezing.
2.5. **Verify form collection coverage.** Read the existing JS for
   `collectDecisions()` (or its template-specific variant). Confirm it
   uses a generic `querySelectorAll('input, select, textarea')` scoped
   to `[data-active]`. If it uses hand-listed selectors instead, fix it
   NOW before appending the new iteration — otherwise the new section's
   fields will silently fail to upload at submit time. See
   `deep-knowledge/iteration-rules.md` § Procedure on every iteration —
   coverage gate and `deep-knowledge/validation-gate.md` § Generic Form
   Collection for the required pattern.
2.6. **Engine drift check.** Run `deep-knowledge/validation-gate.md` over
   the EXISTING page — the gate applies to the whole file on every append,
   not only at first generation. The page's shared engine (Attachments
   JS/CSS, § Layout CSS chrome rules, tab-switch JS) is whatever
   templates.md said on the day it was generated, and every later round
   re-uses it. If any engine entry fails (30b, 44, 46, 47, 48, 49–53, 54,
   56, 59–61, tab-switch), re-sync that whole block **verbatim from
   templates.md NOW**, before appending — otherwise the new iteration
   inherits the old defect and the user sees the same bug after updating
   the plugin. A page from before the Kompass panel (fails 56 / 59–61) gets
   the whole panel block — skeleton, § Layout, § Section Navigation,
   § Two-Button Submit — on this append, no opt-out (#344). See
   `deep-knowledge/validation-gate.md` § Engine drift on iteration append.
3. Append a new
   `<section data-iteration="{N+1}" data-iteration-template="…" data-active>`
   with the updated / next-round content. The template attribute is
   mandatory and carries the concept's template forward (§ Step 1a ·
   Template continuity) — a round that silently switches it swaps the
   reviewer's whole feedback surface (new variants, refined options, whatever
   the feedback produced). Set `submitted: false` in `#concept-decisions`,
   remove `concept-submitted` from `<body>`, re-enable the submit button.
4. Append a new entry in the `.iteration-tabs` bar for iteration N+1 and
   mark it active (set `aria-selected="true"`, remove that attribute from
   the previous tab — but keep the previous tab clickable so the user can
   re-read their frozen history).
5. POST to the bridge: `curl -s -X POST http://localhost:{port}/reload`.
   The browser's `pollReload` loop sees the counter bump and calls
   `location.reload()`. The reload lands on the new active iteration
   because the HTML declares it via `data-active`.
6. **Only now** POST `/reset` with the captured `_version` (see cron
   prompt in Step 3). This stamps `_processed_at` on the server as the
   final step. The browser's `pollProcessedState` is a safety-net —
   it will only restore the panel state when a reload counter advance
   has been observed OR a long stale timeout elapses. See
   `deep-knowledge/templates-submit.md` § Panel State Reset for the polling contract.
7. **Immediately re-launch the pickup waker** (Step 5d) — right here, not
   after the rest of the round. `/reset` clears the pending flag and
   `/reload` has already handed the user a fresh panel, so from this moment
   they can submit again. Every second between here and the re-launch is a
   window with nothing watching, and the cron cannot cover it: it fires only
   while the REPL is idle, and processing an `implement` keeps the REPL busy
   for minutes.

The tab bar is anchored at the top of the right-side decision panel —
above the section TOC and the submit block. It must never appear inside
the left-hand content area. Render as a compact vertical chip list.

Do NOT write a redirect file. Do NOT create a new `-v{N}` file. The entire
concept session — first render, every iteration, "nochmal neu" reworks —
lives in the single `{date}-{slug}.html`.

## Final-report append — steps and verbatim copy directive

1. Freeze the previous iteration the same way (step 1–2 above).
2. Append a
   `<section data-iteration="{N+1}" data-iteration-template="free" data-final-report data-active>`
   to the same file. The `data-final-report` flag switches the panel to
   `panel-final-report` mode (no iterate/implement buttons — see
   `deep-knowledge/templates-rounds.md` § Final Report Panel). The template is
   **always `free`** and is never omitted: a report is a document with a TOC,
   the `design` layout is built for a mockup, and a section that declares no
   template used to inherit whatever tab the reader came from — the same
   report rendered two different ways depending on the route taken to it.
   The ☰ panel does not move with that choice (§ Panel Chrome (all
   templates)), so the reader keeps the menu they have used all session.
3. Inside, render a structured report with several `<section id data-nav-label>`
   blocks so the existing TOC auto-populates. Recommended structure
   (Claude picks which sections actually fit the concept):
   - **Zusammenfassung** — what was implemented in one paragraph + commit hash
   - **Geänderte Dateien** — bulleted list with brief rationale per file
   - **Tests / Verifikation** — what was run, what passed, what was skipped
   - **Offene Punkte** *(optional — usually absent, see § Open points
     admission gate below)* — checkbox list of the points that passed the
     gate: either explicitly deferred by the user during this concept, or
     found on the way and unrelated to the concept's scope
   - **Danach von Hand** (`<section id="handoffs"
     data-nav-label="{{final.handoffs}}" data-handoffs>`, *only when there
     is something*) — the steps the user has to take by hand after the merge
     (flip a cron, rotate a key, watch the first run), as a numbered list.
     `data-handoffs` paints the section, marks its TOC entry in the warning
     colour and mirrors the list onto the close-out sheet, where it is the
     one block that stays visible after the close-out — as a plain paragraph
     it vanished among the others. Omit the section when there is nothing to
     hand over. Never a place for recommendations: work that is worth doing
     and in scope was built; work that is out of scope goes through the gate
     below or nowhere
4. Append a new entry in the `.iteration-tabs` bar for the final report.
   **Tab label MUST be `iteration.final_tab`** (locale: "Abschlussbericht" /
   "Final report"), NOT "Iteration N+1". Mark it `aria-selected="true"` and
   carry `data-final-report` so the tab-bar JS can style it distinctly.
5. Set `submitted: false` in `#concept-decisions`, remove `concept-submitted`
   from `<body>`. The submit-button reset is irrelevant because the
   final-report panel doesn't surface iterate/implement at all.
6. /reload → /reset → **re-launch the pickup waker**, as steps 5–7 above.
   Step 7 is not optional here: the final-report panel still accepts the
   `finalize` submission, and `implement` is the longest round there is —
   leaving it unwatched is the widest window in the whole flow.

**Verbatim copy directive (mandatory):**
The final-report JS block — `refreshCloseout`, `renderCloseout`,
`renderHandoffs`, `openQuestionBoxes`, `followUpRoute`, `followUpItem`, `collectFollowUps`,
`collectIssueItems`, `collectImplementItems`, `collectDisposition`,
`closeoutShipChoice`, `buildFollowUpList`,
`setCloseoutFrozen`, `restoreCloseoutToReady`, `submitFinalize`, the accordion
half — `closeoutStorageKey`, `loadCloseoutAnswered`, `saveCloseoutAnswered`,
`closeoutRows`, `closeoutOpenRow`, `closeoutAllAnswered`, `openCloseoutRow`,
`closeoutRowSummary`, `isCloseoutRowLocked`, `updateCloseoutRowSummary`,
`updateCloseoutProgress`, `updateCloseoutButton`, `setCloseoutButtonState`,
`refreshCloseoutRows`, `initCloseoutRows`, `layoutCloseoutRowHeads`,
`closeoutRowClick`, `closeoutButtonClick` — plus the `closeout-execute` click
wiring (bound to `closeoutButtonClick`, never directly to `submitFinalize`),
the delegated row-head click listener (bound to `closeoutRowClick`, never
straight to `openCloseoutRow` — that is what keeps the accordion sequential),
the `change` listener and the
`DOMContentLoaded` wiring — MUST be copied verbatim from
`deep-knowledge/templates.md` (the block starting at the comment
`// --- Final-report close-out sheet (action: "finalize") ---`). Do NOT
inline a simplified sheet, collapse it back into separate buttons, re-introduce
a step chain, a "Gewählt: …" plan line or a status paragraph under the button,
wire the button straight to `submitFinalize`, or omit the event-listener
wiring; any omission leaves a visible-but-inert control or a flow the user
cannot finish. After writing, the post-generation validation
gate (`deep-knowledge/validation-gate.md` Phase 1) MUST find the panel-state
and close-out patterns (28–38b) in the generated file.

## Open points admission gate

The `<section data-open-questions>` block is the exception, not a closing
ritual. The normal final report has NO open points: the user approved a
scope, the scope was built, the report says so. Every row on that list asks
the user for a decision they did not ask to make, so a row has to earn its
place. Do NOT go looking for candidates — keep noticing things while you
implement, but noticing something is not the same as putting it in front of
the user.

Exactly two origins are admissible, and every item declares its origin with
`data-oq-origin`:

| Origin | `data-oq-origin` | What qualifies |
|---|---|---|
| Deferred by the user | `deferred` | The user explicitly parked it during THIS concept — a "später" / "nicht jetzt" comment, a variant they rejected for now but asked to keep, a decision card answered with "aufschieben". Name where (iteration + card) in `data-issue-body`. |
| Found on the way | `found` | Surfaced during implementation, has no or at most a remote relation to the concept's scope, and would be lost otherwise — a bug in a neighbouring module, a broken script you had to work around, a stale doc for a different feature. |

**Never an open point** — these are the rows that made the list a nuisance:

- **Anything in the approved scope.** If the user clicked implement on a
  round that contained it, it is scope: build it (see § `action:
  "implement"` step 2 — the approved scope is built in full). If it could
  not be built, that is a shortfall and belongs in the *Zusammenfassung* /
  *Tests* as "nicht umgesetzt, weil …" — moving it to the open points
  quietly turns a shortfall into a request for the user's signature.
- **The no-brainer next step of the scope** — "add the tests", "update the
  README for this change", "phase 4 of the same plan". If it is obvious, it
  is scope (`{PLUGIN_ROOT}/deep-knowledge/documentation-maintenance.md`
  already makes the doc update part of every change); if it is genuinely a
  separate scope, the user decides whether to start a new concept — a
  checkbox is not how that decision is asked.
- **Generic best-practice nudges** nobody asked for — "consider
  monitoring", "could use a cache", "re-evaluate on <date>".
- **Reality-check drift** that broke no contract — that is a mention in the
  *Zusammenfassung* (`deep-knowledge/reality-check.md`), not a row.

Self-check before writing a row: *would the user be surprised to see this
here?* A row they would expect ("of course phase 4 is next") is scope or a
new concept, never a row. A row they would not have thought of themselves
(the SAML bug that showed up in the smoke test) is a `found` row.

When no candidate survives, omit the section entirely — do NOT render an
empty stub, a "keine offenen Punkte" line, or a single padding row. The
sheet handles the absence: the follow-up block simply does not appear.

Each surviving item becomes one row on the close-out sheet, where the user
routes it to a GitHub issue, to "jetzt umsetzen" (built during the close-out,
part B), or to nothing. Write `data-issue-body` for every item as if it were
BOTH: an issue read cold in three months and a brief handed to an
implementing agent ten minutes later. The presence of this section is what
adds the follow-up block to the close-out sheet — see
`deep-knowledge/templates-rounds.md` § Final Report Panel for the HTML pattern.
Default each `<input type="checkbox">` to `checked` so the user opts items
OUT rather than IN. The validation gate rejects a final report whose open
points lack `data-oq-origin` (`deep-knowledge/validation-gate.md` pattern
33b).

**No further iterations from the final report.** The panel deliberately
omits the iterate/implement buttons. If the user wants more work after
the final report, they can start a new concept session — that's a clear
new scope, not an additional iteration on a closed one.

## 5d · Re-launch the waker, re-confirm every wake

**Re-launch the pickup waker.** It exited to wake you for the submission you
just processed, so nothing is watching `/pending` until you start it again —
exactly as in Step 3 (`bridge-server.md` § step 3, task 2), with
`run_in_background: true`. Do this at 5c step 7, the moment `/reset` lands; by
the time you reach 5d it should already be running.

**Before processing a wake, re-confirm.** Two wakers on the same port both exit
`PENDING_SUBMISSION`, and the second wake arrives after `/reset` has already
cleared the flag. Acting on it re-runs Step 5b — for `action: "implement"` that
means writing real code changes a second time, which no version guard catches
(`/reset`'s 409 only detects a *newer* submission). So on every wake, poll
`/pending` once before doing anything: `false` means the wake is stale — just
re-launch the waker and carry on. If it is `true`, compare `_version` against
the one you last processed: **equal means the previous round's `/reset` never
landed**, not that the user resubmitted. Retry the reset instead of running the
same payload again.

**One exception, and check it before applying that shortcut: `GET /recovery`.**
If a `reality-check-*` checkpoint sits on that same `_version`, the previous run
did not finish and simply fail to reset — it died mid-round, and the reset was
never due. Resetting there discards the user's implement click with no code, no
round and no error. Resume from the recorded verdict instead
(`deep-knowledge/reality-check.md` § Checkpoints and resume).

Skipping it is how a concept silently stops responding after iteration 1: the
page still shows a green indicator (the pulser keeps `claude_ts` warm), the user
submits again, and nothing picks it up until they ask in chat.

## 5d · Exit reasons, loop end, expected final-report action

**Act on the exit reason.** A background task announces why it stopped; each
reason has exactly one correct response:

| Exit line | What happened | Do this |
|---|---|---|
| `WAKER_EXIT reason=PENDING_SUBMISSION version=N action=<a>` | A submission landed — `version` is the `_version` to hand back to `/reset`, `action` its branch (`iterate` / `implement` / `finalize`) | Fetch `/decisions` and process it (Step 5a) on that branch, then re-launch the waker. If `/decisions` comes back not submitted it was a stale wake — re-launch and carry on |
| `WAKER_EXIT reason=SERVER_DEAD` | ≥ 5 min of continuous failed polls (each waiting up to 30 s) — the bridge process is gone, not merely busy | Restart the bridge server **on the same port** (do NOT pick a new one — the state file, the open tab and the pulser are all bound to it), then re-launch the **waker**. The pulser is still running — it never exits on request failures and reconnects by itself |
| `PULSER_EXIT reason=SERVER_DEAD` | Only an internal crash of the pulser prints this now; it no longer gives up on a slow or absent bridge | Verify the bridge with one `curl /heartbeat` (relaunch on the same port if it is down), then re-launch the pulser |
| `PULSER_EXIT reason=DUPLICATE_PULSER` | An OLDER pulser is already pulsing this port (the watchers survive a session restart on Windows; `ss.concept.resume` re-arms them anyway) — this younger one stepped down | Nothing. The beat is covered |
| `WAKER_EXIT reason=DUPLICATE_WAKER` | A YOUNGER waker took over this port — a newer session re-armed the watchers, and this one belonged to the superseded session | Nothing. Do not re-launch; the newer waker wakes the session that owns the concept now |
| `*_EXIT reason=STATE_GONE` | `.claude/concept-active.json` has been gone for 3 consecutive polls (~1 min — a rewrite window is tolerated) — the concept ended (the waker already POSTed `/shutdown`) | Nothing. Do not re-launch; the session is over. After a close-out: a silent turn — no text, no title change |
| `WAKER_EXIT reason=HTML_GONE` | The concept page was deleted from disk — the waker shut the bridge down | Nothing to re-launch. `CronDelete` the backstop cron and remove the state file if it is still there. After a close-out (the state file is already gone): a silent turn — no text, no title change |
| `*_EXIT reason=STATE_NEVER_APPEARED` | The launch outran the step that writes the state file | Write it, then re-launch. NOT the same as STATE_GONE — the concept is alive |
| `*_EXIT reason=PORT_CHANGED` | A newer concept took over | Nothing. This task belongs to a superseded session |
| No `*_EXIT` line at all | The task died without announcing why — bad arguments, a crash, `node` missing, killed | Do NOT assume the session ended. Verify the bridge with one `curl /heartbeat`, then re-launch both tasks |

Re-launch the pulser only when you actually saw a `PULSER_EXIT` — normally it
runs for the whole session and a second one on the same port is wasted work.

Then return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

If the active section is the final report, the submission Claude expects is
`action: "finalize"` — one payload from the close-out sheet carrying
`issues` (open points routed to a GitHub issue), `implement` (open points the
user wants built now), `ship` (run the release or not) and `disposition`
(discard / keep / gitignore + optional moveTo). Legacy pages may
still send `ship`, `create-issues` or `dispose-concept` individually; map them
per Step 5b § Legacy final-report actions.

All other action types from the final-report panel should be treated as
protocol errors and reported back to the user.
