# Concept HTML Templates

Three **templates** (layout modes) cover every concept use case. A template is
picked **per iteration**, not per page — see § Per-Iteration Templates below:

| Template | Layout | When to use |
|---|---|---|
| **decision** | Sidebar (~80/~20), multi-variant cards | Multi-option evaluation, trade-offs, architecture or tech decisions — the canonical "pick one" flow with bi-state (Verwerfen / Miteinbeziehen) per variant and multiple iterations |
| **design** | Fullscreen content + overlay decision panel (☰ FAB right) + speech-bubble feedback dock anchored to the 💬 FAB (bottom-left), stops before the ☰ FAB so both stay clickable | UI mockups, wireframes, visual design concepts, click-through flows — one artefact that needs maximum screen real estate, plus structured per-screen feedback |
| **free** | Sidebar (~80/~20), freeform body content | Analysis, walkthrough, brainstorm, explainer, timeline — structured content without forced variant framing. Bi-state evaluation is optional (opt-in per section) |

`prototype` is the **legacy alias** of `design`. Pages generated before the
rename keep working — `applyIterationTemplate()` normalises it. Never emit
`prototype` in new pages.

**Content variants (analysis, plan, concept, comparison, dashboard, creative)
are sub-structures of the decision template** — they describe how to lay out
the cards inside a decision page, not separate page templates.

All three templates share the same monitoring backbone (heartbeat, submit
handler, state persistence, iteration tabs, section TOC, reload polling,
theme toggle) — see the "Shared Systems" section at the bottom of this file.

**These are recommendations, not mandatory structures.** Claude should adapt
layout, elements, and design to fit the specific content. Use these as
starting points and inspiration — deviate freely when the content calls for it.

## UI Locale

**Every user-facing string on the rendered concept page comes from the
locale table below.** Claude picks the locale from the `[ui-locale: xx]`
hint injected by the `prompt.knowledge.dispatch` hook at session start,
which in turn derives the user's language from their profile/chat language.

**How to use:**
1. Read the locale code from `[ui-locale: xx]` (e.g. `de`, `en`, `fr`, `hi`, `ja`).
2. Set `<html lang="{locale}">` on the generated page.
3. Swap every UI string from the matching column of the table below. Never
   hard-code German/English text — always reference the table.
4. **If the locale is not in the table yet:** Claude MUST add the missing
   column inline (translating all keys at generation time) and also persist
   that column back into this file so future generations have it. Fallback
   for truly unreachable translations: use the `en` column and document it
   in a comment.

Do NOT assume "English-only" — users in India, Japan, France, Brazil etc.
must see their own language. The locale hint is authoritative.

| Key | en | de |
|---|---|---|
| `panel.heading`                | Decisions                      | Entscheidungen |
| `panel.submit`                 | Submit decisions               | Entscheidungen abschicken |
| `panel.submit_hint`            | Your selection goes straight to Claude. | Deine Auswahl wird direkt an Claude übermittelt. |
| `panel.submit_iterate`         | Next iteration                 | Zur nächsten Iteration |
| `panel.submit_iterate_hint`    | Your selection goes to Claude for the next iteration. No code changes. | Deine Auswahl geht an Claude für die nächste Iteration. Es wird kein Code geschrieben. |
| `panel.submit_implement`       | Implement with feedback       | Mit Feedback implementieren |
| `panel.submit_implement_hint`  | Claude applies the selection as real changes now. | Claude setzt die Auswahl jetzt in echte Änderungen um. |
| `panel.submit_implement_confirm` | Implement with feedback now? Claude will write code changes. | Mit Feedback jetzt implementieren? Claude schreibt jetzt Code-Änderungen. |
| `panel.submitted`              | Decisions submitted            | Entscheidungen übermittelt |
| `panel.submitted_hint`         | Claude is processing your selection. Switch to the **Claude chat** to follow progress. | Claude verarbeitet deine Auswahl. Wechsle zum **Claude Chat** um den Fortschritt zu sehen. |
| `panel.step_submitted`         | Submitted                      | Übermittelt |
| `panel.step_received`          | Claude is processing           | Claude verarbeitet |
| `panel.step_implemented`       | Implementation complete        | Implementierung abgeschlossen |
| `panel.step_implemented_active`| Implementation in progress     | Implementierung läuft |
| `panel.step_waiting`           | Waiting…                       | Warten… |
| `panel.step_ready`             | Ready to ship                  | Bereit zum Shippen |
| `panel.connecting_title`       | Claude is connecting           | Claude verbindet sich |
| `panel.connected_title`        | Claude connected               | Claude verbunden |
| `panel.disconnected_title`     | Claude not connected           | Claude nicht verbunden |
| `panel.btn_cache_hint`         | cached — sent on reconnect     | gecached — wird beim Verbinden gesendet |
| `panel.empty_iterate_confirm`  | Nothing was changed. Submit "Next iteration" anyway? | Du hast nichts geändert. Trotzdem "Zur nächsten Iteration" absenden? |
| `panel.empty_implement_confirm`| Nothing was changed. Implement with feedback anyway? Claude will still write code. | Du hast nichts geändert. Trotzdem mit Feedback implementieren? Claude schreibt dann Code. |
| `panel.toggle_open`            | Open decisions                 | Entscheidungen öffnen |
| `panel.close`                  | Close                          | Schliessen |
| `panel.minimize`               | Minimize                       | Minimieren |
| `panel.dim_dismiss`            | Dismiss overlay                | Schimmer entfernen |
| `variant.include`              | Include                        | Miteinbeziehen |
| `variant.discard`              | Discard                        | Verwerfen |
| `decision.comment_label`       | Note / override (optional)     | Notiz / Override (optional) |
| `decision.comment_placeholder` | e.g. "only for X", "with variant Y"… | z.B. „nur für X", „mit Variante Y"… |
| `iteration.label`              | Iterations                     | Iterationen |
| `iteration.active_suffix`      | · active                       | · aktiv |
| `iteration.final_tab`          | Final report                   | Abschlussbericht |
| `nav.sections`                 | Sections                       | Abschnitte |
| `final.status`                 | Implementation complete        | Implementierung abgeschlossen |
| `final.hint`                   | The implementation is done. Review the report on the left. | Die Implementierung ist abgeschlossen. Sieh dir den Bericht links an. |
| `final.open_questions`         | Open questions & TODOs         | Offene Fragen & TODOs |
| `final.create_issues_btn`      | Create issues                  | Issues erstellen |
| `final.create_issues_hint`     | Creates GitHub issues for the selected items via setup-issue. | Erstellt GitHub-Issues für die ausgewählten Punkte via setup-issue. |
| `final.create_issues_none`     | No items selected.             | Keine Punkte ausgewählt. |
| `final.create_issues_running`  | Creating issues …              | Issues werden erstellt … |
| `final.create_issues_done`     | Issues created                 | Issues erstellt |
| `final.issue_link_prefix`      | Issue                          | Issue |
| `final.dispose_heading`        | Keep concept files?            | Concept-Files behalten? |
| `final.dispose_hint`           | Default = discard. Decisions already landed in commits/issues — the HTML rarely needs to live in git. | Default = verwerfen. Entscheidungen sind bereits in Commits/Issues — die HTML-Datei muss selten in git bleiben. |
| `final.dispose_discard`        | Discard (default)              | Verwerfen (Standard) |
| `final.dispose_discard_hint`   | Delete HTML + decisions JSON, no git entry. | HTML + Decisions-JSON löschen, kein git-Eintrag. |
| `final.dispose_keep`           | Keep in project                | Im Projekt behalten |
| `final.dispose_keep_hint`      | Files stay in docs/concepts/ and become git-tracked artefacts. | Files bleiben in docs/concepts/ und sind git-getrackte Artefakte. |
| `final.dispose_gitignore`      | Local only / .gitignore        | Nur lokal / .gitignore |
| `final.dispose_gitignore_hint` | Files stay locally, an entry is appended to .gitignore. | Files bleiben lokal, ein Eintrag wird zur .gitignore hinzugefügt. |
| `final.dispose_move_label`     | Move to (optional):            | Verschieben nach (optional): |
| `final.dispose_move_placeholder` | e.g. docs/architecture/      | z.B. docs/architecture/ |
| `final.dispose_btn`            | End concept                    | Concept beenden |
| `final.dispose_btn_hint`       | Closes the concept session and applies the file disposition above. | Schliesst die Concept-Session und wendet die Datei-Disposition oben an. |
| `final.dispose_running`        | Cleaning up …                  | Räume auf … |
| `final.dispose_done`           | Concept ended.                 | Concept beendet. |
| `final.ship_heading`           | Ready to ship                  | Bereit zum Shippen |
| `final.ship_btn`               | Ship it                        | Shippen |
| `final.ship_hint`              | Runs the full ship pipeline (build, version bump, release, merge). | Startet die komplette Ship-Pipeline (Build, Version-Bump, Release, Merge). |
| `final.ship_running`           | Shipping …                     | Wird geshippt … |
| `final.ship_done`              | Shipped                        | Geshippt |
| `final.view_iterations`        | Review iterations              | Iterationen ansehen |
| `proto.feedback_title`         | Feedback                       | Feedback |
| `proto.feedback_toggle`        | Open feedback                  | Feedback öffnen |
| `proto.feedback_general`       | General notes on this concept  | Allgemeine Anmerkungen zum Konzept |
| `proto.feedback_general_hint`  | Persists across all screens    | Screen-übergreifend persistent |
| `proto.feedback_current`       | Current screen                 | Aktueller Screen |
| `proto.feedback_placeholder`   | Write a note on this screen…   | Notiz zu diesem Screen… |
| `proto.screen_counter`         | Screen {n} / {total}           | Screen {n} / {total} |
| `design.feedback_design`       | Notes on this design           | Anmerkungen zu diesem Design |
| `design.feedback_design_placeholder` | Write a note on this design… | Notiz zu diesem Design… |
| `design.switch_label`          | Switch design                  | Design wechseln |
| `design.position_iteration`    | Iteration                      | Iteration |
| `design.position_page`         | Page                           | Seite |

**`design.position_iteration` and `design.position_page` are label words,
not full sentences** — the numbers (`N`, `total`) are live spans the JS
updates on every switch, exactly like the pre-existing `active-screen-idx`
span, so only the word is baked in at generation time. They compose the
screen indicator (§ Screen indicator, design template) as
`{position_iteration} {i} · {design-nav-label} · {position_page} {n} /
{total} · {screen-nav-label}`, with the iteration segment dropped when the
concept has one iteration and the design segment dropped when the iteration
has one design — see the indicator JS for the exact assembly.

**Locale tag example on `<html>`:** `<html lang="de">`, `<html lang="en">`,
`<html lang="fr">`, `<html lang="hi">`, `<html lang="ja">`. Match whatever
the `[ui-locale: ...]` hint produced.

## Common Structure (all templates)

```html
<!DOCTYPE html>
<!-- data-template is a PROJECTION of the ACTIVE iteration, not a page constant.
     It MUST be written at generation time with the active iteration's
     data-iteration-template value (normalised), otherwise the page paints the
     wrong layout for one frame before showIteration() runs. -->
<html lang="en" data-theme="dark" data-page-version="{generation-timestamp}" data-template="decision">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Concept — {title}</title>
  <style>/* all CSS inline */</style>
</head>
<body>
  <div class="concept-layout">
    <!-- Main content -->
    <div class="concept-content">
      <header>
        <!-- HEADER MUST STAY LEAN.
             Keep to <h1> + ONE short subtitle line (or omit subtitle entirely).
             Do NOT repeat the iteration title/intro here — that belongs INSIDE
             the active <section data-iteration="N">. Double-intros (header +
             iteration-intro) eat vertical space and duplicate context. -->
        <h1>{title}</h1>
        <p class="subtitle">{optional one-line context — omit if not needed}</p>
        <button id="theme-toggle" aria-label="Toggle theme">🌙/☀️</button>
      </header>

      <main>
        <!-- One <section data-iteration="N"> per iteration. Exactly one has
             data-active. All others render their controls disabled/readonly
             and preserve the values the user submitted that round.
             Each iteration section may open with its own iteration-intro
             block (title + one paragraph) BEFORE the variant/content cards. -->
        <!--
        <section data-iteration="1" hidden>...frozen first round...</section>
        <section data-iteration="2" data-active>...current round (active)...</section>
        -->
      </main>
    </div>

    <!-- Decision panel. Layout varies per template:
         decision: sticky sidebar, always visible.
         design: overlay, FAB-toggled.
         free: sticky sidebar (same as decision). -->
    <aside class="concept-decision-panel">
      <!-- All visible strings are referenced by key in the locale table above.
           Swap to the `de` column when [ui-locale: de] is active. -->

      <!-- Iteration tabs — live at the TOP of the decision panel (not in the
           content area). Compact vertical chip list; the active tab shows
           the current round, older tabs stay clickable but show frozen
           snapshots when selected. Auto-populated, one entry per
           <section data-iteration="N">. -->
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}">
        <!--
        <button class="iteration-tab" role="tab" data-iteration="1" aria-selected="false">Iteration 1</button>
        <button class="iteration-tab" role="tab" data-iteration="2" aria-selected="true">Iteration 2 · active</button>
        -->
      </nav>

      <h3>{{panel.heading}}</h3>

      <!-- Section TOC — auto-populated from EVERY <section id="..."
           data-nav-label="..."> inside the active iteration, not just variants.
           Sections that carry a bi-state radio group (eval-{id}) display their
           current state label; plain sections (Ist-Zustand, Context, Design-Notes,
           etc.) just show the label and anchor-scroll on click. -->
      <nav class="section-nav" id="section-nav" aria-label="{{nav.sections}}">
        <!-- auto-populated -->
      </nav>

      <!-- Normal state: decision summary + two submit buttons.
           The disconnected warning lives INSIDE #panel-ready and covers
           the submit area as an overlay when Claude is offline. -->
      <div id="panel-ready">
        <!-- Connection status pill — inline, animated, non-blocking. Reflects
             the live bridge heartbeat via [data-state]; checkClaudeConnection
             sets the state + label. Three states:
               connecting   — pre-first-poll window (no heartbeat response yet)
                              OR bootstrap (claude_ts==0 while server_ts fresh).
                              Pulsing accent dot + animated ellipsis.
               connected    — claude_ts fresh. Steady green dot.
               disconnected — claude_ts stale (dead cron) OR server_ts stale /
                              fetch failing (bridge down). Pulsing amber dot.
             It NEVER overlays or disables the submit buttons and has NO
             acknowledge button. A disconnected submit is cached and
             auto-delivered on reconnect (see Offline Submit Queue), so the
             pill + per-button cache hint are the only signals needed. Starting
             in "connecting" (never "disconnected") is the fix for the
             fresh-page connect→disconnect→connect flash. -->
        <div id="connection-status" class="connection-pill" data-state="connecting" role="status" aria-live="polite">
          <span class="conn-dot" aria-hidden="true"></span>
          <span class="conn-label">{{panel.connecting_title}}</span>
        </div>

        <div id="decision-summary">
          <!-- Auto-populated summary of current selections -->
        </div>

        <button id="submit-iterate-btn" class="primary submit-btn">{{panel.submit_iterate}}</button>
        <p class="hint">{{panel.submit_iterate_hint}}</p>
        <p class="hint hint-cache" data-cache-hint="iterate" hidden>
          <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
        </p>
        <div class="submit-gap" aria-hidden="true"></div>
        <button id="submit-implement-btn" class="implement-btn">
          <span class="warn-icon" aria-hidden="true">⚠</span>
          {{panel.submit_implement}}
        </button>
        <p class="hint hint-warn">{{panel.submit_implement_hint}}</p>
        <p class="hint hint-cache" data-cache-hint="implement" hidden>
          <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
        </p>
      </div>

      <!-- Post-submit state: waiting for Claude. The progress list shows
           three steps so the user can see whether the submission has only
           been sent (step 1), whether Claude's cron has picked it up
           (step 2), and — for implement-action submissions — whether the
           actual code change finished (step 3). The third <li> stays
           hidden for iterate-action submissions; submitWithAction sets
           the `hidden` attribute based on the action. -->
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <ol class="status-steps" id="status-steps" aria-live="polite">
          <li data-step="submitted" data-state="done">
            <span class="step-icon" aria-hidden="true">✓</span>
            <span class="step-label">{{panel.step_submitted}}</span>
          </li>
          <li data-step="received" data-state="active">
            <span class="step-icon" aria-hidden="true">⏳</span>
            <span class="step-label">{{panel.step_received}}</span>
          </li>
          <li data-step="implemented" data-state="pending" hidden>
            <span class="step-icon" aria-hidden="true">○</span>
            <span class="step-label" data-state-label="pending">{{panel.step_waiting}}</span>
            <span class="step-label" data-state-label="active">{{panel.step_implemented_active}}</span>
            <span class="step-label" data-state-label="done">{{panel.step_implemented}}</span>
          </li>
        </ol>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
        <div class="waiting-animation"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      </div>

      <!-- Final-report state: shown when the active section carries
           data-final-report. No iterate/implement submit; controls are
           the conditional "Issues erstellen" button (gated on
           [data-open-questions] content) and the always-visible
           disposition fieldset that drives Step 6 cleanup. -->
      <div id="panel-final-report" style="display: none;">
        <!-- Persistent status channel. Renders the concept's whole pipeline
             at a glance and culminates in the ship CTA. It is DOM-driven —
             present because the active section carries data-final-report — so
             it survives page reloads AND stays fully visible even when the
             Claude heartbeat is stale (the ship affordance never depends on a
             live connection, which is the whole point of the persistent
             channel over a transient completion overlay). -->
        <div class="status-channel" id="status-channel">
          <div class="status-channel__heading">{{final.ship_heading}}</div>
          <ol class="status-steps" aria-live="polite">
            <li data-step="submitted" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_submitted}}</span>
            </li>
            <li data-step="received" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_received}}</span>
            </li>
            <li data-step="implemented" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_implemented}}</span>
            </li>
            <li data-step="ready" data-state="active">
              <span class="step-icon" aria-hidden="true">●</span>
              <span class="step-label">{{panel.step_ready}}</span>
            </li>
          </ol>
          <button id="ship-btn" class="primary submit-btn ship-btn">
            <span aria-hidden="true">🚀</span> {{final.ship_btn}}
          </button>
          <p class="hint">{{final.ship_hint}}</p>
          <p class="hint hint-running" data-ship-state="running" hidden>
            <span aria-hidden="true">⏳</span> {{final.ship_running}}
          </p>
          <p class="hint hint-done" data-ship-state="done" hidden>
            <span aria-hidden="true">✓</span> {{final.ship_done}}
          </p>
          <button type="button" id="view-iterations-btn" class="link-btn">{{final.view_iterations}}</button>
        </div>

        <div class="final-report-indicator">
          <span class="check-icon">✓</span>
          <strong>{{final.status}}</strong>
        </div>
        <p class="final-report-hint">{{final.hint}}</p>
        <div id="panel-create-issues" hidden>
          <button id="create-issues-btn" class="primary submit-btn" disabled>{{final.create_issues_btn}}</button>
          <p class="hint">{{final.create_issues_hint}}</p>
          <p class="hint hint-none" data-issues-state="none" hidden>
            <span aria-hidden="true">⚠</span> {{final.create_issues_none}}
          </p>
          <p class="hint hint-running" data-issues-state="running" hidden>
            <span aria-hidden="true">⏳</span> {{final.create_issues_running}}
          </p>
          <p class="hint hint-done" data-issues-state="done" hidden>
            <span aria-hidden="true">✓</span> {{final.create_issues_done}}
          </p>
        </div>

        <!-- Disposition fieldset: always visible on the final-report panel.
             Drives Step 6 cleanup behaviour (discard / keep / gitignore /
             optional moveTo). Default = discard, matching the typical
             one-shot refinement workflow where decisions already landed
             in commits/issues and the HTML is no longer needed. -->
        <fieldset id="panel-dispose-concept" class="dispose-fieldset">
          <legend>{{final.dispose_heading}}</legend>
          <p class="hint dispose-hint">{{final.dispose_hint}}</p>

          <label class="dispose-option">
            <input type="radio" name="dispose-mode" value="discard" checked>
            <span class="dispose-label">
              <strong>{{final.dispose_discard}}</strong>
              <span class="dispose-sub">{{final.dispose_discard_hint}}</span>
            </span>
          </label>

          <label class="dispose-option">
            <input type="radio" name="dispose-mode" value="keep">
            <span class="dispose-label">
              <strong>{{final.dispose_keep}}</strong>
              <span class="dispose-sub">{{final.dispose_keep_hint}}</span>
            </span>
          </label>

          <label class="dispose-option">
            <input type="radio" name="dispose-mode" value="gitignore">
            <span class="dispose-label">
              <strong>{{final.dispose_gitignore}}</strong>
              <span class="dispose-sub">{{final.dispose_gitignore_hint}}</span>
            </span>
          </label>

          <div class="dispose-move-row">
            <label for="dispose-move-to">{{final.dispose_move_label}}</label>
            <input id="dispose-move-to"
                   name="dispose-move-to"
                   type="text"
                   autocomplete="off"
                   spellcheck="false"
                   placeholder="{{final.dispose_move_placeholder}}">
          </div>

          <div class="submit-gap" aria-hidden="true"></div>

          <button id="dispose-concept-btn" class="implement-btn dispose-btn">
            <span aria-hidden="true">⤓</span>
            {{final.dispose_btn}}
          </button>
          <p class="hint hint-warn">{{final.dispose_btn_hint}}</p>

          <p class="hint hint-running" data-dispose-state="running" hidden>
            <span aria-hidden="true">⏳</span> {{final.dispose_running}}
          </p>
          <p class="hint hint-done" data-dispose-state="done" hidden>
            <span aria-hidden="true">✓</span> {{final.dispose_done}}
          </p>
        </fieldset>
      </div>
    </aside>
  </div>

  <!-- Submitted-state content dimmer (all templates).
       After a submit, body.content-dimmed flips this on. The dimmer covers
       the content area and directs focus to the decision panel / FAB. The
       panel + FABs are above z-index 50 so they paint over the dimmer and
       stay visually clear and clickable. The dimmer itself is click-to-
       dismiss; otherwise it auto-clears on the next page reload (new
       iteration / final report) because `content-dimmed` is not persisted. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       title="{{panel.dim_dismiss}}" hidden></div>

  <script type="application/json" id="concept-decisions">
    {"submitted": false, "decisions": [], "comments": []}
  </script>
  <script>/* all JS inline */</script>
</body>
</html>
```

## Per-Iteration Templates

The template is chosen **per iteration**. Every `<section data-iteration="N">`
MUST carry `data-iteration-template="decision|design|free"` — that attribute is
authoritative:

```html
<html data-template="decision">              <!-- mirrors the ACTIVE iteration -->
  <section data-iteration="1" data-iteration-template="decision" data-active>
  <section data-iteration="2" data-iteration-template="design" hidden>
  <section data-iteration="3" data-iteration-template="decision" hidden>
```

`data-template` on `<html>` stays the single source of truth *for CSS selectors
and JS branches* (`[data-template="design"] …`, `collectDecisions`), but it is a
**projection** of the currently shown iteration, not a page-level constant.
`applyIterationTemplate(section)` writes it on every iteration switch (see
Shared Systems § Tab Switch JS).

Rules:

- Iterations may mix templates freely and in any order — a `decision` round may
  be followed by a `design` round and another `decision` round.
- `prototype` is accepted as a **legacy alias** for `design` and normalised on
  read. Never write it in new pages.
- A missing `data-iteration-template` falls back to the current
  `<html data-template>`, so pages generated before the rename keep working
  unchanged.
- The `<html data-template>` value written at generation time MUST already
  equal the active iteration's (normalised) template — otherwise the first
  paint shows the wrong layout.

---

# Template: decision

Multi-variant evaluation with sidebar layout. This is the canonical flow:
Claude presents 2+ options, user picks bi-state per variant, submits,
Claude iterates.

## Layout — Sidebar

Content left (~80%), decision panel right (~20%), always visible. Best for
structured evaluation where the user wants to see the panel at all times.

```css
.concept-layout {
  display: flex;
  min-height: 100vh;
}
.concept-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}
.concept-decision-panel {
  width: 20%;
  min-width: 240px;
  max-width: 360px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 1.5rem;
  border-left: 1px solid var(--border-color);
  background: var(--panel-bg);
  /* Above .content-dimmer (z-index 50) so the panel's solid background
     visually punches through the dimmer instead of being tinted by it. */
  z-index: 100;
}
/* Mobile: collapse to sticky bottom */
@media (max-width: 768px) {
  .concept-layout { flex-direction: column; }
  .concept-decision-panel {
    width: 100%;
    max-width: none;
    height: auto;
    position: sticky;
    bottom: 0;
    border-left: none;
    border-top: 1px solid var(--border-color);
  }
}
```

## Bi-State Variant Evaluation

Every variant in a decision page MUST include a **bi-state** selector with
exactly two options.

| State | Label | Behavior |
|-------|-------|----------|
| **Miteinbeziehen** | "Miteinbeziehen" (default) | Claude considers this variant in the next iteration or implementation |
| **Verwerfen** | "Verwerfen" | Claude discards this variant and excludes it from all further steps |

- Default state for all variants: **Miteinbeziehen**
- No "Nur diese" / "only" option — the user implicitly picks a single
  variant by setting all others to "Verwerfen"
- No "Claude setzt um" / "Feedback" hint labels — the action-vs-feedback
  distinction is now expressed by the two submit buttons (iterate vs.
  implement), NOT by the evaluation selector
- Each variant can ADDITIONALLY have rating, comments, and other controls

### HTML

Every `[data-decision]` group MUST be followed by an adjacent
`<textarea data-comment="$decisionId-note">` so the user can attach a
free-form override (e.g. "only for X", "with variant Y") to the bi-state
choice. Place the textarea inside the same row container so the comment is
visually anchored to the card. The catch-all `collectAllFormFields` picks
it up via `data-comment` without any collector change.

```html
<div class="variant-evaluation" data-decision="variant-a" data-label="Variant A">
  <div class="eval-group">
    <label class="eval-option">
      <input type="radio" name="eval-variant-a" value="discard">
      <span class="eval-label">Verwerfen</span>
    </label>
    <label class="eval-option">
      <input type="radio" name="eval-variant-a" value="include" checked>
      <span class="eval-label">Miteinbeziehen</span>
    </label>
  </div>
  <div class="field-row decision-comment-row">
    <label for="variant-a-note">{{decision.comment_label}}</label>
    <textarea id="variant-a-note"
              data-comment="variant-a-note"
              placeholder="{{decision.comment_placeholder}}"
              rows="2"></textarea>
  </div>
</div>
```

Legacy class names `tri-state-group` / `tri-state-option` / `tri-state-label`
are deprecated but still accepted by the CSS selectors below for backward
compatibility.

**Backwards compatibility:** older pages that emitted the bi-state group
without the textarea are upgraded at runtime by `ensureCommentSlots()` (see
§ Shared Systems → Comment Slot Injection). Generated pages SHOULD still
emit the textarea inline so the validation gate and `localStorage` restore
see it immediately, but the JS safety net guarantees the user always has
the override slot.

### CSS

```css
/* Bi-state — legacy tri-state-* class names still supported */
.eval-group, .tri-state-group {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
.eval-option, .tri-state-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  text-align: center;
  position: relative;
  border-right: 1px solid var(--border-color, #30363d);
  transition: background 0.2s, box-shadow 0.2s;
}
.eval-option:last-child, .tri-state-option:last-child { border-right: none; }

.eval-option:hover, .tri-state-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}

.eval-option input, .tri-state-option input { display: none; }

.eval-option:has(input:checked) .eval-label,
.tri-state-option:has(input:checked) .tri-state-label {
  font-weight: 700;
}

.eval-label, .tri-state-label { font-size: 0.9rem; transition: font-weight 0.15s; }

/* Checkmark badge on the selected option */
.eval-option:has(input:checked)::after,
.tri-state-option:has(input:checked)::after {
  content: '✓';
  position: absolute;
  top: 4px;
  right: 6px;
  font-size: 0.7rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  pointer-events: none;
}

/* Miteinbeziehen (default, accent) */
.eval-option:has(input[value="include"]:checked),
.tri-state-option:has(input[value="include"]:checked) {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  box-shadow: inset 0 0 0 2px var(--accent-color, #58a6ff);
}
.eval-option:has(input[value="include"]:checked)::after,
.tri-state-option:has(input[value="include"]:checked)::after {
  background: var(--accent-color, #58a6ff);
  color: white;
}

/* Verwerfen (danger) */
.eval-option:has(input[value="discard"]:checked),
.tri-state-option:has(input[value="discard"]:checked) {
  background: color-mix(in srgb, var(--danger-color, #f85149) 12%, transparent);
  box-shadow: inset 0 0 0 2px var(--danger-color, #f85149);
}
.eval-option:has(input[value="discard"]:checked)::after,
.tri-state-option:has(input[value="discard"]:checked)::after {
  background: var(--danger-color, #f85149);
  color: white;
}
.eval-option:has(input[value="discard"]:checked) .eval-label,
.tri-state-option:has(input[value="discard"]:checked) .tri-state-label {
  color: var(--danger-color, #f85149);
}

/* Unselected state */
.eval-option:has(input:not(:checked)),
.tri-state-option:has(input:not(:checked)) {
  opacity: 0.7;
}
.eval-option:has(input:not(:checked)):hover,
.tri-state-option:has(input:not(:checked)):hover {
  opacity: 1;
}

/* Per-decision comment row — slotted directly under the bi-state group so
   the override is visually anchored to the variant card. Width tracks the
   group width via the container; min-height keeps it usable on dense pages. */
.decision-comment-row {
  margin-top: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.decision-comment-row label {
  font-size: 0.78rem;
  color: var(--text-muted, #8b949e);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.decision-comment-row textarea {
  width: 100%;
  min-height: 48px;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: color-mix(in srgb, var(--bg-color, #0d1117) 80%, transparent);
  color: var(--text-color, #c9d1d9);
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.4;
  resize: vertical;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.decision-comment-row textarea:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color, #58a6ff) 30%, transparent);
}
.decision-comment-row textarea::placeholder {
  color: var(--text-muted, #8b949e);
  opacity: 0.6;
}
```

**Behavior:**
- Default: "Miteinbeziehen" (all variants considered)
- "Verwerfen": grays out the variant card visually (still accessible)
- To pick a single variant, set all others to "Verwerfen" manually

### Decision schema

```json
{
  "template": "decision",
  "action": "iterate",
  "decisions": [
    { "id": "variant-a", "label": "...", "evaluation": "include", "rating": 4 },
    { "id": "variant-b", "label": "...", "evaluation": "discard", "rating": 2 },
    { "id": "variant-c", "label": "...", "evaluation": "include", "rating": 5 }
  ],
  "comments": [
    { "id": "variant-a", "text": "..." }
  ]
}
```

`evaluation` values: `"discard"` | `"include"`
`action` values: `"iterate"` | `"implement"` — determined by which submit
button the user clicked. See § Two-Button Submit below.

## Content Variants (within the decision template)

The decision template has six content sub-variants. They describe the shape
of the variant cards — not a different page layout.

### Variant: analysis

**Purpose:** Present findings from a data analysis with accept/reject controls.

```
[Header: Analysis title + date]
[Summary card: key metrics / TL;DR]

[Finding 1]
  ├── Description + evidence
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  ├── [Priority: Hoch / Mittel / Niedrig]
  └── [Comment field: "Anmerkung..."]

[Finding 2]
  └── ...

[Submit button]
```

### Variant: plan

**Purpose:** Present an implementation plan with step approval controls.

```
[Header: Plan title]
[Overview card: goal, scope, timeline]

[Phase 1: Name]
  [Step 1.1]
    ├── Description + rationale
    ├── [Checkbox: Einschliessen]
    ├── [Effort indicator: S / M / L / XL]
    └── [Comment field]

  [Step 1.2]
    └── ...

[Submit button]
```

### Variant: concept

**Purpose:** Present architecture or design variants for evaluation.

```
[Header: Concept title]
[Context card: problem statement]

[Variant A: Name]
  ├── Description + diagram/illustration
  ├── Pro/Con list
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  ├── [Rating: 1-5 stars or slider]
  └── [Comment field (wide, min-height: 80px)]

[Variant B: Name]
  └── ...

[Decision panel sidebar: summary + submit]
```

### Variant: comparison

**Purpose:** Side-by-side comparison of options with winner selection.

```
[Header: Comparison title]

[Criteria table / matrix]
  ├── Row per criterion
  ├── Column per option
  ├── [Weight slider per criterion]
  └── Auto-calculated weighted scores

[Per-option detail cards]
  ├── Strengths
  ├── Weaknesses
  ├── [Tri-state: Verwerfen / Miteinbeziehen (default) / Nur diese]
  └── [Comment field (wide)]

[Decision panel sidebar: summary + submit]
```

Each option in the comparison gets the same **bi-state evaluation** as
concept variants. Decision schema matches the decision template schema, with
additional `weight-*` entries for weight sliders.

### Variant: dashboard

**Purpose:** Status overview or metric dashboard with filters.

```
[Header + date range]
[KPI cards row: 3-5 key metrics]

[Filter bar: toggles for categories/segments]

[Expandable sections]
  ├── Section title + summary stat
  ├── Expanded: detail table or chart
  └── [Comment field per section]

[Action items section]
  ├── [Checkbox per item]
  └── [Comment field]

[Submit button]
```

### Variant: creative

**Purpose:** Brainstorming, ideation, collecting ideas.

```
[Header: Topic]
[Context / constraints]

[Idea cards grid]
  ├── Idea title + description
  ├── [Vote: thumbs up/down]
  ├── [Tag selector: category]
  └── [Comment field]

[Add new idea button → inline form]
[Submit button]
```

---

# Template: design

*(legacy alias: `prototype` — normalised to `design` on read)*

**One visual artefact, one screen at a time, 100 % viewport.** The body shows
exactly one screen from the flow. The user switches between screens via the
screen-nav inside the ☰ decision panel, keyboard arrows, OR by clicking
buttons inside the mockup itself (click-dummy behaviour). The viewport
has no header bar, no sidebars — just the current screen and two floating
buttons:

## Rules

- **Click-dummy by default (2+ screens):** buttons/links inside the mockup
  MUST navigate between screens when clicked. A real "Continue" button on
  screen 1 takes the user to screen 2; "Back" goes to screen 1; etc. The
  user can thereby click through the whole flow as if it were a real app.
- **"Screen" = logical state, not necessarily full page.** A screen is any
  user-distinguishable state the reviewer should be able to annotate
  separately:
  - Full-page transitions (welcome / credentials / success)
  - Modal / drawer / dialog toggles (main view without modal vs. with
    modal open)
  - Tab or accordion selections (tab A content vs. tab B content)
  - Empty / loading / populated / error states of the same component
  - Before / after user action (form empty vs. form submitted)

  Each such state becomes its own `<section data-screen>`. The click-dummy
  wiring with `data-screen-link` handles the transition like any other
  screen switch.
- **Single-screen design (exactly one `<section data-screen>`):**
  - No screen-nav rendered inside the ☰ panel
  - Feedback dock shows ONLY the general-notes textarea (no
    per-screen section, no "Aktueller Screen" label)
  - No click-dummy wiring required — nothing to navigate to
  - The screen-indicator overlay can be hidden or simplified
  - `updateScreenScope()` detects `screens.length === 1` and sets
    `document.body.dataset.singleScreen = 'true'` so CSS can hide the
    per-screen UI. CSS adds: `body[data-single-screen="true"] #screen-nav,
    body[data-single-screen="true"] .feedback-section:has(#screen-textareas)
    { display: none }`.
- **Single-design iteration (exactly one `<section data-design>`):**
  degenerates to today's behaviour — no design switcher, no per-design
  feedback row, `#screen-nav` renders as a flat list (no design heading).
  `buildDesignUI()` detects `designs.length === 1` and sets
  `document.body.dataset.singleDesign = 'true'`, the sibling of
  `data-single-screen` above, so CSS hides the same way. The `data-design`
  wrapper is still required in the markup even when there's only one — see
  § Screen-pattern markup.
- **Do NOT invent artificial screens** to make the template fit. If the
  artefact has no meaningful secondary state, leave it as a single screen
  and let the dock collapse to general notes only.
- **Design system alignment:** the mockup MUST use the project's existing
  design tokens (colors, typography, spacing, component shapes) unless the
  user explicitly requests a different look. Read `design-tokens.*`,
  Tailwind config, Figma variables via the design MCP, or the existing UI
  layer before inventing a style. The example in this file uses the generic
  GitHub-style palette only because dotclaude has no project-specific
  tokens — consumer projects will differ.

## Click-through wiring (`data-screen-link`)

Buttons inside a mockup get `data-screen-link` to declare their navigation:

```html
<div class="device-frame">
  <h4>Welcome</h4>
  <button class="mock-btn" data-screen-link="screen-credentials">Los geht's</button>
  <button class="mock-btn secondary" data-screen-link="screen-login">Anmelden</button>
</div>
```

Values:
- `data-screen-link="screen-id"` — jump to the screen with that id
- `data-screen-link="next"` — advance to the next screen in DOM order
- `data-screen-link="prev"` — go to the previous screen
- Omit the attribute entirely for decorative / terminal buttons

The wiring is a single delegated click handler installed alongside
`showScreen` — see § Click-through Handler below.

- `☰` (bottom-right) → Decision panel: iteration tabs, screen navigation, submit
- `💬` (bottom-left) → Feedback dock: **context-sensitive** textarea for the
  currently-visible screen + a persistent "general notes" textarea below

### Feedback behaviour (strict)

- The 💬 dock always shows **one textarea for the currently-active screen**
  (label: "Aktueller Screen: {screen-label}"). Its content is private to that
  screen.
- Below a divider, a **second textarea for general notes** stays visible
  regardless of the active screen — the user can append from any screen.
- When the user switches screens (via ☰ or keyboard), the screen textarea
  swaps to the new screen's notes. Previous screen's notes are preserved and
  come back when the user returns.
- `localStorage` persists all screen notes independently + the general notes
  + the active-screen id, so refresh / tab-close / browser-restart don't
  lose state.
- After Submit, a new iteration is appended (like decision). The user can
  switch back to iteration N via the iteration-tabs and re-read their frozen
  notes per screen.

## Layout — Fullscreen single-screen + Overlay Panel + Feedback Dock

```html
<!-- data-template mirrors the ACTIVE iteration; applyIterationTemplate()
     rewrites it on every tab switch. body overflow is set by that function,
     the inline style below is only the first-paint value. -->
<html data-template="design">
<body style="overflow: hidden">
  <div class="concept-layout design fullscreen">
    <div class="concept-content">
      <main>
        <section data-iteration="1" data-iteration-template="design" data-active>
          <!-- One or more designs. Exactly one <section data-design> carries
               data-design-active="true" (others get `hidden`). A single
               design still needs this wrapper for markup uniformity — it
               just degenerates to today's behaviour (see body[data-single-design]
               below). -->
          <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true">
            <!-- All pages of THIS design live here. Exactly one carries
                 data-screen-active="true" (others get `hidden`). Every screen
                 is position: absolute; inset: 0 so it fills the viewport. A
                 <div class="device-frame"> inside holds the actual mock content. -->
            <section id="d1-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s2" data-screen data-nav-label="Credentials" hidden>
              <div class="device-frame">…mock…</div>
            </section>
            <section id="d1-s3" data-screen data-nav-label="Success" hidden>
              <div class="device-frame">…mock…</div>
            </section>
          </section>
          <section data-design="holotable" data-nav-label="Holotable" hidden>
            <section id="d2-s1" data-screen data-nav-label="Welcome" data-screen-active="true">
              <div class="device-frame">…mock…</div>
            </section>
          </section>
        </section>
      </main>
    </div>

    <!-- Minimal position indicator (top-left overlay) — NOT a header bar.
         Built entirely in JS from {{design.position_iteration}} and
         {{design.position_page}} (§ UI Locale) — the iteration segment only
         renders when the concept has >1 iteration, the design segment only
         when the iteration has >1 design. See buildDesignUI() below; the
         spans here are just the mount points it fills in. -->
    <div class="screen-indicator" id="screen-indicator">
      <!-- updateIndicator() (§ Layout JS) fills these mount points on every
           iteration/design/screen switch. Each optional segment carries its
           own trailing " · " INSIDE the span, so hiding the span removes the
           separator with it and never leaves a dangling one.
           Static values are the generation-time first-paint fallback
           (3-screen, single-iteration, single-design example) so the page
           never flashes empty before JS runs.
           EVERY id below is required — updateIndicator() null-guards each
           lookup, so a missing span does not throw; the segment simply never
           appears. That failure is silent, which is why the reference markup
           must carry all four. -->
      <span id="indicator-iteration" hidden>{{design.position_iteration}} <strong id="active-iteration-idx">1</strong> · </span>
      <span id="indicator-design" hidden><strong id="active-design-label">Dispatch</strong> · </span>
      {{design.position_page}} <strong id="active-screen-idx">1</strong> / <span id="total-screens">3</span>
      · <span id="active-screen-label">Welcome</span>
    </div>

    <!-- Design switcher (ghost bar, top centre) — one segment per
         <section data-design>, only rendered when the iteration has ≥2
         designs (hidden via body[data-single-design], see Layout CSS).
         Auto-populated by buildDesignUI(); resting state shows only the
         active label (CSS collapses the rest), hover/:focus-within expands
         to the full segmented control. -->
    <nav class="design-switcher" id="design-switcher" aria-label="{{design.switch_label}}">
      <!-- auto-populated: one <button class="design-switch-item"> per design -->
    </nav>

    <!-- Two FABs — the only floating UI besides the screen itself.
         The 💬 FAB carries two labels: the dock toggle swaps aria-label
         between them based on aria-expanded so screen-reader users
         always hear the correct next action ("Open" vs "Minimize"). -->
    <button id="panel-toggle" class="panel-fab" aria-label="{{panel.toggle_open}}">☰</button>
    <button id="feedback-toggle" class="feedback-fab"
            aria-label="{{proto.feedback_toggle}}"
            aria-expanded="false"
            data-label-open="{{proto.feedback_toggle}}"
            data-label-close="{{panel.minimize}}">💬</button>

    <!-- Decision panel (☰) — contains: iteration-tabs, screen-nav, submit.
         No section-TOC here: the screen-nav replaces it for design. -->
    <aside class="concept-decision-panel overlay" id="decision-panel">
      <button id="panel-close" class="panel-close-btn" aria-label="{{panel.close}}">✕</button>
      <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}"><!-- chips --></nav>
      <nav class="screen-nav" id="screen-nav" aria-label="Screens">
        <!-- auto-populated, two levels: one .screen-nav-group per
             <section data-design>, a .screen-nav-design-heading button at
             the top of each group, then one .screen-nav-item per page
             nested beneath. Single-design pages skip the heading (CSS,
             body[data-single-design]) and render as today's flat list.
             The ● marker applies at both levels: a design heading shows it
             when ANY of its pages, or its own design-level comment field,
             carries unsubmitted text. Clicking either level switches and
             closes the panel. -->
      </nav>
      <div id="panel-ready">
        <!-- Connection status pill — same inline, non-blocking contract as the
             sidebar templates (see § Decision Panel State CSS + § Claude
             Connection Heartbeat). Animated dot + label, no overlay, no
             acknowledge button; starts in "connecting" and never flashes
             "disconnected" before the first heartbeat response. -->
        <div id="connection-status" class="connection-pill" data-state="connecting" role="status" aria-live="polite">
          <span class="conn-dot" aria-hidden="true"></span>
          <span class="conn-label">{{panel.connecting_title}}</span>
        </div>

        <button id="submit-iterate-btn" class="primary submit-btn">{{panel.submit_iterate}}</button>
        <p class="hint">{{panel.submit_iterate_hint}}</p>
        <p class="hint hint-cache" data-cache-hint="iterate" hidden>
          <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
        </p>
        <div class="submit-gap" aria-hidden="true"></div>
        <button id="submit-implement-btn" class="implement-btn">
          <span class="warn-icon" aria-hidden="true">⚠</span>
          {{panel.submit_implement}}
        </button>
        <p class="hint hint-warn">{{panel.submit_implement_hint}}</p>
        <p class="hint hint-cache" data-cache-hint="implement" hidden>
          <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
        </p>
      </div>
      <div id="panel-submitted" style="display: none;">
        <!-- Same progress-list structure as the decision/free templates;
             see § Common Structure for the full markup and locale keys. -->
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <ol class="status-steps" id="status-steps" aria-live="polite">
          <li data-step="submitted" data-state="done">
            <span class="step-icon" aria-hidden="true">✓</span>
            <span class="step-label">{{panel.step_submitted}}</span>
          </li>
          <li data-step="received" data-state="active">
            <span class="step-icon" aria-hidden="true">⏳</span>
            <span class="step-label">{{panel.step_received}}</span>
          </li>
          <li data-step="implemented" data-state="pending" hidden>
            <span class="step-icon" aria-hidden="true">○</span>
            <span class="step-label" data-state-label="pending">{{panel.step_waiting}}</span>
            <span class="step-label" data-state-label="active">{{panel.step_implemented_active}}</span>
            <span class="step-label" data-state-label="done">{{panel.step_implemented}}</span>
          </li>
        </ol>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
      </div>
    </aside>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- Feedback dock (💬) — three-level Speech-Bubble overlay, top to
         bottom: general → design → page. General sits at the top because
         it is the one field that never disappears or changes label as the
         user navigates — putting it first keeps the dock from jumping.
         Anchored to the 💬 FAB (bottom-left): the FAB stays visible and
         clickable, the dock floats above/around it like a chat bubble.
         Now that ☰ lives top-right (Wave 3), the dock no longer reserves
         space for it — see Layout CSS geometry comment.
         The close button minimises (does not destroy state) — user input
         is preserved on close, no value is lost.
         Open by default (data-open="true") — see Layout JS § Auto-close for
         the "closes on first interaction, then manual-only" behaviour
         driven by data-auto-close-armed. -->
    <aside class="feedback-dock" id="feedback-dock" data-open="true" data-auto-close-armed="true">
      <div class="feedback-dock-header">
        <strong>Feedback</strong>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.minimize}}" title="{{panel.minimize}}">−</button>
      </div>
      <div class="feedback-section">
        <label>{{proto.feedback_general}}</label>
        <textarea id="design-general-feedback" data-comment="general"
                  placeholder="{{proto.feedback_general}}"></textarea>
      </div>
      <div class="feedback-divider"></div>
      <!-- Design row — omitted for single-design iterations via
           body[data-single-design="true"] (Layout CSS), no JS branching.
           One hidden textarea per design; only the active one is shown,
           same swap mechanism as the per-screen row below. Each carries
           data-comment="design-{id}" AND data-design-comment="{id}". -->
      <div class="feedback-section">
        <label>{{design.feedback_design}}: <strong id="dock-design-label">Dispatch</strong></label>
        <div id="design-textareas" data-placeholder="{{design.feedback_design_placeholder}}"><!-- auto-populated --></div>
      </div>
      <div class="feedback-divider"></div>
      <div class="feedback-section">
        <label>{{proto.feedback_current}}: <strong id="dock-screen-label">Welcome</strong></label>
        <!-- One hidden textarea per screen. Only the active one is shown.
             Each carries data-comment="{screen-id}" AND
             data-screen-comment="{screen-id}" — so saveState/restoreState
             treats it like any comment field. -->
        <div id="screen-textareas" data-placeholder="{{proto.feedback_placeholder}}"><!-- auto-populated --></div>
      </div>
    </aside>
  </div>

  <!-- Shared content dimmer — see Common Structure for behavior + CSS. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       title="{{panel.dim_dismiss}}" hidden></div>
</body>
</html>
```

## Layout CSS

```css
/* EVERY rule below is scoped to html[data-template="design"]. That attribute
   is a projection of the ACTIVE iteration (see § Per-Iteration Templates), so
   flipping it flips the whole layout: a decision/free iteration on the same
   page falls back to the normal grid + document scroll with zero JS. Never
   write these rules unscoped — an unscoped `html, body { overflow: hidden }`
   would lock scrolling for the sidebar iterations too. */
html { margin: 0; padding: 0; }
body { margin: 0; padding: 0; }
html[data-template="design"],
html[data-template="design"] body { height: 100%; overflow: hidden; }
[data-template="design"] .concept-layout.design.fullscreen { display: block; width: 100vw; height: 100vh; overflow: hidden; }
[data-template="design"] .concept-layout.design .concept-content { position: absolute; inset: 0; overflow: hidden; }

/* Iteration sections fill the viewport. Screens inside do too —
   only the active one is visible (hidden attribute on the others).
   Outside design mode iterations stay in normal document flow. */
[data-template="design"] section[data-iteration] { position: absolute; inset: 0; }
section[data-iteration][hidden] { display: none; }
[data-template="design"] section[data-screen] {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 2rem; overflow-y: auto;
  animation: screen-in 0.25s ease;
}
section[data-screen][hidden] { display: none; }
@keyframes screen-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* Design-only chrome: FABs, screen indicator and feedback dock exist in the
   DOM on every page but must only render in design mode. The `html` type
   selector is REQUIRED — a bare `:not([data-template="design"])` also matches
   <body> (which never carries the attribute) and would hide the chrome in
   design mode too. */
html:not([data-template="design"]) .screen-indicator,
html:not([data-template="design"]) .panel-fab,
html:not([data-template="design"]) .feedback-fab,
html:not([data-template="design"]) .feedback-dock,
html:not([data-template="design"]) .design-switcher { display: none !important; }

/* Minimal screen counter — NOT a header bar.
   Left-anchored at 1rem and content-sized, so its natural width grows with
   the page label while the switcher stays centred. Without a cap the two
   overlap on narrow viewports (measured: 21px overlap at 768px, full
   overlap at 375px). The cap is derived from the switcher's own geometry
   below — switcher max-width 34vw, centred ⇒ its left edge is at 33vw, so
   the indicator may occupy at most 33vw minus its 1rem offset minus a
   0.5rem gap. Truncation with an ellipsis is the right degradation here:
   the leading "page N/total" segment is the load-bearing part, the trailing
   screen label is not. */
.screen-indicator {
  position: fixed; top: 1rem; left: 1rem; z-index: 90;
  padding: 0.4rem 0.75rem; border-radius: 999px;
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary); font-size: 0.8rem;
  backdrop-filter: blur(6px);
  /* border-box is REQUIRED: with the default content-box the 0.75rem
     padding and the border are added ON TOP of max-width and the element
     still runs into the switcher (measured: 25px over budget at 375px). */
  box-sizing: border-box;
  max-width: calc(33vw - 1.5rem);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* No switcher to avoid when the iteration has a single design — the only
   neighbour left is the ☰ FAB at the top right (left edge 100vw - 88px). */
body[data-single-design="true"] .screen-indicator { max-width: calc(100vw - 8rem); }
.screen-indicator strong { color: var(--text); }

/* ── Design switcher — ghost bar, top centre ──
   Deliberately barely-there at rest: the viewport belongs to the mockup, not
   to chrome. Only the active design's label shows, no background fill, no
   separators. Hover AND :focus-within reveal the full segmented control —
   :focus-within (not :focus-visible) is deliberate: the expanding element is
   the container, and it must expand as soon as focus lands on ANY of its
   segment buttons, which is exactly what keyboard tabbing produces. That
   keeps the control reachable without a mouse.
   Never collides with the screen indicator (top-left) or the ☰ FAB
   (top-right once Wave 3 moves it there) — guaranteed by the width bands
   documented at .panel-fab below, not by the labels happening to be short.
   Hidden entirely below two designs (body[data-single-design="true"]). */
.design-switcher {
  position: fixed; top: 0.75rem; left: 50%; transform: translateX(-50%);
  z-index: 95;
  display: flex; gap: 2px;
  padding: 0.3rem; border-radius: 999px;
  background: transparent;
  backdrop-filter: blur(6px);
  opacity: 0.18;
  transition: opacity 0.16s ease;
  /* Hard width budget so the expanded (hover/focus) state cannot grow into
     the screen indicator on the left or the ☰ FAB on the right — it spans
     33vw…67vw at every viewport. Segments shrink and ellipsise instead;
     min-width:0 is required or flex refuses to shrink below content width
     because the labels are nowrap. */
  box-sizing: border-box;
  max-width: 34vw;
  overflow: hidden;
}
.design-switcher:hover,
.design-switcher:focus-within { opacity: 1; }
.design-switch-item {
  border: none; background: transparent; cursor: pointer;
  padding: 0.35rem 0.85rem; border-radius: 999px;
  font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; transition: background 0.15s, color 0.15s;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
/* Resting state shows ONLY the active label — siblings collapse to width 0
   so no separators/background are visible until the bar expands on hover. */
.design-switcher:not(:hover):not(:focus-within) .design-switch-item:not([data-active="true"]) {
  width: 0; padding: 0; margin: 0; overflow: hidden; pointer-events: none;
}
.design-switcher:not(:hover):not(:focus-within) {
  background: transparent; border: none;
}
.design-switcher:hover,
.design-switcher:focus-within {
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
}
.design-switch-item[data-active="true"] {
  color: var(--text); font-weight: 600;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.design-switch-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
/* Auto-hides while the ☰ panel is open — the panel carries the same nav. */
body.panel-open .design-switcher { opacity: 0; pointer-events: none; }

/* Overlay decision panel — hidden by default, same slide-in as the non-design
   overlay. Scoped: in a decision/free iteration the very same <aside> must
   dock back into the sidebar grid. */
[data-template="design"] .concept-layout.design .concept-decision-panel {
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  right: -400px;
  width: 360px;
  max-width: 90vw;
  height: 100vh;
  padding: 1.5rem;
  background: var(--panel-bg, #161b22);
  border-left: 1px solid var(--border-color, #30363d);
  z-index: 200;
  overflow-y: auto;
  transition: right 0.3s ease;
}
[data-template="design"] .concept-layout.design .concept-decision-panel.open {
  right: 0;
}

.panel-fab,
.feedback-fab {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s;
}
/* ☰ lives top-right (Wave 3). The three top-edge overlays partition the
   width by construction rather than by hope:
     screen indicator  1rem … 33vw - 0.5rem   (max-width cap + ellipsis)
     design switcher   33vw … 67vw            (max-width: 34vw, centred)
     ☰ FAB             100vw - 88px … 100vw - 2rem
   Those bands cannot intersect for any viewport width where
   67vw < 100vw - 88px, i.e. above 267px — below that the layout is out of
   scope anyway. Measured in Edge at 1280/768/375px: no overlap at any of
   the three. Before the caps existed the indicator overlapped the switcher
   by 21px at 768px and completely at 375px, where it also reached the ☰
   FAB. 💬 stays bottom-left, unchanged. */
.panel-fab { top: 2rem; right: 2rem; background: var(--accent-color, #58a6ff); }
.feedback-fab { bottom: 2rem; left: 2rem; background: var(--warning-color, #d29922); }
.panel-fab:hover,
.feedback-fab:hover { transform: scale(1.1); }
/* Only the ☰ panel FAB hides when its panel opens (the decision panel is
   a full overlay). The 💬 feedback FAB stays visible while the dock is
   open so the user can toggle it back closed via the same FAB. */
.panel-fab.hidden { opacity: 0; pointer-events: none; }

.panel-close-btn,
.feedback-close-btn {
  align-self: flex-end;
  background: none;
  border: none;
  color: var(--text-color, #c9d1d9);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.panel-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 150;
}
.panel-backdrop.visible { display: block; }

/* ── Screen navigation inside the ☰ panel ── */
.screen-nav { display: flex; flex-direction: column; gap: 4px;
  margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-color); }
.screen-nav-item { display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.85rem; border-radius: 8px; text-decoration: none;
  color: var(--text-color, #c9d1d9); font-size: 0.95rem;
  border: 1px solid var(--border-color); background: transparent;
  cursor: pointer; transition: all 0.15s; text-align: left; }
.screen-nav-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border-color: var(--accent-color); font-weight: 600;
}
.screen-nav-item .screen-idx { color: var(--accent-color); font-weight: 600; margin-right: 0.5rem; }
.screen-nav-item .has-notes { color: var(--warning-color); font-size: 0.75rem; }

/* Two-level nav: a design heading per <section data-design>, its pages
   nested/indented beneath. Single-design pages never render the heading
   (see body[data-single-design="true"] below), so this stays invisible
   until it's needed. */
.screen-nav-group { display: flex; flex-direction: column; gap: 2px; }
.screen-nav-group + .screen-nav-group { margin-top: 0.5rem; }
.screen-nav-design-heading {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 0.85rem; border-radius: 8px; border: none;
  background: transparent; color: var(--text); font-size: 0.9rem;
  font-weight: 700; cursor: pointer; text-align: left; transition: background 0.15s;
}
.screen-nav-design-heading:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-design-heading[data-active="true"] { color: var(--accent-color); }
.screen-nav-design-heading .has-notes { color: var(--warning-color); font-size: 0.75rem; }
.screen-nav-group .screen-nav-item { margin-left: 0.75rem; }

/* ── Feedback Dock — Speech-Bubble anchored to the 💬 FAB ──
   Geometry (simplified, Wave 3): now that ☰ lives top-right, the dock no
   longer needs to reserve horizontal space for it, nor lift itself above
   it on narrow viewports (both existed only because ☰ used to share the
   bottom-right corner with 💬). The dock now spans to the right edge minus
   a normal margin.
   * left = FAB.left (2rem)               → bubble's left edge aligns with FAB
   * right = 2rem                         → normal margin, was reserved for ☰
   * bottom = FAB.bottom + 56 + 6px       → bubble sits directly above the FAB
                                            with a hair of overlap so the
                                            visual connection reads as "the
                                            bubble grows out of the FAB".
   * padding-left = 80px                  → input fields start to the right
                                            of where the FAB visually lives,
                                            so labels/textareas never sit
                                            behind it (the FAB stays clickable
                                            on top via higher z-index).
   transform-origin still anchors to the 💬 FAB so the bubble reads as
   growing out of it. The FAB keeps its z-index above the dock so it remains
   visible and clickable while the dock is open — clicking the FAB toggles
   the dock. */
.feedback-dock {
  position: fixed;
  left: 2rem;
  right: 2rem;
  bottom: calc(2rem + 56px - 6px);
  max-height: min(60vh, 520px);
  padding: 1.25rem 1.5rem 1.5rem 80px;
  background: var(--panel-bg, #161b22);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 18px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25);
  z-index: 180;
  overflow-y: auto;
  display: none;
  flex-direction: column;
  gap: 1.1rem;
  transform-origin: 28px calc(100% + 22px); /* anchor: 💬 FAB centre below dock-bottom-left */
}
.feedback-dock[data-open="true"] {
  display: flex;
  animation: feedback-dock-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
@keyframes feedback-dock-in {
  from { opacity: 0; transform: translateY(8px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* FAB sits above the dock so it stays visible AND clickable while the dock
   is open. The dock's bottom edge overlaps the FAB's top edge by ~6px, so
   the bubble visually reads as growing out of the FAB. */
.feedback-fab { z-index: 220; }

.feedback-dock-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0.25rem;
}
.feedback-dock-header strong { font-size: 1rem; }

/* Minimise button — visual cue is the underscore-low minus, not an ✕,
   so the user understands their text is preserved (not destroyed). */
.feedback-close-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #8b949e);
  font-size: 1.6rem; line-height: 1; font-weight: 500;
  padding: 0 0.4rem 0.2rem; border-radius: 6px;
  transition: background 0.15s, color 0.15s;
}
.feedback-close-btn:hover {
  background: color-mix(in srgb, var(--text-color) 12%, transparent);
  color: var(--text-color, #c9d1d9);
}

.feedback-section { display: flex; flex-direction: column; gap: 0.4rem; }
.feedback-section label { font-size: 0.9rem; color: var(--text-secondary); font-weight: 500; }
.feedback-section label strong { color: var(--accent-color); }
.feedback-section textarea {
  width: 100%; padding: 0.8rem;
  border: 1px solid var(--border-color); border-radius: 10px;
  background: var(--input-bg, #0d1117); color: var(--text-color, #c9d1d9);
  font-family: inherit; font-size: 0.95rem; line-height: 1.5; resize: vertical; min-height: 90px;
}
.feedback-section textarea:focus { outline: none; border-color: var(--accent-color); }
.feedback-divider { height: 1px; background: var(--border-color); margin: 0.25rem 0; }

/* Narrow viewports (≤560px): just tighten the margins/padding. The old
   "lift above the FAB" override is gone — it only existed to compensate
   for the ☰ FAB's right-side reservation, which no longer exists now that
   ☰ moved top-right (Wave 3). */
@media (max-width: 560px) {
  .feedback-dock {
    left: 0.75rem;
    right: 0.75rem;
    padding: 1rem 1rem 1rem 72px;
    border-radius: 14px;
  }
}

/* Hidden per-screen / per-design textareas: only the active one shown */
#screen-textareas textarea[hidden],
#design-textareas textarea[hidden] { display: none; }

/* Single-screen design: hide screen-nav + per-screen feedback section +
   its own leading divider. Order is general -> design -> page, so the
   divider that must disappear with the page row is the one immediately
   BEFORE it, not the one before general (which is always first, no
   leading divider). Only general (and, if >=2 designs, per-design) notes
   remain visible. */
body[data-single-screen="true"] #screen-nav,
body[data-single-screen="true"] .feedback-section:has(#screen-textareas),
body[data-single-screen="true"] .feedback-divider:has(+ .feedback-section #screen-textareas) {
  display: none;
}

/* Single-design iteration: sibling mechanism to single-screen above, set by
   the same wiring pass (buildDesignUI()). Hides the design switcher and the
   per-design feedback row via CSS only — no JS branching needed at the call
   site, matching how single-screen already collapses. The design heading
   level of #screen-nav also collapses back to a flat list since there is
   nothing to group. */
body[data-single-design="true"] .design-switcher,
body[data-single-design="true"] .screen-nav-design-heading,
body[data-single-design="true"] .feedback-section:has([data-design-comment]),
body[data-single-design="true"] .feedback-divider:has(+ .feedback-section [data-design-comment]) {
  display: none;
}
body[data-single-design="true"] .screen-nav-group .screen-nav-item { margin-left: 0; }
```

## Layout JS — single-screen navigation + context-sensitive feedback

Only one screen is visible at a time, scoped to the one active design. Each
design remembers its own last-viewed page (`lastScreenByDesign`, persisted
via `saveState()`), so switching designs and back returns to that page, not
page 1. `showScreen(id)` swaps the active screen, rebuilds the position
indicator, and swaps the feedback-dock textarea to the matching per-screen
`<textarea>`.

The dock holds **one textarea per screen of EVERY design in the iteration**,
built once per iteration by `buildScreenTextareas()` — never per design
switch. Switching design or page only flips `hidden`; no node is ever
destroyed. This is load-bearing in three ways:

1. Values survive a design switch. `restoreState()` runs once on
   `DOMContentLoaded` and is never re-invoked, so a node destroyed later is
   never rehydrated.
2. `saveState()` serialises only nodes present in the DOM — destroying a
   textarea would DELETE its `text:{screen-id}` localStorage key on the next
   input event, making the note unrecoverable rather than merely invisible.
3. `collectDesignDecisions()` scans the dock; only a dock holding all designs'
   screens produces a complete `comments.screens` payload.

Same rule, same reason as `buildDesignTextareas()` for the design-level row.
Both builders carry values across the one rebuild they do have (iteration
change) via `harvestDockValues()`.

```javascript
(function wireDesignLayout() {
  // Guard on the PAGE, not on the current projection: a page whose first
  // iteration is `decision` may still contain a `design` iteration further
  // down, and this IIFE only runs once at load.
  // The legacy alias `prototype` is normalised FIRST — a page that carries
  // data-template="prototype" on <html> and no data-iteration-template at
  // all (the documented legacy shape) must still wire up. Comparing the raw
  // value against 'design' only would fail both disjuncts and leave the
  // page inert.
  const DESIGN_TEMPLATES = new Set(['design', 'prototype']);
  const hasDesign = DESIGN_TEMPLATES.has(document.documentElement.dataset.template || '')
    || !!document.querySelector('section[data-iteration][data-iteration-template="design"],'
                              + 'section[data-iteration][data-iteration-template="prototype"]');
  if (!hasDesign) return;

  // Per-design "last viewed page" memory, keyed by design id. Restored from
  // localStorage's `_activeScreenByDesign` on load (see saveState below) so
  // it survives reloads, not just in-session switches.
  let lastScreenByDesign = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) lastScreenByDesign = JSON.parse(raw)._activeScreenByDesign || {};
  } catch (e) {}

  function visibleIteration() {
    return document.querySelector('section[data-iteration]:not([hidden])');
  }
  function activeDesign() {
    const it = visibleIteration();
    return it ? it.querySelector('section[data-design][data-design-active="true"]') : null;
  }
  function designs() {
    const it = visibleIteration();
    return it ? [...it.querySelectorAll('section[data-design]')] : [];
  }

  // Build screen-nav (two-level: design heading + nested pages), the design
  // switcher ghost bar, and per-screen textareas — all scoped to the
  // VISIBLE iteration (may be a frozen tab the user clicked back to, not
  // necessarily the live one).
  function buildDesignUI() {
    const allDesigns = designs();
    const active = activeDesign();
    if (!active) return;

    // Single-design collapse: CSS keys off body[data-single-design="true"]
    // to hide the switcher + design-level feedback row, mirroring
    // body[data-single-screen] below.
    document.body.dataset.singleDesign = allDesigns.length <= 1 ? 'true' : 'false';

    // Design switcher (ghost bar) — one segment per design.
    const switcher = document.getElementById('design-switcher');
    switcher.innerHTML = '';
    allDesigns.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'design-switch-item';
      btn.type = 'button';
      btn.dataset.designId = d.dataset.design;
      btn.dataset.active = String(d === active);
      btn.textContent = d.dataset.navLabel || d.dataset.design;
      // "a design switch" is one of the three auto-close triggers (§ Dock
      // open/close below) — fired here, not from the generic mockup-click
      // listener, so the switcher itself is exempt from that listener.
      btn.addEventListener('click', () => { showDesign(d.dataset.design); fireAutoClose(); });
      switcher.appendChild(btn);
    });

    // Two-level screen-nav inside the ☰ panel: one .screen-nav-group per
    // design, a heading button, then nested .screen-nav-item per page.
    const nav = document.getElementById('screen-nav');
    nav.innerHTML = '';
    allDesigns.forEach(d => {
      const group = document.createElement('div');
      group.className = 'screen-nav-group';

      const heading = document.createElement('button');
      heading.className = 'screen-nav-design-heading';
      heading.type = 'button';
      heading.dataset.designId = d.dataset.design;
      heading.dataset.active = String(d === active);
      heading.innerHTML = `<span>${d.dataset.navLabel || d.dataset.design}</span>
        <span class="has-notes" data-design-note-marker="${d.dataset.design}"></span>`;
      heading.addEventListener('click', () => { showDesign(d.dataset.design); fireAutoClose(); closePanel(); });
      group.appendChild(heading);

      const screens = [...d.querySelectorAll('section[data-screen][id]')];
      screens.forEach((sec, idx) => {
        const btn = document.createElement('button');
        btn.className = 'screen-nav-item';
        btn.type = 'button';
        btn.dataset.screenId = sec.id;
        btn.dataset.designId = d.dataset.design;
        btn.innerHTML = `<span><span class="screen-idx">${idx + 1}.</span>${sec.dataset.navLabel || sec.id}</span>
          <span class="has-notes" data-note-marker></span>`;
        btn.addEventListener('click', () => {
          if (d !== active) showDesign(d.dataset.design, sec.id);
          else showScreen(sec.id);
          fireAutoClose();
          closePanel();
        });
        group.appendChild(btn);
      });
      nav.appendChild(group);
    });

    buildDesignTextareas(allDesigns, active);
    buildScreenTextareas(allDesigns);
    updateScreenScope(active);
  }

  // Snapshot the dock's current values, keyed by data-comment, so the one
  // rebuild these builders still perform (iteration change) does not drop
  // text. restoreState() only runs on DOMContentLoaded, so anything lost
  // here is lost for good — and the next saveState() would delete its
  // localStorage key too.
  function harvestDockValues() {
    const values = {};
    document.querySelectorAll('#feedback-dock [data-comment]').forEach(el => {
      if (el.value) values[el.dataset.comment] = el.value;
    });
    return values;
  }

  // Per-design textareas (💬) — one per design, only the active one shown.
  // Rebuilt only when the design SET changes (buildDesignUI, i.e. iteration
  // switches). A design switch never rebuilds anything: showDesign() just
  // flips `hidden`.
  function buildDesignTextareas(allDesigns, active) {
    const container = document.getElementById('design-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allDesigns.forEach(d => {
      const ta = document.createElement('textarea');
      ta.dataset.comment = `design-${d.dataset.design}`;
      ta.dataset.designComment = d.dataset.design;
      ta.placeholder = placeholder;
      ta.hidden = d !== active;
      if (carried[ta.dataset.comment]) ta.value = carried[ta.dataset.comment];
      container.appendChild(ta);
    });
    const label = document.getElementById('dock-design-label');
    if (label && active) label.textContent = active.dataset.navLabel || active.dataset.design;
  }

  // Per-screen textareas (💬) — one per screen of EVERY design in the
  // iteration, all hidden until showScreen() reveals the active one. Built
  // ONCE per iteration, exactly like buildDesignTextareas above; never on a
  // design switch. Destroying and rebuilding them per design lost user text
  // (restoreState never re-runs) and truncated the submit payload
  // (collectDesignDecisions scans this container).
  // data-screen-design carries the owning design id — the dock lives outside
  // section[data-design], so that attribute is the only link back.
  function buildScreenTextareas(allDesigns) {
    const container = document.getElementById('screen-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allDesigns.forEach(d => {
      d.querySelectorAll('section[data-screen][id]').forEach(sec => {
        const ta = document.createElement('textarea');
        ta.dataset.comment = sec.id;
        ta.dataset.screenComment = sec.id;
        ta.dataset.screenDesign = d.dataset.design;
        ta.placeholder = placeholder;
        ta.hidden = true;
        if (carried[sec.id]) ta.value = carried[sec.id];
        container.appendChild(ta);
      });
    });
  }

  // Counters + single-screen collapse for the design currently active.
  // Pure projection — touches no textarea, so it is safe to call on every
  // design switch.
  function updateScreenScope(design) {
    const screens = [...design.querySelectorAll('section[data-screen][id]')];
    // Optional chaining throughout: the indicator is documented as
    // "can be hidden or simplified" for single-screen designs, so its spans
    // are genuinely optional — an unguarded write would turn that documented
    // choice into a boot-time TypeError.
    const totalEl = document.getElementById('total-screens');
    if (totalEl) totalEl.textContent = screens.length;
    // Single-screen designs: hide screen-nav + per-screen feedback.
    // CSS keys off body[data-single-screen="true"].
    document.body.dataset.singleScreen = screens.length <= 1 ? 'true' : 'false';
  }

  // Switches the active design (and, within it, the given page or its
  // remembered last-viewed page). Closes over showScreen defined below.
  window.showDesign = function(designId, screenId) {
    const it = visibleIteration();
    if (!it) return;
    const targets = [...it.querySelectorAll('section[data-design]')];
    targets.forEach(d => {
      const match = d.dataset.design === designId;
      d.hidden = !match;
      d.dataset.designActive = match ? 'true' : 'false';
    });
    document.querySelectorAll('.design-switch-item').forEach(item => {
      item.dataset.active = String(item.dataset.designId === designId);
    });
    document.querySelectorAll('.screen-nav-design-heading').forEach(h => {
      h.dataset.active = String(h.dataset.designId === designId);
    });
    // Swap the per-design textarea (built once by buildDesignTextareas —
    // only its `hidden` state and the dock label change on switch, same
    // pattern as showScreen swapping [data-screen-comment] below).
    document.querySelectorAll('[data-design-comment]').forEach(ta => {
      ta.hidden = ta.dataset.designComment !== designId;
    });
    const dockDesignLabel = document.getElementById('dock-design-label');
    if (dockDesignLabel) dockDesignLabel.textContent = targets.find(d => d.dataset.design === designId)?.dataset.navLabel || designId;
    // Scoped to the VISIBLE iteration — design ids repeat across iterations,
    // so an unscoped lookup would resolve to a frozen iteration's node and
    // navigate the wrong section.
    const design = it.querySelector(`section[data-design="${CSS.escape(designId)}"]`);
    if (!design) return;
    updateScreenScope(design);
    const remembered = screenId || lastScreenByDesign[designId];
    const first = design.querySelector('section[data-screen]');
    const target = (remembered && design.querySelector(`#${CSS.escape(remembered)}`)) ? remembered : first?.id;
    if (target) showScreen(target);
    updateDesignNoteMarkers();
  };

  window.showScreen = function(id) {
    const design = activeDesign();
    if (!design) return;
    const screens = design.querySelectorAll('section[data-screen][id]');
    let idx = 0;
    screens.forEach((s, i) => {
      const match = s.id === id;
      s.hidden = !match;
      s.dataset.screenActive = match ? 'true' : 'false';
      if (match) idx = i;
    });
    // Scoped to the active design for the same reason as showDesign's
    // lookup: screen ids repeat across iterations.
    const screen = design.querySelector(`#${CSS.escape(id)}`);
    const label = screen?.dataset.navLabel || id;
    // Guarded like every other indicator write — see updateScreenScope().
    const labelEl = document.getElementById('active-screen-label');
    if (labelEl) labelEl.textContent = label;
    const idxEl = document.getElementById('active-screen-idx');
    if (idxEl) idxEl.textContent = idx + 1;
    const dockLabel = document.getElementById('dock-screen-label');
    if (dockLabel) dockLabel.textContent = label;
    // The dock holds every design's screen textareas, so match on the
    // owning design too — screen ids are unique per iteration, but this
    // keeps the swap correct even if a page reuses ids across designs.
    document.querySelectorAll('#feedback-dock [data-screen-comment]').forEach(ta => {
      ta.hidden = !(ta.dataset.screenComment === id
        && (!ta.dataset.screenDesign || ta.dataset.screenDesign === design.dataset.design));
    });
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      item.dataset.active = String(item.dataset.screenId === id);
    });
    lastScreenByDesign[design.dataset.design] = id;
    updateIndicator();
    updateNoteMarkers();
    if (typeof saveState === 'function') saveState();
  };

  // Rebuilds the position indicator from the locale word-primitives +
  // live numbers: "{iteration} · {design} · {page} N/total · {label}",
  // dropping the iteration segment when there is one iteration and the
  // design segment when the active iteration has one design. Never a
  // fixed-shape string — each segment is toggled `hidden` independently so
  // a missing one leaves no dangling " · ".
  function updateIndicator() {
    const totalIterations = document.querySelectorAll('section[data-iteration]').length;
    const iterEl = document.getElementById('indicator-iteration');
    if (iterEl) {
      iterEl.hidden = totalIterations <= 1;
      if (!iterEl.hidden) {
        const activeIter = document.querySelector('section[data-iteration]:not([hidden])');
        const idxEl = document.getElementById('active-iteration-idx');
        if (idxEl && activeIter) idxEl.textContent = activeIter.dataset.iteration;
      }
    }
    const designEl = document.getElementById('indicator-design');
    if (designEl) {
      const total = designs().length;
      designEl.hidden = total <= 1;
      if (!designEl.hidden) {
        const active = activeDesign();
        const labelEl = document.getElementById('active-design-label');
        if (labelEl && active) labelEl.textContent = active.dataset.navLabel || active.dataset.design;
      }
    }
  }

  // Every per-screen textarea belongs to the DOCK, not to the mockup
  // section — `section[data-design]` never contains one. Note markers must
  // therefore query the dock and filter by the owning design id.
  function dockScreenTextareas(designId) {
    return [...document.querySelectorAll('#feedback-dock [data-screen-comment]')]
      .filter(ta => !designId || !ta.dataset.screenDesign || ta.dataset.screenDesign === designId);
  }

  function updateNoteMarkers() {
    document.querySelectorAll('.screen-nav-item').forEach(item => {
      const id = item.dataset.screenId;
      const ta = dockScreenTextareas(item.dataset.designId)
        .find(t => t.dataset.screenComment === id);
      const marker = item.querySelector('[data-note-marker]');
      if (marker) marker.textContent = (ta && ta.value.trim()) ? '● Notiz' : '';
    });
    updateDesignNoteMarkers();
  }
  window.updateNoteMarkers = updateNoteMarkers;

  // Design heading marker: lights up when ANY of its pages, or its own
  // design-level comment field (Feedback dock, Wave "design feedback row"
  // — `[data-design-comment="{id}"]`, may not exist yet on older pages),
  // carries unsubmitted text.
  function updateDesignNoteMarkers() {
    document.querySelectorAll('[data-design-note-marker]').forEach(marker => {
      const id = marker.dataset.designNoteMarker;
      const pageHasNotes = dockScreenTextareas(id).some(ta => ta.value.trim());
      const designTa = document.querySelector(`[data-design-comment="${CSS.escape(id)}"]`);
      const designHasNotes = designTa && designTa.value.trim();
      marker.textContent = (pageHasNotes || designHasNotes) ? '●' : '';
    });
  }

  // Panel + dock toggles.
  // These four used to be dereferenced unguarded. A generated page missing
  // any one of them died right here with a TypeError — and since this IIFE
  // wires EVERYTHING below (screen switching, the dock, click-through), the
  // whole page's JS went with it. Silently: no visible error, just a mockup
  // that ignores every click. Guard the wiring and name what is missing.
  const panel = document.getElementById('decision-panel');
  const panelToggle = document.getElementById('panel-toggle');
  const panelCloseBtn = document.getElementById('panel-close');
  const backdrop = document.getElementById('panel-backdrop');
  const missingPanelParts = [
    ['decision-panel', panel], ['panel-toggle', panelToggle],
    ['panel-close', panelCloseBtn], ['panel-backdrop', backdrop],
  ].filter(([, el]) => !el).map(([id]) => id);
  if (missingPanelParts.length) {
    console.error('[concept] decision-panel markup incomplete, panel disabled — missing: '
      + missingPanelParts.join(', '));
  }
  // The switcher auto-hides while the panel is open (the panel carries the
  // same navigation) — driven by body.panel-open, see Layout CSS.
  window.openPanel = () => { panel?.classList.add('open'); backdrop?.classList.add('visible'); panelToggle?.classList.add('hidden'); document.body.classList.add('panel-open'); };
  window.closePanel = () => { panel?.classList.remove('open'); backdrop?.classList.remove('visible'); panelToggle?.classList.remove('hidden'); document.body.classList.remove('panel-open'); };
  panelToggle?.addEventListener('click', openPanel);
  panelCloseBtn?.addEventListener('click', closePanel);
  backdrop?.addEventListener('click', closePanel);

  const dock = document.getElementById('feedback-dock');
  const dockToggle = document.getElementById('feedback-toggle');
  const dockClose = document.getElementById('feedback-close');
  // The dock is a Speech-Bubble anchored to the 💬 FAB — the FAB stays
  // visible and clickable while the dock is open, so clicking it toggles
  // (open ↔ minimised). The X button is a *minimise*, not a destroy:
  // closing the dock leaves all textarea content intact (localStorage
  // persistence is untouched).
  // Accessibility:
  //   * aria-expanded reflects open/closed state on the FAB
  //   * aria-label swaps between data-label-open / data-label-close so
  //     screen-reader users hear the correct next action
  //   * on close, focus is restored to the FAB if it was inside the dock
  //     (the dock disappears via display:none, so leaving focus there
  //     would orphan it)
  const LABEL_OPEN = dockToggle.dataset.labelOpen || dockToggle.getAttribute('aria-label');
  const LABEL_CLOSE = dockToggle.dataset.labelClose || LABEL_OPEN;
  function openDock() {
    dock.dataset.open = 'true';
    dockToggle.setAttribute('aria-expanded', 'true');
    dockToggle.setAttribute('aria-label', LABEL_CLOSE);
  }
  function closeDock() {
    const focusWasInside = dock.contains(document.activeElement);
    dock.dataset.open = 'false';
    dockToggle.setAttribute('aria-expanded', 'false');
    dockToggle.setAttribute('aria-label', LABEL_OPEN);
    if (focusWasInside) dockToggle.focus();
  }
  window.closeDock = closeDock;
  dockToggle.addEventListener('click', () => {
    if (dock.dataset.open === 'true') closeDock();
    else openDock();
  });
  dockClose.addEventListener('click', closeDock);

  // ── Open by default, closes on first interaction ──
  // The dock starts open (data-open="true" in markup) so a first-time user
  // sees all three feedback fields immediately. It auto-closes itself on the
  // FIRST of: a click inside the mockup, a design switch, a page switch —
  // tracked by data-auto-close-armed, cleared on first fire so the manual
  // 💬 toggle governs everything afterwards (never auto-closes twice).
  // Frozen iterations are exempt entirely: nothing to type, so the dock
  // just stays open for read-only review (see primeDock()).
  let autoCloseUsed = false;
  function fireAutoClose() {
    if (dock.dataset.autoCloseArmed !== 'true') return;
    dock.dataset.autoCloseArmed = 'false';
    autoCloseUsed = true;
    if (dock.dataset.open === 'true') closeDock();
  }
  // Dock content is per-iteration, but the dock itself is ONE shared overlay
  // that lives outside section[data-iteration]. Entering a frozen tab
  // stashes the live iteration's unsent values, shows the frozen
  // iteration's SUBMITTED values read-only (never `disabled` — see
  // iteration-rules.md § Freezing Design Iterations), and returning to the
  // live tab restores the stash. Both directions write EVERY dock field,
  // empty string included: screen ids repeat across iterations, so leaving a
  // field untouched would leak the other iteration's text into it.
  // The frozen payload is the JSON blob the freeze step writes into the
  // section as a script[type="application/json"][data-frozen-feedback]
  // element — same shape collectDesignDecisions() submitted
  // ({general, designs, screens}); see iteration-rules.md § Freezing Design
  // Iterations for the exact markup. Never write that closing script tag
  // literally inside this JS, not even in a comment: the HTML parser ends
  // the surrounding script element at it. Missing blob (older pages)
  // degrades to empty read-only fields rather than editable ones.
  let liveDockValues = null;
  function frozenFeedback() {
    const it = visibleIteration();
    const node = it && it.querySelector('script[type="application/json"][data-frozen-feedback]');
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }
  function applyDockFreezeState() {
    const frozen = document.body.classList.contains('viewing-frozen');
    const fields = [...document.querySelectorAll('#feedback-dock textarea')];
    if (frozen) {
      if (liveDockValues === null) liveDockValues = harvestDockValues();
      const data = frozenFeedback() || {};
      fields.forEach(ta => {
        if (ta.dataset.designComment) ta.value = (data.designs || {})[ta.dataset.designComment] || '';
        else if (ta.dataset.screenComment) ta.value = (data.screens || {})[ta.dataset.screenComment] || '';
        else if (ta.dataset.comment === 'general') ta.value = data.general || '';
        ta.readOnly = true;
      });
    } else {
      const stash = liveDockValues;
      liveDockValues = null;
      fields.forEach(ta => {
        ta.readOnly = false;
        if (stash) ta.value = stash[ta.dataset.comment] || '';
      });
    }
  }

  // Called by the submit handler once the payload is accepted. The dock is
  // shared across iterations and its ids are per-design-index (`d1-s1`), so
  // iteration N+1 would otherwise open pre-filled with — and re-send —
  // iteration N's text. Clearing on submit is preferred over namespacing the
  // keys per iteration: the values have just been persisted server-side in
  // the payload and mirrored into the frozen section's data-frozen-feedback
  // blob, so nothing is lost, and the localStorage keys stay stable for the
  // ordinary reload case.
  window.clearDock = function() {
    document.querySelectorAll('#feedback-dock textarea').forEach(ta => { ta.value = ''; });
    liveDockValues = null;
    updateNoteMarkers();
    if (typeof saveState === 'function') saveState();
  };

  function primeDock() {
    applyDockFreezeState();
    const frozen = document.body.classList.contains('viewing-frozen');
    if (frozen) {
      // Frozen: always (re-)open for review, never arm the auto-close —
      // there is nothing to type, so nothing to hide the fields for.
      openDock();
      dock.dataset.autoCloseArmed = 'false';
      return;
    }
    if (autoCloseUsed) return; // already fired once this session — manual-only from here
    openDock();
    dock.dataset.autoCloseArmed = 'true';
  }

  // Click inside the mockup itself (trigger #1 above). Explicitly excludes
  // the dock, both FABs and the design switcher — those clicks are either
  // not "inside the mockup" at all, or (design switcher) already fire
  // fireAutoClose() from their own handler above, via the "design switch"
  // trigger rather than this generic one.
  //
  // This is the ONLY click-away path. There must never be a second,
  // unconditional "close on outside click" listener: it would bypass
  // data-auto-close-armed and close the dock on EVERY mockup click, so a
  // dock the user deliberately re-opened after the first auto-close would
  // not survive the next click. The contract is one auto-close, then
  // manual 💬 toggle only — enforced entirely by fireAutoClose().
  document.addEventListener('click', e => {
    if (e.target.closest('#feedback-dock') || e.target.closest('.panel-fab')
      || e.target.closest('.feedback-fab') || e.target.closest('.design-switcher')) return;
    if (e.target.closest('.device-frame') || e.target.closest('[data-screen]')) fireAutoClose();
  });

  document.addEventListener('DOMContentLoaded', () => {
    buildDesignUI();
    const active = document.querySelector('section[data-iteration][data-active]');
    if (active) {
      const design = active.querySelector('section[data-design][data-design-active="true"]');
      if (design) {
        // Restore last active screen from localStorage if available,
        // otherwise default to the first screen of the active design.
        let restored = null;
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) restored = JSON.parse(raw)._activeScreen;
        } catch (e) {}
        const first = design.querySelector('section[data-screen]');
        showScreen(restored && design.querySelector(`#${CSS.escape(restored)}`) ? restored : (first ? first.id : ''));
      }
    }
    updateIndicator();
    document.addEventListener('input', updateNoteMarkers);
    // Runs last: the initial buildDesignUI()/showScreen() calls above are
    // programmatic setup, not user interaction, so priming the dock here
    // (not inside showScreen) keeps boot-time restore from being
    // misread as the "first interaction" that auto-closes it.
    primeDock();
  });

  // Rebuild after iteration switches (fresh designs, fresh screens, fresh
  // textareas). Preserve the previously active screen if it still exists in
  // the newly visible design; otherwise fall back to that design's
  // remembered page, or its first page.
  document.addEventListener('iteration:changed', () => {
    buildDesignUI();
    const design = activeDesign();
    if (!design) return;
    const prevId = document.querySelector('[data-screen][data-screen-active="true"]')?.id;
    const stillThere = prevId && design.querySelector(`section[data-screen]#${CSS.escape(prevId)}`);
    const remembered = lastScreenByDesign[design.dataset.design];
    const first = design.querySelector('section[data-screen]');
    const target = stillThere ? prevId
      : (remembered && design.querySelector(`#${CSS.escape(remembered)}`)) ? remembered
      : first?.id;
    if (target) showScreen(target);
    // Same boot-vs-interaction distinction as DOMContentLoaded: this rebuild
    // is a consequence of the tab switch, not itself the "page switch"
    // trigger (that already fired, if at all, from the tab-click handler
    // elsewhere) — but frozen tabs must still (re-)open for review here.
    primeDock();
  });

  // Keyboard: Arrow Left/Right (and Space) jump between screens (within the
  // active design) when no textarea/input is focused and no overlay is open.
  document.addEventListener('keydown', e => {
    if (dock.dataset.open === 'true' || panel.classList.contains('open')) return;
    if (e.target.matches('textarea, input')) return;
    const design = activeDesign();
    if (!design) return;
    const screens = [...design.querySelectorAll('section[data-screen]')];
    const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
    if (currentIdx < 0) return;
    let nextIdx = currentIdx;
    if (e.key === 'ArrowRight' || e.key === ' ') nextIdx = Math.min(currentIdx + 1, screens.length - 1);
    else if (e.key === 'ArrowLeft') nextIdx = Math.max(currentIdx - 1, 0);
    else return;
    e.preventDefault();
    showScreen(screens[nextIdx].id);
  });
})();
```

**Persistence extension:** the design layout's `saveState()` must also write
`_activeScreen: '{current-screen-id}'` AND `_activeScreenByDesign: {designId:
screenId, …}` into the localStorage payload — the former for the currently
active design (kept for backward compatibility with the single-design
degenerate case), the latter so EVERY design's last-viewed page survives a
reload, not just the one on screen at save time.

## Click-through Handler

Single delegated listener that interprets `data-screen-link` on any element
inside a `[data-screen]` section, **scoped to the active design** — a link
may only target screens within its own design, never reach across into
another design's pages. Closes the ☰ panel (harmless no-op if it's not open)
and fires `showScreen()`.

```javascript
document.addEventListener('click', e => {
  const link = e.target.closest('[data-screen-link]');
  if (!link) return;
  const activeDesignEl = document.querySelector(
    'section[data-iteration]:not([hidden]) section[data-design][data-design-active="true"]');
  if (!activeDesignEl) return;
  const dest = link.dataset.screenLink;
  const screens = [...activeDesignEl.querySelectorAll('section[data-screen]')];
  const currentIdx = screens.findIndex(s => s.dataset.screenActive === 'true');
  let targetId = null;
  if (dest === 'next') targetId = screens[Math.min(currentIdx + 1, screens.length - 1)]?.id;
  else if (dest === 'prev') targetId = screens[Math.max(currentIdx - 1, 0)]?.id;
  else targetId = dest;
  // Guard against cross-design links: the target id must resolve to a
  // <section data-screen> INSIDE the active design, not merely exist
  // somewhere on the page.
  if (!targetId || !activeDesignEl.querySelector(`#${CSS.escape(targetId)}`)) return;
  e.preventDefault();
  if (typeof closePanel === 'function') closePanel();
  showScreen(targetId);
});
```

## Screen-pattern markup

A design iteration holds one or more `<section data-design>`, each owning
its own set of pages. Each logical page inside a design is a `<section>`
with `data-screen`:

```html
<section data-iteration="1" data-active>
  <header class="iteration-intro">
    <h2>Iteration 1 · Login flow mockup</h2>
    <p>High-fidelity walkthrough of the three-step sign-in flow.</p>
  </header>

  <section data-design="dispatch" data-nav-label="Dispatch and Apparatus" data-design-active="true">
    <section id="d1-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
      <div class="device-frame">…mockup HTML for welcome screen…</div>
    </section>

    <section id="d1-s2" data-nav-label="Credentials" data-screen hidden>
      <div class="device-frame">…mockup HTML for credentials screen…</div>
    </section>

    <section id="d1-s3" data-nav-label="Success" data-screen hidden>
      <div class="device-frame">…mockup HTML for success screen…</div>
    </section>
  </section>

  <section data-design="holotable" data-nav-label="Holotable" hidden>
    <section id="d2-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
      <div class="device-frame">…mockup HTML for welcome screen…</div>
    </section>
  </section>
</section>
```

**Rules:**
- `data-screen` marks a block as a "feedback target" — it appears as a
  per-screen textarea in the dock. Use it only for screens worth commenting on.
- Every `data-screen` section MUST also have `id` and `data-nav-label` so
  the panel TOC and the feedback dock can reference it. Screen ids only need
  to be unique across the whole page — `d{design-index}-s{page-index}`
  (e.g. `d1-s1`, `d2-s1`) keeps them readable and collision-free without
  coordinating names across designs.
- Exactly one `data-design` carries `data-design-active="true"`; the others
  are `hidden`. Within the active design, exactly one `data-screen` carries
  `data-screen-active="true"`.
- **One design** → the wrapper is still required (markup shape stays
  uniform across single- and multi-design concepts) but degenerates to
  today's behaviour: no switcher, no per-design feedback field. Do not omit
  `data-design` just because there's only one.
- A design iteration section can still contain non-screen, non-design
  `<section>`s (e.g. `id="design-notes" data-nav-label="Design notes"`)
  directly under the iteration. Those appear in the TOC but NOT in the
  feedback dock.
- Iteration tabs still apply — when Claude iterates on feedback, a new
  `<section data-iteration="N+1">` is appended with updated designs/screens
  and the old one is frozen (see Shared Systems § Iteration Tabs).

## Decision schema

The design submit payload has **no variant evaluations** — only comments,
keyed by feedback level (general / designs / screens). `comments.screens`
keeps flat screen-id keying regardless of which design a screen belongs to,
so no consumer needs to learn the design nesting to read page feedback:

```json
{
  "submitted": true,
  "template": "design",
  "iteration": 2,
  "decisions": [],
  "comments": {
    "general": "...",
    "designs": { "dispatch": "...", "holotable": "..." },
    "screens": { "d1-s1": "...", "d1-s2": "..." }
  }
}
```

## collectDecisions (design branch)

```javascript
// Called by the shared submit handler; `data-template` picks the branch.
// Generic querySelectorAll('input, select, textarea') per the coverage gate
// (iteration-rules.md § coverage gate) — no hand-listed field ids. Scoped to
// #feedback-dock rather than [data-active]: the dock is an overlay that
// lives outside section[data-iteration] in the DOM.
// The dock holds a textarea for EVERY screen of EVERY design in the active
// iteration (buildScreenTextareas), not just the design on screen — the
// non-active ones are `hidden`, which does not affect querySelectorAll. That
// is what makes this scan complete: an earlier version rebuilt the container
// per design switch, so submitting a 2-design iteration shipped only the
// design the user happened to be looking at and silently dropped the rest.
// The dock is emptied on submit (clearDock), so it never carries a previous
// iteration's text into the next payload.
function collectDesignDecisions() {
  const comments = { general: '', designs: {}, screens: {} };
  document.querySelectorAll('#feedback-dock input, #feedback-dock select, #feedback-dock textarea').forEach(el => {
    const value = (el.value || '').trim();
    if (!value) return;
    if (el.dataset.designComment) comments.designs[el.dataset.designComment] = value;
    else if (el.dataset.screenComment) comments.screens[el.dataset.screenComment] = value;
    else if (el.dataset.comment === 'general') comments.general = value;
  });
  const active = document.querySelector('section[data-iteration][data-active]');
  return {
    submitted: true,
    template: 'design',
    iteration: active ? Number(active.dataset.iteration) : undefined,
    decisions: [],
    comments
  };
}
```

---

# Template: free

A sidebar layout (same as decision) but the body is Claude-authored free
content: analysis, walkthrough, brainstorm, explainer, timeline. Tri-state
evaluation is **opt-in** per section — Claude adds it only where it makes
sense.

## Layout — Sidebar, freeform body

Identical to the decision layout (sticky sidebar, ~80/~20 split). The
difference is in the body: no forced variant-card framing, no mandatory
bi-state. Claude chooses the structure that fits the content.

```html
<html data-template="free">
<body>
  <div class="concept-layout">
    <div class="concept-content">
      <header>
        <h1>{title}</h1>
        <p class="subtitle">{optional}</p>
        <button id="theme-toggle">🌙/☀️</button>
      </header>
      <main>
        <section data-iteration="1" data-active>
          <header class="iteration-intro">
            <h2>Iteration 1 · {subject}</h2>
            <p>Short intro paragraph.</p>
          </header>

          <!-- Freeform body. Every nested <section id data-nav-label> gets
               a scroll anchor in the panel TOC. A section becomes "evaluable"
               by adding an eval-{id} radio group inside it (optional). -->
          <section id="context" data-nav-label="Context">
            <p>…</p>
          </section>

          <section id="finding-1" data-nav-label="Finding: latency spike">
            <p>…</p>
            <!-- OPT-IN bi-state: only present when Claude wants the user to
                 confirm the finding is valid. Section id MUST match the
                 radio name suffix (eval-{id}). -->
            <div class="tri-state-group">
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="discard">
                <span class="tri-state-label">Verwerfen</span>
              </label>
              <label class="tri-state-option">
                <input type="radio" name="eval-finding-1" value="include" checked>
                <span class="tri-state-label">Miteinbeziehen</span>
              </label>
            </div>
            <textarea data-comment="finding-1" placeholder="Anmerkung…"></textarea>
          </section>

          <section id="recommendation" data-nav-label="Recommendation">
            <!-- plain section, no bi-state — just content -->
            <p>…</p>
          </section>
        </section>
      </main>
    </div>

    <aside class="concept-decision-panel">
      <!-- Same structure as decision. Panel TOC auto-detects which sections
           have eval-{id} radios and mirrors their current state. -->
    </aside>
  </div>

  <!-- Shared content dimmer — see Common Structure for behavior + CSS. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       title="{{panel.dim_dismiss}}" hidden></div>
</body>
</html>
```

## Optional bi-state auto-detection

The section nav auto-detects whether a `<section data-nav-label>` contains an
`eval-{id}` radio group and mirrors its current state (Miteinbeziehen /
Verwerfen). Sections without a radio group just get a scroll anchor. See
Shared Systems § Section Navigation for the implementation.

## Decision schema

The free template emits **only the sections that actually have bi-state
radios**, plus whatever comments the user typed:

```json
{
  "template": "free",
  "decisions": [
    { "id": "finding-1", "label": "Finding: latency spike", "evaluation": "include" }
  ],
  "comments": [
    { "id": "finding-1", "text": "..." },
    { "id": "recommendation", "text": "..." }
  ]
}
```

If no section has bi-state markers, `decisions` is an empty array and the
submit payload is effectively a general-notes post.

## collectDecisions (free branch)

```javascript
function collectFreeDecisions() {
  const decisions = [];
  document.querySelectorAll('section[id][data-nav-label]').forEach(sec => {
    const radio = sec.querySelector(`input[name="eval-${CSS.escape(sec.id)}"]:checked`);
    if (!radio) return;
    decisions.push({
      id: sec.id,
      label: sec.dataset.navLabel || sec.id,
      evaluation: radio.value
    });
  });
  const comments = [];
  document.querySelectorAll('[data-comment]').forEach(el => {
    if (el.value.trim()) comments.push({ id: el.dataset.comment, text: el.value.trim() });
  });
  return { submitted: true, template: 'free', decisions, comments };
}
```

---

# Shared Systems (all templates)

All three templates reuse the same iteration, persistence, heartbeat, submit
handler, and navigation plumbing. The only template-specific parts are the
layout CSS and `collectDecisions` branch shown above. Everything below
applies uniformly.

## Section Navigation (Decision Panel as TOC)

The decision panel doubles as a full table-of-contents for the active
iteration. EVERY major `<section id="…" data-nav-label="…">` inside the
current iteration gets a clickable nav entry — not just variants. Sections
with a bi-state radio group additionally display the current evaluation
state.

A scroll spy marks the section the user is currently reading with
`.is-active` (accent bar + tint), and auto-scrolls the TOC so that marker
stays visible even in a long list. Without it, a 20-entry TOC forces the user
to hunt for their own position on every scroll.

```css
.section-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 1rem;
}
.section-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-color, #c9d1d9);
  font-size: 0.9rem;
  transition: background 0.15s, box-shadow 0.15s;
  cursor: pointer;
}
.section-nav-item:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
}
.section-nav-item:not([data-variant]) .section-nav-label {
  font-weight: 500;
  opacity: 0.9;
}
.section-nav-state {
  font-size: 0.8rem;
  color: var(--accent-color, #58a6ff);
  white-space: nowrap;
}
.section-nav-state.state-discard { color: var(--danger-color, #f85149); }
.section-nav-state.state-only { color: var(--success-color, #3fb950); }
/* "You are here" marker — driven by the scroll spy, NOT by :target or click
   alone. The accent bar is an inset box-shadow (not a border) so the entry
   never shifts horizontally when it becomes active. */
.section-nav-item.is-active {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 18%, transparent);
  box-shadow: inset 3px 0 0 var(--accent-color, #58a6ff);
  font-weight: 600;
}
.section-nav-item.is-active .section-nav-label { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .section-nav-item { transition: none; }
}
```

**Every navigable section needs a matching `id` AND a `data-nav-label`:**
```html
<!-- Plain section — TOC entry, scroll only -->
<section id="ist-zustand" data-nav-label="Ist-Zustand">...</section>

<!-- Variant section — TOC entry + bi-state evaluation -->
<section id="variant-a" class="variant-card" data-nav-label="A Orbital Ring">...</section>
```

Sections without `data-nav-label` are skipped by the TOC auto-populator.

```javascript
// --- Section Navigation (Decision Panel as TOC) ---
// Rebuilt by installScrollSpy() on EVERY nav rebuild. An iteration switch
// replaces the whole nav DOM, so a spy bound once at load would silently stop
// highlighting on every tab except the one that existed at DOMContentLoaded.
let scrollSpyEntries = [];
let scrollSpyFrame = 0;

function buildSectionNav() {
  const nav = document.getElementById('section-nav');
  if (!nav) return;
  // Use :not([hidden]) so the nav reflects the VISIBLE iteration (may be
  // a frozen tab the user is reviewing), not the live/latest one.
  const activeIteration = document.querySelector('section[data-iteration]:not([hidden])');
  if (!activeIteration) return;
  const sections = activeIteration.querySelectorAll('section[id][data-nav-label]');
  nav.innerHTML = '';
  sections.forEach(sec => {
    const id = sec.id;
    const label = sec.dataset.navLabel;
    const hasTriState = !!sec.querySelector(`input[name="eval-${id}"]`);
    const link = document.createElement('a');
    link.href = '#' + id;
    link.className = 'section-nav-item';
    link.dataset.sectionId = id;
    if (hasTriState) link.setAttribute('data-variant', '');
    const labelEl = document.createElement('span');
    labelEl.className = 'section-nav-label';
    labelEl.textContent = label;
    link.appendChild(labelEl);
    if (hasTriState) {
      const stateEl = document.createElement('span');
      stateEl.className = 'section-nav-state';
      link.appendChild(stateEl);
    }
    nav.appendChild(link);
  });
  updateSectionNavState();
  installScrollSpy();   // nav DOM was replaced → rebind the spy
}

function updateSectionNavState() {
  const labels = { include: 'Miteinbeziehen', discard: 'Verwerfen' };
  document.querySelectorAll('.section-nav-item[data-variant]').forEach(link => {
    const id = link.dataset.sectionId;
    const checked = document.querySelector(`input[name="eval-${id}"]:checked`);
    const currentState = checked ? checked.value : 'include';
    const stateEl = link.querySelector('.section-nav-state');
    if (stateEl) {
      stateEl.textContent = labels[currentState] || currentState;
      stateEl.className = 'section-nav-state state-' + currentState;
    }
  });
}

document.addEventListener('click', e => {
  const link = e.target.closest('.section-nav-item');
  if (!link) return;
  e.preventDefault();
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  setActiveNavItem(link);   // instant feedback; the spy confirms it once the smooth scroll settles
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function installScrollSpy() {
  scrollSpyEntries = [];
  document.querySelectorAll('.section-nav-item').forEach(item => {
    const sec = document.getElementById(item.dataset.sectionId);
    if (sec) scrollSpyEntries.push({ item, section: sec });
  });
  updateScrollSpy();
}

function setActiveNavItem(item) {
  if (!item || item.classList.contains('is-active')) return;
  scrollSpyEntries.forEach(({ item: other }) => {
    other.classList.remove('is-active');
    other.removeAttribute('aria-current');
  });
  item.classList.add('is-active');
  item.setAttribute('aria-current', 'true');
  revealNavItem(item);
}

// Nearest ancestor that actually scrolls. Returns null when nothing between
// `el` and <body> scrolls, so callers can fall back to the document.
function nearestScrollBox(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (/(auto|scroll|overlay)/.test(oy) && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

// Keeps the active entry inside the visible part of a long TOC. Scrolls ONLY
// the panel's own scroll box — never the content column — and only when the
// entry is genuinely out of view, so it can't fight the user's scrolling.
function revealNavItem(item) {
  const box = nearestScrollBox(item.parentElement);
  if (!box) return;
  const boxRect = box.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const pad = 12;
  if (itemRect.top < boxRect.top + pad) {
    box.scrollTop -= (boxRect.top + pad) - itemRect.top;
  } else if (itemRect.bottom > boxRect.bottom - pad) {
    box.scrollTop += itemRect.bottom - (boxRect.bottom - pad);
  }
}

// Picks the section that owns the "reading line" (28% down the viewport):
// the LAST section whose top is above the line. This is deliberately not
// IntersectionObserver's isIntersecting — a section taller than the observer
// band, or shorter than the gap between two entries, produces gaps and
// flicker there. Two edge cases are pinned explicitly: above the first
// section the first entry stays active, and at the very bottom of the scroll
// container the last entry wins (a short trailing section may never reach
// the line on its own).
function updateScrollSpy() {
  if (!scrollSpyEntries.length) return;
  const line = window.innerHeight * 0.28;
  let active = null;
  for (const entry of scrollSpyEntries) {
    if (entry.section.getBoundingClientRect().top <= line) active = entry;
  }
  if (!active) active = scrollSpyEntries[0];
  const box = nearestScrollBox(scrollSpyEntries[0].section.parentElement)
    || document.documentElement;
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 4) {
    active = scrollSpyEntries[scrollSpyEntries.length - 1];
  }
  setActiveNavItem(active.item);
}

function scheduleScrollSpy() {
  if (scrollSpyFrame) return;
  scrollSpyFrame = requestAnimationFrame(() => {
    scrollSpyFrame = 0;
    updateScrollSpy();
  });
}

// Capture phase: scroll events do NOT bubble, so a listener on document only
// sees them during capture. This covers both the document scroll and an inner
// .concept-content scroll box without knowing which one is in play.
document.addEventListener('scroll', scheduleScrollSpy, { capture: true, passive: true });
window.addEventListener('resize', scheduleScrollSpy, { passive: true });

document.addEventListener('change', updateSectionNavState);
document.addEventListener('DOMContentLoaded', buildSectionNav);
```

**Important:**
- Every navigable `<section>` needs `id` AND `data-nav-label`.
- If a section has a bi-state radio group, its `name` MUST be `eval-{section-id}`.
- `buildSectionNav()` must run again after every iteration switch.
- Never call `installScrollSpy()` on its own — `buildSectionNav()` calls it as
  its last step. Binding it independently is how the highlight goes stale
  after a tab switch.

## Decision Panel State CSS

```css
/* Connection status pill — inline, animated, non-blocking indicator at the
   top of #panel-ready. Reflects the live bridge heartbeat via [data-state]
   (set by checkClaudeConnection) and is purely informational: it NEVER
   overlays or disables the submit buttons and has no acknowledge button.
   Replaces the old .panel-warning overlay + "Got it" flow. */
.connection-pill {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.4rem 0.7rem; margin: 0 0 0.85rem;
  border-radius: 999px;
  font-size: 0.8rem; font-weight: 600;
  border: 1px solid var(--border-color, #30363d);
  color: var(--text-secondary, #8b949e);
  transition: color 0.25s, border-color 0.25s, background 0.25s;
}
.connection-pill .conn-dot {
  width: 9px; height: 9px; border-radius: 50%; flex: none;
  background: currentColor;
}
.connection-pill[data-state="connecting"] {
  color: var(--accent-color, #58a6ff);
  border-color: color-mix(in srgb, var(--accent-color, #58a6ff) 45%, transparent);
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 7%, transparent);
}
.connection-pill[data-state="connected"] {
  color: var(--success-color, #3fb950);
  border-color: color-mix(in srgb, var(--success-color, #3fb950) 40%, transparent);
  background: color-mix(in srgb, var(--success-color, #3fb950) 7%, transparent);
}
.connection-pill[data-state="disconnected"] {
  color: var(--warning-color, #d29922);
  border-color: color-mix(in srgb, var(--warning-color, #d29922) 45%, transparent);
  background: color-mix(in srgb, var(--warning-color, #d29922) 7%, transparent);
}
/* connecting + disconnected pulse the dot; connected is steady. */
.connection-pill[data-state="connecting"] .conn-dot,
.connection-pill[data-state="disconnected"] .conn-dot {
  animation: conn-pulse 1.2s ease-in-out infinite;
}
/* Animated ellipsis after the label while connecting. */
.connection-pill[data-state="connecting"] .conn-label::after {
  content: ""; animation: conn-ellipsis 1.4s steps(4, end) infinite;
}
@keyframes conn-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.82); }
  50%      { opacity: 1;   transform: scale(1); }
}
@keyframes conn-ellipsis {
  0%  { content: ""; }   25% { content: "."; }
  50% { content: ".."; } 75% { content: "..."; }
}
@media (prefers-reduced-motion: reduce) {
  .connection-pill .conn-dot { animation: none !important; }
  .connection-pill[data-state="connecting"] .conn-label::after {
    animation: none !important; content: "";
  }
}

/* Per-button cache hint — shown under each submit button only while Claude is
   disconnected, so the user knows the click will be queued and auto-delivered
   on reconnect. Toggled via [hidden] by _setCacheHints(). */
.hint-cache {
  font-size: 0.78rem;
  line-height: 1.35;
  margin: 0.25rem 0 0;
  color: var(--warning-color, #d29922);
  display: flex; align-items: center; gap: 0.35rem;
}
.hint-cache[hidden] { display: none; }

/* Content dimmer — covers the content area after submit so the user's focus
   lands on the decision panel / FAB. Decision panel, FABs, feedback dock,
   panel backdrop, and screen-indicator all sit at z-index ≥ 90 (and the
   sidebar panel was bumped to z-index 100), so they paint above the dimmer
   and stay clear + interactive. The dimmer itself is click-to-dismiss.
   Auto-clears on page reload (next iteration / final report) because the
   body class is not persisted. */
.content-dimmer {
  position: fixed;
  inset: 0;
  z-index: 50;
  /* Theme-neutral grey overlay — works on dark and light backgrounds without
     a CSS variable dependency. Same opacity range as .panel-backdrop. */
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(1.5px);
  -webkit-backdrop-filter: blur(1.5px);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
body.content-dimmed .content-dimmer:not([hidden]) {
  opacity: 1;
  pointer-events: auto;
}
.content-dimmer[hidden] { display: none; }
.content-dimmer:focus-visible {
  outline: 2px solid var(--accent-color, #58a6ff);
  outline-offset: -4px;
}

/* Submitted state */
.submitted-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  margin-bottom: 0.75rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border: 1px solid var(--success-color, #3fb950);
}
.submitted-indicator .check-icon {
  font-size: 1.3rem;
  color: var(--success-color, #3fb950);
}
.submitted-hint {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

/* Progress steps inside the submitted panel.
   Three states per <li>:
     data-state="pending" → not yet started (muted, ○ icon)
     data-state="active"  → currently happening (full text color, ⏳ icon
                            with a slow pulse so the user sees motion)
     data-state="done"    → completed (success color, ✓ icon)
   The third <li> (data-step="implemented") is only revealed for
   action="implement" submissions; submitWithAction sets its `hidden`. */
.status-steps {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.85rem;
}
.status-steps li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary, #8b949e);
  transition: color 0.2s ease;
}
.status-steps li[data-state="active"] {
  color: var(--text-color, #c9d1d9);
  font-weight: 500;
}
.status-steps li[data-state="done"] {
  color: var(--success-color, #3fb950);
}
.status-steps .step-icon {
  display: inline-block;
  width: 1rem;
  text-align: center;
  flex-shrink: 0;
}
.status-steps li[data-state="active"] .step-icon {
  animation: step-pulse 1.4s ease-in-out infinite;
}
@keyframes step-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
/* State-dependent step labels. When an <li> carries multiple
   .step-label[data-state-label] spans, only the one matching the li's
   current data-state is visible. Used by the "implemented" step where
   "Implementierung läuft" (active) reads differently than "Implementierung
   abgeschlossen" (done). Steps without data-state-label spans are
   unaffected — their plain .step-label stays visible always. */
.status-steps li .step-label[data-state-label] {
  display: none;
}
.status-steps li[data-state="pending"] .step-label[data-state-label="pending"],
.status-steps li[data-state="active"] .step-label[data-state-label="active"],
.status-steps li[data-state="done"] .step-label[data-state-label="done"] {
  display: inline;
}

/* Waiting dots animation */
.waiting-animation {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0.5rem 0;
}
.waiting-animation .dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--accent-color, #58a6ff);
  animation: pulse 1.4s ease-in-out infinite;
}
.waiting-animation .dot:nth-child(2) { animation-delay: 0.2s; }
.waiting-animation .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

#submit-iterate-btn:disabled,
#submit-implement-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Final-report panel. No iterate/implement controls — only the closing
   indicator + optional "Issues erstellen" block. Uses the same indicator
   visual language as the submitted panel for continuity. */
#panel-final-report .final-report-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  color: var(--success-color, #3fb950);
  font-weight: 600;
}
#panel-final-report .check-icon {
  font-size: 1.1rem;
}
#panel-final-report .final-report-hint {
  margin: 0 0 1rem 0;
  color: var(--text-secondary, #8b949e);
  font-size: 0.85rem;
  line-height: 1.5;
}

/* Persistent status channel — the always-visible pipeline recap that ends in
   the ship CTA. Boxed so it reads as a distinct "status" surface. Pure DOM /
   connection-independent by design: the ship affordance must never disappear
   just because the heartbeat went stale. */
.status-channel {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  padding: 0.85rem 0.95rem 1rem;
  margin-bottom: 1rem;
  background: color-mix(in srgb, var(--success-color, #3fb950) 6%, transparent);
}
.status-channel__heading {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #8b949e);
  margin-bottom: 0.6rem;
}
.status-channel .status-steps { margin-bottom: 0.85rem; }
.ship-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 600;
}
#ship-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.status-channel .hint[data-ship-state="running"] { color: var(--accent-color, #58a6ff); }
.status-channel .hint[data-ship-state="done"] { color: var(--success-color, #3fb950); }
.link-btn {
  display: inline-block;
  margin-top: 0.6rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent-color, #58a6ff);
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
}
.link-btn:hover { opacity: 0.8; }
/* Transient highlight when "Review iterations" nudges the tab bar into view. */
.iteration-tabs.tabs-nudge { animation: tabs-nudge 1.2s ease; }
@keyframes tabs-nudge {
  0%, 100% { box-shadow: none; }
  30% { box-shadow: 0 0 0 2px var(--accent-color, #58a6ff); }
}

#panel-create-issues #create-issues-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
#panel-create-issues .hint[data-issues-state="running"] {
  color: var(--accent-color, #58a6ff);
}
#panel-create-issues .hint[data-issues-state="done"] {
  color: var(--success-color, #3fb950);
}
#panel-create-issues .hint[data-issues-state="none"] {
  color: var(--warning-color, #d29922);
}

/* Disposition fieldset — controls Step 6 cleanup. Always rendered on the
   final-report panel; default selection is "discard" (matches the typical
   one-shot refinement workflow). The fieldset visually separates from the
   create-issues block above with a thin top divider. */
.dispose-fieldset {
  margin-top: 1.25rem;
  padding: 0.85rem 0.95rem 1rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-color, #0d1117) 70%, transparent);
}
.dispose-fieldset legend {
  padding: 0 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-color, #c9d1d9);
}
.dispose-fieldset .dispose-hint {
  margin: 0 0 0.75rem 0;
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  line-height: 1.4;
}
.dispose-fieldset .dispose-option {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.dispose-fieldset .dispose-option:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 8%, transparent);
}
.dispose-fieldset .dispose-option input[type="radio"] {
  margin-top: 0.25rem;
  accent-color: var(--accent-color, #58a6ff);
}
.dispose-fieldset .dispose-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.dispose-fieldset .dispose-label strong {
  font-size: 0.85rem;
  font-weight: 600;
}
.dispose-fieldset .dispose-sub {
  font-size: 0.74rem;
  color: var(--text-secondary, #8b949e);
  line-height: 1.4;
}
.dispose-fieldset .dispose-move-row {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--border-color, #30363d);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.dispose-fieldset .dispose-move-row label {
  font-size: 0.78rem;
  color: var(--text-secondary, #8b949e);
  font-weight: 500;
}
.dispose-fieldset .dispose-move-row input {
  width: 100%;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--border-color, #30363d);
  background: color-mix(in srgb, var(--bg-color, #0d1117) 80%, transparent);
  color: var(--text-color, #c9d1d9);
  font: inherit;
  font-size: 0.82rem;
}
.dispose-fieldset .dispose-move-row input:focus {
  outline: none;
  border-color: var(--accent-color, #58a6ff);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color, #58a6ff) 30%, transparent);
}
.dispose-fieldset .dispose-btn { margin-top: 0; }
.dispose-fieldset .dispose-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dispose-fieldset .hint[data-dispose-state="running"] {
  color: var(--accent-color, #58a6ff);
}
.dispose-fieldset .hint[data-dispose-state="done"] {
  color: var(--success-color, #3fb950);
}

/* Iteration tab styling for the final-report tab — distinct from
   numbered iteration tabs so the closing step reads as a milestone. */
.iteration-tab[data-final-report] {
  border-color: var(--success-color, #3fb950);
  color: var(--success-color, #3fb950);
}
.iteration-tab[data-final-report][aria-selected="true"] {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
  border-color: var(--success-color, #3fb950);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[data-final-report][aria-selected="true"]::before {
  content: "✓ ";
  color: var(--success-color, #3fb950);
}
.iteration-tab[data-final-report]:not([aria-selected="true"])::before {
  content: "";
}

/* Open-questions section — checkbox list with optional "[Issue #NNN]"
   linked badges once items have been routed to GitHub. */
section[data-open-questions] .open-questions-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
section[data-open-questions] .open-questions-list li {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  background: var(--bg-subtle, transparent);
}
section[data-open-questions] .open-questions-list label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  cursor: pointer;
}
section[data-open-questions] .open-questions-list input[type="checkbox"]:disabled + .oq-label {
  opacity: 0.7;
}
section[data-open-questions] .oq-issue-link {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 1px 6px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--success-color, #3fb950);
  border: 1px solid var(--success-color, #3fb950);
  border-radius: 4px;
  text-decoration: none;
}
section[data-open-questions] .oq-issue-link:hover {
  background: color-mix(in srgb, var(--success-color, #3fb950) 15%, transparent);
}
```

## State Persistence (localStorage + TTL)

Interactive element state MUST survive page reloads AND accidental tab closes
via `localStorage` with a time-to-live (TTL). This prevents the user from
losing selections, comments, and ratings.

**Storage key:** `concept-state-{slug}` (derived from the page's filename slug)
**TTL:** 24 hours — auto-clears stale state from previous days

```javascript
const STORAGE_KEY = 'concept-state-' + location.pathname.split('/').pop().replace('.html', '');
const STATE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function saveState() {
  const state = {
    _savedAt: Date.now(),
    _pageVersion: document.documentElement.dataset.pageVersion || ''
  };
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    if (el.name || el.id) state['input:' + (el.name || el.id) + ':' + el.value] = el.checked;
  });
  document.querySelectorAll('textarea, input[type="text"], input[type="number"]').forEach(el => {
    if (el.id || el.dataset.comment) state['text:' + (el.id || el.dataset.comment)] = el.value;
  });
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (el.id || el.name) state['range:' + (el.id || el.name)] = el.value;
  });
  document.querySelectorAll('select').forEach(el => {
    if (el.id || el.name) state['select:' + (el.id || el.name)] = el.value;
  });
  state['theme'] = document.documentElement.getAttribute('data-theme');
  // Persist the user-interacted flag so a reload while the user has unsaved
  // edits does not re-arm the empty-submit confirm dialog. Restored values
  // would otherwise look like "untouched defaults" because change/input
  // events fire from restoreState() (isTrusted=false) and are ignored.
  if (typeof _userInteracted !== 'undefined' && _userInteracted) {
    state['_userInteracted'] = true;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    if (state._savedAt && (Date.now() - state._savedAt) > STATE_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const currentVersion = document.documentElement.dataset.pageVersion || '';
    if (state._pageVersion && state._pageVersion !== currentVersion) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    // Preserve the user's prior interaction flag across reloads — see saveState().
    if (state._userInteracted && typeof _userInteracted !== 'undefined') {
      _userInteracted = true;
    }
    Object.entries(state).forEach(([key, value]) => {
      if (key.startsWith('_')) return;
      const [type, ...rest] = key.split(':');
      if (type === 'input') {
        const [name, val] = [rest.slice(0, -1).join(':'), rest[rest.length - 1]];
        const el = document.querySelector(`input[name="${name}"][value="${val}"], input[id="${name}"][value="${val}"]`);
        if (el) el.checked = value;
      } else if (type === 'text') {
        const id = rest.join(':');
        const el = document.querySelector(`[data-comment="${id}"]`) || document.querySelector(`textarea#${CSS.escape(id)}, input#${CSS.escape(id)}`);
        if (el) el.value = value;
      } else if (type === 'range') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
        if (el) { el.value = value; el.dispatchEvent(new Event('input')); }
      } else if (type === 'select') {
        const id = rest.join(':');
        const el = document.getElementById(id) || document.querySelector(`select[name="${id}"]`);
        if (el) el.value = value;
      }
    });
  } catch (e) { /* corrupt storage — ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  // Inject missing per-decision comment slots BEFORE restoring state so the
  // restored textarea values land on real DOM nodes. See § Comment Slot
  // Injection for why this safety net exists.
  if (typeof ensureCommentSlots === 'function') ensureCommentSlots();
  restoreState();
});
document.addEventListener('change', saveState);
document.addEventListener('input', saveState);
```

**Rules:**
- Use `localStorage` with a 24-hour TTL
- Save on every `change` and `input` event — not just on submit
- Restore runs on `DOMContentLoaded` — before the user sees the page
- `ensureCommentSlots()` runs IMMEDIATELY before `restoreState()` — see
  § Comment Slot Injection for the rationale (must inject the slots before
  the restore step rehydrates their values)
- The `concept-submitted` class is NOT persisted
- Theme preference IS persisted — prevents dark/light flash on reload

## Comment Slot Injection

Every Bi-State `[data-decision]` group SHOULD ship with an inline adjacent
`<textarea data-comment="$decisionId-note">` so the user can attach a
free-form override to their include/discard choice (e.g. "only for X",
"with variant Y", or any open question that does not fit a binary toggle).

Generated pages must emit the textarea inline. To upgrade older pages that
were generated before this rule existed — and as a runtime safety net if
Claude forgets to add it during a one-off generation — every concept page
also ships `ensureCommentSlots()`. It iterates over every `[data-decision]`
group and injects a textarea where one is missing. The function runs once
on `DOMContentLoaded` BEFORE `restoreState()` so the restore step can
rehydrate previously typed comments into the newly-injected nodes.

The catch-all `collectAllFormFields` picks up the textareas via
`data-comment` without any collector change (see § collectDecisions
dispatcher — the dispatcher already reads `el.dataset.comment` as a
fallback key).

```javascript
function ensureCommentSlots() {
  document.querySelectorAll('[data-decision]').forEach(group => {
    // Anchor: prefer the surrounding card/section so the textarea ends up
    // inside the same visual unit. Fall back to the group's parent if no
    // recognised wrapper exists.
    const card = group.closest('.pattern-card, .role-card, .variant-evaluation, section[id]')
              || group.parentElement;
    if (!card) return;

    // Skip if the card already has a comment slot — works for both inline
    // emission and prior runs of ensureCommentSlots().
    if (card.querySelector('textarea[data-comment]')) return;

    const id = (group.dataset.decision || group.id || '').trim();
    if (!id) return;  // unnamed group — nothing useful to key the textarea by
    const commentKey = id + '-note';

    const row = document.createElement('div');
    row.className = 'field-row decision-comment-row';

    const label = document.createElement('label');
    label.setAttribute('for', commentKey);
    label.textContent = '{{decision.comment_label}}';

    const ta = document.createElement('textarea');
    ta.id = commentKey;
    ta.dataset.comment = commentKey;
    ta.placeholder = '{{decision.comment_placeholder}}';
    ta.rows = 2;

    row.appendChild(label);
    row.appendChild(ta);

    // Insert right after the bi-state group when both share the same parent;
    // otherwise append to the card so the override is visually attached.
    if (group.nextSibling && group.parentNode === card) {
      group.parentNode.insertBefore(row, group.nextSibling);
    } else {
      card.appendChild(row);
    }
  });
}
```

**Notes:**
- `{{decision.comment_label}}` and `{{decision.comment_placeholder}}` MUST be
  replaced with the locale-resolved strings at generation time (see § UI Locale).
- `ensureCommentSlots()` is idempotent — re-running it does nothing once
  every group has a textarea, so it is safe to call multiple times (e.g.
  after a Claude-driven iteration append).
- Iteration appends MUST also call `ensureCommentSlots()` after the new
  section is inserted; the `DOMContentLoaded` hook only fires on full
  reloads. Either trigger it manually or rely on the next `/reload` POST
  which forces a `location.reload()`.

## collectDecisions (dispatcher)

The submit handler picks the branch from the **active iteration's**
`data-iteration-template` (via `resolveIterationTemplate()`, § Tab Switch JS),
not from the `<html data-template>` projection — that projection follows the
tab the user is *looking at* and would mis-route the payload when a frozen tab
of a different template is open. An `action` (`iterate` | `implement`) is passed in from the button that was
clicked and merged into the payload.

The dispatcher ALSO runs a generic catch-all scoped to the active
iteration (`section[data-iteration][data-active]`) so every named form
element ships in `allFields`, regardless of whether the template-specific
branch was updated for new fields. This is the safety net mandated by
`validation-gate.md` § Generic Form Collection — never remove it, never
replace it with hand-listed selectors. The typed sub-objects (`decisions`,
`comments`) live alongside `allFields` for ergonomics; they do not
substitute for it.

```javascript
function collectAllFormFields(scope) {
  const fields = {};
  // Catch-all: every named input, select, textarea inside scope.
  scope.querySelectorAll('input, select, textarea').forEach(el => {
    const key = el.dataset.field
             || el.dataset.v4
             || el.dataset.confirm
             || el.dataset.rename
             || el.dataset.entities
             || el.dataset.comment
             || el.name
             || el.id;
    if (!key) return;  // unnamed control — skip
    if (el.type === 'checkbox') {
      fields[key] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) fields[el.name] = el.value;
    } else {
      fields[key] = el.value;
    }
  });
  return fields;
}

function collectDecisions(action = 'iterate') {
  const active = document.querySelector('section[data-iteration][data-active]')
              || document.body;
  const allFields = collectAllFormFields(active);

  // Resolve the template from the ACTIVE iteration, never from <html>: the
  // projection there could be stale (e.g. the user is viewing a frozen tab
  // with a different layout) and would mis-route the payload.
  const template = resolveIterationTemplate(active);
  let payload;
  if (template === 'design') payload = collectDesignDecisions();
  else if (template === 'free') payload = collectFreeDecisions();
  else payload = collectDecisionDecisions();
  payload.action = action;
  payload.allFields = allFields;
  return payload;
}

function collectDecisionDecisions() {
  const decisions = [];
  const comments = [];

  document.querySelectorAll('[data-decision]').forEach(el => {
    decisions.push({
      id: el.dataset.decision,
      label: el.dataset.label || '',
      ...getElementState(el)
    });
  });

  document.querySelectorAll('[data-comment]').forEach(el => {
    if (el.value.trim()) {
      comments.push({
        id: el.dataset.comment,
        text: el.value.trim()
      });
    }
  });

  return { submitted: true, template: 'decision', decisions, comments };
}
```

## Two-Button Submit (iterate vs. implement)

Every decision panel carries **two** submit buttons, not one. The primary
button ("Zur nächsten Iteration") is always visible and fires
`action: "iterate"` — a Claude turn that never touches code. The secondary
button ("Mit Feedback implementieren") sits below a visible gap and fires
`action: "implement"` — a Claude turn that DOES apply real file/code
changes. The gap is mandatory so the user has to move the mouse
deliberately to reach the implement button.

### HTML

```html
<div id="panel-ready">
  <div id="decision-summary"><!-- auto-summary --></div>

  <!-- Primary: safe, never implements -->
  <button id="submit-iterate-btn" class="primary submit-btn">
    Zur nächsten Iteration
  </button>
  <p class="hint">
    Deine Auswahl geht an Claude für die nächste Iteration. Es wird kein Code geschrieben.
  </p>

  <!-- Mandatory gap so the user does not misclick -->
  <div class="submit-gap" aria-hidden="true"></div>

  <!-- Secondary: explicit implementation commit -->
  <button id="submit-implement-btn" class="implement-btn">
    <span class="warn-icon" aria-hidden="true">⚠</span>
    Mit Feedback implementieren
  </button>
  <p class="hint hint-warn">
    Claude setzt die Auswahl jetzt in echte Änderungen um.
  </p>
</div>
```

### CSS

```css
.submit-btn, .implement-btn {
  width: 100%;
  padding: 0.8rem 1rem;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  margin-top: 0.5rem;
}
.submit-btn {
  border: none;
  background: var(--accent-color, #58a6ff);
  color: white;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.submit-gap { height: 2rem; }

.implement-btn {
  background: transparent;
  color: var(--warning-color, #d29922);
  border: 1px solid var(--warning-color, #d29922);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.implement-btn:hover {
  background: color-mix(in srgb, var(--warning-color, #d29922) 15%, transparent);
}
.implement-btn .warn-icon { font-size: 1rem; }
.hint-warn { color: var(--warning-color, #d29922); }
```

### JS

```javascript
let _submittedAt = 0;
// Reload counter captured at submit time. The panel only flips back to
// "ready" via _processed_at when the server's reload counter has advanced
// past this — i.e. Claude has actually written the new iteration. Without
// this gate, /reset stamps _processed_at while Claude is still mid-write
// and the user sees re-enabled buttons on the still-active old iteration.
let _submittedReloadCounter = null;
let _submitInFlight = false;
// Action picked at submit time ("iterate" | "implement"). Drives whether
// the third progress step ("Implementierung abgeschlossen") is shown.
// Reset on restorePanelToReady.
let _submittedAction = null;
// Tracks whether the user has actually changed any field in the active
// iteration. restoreState() and DOMContentLoaded fire change/input events
// that are NOT user-driven, so we gate on event.isTrusted to ignore them.
// Reset to false on iteration-switch / reload — collectDecisions still
// ships the full payload, but submitWithAction asks for confirmation if
// the user clicks submit without having touched anything.
let _userInteracted = false;
function _markUserInteracted(e) {
  if (e && e.isTrusted) _userInteracted = true;
}
document.addEventListener('change', _markUserInteracted, true);
document.addEventListener('input', _markUserInteracted, true);
document.addEventListener('iteration:changed', () => { _userInteracted = false; });

const _emptyConfirmKey = {
  iterate: 'panel.empty_iterate_confirm',
  implement: 'panel.empty_implement_confirm'
};

function wireSubmit(btnId, action) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => submitWithAction(action));
}

async function submitWithAction(action) {
  // Belt-and-suspenders guard: if a submission is already in flight (panel
  // shows "submitted"), ignore further clicks. restorePanelToReady() resets
  // _submittedAt to 0, so this only blocks while we're actually waiting.
  if (_submitInFlight || _submittedAt) return;

  // Empty-submit guard: if the user clicks submit without having modified
  // any field in the active iteration, ask before sending. Avoids burning
  // a Claude turn on accidental clicks.
  if (!_userInteracted) {
    const msg = (action === 'implement')
      ? '{{panel.empty_implement_confirm}}'
      : '{{panel.empty_iterate_confirm}}';
    if (!window.confirm(msg)) return;
  }

  _submitInFlight = true;

  const data = collectDecisions(action);
  const container = document.getElementById('concept-decisions');
  container.textContent = JSON.stringify(data);
  // design template only: the feedback dock is a single overlay shared by
  // every iteration and its field ids repeat per iteration (`d1-s1`), so it
  // must be emptied once the payload is captured — otherwise the appended
  // iteration N+1 opens pre-filled with iteration N's notes and re-sends
  // them. Runs AFTER collectDecisions(), never before. See § Layout JS.
  if (typeof clearDock === 'function') clearDock();
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();
  _submittedAt = Date.now();
  _submittedReloadCounter = _bootReloadCounter;
  _submittedAction = action;

  // Reset progress list to the just-submitted baseline. The third step
  // is only revealed for implement-action submissions — iterate ends at
  // step 2 (panel reload onto the new iteration restores the ready panel).
  resetStatusSteps(action);

  document.getElementById('panel-ready').style.display = 'none';
  document.getElementById('panel-submitted').style.display = 'block';

  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (e) {
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(data));
  }
  saveState();
  _submitInFlight = false;
}

wireSubmit('submit-iterate-btn', 'iterate');
wireSubmit('submit-implement-btn', 'implement');

// --- Content dimmer (focus shifter after submit) ---
// After a submit the user's attention belongs on the decision panel / FAB,
// not on the now-frozen content. showContentDimmer reveals a fixed overlay
// over the content area; the panel + FABs sit at higher z-index and stay
// clear and clickable. The dimmer itself is click-to-dismiss — clicking
// anywhere on it removes `content-dimmed` and hides the overlay, letting
// the user re-engage with the content without losing the submitted state.
// On page reload (next iteration / final report) the body class is naturally
// gone, so no extra cleanup is needed.
function showContentDimmer() {
  const dim = document.getElementById('content-dimmer');
  if (dim) dim.hidden = false;
}
function hideContentDimmer() {
  const dim = document.getElementById('content-dimmer');
  if (dim) dim.hidden = true;
  document.body.classList.remove('content-dimmed');
}
document.getElementById('content-dimmer')
  ?.addEventListener('click', hideContentDimmer);
// Keyboard escape — keyboard-only users can't click the dimmer, so let
// Escape dismiss it. Only acts while the dimmer is actually visible.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const dim = document.getElementById('content-dimmer');
  if (dim && !dim.hidden) hideContentDimmer();
});

// --- Final-report "Issues erstellen" action ---
// Gating rules (only ALL of these true → panel visible + button enabled):
//   1. Active section carries data-final-report.
//   2. Active section contains a [data-open-questions] block.
//   3. That block has at least one un-created (still-checkable, not
//      disabled) checkbox.
//   4. At least one of those checkboxes is currently checked.
// On click: POST /decisions { action: "create-issues", items: [...] }
// then disable + show "running" hint. Claude rewrites the open-questions
// HTML with linked [Issue #NNN] labels and POSTs /reload — the reload
// re-enters this gating logic with disabled checkboxes, so the button
// auto-hides once all items are routed.
function updateCreateIssuesPanel() {
  const wrap = document.getElementById('panel-create-issues');
  const btn = document.getElementById('create-issues-btn');
  if (!wrap || !btn) return;
  const active = document.querySelector('section[data-iteration][data-active]');
  const isFinal = !!(active && active.hasAttribute('data-final-report'));
  const oqBlock = isFinal ? active.querySelector('[data-open-questions]') : null;
  const pendingBoxes = oqBlock
    ? oqBlock.querySelectorAll('input[type="checkbox"]:not(:disabled)')
    : [];
  const visible = isFinal && pendingBoxes.length > 0;
  wrap.hidden = !visible;
  if (!visible) return;
  const checked = Array.from(pendingBoxes).some(el => el.checked);
  btn.disabled = !checked;
  // Reset transient state hints whenever the gating recomputes (e.g.
  // after a reload that added Issue badges to some items).
  wrap.querySelectorAll('.hint[data-issues-state]').forEach(el => {
    el.hidden = el.dataset.issuesState !== 'none' || checked;
  });
}

async function submitCreateIssues() {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (!active || !active.hasAttribute('data-final-report')) return;
  const oqBlock = active.querySelector('[data-open-questions]');
  if (!oqBlock) return;

  const items = Array.from(
    oqBlock.querySelectorAll('input[type="checkbox"]:not(:disabled)')
  )
    .filter(el => el.checked)
    .map(el => {
      const labelEl = el.closest('label')?.querySelector('.oq-label');
      const labelText = labelEl ? labelEl.textContent.trim() : '';
      // description = explicit data-issue-body wins; otherwise the visible
      // .oq-label text. Either is enough for Claude to skip the
      // setup-issue AskUserQuestion path — the user has already
      // committed by clicking "Issues erstellen", we MUST NOT ask again.
      const body = el.dataset.issueBody || labelText;
      return {
        id: el.name || el.id || '',
        title: el.dataset.issueTitle || labelText,
        type: el.dataset.issueType || 'chore',
        description: body,
        // Optional project-specific label hints — picked up by Claude when
        // present, silently ignored when absent. Concept HTML is generated
        // by Claude, so these are populated from concept context.
        role: el.dataset.issueRole || null,
        module: el.dataset.issueModule || null,
        milestone: el.dataset.issueMilestone || null,
        selected: true
      };
    });

  const wrap = document.getElementById('panel-create-issues');
  const btn = document.getElementById('create-issues-btn');
  if (!items.length) {
    wrap?.querySelector('.hint[data-issues-state="none"]')
        ?.removeAttribute('hidden');
    return;
  }

  btn.disabled = true;
  wrap.querySelectorAll('.hint[data-issues-state]').forEach(el => {
    el.hidden = el.dataset.issuesState !== 'running';
  });

  // Always ship the current disposition state so Claude can apply Step 6
  // cleanup based on the user's choice. If the user only clicks
  // "Issues erstellen" and the disposition button never fires, this
  // payload still carries the disposition for cleanup.
  const payload = {
    submitted: true,
    action: 'create-issues',
    items,
    disposition: collectDisposition()
  };
  const container = document.getElementById('concept-decisions');
  if (container) container.textContent = JSON.stringify(payload);
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();

  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // Offline — queue alongside the regular pending submit so it retries
    // on reconnect via retryPendingSubmission().
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(payload));
  }
}

document.getElementById('create-issues-btn')
  ?.addEventListener('click', submitCreateIssues);

// --- Final-report "Concept beenden" / dispose-concept action ---
// Always available on the final-report panel. Submits the user's
// disposition choice (discard | keep | gitignore + optional moveTo) and
// signals Claude to run Step 6 cleanup. Independent from create-issues —
// the user may end the concept without ever creating issues, or click
// both in any order.
function collectDisposition() {
  const radio = document.querySelector('input[name="dispose-mode"]:checked');
  const moveEl = document.getElementById('dispose-move-to');
  const mode = radio ? radio.value : 'discard';
  const moveTo = (moveEl && moveEl.value.trim()) ? moveEl.value.trim() : null;
  return { mode, moveTo };
}

async function submitDisposeConcept() {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (!active || !active.hasAttribute('data-final-report')) return;

  const fs = document.getElementById('panel-dispose-concept');
  const btn = document.getElementById('dispose-concept-btn');
  if (!fs || !btn) return;

  btn.disabled = true;
  fs.querySelectorAll('.hint[data-dispose-state]').forEach(el => {
    el.hidden = el.dataset.disposeState !== 'running';
  });

  const payload = {
    submitted: true,
    action: 'dispose-concept',
    disposition: collectDisposition()
  };
  const container = document.getElementById('concept-decisions');
  if (container) container.textContent = JSON.stringify(payload);
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();

  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(payload));
  }
}

document.getElementById('dispose-concept-btn')
  ?.addEventListener('click', submitDisposeConcept);

// --- Final-report "Shippen" action ---
// Primary CTA of the persistent status channel. Available whenever the
// final-report section is live (implementation done). Clicking it is an
// EXPLICIT user commit — like "Mit Feedback implementieren" it authorises a
// real, outward-facing action — so Claude runs the full ship pipeline on
// pickup (SKILL.md Step 5b · ship branch). Ships the current disposition too
// so Step 6 cleanup still runs after the release lands.
async function submitShip() {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (!active || !active.hasAttribute('data-final-report')) return;

  const btn = document.getElementById('ship-btn');
  const wrap = document.getElementById('status-channel');
  if (!btn || !wrap) return;

  btn.disabled = true;
  wrap.querySelectorAll('.hint[data-ship-state]').forEach(el => {
    el.hidden = el.dataset.shipState !== 'running';
  });

  const payload = {
    submitted: true,
    action: 'ship',
    disposition: collectDisposition()
  };
  const container = document.getElementById('concept-decisions');
  if (container) container.textContent = JSON.stringify(payload);
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();

  try {
    await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    localStorage.setItem(STORAGE_KEY + '-pending', JSON.stringify(payload));
  }
}

document.getElementById('ship-btn')?.addEventListener('click', submitShip);

// "Iterationen ansehen" — non-committal, client-only. Scrolls the iteration
// tab bar into view and flashes it so the user can revisit earlier iterations
// / the agenda without leaving the final report. The ship CTA stays put — the
// whole point of the persistent channel is that there is nothing to re-open.
document.getElementById('view-iterations-btn')?.addEventListener('click', () => {
  const tabs = document.querySelector('.iteration-tabs');
  if (!tabs) return;
  tabs.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  tabs.classList.remove('tabs-nudge');
  void tabs.offsetWidth;  // force reflow so the animation restarts
  tabs.classList.add('tabs-nudge');
});

// Recompute gating whenever the user toggles a checkbox inside the
// open-questions section. The generic change listener (for saveState)
// fires the same event, so we just hook into the same channel.
document.addEventListener('change', e => {
  if (e.target && e.target.matches('section[data-open-questions] input[type="checkbox"]')) {
    updateCreateIssuesPanel();
  }
});
document.addEventListener('DOMContentLoaded', updateCreateIssuesPanel);

// --- Offline Submit Queue ---
async function retryPendingSubmission() {
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending
    });
    if (res.ok) localStorage.removeItem(pendingKey);
  } catch (e) { /* still offline */ }
}
```

Claude-side: on receiving the payload, branch on `action`:
- `iterate` → Step 5b iterate branch: summarize + append next iteration only
- `implement` → Step 5b implement branch: actually write code/files, then
  append the final-report section (frozen "implementiert" record)
- `create-issues` → Step 5b create-issues branch: user-value gate + `gh issue create`
- `ship` → Step 5b ship branch: run the full ship pipeline (`/ship`),
  then mark the final report shipped and run Step 6 cleanup
- `dispose-concept` → Step 5b dispose branch: record disposition, run Step 6

## Panel State Reset

The primary reset is the page reload itself: Claude POSTs `/reload` after
writing the new iteration, the browser's `pollReload` calls
`location.reload()`, and the freshly loaded page is in ready state because
the `concept-submitted` class is not persisted.

`restorePanelToReady()` is a safety-net — only called when `_processed_at`
indicates Claude finished AND a reload counter advance has been observed
(i.e. a reload is imminent / about to happen) OR a long stale timeout has
elapsed (recovery for closed tabs / JS errors where reload never fired).

```javascript
function restorePanelToReady() {
  document.getElementById('panel-submitted').style.display = 'none';
  document.getElementById('panel-ready').style.display = 'block';
  ['submit-iterate-btn', 'submit-implement-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = false;
  });
  document.body.classList.remove('concept-submitted', 'content-dimmed');
  hideContentDimmer();
  _submittedAt = 0;
  _submittedReloadCounter = null;
  _submitInFlight = false;
  _submittedAction = null;
  const slug = location.pathname.split('/').pop().replace('.html', '');
  localStorage.removeItem('concept-state-' + slug);
}
```

## Submit Progress Steps

The submitted panel renders a three-step progress list so the user can
see exactly where the submission is in Claude's pipeline. The states the
list tracks:

| Step | Trigger | Visible? |
|---|---|---|
| 1 · Übermittelt | The user just clicked submit (POST /decisions succeeded) | Always |
| 2 · Claude verarbeitet | First `/pending=true` response on the server (Claude's cron picked up the submission) — surfaces via `_picked_up_at` in `/decisions` | Always |
| 3 · Implementierung abgeschlossen | Claude POSTs `/status {phase: "implemented"}` after the implement branch finishes — surfaces via `_phase === "implemented"` in `/decisions` | Only for `action: "implement"` submissions |

The browser only writes step state in `submitWithAction` (reset to baseline)
and in `updateStatusSteps` (advance based on server fields). After
`/reload` lands, the freshly loaded page is in ready state, so the steps
naturally reset for the next submission.

```javascript
// Lookup helper — every step access goes through this.
function _stepEl(name) {
  return document.querySelector('#status-steps li[data-step="' + name + '"]');
}

function _setStep(name, state, icon) {
  const li = _stepEl(name);
  if (!li) return;
  li.dataset.state = state;
  const iconEl = li.querySelector('.step-icon');
  if (iconEl && icon) iconEl.textContent = icon;
}

// Baseline shown immediately after a submit click. Step 1 done, step 2
// active (waiting for /pending pickup), step 3 either hidden (iterate)
// or pending-and-visible (implement).
function resetStatusSteps(action) {
  _setStep('submitted', 'done', '✓');
  _setStep('received', 'active', '⏳');
  const impl = _stepEl('implemented');
  if (impl) {
    impl.hidden = (action !== 'implement');
    impl.dataset.state = 'pending';
    const iconEl = impl.querySelector('.step-icon');
    if (iconEl) iconEl.textContent = '○';
  }
}

// Called from pollProcessedState on every tick. Idempotent — re-applying
// the same server state is a no-op.
function updateStatusSteps(data) {
  if (!_submittedAt) return;
  if (data && data._picked_up_at) {
    const recv = _stepEl('received');
    if (recv && recv.dataset.state !== 'done') {
      _setStep('received', 'done', '✓');
      // If implement is the queued action, the third step now becomes
      // the active waiter. For iterate, step 3 stays hidden and the
      // /reload-driven page reload is the implicit "done".
      if (_submittedAction === 'implement') {
        const impl = _stepEl('implemented');
        if (impl && !impl.hidden && impl.dataset.state === 'pending') {
          _setStep('implemented', 'active', '⏳');
        }
      }
    }
  }
  if (data && data._phase === 'implemented' && _submittedAction === 'implement') {
    // implemented implies received — if /status arrives before the cron's
    // /pending=true has stamped _picked_up_at (rare but possible: Claude
    // POSTed /status before its first /pending fetch landed), step 2 must
    // still flip to done so the list stays monotonically consistent.
    const recv = _stepEl('received');
    if (recv && recv.dataset.state !== 'done') {
      _setStep('received', 'done', '✓');
    }
    const impl = _stepEl('implemented');
    if (impl && !impl.hidden && impl.dataset.state !== 'done') {
      _setStep('implemented', 'done', '✓');
    }
  }
}
```

## Theme Toggle

```javascript
document.getElementById('theme-toggle').addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
});
```

## Claude Connection Heartbeat (HTTP Bridge)

The server response splits the heartbeat into TWO timestamps:

- `claude_ts` — last `POST /heartbeat` from Claude (the polling cron is alive
  and Claude will pick up submissions). This is the field the indicator must
  gate on.
- `server_ts` — daemon-thread self-pulse (the bridge process is alive). The
  GREEN/connected state still gates exclusively on `claude_ts` — `server_ts`
  is never sufficient to show "connected". It is used to distinguish the
  bootstrap window (`claude_ts==0`, server alive → "connecting" indefinitely)
  from a genuinely dead bridge (`server_ts` stale → disconnected warning).
- `ts` — legacy alias of `claude_ts` for back-compat with older pages that
  pre-date the split. Always equal to `claude_ts` on a current server.

Gating on `server_ts` would keep the indicator green even after Claude's
session restarts (cron is session-only and dies with the session) — silently
hiding the case where submissions fall into a black hole. The bug that
motivated the split: `_heartbeat_ts` used to be a single field that the
self-pulse refreshed every 30s, so the page showed "Claude verbunden"
indefinitely no matter what Claude was actually doing.

```javascript
const HEARTBEAT_STALE_MS = 90000;  // claude_ts older than this → dead cron
const SERVER_STALE_MS    = 90000;  // server_ts older than this → bridge process down
// HEARTBEAT_GRACE_MS / _pageLoadedAt removed — the bootstrap window is now
// keyed on claude_ts==0 && fresh server_ts (mirrors the concept-server
// watchdog, which tolerates claude_ts==0 indefinitely), not a fixed timer.
let _lastHeartbeatTs = 0;
let _lastServerTs    = 0;
// True once /heartbeat has returned a parseable response at least once. Until
// then the connection state is treated as "connecting" (unknown), NEVER
// "disconnected" — this is the fix for the fresh-page connect→disconnect→
// connect flash: before the first poll lands, _lastServerTs is still 0, so the
// old code mis-classified the unknown window as a dead bridge.
let _everPolled      = false;

async function pollHeartbeat() {
  try {
    const res = await fetch('/heartbeat', { cache: 'no-store' });
    const data = await res.json();
    // Prefer `claude_ts` (post-split server); fall back to `ts` for
    // back-compat with legacy server builds that only expose the merged field.
    // NEVER use `server_ts` here — the daemon self-pulse would falsely
    // light up the indicator while Claude's polling cron is dead.
    _lastHeartbeatTs = data.claude_ts || data.ts || 0;
    // Consumed by checkClaudeConnection to tell the bootstrap window
    // (claude_ts==0, server alive → "connecting") apart from a dead bridge.
    // NEVER drives the green/connected state — that still gates on claude_ts.
    // Legacy servers without server_ts leave this 0 → serverAlive=false → the
    // bootstrap path is inert and behavior falls back to the old timing.
    _lastServerTs = data.server_ts || 0;
    _everPolled = true;   // we now have real evidence of the bridge state
  } catch (e) { /* server unreachable — leave _everPolled unchanged */ }
}

// Safety-net timeout — if Claude /reset stamped _processed_at but no
// reload counter advance ever followed (closed tab, JS error, server
// went down between /reload and /reset), we still want to recover the
// panel rather than leaving the user stuck staring at "submitted".
// 5 minutes is long enough that any well-behaved iteration will have
// reloaded the page first, and short enough that a real stuck state
// recovers without manual intervention.
const PROCESSED_SAFETY_MS = 5 * 60 * 1000;

async function pollProcessedState() {
  if (!_submittedAt) return;
  try {
    const res = await fetch('/decisions', { cache: 'no-store' });
    const data = await res.json();
    // Advance the submit-panel progress list based on the per-submission
    // signals on the server. Done before the processed_at gate so the
    // user sees pickup/implementation states even while the panel is
    // still in the submitted state (i.e. before /reset).
    updateStatusSteps(data);
    const processedIso = data && data._processed_at;
    if (!processedIso) return;
    const processedMs = Date.parse(processedIso);
    if (!Number.isFinite(processedMs) || processedMs <= _submittedAt) return;

    // _processed_at IS newer than submission. Two paths to actually
    // restore the panel:
    //   (a) The reload counter has advanced past submit-time → Claude
    //       wrote a new iteration; pollReload will trigger location.reload()
    //       within 3s. Restoring eagerly here is a no-op visually but
    //       cleans local state.
    //   (b) A long safety timeout elapsed → reload never fired (closed
    //       tab, JS error, network blip); recover so the user is not
    //       stuck on a frozen "submitted" panel.
    // Otherwise: Claude is mid-processing (e.g. /reset arrived but file
    // write + /reload is still pending, or the protocol order was wrong).
    // Keep the panel in "submitted" state so the user cannot duplicate-
    // submit on the still-active old iteration.
    let reloadAdvanced = false;
    try {
      const r2 = await fetch('/reload', { cache: 'no-store' });
      if (r2.ok) {
        const { counter } = await r2.json();
        reloadAdvanced = (_submittedReloadCounter !== null) &&
                         (counter > _submittedReloadCounter);
      }
    } catch (_) { /* ignore — fall back to safety timer */ }

    const longStale = (Date.now() - _submittedAt) > PROCESSED_SAFETY_MS;
    if (reloadAdvanced || longStale) {
      restorePanelToReady();
    }
  } catch (e) { /* retry next tick */ }
}

function _setCacheHints(visible) {
  document.querySelectorAll('[data-cache-hint]').forEach(el => {
    el.hidden = !visible;
  });
}

function checkClaudeConnection() {
  const now = Date.now();

  // Connected: Claude has pinged AND that ping is recent. (gate unchanged —
  // never gates on server_ts, or a dead cron would read green forever.)
  const isConnected = _lastHeartbeatTs && (now - _lastHeartbeatTs) < HEARTBEAT_STALE_MS;

  // Server liveness via the daemon self-pulse. Mirrors the concept-server
  // watchdog: claude_ts==0 is the legitimate bootstrap window, tolerated
  // indefinitely while server_ts proves the bridge is alive.
  const serverAlive = _lastServerTs && (now - _lastServerTs) < SERVER_STALE_MS;

  // "connecting" covers TWO not-connected-but-not-dead windows — NEITHER may
  // be classified as disconnected:
  //   (a) !_everPolled — no /heartbeat response has come back yet (the first
  //       ~1 network RTT after load). Calling this disconnected IS the
  //       fresh-page connect→disconnect→connect flash; it is "connecting".
  //   (b) claude_ts==0 while server_ts is fresh — Claude has never pinged but
  //       the bridge is alive; the first cron tick (<=60s) or the setup-time
  //       POST flips us to connected.
  const bootstrapping = !_everPolled || ((_lastHeartbeatTs === 0) && serverAlive);

  const state = isConnected ? 'connected'
              : bootstrapping ? 'connecting'
              : 'disconnected';

  const pill = document.getElementById('connection-status');
  const btns = ['submit-iterate-btn', 'submit-implement-btn']
    .map(id => document.getElementById(id)).filter(Boolean);
  const panelSubmitted = document.getElementById('panel-submitted');

  // While the submitted panel is up, leave the ready-panel controls frozen
  // (the pill lives inside #panel-ready, which is hidden then anyway).
  if (panelSubmitted && panelSubmitted.style.display !== 'none') return;

  // Drive the inline pill: [data-state] toggles colors + the dot/ellipsis
  // animation, and the label matches. Purely informational — never a blocker.
  if (pill) {
    pill.dataset.state = state;
    const label = pill.querySelector('.conn-label');
    if (label) {
      label.textContent = state === 'connected'    ? '{{panel.connected_title}}'
                        : state === 'disconnected' ? '{{panel.disconnected_title}}'
                        :                            '{{panel.connecting_title}}';
    }
  }

  // Submit buttons stay ENABLED in every state. A disconnected click is not a
  // black hole: the POST either lands on the live bridge (picked up when
  // Claude's cron next polls) or, if the server is down, throws and is cached
  // in localStorage, then auto-delivered by retryPendingSubmission on
  // reconnect. The per-button cache hint shows only while disconnected so the
  // user knows the click will be queued rather than lost.
  _setCacheHints(state === 'disconnected');
  btns.forEach(b => { b.disabled = false; });

  if (isConnected) retryPendingSubmission();
}

// Kick an immediate heartbeat poll on load so the pill resolves to
// "connected" within one network RTT instead of sitting on "connecting" for
// the full 5 s interval. The shorter the connecting window, the less the user
// notices the bootstrap at all.
pollHeartbeat().then(checkClaudeConnection);

setInterval(async () => {
  await pollHeartbeat();
  checkClaudeConnection();
  await pollProcessedState();
}, 5000);
```

**Claude-side heartbeat** (executed by Claude via Bash or CronCreate):
```bash
curl -s -X POST http://localhost:{port}/heartbeat
```

## Iteration Tabs

Iterations of a concept page are appended as `<section data-iteration="N">`
blocks inside the same HTML file. The tab bar lives **at the top of the
right-side decision panel** (a compact vertical chip list, rendered above
the section TOC and submit block). All three templates support iterations —
design and free include them identically.

### Tab Bar HTML

```html
<nav class="iteration-tabs" role="tablist" aria-label="Iterationen">
  <button class="iteration-tab" role="tab"
          data-iteration="1" aria-selected="false" aria-controls="iter-1">
    Iteration 1
  </button>
  <button class="iteration-tab" role="tab"
          data-iteration="2" aria-selected="false" aria-controls="iter-2">
    Iteration 2
  </button>
  <!-- Final-report tab: same DOM contract (data-iteration carries the
       running counter), distinct labelling + the data-final-report
       flag so .iteration-tab[data-final-report] CSS + panel JS pick
       it up. The label is the locale string {{iteration.final_tab}},
       NEVER "Iteration N". Only the implement-action path appends
       this — at most one per concept session. -->
  <button class="iteration-tab" role="tab" data-final-report
          data-iteration="3" aria-selected="true" aria-controls="iter-3">
    {{iteration.final_tab}}
  </button>
</nav>

<main>
  <section id="iter-1" data-iteration="1" hidden>…frozen round 1…</section>
  <section id="iter-2" data-iteration="2" hidden>…frozen round 2…</section>
  <section id="iter-3" data-iteration="3" data-final-report data-active>
    …final report (Abschlussbericht)…
  </section>
</main>
```

Rules:
- Exactly one section carries `data-active`. The matching tab has
  `aria-selected="true"`.
- Non-active sections get the `hidden` attribute AND are frozen
  (see "Freezing Past Iterations").
- Tabs stay clickable — switching tab reveals the chosen section and
  hides all others.
- A concept session has **at most one** `data-final-report` section.
  Once it exists, no further iterate/implement submissions are
  accepted (the panel-final-report has no such buttons). Only
  `action: "create-issues"` may still fire from the final-report tab.

### Tab Bar CSS

```css
.iteration-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color, #30363d);
}
.iteration-tab {
  flex: 0 0 auto;
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  background: var(--bg-subtle, transparent);
  color: var(--text-secondary, #8b949e);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.iteration-tab:hover {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 10%, transparent);
  color: var(--text-color, #c9d1d9);
}
.iteration-tab[aria-selected="true"] {
  background: color-mix(in srgb, var(--accent-color, #58a6ff) 15%, transparent);
  color: var(--text-color, #c9d1d9);
  border-color: var(--accent-color, #58a6ff);
  font-weight: 600;
}
.iteration-tab[aria-selected="true"]::before {
  content: "● ";
  color: var(--accent-color, #58a6ff);
}
section[data-iteration]:not([data-active]) {
  opacity: 0.85;
}
section[data-iteration]:not([data-active]) .tri-state-btn,
section[data-iteration]:not([data-active]) input,
section[data-iteration]:not([data-active]) textarea,
section[data-iteration]:not([data-active]) select {
  pointer-events: none;
  filter: grayscale(0.4);
}
```

### Freezing Past Iterations

When appending iteration N+1, Claude must freeze the previous section:

1. Remove `data-active`, add `hidden` to the previous `<section>`.
2. On every `input`, `textarea`, `select`, `button` inside it: set `disabled`.
3. On every `textarea`, `input[type="text"]`: set `readonly`.
4. For bi-state buttons: keep the `aria-pressed`/selected class exactly as
   the user submitted it — do NOT clear selections.
5. Add a small "Eingefroren — Iteration N" banner at the top (optional).

### Tab Switch JS

```javascript
// Resolve the template of ONE iteration section. Authoritative source is
// data-iteration-template; `prototype` is the legacy alias of `design`;
// a missing attribute falls back to the current <html data-template> so
// pages generated before per-iteration templates behave exactly as before.
function resolveIterationTemplate(section) {
  const raw = (section && section.dataset && section.dataset.iterationTemplate)
    || document.documentElement.dataset.template
    || 'decision';
  return raw === 'prototype' ? 'design' : raw;
}

// Project the shown iteration's template onto <html> and lock/unlock body
// scroll. Everything else (layout, panel docking, FABs, dock) is pure CSS off
// [data-template="design"] — no per-iteration layout code beyond these two
// lines. Called FIRST from showIteration().
function applyIterationTemplate(section) {
  const template = resolveIterationTemplate(section);
  document.documentElement.dataset.template = template;
  document.body.style.overflow = template === 'design' ? 'hidden' : '';
  return template;
}

function showIteration(n) {
  // MUST run first: the layout must be correct before buildSectionNav() or
  // any iteration:changed listener measures/renders against it.
  applyIterationTemplate([...document.querySelectorAll('section[data-iteration]')]
    .find(sec => String(sec.dataset.iteration) === String(n)));
  document.querySelectorAll('section[data-iteration]').forEach(sec => {
    const match = String(sec.dataset.iteration) === String(n);
    sec.hidden = !match;
  });
  document.querySelectorAll('.iteration-tab').forEach(tab => {
    const match = String(tab.dataset.iteration) === String(n);
    tab.setAttribute('aria-selected', match ? 'true' : 'false');
  });
  const activeSec = document.querySelector('section[data-iteration][data-active]');
  const isLive = activeSec && String(activeSec.dataset.iteration) === String(n);
  // The live section may be a regular iteration OR a final report. The
  // panel switches between three live states (ready / submitted / final)
  // plus the frozen state for non-live tabs.
  const isFinal = isLive && activeSec.hasAttribute('data-final-report');
  document.body.classList.toggle('viewing-frozen', !isLive);
  document.body.classList.toggle('viewing-final', !!isFinal);
  const panelReady = document.getElementById('panel-ready');
  const panelSubmitted = document.getElementById('panel-submitted');
  const panelFrozen = document.getElementById('panel-frozen');
  const panelFinal = document.getElementById('panel-final-report');
  if (panelReady) panelReady.style.display = (isLive && !isFinal) ? 'block' : 'none';
  if (panelSubmitted) {
    const submitted = document.body.classList.contains('concept-submitted');
    panelSubmitted.style.display = (isLive && !isFinal && submitted) ? 'block' : 'none';
  }
  if (panelFinal) panelFinal.style.display = isFinal ? 'block' : 'none';
  if (panelFrozen) panelFrozen.style.display = isLive ? 'none' : 'block';
  if (typeof buildSectionNav === 'function') buildSectionNav();
  if (typeof updateCreateIssuesPanel === 'function') updateCreateIssuesPanel();
  document.dispatchEvent(new CustomEvent('iteration:changed'));
}

document.querySelectorAll('.iteration-tab').forEach(tab => {
  tab.addEventListener('click', () => showIteration(tab.dataset.iteration));
});

document.addEventListener('DOMContentLoaded', () => {
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active) showIteration(active.dataset.iteration);
});
```

### Reload Polling

A Claude-driven reload (next iteration / final-report append) MUST land the
user at the top of the page. Without this, the browser restores the previous
scroll position — the user submitted from the bottom of the decision panel,
sees the page "do nothing" visually, and only notices the change because the
iteration tab moved. The sessionStorage flag scopes the jump to reloads we
triggered, so manual F5 while reading still preserves scroll position.

The `counter > _bootReloadCounter` comparison is restart-safe without any
client logic: the server seeds its in-memory counter from epoch milliseconds
(#225), so a restarted bridge always reports a counter ahead of anything the
previous run handed out. An open tab sees the restart as a normal advance and
force-reloads once — the desired re-sync after Claude re-launched the bridge
mid-session.

```javascript
let _bootReloadCounter = null;
async function pollReload() {
  try {
    const res = await fetch('/reload', { cache: 'no-store' });
    if (!res.ok) return;
    const { counter } = await res.json();
    if (_bootReloadCounter === null) { _bootReloadCounter = counter; return; }
    if (counter > _bootReloadCounter) {
      // Tag the reload as Claude-driven so the fresh load jumps to top.
      try { sessionStorage.setItem('_concept_jumpTop', '1'); } catch (_) {}
      location.reload();
    }
  } catch (e) { /* bridge offline */ }
}
setInterval(pollReload, 3000);
document.addEventListener('DOMContentLoaded', pollReload);

// Disable the browser's scroll restoration for Claude-driven reloads and
// force scroll to top. Runs before any layout-affecting init, and again on
// `load` to win against late restorations on slower browsers.
(function () {
  let pending = false;
  try { pending = sessionStorage.getItem('_concept_jumpTop') === '1'; } catch (_) {}
  if (!pending) return;
  try { sessionStorage.removeItem('_concept_jumpTop'); } catch (_) {}
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const jump = () => window.scrollTo(0, 0);
  jump();
  document.addEventListener('DOMContentLoaded', jump);
  window.addEventListener('load', jump);
})();
```

## Final Report Panel

The final-report section closes a concept session. It is appended via the
implement-action branch of Step 5b (see `SKILL.md` § Final-report append).
The right-side panel automatically switches to `panel-final-report` mode
when `showIteration()` detects `data-final-report` on the active section
— no iterate / implement buttons. Instead it leads with the **persistent
status channel** (`#status-channel`): the full pipeline recap (Übermittelt →
verarbeitet → implementiert → Bereit) topped by the primary **🚀 Shippen**
CTA and a non-committal "Iterationen ansehen" link. Below that sit the
optional "Issues erstellen" button (gated on open questions / TODOs) and the
always-visible disposition fieldset.

The status channel is deliberately **DOM-driven, not connection-driven**: it
is present because the section carries `data-final-report`, so it survives
reloads and stays fully visible even when the Claude heartbeat is stale. This
is the design reason it replaces a transient completion overlay — the ship
affordance must never vanish just because the connection flickered. Reviewing
earlier iterations (via the ever-present tab bar or the "Iterationen ansehen"
nudge) never hides the ship CTA, so there is nothing to "re-open".

### Final-report section HTML

The body of the section is structured like a multi-section freeform
report — every `<section id data-nav-label>` inside it surfaces in the
section TOC automatically. Open questions / TODOs use a dedicated
`<section data-open-questions>` wrapper around a checkbox list.

```html
<section id="iter-3" data-iteration="3" data-final-report data-active>
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
       Each <li> is one item; data-issue-* attributes feed the
       "Issues erstellen" payload directly so Claude can call
       `gh issue create` end-to-end without ever asking the user a
       follow-up question. Mandatory attrs: data-issue-title,
       data-issue-type. Recommended: data-issue-body (richer description
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
                 checked>
          <span class="oq-label">Auth fails for SAML users — observed during smoke test, out of scope here</span>
        </label>
      </li>
      <li>
        <label>
          <input type="checkbox"
                 name="oq-docs-refresh"
                 data-issue-title="[DOCS] Update auth README"
                 data-issue-type="docs"
                 data-issue-body="auth/README.md still describes the old middleware contract (session-token cookie). Update to reflect the new bearer-token flow shipped under the auth-middleware-redesign concept."
                 data-issue-module="auth"
                 checked>
          <span class="oq-label">Update auth README to reflect new middleware contract</span>
        </label>
      </li>
    </ul>
  </section>

  <section id="next-steps" data-nav-label="Nächste Schritte">
    <h3>Nächste Schritte</h3>
    <ul>
      <li>Performance-Profiling unter Last (siehe offene Frage oben)</li>
    </ul>
  </section>
</section>
```

### Open-questions item attributes

The first three attributes are MANDATORY for the auto-issue pipeline.
Without them Claude has no way to land a complete `gh issue create` call
and would have to fall back to interactive prompting — which is exactly
the regression we are designing against. Generate them when you author
the final-report block; do not leave the user to fill them in.

| Attribute | Required? | Purpose |
|---|---|---|
| `name` (or `id`) | yes | Stable identifier reused in the `create-issues` payload's `item.id` |
| `data-issue-title` | yes | Verbatim title used by `gh issue create` (`[TYPE] Imperative title`). Without this the payload's `title` falls back to the visible `.oq-label` text, which usually breaks the title-format gate |
| `data-issue-type` | yes | Maps to the issue label (`bug`, `feature`, `refactor`, `chore`, `docs`, `design`). Defaults to `chore` if omitted — set it explicitly |
| `data-issue-body` | recommended | Multi-sentence description used as the GitHub issue body. Falls back to the `.oq-label` text when missing — that is usually too terse for a tracked issue. Always populate this with the concept-context the user would need to act on the issue cold (repro steps for bugs, motivation for refactors, etc.) |
| `data-issue-role` | optional | Project-specific role label hint (`backend`, `frontend`, `infra`, …). Picked up when the project's `setup-issue` extension defines `role:*` labels; silently ignored otherwise |
| `data-issue-module` | optional | Project-specific module label hint (`auth`, `ingest`, `ui-core`, …). Same gating as `role` |
| `data-issue-milestone` | optional | Milestone name to attach. Claude will only honor this if the milestone already exists; never auto-creates one from this attribute |
| `checked` | default `true` | User opts out, not in |
| `disabled` | set by Claude | Added after the item has been routed (becomes `[Issue #NNN]`) so the gating logic in `updateCreateIssuesPanel()` ignores it on the next reload |

### After issues are created — HTML rewrite pattern

When Claude processes `action: "create-issues"`, the response loop
rewrites each routed `<li>` so the user sees the resulting issue
number + link. The checkbox stays in the DOM but is disabled, which
keeps `restoreState()` consistent across reloads:

```html
<li>
  <label>
    <input type="checkbox"
           name="oq-saml-edge"
           data-issue-title="[BUG] Auth fails for SAML users"
           data-issue-type="bug"
           checked disabled>
    <span class="oq-label">Auth fails for SAML users — observed during smoke test, out of scope here</span>
    <a class="oq-issue-link"
       href="https://github.com/{owner}/{repo}/issues/123"
       target="_blank"
       rel="noopener noreferrer">{{final.issue_link_prefix}} #123</a>
  </label>
</li>
```

Once every `<li>` in the section is `disabled`, `updateCreateIssuesPanel()`
hides the "Issues erstellen" button automatically — the section becomes a
read-only audit log of what was routed.

### Panel gating rules

`updateCreateIssuesPanel()` (see § Two-Button Submit) recomputes on:
- `DOMContentLoaded`
- `iteration:changed` (via `showIteration()`)
- any `change` event on a `[data-open-questions] input[type="checkbox"]`

The panel is **visible** iff all of:
1. Active section has `data-final-report`.
2. Active section contains a `[data-open-questions]` block.
3. That block has at least one `:not(:disabled)` checkbox.

The button is **enabled** iff additionally at least one of those
checkboxes is currently checked.

Both gates run client-side only — Claude never enables/disables the
button via the bridge; instead it controls visibility indirectly by
disabling checkboxes when it writes the issue-routed HTML.

### Disposition Control

The disposition fieldset (`#panel-dispose-concept`) is **always visible**
when the panel is in `panel-final-report` mode — it is not gated on
open-questions content. Its three radios + optional `moveTo` text input
drive Step 6 cleanup behaviour. The user chooses how the concept files
should land on disk before closing the session.

**Disposition modes:**

| `mode` | Step 6 cleanup behaviour |
|---|---|
| `discard` *(default)* | Delete the concept HTML AND the matching `-decisions.json` from `docs/concepts/`. |
| `keep` | Leave the files in place (or under `moveTo` if set). They remain git-tracked. |
| `gitignore` | Leave the files in place (or under `moveTo` if set) AND append `docs/concepts/{slug}.*` (or the moved path glob) to the repo's `.gitignore` if not already covered. |

**Optional `moveTo` (string):** the user may type a target directory
(e.g. `docs/architecture/decisions/`). When set, Claude `mv`s both the
HTML file AND the decisions JSON to that directory FIRST, then applies
the `mode` semantics. Empty / whitespace-only input is treated as null.

**Payload shape:**

```json
{ "mode": "discard" | "keep" | "gitignore", "moveTo": "docs/architecture/" | null }
```

Both `create-issues` and `dispose-concept` payloads carry the same
`disposition` sub-object. The contract is documented in `SKILL.md`
§ Step 6 — Cleanup-By-Disposition.

**Backward compatibility:** old concept sessions that submitted a
`create-issues` payload without a `disposition` field, or any submission
that ended the session before this control existed, default to
`disposition: { mode: "discard", moveTo: null }`. The default is
intentionally aggressive — most one-shot refinements do not need to
persist the HTML in git, and a stray opt-out is cheaper to fix
(re-render or check-in manually) than a stale concept directory full of
forgotten artefacts.

### `submitCreateIssues` + `submitDisposeConcept` interplay

The two final-report submissions are independent and may fire in any
order, including just one of them:

- **Issues only** — user clicks "Issues erstellen" with checked items.
  Payload `action: "create-issues"` carries `items[]` + `disposition`.
  Claude routes issues per Step 5b § create-issues branch, then runs
  Step 6 cleanup with the bundled disposition.
- **Dispose only** — user clicks "Concept beenden" without ever
  touching the issue list (or there is no `[data-open-questions]`
  block at all). Payload `action: "dispose-concept"` carries only
  `disposition`. Claude skips issue routing and runs Step 6 cleanup
  directly.
- **Issues then dispose** — both fire in sequence. Step 6 runs after
  the second submission with the latest disposition state. Issue
  routing is not repeated.

A `disposition` payload is **never replayed** — once Step 6 has been
applied, subsequent payloads (e.g. an offline-queue replay) are
ignored on the server side by the standard `_version` mismatch guard.

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
