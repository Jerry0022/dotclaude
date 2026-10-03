---
name: auto-concept
version: 0.2.2
description: >-
  Generate an interactive HTML page for analysis, plans, concepts, prototypes,
  comparisons, or creative work — open it in the browser and monitor user
  decisions (toggles, selections, comments) to feed them back into the workflow.
  Triggers on: "concept", "concept page", "interactive plan",
  "show me this as a page", "visualize this".
  Also auto-suggest when Claude completes analysis, planning, comparison,
  or concept work that would benefit from interactive decision-making.
  Do NOT trigger for: simple code explanations, debugging
  (use /auto-fix), or static documentation (README work follows
  {PLUGIN_ROOT}/deep-knowledge/readme-standards.md).
layer: 2
invokes: [do-ship, auto-agents, auto-issue]
user-invocable: false
triggers:
  en: ["concept", "concept page", "interactive plan", "show me this as a page", "visualize this"]
argument-hint: "[topic, analysis result, plan, or concept to visualize]"
allowed-tools: Read, Write, Glob, Grep, Bash(start *), Bash(cmd *), Bash(python *), Bash(curl *), Bash(kill *), Bash(node *), AskUserQuestion, CronCreate, CronDelete, mcp__Claude_Browser__*, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__plugin_devops_dotclaude-completion__*, mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__set_session_title
---

# Concept

Generate an interactive HTML page for `$ARGUMENTS`, open it in the browser,
and monitor for user decisions.

## No reachable bridge ≠ no concept

A concept request always produces **this skill's page**: the `templates.md`
engine, a template and content variant, the decision panel, the validation
gate, the file under `docs/concepts/`. The bridge is mandatory wherever it can
run — every Desktop or local CLI session runs Step 3 unchanged. Only a session
whose owner **cannot reach** a localhost bridge (a claude.ai cloud or remote
container, no local browser) takes the fallback in Step 3 § No reachable
bridge — and even there only the *transport* changes, never the page. A
hand-built look-alike page with its own decision storage is never a
substitute (#568).

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/auto-concept/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/auto-concept/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `auto-concept/` does not exist, read `~/.claude/skills/concept/` / `{project}/.claude/skills/concept/` instead — an extension written before the rename keeps working.
3. Merge: project > global > plugin defaults

## Step 0.5 — Concept Mode (asked once, at the start)

Before Step 1 runs for the **first** iteration, settle which kind of
concept the user wants. Three modes exist:

| Mode | What the page is | Templates in scope |
|---|---|---|
| **decision** | Pure decision concept — non-visual alternatives to weigh (architecture, strategy, library, approach, …) | `decision` (plus `free` for surrounding analysis) — no mockups |
| **design** | Pure design concept — visual directions / mockups / click-dummies | `design` only — no decision views, no `decision` iteration |
| **mixed** | Both — the visual call AND the non-visual calls belong to the same concept | `design` iteration(s) carrying decision views where the question is *about the mock*, and/or a separate `decision` iteration where it stands on its own (entangled-questions rule in 1a) |

**Before executing this step, Read `deep-knowledge/step1-templates.md` § Step 0.5 · Asking, and the do-batch start completely** — ask exactly ONE `AskUserQuestion` (mixed first, "(Recommended)") unless the prompt names or unambiguously implies the mode or a caller pins the template — then skip it; a `--from=do-batch` start derives the mode from its open decisions and never drops a coverage line.

The mode is decided **once per concept**, not once per iteration. Later
iterations (Step 5c) still pick their own template through the 1a check —
the mode only says which templates are in scope. Feedback that pulls the
concept the other way ("zeig mir das mal als Mockup" on a decision concept)
widens the mode silently; no second question.

### Count preferences — recommendations, not instructions

**Before executing this step, Read `deep-knowledge/step1-templates.md` § Count preferences completely** — the default counts (7 alternatives, 3 designs, top 3–7 annotations) and when the user's count wins.

## Step 1 — Pick Template, then Content Variant

### 1a. Pick the template — per iteration

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Per-iteration choice completely** — the template is picked anew for every iteration, never once per page.

Pick via the **strict ordered check below** — first matching template wins,
free is the explicit fallback when neither of the first two applies. Do NOT
skip the order; `free` must never be chosen while `design` or `decision`
would also fit.

**Order of evaluation (mandatory, per iteration):**

1. **Is this iteration primarily VISUAL?**
   The options this iteration puts up for decision are primarily visual —
   layouts, design directions, screen composition, visual arrangement, a
   click-through flow, screen-by-screen UI design, any "design me / sketch /
   lay out a UI" task. If the output needs maximum viewport real estate and
   per-screen (and, with 2+ competing designs, per-design) feedback →
   `design`. **Stop.**

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Design iteration authoring completely** — click-dummy wiring, screens as states, competing designs, single-screen, design system, annotation layer, optional views and the view-vs-decision-iteration rule of thumb.

   **Orthogonality — a view never re-asks the design choice.** The call
   *between* the designs is made in the 💬 dock (per-design and per-screen
   textareas); that is the whole point of showing them side by side. A
   `decision` / `comparison` view therefore asks something that stays the
   same whichever design wins — a data model, a sync strategy, a library, a
   naming scheme. It never lists the designs, or the traits that
   distinguish them ("sidebar as in A" vs "tabs as in B"), as its
   alternatives; it never argues for or against one design in its prose;
   and it never pre-decides a design through its default selection.
**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Orthogonality test completely** — the pre-authoring test, the one-line "needed by" exception and gate P31.

2. **Are there ≥2 substantive non-visual alternatives?**
   Multi-option evaluation where the user must pick from 2+ mutually-exclusive
   alternatives (architecture, tech, strategy, library, approach, …). If there
   are explicit variants A/B/C with pros/cons to weigh → `decision`. **Stop.**
   Count preference: 7 alternatives compared (Step 0.5). In **design** mode
   (Step 0.5) this step is skipped — visual-only concepts do not get a
   `decision` iteration.

3. **Otherwise → FREE.**
   Only reach this step after 1 AND 2 have both been ruled out. Analysis,
   walkthrough, brainstorm, explainer, timeline, status deep-dive, retro,
   post-mortem — structured content that has no forced variant framing.
   Tri-state is opt-in per section (Claude adds it only where a finding
   genuinely needs user evaluation).
   An iteration whose question is "which of these many items goes where" —
   an assignment, not a choice between alternatives — is a `free` round
   carrying ≥ 1 `section[data-mapping]`; inside a design concept it is a
   `data-view-kind="mapping"` subpage instead. (Authoring rules: § 1c;
   markup: `deep-knowledge/templates-free.md` § Mapping block (optional).)

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Entangled questions and layout signatures completely** — entangled visual and non-visual questions are split into a `design` and a `decision` iteration, never mixed into one layout, and the decision round after a design round stays orthogonal to it; plus the per-template layout signatures, the shared ☰ / 💬 chrome and the `prototype` alias.

**Template continuity — decide once, per concept.** The template belongs to
the concept, not to the mood of a round. Once a concept has rendered a
`design` round, every later round stays `design` unless the user asked for
something else — a non-visual question that comes up later (a refinement, a
reality-check collision) belongs in a `data-view-kind="decision"` view inside
a design round, not in a `decision` round of its own. The deliberate
exceptions are exactly two:
- the **mixed mode** of Step 0.5 above, where entangled visual and non-visual
  questions are split on purpose and the user knows why;
- the **final report**, which is always `free` — it is a document with a TOC,
  and the design layout (absolutely positioned sections, hidden
  `.iteration-intro`) is built for a mockup.

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Why continuity completely** — what a template swap does to the reviewer and why the section must carry its template.

Set `data-iteration-template="..."` on each `<section data-iteration="N">` —
this is the **authoritative** value per iteration, and it is MANDATORY on
every section you append (regular round, reality-check round, final report).
**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a · Template projection completely** — how `applyIterationTemplate()` mirrors the active iteration onto `<html data-template>`.

### 1a-ii. If template is `design`: declare the target form factors

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1a-ii · Form factors completely** — declare `data-viewports` (+ default / orientations) from evidence — a desktop tool declares nothing, phone-only declares `phone` — and the markup a device-view screen may not contain.

### 1b. If template is `decision`: pick a content variant

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1b · Content variants completely** — pick analysis / plan / concept / comparison / dashboard / creative by content — recommendations, hybrids allowed; design and free have no sub-variants.

### 1c. If the iteration carries a mapping: author the spec

**Before executing this step, Read `deep-knowledge/step1-templates.md` § 1c · Mapping spec rules completely** — what Claude writes vs what the engine renders, then proposal, ids, counts, tiers, accepts, elements vs axes, labels and the note channel per home.

## Step 2 — Generate HTML

Build a single self-contained HTML file. Requirements:

### Engine source (mandatory — templates.md, never an older page)

**Before executing this step, Read `deep-knowledge/step2-generate.md` § Engine source completely** — mock CSS namespacing, what is copied verbatim from templates.md, why older pages are content references only, the STALE ENGINE gate.

**Before executing this step, Read `deep-knowledge/step2-generate.md` § Localisation, design, page anatomy, submit actions completely** — localisation, design defaults, page header, decision panel layout and anatomy, interactive elements, bi-state evaluation, and the iterate / implement split button (a panel submit alone never changes code).

**Before executing this step, Read `deep-knowledge/step2-feedback.md` § Feedback dock, persistence, feedback mechanism completely** — the 💬 dock, annotation layer, views, reload resilience, the comments-are-never-lost guarantees, the page version tag and the `#concept-decisions` data layer.

### File Location

Write to: `docs/concepts/{timestamp}-{slug}.html`

**Before executing this step, Read `deep-knowledge/step2-feedback.md` § File naming and iteration tabs completely** — the naming pattern, the discard default, one file per session and the iteration tab rules.

### Post-Generation Validation (mandatory gate)

After writing the HTML file, grep it for every mandatory interactive
pattern listed in Phase 1 (heartbeat, all four panel states incl. the
frozen one, iteration tabs, section TOC, reload polling, generic
form-collection catch-all scoped to the active iteration, post-submit
content dimmer, close-out sheet, etc.), plus
the conditional M-set (`deep-knowledge/validation-gate.md` § Mappings) when
the page has `[data-mapping]`.
**If ANY pattern is missing → DO NOT open the page.** Fix the HTML first,
then re-validate. See `deep-knowledge/validation-gate.md` for the full
pattern list and common failure modes.

## Step 3 — Open in Browser

Open the generated HTML file **inside the user's existing Edge window** as
a new tab — NEVER open a separate browser window.

### No reachable bridge — hand-off fallback (cloud / remote sessions)

**Before executing this step, Read `deep-knowledge/step3-open-browser.md` § Hand-off fallback completely** — only when the owner cannot reach localhost (cloud / remote container, no local desktop) — never for speed, tokens or a failed first Edge start; then Steps 0–2 in full, commit + push, the one-line hand-off, no bridge / crons / Edge.

### No reachable bridge, owner decides remotely — artifact fallback (#589)

**Before executing this step, Read `deep-knowledge/step3-open-browser.md` § Artifact fallback completely** — second tier: only when the hand-off applies AND the owner wants to decide now from a remote device AND the Artifact tool exists; build, publish and read back.

### MANDATORY — Real Edge browser only

The concept page MUST be opened in the user's **real Edge browser** via the
OS shell. **Forbidden alternatives** that will produce a broken session:

**Before executing this step, Read `deep-knowledge/step3-open-browser.md` § Forbidden alternatives, open command, 200 gate, token check completely** — the forbidden ways to open the page, the per-platform open command, the HTTP 200 gate, the `--accent-color` check in an isolated profile, and what to do when the open fails.

### Concept Bridge Server + Edge

**Before executing this step, Read `deep-knowledge/step3-open-browser.md` § Bridge server, background tasks, sidebar title, user notice completely** — port pick, state file, heartbeat round-trip, the keepalive pulser and pickup waker, the reality-check baseline, the sidebar compass and the opening message.

### Completion cards while the concept is open

**Before executing this step, Read `deep-knowledge/step3-open-browser.md` § Completion cards while the concept is open completely** — the `concept.phase` table, session-title prefixes, what goes into `pending`, and the URL line.

## Step 4 — Monitor via HTTP Bridge

The bridge server handles all communication — no JS eval injection needed.

**Before executing this step, Read `deep-knowledge/step4-monitor.md` § Heartbeat, pickup and polling schedule completely** — the heartbeat POST, `/pending` vs `/decisions`, waker, backstop cron, initial wait, no timeout, never blocking the conversation.

## Step 5 — Live Feedback Loop

Feedback is processed **iteratively**, not as a one-shot. The cycle:

```
User submits → Claude reads → Claude processes → Claude updates page → User can act again
```

### Mark the round as work

**Before executing this step, Read `deep-knowledge/step5-process.md` § Mark the round as work completely** — the compass-to-hourglass swap on a confirmed wake and the card that ends the round.

### 5a. Read & Parse
**Before executing this step, Read `deep-knowledge/step5-process.md` § 5a · Read and parse completely** — parsing, opening every attachment, the coverage check and reading `mappings[]`.

### 5b. Process & Act — branch by `action`

The submit payload carries an `action` field — `"iterate"` / `"implement"`
from an iteration panel, `"finalize"` from the final report's close-out
sheet. Branch on it:

**Before executing this step, Read `deep-knowledge/step5-process.md` § 5b · Checkpoint duty completely** — the `/progress` checkpoints, the namespaced finalize actions and verify-never-trust on resume.

**`action: "iterate"` (default — "Zur nächsten Iteration" button):**
1. **Summarize** what was selected/rejected/commented
2. **Do NOT modify code, files, or external systems** — iterate ONLY updates
   the concept page
**Before executing this step, Read `deep-knowledge/step5-process.md` § 5b · iterate steps 3–5 completely** — advancing the reality-check baseline, mapping proposals and ad-hoc items, proceeding to 5c.

**`action: "implement"` ("Mit Feedback implementieren" button):**

0. **Reality check — run this BEFORE writing anything.** The default branch may
   have moved since this concept was written, which would make the approved plan
   produce wrong, dead or duplicate code. Full procedure, force classes and
   resume semantics: `deep-knowledge/reality-check.md`. In short:
   - **Skip the check entirely** when the just-submitted section carries
     `data-reality-check` — that round WAS the check, and implementing from it
     goes straight through. This is what makes a second forced round impossible.
**Before executing this step, Read `deep-knowledge/step5-process.md` § 5b · implement — reality-check verdicts and steps 1–4 completely** — the drift run and its verdicts, mapping as spec, execution through `auto-agents`, the full approved scope, the `implemented` phase POST and the final-report append.

**`action: "finalize"` (close-out sheet — only on the final report):**

**Before executing this step, Read `deep-knowledge/step5-process.md` § 5b · finalize payload and zero-prompt invariant completely** — the one `finalize` payload, disjoint item buckets, and never a follow-up question.

**Fixed execution order — A (issues) → B (implement) → C (ship) → D
(cleanup).** Never reorder: issues are cheap and independent and must not
depend on anything else succeeding, the follow-ups the user chose to build
must land BEFORE a release rather than after it, ship is the one part that
can hard-fail, and cleanup can DELETE the concept HTML — running it before
the outward-facing parts would destroy the record while it is still needed.
Skip any part whose flag is false; a payload may legitimately carry none of
them (`ship.run: false`, `issues.create: false`, `implement.run: false`) and
then finalize is just Step 6.

**Checkpoint each part as it lands** (see Checkpoint duty above) — a finalize
that dies mid-flight must be resumable without re-creating issues or
re-shipping.

### A · Issues (`issues.create === true`)

**Before executing this step, Read `deep-knowledge/step5-finalize.md` § A · Issues completely** — item shape, the user-value gate, the `auto-issue` hand-over, label enrichment, body backlink and the report rewrite.

### B · Implement the selected follow-ups (`implement.run === true`)

**Before executing this step, Read `deep-knowledge/step5-finalize.md` § B · Implement the selected follow-ups completely** — the `auto-agents` dispatch, checkpoints, the report rewrite, the Nachtrag and unbuildable items.

### C · Ship (`ship.run === true`)

0. **Stage the disposition first, index only.** Apply the `disposition`
   from part A step 2 to the git index and commit it on the branch
   (`chore(concept): close out {slug}`) before the ship, so the release
   carries it — a disposition applied after `ship_release` is left
   uncommitted on the branch. Every file stays on disk where the bridge
   serves it; Step 6a does the on-disk part after the stop:
**Before executing this step, Read `deep-knowledge/step5-finalize.md` § C · Disposition staging and the ship pipeline completely** — what the index-only staging does per `disposition` mode, and the `do-ship` pipeline with its gates.
2. **On a blocked ship, stop the whole finalize here.** Issues created in
   part A and follow-ups built in part B stand; part D does NOT run. POST
   `/reload` then `/reset`, leave the concept session open so the user can
   retry from the sheet, and report the blocker verbatim. Never fall through
   to cleanup — a `discard` disposition would delete the concept the user
   still needs.
3. On a successful release, rewrite the live final-report section in place:
   add a one-line "Shipped" note (version + tag) to the Zusammenfassung.
4. **The ship card comes last.** Once `ship_release` has merged (the ship can
   no longer block), run part D and Step 6a in full — bridge, pulser and
   waker stopped — and only then let `do-ship` render its ship card. A card
   rendered before the stop is followed by the watchers' exit notifications,
   and the chat no longer ends on the outcome.

### D · Close out

**Before executing this step, Read `deep-knowledge/step5-finalize.md` § D · Reload and reset per disposition completely** — `data-closed`, reload-before-reset for keep / gitignore, reset-only for discard.
2. Proceed to Step 6a with the `disposition` stored in part A step 2. Treat
   this submission as the explicit "fertig" signal from the user. Step 6a
   stops the bridge, the pulser and the waker and waits until all three are
   gone — that happens BEFORE any final card, so no exit notification can
   arrive after it.
3. **Card selection — only after the stop:** if part C ran successfully, the
   `do-ship` ship card (held back per part C step 4) is the authoritative
   closing artefact and you MUST NOT render a second concept completion card
   (duplicate summary). Otherwise render the concept card per Step 6b.

### Legacy final-report actions

Pages generated before the close-out sheet submit one action at a time.
Map each onto the part that does the SAME THING — never onto the letter it
used to have, which shifted when the implement part was inserted:

| Legacy action | Runs |
|---|---|
| `create-issues` | part A (issues) + Step 6 with the bundled disposition |
| `ship` | part C (ship) + Step 6 |
| `dispose-concept` | part D (close out) only |

**Before executing this step, Read `deep-knowledge/step5-finalize.md` § Legacy rationale and the critical invariant completely** — part B never runs for a legacy page and `dispose-concept` never reaches the ship pipeline; `iterate` never changes anything outside the concept HTML, and within finalize only B writes code and only C reaches outside the repo.
### 5c. Update the Page
After processing, **append a new tab** to the same HTML file and signal
the browser to reload. This is the ONLY update path — there is no
separate "in-place edit" vs. "new file" distinction anymore.

For `action: "iterate"` → append a regular iteration section.
For `action: "implement"` → append a **final-report section** (one-time,
see § "Final-report append (implement only)" below).
For `action: "implement"` that Step 5b step 0 diverted → append a **regular
iteration section carrying `data-reality-check` and
`data-reality-head="<examined sha>"`** instead, with the
`{{iteration.reality_tab}}` label on its tab and the `.reality-banner`
explainer as its first child. Everything else about the append is identical to
a normal iteration, including the append checklist and the `/reset` ordering.
**Before executing this step, Read `deep-knowledge/step5-update-page.md` § Reality-check round — template and markers completely** — the forced round keeps the concept template, and both markers are read back before `/reload`.
For `action: "finalize"` → no new section; rewrite the existing final-report
HTML in place (linked `[Issue #NNN]` labels for routed items, a shipped note
when part B ran) and POST `/reload`.

Procedure on every iteration (including the very first response to feedback).

**Order matters — `/reset` is the LAST step, NOT the first.** Posting `/reset`
early stamps `_processed_at` on the server, which makes the browser's
`pollProcessedState` flip the panel back to "ready" before the new iteration
is on disk. The user then sees the still-active OLD iteration with
re-enabled submit buttons and can fire a duplicate submission. The new
iteration must be live in the browser BEFORE the server signals "processed".

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § 5c · Append procedure completely** — the numbered append procedure: freeze, coverage, engine drift, append, tab, /reload, /reset, re-launch the waker.

### Final-report append (implement only)

When `action: "implement"` is being processed, step 3 of the procedure above
differs: instead of appending a regular iteration, append a **final-report
section**. Everything else (freeze previous, /reload, /reset, version
preservation) stays identical.

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § Final-report append — steps and verbatim copy directive completely** — freeze, the `free` final-report section, report structure, tab label, the close-out JS copied verbatim.

**Open points section — admission gate (default: no section):**

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § Open points admission gate completely** — default no section; admissible only `deferred` (parked by the user in this concept) or `found` (outside the scope, found on the way), each row carrying `data-oq-origin`; never scope, next steps, nudges or harmless drift; no further iterations from the final report.

### 5d. Resume Monitoring

**Re-launch the pickup waker.** It exited to wake you for the submission you
just processed, so nothing is watching `/pending` until you start it again —
exactly as in Step 3 (`bridge-server.md` § step 3, task 2), with
`run_in_background: true`. Do this at 5c step 7, the moment `/reset` lands; by
the time you reach 5d it should already be running.

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § 5d · Re-confirm every wake completely** — the stale-wake check, equal `_version` = retry the reset, and the `GET /recovery` reality-check exception.

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § 5d · Exit reasons completely** — the one correct response per `*_EXIT` reason and when to re-launch the pulser.

Then return to Step 4 (monitor for next submission). The loop continues until:
- The user closes the page
- The user says "fertig" / "done" in chat
- There are no more decisions to make (all items processed)

**Before executing this step, Read `deep-knowledge/step5-update-page.md` § 5d · Expected action on the final report completely** — the `finalize` payload the close-out sheet sends, legacy actions, and protocol errors.

### 5e. Persist
Write a cumulative summary to `docs/concepts/{same-timestamp}-{same-slug}-decisions.json`
after each iteration (append a new entry per iteration — don't overwrite
previous rounds; each entry records its `iteration` number).

## Step 6 — Completion Card

The feedback loop ends when the user is satisfied (user says "fertig"/"done",
closes the page, or all items are processed). Then **clean up the
bridge-server state** and render a completion card.

### 6a. Clean up the active-concept state — Cleanup-By-Disposition

Before rendering the completion card, stop the bridge server, the pulser and
the waker, remove the state file, AND dispose of the on-disk concept
artefacts. The card is the last thing in the chat — nothing of the concept
may still be running when it renders. The on-disk steps depend
on the user's disposition choice (see `deep-knowledge/templates-rounds.md`
§ Disposition Control for the UI + payload shape).

**Before executing this step, Read `deep-knowledge/step6-closeout.md` § Disposition, cleanup procedure and disposition tables completely** — the disposition is the `finalize` payload's, else the last legacy payload's, else `discard`; the `/shutdown` + owner-checked state-file removal, stopping the watchers before any card, the title restore, the cron delete, and the per-mode file and durable-store tables.

**UNPROCESSED guard — never discard unseen work.** Before any `rm -rf` of a
store, check for `.claude/concepts/{date}-{slug}/UNPROCESSED`. Its presence
means a submission was made that Claude never finished processing, so the user
has not yet seen a result for it. Deleting that is the very loss this whole
mechanism exists to prevent, and a default-`discard` disposition (§ above:
`discard` is what an aborted session falls back to) would otherwise do it
silently.

**Before executing this step, Read `deep-knowledge/step6-closeout.md` § UNPROCESSED guard command, orphan sweep, safety rules, reporting completely** — the guarded store deletion, what to do when the guard trips, the 7-day orphan sweep, the path safety rules and the disposition line on the card.

### 6b. Render the completion card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card`:

**Before executing this step, Read `deep-knowledge/step6-closeout.md` § 6b · Variant and card fields completely** — variant `analysis` (read-only result), `ready` (code changed in Step 5b) or `aborted` (discarded / aborted), the fields to pass, and never a `concept` field.

Output the returned markdown VERBATIM as the LAST thing in the response —
nothing after the closing `---`.

If the concept is part of a larger task (e.g. called mid-flow from another
skill), skip the card and return control — the parent skill renders its own.

### 6c. Pause and resume (#555)

The user pauses in chat ("pausieren", "machen wir später weiter") → **pause**,
not close-out: stop the pulser, the waker, the backstop cron and the bridge,
mark `concept-active.json` with `paused_at`, keep page, decisions and store,
end with the `paused` card (no `concept` field). Resume only when a prompt
continues this concept: relaunch on the same port, re-arm, drop `paused_at`.
Order, commands and the state-file rewrite: `deep-knowledge/pause-resume.md`.

## Smart Trigger Rules

The auto-concept skill should be **auto-suggested** (not auto-triggered) when:

1. Claude completes a **multi-option analysis** (3+ options with trade-offs)
2. Claude presents an **implementation plan** with 5+ steps
3. Claude delivers a **comparison** of technologies/approaches
4. Claude finishes **concept work** with multiple variants
5. Claude produces any output where **user decisions** are needed to proceed

**How to suggest:**
Append to the response: "Soll ich das als Concept-Seite aufbereiten?"

**When NOT to suggest:**
- Simple yes/no questions — just ask directly
- Single-option recommendations — no decision needed
- Code-only outputs — not suitable for HTML visualization
- User explicitly declined a concept page earlier in the session

## Rules

- Always self-contained HTML — no CDN links, no external resources
- Never include sensitive data (API keys, passwords) in the HTML
- Comment fields are optional — include only where comments add value
- Design quality matters — this is a deliverable, not a debug dump
- German UI labels (buttons, headers) unless project language says otherwise
- The HTML must be self-contained — no CDN or external fetch calls.
  Bridge server fetch calls (`/heartbeat`, `/decisions`) are the only exception
- Keep file size reasonable (< 500KB) — inline only what's needed
