# Concept templates, part 42 of 46: Shared systems — final report panel, design system

## Final Report Panel

The final-report section closes a concept session. It is appended via the
implement-action branch of Step 5b (see `SKILL.md` § Final-report append) —
or it is the page's only round, when the Abschluss follows an implementation
without a concept before it (report-only entry, `concept-build.js init
--report`). The right-side panel switches to `panel-final-report` mode when
`showIteration()` detects `data-final-report` on the active section, and the
panel then belongs to the close-out alone:

- **Head:** the phase icon — **"🏁 Abschluss"** (`final.phase`) instead of the
  round label; on every normal round it reads **"🧭 Runde N"**
  (`[data-here-round][data-phase]`, § Tab Switch JS). Earlier rounds stay one
  click away through the head's 🕘 rounds chip.
- **No TOC window, no journey row, no status line** in the panel body
  (`body.viewing-final .panel-nav-scroll`, `.journey`, `.panel-status` are
  hidden). The body is the **to-do inbox** (`#closeout-sheet`).
- **Foot, under the divider:** the 🤖 group and the two buttons.

The sheet is deliberately **DOM-driven, not connection-driven**: it is
present because the section carries `data-final-report`, so it survives
reloads and stays fully visible even when the Claude heartbeat is stale.
A disconnected bridge only changes the buttons' label to "… · wird
zwischengespeichert".

**A final report is a document round.** Append it with
`data-iteration-template="free"` — never leave the attribute off (see
`resolveIterationTemplate()`, § Tab Switch JS) and never make it `design`.
The ☰ panel is page chrome and does not move with that choice.

### The close-out sheet — a to-do inbox

**Why an inbox.** The close-out panel went through four buttons at once (no
order, no way to want more than one), a four-step wizard ("Weiter" looked
like it already did something), a wall of every question, and a sequential
accordion with "n von N beantwortet" and "Weiter ›". Each was a form. What is
actually left for the user at the end of a concept is a short list of
to-dos, most of which Claude can pre-answer — so the panel shows exactly
that, pre-answered, and the click that confirms it is also the ship answer.

**Groups, top → bottom, each at most three rows, one line per row:**

| Group | Source in the report body | Row | Default |
|---|---|---|---|
| 🧭 **Du entscheidest** | the Funde: elements with `data-issue-title` inside `[data-open-questions]` (not `data-routed`) | name · reason chip (`data-route-reason`) · route pill ⚡ Jetzt / 📌 Issue / ✕ Ignorieren | `data-route-default` (`now` / `issue` / `ignore`); missing → 📌 Issue (writes no code) |
| 🧪 **Du testest** | `[data-tests] li` — what Claude could not verify | text · criticality chip (`data-crit`) · Muss nicht · Mit Anleitung · Mach ich selbst | `data-crit="low"` → Muss nicht; else `data-guide="web"`/`"desktop"` → Mit Anleitung; else → Mach ich selbst (`data-mode-default` overrides) |
| 👉 **Du machst danach** | `[data-handoffs] li` — manual hand-offs | same as 🧪 | same as 🧪 |

- **More than three Funde** → the first two keep their row and the rest
  become ONE **Sammel-Issue** row (`closeoutFundeSplit()`), routable to
  📌 Issue or ✕ Ignorieren only. The order is the report's: list the Funde
  that most need a decision first.
- **More than three 🧪/👉 items** → three rows plus "+N weitere im Bericht";
  the rest keep their default and stay in the payload. Author at most three.
- **A tap on a 🧭 row opens the bottom sheet** (`#closeout-route-sheet`,
  inside the FAB, over the inbox): the Fund's name, origin tag
  (`data-oq-origin`), description (`data-issue-body`), the recommendation with
  its reason ("Empfohlen: ⚡ Jetzt umsetzen · klein") and three big tiles.
  A tile sets the route and closes the sheet; ✕ and Escape close it
  unchanged; focus returns to the row.
- **"Mit Anleitung" names its kind** under the row: 🧭 Web-Guide (`web`),
  🖥 Desktop-Hilfe (`desktop`) or 📄 Schritte im Chat (`inline` — what the
  user gets when they choose guidance on an item Claude cannot walk them
  through). **The UI never says "nicht führbar"** — Claude can always explain
  what to do.
- No group with nothing in it is shown; with no group at all the inbox says
  "Nichts mehr zu entscheiden — nur noch abschließen."

**Under the divider — 🤖 Claude macht beim Klick:**

- the plan line, re-rendered on every change: "⚡ 2 × jetzt umsetzen · 📌 1 ×
  Issue anlegen" (`renderCloseoutPlan()`), hidden when empty;
- the disposition as ONE line with its default — **"🧹 Diese Seite wird
  gelöscht · ändern"** (`renderDisposeLine()`); "ändern" opens the radios +
  moveTo inline (`toggleDisposeEdit()`, `#panel-dispose-concept`);
- **two buttons, which ARE the ship answer:** **"🏁🚀 Abschließen & shippen"**
  (`#closeout-ship`, warning fill — the implement colour, no ⚠ glyph) and
  **"🏁 Nur abschließen, nicht shippen"** (`#closeout-noship`, ghost). Both
  submit `finalize` — `ship.run` true / false. There is no ship row, no files
  row, no accordion, no progress, no "Weiter ›".

**Colour language** as in the concept rounds: warning = the actions that
write code or reach outside the repo (⚡ pill, the ship button), accent = the
issue route (📌 pill), neutral = drop.

**Choices live in memory only** (`_closeoutChoices`). The 🧪/👉 radios carry
`data-no-persist`; nothing on the sheet is written to localStorage, because
`saveState()` restores named radios document-wide and a remembered
"⚡ Jetzt umsetzen" would sail through a later close-out and write code nobody
re-authorised. A reload falls back to what Claude authored; a tab switch
(`refreshCloseout({ reset: true })`) keeps the choices by id. Rows are rebuilt
only when the item SET changes (by key, never by count), so a choice never
tears its own row out from under the cursor or the keyboard focus.

**After the click the clicked button is the status.**
`setCloseoutButtonState(state, which)` turns the clicked button into "⏳ Wird
abgearbeitet …" (submit and in-flight restore) or "⚠ Übermittelt · keine
Antwort mehr" (`markCloseoutStalled()`, plus the one hint paragraph — it
carries an instruction), and hides the other. The done state
(`data-closed`) hides both and shows **"✓ Concept abgeschlossen ·
schließen"** (`#closeout-close`, closes the panel); the inbox then shows only
the 🧪/👉 items with the mode the user chose (Claude stamps `data-mode` on each
`<li>`), "Muss nicht" muted, and nothing else — no 🧭 group (the report body
says what became of each Fund), no 🤖 group, no line about the completion
card.

**Payload:**

```json
{
  "submitted": true,
  "action": "finalize",
  "submission_id": "sub-…",
  "iteration": "3",
  "issues":    { "create": true, "items": [ /* 📌 — incl. one Sammel-Issue item with collected[] */ ] },
  "implement": { "run": true,    "items": [ /* ⚡ */ ] },
  "ship":      { "run": true },
  "tests":     [ { "id": "t-mobile", "text": "…", "mode": "guide", "guide": "web" } ],
  "handoffs":  [ { "id": "h-cron",   "text": "…", "mode": "self",  "guide": null } ],
  "disposition": { "mode": "discard", "moveTo": null }
}
```

`mode` is `skip` | `guide` | `self`; `guide` is `web` | `desktop` | `inline`
for `mode: "guide"` and `null` otherwise. The Sammel-Issue item has
`id: "__sammel"`, a title from `final.sammel_title`, a description listing
every collected Fund and `collected: [ …the full items… ]`.

`submitFinalize(shipRun)` requires the bridge's **durable ack**
(`body.durable`), not just a non-throwing fetch — a finalize can ship. On
transport failure it queues via the offline submit queue; on a non-durable
answer it hands the sheet back and warns.

**Lifecycle of the sheet's own state:**

| Moment | State |
|---|---|
| Submit | `setCloseoutFrozen(true)` — every control disabled, the clicked button reads "⏳ Wird abgearbeitet …", the other hides; `_submittedAt` set so `pollProcessedState()` tracks the round like any other submission |
| Reload while running | `restoreInFlightCloseout()` asks `/decisions`, re-freezes and picks the button from `ship.run` |
| Non-durable answer | `restoreCloseoutToReady()` — re-armed, warning shown; the payload is in the offline queue |
| Blocked ship / stuck round | `restorePanelToReady()` routes to `markCloseoutStalled()` for a delivered finalize — it must never un-hide `#panel-ready` |
| Successful close-out | Claude stamps `data-closed` on the section (and `data-mode` on every 🧪/👉 item) before the last `/reload`; `renderCloseout()` then shows only those items and "✓ Concept abgeschlossen · schließen" |

### Report body

Plain language on the whole report surface; jargon, file paths and numbers
only in the 🛠 fold. Top → bottom (step5-update-page.md § Final-report append
has the authoring rules):

1. **Heading, always on top:** `.fr-head` with the "🏁 Abschluss" phase label
   and the topic as `<h2 class="fr-title">`. After the close-out the done
   banner `.fr-banner` ("🏁 Abgeschlossen · 🚀 live als vX") sits **under** the
   heading, never instead of it.
2. **Vorher / Nachher** — `.fr-ba` with two `<figure class="fr-shot">`
   screenshots from browser QA and the **"▶ Selbst ausprobieren"** link
   `.fr-try` centred over them (local / preview / live URL; after a ship
   "▶ Live-Version öffnen"). Nothing visual changed → a short `.fr-flow`
   sequence instead.
3. **One sentence "Was getan wurde"** — `.fr-sentence`.
4. **Two columns** `.fr-cols`: **"Was kam raus"** (`.fr-wins`, the top three
   functional results, each with its own glyph disc and one bold key phrase —
   lively, never a plain bullet list) and **"Was es aushält"** (`.fr-meters`,
   the top three non-functional results as Belastungs-Balken).
5. **Prüftiefe-Leiter** — `.fr-depth`: the strongest reached level named big,
   the 7-step `.fr-ladder`, one foot line on the gaps.
6. Folds: **"🔍 N Funde unterwegs"** (the Funde, per Fund was / wo / warum
   vorbelegt — the data the 🧭 group reads) and **"🛠 Für Entwickler"** (at most
   five short lines: commit, areas + ≤ 3 key files, tests in one line, CI
   link).

**Belastungs-Balken** (`.fr-meter`): one per NFR class, picked as the three
most relevant of seven — Performance, Sicherheit, Stabilität,
Datenintegrität, Kompatibilität, Barrierefreiheit, Wartbarkeit (a login topic
weighs security, most others performance). Each meter is one big measured
value, a bar "getestet bis X" against the tick "Ziel Y", and one context
sentence. **Claude always estimates the target itself**, and says so in the
sentence when it is an estimate. `data-met="true"` paints green, `"false"`
amber; `--fr-tested` / `--fr-target` place the fill and the tick (percent of
the bar). No badges, no class tags as decoration — the class name is a plain
line, the value and the sentence carry the meaning.

**Prüftiefe-Leiter** (`.fr-ladder`, seven `<li data-level data-state>`), each
level independently `done` / `open` / `na` (+ `you` for level 7 while it
waits on the user): 1 Code-Check (Lint/Typen) · 2 Trockentest (Unit) ·
3 Zusammenspiel (Integration/E2E lokal) · 4 Lokal durchgespielt (echter
Browser/App) · 5 Prod-Build geprüft · 6 Live vertestet (Staging/Prod) · 7 Von
dir abgenommen. It replaces test-count prose at the top — the numbers live in
the 🛠 fold.

**No checkboxes in the report body.** The Funde are plain `<li>` elements;
the FAB is the only place to answer. After the close-out the body shows what
became of each Fund (issue link / "umgesetzt").

### Final-report section HTML

```html
<section id="iter-3" data-iteration="3" data-iteration-template="free" data-final-report data-active>
  <div class="fr-head">
    <span class="fr-phase">🏁 {{final.phase}}</span>
    <h2 class="fr-title">Token-Login für die API</h2>
  </div>
  <!-- After the close-out, under the heading (never instead of it):
  <div class="fr-banner">🏁 {{final.banner_done}} · 🚀 {{final.banner_live}}<em>21:40</em></div> -->

  <div class="fr-ba">
    <figure class="fr-shot"><img src="{date}-{slug}/shots/before.png" alt=""><figcaption>{{final.before}}</figcaption></figure>
    <figure class="fr-shot"><img src="{date}-{slug}/shots/after.png" alt=""><figcaption>{{final.after}}</figcaption></figure>
    <a class="fr-try" href="http://localhost:5173/login" target="_blank" rel="noopener noreferrer">▶ {{final.try_it}}</a>
    <!-- after a ship: ▶ {{final.open_live}} -->
  </div>

  <p class="fr-label">{{final.done_what}}</p>
  <p class="fr-sentence">Die API meldet jetzt per Token an statt per Session-Cookie, und abgelaufene Tokens erneuern sich von selbst.</p>

  <div class="fr-cols">
    <div class="fr-card">
      <p class="fr-label">{{final.results}}</p>
      <ul class="fr-wins">
        <li><span class="fr-win-icon" aria-hidden="true">🔑</span><span><b>Ein Login</b> reicht für Web und App.</span></li>
        <li><span class="fr-win-icon" aria-hidden="true">♻️</span><span>Abgelaufene Tokens <b>erneuern sich still</b>.</span></li>
        <li><span class="fr-win-icon" aria-hidden="true">🚪</span><span><b>Abmelden</b> wirkt sofort auf allen Geräten.</span></li>
      </ul>
    </div>
    <div class="fr-card">
      <p class="fr-label">{{final.holds}}</p>
      <div class="fr-meters">
        <div class="fr-meter" data-met="true" style="--fr-tested: 92%; --fr-target: 80%">
          <span class="fr-meter-name">🛡 Sicherheit</span>
          <b class="fr-meter-value">0 / 40</b>
          <div class="fr-meter-bar" aria-hidden="true"></div>
          <p class="fr-meter-context">Gefälschte Tokens kamen durch — 40 Versuche, Ziel 0 (geschätzt). <span class="fr-meter-verdict">✓ {{final.target_met}}</span></p>
        </div>
        <div class="fr-meter" data-met="false" style="--fr-tested: 70%; --fr-target: 86%">
          <span class="fr-meter-name">⚡ Performance</span>
          <b class="fr-meter-value">140 ms</b>
          <div class="fr-meter-bar" aria-hidden="true"></div>
          <p class="fr-meter-context">bis zur Anmeldung, Ziel unter 120 ms (geschätzt). <span class="fr-meter-verdict">▲ {{final.target_short}}</span></p>
        </div>
      </div>
    </div>
  </div>

  <div class="fr-depth">
    <p class="fr-label">{{final.depth}}</p>
    <p class="fr-ladder-top">{{final.level_prod}}<small>{{final.level_of}}</small></p>
    <ol class="fr-ladder">
      <li data-level="1" data-state="done">{{final.level_code}}</li>
      <li data-level="2" data-state="done">{{final.level_dry}}</li>
      <li data-level="3" data-state="done">{{final.level_interplay}}</li>
      <li data-level="4" data-state="done">{{final.level_local}}</li>
      <li data-level="5" data-state="done">{{final.level_prod}}</li>
      <li data-level="6" data-state="open">{{final.level_live}}</li>
      <li data-level="7" data-state="you">{{final.level_accept}}</li>
    </ol>
    <p class="fr-ladder-foot">Noch nicht auf der Live-Version getestet. Stufe 7 machst du über 🧪 im Menü.</p>
  </div>

  <!-- The Funde — out-of-scope finds and points the user parked. NO
       checkboxes: plain <li> carrying the data the 🧭 group and the payload
       read. Mandatory: data-oq-id, data-issue-title, data-issue-type,
       data-oq-origin ("deferred" | "found"), data-route-default
       ("now" | "issue" | "ignore") and data-route-reason (one word). -->
  <details class="fr-fold" data-open-questions>
    <summary>🔍 {{final.funde_fold}}</summary>
    <ul class="fr-funde">
      <!-- Visible label (.oq-label, and the text of a 🧪 / 👉 item): a short noun
           phrase of AT MOST 48 characters — the close-out sheet shows two lines
           and nothing more. Details belong in data-issue-body and the report
           body. The gate blocks a longer one (validation-gate.md 33c). -->
      <li data-oq-id="oq-saml"
          data-issue-title="[BUG] Auth fails for SAML users"
          data-issue-type="bug"
          data-issue-body="During the smoke test of the new middleware, SAML logins failed with 'invalid assertion'. Out of scope (the concept covered OIDC only). Reproduce: log in via the SAML IdP in staging."
          data-issue-module="auth"
          data-oq-origin="found"
          data-route-default="issue"
          data-route-reason="riskant">
        <span class="oq-label">SAML-Login schlägt fehl</span>
        <dl class="fr-fkv">
          <dt>{{final.fund_what}}</dt><dd>SAML-Anmeldung bricht mit „invalid assertion“ ab.</dd>
          <dt>{{final.fund_where}}</dt><dd>Staging, SAML-Anbieter</dd>
          <dt>{{final.fund_why}}</dt><dd>📌 Issue — riskant, berührt einen fremden Anbieter.</dd>
        </dl>
      </li>
      <li data-oq-id="oq-typo"
          data-issue-title="[CHORE] Fix the outdated login hint text"
          data-issue-type="chore"
          data-oq-origin="found"
          data-route-default="now"
          data-route-reason="kosmetisch">
        <span class="oq-label">Veralteter Hinweistext am Login</span>
        <dl class="fr-fkv">
          <dt>{{final.fund_what}}</dt><dd>Der Hinweis nennt noch das alte Passwort-Feld.</dd>
          <dt>{{final.fund_where}}</dt><dd>Login-Seite</dd>
          <dt>{{final.fund_why}}</dt><dd>⚡ Jetzt — klein, im Repo.</dd>
        </dl>
      </li>
    </ul>
  </details>

  <!-- 🧪 what Claude could not verify, 👉 what the user does by hand after
       the merge. Data for the FAB only (hidden): at most three each, one short
       line, data-crit = low | mid | high, data-guide = web | desktop | "" (not
       guidable). Omit a list that would be empty. -->
  <section data-tests hidden aria-label="{{final.group_tests}}">
    <ul>
      <li data-todo-id="t-mobile" data-crit="mid" data-guide="web">Login auf dem Handy ansehen</li>
    </ul>
  </section>
  <section data-handoffs hidden aria-label="{{final.group_handoffs}}">
    <ul>
      <li data-todo-id="h-secret" data-crit="high" data-guide="desktop">Neues Token-Secret im Hosting hinterlegen</li>
    </ul>
  </section>

  <details class="fr-fold">
    <summary>🛠 {{final.dev_fold}}</summary>
    <ul class="fr-dev">
      <li>Commit <code>a1b2c3d</code> · Bereiche: auth, api</li>
      <li><code>src/auth/middleware.ts</code>, <code>src/auth/refresh.ts</code>, <code>src/api/client.ts</code></li>
      <li>Tests: 412 grün, 1 übersprungen (SAML, s. Funde)</li>
      <li>CI: <a href="https://github.com/{owner}/{repo}/actions/runs/123">Lauf #123</a></li>
    </ul>
  </details>
</section>
```

### Fund attributes

| Attribute | Required? | Purpose |
|---|---|---|
| `data-oq-id` | yes | Stable identifier, returned as the payload item's `id` (a legacy `name`/`id` still works) |
| `data-issue-title` | yes | Verbatim `gh issue create` title (`[TYPE] Imperative title`). Marks the element as a Fund for `openQuestionBoxes()` |
| `data-issue-type` | yes | Issue label (`bug`, `feature`, `refactor`, `chore`, `docs`, `design`); defaults to `chore` |
| `data-oq-origin` | yes | `deferred` (the user parked it during this concept) or `found` (surfaced on the way, unrelated to the scope). Nothing else is admissible (`SKILL.md` § Open points admission gate; validation gate 33b) |
| `data-route-default` | yes | Claude's pre-selection: `now` (⚡) / `issue` (📌) / `ignore` (✕) — the rules are in step5-update-page.md § Funde defaults. Missing → 📌 Issue |
| `data-route-reason` | yes | ONE word for the reason chip: `klein`, `kosmetisch`, `riskant`, `braucht Concept`, `außerhalb Repo`, … |
| `data-issue-body` | recommended | The issue body and the bottom sheet's description — the context someone needs to act on it cold |
| `data-issue-role` / `-module` / `-milestone` | optional | Project label hints, honoured only when they exist |
| `data-routed` | set by Claude | Added with the issue link / "umgesetzt" note once the Fund is routed; drops it from the 🧭 group |

**🧪 / 👉 item attributes:** `data-todo-id` (stable id), `data-crit`
(`low` / `mid` / `high`), `data-guide` (`web` / `desktop` / empty),
optional `data-mode-default` (`skip` / `guide` / `self`); Claude stamps
`data-mode` with the user's choice when it processes the finalize. Plain text
inside (or a `.todo-text` span when the `<li>` carries more markup).

### After a Fund is routed — HTML rewrite pattern

When Claude processes a `finalize` payload it rewrites every routed `<li>` so
the body says what became of it — `data-routed` plus an issue link (📌) or an
"umgesetzt" note (⚡); a dropped Fund gets `data-routed` and no note:

```html
<li data-oq-id="oq-saml" data-issue-title="[BUG] Auth fails for SAML users" data-issue-type="bug"
    data-oq-origin="found" data-route-default="issue" data-route-reason="riskant" data-routed>
  <span class="oq-label">SAML-Login schlägt fehl</span>
  <a class="oq-issue-link" href="https://github.com/{owner}/{repo}/issues/123"
     target="_blank" rel="noopener noreferrer">{{final.issue_link_prefix}} #123</a>
</li>
<li data-oq-id="oq-typo" data-issue-title="[CHORE] Fix the outdated login hint text" data-issue-type="chore"
    data-oq-origin="found" data-route-default="now" data-route-reason="kosmetisch" data-routed>
  <span class="oq-label">Veralteter Hinweistext am Login</span>
  <span class="oq-done">✓ {{final.done_prefix}} — <code>src/auth/LoginHint.tsx</code></span>
</li>
```

Once every Fund carries `data-routed`, the 🧭 group drops out by itself.
Rendering runs client-side only — Claude never adds or removes a group via the
bridge; it controls them through the body markup.

### Disposition Control

The disposition fieldset (`#panel-dispose-concept`) sits behind the 🧹 line's
"ändern" — always present, its default stated on the line. Its three radios +
optional `moveTo` text input drive Step 6 cleanup behaviour.

| `mode` | Step 6 cleanup behaviour |
|---|---|
| `discard` *(default)* | Delete the concept HTML, the matching `-decisions.json` AND its source folder `{date}-{slug}/` from `docs/concepts/`. |
| `keep` | Leave the files in place (or under `moveTo` if set). They remain git-tracked. |
| `gitignore` | Leave the files in place (or under `moveTo` if set) AND append `docs/concepts/{date}-{slug}.*` plus `docs/concepts/{date}-{slug}/` (or the moved paths) to the repo's `.gitignore` if not already covered. |

**Optional `moveTo` (string):** a target directory (e.g.
`docs/architecture/decisions/`). When set, Claude `mv`s the HTML file AND the
decisions JSON there FIRST, then applies the `mode`. Empty input is null.

```json
{ "mode": "discard" | "keep" | "gitignore", "moveTo": "docs/architecture/" | null }
```

**Backward compatibility:** a submission without a `disposition` field
defaults to `{ mode: "discard", moveTo: null }`; one without `tests` /
`handoffs` means there were none.

### One submission, four consequences

`finalize` is a single submission that can carry up to four real actions.
Claude executes them in a fixed order — **issues → implement → ship → Step 6
cleanup** — and then hands over the 🧪/👉 items by their mode (step5-finalize.md):

- Issues first, because they are cheap, local to GitHub, independent of
  everything else, and their creation must not depend on a release
  succeeding. A run that dies later still leaves the follow-ups tracked.
- Implement second (the Funde routed to ⚡), because a release must contain
  that work rather than predate it.
- Ship third, because it is the one part that can hard-fail on a gate. When it
  does, Claude stops there: created issues and implemented follow-ups stand,
  **cleanup does not run**, and the concept session stays open so the user can
  retry.
- Cleanup last, because `discard` deletes the concept HTML — doing that before
  the outward-facing steps would destroy the record while it is still needed.

**Replay protection is on the bridge, not just the page.** The `_version`
mismatch guard only exists on `POST /reset` and `POST /status` — `POST
/decisions` has none, it just creates a new version and flips `/pending`. So a
finalize whose response was lost in transit after the bridge had already
fsynced it sits in BOTH places, and the offline queue would happily deliver it
again: duplicate `gh issue create`, a second real release, `discard` applied
twice. That is why every payload — finalize, iterate, implement — carries a
`submission_id`. `retryPendingSubmission()` compares it against what
`/decisions` already holds before re-POSTing (see § Offline Submit Queue), and
`concept-server.py`'s `POST /decisions` remembers every `submission_id` it has
journalled (a bounded ring, derived from `journal.jsonl` on restart too) and
answers a repeat with `{"ok": true, "durable": true, "duplicate": true}`
WITHOUT touching `_decisions`, `_version` or the pending marker. Do not drop
the `submission_id` field, do not "simplify" the retry, and do not treat the
client-side check as sufficient on its own.

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
