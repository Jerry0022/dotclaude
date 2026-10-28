# Concept step 5b — finalize parts A to D, legacy actions, critical invariant

Finalize parts A · Issues, B · Implement, C · Ship, D · Close out and E · Tests and hand-offs, legacy actions and the critical invariant — execution detail of `SKILL.md` Step 5b, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

**The report is a fragment.** The final report lives in its round fragment
`docs/concepts/{name}/rounds/NN.html` (`step2-build.md`). Every "rewrite /
update the final-report HTML" below edits that fragment with a targeted
`Edit`, followed by `concept-build.js build` and then `POST /reload`. The built
page is never read or edited. `{{…}}` tokens written into the fragment are
substituted by the build, but writing the locale VALUE stays correct too.

## A · Issues

1. Read the `items` array from `issues` — each entry carries
   `{ id, title, type, description, role?, module?, milestone?, selected: true }`.
   `description` falls back to the visible `.oq-label` text when the
   author of the final-report did not set `data-issue-body`; either is
   enough to skip prompting. An item with `id: "__sammel"` is the
   **Sammel-Issue** the sheet builds when the report lists more than three
   Funde: it carries `collected[]` (the folded items, same shape). File it
   as ONE issue — title naming the shared theme, each collected item a
   checklist line in the body — and route every collected item to it in
   step 7.
2. Read the `disposition` sub-object from the same payload and store it for
   part D. Do NOT apply it here — cleanup runs last, after ship.
3. **User-value gate (silent, mandatory).** Apply the gate from the
   `auto-issue` skill's `{PLUGIN_ROOT}/skills/auto-issue/deep-knowledge/issue-rules.md` to the
   selected items BEFORE creating anything: each issue must deliver a
   standalone user effect — direct (feature, visual, bug fixed, fewer
   crashes) or indirect (performance, stability, security). Items that
   only produce value in combination (file-level / layer-level tasks
   serving one use case) are **merged into ONE issue**: title = the user
   value they jointly deliver, original items as a checklist in the
   body. Merging is a silent sane default under the zero-prompt
   invariant — never an `AskUserQuestion`. Every resulting body carries
   a `**User value:** <effect>` line. Never emit a swarm of code-change
   tasks that only make sense together.
4. For each gated item, delegate to the `auto-issue` skill via the
   **Skill** tool in **hand-over mode** — never `gh issue create`
   directly (`{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` → "Issue Creation &
   Editing — Always Delegate"). A complete hand-over makes that skill ask
   nothing, so the zero-prompt invariant holds. Build the hand-over from
   the payload + concept-extension labels (see § Project label enrichment
   below):

   ```text
   create · title "<item.title>" · type <item.type>
   body: "<item.description>" + blank line + "_Created from concept: docs/concepts/{date}-{slug}.html_"
   labels: role:R, module:M (only when resolved) · milestone "<item.milestone>" (only when set)
   mid-flow: return the issue number + URL, no completion card
   ```

   Capture the returned issue number + URL. On a `gh` error inside the
   skill, abort this item, surface the error to the user, and continue
   with the remaining items — partial success beats silent loss.

5. **Project label enrichment (role / module).** Before the hand-over,
   resolve project-specific labels in this order:
   - If `item.role` / `item.module` is set in the payload → use directly.
   - Else, check the project's `auto-issue` extension
     (`{project}/.claude/skills/auto-issue/reference.md` / `SKILL.md`)
     for the declared label sets. If the concept's slug, file paths, or
     final-report content unambiguously maps to exactly one role / module
     value → apply it.
   - Else → omit the label silently. NEVER ask. A minimal `type:*`-only
     issue is preferable to interrupting the user.

6. **Issue body composition.** Always end the body with a backlink:
   `_Created from concept: docs/concepts/{date}-{slug}.html_`. This is
   how the human reader (and future Claude session) recovers the
   originating context months later. Prepend whatever richer body the
   payload's `item.description` carries.

7. Update the final-report fragment: on each created item's Fund `<li>`
   (the 🔍 fold, `data-oq-id`), set `data-routed`, append the
   `[Issue #NNN]` link to the issue URL and a small ✓ badge
   (`templates-final-report.md` § After a point is routed). For items
   that were merged by the user-value gate or folded into the Sammel-Issue,
   link ALL source items to the one issue. `data-routed` is what drops the
   row from the to-do inbox on the next render — an already-routed item can
   never be submitted twice. (Pages from before the inbox still carry a
   checkbox: there, `disabled` does the same.)

## B · Implement the selected follow-ups

The points the user routed to "Jetzt umsetzen" are ordinary implementation
work that happens to arrive at close-out time. Build them exactly the way the
`implement` branch does — **through the `auto-agents` skill, which runs the
devops role agents** (§ `action: "implement"` step 2,
`--from=auto-concept --mode=background`), never inline
because the session feels like it is ending.

1. Read `implement.items[]`. Each entry carries the part-A item shape
   (`title`, `type`, `description`, optional `role` / `module`); `role` and
   `module` are the strongest signal for which agent owns the work.
2. Hand all items to `auto-agents` in ONE call — it dispatches by domain,
   independent items in parallel, `devops:qa` verifying.
   The user-value gate from part A does NOT apply here — it exists to keep the
   issue tracker free of fragments, and these items are being built, not
   filed.
3. Checkpoint each item as its code lands (`action: "finalize:implement"`,
   `step: "followup-implemented"`, the item id AND its title in `artifacts`).
   Both, because the id comes from the report's `data-oq-id` and a
   hand-written report can leave it empty — a resumed run that can only match
   on an empty id rebuilds what already exists.
4. Rewrite the item's `<li>` in the report the way part A does for issues:
   set `data-routed`, append an `.oq-done` note naming what landed. Write the locale's `final.done_prefix` VALUE ("umgesetzt" /
   "implemented"), never the raw `{{final.done_prefix}}` token — placeholders
   are substituted at generation time, and this rewrite happens long after
   that, so a token written here stays on screen as a token. `data-routed`
   is what drops the row from the to-do inbox on the next render.
5. Add a short **Nachtrag** section to the final report naming what was built
   and where. Do NOT append a new iteration — the final report is the closing
   artefact and stays the last tab.
6. If an item cannot be built (it turns out to need a decision, or it breaks
   something), stop that item, leave it unrouted, and say so in the
   Nachtrag. Never silently downgrade it to an issue: the user asked for code
   and has to see that they did not get it.

## C · Disposition staging per mode

   - `keep`, no `moveTo` → `git add` the source folder `{date}-{slug}/`
     (plus the attachments copy + `git add` from `step6-closeout.md` → Also
     dispose of the durable store).
   - `keep` + `moveTo` → `cp` the HTML and the decisions JSON (and
     `cp -r` the source folder `{date}-{slug}/`) into `<moveTo>/`, `git add`
     the copies, `git rm -r --cached` the originals (if tracked).
   - `gitignore` → the `.gitignore` line and the `git rm --cached` from the
     table in Step 6a (`step6-closeout.md` § Disposition, cleanup procedure and disposition tables).
   - `discard` → `git rm --cached` the HTML and the decisions JSON, and
     `git rm -r --cached` the source folder `{date}-{slug}/`, if tracked.
     Then hide the same paths from git **locally** (§ Ship-safe local
     exclude below) — they stay on disk for the bridge, but untracked they
     would fail the ship's clean-tree check (#931).
   Nothing to commit → no commit. Step 6a then skips the git half of its
   table for this close-out and only moves or deletes the files on disk
   (for `keep` + `moveTo`: delete the originals, the copies are already in
   place).

### Ship-safe local exclude (#931)

A `discard` concept is untracked by design, and part C runs before part D, so
its HTML, decisions JSON and source folder are still on disk when `do-ship`
runs. `ship_preflight` refuses an untracked file ("Dirty working tree: 0
modified, N untracked") and `ship_release` would stage every one of them.
Deleting them first (part D before C) kills the page that reports the ship.
Instead, part C step 0 lists exactly this concept's paths in the repository's
local exclude file, which git reads like `.gitignore` but never commits:

```bash
x="$(git rev-parse --path-format=absolute --git-common-dir)/info/exclude"
mkdir -p "${x%/*}"
for p in "/docs/concepts/{date}-{slug}.html" "/docs/concepts/{date}-{slug}-decisions.json" "/docs/concepts/{date}-{slug}/"; do
  grep -qxF -- "$p" "$x" 2>/dev/null || printf '%s\n' "$p" >> "$x"
done
```

Same in `gitignore` mode for any concept path still untracked when the ship
starts (its `.gitignore` line is committed in the close-out commit, so this is
only a safety net there). The clean-tree gate itself is not touched: it stays
fail-closed for every other path. Step 6a removes the three lines again once
the files are disposed of (`step6-closeout.md` § Disposition, cleanup
procedure and disposition tables). Use the exact `{date}-{slug}` paths — never
a glob, which would hide a sibling session's concept.

### Delegated ship: card data, rendered after Step 6a (#712)

Part C passes `--card-data` in the do-ship args itself; in a large context
`pre.ship.delegate` keeps it when it moves the ship into a subagent (a state
file alone never sets it — a paused or close-out-only concept is no
finalize). An inline ship ignores the flag. The subagent runs the pipeline
but returns the card DATA only
(`{ "status": "done", "cardData", "afterRender", "exitWorktree" }`) instead of
a rendered widget. Keep part C's order:

- `cardData.variant` is `ship-blocked` → part C step 2 holds: NO part D, the
  concept stays open; render the card right away.
- Otherwise run part D and Step 6a first (bridge, pulser and waker stopped,
  state file gone). A close-out that fails still goes on to the render.
- Then call `render_completion_card` with `cardData` verbatim (before
  `ExitWorktree` — the card reads its `cwd`), show that card last, run the
  `afterRender` steps, and only then `ExitWorktree` when `exitWorktree` is
  true. Never relay a widget a subagent
rendered while the concept was still open: it links the localhost page and
asks to close out a concept that is closed a minute later. Details:
`do-ship/modes/delegated.md` § Card data instead of a card.

## D · Reload and reset per disposition

1. **`keep` / `gitignore`:** add `data-closed` to the
   `<section data-final-report>` (the sheet renders its done state instead of
   re-arming — the bridge is about to be shut down, so a live execute button
   would queue a submission nobody picks up; the `[data-handoffs]` block,
   if the report has one, is the only block that stays visible — what is
   left is left for the user), then POST `/reload` so the
   browser shows the rewritten report (issue links, implemented notes,
   shipped note), and only AFTER that POST `/reset` with the captured
   `_version` —
   reload-before-reset, same order as every other branch.
   **`discard`:** POST `/reset` only, no `/reload`. The browser's reload poll
   runs on a 3 s interval and the file is about to be deleted, so a `/reload`
   here is a coin flip on whether the user's closing impression is the final
   report or an HTTP 404. The bridge shutdown that follows is the honest
   end-of-session signal. When the concept wrote code, Step 6a moves the spec
   into the local store instead of deleting it (`step6-closeout.md` § Keep
   the spec after code landed, #936).

## E · Tests and hand-offs

Runs in part D's slot, after the ship (C) succeeded or was not requested, and
never when C blocked. Read `tests[]` and `handoffs[]` from the payload (absent
= empty). Per item, by `mode`:

| `mode` | `guide` | What happens |
|---|---|---|
| `skip` | any | Dropped. Not mentioned anywhere. |
| `guide` | `web` | After close-out (Step 6a done, watchers stopped) start the `auto-guide` skill for the item — a browser walk-through of the web task. |
| `guide` | `desktop` | A desktop task: offer a script or takeover help for the PC step (`computer-use` takeover or a ready-to-run script), after close-out. |
| `guide` | `inline` | Not guidable by tool: write the short numbered steps into the final message. A `guide` request on a non-guidable item always ends here — never answer "not guidable". |
| `self` | any | The user does it. Goes onto the completion card: `userFinalTest` for a 🧪 test, the hand-off line for a 👉 item. Max 3 per kind, one very short line each. |

Rules:

- Order after the card: the completion card comes last as always (Step 6b /
  the ship card). A started `auto-guide` or the inline steps follow the
  close-out, not the other way round — the chat must not end on a half-finished
  guide while the bridge is still running.
- Hand `auto-guide` the item text and the report's slug as context; it asks
  nothing the item already answers.
- The report fragment's done state lists only the 🧪/👉 items with their chosen
  mode (write the mode word in the locale); `skip` items are gone. No line that
  the card repeats them.
- An item the report offered as "Muss nicht" (criticality low, pre-selected
  `skip`) and the user left that way produces nothing.

### Pre-selection rules (for the author of the report)

Claude sets the defaults when it writes the Funde, 🧪 and 👉 rows (authoring:
`step5-update-page.md` § Final-report append); the user only corrects them.

- **Fund route.** ⚡ *Jetzt umsetzen* is the default tendency: small, in the
  repo, cosmetics included. 📌 *Issue* only when the fix is **risky**, needs
  **more preparation than a guide** (a concept first) or lies outside the
  repo — size alone is no criterion. ✕ *Ignorieren* is the rarest: only when
  the current state works as is, is no workaround, and the alternative would
  merely be another way. Every Fund carries a one-word reason chip ("klein",
  "kosmetisch", "riskant", "braucht Concept").
- **🧪 / 👉 mode.** Criticality decides between *Muss nicht* (`skip`) and
  needed. If needed and guidable (a web task → web guide via `auto-guide`; a PC
  task → desktop script / takeover help) pre-select *Mit Anleitung* (`guide`);
  otherwise pre-select *Mach ich selbst* (`self`). Never print "nicht
  führbar" — a non-guidable item picked with *Mit Anleitung* simply gets
  written steps (`inline`).

## Legacy mapping, rationale and the critical invariant

Pages generated before the close-out sheet submit one action at a time.
Map each onto the part that does the SAME THING — never onto the letter it
used to have, which shifted when the implement part was inserted:

| Legacy action | Runs |
|---|---|
| `create-issues` | part A (issues) + Step 6 with the bundled disposition |
| `ship` | part C (ship) + Step 6 |
| `dispose-concept` | part D (close out) only |

A legacy page has no way to express "jetzt umsetzen", so part B never runs
for one. Keep accepting all three — a mid-session plugin update leaves such a
page open in the browser — and never let a `dispose-concept` reach the ship
pipeline: that is the one mis-mapping that would cut a release nobody
authorised. Newly generated pages MUST emit `finalize` only.

**Critical invariant:** a submit with `action: "iterate"` MUST NEVER cause
code or file changes outside of the concept HTML file itself. The user
relies on that guarantee to explore ideas safely. Within `finalize`, part A
only writes GitHub issues + the final-report HTML and part D only disposes of
the concept's own artefacts — neither touches project code. Parts B and C are
the ones that reach further: B writes code, and only for the items the user
explicitly routed to "Jetzt umsetzen" (default: Issue, which writes nothing);
C reaches outside the repo, and only when `ship.run` is true, which has no
default at all. Both consequences are named on the sheet's live plan, in
execution order, above the single execute button.
