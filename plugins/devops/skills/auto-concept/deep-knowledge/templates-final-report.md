# Concept templates, part 42 of 42: Shared systems — final report panel, design system

## Final Report Panel

The final-report section closes a concept session. It is appended via the
implement-action branch of Step 5b (see `SKILL.md` § Final-report append).
The right-side panel automatically switches to `panel-final-report` mode
when `showIteration()` detects `data-final-report` on the active section
— no iterate / implement buttons, **no status line and no pipeline recap**:
the foot is the **close-out sheet** (`#closeout-sheet`) and nothing else,
and nothing below it — earlier rounds are the head's 🕘 rounds chip. The panel's
`.panel-status` line ("Gespeichert · verbunden") is hidden on this tab
(`body.viewing-final .panel-status`), and the persistent status channel
that used to sit above the sheet is gone — both said things the sheet's one
button now says itself (a disconnected bridge becomes its "· wird
zwischengespeichert" label, a running or finished close-out becomes its
state), and each cost the accordion rows ~40–50px it needs. The TOC above
the sheet shrinks to a 3-entry window around the reading line
(`applyNavWindow()`, § Section Nav JS) for the same reason.

The sheet is deliberately **DOM-driven, not connection-driven**: it is
present because the section carries `data-final-report`, so it survives
reloads and stays fully visible even when the Claude heartbeat is stale —
the close-out affordance must never vanish just because the connection
flickered. Reviewing earlier iterations (via the ever-present tab bar or the
head's 🕘 rounds chip) never hides it, so there is nothing to "re-open".

**A final report is a document round.** Append it with
`data-iteration-template="free"` — never leave the attribute off (see
`resolveIterationTemplate()`, § Tab Switch JS: an undeclared section used to
inherit whatever tab the reader came from) and never make it `design`, whose
`position: absolute; inset: 0` sections and hidden `.iteration-intro` are
built for a mockup, not for a report with a TOC. The ☰ panel is page chrome
and does not move with that choice — see § Panel Chrome (all templates).

### The close-out sheet

**Why one sheet.** The panel first showed four controls at once — 🚀 Shippen,
Issues erstellen, Concept beenden, Iterationen ansehen — each firing its own
submit. Two things were wrong with that, both structural:

1. **No order.** Three of the four were real, irreversible actions with a
   correct sequence (issues before ship before file cleanup), but the panel
   presented them as peers and left the sequencing to the user.
2. **No way to want more than one.** The first click submitted, dimmed the
   content and ended the round. A user who wanted issues *and* a ship *and* a
   specific disposition had no way to say so.

A four-step wizard (issues → ship → files → review) fixed both and introduced
a third problem, reported from real use: **the flow was unreadable.** "Weiter"
between questions looked like it might already be doing something; the old
"Alles ausführen" button and the per-step Weiter were two different kinds of
commitment on the same screen; and the plan of consequences — the one thing
that licenses an irreversible click — only appeared on the last step. Putting
every question on screen at once (the sheet's first cut) fixed the ordering
and the readability, but on a full sheet (open points + ship + files +
hand-offs) it traded that for a wall the user had to scroll past to reach the
plan and the button — "viel Scrollen, viel Platz für wenig Interaktion". A
free-click accordion with a "Gewählt: …" plan line under the button, three
status hints beneath that, and a status line + pipeline recap above the
sheet fixed the wall but spent ~180px of a 360px-wide panel repeating what
the rows' own summaries and the button already said.

The sheet is now a **sequential accordion**: the same rows, the same fixed
execution order, but each collapses to one line — `○`/`●`/`✓` · icon ·
label · current answer — and exactly one is open at a time
(`openCloseoutRow()`). The order is enforced, not suggested: the first
unanswered row opens by itself, every unanswered row after it is **locked**
(`data-locked`, head `disabled`, dimmed, no summary —
`isCloseoutRowLocked()`), and the only way forward is the single button at a
fixed place, which reads **"Weiter ›"** while any row is unanswered (clicking
it confirms the open row and opens the next unanswered one —
`closeoutButtonClick()`) and turns into the warning-coloured **"⚠ Ausführen"**
only once every row is (`updateCloseoutButton()`), which is the same click
that submits `finalize`. Never two buttons, never "Alles ausführen". An
**answered** row stays clickable (`closeoutRowClick()`) to go back and change
the answer; the rows in between keep their state. "Answered" means the row
was open when that one button was clicked — or, in a single-choice row
(ship, this page), that the user actively clicked one of its options,
the pre-selected default included (`closeoutChoiceClick()`): clicking
"Ja, Ship-Pipeline starten" or "Seite löschen" confirms the row and opens
the next one exactly like "Weiter ›", which stays the alternative for
taking the default untouched, never a forced second click. Arrow-key
browsing through a radio group does not count, and the followups row (one
route per open point) never auto-advances. A choice click never submits —
only the button does. A pre-selected default may stand as given,
confirming just means the user looked. There is no separate plan line: each collapsed row's inline summary
("shippen", "Seite löschen", "2 · Issue, Issue", "2 Schritte") IS the
readout of what will happen, and the consequence warning ("Ein Klick, alles
davon …") is the execute button's data-tip tooltip. Progress ("n von N
beantwortet", `#closeout-progress`) and each row's answered flag are mirrored
into `sessionStorage` (`closeoutStorageKey()`, keyed by `STORAGE_KEY` +
iteration) so a reload within the same session does not re-ask what was
already answered — never `localStorage`, which the route/ship radios
deliberately avoid (`data-no-persist`, see below).

**After the click the button is the status.** `setCloseoutButtonState()`
swaps the same button through "⏳ Claude arbeitet es ab …" (submit and
in-flight restore), "✓ Concept abgeschlossen." (the `data-closed` render)
and "⚠ Übermittelt · Claude antwortet nicht" (`markCloseoutStalled()`),
disabled and colour-coded on `[data-finalize-state]`; only the stalled
state also keeps a paragraph under the button, because it carries an
instruction (check the chat). No status hint ever sits under a live button.

**Blocks** — top to bottom, and the same order Claude executes them in.
Every block is an accordion row (`data-closeout-row`):

| Block | Shown when | Default | Produces |
|---|---|---|---|
| `followups` | the report has a `[data-open-questions]` block with ≥1 non-disabled checkbox | every row on **Issue** | `issues: { create, items[] }` + `implement: { run, items[] }` |
| `ship` | always | **none — the user must answer** | `ship: { run }` |
| `files` | always | `discard` (label: "Seite löschen") | `disposition: { mode, moveTo }` |
| `handoffs` | the report has a `[data-handoffs]` section with ≥1 `<li>` | — (read-only; "answered" = opened once) | nothing; mirrors the steps the user has to take by hand, and is the only block still shown after `data-closed` |

**Three routes per open point, not a checkbox.** A follow-up is worth
tracking, worth building now, or worth dropping — and the old checkbox could
only say "file an issue" or "forget it". Each row therefore carries a
three-way radio group (`Issue` / `Jetzt umsetzen` / `Ignorieren`), and the
payload splits into two disjoint buckets. `Jetzt umsetzen` is the one route
that writes code, so it is painted in the warning colour the implement button
uses.

**Each row names its origin.** A point is on the sheet either because the
user parked it during the concept or because it turned up on the way and has
nothing to do with the scope — those are the only two admissible origins
(`SKILL.md` § Open points admission gate), declared per item as
`data-oq-origin="deferred"` / `"found"` and rendered as a muted tag
(`final.origin_deferred` / `final.origin_found`) under the title. The tag
is context for the route decision, not a fourth choice; it also makes a row
that skipped the gate visible at a glance — an in-scope leftover has no
honest origin to declare.

The `[data-open-questions]` checkboxes in the report body stay the **single
source of truth for which points are still open**: `Ignorieren` unchecks the
body box, the other two check it, and Claude's routed-item rewrite (adding
`disabled` + the `[Issue #NNN]` link) keeps working unchanged. The route
radios carry `data-no-persist` for the same reason the ship radios do —
`saveState()` restores every named radio document-wide, and a remembered
"jetzt umsetzen" would sail through a later close-out and write code nobody
re-authorised. After a reload every row falls back to `Issue`, which writes
nothing.

**The ship question has no default on purpose.** It is the one block that
reaches outside the repo, so it must be an answered question, never a skipped
one. Execute stays enabled and explains the block
(`#closeout-ship-required`) rather than sitting there disabled and looking
broken.

**The rows are what license the single click.** Every consequence is
readable on the collapsed rows themselves, in execution order — "2 · Issue,
Jetzt umsetzen", "shippen", "Seite löschen", "2 Schritte" — and each
summary re-renders on every change (`updateCloseoutRowSummary()`), so it can
never describe an older answer than the one on screen. `#closeout-execute`
sits at a fixed place below the rows and reads "Weiter ›" until every row is
answered, then transforms into the warning-coloured "⚠ Ausführen" — reaching
the irreversible click is a deliberate, staged sequence rather than a
distance-based misclick barrier.

**"Seite löschen", never "Verwerfen".** The disposition block used to be
labelled *Verwerfen (Standard)*, one word away from the bi-state *Verwerfen*
on every variant card — and it read as "throw the work away" when it only
ever deleted an HTML file. The label names the file now, and its hint says
the implementation is untouched.

**Payload:**

```json
{
  "submitted": true,
  "action": "finalize",
  "submission_id": "sub-…",
  "issues":    { "create": true, "items": [ /* routed to Issue */ ] },
  "implement": { "run": true,    "items": [ /* routed to Jetzt umsetzen */ ] },
  "ship":      { "run": true },
  "disposition": { "mode": "discard", "moveTo": null }
}
```

`submitFinalize()` requires the bridge's **durable ack** (`body.durable`), not
just a non-throwing fetch — a finalize can ship, so a 507 that silently looked
like success would be the worst possible place to lose a payload. On transport
failure it queues via the offline submit queue; on a non-durable answer it
hands the sheet back and warns.

**Lifecycle of the sheet's own state:**

| Moment | State |
|---|---|
| Submit | `setCloseoutFrozen(true)` — every control disabled, the button reads "⏳ Claude arbeitet es ab …" (`setCloseoutButtonState('running')`), `_submittedAt` set so `pollProcessedState()` tracks the round like any other submission |
| Non-durable answer | `restoreCloseoutToReady()` — re-armed, warning shown; the payload is in the offline queue |
| Blocked ship / stuck round | `restorePanelToReady()` routes to `restoreCloseoutToReady()` for a final report — it must never un-hide `#panel-ready`, which would paint iterate/implement onto a closed session |
| Successful close-out | Claude stamps `data-closed` on the section before the last `/reload`; `renderCloseout()` then shows the button as "✓ Concept abgeschlossen." (disabled) and no other controls at all |

### Final-report section HTML

The body of the section is structured like a multi-section freeform
report — every `<section id data-nav-label>` inside it surfaces in the
section TOC automatically. Open questions / TODOs use a dedicated
`<section data-open-questions>` wrapper around a checkbox list.

```html
<section id="iter-3" data-iteration="3" data-iteration-template="free" data-final-report data-active>
  <div class="iteration-intro">
    <h2>{{iteration.final_tab}}</h2>
    <p>Kurze Einleitung — was wurde umgesetzt, in welcher Form.</p>
  </div>

  <section id="summary" data-nav-label="Zusammenfassung">
    <h3>Zusammenfassung</h3>
    <p>Was wurde gebaut, mit welchem Commit.</p>
  </section>

  <section id="changed-files" data-nav-label="Geänderte Dateien">
    <h3>Geänderte Dateien</h3>
    <ul>
      <li><code>src/auth/middleware.ts</code> — Token-Validierung neu</li>
    </ul>
  </section>

  <section id="tests" data-nav-label="Tests &amp; Verifikation">
    <h3>Tests &amp; Verifikation</h3>
    <p>Was lief, was wurde übersprungen, mit Begründung.</p>
  </section>

  <!-- Optional — render only when there are real follow-ups to track.
       Each <li> is one item; data-issue-* attributes feed the finalize
       payload's issues.items[] directly so Claude can call
       `gh issue create` end-to-end without ever asking the user a
       follow-up question. Mandatory attrs: data-issue-title,
       data-issue-type, data-oq-origin ("deferred" = the user parked it
       during this concept, "found" = surfaced on the way, unrelated to
       the scope — nothing else is admissible, see SKILL.md § Open
       points admission gate). Recommended: data-issue-body (richer description
       than the visible label; falls back to the .oq-label text).
       Optional project-context hints (only when Claude can infer them
       from the concept): data-issue-role, data-issue-module,
       data-issue-milestone. Checkboxes default to `checked`. -->
  <section id="open-questions"
           data-nav-label="{{final.open_questions}}"
           data-open-questions>
    <h3>{{final.open_questions}}</h3>
    <ul class="open-questions-list">
      <li>
        <label>
          <input type="checkbox"
                 name="oq-saml-edge"
                 data-issue-title="[BUG] Auth fails for SAML users"
                 data-issue-type="bug"
                 data-issue-body="During smoke test of the new middleware, SAML logins failed with 'invalid assertion'. Out of scope for the auth-middleware-redesign concept (concept covered OIDC only). Reproduce: log in via SAML IdP in staging."
                 data-issue-role="backend"
                 data-issue-module="auth"
                 data-oq-origin="found"
                 checked>
          <span class="oq-label">Auth fails for SAML users — observed during smoke test, out of scope here</span>
        </label>
      </li>
      <li>
        <label>
          <input type="checkbox"
                 name="oq-rate-limit"
                 data-issue-title="[FEATURE] Rate-limit the token endpoint"
                 data-issue-type="feature"
                 data-issue-body="Parked by the user in iteration 2 (card 'Rate limiting' answered 'später'): the new bearer-token flow ships without a per-client rate limit on /auth/token. Add a sliding-window limit (suggested 60/min per client id) with a 429 + Retry-After response."
                 data-issue-role="backend"
                 data-issue-module="auth"
                 data-oq-origin="deferred"
                 checked>
          <span class="oq-label">Rate-limit the token endpoint — parked by you in iteration 2</span>
        </label>
      </li>
    </ul>
  </section>

  <!-- Optional — ONLY when the user has to do something by hand after the
       merge. data-handoffs paints the section, marks its TOC entry and
       mirrors the list onto the close-out sheet, where it is the one block
       that stays visible after the close-out. Omit it entirely when there
       is nothing to hand over; never use it for recommendations. -->
  <section id="handoffs" data-nav-label="{{final.handoffs}}" data-handoffs>
    <h3>{{final.handoffs}}</h3>
    <ol>
      <li>Set the scheduled task's cron to <code>0,20,40 * * * *</code> — the description is already updated.</li>
      <li>Watch the first run's report line: a title that stays on "working" for more than 3 h is a run that died holding the lock.</li>
    </ol>
  </section>
</section>
```

### Open-questions item attributes

The first four attributes are MANDATORY for the auto-issue pipeline.
Without them Claude has no way to land a complete `gh issue create` call
and would have to fall back to interactive prompting — which is exactly
the regression we are designing against. Generate them when you author
the final-report block; do not leave the user to fill them in.

| Attribute | Required? | Purpose |
|---|---|---|
| `name` (or `id`) | yes | Stable identifier reused in the `create-issues` payload's `item.id` |
| `data-issue-title` | yes | Verbatim title used by `gh issue create` (`[TYPE] Imperative title`). Without this the payload's `title` falls back to the visible `.oq-label` text, which usually breaks the title-format gate |
| `data-issue-type` | yes | Maps to the issue label (`bug`, `feature`, `refactor`, `chore`, `docs`, `design`). Defaults to `chore` if omitted — set it explicitly |
| `data-oq-origin` | yes | Why the row exists — `deferred` (the user parked it during this concept; say where in the body) or `found` (surfaced on the way, unrelated to the scope). Rendered as a muted tag under the row's title. No other value is admissible: an in-scope leftover has no honest origin and belongs in the Zusammenfassung as a shortfall, not here (`SKILL.md` § Open points admission gate; validation gate 33b) |
| `data-issue-body` | recommended | Multi-sentence description used as the GitHub issue body. Falls back to the `.oq-label` text when missing — that is usually too terse for a tracked issue. Always populate this with the concept-context the user would need to act on the issue cold (repro steps for bugs, motivation for refactors, etc.) |
| `data-issue-role` | optional | Project-specific role label hint (`backend`, `frontend`, `infra`, …). Picked up when the project's `auto-issue` extension defines `role:*` labels; silently ignored otherwise |
| `data-issue-module` | optional | Project-specific module label hint (`auth`, `ingest`, `ui-core`, …). Same gating as `role` |
| `data-issue-milestone` | optional | Milestone name to attach. Claude will only honor this if the milestone already exists; never auto-creates one from this attribute |
| `checked` | default `true` | User opts out, not in |
| `disabled` | set by Claude | Added after the item has been routed (becomes `[Issue #NNN]`) so `openQuestionBoxes()` ignores it on the next reload |

### After a point is routed — HTML rewrite pattern

When Claude processes a `finalize` payload it rewrites every routed `<li>` so
the user sees what became of it: an issue link for part A, an "umgesetzt" note
for part B. The checkbox stays in the DOM but is disabled, which keeps
`restoreState()` consistent across reloads — and dropping it out of
`openQuestionBoxes()` is what removes the row from the close-out sheet:

```html
<li>
  <label>
    <input type="checkbox"
           name="oq-saml-edge"
           data-issue-title="[BUG] Auth fails for SAML users"
           data-issue-type="bug"
           data-oq-origin="found"
           checked disabled>
    <span class="oq-label">Auth fails for SAML users — observed during smoke test, out of scope here</span>
    <a class="oq-issue-link"
       href="https://github.com/{owner}/{repo}/issues/123"
       target="_blank"
       rel="noopener noreferrer">{{final.issue_link_prefix}} #123</a>
  </label>
</li>
```

An item the user routed to "Jetzt umsetzen" gets the same treatment with an
`.oq-done` note instead of the link:

```html
<li>
  <label>
    <input type="checkbox"
           name="oq-rate-limit"
           data-issue-title="[FEATURE] Rate-limit the token endpoint"
           data-issue-type="feature"
           data-oq-origin="deferred"
           checked disabled>
    <span class="oq-label">Rate-limit the token endpoint — parked by you in iteration 2</span>
    <span class="oq-done">✓ {{final.done_prefix}} — <code>src/auth/rate-limit.ts</code></span>
  </label>
</li>
```

Once every `<li>` in the section is `disabled`, the sheet's follow-up block
drops out automatically — the section becomes a read-only audit log of what
was routed, and of what was built during the close-out.

### What the sheet renders, and when

`refreshCloseout()` re-renders on:
- `DOMContentLoaded`
- `iteration:changed` (via `showIteration()`) — with `{ reset: true }`, so a
  tab switch rebuilds the follow-up rows from the report body rather than
  trusting a stale row set. `reset` is about the row SET only: the answers
  already given are carried across the rebuild by id, because a detour into an
  earlier round to re-read something must not silently move a row back from
  "jetzt umsetzen" to Issue
- any `change` on a `[data-open-questions]` checkbox, a follow-up route, the
  ship radios, or the disposition radios

The `followups` block renders iff all of:
1. Active section has `data-final-report`.
2. Active section contains a `[data-open-questions]` block.
3. That block has at least one `:not(:disabled)` checkbox.

The `handoffs` block renders iff the active final report has a
`[data-handoffs]` section with at least one `<li>` (`renderHandoffs()`,
called from `renderCloseout()`). It is the only block that stays visible
once the section carries `data-closed`: the sheet's done state is the button
reading "✓ Concept abgeschlossen." plus whatever is left for the user to do
by hand, and nothing else.

Rendering runs client-side only — Claude never adds or removes a block via the
bridge; it controls the follow-up block indirectly by disabling checkboxes
when it writes the routed HTML.

`buildFollowUpList()` rebuilds the rows only when the underlying item **set**
changes, keyed by id — never by count — and carries the existing answers
across that rebuild, also by id. A rebuild driven by a route's own
change event would tear the row out from under the user's cursor mid-click,
and a count-keyed fast path would re-sync every row to the wrong body
checkbox when Claude routes one item and appends another in the same rewrite.

### Disposition Control

The disposition fieldset (`#panel-dispose-concept`) is the sheet's `files`
block — always present, not gated on open-questions content. Its three radios +
optional `moveTo` text input drive Step 6 cleanup behaviour. The user chooses
how the concept files should land on disk before closing the session.

**Disposition modes:**

| `mode` | Step 6 cleanup behaviour |
|---|---|
| `discard` *(default)* | Delete the concept HTML, the matching `-decisions.json` AND its source folder `{date}-{slug}/` from `docs/concepts/`. |
| `keep` | Leave the files in place (or under `moveTo` if set). They remain git-tracked. |
| `gitignore` | Leave the files in place (or under `moveTo` if set) AND append `docs/concepts/{date}-{slug}.*` plus `docs/concepts/{date}-{slug}/` (or the moved paths) to the repo's `.gitignore` if not already covered. |

**Optional `moveTo` (string):** the user may type a target directory
(e.g. `docs/architecture/decisions/`). When set, Claude `mv`s both the
HTML file AND the decisions JSON to that directory FIRST, then applies
the `mode` semantics. Empty / whitespace-only input is treated as null.

**Payload shape:**

```json
{ "mode": "discard" | "keep" | "gitignore", "moveTo": "docs/architecture/" | null }
```

The `finalize` payload carries this sub-object alongside `issues` and `ship`;
so do the legacy `create-issues` / `ship` / `dispose-concept` payloads. The
contract is documented in `SKILL.md` § Step 6 — Cleanup-By-Disposition.

**Backward compatibility:** old concept sessions that submitted without a
`disposition` field, or any submission that ended the session before this
control existed, default to `disposition: { mode: "discard", moveTo: null }`.
The default is intentionally aggressive — most one-shot refinements do not
need to persist the HTML in git, and a stray opt-out is cheaper to fix
(re-render or check-in manually) than a stale concept directory full of
forgotten artefacts.

### One submission, four consequences

`finalize` is a single submission that can carry up to four real actions.
Claude executes them in a fixed order — **issues → implement → ship → Step 6
cleanup** — and the order is not negotiable:

- Issues first, because they are cheap, local to GitHub, independent of
  everything else, and their creation must not depend on a release
  succeeding. A run that dies later still leaves the follow-ups tracked.
- Implement second (the points routed to "jetzt umsetzen", built by the
  devops agents — SKILL.md Step 5b · finalize part B), because a release must
  contain that work rather than predate it.
- Ship third, because it is the one part that can hard-fail on a gate. When it
  does, Claude stops there: created issues and implemented follow-ups stand,
  **cleanup does not run**, and the concept session stays open so the user can
  retry.
- Cleanup last, because `discard` deletes the concept HTML — doing that before
  the outward-facing steps would destroy the record while it is still needed.

**Replay protection is on the bridge, not just the page.** The `_version`
mismatch guard people reach for here only exists on `POST /reset` and
`POST /status` — `POST /decisions` has no such guard on its own, it just
creates a new version and flips `/pending` to true. So a finalize whose
response was lost in transit after the bridge had already fsynced it sits in
BOTH places, and the offline queue would happily deliver it again: duplicate
`gh issue create`, a second real release, `discard` applied twice. That is
why every payload — finalize, iterate, implement — carries a `submission_id`.
Two layers use it: `retryPendingSubmission()` compares it against what
`/decisions` already holds before re-POSTing (see § Offline Submit Queue) —
but that check alone only survives until Claude's `POST /reset` clears
`/decisions`, which is exactly the window a lost-response retry lands in. The
bridge itself closes that gap: `concept-server.py`'s `POST /decisions`
remembers every `submission_id` it has journalled (a bounded ring, derived
from `journal.jsonl` on restart too) and answers a repeat of an already-seen
id with `{"ok": true, "durable": true, "duplicate": true}` WITHOUT touching
`_decisions`, `_version` or the pending marker — so a retry that beats the
page's own check can never make Claude re-process a finalize it already ran.
Do not drop the `submission_id` field, do not "simplify" the retry, and do
not treat the client-side check as sufficient on its own.

## Design System

### Colors
- Dark mode: `#0d1117` background, `#c9d1d9` text, `#58a6ff` accent
- Light mode: `#ffffff` background, `#24292f` text, `#0969da` accent
- Success: `#3fb950` / `#1a7f37`
- Warning: `#d29922` / `#9a6700`
- Danger: `#f85149` / `#cf222e`

### Typography
- System font stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Headings: 600 weight, tight letter-spacing
- Body: 400 weight, 1.6 line-height
- Code: `'Cascadia Code', 'Fira Code', monospace`

### Spacing
- Section gap: `2rem`
- Card padding: `1.5rem`
- Element gap: `0.75rem`

### Interactive Elements
- Toggle switches: 44px wide, smooth transition, clear on/off state
- Checkboxes: custom styled, visible check mark
- Comment fields: `width: 100%` within their container, `min-height: 80px`,
  auto-expanding textarea
- Text inputs: `width: 100%` within container, generous padding (`0.75rem`)
- Submit button: in decision panel, full-width within panel
- Sliders: labeled endpoints, current value display, full container width
