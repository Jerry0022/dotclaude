# Concept step 5b — finalize parts A to D, legacy actions, critical invariant

Finalize parts A · Issues, B · Implement, C · Ship and D · Close out, legacy actions and the critical invariant — execution detail of `SKILL.md` Step 5b, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## A · Issues

1. Read the `items` array from `issues` — each entry carries
   `{ id, title, type, description, role?, module?, milestone?, selected: true }`.
   `description` falls back to the visible `.oq-label` text when the
   author of the final-report did not set `data-issue-body`; either is
   enough to skip prompting.
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

7. Update the final-report HTML: in the open-questions section, replace
   each created item's label with `[Issue #NNN] {title}` (linked to the
   issue URL), disable the checkbox, and add a small ✓ badge. For items
   that were merged by the user-value gate, link ALL source items to the
   one merged issue. Disabling is what makes the row disappear from the
   close-out sheet on the next render — an already-routed item can never be
   submitted twice.

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
   Both, because the id comes from the report's checkbox `name` and a
   hand-written report can leave it empty — a resumed run that can only match
   on an empty id rebuilds what already exists.
4. Rewrite the item's `<li>` in the report the way part A does for issues:
   keep the checkbox, add `disabled`, append an `.oq-done` note naming what
   landed. Write the locale's `final.done_prefix` VALUE ("umgesetzt" /
   "implemented"), never the raw `{{final.done_prefix}}` token — placeholders
   are substituted at generation time, and this rewrite happens long after
   that, so a token written here stays on screen as a token. Disabling the
   checkbox is what drops the row from the close-out sheet on the next
   render.
5. Add a short **Nachtrag** section to the final report naming what was built
   and where. Do NOT append a new iteration — the final report is the closing
   artefact and stays the last tab.
6. If an item cannot be built (it turns out to need a decision, or it breaks
   something), stop that item, leave its checkbox live, and say so in the
   Nachtrag. Never silently downgrade it to an issue: the user asked for code
   and has to see that they did not get it.

## C · Disposition staging per mode

   - `keep`, no `moveTo` → nothing (plus the attachments copy + `git add`
     from `step6-closeout.md` → Also dispose of the durable store).
   - `keep` + `moveTo` → `cp` the HTML and the decisions JSON into
     `<moveTo>/`, `git add` the copies, `git rm --cached` the originals
     (if tracked).
   - `gitignore` → the `.gitignore` line and the `git rm --cached` from the
     table in Step 6a (`step6-closeout.md` § Disposition, cleanup procedure and disposition tables).
   - `discard` → `git rm --cached` the HTML and the decisions JSON if
     tracked.
   Nothing to commit → no commit. Step 6a then skips the git half of its
   table for this close-out and only moves or deletes the files on disk
   (for `keep` + `moveTo`: delete the originals, the copies are already in
   place).

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
   end-of-session signal.

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
