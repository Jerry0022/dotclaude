# Concept HTML Templates

Three **templates** (layout modes) cover every concept use case. A template is
picked **per iteration**, not per page — see § Per-Iteration Templates below:

| Template | Layout | When to use |
|---|---|---|
| **decision** | Sidebar (~80/~20), multi-variant cards | Multi-option evaluation, trade-offs, architecture or tech decisions — the canonical "pick one" flow with bi-state (Verwerfen / Miteinbeziehen) per variant and multiple iterations |
| **design** | Fullscreen content + overlay decision panel (☰ FAB top-right, collapsed by default) + speech-bubble feedback dock anchored to the 💬 FAB (bottom-right, same 60px circle as ☰, dock collapsed by default) | UI mockups, wireframes, visual design concepts, click-through flows — one artefact that needs maximum screen real estate, plus structured per-screen feedback |
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
| `panel.frozen`                 | Frozen iteration               | Eingefrorene Iteration |
| `panel.frozen_hint`            | You are reading an earlier round. It is read-only — its decisions were already submitted. | Du liest eine frühere Runde. Sie ist schreibgeschützt — ihre Entscheidungen wurden bereits übermittelt. |
| `panel.frozen_back`            | Back to the current round      | Zurück zur aktuellen Runde |
| `panel.connecting_title`       | Claude is connecting           | Claude verbindet sich |
| `panel.connected_title`        | Claude connected               | Claude verbunden |
| `panel.disconnected_title`     | Claude not connected           | Claude nicht verbunden |
| `panel.btn_cache_hint`         | cached — sent on reconnect     | gecached — wird beim Verbinden gesendet |
| `panel.empty_iterate_confirm`  | Nothing was changed. Submit "Next iteration" anyway? | Du hast nichts geändert. Trotzdem "Zur nächsten Iteration" absenden? |
| `panel.empty_implement_confirm`| Nothing was changed. Implement with feedback anyway? Claude will still write code. | Du hast nichts geändert. Trotzdem mit Feedback implementieren? Claude schreibt dann Code. |
| `panel.toggle_open`            | Open decisions                 | Entscheidungen öffnen |
| `panel.toggle_close`           | Close decisions                | Entscheidungen schliessen |
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
| `final.status_heading`         | Close out concept              | Concept abschliessen |
| `final.open_questions`         | Open questions & TODOs         | Offene Fragen & TODOs |
| `final.create_issues_hint`     | Unchecked items are dropped — they end with the concept. | Nicht angehakte Punkte fallen weg — sie enden mit dem Concept. |
| `final.create_issues_none`     | No items selected — no issues will be created. | Keine Punkte ausgewählt — es werden keine Issues erstellt. |
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
| `final.ship_hint`              | Runs the full ship pipeline (build, version bump, release, merge). | Startet die komplette Ship-Pipeline (Build, Version-Bump, Release, Merge). |
| `final.view_iterations`        | Review iterations              | Iterationen ansehen |
| `final.wizard_heading`         | Close-out                      | Abschluss |
| `final.wizard_step_word`       | Step                           | Schritt |
| `final.wizard_issues_q`        | Track open points as issues?   | Offene Punkte als Issues anlegen? |
| `final.wizard_ship_q`          | Ship this now?                 | Jetzt shippen? |
| `final.wizard_ship_yes`        | Yes, run the ship pipeline     | Ja, Ship-Pipeline starten |
| `final.wizard_ship_no`         | No, leave it unreleased        | Nein, nicht releasen |
| `final.wizard_ship_no_hint`    | The code stays as committed. You can ship later from the chat. | Der Code bleibt wie committed. Shippen geht später jederzeit im Chat. |
| `final.wizard_choice_required` | Pick one to continue.          | Triff eine Wahl um fortzufahren. |
| `final.wizard_review_q`        | This is what will happen:      | Das passiert jetzt: |
| `final.wizard_review_warn`     | One click, all of it — including anything outward-facing. | Ein Klick, alles davon — inklusive allem was nach aussen geht. |
| `final.wizard_back`            | Back                           | Zurück |
| `final.wizard_next`            | Next                           | Weiter |
| `final.wizard_execute`         | Run all of it                  | Alles ausführen |
| `final.wizard_running`         | Claude is working through it … | Claude arbeitet es ab … |
| `final.wizard_done`            | Concept closed.                | Concept abgeschlossen. |
| `final.wizard_plan_issues`     | create GitHub issue(s)         | GitHub-Issue(s) anlegen |
| `final.wizard_plan_ship`       | run the ship pipeline          | Ship-Pipeline starten |
| `final.wizard_plan_close`      | end the concept session        | Concept-Session beenden |
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
| `anno.toggle_show`             | Show annotations                | Anmerkungen einblenden |
| `anno.toggle_hide`             | Hide annotations                | Anmerkungen ausblenden |
| `anno.answer_placeholder`      | Your answer…                    | Deine Antwort… |
| `anno.pin_label`                | Question {n}                    | Frage {n} |
| `design.nav_views_heading`     | Questions                       | Fragen |
| `design.feedback_view`         | Notes on this view               | Anmerkungen zu dieser Ansicht |
| `design.feedback_view_placeholder` | Write a note on this view…  | Notiz zu dieser Ansicht… |
| `view.compare_favourite`       | Favourite                       | Favorit |
| `view.compare_no_preference`   | No preference                   | Keine Präferenz |
| `view.compare_criteria`        | Criteria                        | Kriterien |
| `panel.maximize`               | Maximize                        | Maximieren |
| `panel.restore_size`           | Restore size                    | Größe wiederherstellen |
| `attach.button_title`          | Attach file (or Ctrl+V / drag & drop) | Datei anhängen (oder Strg+V / hierher ziehen) |
| `attach.not_synced`            | not yet synced                  | noch nicht synchronisiert |
| `attach.uploading`             | Uploading…                      | Wird hochgeladen… |
| `attach.remove`                | Remove attachment                | Anhang entfernen |
| `attach.retry`                 | Retry upload                     | Upload wiederholen |
| `attach.error_generic`         | Upload failed                    | Upload fehlgeschlagen |
| `attach.error_too_large`       | File too large for this bridge   | Datei zu groß für diese Bridge |
| `attach.error_quota`           | Storage full on the bridge       | Speicher auf der Bridge voll |
| `attach.error_disk_full`       | Bridge disk is full               | Bridge-Festplatte ist voll |
| `attach.error_offline`         | Bridge unreachable — kept locally, will retry on reconnect | Bridge nicht erreichbar — lokal gespeichert, Wiederholung bei Verbindung |
| `state.persist_failed`         | Could not save your changes locally — storage is full. Free up space or export your work soon. | Deine Änderungen konnten lokal nicht gespeichert werden — der Speicher ist voll. Platz freigeben oder Arbeit bald exportieren. |
| `design.viewport_switch`       | View                           | Ansicht |
| `design.viewport_desktop`      | Desktop                        | Desktop |
| `design.viewport_tablet`       | Tablet                         | Tablet |
| `design.viewport_phone`        | Phone                          | Handy |
| `design.orientation_portrait`  | Portrait                       | Hochkant |
| `design.orientation_landscape` | Landscape                      | Querformat |

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
               disconnected — claude_ts stale (nothing pulsing) OR server_ts stale /
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

      <!-- Frozen state: shown while the user reviews a PAST iteration tab.
           showIteration() flips this on for every non-live tab (and sets
           body.viewing-frozen, which the design template's dock reads to fill
           its textareas read-only). Without this block the panel simply loses
           its whole lower half on a frozen tab — no controls, no explanation,
           just empty space under the TOC, which reads as a broken page rather
           than as "this is history". The back-link is the only way out that
           does not require guessing which tab was live. -->
      <div id="panel-frozen" style="display: none;">
        <div class="frozen-indicator">
          <span class="frozen-icon" aria-hidden="true">🕘</span>
          <strong>{{panel.frozen}}</strong>
        </div>
        <p class="hint">{{panel.frozen_hint}}</p>
        <button type="button" id="back-to-live-btn" class="link-btn">{{panel.frozen_back}}</button>
      </div>

      <!-- Final-report state: shown when the active section carries
           data-final-report. No iterate/implement submit. Instead the panel
           runs a GUIDED CLOSE-OUT WIZARD: one question per step
           (issues → ship → files), then a review screen, then a SINGLE submit
           (action: "finalize") that carries all three decisions at once.
           The wizard replaced four independent, simultaneously-visible buttons
           whose execution order was implicit and which could not express
           "I want all three" — see § Final Report Panel for the rationale. -->
      <div id="panel-final-report" style="display: none;">
        <!-- Persistent status channel. Renders the concept's whole pipeline
             at a glance and hands over to the wizard. It is DOM-driven —
             present because the active section carries data-final-report — so
             it survives page reloads AND stays fully visible even when the
             Claude heartbeat is stale (the close-out affordance never depends
             on a live connection, which is the whole point of the persistent
             channel over a transient completion overlay). -->
        <div class="status-channel" id="status-channel">
          <div class="status-channel__heading">{{final.status_heading}}</div>
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
        </div>

        <!-- Close-out wizard. Exactly ONE step is visible at a time; the step
             list is computed at runtime (the issues step is dropped when the
             report has no open questions), so the counter is 3/3 or 4/4.
             The data-plan-* / data-word-* attributes carry localised strings
             into the JS-rendered review list — the JS itself never hard-codes
             user-facing text. -->
        <div id="finalize-wizard" class="finalize-wizard"
             data-plan-issues="{{final.wizard_plan_issues}}"
             data-plan-ship="{{final.wizard_plan_ship}}"
             data-plan-close="{{final.wizard_plan_close}}"
             data-word-step="{{final.wizard_step_word}}">
          <div class="wizard-head">
            <strong class="wizard-title">{{final.wizard_heading}}</strong>
            <span class="wizard-count" id="wizard-count" aria-live="polite"></span>
          </div>

          <!-- Step 1 (conditional) — open questions → GitHub issues. The
               checkboxes here MIRROR the [data-open-questions] boxes in the
               report body; the body remains the single source of truth, the
               mirrors carry no name/id so they are never persisted nor
               collected as form fields. -->
          <section class="wizard-step" data-wizard-step="issues" hidden>
            <h4 class="wizard-q">{{final.wizard_issues_q}}</h4>
            <p class="hint">{{final.create_issues_hint}}</p>
            <div class="wizard-issue-list" id="wizard-issue-list"></div>
            <p class="hint hint-none" id="wizard-issues-none" hidden>
              <span aria-hidden="true">⚠</span> {{final.create_issues_none}}
            </p>
          </section>

          <!-- Step 2 — ship or not. Deliberately has NO default: the wizard
               refuses to advance until the user picks one, so a release is
               never the consequence of clicking through. -->
          <section class="wizard-step" data-wizard-step="ship" hidden>
            <h4 class="wizard-q">{{final.wizard_ship_q}}</h4>
            <label class="wizard-choice">
              <input type="radio" name="wizard-ship" value="yes" data-no-persist>
              <span class="wizard-choice-label">
                <strong><span aria-hidden="true">🚀</span> {{final.wizard_ship_yes}}</strong>
                <span class="wizard-sub">{{final.ship_hint}}</span>
              </span>
            </label>
            <label class="wizard-choice">
              <input type="radio" name="wizard-ship" value="no" data-no-persist>
              <span class="wizard-choice-label">
                <strong>{{final.wizard_ship_no}}</strong>
                <span class="wizard-sub">{{final.wizard_ship_no_hint}}</span>
              </span>
            </label>
            <p class="hint hint-warn" id="wizard-ship-required" role="alert" aria-live="polite" hidden>
              <span aria-hidden="true">⚠</span> {{final.wizard_choice_required}}
            </p>
          </section>

          <!-- Step 3 — file disposition. Drives Step 6 cleanup behaviour
               (discard / keep / gitignore / optional moveTo). Default =
               discard, matching the typical one-shot refinement workflow
               where decisions already landed in commits/issues. -->
          <section class="wizard-step" data-wizard-step="files" hidden>
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
            </fieldset>
          </section>

          <!-- Step 4 — review. The one screen that names every consequence
               before the single irreversible click. -->
          <section class="wizard-step" data-wizard-step="review" hidden>
            <h4 class="wizard-q">{{final.wizard_review_q}}</h4>
            <ol class="wizard-plan" id="wizard-plan"></ol>
            <p class="hint hint-warn">{{final.wizard_review_warn}}</p>
          </section>

          <div class="wizard-nav">
            <button type="button" id="wizard-back" class="link-btn" hidden>
              <span aria-hidden="true">‹</span> {{final.wizard_back}}
            </button>
            <button type="button" id="wizard-next" class="primary submit-btn">
              {{final.wizard_next}} <span aria-hidden="true">›</span>
            </button>
          </div>

          <!-- Execute lives OUTSIDE .wizard-nav and behind the same
               .submit-gap the implement button uses: reaching it must stay a
               deliberate mouse move, never a repeat click on "Weiter". -->
          <div class="submit-gap" aria-hidden="true"></div>
          <button type="button" id="wizard-execute" class="implement-btn" hidden>
            <span aria-hidden="true">⚠</span> {{final.wizard_execute}}
          </button>

          <p class="hint hint-running" data-finalize-state="running" hidden>
            <span aria-hidden="true">⏳</span> {{final.wizard_running}}
          </p>
          <p class="hint hint-done" data-finalize-state="done" hidden>
            <span aria-hidden="true">✓</span> {{final.wizard_done}}
          </p>
        </div>

        <button type="button" id="view-iterations-btn" class="link-btn">{{final.view_iterations}}</button>
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
`<textarea data-comment="$decisionId-note" data-attachable>` so the user can
attach a free-form override (e.g. "only for X", "with variant Y") to the
bi-state choice, and attach a file to it (§ Attachments). Place the textarea
inside the same row container so the comment is visually anchored to the
card. The catch-all `collectAllFormFields` picks it up via `data-comment`
without any collector change.

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
              data-attachable
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
  - Only THAT design's row collapses in the ☰ panel: its
    `.screen-nav-group` keeps the heading that switches to it, and just the
    one redundant screen entry goes. `#screen-nav` itself must NOT be
    gated on this — it lists every design in the iteration, so hiding the
    container on the active design's screen count blanks the whole table
    of contents and strands the user (see § Layout CSS). The container
    disappears only when the iteration ALSO has a single design, i.e.
    when there is genuinely nothing left to navigate.
  - Feedback dock shows ONLY the general-notes textarea (no
    per-screen section, no "Aktueller Screen" label)
  - No click-dummy wiring required — nothing to navigate to
  - The screen-indicator overlay can be hidden or simplified
  - Two flags, two scopes, deliberately: `updateScreenScope()` sets
    `document.body.dataset.singleScreen` from the design currently on the
    canvas — that is the right scope for the DOCK, which always talks about
    the active screen. `buildDesignUI()` stamps
    `group.dataset.singleScreen` per design — the right scope for the
    PANEL, which shows all of them at once and must stay stable when the
    active design changes. Never drive one from the other's flag.
- **Single-design iteration (exactly one `<section data-design>`):**
  degenerates to today's behaviour — no design switcher, no per-design
  feedback row, `#screen-nav` renders the screens as a flat list (the
  design heading collapses). A views group, if the iteration has one, still
  renders WITH its heading — `body[data-single-design]` hides
  `.screen-nav-design-heading`, not `.screen-nav-views-heading`.
  `buildDesignUI()` detects `designs.length === 1` and sets
  `document.body.dataset.singleDesign = 'true'`, the sibling of
  `data-single-screen` above, so CSS hides the same way. The `data-design`
  wrapper is still required in the markup even when there's only one — see
  § Screen-pattern markup.
- **Do NOT invent artificial screens** to make the template fit. If the
  artefact has no meaningful secondary state, leave it as a single screen
  and let the dock collapse to general notes only.
- **Views are optional, additional top-level items — ≥1 `data-design` stays
  mandatory.** Alongside the design(s), a `design` iteration MAY hold any
  number of `section[data-view]` siblings (§ Views (optional) below). Views
  never stand alone: an iteration that is only questions, with no artefact
  in front of the user, is a `decision` iteration, not a `design` one with
  zero designs. The validation gate enforces this — see
  `deep-knowledge/validation-gate.md`.
- **Design system alignment:** the mockup MUST use the project's existing
  design tokens (colors, typography, spacing, component shapes) unless the
  user explicitly requests a different look. Read `design-tokens.*`,
  Tailwind config, Figma variables via the design MCP, or the existing UI
  layer before inventing a style. The example in this file uses the generic
  GitHub-style palette only because dotclaude has no project-specific
  tokens — consumer projects will differ.
- **Annotation layer is optional.** Only pin questions onto a screen when
  Claude has a concrete, element-level question to ask ("should this list
  auto-refresh?", "is this the right empty state?") — not as a default
  decoration on every design iteration. A design with no annotations simply
  omits `[data-anno-layer]` entirely; nothing degrades. See § Annotation
  Layer (optional) below. The layer's pin/bubble/leader visuals MAY be
  restyled via its CSS custom properties (`--anno-accent`,
  `--anno-bubble-bg`, `--anno-pin-size`, …) to match the design's own theme
  — never change the toggle semantics (`body.anno-hidden`) or the
  `data-anno*` attribute names when doing so, since the shared JS and the
  submit payload both key off them.

## Responsive device views

A design page mocks an app that may ship on more than one form factor. The
concept **declares** which ones; the user switches between them with the
`.viewport-toggle` bottom-left. Desktop is the pre-existing full-bleed
rendering, unchanged: no stage, no clone, no frame. A concept that declares
nothing behaves exactly as it did before this existed and never renders the
toggle.

Declared on `section[data-iteration]`, overridable on a single
`section[data-design]` whose form factors genuinely differ:

| Attribute | Meaning | Default |
|---|---|---|
| `data-viewports` | Ordered, space-separated subset of `desktop tablet phone`. The order IS the click-cycle order. | `desktop` (→ no toggle) |
| `data-viewport-default` | Which of them the page opens in. A phone-only app declares `data-viewports="phone"` and opens straight into the phone frame. | first entry of `data-viewports` |
| `data-orientations` | Subset of `portrait landscape`. Both are rendered **side by side, simultaneously** — the reviewer compares them without switching. Declare one only for an app that locks its orientation. | `portrait landscape` |
| `data-device-tablet`, `data-device-phone` | `WIDTHxHEIGHT` in portrait CSS pixels, e.g. `360x800` for an Android target. | `834x1194` / `390x844` |

**Mock authoring constraints (device mode makes these load-bearing).** The
frames are DOM clones of the screen's content rendered into a
`container-type: size` box; they are not iframes and the browser viewport
does not change. Inside `section[data-screen]`, therefore:

- **No `vh` / `vw` / `dvh` / `svh` / `lvh` units.** They resolve against the
  browser window, not the frame: a `height: 100vh` hero renders 1080px tall
  inside a 390×844 phone shell and bursts out of it. Use `100%` (the frame
  is definitely sized) or `cqh` / `cqw` against `container-name: device`.
- **No `@media` queries for the device breakpoints.** They key off the
  window, which never changes. Style device variants off the shell instead —
  `.device-shell[data-device="phone"] .nav { … }`,
  `.device-shell[data-orientation="landscape"] .sidebar { … }` — or use
  `@container device (max-width: 480px)`.
- **No `position: fixed`.** It anchors to the window in desktop mode and to
  the transformed stage in device mode, i.e. two different results from one
  rule. Use `position: absolute` inside the frame.
- **No `<script>`, `<canvas>`, `<style>` or `<iframe>`.** A cloned `<script>`
  is spec-marked "already started" and never runs; a cloned `<canvas>` comes
  out blank because the bitmap is not copied. Both render correctly in
  desktop mode and dead in device mode — a divergence with no error anywhere.
  Mockups are declarative markup; their CSS lives in the page's single
  `<head>` stylesheet like all other concept CSS.
- **The annotation layer never enters a frame.** `[data-anno-layer]` is
  stripped from every clone: its JS collects `[data-anno-pin]` and
  `textarea[data-annotation]` document-wide, and a cloned answer is a third
  textarea that persistence and the submit payload both skip — it would be
  typed and silently lost. Annotations stay a desktop-view affordance.
- **A view suspends device mode.** While a `section[data-view]` is the active
  top-level item (`body[data-view-active="true"]`) no screen is on display,
  so the stage is torn down and the toggle hides — a question view is prose,
  not a screen to frame.
- **Style mocks by class, never by `#id`.** Clone ids are namespaced per
  frame (`dv1-`, `dv2-`) so the two copies cannot collide, which means an
  `#id` rule stops matching inside the frames while it still matches the
  hidden original.

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

- `☰` (top-right) → Decision panel: iteration tabs, screen navigation, submit
- `💬` (bottom-right) → Feedback dock: **context-sensitive** textarea for the
  currently-visible screen + a persistent "general notes" textarea below

Both FABs are the same 60px circle in the same accent colour — they differ
only by glyph and position (see § Layout CSS). Do not re-size either one per
page: it is the first thing that looks broken when concepts sit side by side.

### Feedback behaviour (strict)

- The dock starts **collapsed** in every state, including frozen iterations.
  The 💬 FAB is the only thing that opens it. At concept start the artefact
  is what the user came for, not three empty textareas over it.
- Open, the dock has exactly two sizes — `compact` (420px, general note only)
  and `wide` (560px, general + design + per-screen). `applyDockSize()` picks
  one from `body[data-single-screen]` / `body[data-single-design]`. Never
  size it to its content or to a viewport fraction.

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

## Annotation Layer (optional)

A second, independent feedback channel: instead of (or alongside) the 💬
dock's free-form notes, Claude can pin a numbered question directly onto a
concrete element of a screen and the user answers it right there. Use it
only when there is a concrete, element-level question — it is not a default
decoration on every screen.

- **Pin + short leader line to a bubble.** A numbered pin (`data-anno-pin`)
  sits on the annotated element; a short leader line connects it to a speech
  bubble (`data-anno-bubble`) beside it. Collapsed, the bubble shows one
  truncated line of the question plus a chevron. Expanded
  (`data-open="true"`), it shows the full question, an answer textarea and
  an attachment drop area.
- **Positioned in percentages, not pixels.** `--anno-x` / `--anno-y` on the
  wrapping `.anno` element place the pin as a percentage of the screen box —
  `.anno-layer` is `inset: 0`, so that box is the FULL section including the
  chrome safe area (§ Layout CSS), not the padded content box the mock is
  drawn in. Hand-picked coordinates must be read off the whole viewport, not
  off the artefact. `anchorToTarget()` measures live rects and is unaffected;
  this only matters for coordinates authored by hand. They survive any
  viewport size either way. `data-anno-side="right|left|top|bottom"`
  picks which side the bubble opens on — Claude chooses this at generation
  time from the element's position in the mock; there is no runtime
  collision math.
- **The eye pill (`#anno-toggle`) toggles the whole layer**, globally, for
  every screen — not per screen. It shows a live count of annotations on
  the *current* screen and is the only thing that stays visible once the
  layer is hidden, so the user can always bring it back. It only renders
  when the active screen has ≥1 annotation (`updateAnnoUI()`, § Layout JS).
  Hiding the layer (`body.anno-hidden`) removes pins, leaders and bubbles
  completely — the design underneath must be pixel-clean, not just dimmed.
- **The two existing FABs are untouched.** ☰ and 💬 keep working exactly as
  before, independently of the annotation layer's state — the feedback dock
  remains the normal way to leave free-form notes whether the layer is
  shown or hidden.
- **Answers persist for free.** The answer textarea carries
  `data-comment="anno-{id}"`, so the existing `saveState()` / `restoreState()`
  (§ State Persistence) picks it up with zero extra code, exactly like any
  other comment field. The layer's own visibility (`body.anno-hidden`) is
  persisted the same way `state['theme']` is (§ State Persistence).
- **Attachments.** Each answer textarea carries `data-annotation="{id}"`
  and `data-attachable`, plus an adjacent mount
  `<div class="attach-slot" data-attach-slot="anno-{id}"></div>`. §
  Attachments wires exactly one attachment bar per field: it matches on
  `data-attachable` — not `data-comment`, which the textarea also carries,
  so matching on it would double-wire — and mounts the bar into this
  dedicated `.attach-slot` instead of appending after the textarea.
- **Frozen iterations stay browsable.** `.anno-pin`, `[data-anno-summary]`
  and `#anno-toggle` are exempt from the freeze sweep exactly like
  `.design-switch-item` and `#panel-toggle` — see `iteration-rules.md` §
  Freezing Design Iterations. The summary row must be exempt alongside the
  pin: it is a second, fully equivalent way to open the same bubble, and
  exempting only the pin leaves the layer half-navigable on a frozen tab.
  Answer textareas become `readonly`, never `disabled`.
- **Click-through safety.** A click on a pin, a summary row, or inside a
  bubble must never be interpreted as `data-screen-link` navigation, even
  though all three live inside the same `[data-screen]` — the click-through
  handler (§ Click-through Handler) explicitly ignores `[data-anno-pin]`,
  `[data-anno-summary]` and `.anno-bubble` before it looks for a navigation
  target.

See § Layout (markup), § Layout CSS (pin/bubble/eye-pill styling and the
top-edge partition) and § Layout JS (`wireAnnotationLayer()`) below for the
reference implementation, and § Screen-pattern markup for a worked example.

## Views (optional)

A third, independent thing a `design` iteration may hold: non-visual
questions that belong **inside** the same round as the artefact they are
about, instead of being deferred to a separate `decision` iteration one
round later. A `section[data-view]` is a **top-level sibling of
`section[data-design]`** — switched exactly like a design, fullscreen, with
its own entry in the switcher and the panel TOC.

```html
<section data-iteration="3" data-iteration-template="design" data-active>
  <section data-design="dispatch" data-nav-label="Dispatch board" data-design-active="true">
    <section id="d1-s1" data-screen data-nav-label="Overview" data-screen-active="true">…</section>
    <section id="d1-s2" data-screen data-nav-label="Detail" hidden>…</section>
  </section>

  <section data-view="nav-model" data-view-kind="decision"
           data-nav-label="Navigation model" hidden>…</section>

  <section data-view="card-density" data-view-kind="comparison"
           data-nav-label="Card density A/B" hidden>…</section>
</section>
```

**Rules:**

- **≥1 `data-design` is mandatory** — see § Rules above. Views are never the
  only top-level content.
- **Exactly one top-level item is active** at a time: a design carrying
  `data-design-active="true"` (and NOT `hidden`) or a view carrying
  `data-view-active="true"` (and NOT `hidden`). Every other top-level item —
  every other design, every other view — carries `hidden`. `showView()` and
  `showDesign()` (§ Layout JS) both maintain this invariant; neither ever
  leaves two top-level items simultaneously visible.
- **Authored markup always makes a DESIGN the active item, never a view.**
  A view becomes active only at runtime, through `showView()` — from the
  switcher, the panel TOC, or the `_activeView` restore after a reload.
  This is not a style preference: `buildDesignUI()` early-returns without an
  active design, which would leave the switcher, both nav groups and all
  three dock textarea containers unbuilt. The same rule holds after a tab
  switch — the `iteration:changed` handler deliberately drops back to the
  incoming iteration's active design (§ Layout JS).
- `data-view` ids are unique **page-wide** — and this is the one id space
  where that matters, so do not pattern-match it off the others. Design ids
  and screen ids deliberately REPEAT across iterations (that is what lets
  `harvestDockValues()` carry a note forward when the same screen reappears
  in the next round); a view id that repeated would collide in exactly the
  places where designs and screens are meant to.
- **A view scrolls; a design screen does not.** `body` keeps
  `overflow: hidden` in `design` mode throughout — only the active view's own
  box scrolls internally (`overflow-y: auto`), never the page. See § Layout CSS.
- **When to use a view instead of a separate `decision` iteration** (also
  stated in `SKILL.md` § Step 1a): the question is *about the artefact in
  front of you* right now → a view inside this `design` iteration. The
  question stands on its own, independent of any one mockup → its own
  `decision` iteration. When in doubt, ask whether the user would need to
  flip back to a screen to answer sensibly — if yes, it is a view.
- **Navigation.** `#screen-nav` gains a second `.screen-nav-group` below the
  designs group, headed by a plain (non-interactive) `.screen-nav-views-heading`
  label, then one `.screen-nav-view-item` button per view. The top-centre
  switcher (`#design-switcher`) lists designs and views in one row: design
  segments (`.design-switch-item`), a thin `.switcher-divider`, then view
  segments (`.view-switch-item`) — one click from anywhere, no detour through
  the ☰ panel. Both are auto-populated by `buildDesignUI()`, exactly like the
  design-only case.
- **Screen indicator.** While a view is active, `#screen-indicator` shows the
  view's `data-nav-label` instead of the screen counter — the "Page N/total"
  segment (`#indicator-screen-info`) hides, `#indicator-view` shows. Every
  mount is null-guarded, same discipline as every other indicator segment.
- **Feedback dock.** While a view is active, the dock shows **general +
  one view-level textarea** (`data-comment="view-{id}"`,
  `data-view-comment="{id}"`, label from the view's `data-nav-label`) and
  hides the per-design and per-screen rows; the reverse holds while a design
  is active. The view textareas are built **once per iteration** by
  `buildViewTextareas()`, in the same build-once-per-iteration + hidden-swap
  pattern `buildDesignTextareas()`/`buildScreenTextareas()` already use —
  never rebuilt on a design/view switch, for the same reason documented at
  the top of § Layout JS: a rebuild would drop unsent text and truncate the
  submit payload.
- **Click-through safety.** The `data-screen-link` click-through handler
  (§ Click-through Handler) is scoped to the visible design and returns
  immediately whenever a view is active (`body[data-view-active="true"]`) —
  a stray `data-screen-link` button reachable only through markup reuse must
  never fire screen navigation while the user is looking at a view.
- **Freezing.** A frozen `design` iteration stays fully browsable: view
  switching and the view nav keep working, exactly like the design switcher
  and screen nav today. See `iteration-rules.md` § Freezing Design
  Iterations for the exact exemption list and how a frozen view's submitted
  values (bi-state selections, notes) are restored.

### View kind `decision`

Reuses the decision template's proven bi-state mechanics wholesale — no new
markup vocabulary. A `data-view-kind="decision"` view is a fullscreen frame
(heading + free prose authored above/between the alternatives) around one
or more `[data-decision]` groups, each with the same bi-state
(`Miteinbeziehen` / `Verwerfen`, default include) and the same mandatory
adjacent `textarea[data-comment="{decisionId}-note"]` as § Bi-State Variant
Evaluation. `ensureCommentSlots()` (§ Comment Slot Injection) already runs
page-wide on `DOMContentLoaded` and reaches every `[data-decision]` group
regardless of which template or view it lives in — nothing view-specific
needs wiring there. What changes is only the frame: fullscreen, no sidebar,
no 340px card constraint, so alternatives can carry as much authored context
as the question needs.

```html
<section data-view="nav-model" data-view-kind="decision" data-nav-label="Navigation model" hidden>
  <div class="view-frame">
    <h2>Navigation model</h2>
    <p>Tabs or a drawer for the second level? Both are wired in the mockup —
       flip back to Dispatch board to try either one before deciding.</p>

    <div class="variant-evaluation" data-decision="nav-tabs" data-label="Tabs">
      <h3>Tabs</h3>
      <p>Always-visible, one click, costs permanent header height.</p>
      <div class="eval-group">
        <label class="eval-option">
          <input type="radio" name="eval-nav-tabs" value="discard">
          <span class="eval-label">Verwerfen</span>
        </label>
        <label class="eval-option">
          <input type="radio" name="eval-nav-tabs" value="include" checked>
          <span class="eval-label">Miteinbeziehen</span>
        </label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="nav-tabs-note">{{decision.comment_label}}</label>
        <textarea id="nav-tabs-note" data-comment="nav-tabs-note" data-attachable
                  placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>

    <div class="variant-evaluation" data-decision="nav-drawer" data-label="Drawer">
      <h3>Drawer</h3>
      <p>Hidden by default, saves header height, one extra click per visit.</p>
      <div class="eval-group">
        <label class="eval-option">
          <input type="radio" name="eval-nav-drawer" value="discard">
          <span class="eval-label">Verwerfen</span>
        </label>
        <label class="eval-option">
          <input type="radio" name="eval-nav-drawer" value="include" checked>
          <span class="eval-label">Miteinbeziehen</span>
        </label>
      </div>
      <div class="field-row decision-comment-row">
        <label for="nav-drawer-note">{{decision.comment_label}}</label>
        <textarea id="nav-drawer-note" data-comment="nav-drawer-note" data-attachable
                  placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
      </div>
    </div>
  </div>
</section>
```

**Rules:**
- Mandatory: ≥2 named alternatives (`[data-decision]` groups), each with the
  bi-state selector and its adjacent note textarea.
- `.view-frame` is a plain wrapper (no positioning of its own) — the view's
  own `overflow-y: auto` scroll box does the layout work, see § Layout CSS.
- `collectDesignDecisions()` (§ collectDecisions (design branch)) scans every
  `[data-decision]` group inside every view of the active iteration — not
  just the one on screen — and tags each entry with `view: "{viewId}"`. See
  § Decision schema.

### View kind `comparison` — mandatory skeleton, free interior

Deliberately loose, the same way the design template's mockups are loose:
Claude is free to author whatever the comparison needs, as long as the
mandatory skeleton below is present. **Freedom here is a requirement, not an
afterthought** — do not pad every comparison view with every optional block
just because it is documented below.

**Mandatory:**
- a heading stating the question,
- **≥2** `article[data-compare-option="{id}"]`, each with a title and a free
  body (Claude may put anything inside — bullet points, a small mock,
  metrics, prose),
- a verdict control per option — the same bi-state (`Miteinbeziehen` /
  `Verwerfen`) as § Bi-State Variant Evaluation, keyed
  `data-decision="{optionId}"` so it reuses `ensureCommentSlots()` and
  `collectDesignDecisions()` unchanged; an additional "favourite" radio group
  (`name="compare-favourite-{viewId}"`) is allowed but never replaces the
  per-option bi-state,
- one note `textarea[data-attachable]` per option **and** one for the view as
  a whole — all wired the same way as every other comment slot (§ State
  Persistence picks them up via `data-comment`; `data-attachable` is the
  hook § Attachments wires, appending a bar since these notes have no
  dedicated `.attach-slot` mount).

**Two layouts, both first-class — pick per comparison via
`data-compare-layout`:**

| Value | Shape | Use when |
|---|---|---|
| `grid` | Option cards side by side in a `repeat(auto-fit, minmax(280px, 1fr))` grid | The options differ in SHAPE — each needs its own preview, mockup fragment or prose |
| `table` | One `table.cmp-table`: criteria as rows, options as columns, the evaluation controls in a final row | The options differ in VALUES along shared criteria — the reader wants to scan one row and compare like with like |

Reach for `table` whenever the same handful of criteria applies to every
option. A grid of cards then forces the reader to hop between columns to
compare a single criterion, which is precisely the work a comparison view
exists to remove. `.cmp-table` keeps its own horizontal scroll container so a
five-option comparison never widens the page.

**Optional, freely combinable — use only what the comparison needs:**
- a criteria matrix (`table.cmp-matrix`, criteria as rows, options as
  columns, an optional per-cell rating `<select>`) — this is the `grid`
  layout's companion; with `data-compare-layout="table"` the matrix IS the
  view and a second one is redundant,
- per-criterion weight sliders,
- pros/cons lists per option,
- meta chips (effort, risk, cost — whatever is relevant),
- live mockup fragments reusing `.device-frame` from § Screen-pattern markup,
- a "no preference" escape checkbox/radio.

```html
<section data-view="card-density" data-view-kind="comparison" data-nav-label="Card density A/B" hidden>
  <div class="view-frame view-compare" data-compare-layout="grid">
    <h2>Which card density for the dispatch board?</h2>
    <p>Both are wired into the Dispatch board mockup — switch back and try
       scrolling a full shift's worth of calls in each before deciding.</p>

    <div class="cmp-options">
      <article class="cmp-option" data-compare-option="compact">
        <h3>Compact</h3>
        <p>More calls per screen, denser typography, icon-only actions.</p>
        <!-- optional: pros/cons, meta chips, a .device-frame fragment -->
        <div class="eval-group" data-decision="compact" data-label="Compact">
          <label class="eval-option">
            <input type="radio" name="eval-compact" value="discard">
            <span class="eval-label">Verwerfen</span>
          </label>
          <label class="eval-option">
            <input type="radio" name="eval-compact" value="include" checked>
            <span class="eval-label">Miteinbeziehen</span>
          </label>
        </div>
        <div class="field-row decision-comment-row">
          <label for="compact-note">{{decision.comment_label}}</label>
          <textarea id="compact-note" data-comment="compact-note" data-attachable
                    placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
        </div>
      </article>

      <article class="cmp-option" data-compare-option="comfortable">
        <h3>Comfortable</h3>
        <p>Fewer calls per screen, larger tap targets, labelled actions.</p>
        <div class="eval-group" data-decision="comfortable" data-label="Comfortable">
          <label class="eval-option">
            <input type="radio" name="eval-comfortable" value="discard">
            <span class="eval-label">Verwerfen</span>
          </label>
          <label class="eval-option">
            <input type="radio" name="eval-comfortable" value="include" checked>
            <span class="eval-label">Miteinbeziehen</span>
          </label>
        </div>
        <div class="field-row decision-comment-row">
          <label for="comfortable-note">{{decision.comment_label}}</label>
          <textarea id="comfortable-note" data-comment="comfortable-note" data-attachable
                    placeholder="{{decision.comment_placeholder}}" rows="2"></textarea>
        </div>
      </article>
    </div>

    <!-- Optional favourite pick, additive to the per-option bi-state above. -->
    <fieldset class="cmp-favourite">
      <legend>{{view.compare_favourite}}</legend>
      <label><input type="radio" name="compare-favourite-card-density" value="compact"> Compact</label>
      <label><input type="radio" name="compare-favourite-card-density" value="comfortable"> Comfortable</label>
      <label><input type="radio" name="compare-favourite-card-density" value=""> {{view.compare_no_preference}}</label>
    </fieldset>

    <div class="field-row decision-comment-row">
      <label for="card-density-view-note">{{decision.comment_label}}</label>
      <textarea id="card-density-view-note" data-comment="card-density-view-note" data-attachable
                placeholder="{{decision.comment_placeholder}}" rows="3"></textarea>
    </div>
  </div>
</section>
```

**Layout:** `.cmp-options` is a CSS grid, `repeat(auto-fit, minmax(280px, 1fr))`
— 2–4 candidates sit side by side and **wrap to a new row instead of
shrinking** below a readable width. `data-compare-layout` on `.view-compare`
is a layout hint Claude may set (`"grid"` default, `"stacked"` when the
options genuinely need full width each) — purely presentational, no JS reads
it today.

**Rules:**
- Mandatory skeleton only: ≥2 `[data-compare-option]`, a per-option
  bi-state, one note per option + one for the view. Everything else is
  optional and freely combinable — do not treat the optional list as a
  checklist to fulfil.
- Each `[data-compare-option]`'s bi-state reuses `data-decision="{optionId}"`
  verbatim, so it is collected exactly like any other decision (tagged with
  `view: "{viewId}"`, § Decision schema) — do not invent a parallel
  "verdict" schema.
- The "favourite" radio group, when present, carries no `data-decision` and
  is picked up by the generic form catch-all (`el.name`/`el.id` key) like any
  other named input — it augments, never replaces, the per-option verdicts.

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
        <!-- data-viewports / data-orientations declare the form factors this
             concept's app supports (§ Responsive device views). Omit both for
             a desktop-only concept: the toggle then never renders and the
             layout is byte-for-byte what it was before device views existed.
             A single design may override them; the iteration is the normal
             place to declare. -->
        <section data-iteration="1" data-iteration-template="design" data-active
                 data-viewports="desktop tablet phone"
                 data-orientations="portrait landscape">
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

          <!-- Views — OPTIONAL top-level siblings of section[data-design],
               never a replacement for the ≥1 design above. See § Views
               (optional) and § Screen-pattern markup → View sections for the
               full worked examples of both kinds. -->
          <section data-view="nav-model" data-view-kind="decision"
                    data-nav-label="Navigation model" hidden>…</section>
          <section data-view="card-density" data-view-kind="comparison"
                    data-nav-label="Card density A/B" hidden>…</section>
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
      <!-- Screen-counter segment — swaps out entirely (not just dimmed) for
           #indicator-view below while a view is active. Both are
           null-guarded by updateIndicator() (§ Layout JS), so a page that
           omits one of the two degrades silently rather than throwing. -->
      <span id="indicator-screen-info">
        {{design.position_page}} <strong id="active-screen-idx">1</strong> / <span id="total-screens">3</span>
        · <span id="active-screen-label">Welcome</span>
      </span>
      <!-- View-label segment — OPTIONAL, only ever shown while a
           section[data-view] is the active top-level item (§ Views
           (optional)). hidden by default so a page with no views never
           shows an empty strong tag. -->
      <span id="indicator-view" hidden><strong id="active-view-label">Navigation model</strong></span>
    </div>

    <!-- Annotation layer eye pill — OPTIONAL, only emitted when at least one
         screen carries [data-anno-layer]. Sits on the left edge directly
         BELOW #screen-indicator (never in the top-left corner itself, which
         the indicator owns) — see § Layout CSS for the exact offset and the
         updated top-edge partition comment. `hidden` by default; JS
         (updateAnnoUI(), § Layout JS) reveals it only when the ACTIVE screen
         has ≥1 annotation, and keeps the count live across screen/iteration
         switches. aria-pressed / aria-label reflect body.anno-hidden. -->
    <button id="anno-toggle" class="anno-toggle-fab" type="button" hidden
            aria-pressed="true"
            aria-label="{{anno.toggle_hide}}"
            data-label-show="{{anno.toggle_show}}"
            data-label-hide="{{anno.toggle_hide}}">
      <span class="anno-eye" aria-hidden="true">👁</span>
      <span id="anno-count" class="anno-count">0</span>
    </button>

    <!-- Design switcher (ghost bar, top centre) — one segment per
         <section data-design>, only rendered when the iteration has ≥2
         designs (hidden via body[data-single-design], see Layout CSS).
         Auto-populated by buildDesignUI(); resting state shows only the
         active label (CSS collapses the rest), hover/:focus-within expands
         to the full segmented control.
         When the iteration ALSO has ≥1 view (§ Views (optional)),
         buildDesignUI() appends a thin .switcher-divider then one
         .view-switch-item per view, in the SAME row — switching between a
         design and a question about it is one click from anywhere. -->
    <nav class="design-switcher" id="design-switcher" aria-label="{{design.switch_label}}">
      <!-- auto-populated: one <button class="design-switch-item"> per
           design, then (if any) a <span class="switcher-divider"> and one
           <button class="view-switch-item"> per view -->
    </nav>

    <!-- Two FABs — the only floating UI besides the screen itself.
         BOTH carry two labels: the toggle swaps `title` AND `aria-label`
         together with `aria-expanded`, so pointer users get a hover tooltip
         and screen-reader users hear the correct NEXT action ("Open" vs
         "Minimize"). The labels are tooltip-only on purpose — an unlabelled
         emoji circle is undiscoverable, but a visible pill would break the
         shared 60px circle geometry the two FABs are pinned to (gate P13).
         Every label string comes from the locale table; never bake English
         (or "Feedback") in here.
         `data-untouched` on the 💬 FAB drives a one-shot attention pulse
         (§ Layout CSS) that the JS clears on the first dock open or the
         first keystroke inside the dock — a returning user is never nagged
         twice. -->
    <button id="panel-toggle" class="panel-fab"
            aria-label="{{panel.toggle_open}}"
            title="{{panel.toggle_open}}"
            aria-expanded="false"
            data-label-open="{{panel.toggle_open}}"
            data-label-close="{{panel.toggle_close}}">☰</button>
    <button id="feedback-toggle" class="feedback-fab"
            aria-label="{{proto.feedback_toggle}}"
            title="{{proto.feedback_toggle}}"
            aria-expanded="false"
            data-untouched="true"
            data-label-open="{{proto.feedback_toggle}}"
            data-label-close="{{panel.minimize}}">💬</button>

    <!-- Device-view toggle (bottom-left) — the fourth corner, and the
         quietest thing on the page. One button, one gesture: each click
         advances to the next DECLARED viewport and wraps around. It is
         deliberately NOT a 60px FAB — those two are one accent-coloured
         component for the page's two actions, this is a view control that
         must not compete with them. Hidden entirely when the iteration
         declares fewer than two viewports (body[data-single-viewport]).
         Every label is a data-attribute rather than baked text: the JS
         rewrites glyph + label + aria-label on each cycle, and the locale
         substitution has to happen once, here, at generation time. -->
    <button id="viewport-toggle" class="viewport-toggle" type="button" data-mode="desktop"
            data-label-prefix="{{design.viewport_switch}}"
            data-label-desktop="{{design.viewport_desktop}}"
            data-label-tablet="{{design.viewport_tablet}}"
            data-label-phone="{{design.viewport_phone}}"
            data-label-portrait="{{design.orientation_portrait}}"
            data-label-landscape="{{design.orientation_landscape}}"
            aria-label="{{design.viewport_switch}}">
      <!-- Inline SVG, not emoji: 🖥/📱 render as full-colour platform art
           that clashes with a dark chrome pill and differs per OS. All three
           share one 20×20 grid, stroke-only, currentColor — so they read as
           one set. The monitor keeps a stand because a bare rectangle is
           indistinguishable from a tablet in landscape; neither tablet nor
           phone gets a notch or home button, which would have to move
           between orientations and carries no information the label lacks. -->
      <svg data-glyph="desktop" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="16" height="11" rx="1.5"/>
        <line x1="10" y1="14" x2="10" y2="17"/>
        <line x1="7" y1="17" x2="13" y2="17"/>
      </svg>
      <svg data-glyph="tablet" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="2" width="12" height="16" rx="2"/>
      </svg>
      <svg data-glyph="phone" viewBox="0 0 20 20" width="20" height="20" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <rect x="6" y="1" width="8" height="18" rx="2.2"/>
        <line x1="8.5" y1="3.3" x2="11.5" y2="3.3"/>
      </svg>
      <span class="viewport-toggle-label">{{design.viewport_desktop}}</span>
    </button>

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
             closes the panel.
             A SECOND .screen-nav-group renders below the designs group
             whenever the iteration has ≥1 view (§ Views (optional)): a
             plain, non-interactive .screen-nav-views-heading label, then
             one .screen-nav-view-item button per view. Own class family
             (screen-nav-view-*) so it can be styled independently of the
             design nav items it sits below. -->
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
      <!-- The remaining two panel states — #panel-frozen and
           #panel-final-report — are IDENTICAL to § Common Structure and MUST
           be copied verbatim from there into this aside. showIteration()
           switches all four states regardless of template, so a design page
           that ships only the two above loses its close-out wizard the moment
           a final report is appended, and shows an empty panel on every past
           tab. Only the containing aside differs (overlay vs sidebar), never
           the states inside it. -->
    </aside>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- Feedback dock (💬) — three-level Speech-Bubble overlay, top to
         bottom: general → design → page. General sits at the top because
         it is the one field that never disappears or changes label as the
         user navigates — putting it first keeps the dock from jumping.
         Anchored to the 💬 FAB (bottom-right): the FAB stays visible and
         clickable, the dock floats above/around it like a chat bubble.
         Now that ☰ lives top-right (Wave 3), the dock no longer reserves
         space for it — see Layout CSS geometry comment.
         The close button minimises (does not destroy state) — user input
         is preserved on close, no value is lost.
         CLOSED by default (data-open="false"): at concept start the user
         wants to look at the mockup, not at three empty textareas covering
         it. data-size is written by applyDockSize() — see Layout JS. -->
    <aside class="feedback-dock" id="feedback-dock" data-open="false" data-size="compact" data-user-maximized="false">
      <div class="feedback-dock-header">
        <strong>Feedback</strong>
        <!-- Maximise (Work package B) is a distinct control from minimise:
             minimise CLOSES the dock (data-open toggle), maximise RESIZES it
             (data-size override) without touching data-open at all. The two
             must never be merged into one button. -->
        <button id="feedback-maximize" class="feedback-maximize-btn" aria-pressed="false"
                aria-label="{{panel.maximize}}" title="{{panel.maximize}}">⤢</button>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.minimize}}" title="{{panel.minimize}}">−</button>
      </div>
      <div class="feedback-section">
        <label>{{proto.feedback_general}}</label>
        <textarea id="design-general-feedback" data-comment="general" data-attachable
                  placeholder="{{proto.feedback_general}}"></textarea>
        <div class="attach-slot" data-attach-slot="general"></div>
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
      <div class="feedback-divider"></div>
      <!-- View row — OPTIONAL, only present when the iteration has ≥1
           section[data-view] (§ Views (optional)). Shown ONLY while a view
           is the active top-level item (body[data-view-active="true"],
           § Layout CSS); the design and per-screen rows above hide in that
           state and this one takes their place — never all three visible
           at once. One hidden textarea per view, built ONCE per iteration by
           buildViewTextareas(), same build-once-swap-hidden discipline as
           the design/screen rows. Each carries data-comment="view-{id}" AND
           data-view-comment="{id}". -->
      <div class="feedback-section">
        <label>{{design.feedback_view}}: <strong id="dock-view-label">Navigation model</strong></label>
        <div id="view-textareas" data-placeholder="{{design.feedback_view_placeholder}}"><!-- auto-populated --></div>
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

/* ── Chrome safe area ───────────────────────────────────────────────────
   Every fixed control in design mode sits on the viewport's top or bottom
   edge while the canvas beneath runs edge to edge (inset: 0). A flat 2rem
   padding therefore starts the content at 32px where the chrome reaches
   92px, so the first rows of any screen tall enough to fill the viewport
   are painted UNDER the indicator, the design switcher and the ☰ FAB
   (measured in Edge at 921x873: content top 32px, indicator bottom 50px —
   18px of unreadable overlap on every screen of the page).

   The § Layout CSS top-edge partition above solves the chrome-vs-chrome
   collisions; this is the missing chrome-vs-CONTENT one. Two tokens, derived
   from the geometry already fixed there, so the reserve can never drift from
   the chrome that caused it:
     TOP     .panel-fab        2rem offset + 60px circle   = 92px  (right)
             .anno-toggle-fab  3.75rem offset + ~2rem pill = 92px  (left)
             .screen-indicator 1rem offset + ~2.1rem pill  = 50px  (left)
             .design-switcher  0.75rem offset + ~2.3rem    = 49px  (centre)
     BOTTOM  .feedback-fab     2rem offset + 60px circle   = 92px  (right)
             .viewport-toggle  2rem offset + 34px pill     = 66px  (left)

   The reserve is deliberately NOT symmetric, because the two edges are not.
   The top edge is occupied across its whole width — indicator on the left,
   switcher in the centre, ☰ on the right — so content must clear its
   deepest element everywhere: 92px = 5.75rem. The bottom edge carries two
   CORNER controls and nothing in between, so the ordinary 2rem gutter is
   the honest reserve there; a 60px FAB floating over a canvas corner is the
   normal pattern, and mirroring the top would have spent another 60px of
   artefact height on an edge that is empty across ~96% of its width. In
   device mode that height is multiplicative — fitDeviceStage() scales the
   frame pair to the box — so it is the most expensive space on the page.
   The cost of the asymmetry is that `align-items: center` now centres the
   artefact 30px below the true optical centre at 873px height (3.4%), which
   is well under the threshold where anyone reads it as misaligned.
   Chromium keeps centred overflow reachable in a scroll container (verified:
   a 2000px probe in a 560px box still scrolls to its first row), so the
   smaller content box this creates needs no `safe center` companion.

   Every consumer repeats the value as a var() fallback. That is not
   belt-and-braces: this file is a REFERENCE that gets copied in pieces, and
   a page that takes the section rules without this declaration would have
   the whole `padding` shorthand invalidated at computed-value time — losing
   the horizontal gutter too, silently, with no chrome reserve either. */
html[data-template="design"] {
  --chrome-safe-top: 5.75rem;
  --chrome-safe-bottom: 2rem;
}

/* Iteration sections fill the viewport. Screens inside do too —
   only the active one is visible (hidden attribute on the others).
   Outside design mode iterations stay in normal document flow. */
[data-template="design"] section[data-iteration] { position: absolute; inset: 0; }
section[data-iteration][hidden] { display: none; }
[data-template="design"] section[data-screen] {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  /* Chrome safe area top, plain gutter sides and bottom. */
  padding: var(--chrome-safe-top, 5.75rem) 2rem var(--chrome-safe-bottom, 2rem);
  overflow-y: auto;
  animation: screen-in 0.25s ease;
}
section[data-screen][hidden] { display: none; }
/* Structural backstop for the "exactly one of these is on screen" invariant.
   `hidden` is the switchers' mechanism, and the markup above asks for it on
   every inactive design and screen — but nothing enforces that, and these
   boxes are position:absolute/inset:0. A single forgotten `hidden` therefore
   does not misplace a section, it paints every sibling onto the same square:
   three designs' mockups drawn on top of each other, their headings and
   labels interleaved, the page unreadable and every click ambiguous.
   The active flags are already this page's own source of truth — both
   activeDesign() and activeScreen() resolve by them, and showDesign() /
   showScreen() keep them in step with `hidden` on every switch — so they can
   carry the visibility too. Both rules are `:has()`-guarded: they bite only
   once a sibling IS marked active, so markup that omits the flags entirely
   degrades to the old behaviour instead of blanking the canvas. */
section[data-iteration]:has(> section[data-design][data-design-active="true"])
  > section[data-design]:not([data-design-active="true"]) { display: none; }
section[data-design]:has(section[data-screen][data-screen-active="true"])
  section[data-screen]:not([data-screen-active="true"]) { display: none; }
@keyframes screen-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ── Views (optional, § Views (optional)) — top-level siblings of
   section[data-design]. Unlike a screen, a view SCROLLS inside its own box
   — body stays overflow:hidden throughout design mode (see the html/body
   rule above), only .view-frame's ancestor here gets overflow-y. Same
   position:absolute/inset:0 fullscreen treatment as a screen otherwise, so
   switching between a design and a view never shifts the surrounding
   chrome (indicator/switcher/FABs stay put). */
[data-template="design"] section[data-view] {
  position: absolute; inset: 0;
  /* Same chrome safe area as a screen — a view is the other thing that can
     be full-height, and it is the one that always scrolls. */
  padding: var(--chrome-safe-top, 5.75rem) 2rem var(--chrome-safe-bottom, 2rem);
  overflow-y: auto;
  animation: screen-in 0.25s ease;
}
section[data-view][hidden] { display: none; }
/* Same backstop, the other direction: outside view mode NO view paints, flag
   or not. A view is fullscreen and absolutely positioned like a screen, so a
   view that boots without `hidden` covers the design the page opened on.
   body[data-view-active] is maintained by showView() (true) and by
   showDesign() + the iteration switch (false), and its ABSENCE — nothing ran
   yet — reads as "not in view mode", which is exactly the boot state. */
body:not([data-view-active="true"]) section[data-view] { display: none; }
.view-frame { max-width: 860px; margin: 0 auto; }
/* Comparison view kind — see § Views (optional) → View kind `comparison`. */
.cmp-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
  margin: 1.25rem 0;
}
.cmp-option {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 12px;
  padding: 1rem 1.25rem;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 60%, transparent);
}
.cmp-favourite {
  display: flex; flex-wrap: wrap; align-items: center; gap: 1rem;
  border: 1px solid var(--border-color, #30363d); border-radius: 10px;
  padding: 0.75rem 1rem; margin: 1rem 0;
}
.cmp-favourite legend { padding: 0 0.4rem; font-size: 0.85rem; color: var(--text-secondary); }
/* data-compare-layout="table": the comparison IS the table. Wrapped in its
   own scroll container so five options never widen the page — the view
   scrolls vertically, this one horizontally, and body never scrolls. */
.view-compare[data-compare-layout="table"] .cmp-options { display: block; overflow-x: auto; }
.cmp-table { width: 100%; min-width: 34rem; border-collapse: collapse; margin: 1rem 0; }
.cmp-table th, .cmp-table td {
  border: 1px solid var(--border-color); padding: 0.55rem 0.7rem;
  text-align: left; vertical-align: top; font-size: 0.9rem;
}
.cmp-table thead th { position: sticky; top: 0; background: var(--bg-secondary, #161b22); }
.cmp-table tbody th { font-weight: 500; color: var(--text-secondary); white-space: nowrap; }
.cmp-table tr:hover td { background: rgba(127, 127, 127, 0.06); }
.cmp-table .cmp-verdict-row td { border-top: 2px solid var(--border-color); }
.cmp-matrix { width: 100%; border-collapse: collapse; margin: 1rem 0; }
.cmp-matrix th, .cmp-matrix td {
  border: 1px solid var(--border-color, #30363d); padding: 0.5rem 0.75rem;
  text-align: left; font-size: 0.9rem;
}

/* Design-only chrome: FABs, screen indicator and feedback dock exist in the
   DOM on every page but must only render in design mode. The `html` type
   selector is REQUIRED — a bare `:not([data-template="design"])` also matches
   <body> (which never carries the attribute) and would hide the chrome in
   design mode too. */
html:not([data-template="design"]) .screen-indicator,
html:not([data-template="design"]) .panel-fab,
html:not([data-template="design"]) .feedback-fab,
html:not([data-template="design"]) .feedback-dock,
html:not([data-template="design"]) .viewport-toggle,
html:not([data-template="design"]) .design-switcher,
html:not([data-template="design"]) .anno-toggle-fab,
html:not([data-template="design"]) .anno-layer { display: none !important; }

/* The panel carries BOTH navs because a page may mix iteration templates:
   #screen-nav for design iterations, #section-nav for decision/free ones
   (incl. the final report). Exactly one may render at a time, and the swap
   must be driven by the template, never by JS: buildDesignUI() returns early
   when the visible iteration has no design (`if (!active) return`), BEFORE it
   clears nav.innerHTML — so on a decision tab the previous design's entries
   are still sitting in #screen-nav. Without this rule they render as a dead
   TOC whose headings switch to a design nobody is looking at. */
html:not([data-template="design"]) #screen-nav,
html[data-template="design"] #section-nav { display: none !important; }

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

/* ── Annotation layer eye pill — left edge, directly below the screen
   indicator (see the top-edge partition comment at .panel-fab below for the
   3.75rem derivation). `hidden` by default in the markup; JS only unhides it
   once the active screen has ≥1 annotation. Sits between the design switcher
   (z-index 95) and the two FABs (z-index 100) — it is chrome of the same
   weight as the switcher, not as load-bearing as the FABs. Theming hooks:
   restyle via --anno-accent / --anno-bubble-bg, never by overriding this
   rule's geometry per page (same discipline as the FAB pair below). */
.anno-toggle-fab {
  position: fixed; top: 3.75rem; left: 1rem; z-index: 96;
  display: flex; align-items: center; gap: 0.35rem;
  padding: 0.35rem 0.7rem; border-radius: 999px; border: none;
  background: color-mix(in srgb, var(--panel-bg) 85%, transparent);
  border: 1px solid var(--border-color);
  color: var(--text-secondary); font-size: 0.8rem;
  backdrop-filter: blur(6px);
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.anno-toggle-fab:hover { transform: scale(1.04); }
.anno-toggle-fab[hidden] { display: none; }
.anno-toggle-fab .anno-eye { font-size: 0.95rem; line-height: 1; }
.anno-toggle-fab .anno-count {
  min-width: 1.1rem; text-align: center; font-weight: 600; color: var(--text);
}
/* Hidden layer state: the eye pill itself always stays visible/clickable
   (it is the only remnant, per spec) — everything ELSE the layer owns
   disappears completely, not just dims. */
body.anno-hidden .anno-toggle-fab .anno-eye { opacity: 0.5; }
body.anno-hidden .anno-layer { display: none !important; }
/* Auto-hides while the ☰ panel is open, same treatment as the design
   switcher — both are secondary chrome the overlay panel supersedes. */
body.panel-open .anno-toggle-fab { opacity: 0; pointer-events: none; }

/* ── Annotation layer — pins pinned to a screen element via percentage
   coordinates (--anno-x / --anno-y), each with a short leader line to a
   speech bubble. Every visual property below is a CSS custom property with
   a sane default so a concept can restyle the layer to match its own theme
   without touching the data-attribute contract (§ Annotation Layer). ── */
.anno-layer {
  position: absolute; inset: 0; pointer-events: none; z-index: 40;
}
.anno {
  position: absolute;
  left: var(--anno-x, 50%); top: var(--anno-y, 50%);
  transform: translate(-50%, -50%);
  pointer-events: auto;
}
.anno-pin {
  width: var(--anno-pin-size, 28px); height: var(--anno-pin-size, 28px);
  border-radius: 50%;
  border: 2px solid var(--anno-accent, var(--accent-color, #58a6ff));
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  color: var(--anno-accent, var(--accent-color, #58a6ff));
  font-size: 0.8rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  transition: transform 0.15s;
}
.anno-pin:hover { transform: scale(1.08); }
/* Answered pins invert to a filled state — visibly different at a glance
   from the still-open questions. Recomputed on every input, never only at
   generation time (see wireAnnotationLayer()). */
.anno-pin[data-answered="true"] {
  background: var(--anno-accent, var(--accent-color, #58a6ff));
  color: #fff;
}
.anno-bubble {
  position: absolute;
  z-index: 1;
  min-width: 180px; max-width: min(280px, 60vw);
  background: var(--anno-bubble-bg, var(--panel-bg, #161b22));
  border: 1px solid var(--border-color, #30363d);
  border-radius: var(--anno-bubble-radius, 12px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  font-size: 0.85rem;
}
/* One open bubble reads above every collapsed pin/bubble around it. Uses
   :has() rather than a JS-set attribute — same pattern as the single-screen
   collapse rules above (body[data-single-screen] .feedback-section:has(...)). */
.anno:has(.anno-bubble[data-open="true"]) { z-index: 2; }
.anno-bubble-summary {
  display: flex; align-items: center; gap: 0.4rem; width: 100%;
  padding: 0.55rem 0.75rem; border: none; background: none; cursor: pointer;
  color: var(--text-color, #c9d1d9); text-align: left; font: inherit;
}
.anno-bubble-question {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.anno-bubble[data-open="true"] .anno-bubble-question { white-space: normal; }
.anno-chevron { transition: transform 0.15s; color: var(--text-secondary); }
.anno-bubble[data-open="true"] .anno-chevron { transform: rotate(90deg); }
.anno-bubble-body { display: none; flex-direction: column; gap: 0.5rem; padding: 0 0.75rem 0.75rem; }
.anno-bubble[data-open="true"] .anno-bubble-body { display: flex; }
.anno-answer {
  width: 100%; min-height: 64px; resize: vertical;
  padding: 0.5rem 0.6rem; border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: var(--input-bg, #0d1117); color: var(--text-color, #c9d1d9);
  font: inherit;
}
/* Attachment mount — deliberately empty, see § Annotation Layer. */
.attach-slot:empty { display: none; }
/* …and deliberately hidden while the field it belongs to is. The dock builds
   one textarea PER screen / design / view and hides all but the active one
   (§ Layout JS), but `.attach-slot` is that textarea's SIBLING, not its child:
   the moment initCommentAttachments() mounts a bar the slot stops being
   `:empty`, so without this rule every inactive field's bar renders under the
   one visible textarea — a stack of N identical 📎 rows instead of one.
   The mount is always emitted immediately after its textarea, so the adjacent
   sibling combinator ties their visibility together with no JS to keep in
   sync — showScreen()/showDesign()/showView() only touch `ta.hidden`. The
   `.attach-bar` half covers the mountless fallback path, where the bar is
   inserted straight after the textarea instead of into a slot. */
textarea[hidden] + .attach-slot,
textarea[hidden] + .attach-bar { display: none; }
/* Leader line + bubble offset, one rule pair per side. The line is a short
   fixed-length connector (14px), never computed at runtime. */
.anno[data-anno-side="right"] .anno-bubble { left: calc(var(--anno-pin-size, 28px) + 14px); top: 50%; transform: translateY(-50%); }
.anno[data-anno-side="right"] .anno-bubble::before { content: ''; position: absolute; top: 50%; left: -14px; width: 14px; height: 2px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateY(-50%); }
.anno[data-anno-side="left"] .anno-bubble { right: calc(var(--anno-pin-size, 28px) + 14px); top: 50%; transform: translateY(-50%); }
.anno[data-anno-side="left"] .anno-bubble::before { content: ''; position: absolute; top: 50%; right: -14px; width: 14px; height: 2px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateY(-50%); }
.anno[data-anno-side="top"] .anno-bubble { left: 50%; bottom: calc(var(--anno-pin-size, 28px) + 14px); transform: translateX(-50%); }
.anno[data-anno-side="top"] .anno-bubble::before { content: ''; position: absolute; left: 50%; bottom: -14px; width: 2px; height: 14px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateX(-50%); }
.anno[data-anno-side="bottom"] .anno-bubble { left: 50%; top: calc(var(--anno-pin-size, 28px) + 14px); transform: translateX(-50%); }
.anno[data-anno-side="bottom"] .anno-bubble::before { content: ''; position: absolute; left: 50%; top: -14px; width: 2px; height: 14px; background: var(--anno-accent, var(--accent-color, #58a6ff)); transform: translateX(-50%); }

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

/* ── View segments (§ Views (optional)) — same row as the design segments,
   separated by a thin divider so switching between a design and a question
   about it is one click. Same class family shape as .design-switch-item on
   purpose: they read as one continuous control, not two bars glued
   together. Only rendered (by buildDesignUI()) when the iteration has ≥1
   view — a design-only iteration never emits either. */
.switcher-divider {
  align-self: center;
  width: 1px; height: 1.1rem;
  margin: 0 2px;
  background: var(--border-color);
  flex: none;
}
.design-switcher:not(:hover):not(:focus-within) .switcher-divider { width: 0; margin: 0; overflow: hidden; }
.view-switch-item {
  border: none; background: transparent; cursor: pointer;
  padding: 0.35rem 0.85rem; border-radius: 999px;
  font-size: 0.8rem; color: var(--text-secondary);
  white-space: nowrap; transition: background 0.15s, color 0.15s;
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
.design-switcher:not(:hover):not(:focus-within) .view-switch-item:not([data-active="true"]) {
  width: 0; padding: 0; margin: 0; overflow: hidden; pointer-events: none;
}
.view-switch-item[data-active="true"] {
  color: var(--text); font-weight: 600;
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
}
.view-switch-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
/* Resting state: if a VIEW is the active item, its own segment must stay
   visible even though the bar is collapsed — same rule the resting design
   segment already gets, just for the sibling class. */
.design-switcher:not(:hover):not(:focus-within) .design-switch-item[data-active="true"] { width: auto; padding: 0.35rem 0.85rem; }

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

/* ── The two FABs are ONE component with two positions ──
   They are the only floating chrome on a design page, they sit on the same
   right-hand edge, and the user reads them as a pair — so every property
   that governs their shape lives in this single rule and NOTHING below may
   override size, radius, padding or typography. Divergent sizes (the old
   56px ☰ vs 64px 💬) read as an accident, and per-page tweaks made it worse:
   across concepts the two ended up visibly different every time.
   `box-sizing`, `padding: 0`, `line-height: 1` and the flex centring are
   what keep them perfectly circular with the glyph centred — a bare
   width/height on a <button> still inherits UA padding and baseline
   metrics, which is how "round" turns into "slightly egg-shaped". */
.panel-fab,
.feedback-fab {
  position: fixed;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  padding: 0;
  border-radius: 50%;
  border: none;
  background: var(--accent-color, #58a6ff);
  color: #fff;
  font-size: 1.6rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  transition: transform 0.2s, opacity 0.2s;
}
/* ☰ lives top-right (Wave 3). The three top-edge overlays partition the
   width by construction rather than by hope:
     screen indicator  1rem … 33vw - 0.5rem   (max-width cap + ellipsis)
     design switcher   33vw … 67vw            (max-width: 34vw, centred)
     ☰ FAB             100vw - 92px … 100vw - 2rem   (60px + 2rem margin)
   Those bands cannot intersect for any viewport width where
   67vw < 100vw - 92px, i.e. above 279px — below that the layout is out of
   scope anyway. Measured in Edge at 1280/768/375px: no overlap at any of
   the three. Before the caps existed the indicator overlapped the switcher
   by 21px at 768px and completely at 375px, where it also reached the ☰
   FAB. 💬 lives bottom-right, clear of the top edge entirely.

   #anno-toggle (the optional annotation eye pill) does NOT compete for this
   horizontal partition at all — it sits on a SEPARATE row, left edge,
   directly below the screen indicator: `top: 3.75rem; left: 1rem`. That
   offset is fixed regardless of viewport width because the indicator's own
   height never changes: `.screen-indicator` is `white-space: nowrap` with a
   `max-width` + ellipsis (it never wraps to a second line), so its height
   stays the padding + single-line-box height (~1.9rem) at every viewport,
   including the narrowest ones this file scopes to (≥279px, see above).
   `3.75rem` = indicator `top: 1rem` + its ~1.9rem measured height + a
   0.5rem breathing gap, rounded up. The pill's own content-width (glyph +
   counter) is small and fixed, so unlike the indicator/switcher it needs no
   max-width cap — there is nothing else sharing its row. */
.panel-fab { top: 2rem; right: 2rem; }
.feedback-fab { bottom: 2rem; right: 2rem; }
.panel-fab:hover,
.feedback-fab:hover { transform: scale(1.08); }
/* Only the ☰ panel FAB hides when its panel opens (the decision panel is
   a full overlay). The 💬 feedback FAB stays visible while the dock is
   open so the user can toggle it back closed via the same FAB. */
.panel-fab.hidden { opacity: 0; pointer-events: none; }

/* ── One-shot attention pulse on the 💬 FAB ──
   The dock is where every note is written, and an unlabelled emoji circle in
   a corner is genuinely missable — so the FAB announces itself exactly three
   times, then never again: the JS strips `data-untouched` on the first dock
   open OR the first keystroke inside the dock, so a returning user is not
   nagged. It is `animation`, not a class, so it costs nothing once the
   attribute is gone.
   Geometry is OFF LIMITS here (gate P13): box-shadow and transform ONLY, no
   width/height/border-radius/padding — those live in the shared
   .panel-fab/.feedback-fab rule and the two FABs must stay one component.
   transform: scale() also composes with the :hover scale rather than
   fighting it, since both write the same property and hover wins by
   source order while pointing. */
@keyframes fabPulse {
  0%, 100% { transform: scale(1);    box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  50%      { transform: scale(1.12); box-shadow: 0 4px 12px rgba(0,0,0,0.3), 0 0 0 12px rgba(88,166,255,0.18); }
}
.feedback-fab[data-untouched="true"] { animation: fabPulse 2.6s ease-in-out 3; }
@media (prefers-reduced-motion: reduce) {
  /* No substitute cue: the tooltip is the discoverability path that does not
     move, and it is present either way. */
  .feedback-fab[data-untouched="true"] { animation: none; }
}

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

/* ── Views group (§ Views (optional)) — second .screen-nav-group, only
   rendered when the iteration has ≥1 view. The heading is a plain label,
   NOT a button (unlike .screen-nav-design-heading): there is no single
   "views" thing to switch to, only individual views below it. */
.screen-nav-views-heading {
  padding: 0.5rem 0.85rem 0.25rem;
  color: var(--text-secondary); font-size: 0.75rem;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
}
.screen-nav-view-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.6rem 0.85rem; border-radius: 8px; text-decoration: none;
  color: var(--text-color, #c9d1d9); font-size: 0.95rem;
  border: 1px solid var(--border-color); background: transparent;
  cursor: pointer; transition: all 0.15s; text-align: left;
}
.screen-nav-view-item:hover { background: color-mix(in srgb, var(--accent-color) 10%, transparent); }
.screen-nav-view-item[data-active="true"] {
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border-color: var(--accent-color); font-weight: 600;
}
.screen-nav-view-item .has-notes { color: var(--warning-color); font-size: 0.75rem; }

/* ── Feedback Dock — Speech-Bubble anchored to the 💬 FAB (bottom-right) ──
   Geometry: ☰ lives top-right, 💬 bottom-right (60px). The dock is anchored
   to the FAB's corner and has EXACTLY TWO sizes — never a viewport-
   proportional one, never shrink-to-content:
     compact  420px wide  — one general note (single design, single screen)
     wide     560px wide  — general + design + per-screen notes
   Both sizes are deliberate. A dock that spans the page turns every textarea
   into one 1200px line nobody ever wraps in; a dock sized to its content
   becomes a box you cannot type three lines into without scrolling. Which
   size applies is decided in JS by applyDockSize() from the same
   body[data-single-*] flags the rest of the layout uses, so the same
   iteration shape always yields the same dock.
   * right = FAB.right (2rem)             → bubble's right edge aligns with FAB
   * bottom = FAB.bottom + 60 - 6px       → bubble sits directly above the 60px
                                            FAB with a hair of overlap so the
                                            visual connection reads as "the
                                            bubble grows out of the FAB".
   The dock no longer reserves padding for the FAB: it now ends above it
   rather than spanning across it. The FAB keeps its higher z-index so it
   stays visible and clickable while the dock is open — clicking it toggles
   the dock. */
.feedback-dock {
  position: fixed;
  left: auto;
  right: 2rem;
  bottom: calc(2rem + 60px - 6px);
  width: min(420px, calc(100vw - 4rem));
  max-height: min(58vh, 460px);
  padding: 1.25rem 1.5rem 1.5rem;
  background: var(--panel-bg, #161b22);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 18px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.25);
  z-index: 180;
  overflow-y: auto;
  display: none;
  flex-direction: column;
  gap: 1.1rem;
  transform-origin: 100% 100%; /* anchor: the 💬 FAB it grows out of */
}
.feedback-dock[data-size="wide"] {
  width: min(560px, calc(100vw - 4rem));
  max-height: min(72vh, 620px);
}
/* Work package B — user-controlled maximise. Deliberately keyed off a
   SEPARATE attribute (data-user-maximized), not a third data-size value:
   applyDockSize() (§ Layout JS) still only ever assigns compact/wide from
   the iteration shape — exactly the same two sizes as before — and this
   rule composes on top of whichever one is active by appearing later in
   the stylesheet (same specificity, source-order wins). */
.feedback-dock[data-size][data-user-maximized="true"] {
  width: min(1100px, calc(100vw - 4rem));
  max-height: min(82vh, 860px);
}
.feedback-dock[data-size][data-user-maximized="true"] .feedback-section textarea {
  min-height: 220px;
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

/* Maximise/restore — a DISTINCT control from minimise (above): minimise
   closes the dock, this one only resizes it. Same visual language so the
   two read as a pair, but a different icon/meaning entirely. */
.feedback-maximize-btn {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary, #8b949e);
  font-size: 1.1rem; line-height: 1;
  padding: 0.2rem 0.4rem; border-radius: 6px; margin-right: 0.15rem;
  transition: background 0.15s, color 0.15s;
}
.feedback-maximize-btn:hover {
  background: color-mix(in srgb, var(--text-color) 12%, transparent);
  color: var(--text-color, #c9d1d9);
}
.feedback-maximize-btn[aria-pressed="true"] { color: var(--accent-color); }

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

/* Narrow viewports (≤560px): the two fixed widths stop making sense below
   the compact size, so the dock spans the viewport with tight margins.
   Both size variants collapse to the same geometry here. */
@media (max-width: 560px) {
  .feedback-dock,
  .feedback-dock[data-size="wide"],
  .feedback-dock[data-size][data-user-maximized="true"] {
    left: 0.75rem;
    right: 0.75rem;
    width: auto;
    max-height: 62vh;
    padding: 1rem;
    border-radius: 14px;
  }
}

/* Hidden per-screen / per-design / per-view textareas: only the active one
   shown. #view-textareas belongs here for the same reason the other two do —
   buildViewTextareas() hides every one of its textareas identically. */
#screen-textareas textarea[hidden],
#design-textareas textarea[hidden],
#view-textareas textarea[hidden] { display: none; }

/* Single-screen design: hide the per-screen feedback section + its own
   leading divider. Order is general -> design -> page, so the divider that
   must disappear with the page row is the one immediately BEFORE it, not
   the one before general (which is always first, no leading divider). Only
   general (and, if >=2 designs, per-design) notes remain visible.
   body[data-single-screen] is the correct scope HERE: the dock always talks
   about the screen currently on the canvas, so an active-design flag is
   exactly what it needs. */
body[data-single-screen="true"] .feedback-section:has(#screen-textareas),
body[data-single-screen="true"] .feedback-divider:has(+ .feedback-section #screen-textareas) {
  display: none;
}

/* The panel TOC collapses PER GROUP, never per body. #screen-nav is a
   CROSS-design container: one .screen-nav-group per design, each led by the
   heading that switches to it. body[data-single-screen] is written by
   updateScreenScope() from the ACTIVE design's screen count, so gating the
   container on it blanked the entire table of contents — every other
   design's entry, and the only in-panel way back — the moment the user
   switched to a design that happened to hold one screen. The flag belongs
   on the group, stamped once per design by buildDesignUI(), where it is
   also stable across switches instead of flipping under the user. */
.screen-nav-group[data-single-screen="true"] .screen-nav-item { display: none; }

/* Only when there is genuinely nothing left to navigate — one design, that
   one design holds one screen, AND the iteration has no views — may the
   container itself go. Without this the emptied flex box keeps its
   border-bottom and paints a stray divider under the iteration tabs.
   The :has() guard is load-bearing, not defensive: the views group lives
   inside THIS container, and the only other route to a view is the
   .view-switch-item row inside .design-switcher — which
   body[data-single-design="true"] hides two rules down. Drop the guard and a
   single-design, single-screen iteration with views has no route to any of
   them at all, in either surface. "Nothing left to navigate" has to mean
   nothing, views included. */
body[data-single-design="true"][data-single-screen="true"]
  #screen-nav:not(:has(.screen-nav-view-item)) {
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

/* ── View mode dock swap (§ Views (optional)) — the dock never shows the
   design/screen rows and the view row at once. Default (no view active):
   the view row (built once per iteration, may be empty of any view) stays
   hidden along with its leading divider. Once a view IS active
   (body[data-view-active="true"], set by showView()/showDesign()), the
   design + screen rows and THEIR leading dividers hide instead, and the
   view row takes their place. Same :has()-based divider targeting as the
   single-screen/single-design rules above. */
body:not([data-view-active="true"]) .feedback-section:has(#view-textareas),
body:not([data-view-active="true"]) .feedback-divider:has(+ .feedback-section #view-textareas) {
  display: none;
}
body[data-view-active="true"] .feedback-section:has(#design-textareas),
body[data-view-active="true"] .feedback-divider:has(+ .feedback-section #design-textareas),
body[data-view-active="true"] .feedback-section:has(#screen-textareas),
body[data-view-active="true"] .feedback-divider:has(+ .feedback-section #screen-textareas) {
  display: none;
}

/* Indicator swap (§ Views (optional)) — belt-and-suspenders CSS mirror of
   the JS hidden-toggle in updateIndicator(); JS is authoritative (it also
   fills #active-view-label), this rule only guards against a stale paint
   between a view switch and the next updateIndicator() call. */
body[data-view-active="true"] #indicator-screen-info { display: none; }
body:not([data-view-active="true"]) #indicator-view { display: none; }

/* ── Viewport toggle — device switcher, bottom-left ──
   The fourth corner: indicator top-left, switcher top-centre, ☰ top-right,
   💬 bottom-right. It must read as the quietest element on the page, and it
   is deliberately 34px against the FABs' 60px — a third circle of the same
   size would read as a third action, which this is not. Do NOT fold it into
   the .panel-fab/.feedback-fab rule; that rule is one component with two
   positions and this is a different component.
   Corner arithmetic, so nobody has to re-derive it:
     toggle   left 32px … 32+160px = 192px   (expanded), top edge 66px
     💬 FAB   left 100vw - 92px                (60px + 2rem margin)
   The two can only meet below 284px viewport width, which is out of scope.
   Vertically the expanded toggle tops out at 66px while .feedback-dock
   bottoms out at calc(2rem + 60px - 6px) = 86px — a 20px gap that holds
   even where the dock becomes a full-width sheet at ≤560px. */
.viewport-toggle {
  position: fixed;
  left: 2rem;
  bottom: 2rem;
  /* Same tier as .screen-indicator: quiet corner chrome. Above
     .content-dimmer (50) so the view stays switchable after a submit,
     below .panel-backdrop (150), .feedback-dock (180) and the panel (200). */
  z-index: 90;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 34px;
  /* Resting state is a plain circle showing only the glyph. max-width — not
     width — is what animates: `width: auto` is not interpolable, and
     animating a fixed width re-positions the glyph mid-transition. With
     overflow: hidden the label reveals without the left edge ever moving,
     which is what keeps a bottom-LEFT anchored control growing rightward
     instead of drifting into the corner. */
  max-width: 34px;
  overflow: hidden;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color, #30363d) 70%, transparent);
  background: color-mix(in srgb, var(--panel-bg, #161b22) 70%, transparent);
  color: var(--text-secondary, #8b949e);
  /* Barely-there, but not the switcher's 0.18: that bar can afford near-
     invisibility because it carries a readable text label. An icon-only
     button at 0.18 is undiscoverable. */
  opacity: 0.55;
  cursor: pointer;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: max-width 0.22s cubic-bezier(0.2, 0.9, 0.3, 1),
              opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;
}
.viewport-toggle svg { flex: none; width: 20px; height: 20px; }
/* Exactly one glyph is visible, picked by the mode the JS wrote onto the
   button. Driving it from CSS keeps the JS free of SVG construction. */
.viewport-toggle svg { display: none; }
.viewport-toggle[data-mode="desktop"] svg[data-glyph="desktop"],
.viewport-toggle[data-mode="tablet"] svg[data-glyph="tablet"],
.viewport-toggle[data-mode="phone"] svg[data-glyph="phone"] { display: block; }
.viewport-toggle-label {
  font-size: 0.8rem;               /* .screen-indicator's scale */
  color: var(--text, #c9d1d9);
  white-space: nowrap;
  opacity: 0;
  /* Delayed so the text fades in once the pill has mostly finished
     widening — fading in while still clipped looks like chewed-off text. */
  transition: opacity 0.15s ease 0.05s;
}
.viewport-toggle:hover,
.viewport-toggle:focus-visible {
  max-width: 160px;
  opacity: 1;
  background: color-mix(in srgb, var(--panel-bg, #161b22) 92%, transparent);
  border-color: var(--border-color, #30363d);
}
.viewport-toggle:hover .viewport-toggle-label,
.viewport-toggle:focus-visible .viewport-toggle-label { opacity: 1; }
/* Outline, not a border swap: a border change would fight the max-width
   transition and shift the glyph by a pixel on focus. */
.viewport-toggle:focus-visible { outline: 2px solid var(--accent-color, #58a6ff); outline-offset: 2px; }
/* Press-in, deliberately the inverse of the FABs' :hover grow, so the two
   never read as the same gesture. */
.viewport-toggle:active { transform: scale(0.93); transition: transform 0.1s ease; }
/* One declared viewport is no choice, so there is no control. Same collapse
   idiom as body[data-single-design] / body[data-single-screen] above. */
body[data-single-viewport="true"] .viewport-toggle { display: none; }
/* A view (§ Views (optional)) replaces the design as the active top-level
   item — no screen is on display, so there is no device to switch. Mirrors
   the dock/indicator swaps that key off the same flag. */
body[data-view-active="true"] .viewport-toggle { display: none; }
/* Fades out under an open ☰ panel exactly like .design-switcher — it sits
   below the backdrop anyway, and a half-dimmed control invites dead clicks. */
body.panel-open .viewport-toggle { opacity: 0; pointer-events: none; }

/* ── Device stage — the portrait/landscape frame pair ──
   Only ever built for the ACTIVE screen, and only outside desktop mode.
   Desktop mode has no stage at all, which IS the visual distinction: bezels
   and a canvas wash appear, nothing more elaborate.
   The authored mockup stays in the DOM as the clone source and is hidden
   with display:none — NOT opacity or off-screen positioning, both of which
   leave it focusable and readable by a screen reader, i.e. the content would
   be announced three times instead of two. */
[data-template="design"] section[data-screen][data-device-mode] > *:not(.device-stage) { display: none; }
/* Device mode replaces the section's own scrolling with the stage's. Leaving
   overflow-y: auto here makes the scrollbar's appearance shrink clientWidth,
   which lowers the fit scale, which removes the scrollbar again — a visible
   oscillation, and a "ResizeObserver loop" warning in Chromium. */
[data-template="design"] section[data-screen][data-device-mode] { overflow: hidden; padding: var(--chrome-safe-top, 5.75rem) 1.5rem var(--chrome-safe-bottom, 2rem); }
.device-stage {
  align-self: stretch;             /* the section centres its children; the
                                      stage must instead fill it, or the
                                      available height is undefined and the
                                      fit maths has nothing to measure */
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* A quiet wash so the eye reads "staged device view" without a new colour:
     40% of --input-bg, already the recessed-surface token of this template. */
  background: color-mix(in srgb, var(--input-bg, #0d1117) 40%, transparent);
  border-radius: 12px;
}
/* Below MIN_DEVICE_SCALE the pair genuinely does not fit and scrolling beats
   squinting. Centred content that overflows its scroll container is unreachable
   at the leading edge, so the alignment flips with the overflow. */
.device-stage[data-clamped="true"] { overflow: auto; align-items: flex-start; justify-content: flex-start; }
/* transform: scale() leaves the LAYOUT box at full size. .device-fit is the
   compensator: JS sets it to the SCALED size while .device-pair scales inside
   it from the top-left corner. Without this pair of elements a scaled-down
   mock still reserves its full unscaled height, the section grows scrollbars
   around empty space, and the top of the stage ends up above the scroll
   origin where it cannot be reached at all. */
.device-fit { position: relative; flex: none; }
.device-pair {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  /* ONE gap for both axes, deliberately. fitDeviceStage() reads it once and
     scores the row and the column candidate with the same value, because the
     axis is not known until bestFit() has answered. An axis-specific gap
     override would therefore be scored with the PREVIOUS render's value and
     the pick would lag one switch behind. If a differing gap is ever wanted,
     bestFit() has to take one per axis — do not add a
     `[data-axis="…"] { gap }` rule here. */
  gap: 2rem;
}
/* Axis is chosen by JS from whichever direction yields the larger scale, not
   by a width breakpoint — see bestFit() for why a fixed breakpoint is wrong
   in both directions. */
.device-pair[data-axis="column"] { flex-direction: column; }
.device-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  /* Never shrink individually: the pair is scaled once, as a unit. Flex's
     default shrink would otherwise make the two frames different sizes and
     destroy the comparison the pair exists for. */
  flex: none;
}
/* Restrained bezel: one border in --panel-bg so it recedes instead of
   reading as glossy plastic, a hairline inset ring for definition against
   dark backgrounds, one soft shadow for elevation. Phones carry thinner
   bezels and rounder corners than tablets on every shipping device, so a
   single uniform radius reads as wrong to anyone who has held either. */
.device-bezel {
  box-sizing: content-box;
  background: var(--panel-bg, #161b22);
  border: var(--device-bezel, 10px) solid var(--panel-bg, #161b22);
  border-radius: var(--device-radius-outer, 20px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.35), inset 0 0 0 1px var(--border-color, #30363d);
}
.device-bezel[data-device="tablet"] { --device-bezel: 10px; --device-radius-outer: 20px; --device-radius-inner: 10px; }
.device-bezel[data-device="phone"]  { --device-bezel: 8px;  --device-radius-outer: 26px; --device-radius-inner: 18px; }
/* The simulated screen. It scrolls itself — that is what a real device's
   screen does, and it saves every mockup from managing its own scroll
   region. container-type: size is what makes @container device (…) inside
   the mock resolve against the SIMULATED size instead of the browser
   window; it is the only mechanism that can, since the window never
   changes. */
.device-viewport {
  width: var(--device-w);
  height: var(--device-h);
  border-radius: var(--device-radius-inner, 12px);
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--input-bg, #0d1117);
  container-type: size;
  container-name: device;
}
/* Same quiet-metadata register as .screen-indicator, so captions do not read
   as a new text style. */
.device-caption { font-size: 0.8rem; color: var(--text-secondary, #8b949e); text-align: center; }
.device-caption strong { color: var(--text, #c9d1d9); font-weight: 600; }
@media (prefers-reduced-motion: reduce) {
  /* The pill still expands — it has to, or the label is unreachable — it
     just snaps rather than animating. */
  .viewport-toggle { transition: opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease; }
  .viewport-toggle:active { transform: none; transition: none; }
  /* Nothing to disable on .device-pair: its transform is recomputed on every
     resize frame, so it is deliberately NOT transitioned in the base rule —
     an animated scale would lag a frame behind the .device-fit box that has
     to change instantly with it. */
}
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

1. Values survive a design switch. `restoreState()` is re-invoked only at the
   two points where the dock is (re)built — the design IIFE's own
   `DOMContentLoaded` handler and `iteration:changed` — so a node destroyed
   at any other moment is never rehydrated.
2. `saveState()` serialises only nodes present in the DOM. It merges its scan
   over the previously stored blob (see § State Persistence), so a destroyed
   textarea no longer DELETES its `text:{screen-id}` key — but the note is
   still invisible and unsubmittable until a node with that `data-comment`
   exists again, and `collectDesignDecisions()` reads the DOM, not storage.
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
  // Two values, deliberately: the device view is a VIEWING preference that
  // belongs to the reader, while what can actually be RENDERED belongs to
  // whatever the visible iteration and design declare.
  //   viewportPref — the last mode the user chose. Persisted. NEVER clamped.
  //   viewportMode — the effective mode, derived from pref ∩ declaration.
  // Collapsing the two into one variable silently downgrades the choice: a
  // page that mixes a design iteration with a decision one (the documented
  // split for entangled questions) clamps the single variable to `desktop`
  // the moment the user clicks the decision tab, and coming back shows a
  // desktop view they never asked for. Same for a design that declares fewer
  // form factors than its neighbour.
  let viewportPref = null;
  let viewportMode = 'desktop';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      lastScreenByDesign = saved._activeScreenByDesign || {};
      viewportPref = saved._viewportMode || null;
    }
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
  // Views (§ Views (optional)) — top-level siblings of section[data-design].
  // Mirrors designs()/activeDesign() above. A page with no data-view
  // sections simply yields an empty array everywhere below; every view
  // code path is additive and no-ops in that case.
  function views() {
    const it = visibleIteration();
    return it ? [...it.querySelectorAll('section[data-view]')] : [];
  }
  // Only returns a view that is BOTH marked active AND actually visible —
  // unlike activeDesign() above, a view's data-view-active can legitimately
  // go stale while a design is on screen (showDesign() does not touch it),
  // so callers that care about "what is on screen right now" must use this,
  // not a bare data-view-active lookup.
  function activeViewVisible() {
    const it = visibleIteration();
    return it ? it.querySelector('section[data-view][data-view-active="true"]:not([hidden])') : null;
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
      btn.addEventListener('click', () => { showDesign(d.dataset.design); });
      switcher.appendChild(btn);
    });
    // Views (§ Views (optional)) — appended to the SAME row after a thin
    // divider, only when the iteration has ≥1. Never rendered for a
    // design-only iteration (allViews.length === 0 short-circuits both the
    // divider and the loop, so the switcher's markup is byte-identical to
    // pre-views pages when no view exists).
    const allViews = views();
    if (allViews.length) {
      const divider = document.createElement('span');
      divider.className = 'switcher-divider';
      divider.setAttribute('aria-hidden', 'true');
      switcher.appendChild(divider);
      allViews.forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'view-switch-item';
        btn.type = 'button';
        btn.dataset.viewId = v.dataset.view;
        btn.dataset.active = 'false';
        btn.textContent = v.dataset.navLabel || v.dataset.view;
        btn.addEventListener('click', () => { showView(v.dataset.view); });
        switcher.appendChild(btn);
      });
    }

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
      heading.addEventListener('click', () => { showDesign(d.dataset.design); closePanel(); });
      group.appendChild(heading);

      const screens = [...d.querySelectorAll('section[data-screen][id]')];
      // Per-design collapse flag for the TOC (§ Layout CSS,
      // .screen-nav-group[data-single-screen]). Derived from THIS design's
      // own screens — body[data-single-screen] tracks only the design on the
      // canvas, and using it here would hide every other design's rows too,
      // flipping the whole TOC on every switch.
      group.dataset.singleScreen = String(screens.length <= 1);
      screens.forEach((sec, idx) => {
        const btn = document.createElement('button');
        btn.className = 'screen-nav-item';
        btn.type = 'button';
        btn.dataset.screenId = sec.id;
        btn.dataset.designId = d.dataset.design;
        btn.innerHTML = `<span><span class="screen-idx">${idx + 1}.</span>${sec.dataset.navLabel || sec.id}</span>
          <span class="has-notes" data-note-marker></span>`;
        btn.addEventListener('click', () => {
          // Resolve the active design at CLICK time. buildDesignUI() only
          // runs on iteration:changed / DOMContentLoaded, never on a design
          // switch, so the build-time `active` above goes stale the moment
          // the ghost bar is used — and a stale `d === active` sends a
          // FOREIGN screen id into showScreen(), which then hides every
          // screen of the design actually on the canvas (blank page).
          const cur = activeDesign();
          if (!cur || cur.dataset.design !== d.dataset.design) showDesign(d.dataset.design, sec.id);
          else showScreen(sec.id);
          closePanel();
        });
        group.appendChild(btn);
      });
      nav.appendChild(group);
    });

    // Second nav group, below the designs — only when the iteration has
    // ≥1 view. Heading is a plain label (no click handler): there is
    // nothing to "switch to" at the group level, only the individual views
    // nested under it.
    if (allViews.length) {
      const viewGroup = document.createElement('div');
      viewGroup.className = 'screen-nav-group screen-nav-views-group';
      const heading = document.createElement('div');
      heading.className = 'screen-nav-views-heading';
      heading.textContent = '{{design.nav_views_heading}}';
      viewGroup.appendChild(heading);
      allViews.forEach(v => {
        const btn = document.createElement('button');
        btn.className = 'screen-nav-view-item';
        btn.type = 'button';
        btn.dataset.viewId = v.dataset.view;
        btn.innerHTML = `<span>${v.dataset.navLabel || v.dataset.view}</span>
          <span class="has-notes" data-view-note-marker="${v.dataset.view}"></span>`;
        btn.addEventListener('click', () => { showView(v.dataset.view); closePanel(); });
        viewGroup.appendChild(btn);
      });
      nav.appendChild(viewGroup);
    }

    buildDesignTextareas(allDesigns, active);
    buildScreenTextareas(allDesigns);
    buildViewTextareas(allViews);
    updateScreenScope(active);
    // § Attachments — rebuild bars for the freshly (re)created textareas
    // and re-render any attachments already tracked for their slot keys.
    if (typeof initCommentAttachments === 'function') initCommentAttachments();
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
      ta.dataset.attachable = '';
      ta.placeholder = placeholder;
      ta.hidden = d !== active;
      if (carried[ta.dataset.comment]) ta.value = carried[ta.dataset.comment];
      container.appendChild(ta);
      // The mount goes DIRECTLY after its textarea — nothing in between.
      // `textarea[hidden] + .attach-slot` (§ Layout CSS) is what hides an
      // inactive field's 📎 bar, and it only reaches an adjacent sibling.
      // Same rule in buildScreenTextareas/buildViewTextareas below.
      const slot = document.createElement('div');
      slot.className = 'attach-slot';
      slot.dataset.attachSlot = ta.dataset.comment;
      container.appendChild(slot);
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
        ta.dataset.attachable = '';
        ta.placeholder = placeholder;
        ta.hidden = true;
        if (carried[sec.id]) ta.value = carried[sec.id];
        container.appendChild(ta);
        const slot = document.createElement('div');
        slot.className = 'attach-slot';
        slot.dataset.attachSlot = sec.id;
        container.appendChild(slot);
      });
    });
  }

  // Per-view textareas (💬) — one per view of the iteration, built ONCE per
  // iteration exactly like buildDesignTextareas/buildScreenTextareas above,
  // for the same reason: rebuilding on every design/view switch would drop
  // unsent text and truncate collectDesignDecisions()'s comments.views scan
  // (§ Views (optional)). Only the currently-active view's textarea is
  // shown; showView() below flips `hidden`, nothing is ever destroyed.
  function buildViewTextareas(allViews) {
    const container = document.getElementById('view-textareas');
    if (!container) return;
    const placeholder = container.dataset.placeholder || '';
    const carried = harvestDockValues();
    container.innerHTML = '';
    allViews.forEach(v => {
      const ta = document.createElement('textarea');
      ta.dataset.comment = `view-${v.dataset.view}`;
      ta.dataset.viewComment = v.dataset.view;
      ta.dataset.attachable = '';
      ta.placeholder = placeholder;
      ta.hidden = true;
      if (carried[ta.dataset.comment]) ta.value = carried[ta.dataset.comment];
      container.appendChild(ta);
      const slot = document.createElement('div');
      slot.className = 'attach-slot';
      slot.dataset.attachSlot = ta.dataset.comment;
      container.appendChild(slot);
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
    // Single-screen designs: hide the per-screen FEEDBACK row (and, combined
    // with body[data-single-design], the now-empty #screen-nav). This flag
    // describes the design currently on the canvas, so it must never gate the
    // panel's per-design rows on its own — buildDesignUI() stamps
    // group.dataset.singleScreen for those. See § Layout CSS.
    document.body.dataset.singleScreen = screens.length <= 1 ? 'true' : 'false';
  }

  // ── Responsive device views ──────────────────────────────────────────
  // See § Responsive device views for the declaration attributes. Desktop
  // mode is a no-op by construction: no stage is built, nothing is cloned,
  // and the layout is what it was before this code existed.
  const VIEWPORT_MODES = ['desktop', 'tablet', 'phone'];
  const VIEWPORT_ORIENTATIONS = ['portrait', 'landscape'];
  // Portrait CSS pixels. iPad Air 11" and iPhone 15 — mid-range devices
  // whose widths (834 / 390) are the ones layouts actually break at.
  const DEVICE_SIZES = { tablet: [834, 1194], phone: [390, 844] };
  // Below this a frame's text is unreadable; scrolling the pair is the
  // better degradation than shrinking further.
  const MIN_DEVICE_SCALE = 0.3;
  const VIEWPORT_LABELS = (() => {
    const d = (document.getElementById('viewport-toggle') || {}).dataset || {};
    return {
      desktop: d.labelDesktop || 'Desktop', tablet: d.labelTablet || 'Tablet',
      phone: d.labelPhone || 'Phone',
      portrait: d.labelPortrait || 'Portrait', landscape: d.labelLandscape || 'Landscape'
    };
  })();

  // "834x1194" -> [834, 1194]. A malformed value falls back instead of
  // producing NaN geometry: a NaN width collapses the frame to 0px and the
  // mockup silently disappears with nothing logged anywhere.
  function parseDeviceSize(raw, fallback) {
    const m = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(String(raw == null ? '' : raw));
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : fallback.slice();
  }

  // Space/comma separated token list, filtered against `allowed`, order
  // preserved, duplicates dropped. Returns null when nothing valid remains so
  // callers can apply their own default rather than inheriting an empty list.
  function parseTokenList(raw, allowed) {
    const out = [];
    String(raw == null ? '' : raw).split(/[\s,]+/).forEach(tok => {
      const k = tok.trim().toLowerCase();
      if (k && allowed.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k);
    });
    return out.length ? out : null;
  }

  // Cycles the DECLARED order, never VIEWPORT_MODES: a tablet+phone concept
  // must not land on a desktop view its app does not have. An unknown current
  // value (index -1) wraps to the first entry.
  function nextViewportMode(modes, current) {
    if (!modes.length) return 'desktop';
    return modes[(modes.indexOf(current) + 1) % modes.length];
  }

  // Lays the pair out along whichever axis leaves the bigger uniform scale.
  // A fixed "stack below 900px" breakpoint is wrong in BOTH directions:
  // measured for a phone pair in a 900×800 window, side-by-side yields 0.70
  // and stacked only 0.55, while a 1000×600 window is the reverse. Deciding
  // from the two candidate scales is the same three lines and is right at
  // every size. Ties go to `row` — side by side is the point of the view.
  function bestFit(frames, availW, availH, gap) {
    const add = (a, b) => a + b;
    const span = gap * Math.max(0, frames.length - 1);
    const rowW = frames.map(f => f[0]).reduce(add, 0) + span;
    const rowH = frames.reduce((m, f) => Math.max(m, f[1]), 0);
    const colW = frames.reduce((m, f) => Math.max(m, f[0]), 0);
    const colH = frames.map(f => f[1]).reduce(add, 0) + span;
    const fit = (w, h) => (w > 0 && h > 0 && availW > 0 && availH > 0)
      ? Math.min(1, availW / w, availH / h) : 1;
    const row = fit(rowW, rowH);
    const col = fit(colW, colH);
    const axis = col > row ? 'column' : 'row';
    const raw = Math.max(row, col);
    return {
      axis,
      scale: Math.max(MIN_DEVICE_SCALE, raw),
      clamped: raw < MIN_DEVICE_SCALE,
      width: axis === 'row' ? rowW : colW,
      height: axis === 'row' ? rowH : colH
    };
  }

  // Resolution order: active design -> its iteration -> built-in default.
  // Declaring once on the iteration is the common case; the per-design
  // override exists for the rare concept whose designs target different form
  // factors. Because this reads the LIVE DOM on every call, a design switch
  // picks up the new declaration without buildDesignUI() having to re-run
  // (it deliberately does not — see buildScreenTextareas).
  function viewportSpec() {
    const design = activeDesign();
    const iter = visibleIteration();
    const read = key => (design && design.dataset[key]) || (iter && iter.dataset[key]) || '';
    const modes = parseTokenList(read('viewports'), VIEWPORT_MODES) || ['desktop'];
    const wanted = String(read('viewportDefault') || '').trim().toLowerCase();
    return {
      modes,
      orientations: parseTokenList(read('orientations'), VIEWPORT_ORIENTATIONS)
        || VIEWPORT_ORIENTATIONS.slice(),
      initial: modes.indexOf(wanted) >= 0 ? wanted : modes[0],
      sizes: {
        tablet: parseDeviceSize(read('deviceTablet'), DEVICE_SIZES.tablet),
        phone: parseDeviceSize(read('devicePhone'), DEVICE_SIZES.phone)
      }
    };
  }

  // Attributes that carry an id REFERENCE and must follow their target's
  // rename. Missing one of these is silent: the control still renders, it
  // just points at the other frame's copy.
  const ID_REF_ATTRS = ['for', 'form', 'list', 'headers',
                        'aria-labelledby', 'aria-describedby', 'aria-controls',
                        'aria-owns', 'aria-activedescendant', 'aria-details',
                        'aria-errormessage'];
  // SVG paints reference defs by url(#id); an un-rewritten one resolves to
  // the HIDDEN original's def, which works by accident in one frame and not
  // at all once the original is display:none in some browsers.
  const URL_REF_ATTRS = ['fill', 'stroke', 'clip-path', 'mask', 'filter',
                         'marker-start', 'marker-mid', 'marker-end', 'style'];
  // Deep-clones a subtree and namespaces every identifier in it. Without this
  // the frames are two elements sharing one id (getElementById resolves to
  // whichever comes first, label[for] focuses the wrong frame) and two radios
  // in ONE group — clicking the landscape copy would clear the portrait one.
  function prefixClone(node, prefix) {
    const clone = node.cloneNode(true);
    if (clone.nodeType !== 1) return clone;
    // Same reason as the top-level filter in renderDeviceStage: a layer
    // nested deeper than the screen's direct children must not reach a frame
    // either, or its answers become unpersistable.
    clone.querySelectorAll('[data-anno-layer]').forEach(el => el.remove());
    [clone].concat([...clone.querySelectorAll('*')]).forEach(el => {
      if (el.id) el.id = prefix + el.id;
      const name = el.getAttribute('name');
      if (name) el.setAttribute('name', prefix + name);
      // Never carried into a clone: it would yank focus out of whatever the
      // user was doing on every screen switch.
      el.removeAttribute('autofocus');
      ID_REF_ATTRS.forEach(attr => {
        const v = el.getAttribute(attr);
        if (v) el.setAttribute(attr, v.split(/\s+/).filter(Boolean).map(t => prefix + t).join(' '));
      });
      URL_REF_ATTRS.forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && v.indexOf('url(#') >= 0) {
          el.setAttribute(attr, v.replace(/url\(#([^)"']+)\)/g, (_, id) => 'url(#' + prefix + id + ')'));
        }
      });
      ['href', 'xlink:href'].forEach(attr => {
        const v = el.getAttribute(attr);
        if (v && v.charAt(0) === '#' && v.length > 1) el.setAttribute(attr, '#' + prefix + v.slice(1));
      });
    });
    return clone;
  }

  // Builds the stage for the ACTIVE screen only. Every other screen is
  // `hidden`, so cloning into all of them would duplicate the page for
  // nothing. Teardown is unconditional and page-wide: a stage left on the
  // iteration the user just switched away from keeps a stale copy alive and
  // would be found by the next fit pass.
  function renderDeviceStage(spec) {
    document.querySelectorAll('.device-stage').forEach(el => el.remove());
    document.querySelectorAll('section[data-screen][data-device-mode]')
      .forEach(s => { delete s.dataset.deviceMode; });
    if (viewportMode === 'desktop') return;
    // A view (§ Views (optional)) is the active top-level item instead of a
    // design: its screens are hidden, so there is nothing to frame. Teardown
    // above has already run, which is the whole point of returning here
    // rather than earlier.
    if (document.body.dataset.viewActive === 'true') return;
    const size = spec.sizes[viewportMode];
    const design = activeDesign();
    const screen = design && design.querySelector('section[data-screen][data-screen-active="true"]');
    if (!size || !screen) return;
    // The clone source is EVERY element child except a stage — not
    // `.device-frame`. That class is a documented convention with no CSS and
    // no gate behind it, so a page that lays its mock out differently is
    // legal today; keying on it would render empty frames on exactly those
    // pages, and look correct while doing it.
    // The annotation layer (§ Annotation Layer (optional)) is authored INSIDE
    // the screen, so a naive clone carries it into both frames. Its own IIFE
    // collects [data-anno-pin] and textarea[data-annotation] DOCUMENT-WIDE and
    // keys them by attribute value, so a cloned pin would open its bubble in
    // every copy — harmless — but a cloned ANSWER is a third textarea that
    // saveState() and the submit payload both skip, because clones are
    // excluded via [data-device-clone]. An answer typed inside a device frame
    // would be silently lost. Annotations therefore stay a desktop-view
    // affordance and the frames show the mockup itself.
    const source = [...screen.children]
      .filter(el => !el.classList.contains('device-stage') && !el.hasAttribute('data-anno-layer'));
    if (!source.length) return;

    const stage = document.createElement('div');
    stage.className = 'device-stage';
    // One marker for the whole subtree. saveState() and collectAllFormFields()
    // filter on it via closest() — the clones must never reach localStorage or
    // the submit payload, where they would triple every mock field under
    // names no human ever typed into.
    stage.setAttribute('data-device-clone', '');
    const fitBox = document.createElement('div');
    fitBox.className = 'device-fit';
    const pair = document.createElement('div');
    pair.className = 'device-pair';
    fitBox.appendChild(pair);
    stage.appendChild(fitBox);

    spec.orientations.forEach((orientation, i) => {
      const landscape = orientation === 'landscape';
      const w = landscape ? size[1] : size[0];
      const h = landscape ? size[0] : size[1];
      const shell = document.createElement('div');
      shell.className = 'device-shell';
      shell.dataset.device = viewportMode;
      shell.dataset.orientation = orientation;
      // Labelled, NOT aria-hidden. Both frames are interactive by design, and
      // aria-hidden over focusable content is an ARIA violation that produces
      // a worse experience than the duplication it hides. The duplication is
      // the point of this view; naming each frame is what makes it legible.
      shell.setAttribute('role', 'group');
      shell.setAttribute('aria-label',
        (VIEWPORT_LABELS[viewportMode] || viewportMode) + ' · ' +
        (VIEWPORT_LABELS[orientation] || orientation));

      const bezel = document.createElement('div');
      bezel.className = 'device-bezel';
      bezel.dataset.device = viewportMode;
      const vp = document.createElement('div');
      vp.className = 'device-viewport';
      vp.style.setProperty('--device-w', w + 'px');
      vp.style.setProperty('--device-h', h + 'px');
      const prefix = 'dv' + (i + 1) + '-';
      source.forEach(node => vp.appendChild(prefixClone(node, prefix)));
      bezel.appendChild(vp);

      const caption = document.createElement('div');
      caption.className = 'device-caption';
      const strong = document.createElement('strong');
      strong.textContent = VIEWPORT_LABELS[orientation] || orientation;
      caption.appendChild(strong);
      caption.appendChild(document.createTextNode(' · ' + w + ' × ' + h));

      shell.appendChild(bezel);
      shell.appendChild(caption);
      pair.appendChild(shell);
    });

    screen.appendChild(stage);
    screen.dataset.deviceMode = viewportMode;
    wireFrameMirroring(pair);
  }

  // The frames render one screen twice; a box ticked in one has to tick in
  // the other, or the pair reads as two different states of the same app.
  // Index matching is exact because both frames are clones of one source.
  // The handler assigns values WITHOUT dispatching further events: an echoed
  // `input` would re-enter this handler from the twin and loop forever, and
  // the clones are excluded from persistence anyway, so there is nothing
  // downstream that needs the echo. Listeners live on the pair, which is
  // destroyed and rebuilt on every switch — nothing to unbind, nothing to leak.
  function wireFrameMirroring(pair) {
    const SEL = 'input, select, textarea';
    const sync = e => {
      const el = e.target;
      if (!el || !el.matches || !el.matches(SEL)) return;
      const shell = el.closest('.device-shell');
      if (!shell) return;
      const idx = [...shell.querySelectorAll(SEL)].indexOf(el);
      if (idx < 0) return;
      pair.querySelectorAll('.device-shell').forEach(other => {
        if (other === shell) return;
        const twin = other.querySelectorAll(SEL)[idx];
        if (!twin) return;
        if (twin.type === 'checkbox' || twin.type === 'radio') twin.checked = el.checked;
        else twin.value = el.value;
      });
    };
    pair.addEventListener('input', sync);
    pair.addEventListener('change', sync);
  }

  // Measures the pair unscaled (offsetWidth/offsetHeight are pre-transform),
  // picks the axis, then writes the scaled size onto .device-fit so the
  // LAYOUT box matches what is actually painted. Skipping that step is what
  // puts a scrollbar around empty space and pushes the top of the stage above
  // the scroll origin, where it cannot be reached at all.
  function fitDeviceStage() {
    // Scoped to the active design, exactly like renderDeviceStage's lookup.
    // showDesign() hides the previous design but leaves its screens' own
    // data-screen-active flag set, so a document-wide query here is one
    // stale flag away from measuring a screen nobody is looking at.
    const design = activeDesign();
    const stage = design && design.querySelector(
      'section[data-screen][data-screen-active="true"] .device-stage');
    if (!stage) return;
    const pair = stage.querySelector('.device-pair');
    const fitBox = stage.querySelector('.device-fit');
    if (!pair || !fitBox) return;
    const shells = [...pair.children];
    if (!shells.length) return;
    const gap = parseFloat(getComputedStyle(pair).gap) || 0;
    const frames = shells.map(s => [s.offsetWidth, s.offsetHeight]);
    const box = stage.getBoundingClientRect();
    const res = bestFit(frames, box.width, box.height, gap);
    pair.dataset.axis = res.axis;
    pair.style.transform = 'scale(' + res.scale + ')';
    fitBox.style.width = Math.ceil(res.width * res.scale) + 'px';
    fitBox.style.height = Math.ceil(res.height * res.scale) + 'px';
    stage.dataset.clamped = res.clamped ? 'true' : 'false';
  }

  function renderViewportToggle(spec) {
    const btn = document.getElementById('viewport-toggle');
    if (!btn) return;
    const current = VIEWPORT_LABELS[viewportMode] || viewportMode;
    const upcoming = nextViewportMode(spec.modes, viewportMode);
    btn.dataset.mode = viewportMode;
    // Names the NEXT state, like #feedback-toggle's open/close label swap —
    // this is a cycle, not an on/off control, so aria-pressed would be a lie.
    const label = (btn.dataset.labelPrefix ? btn.dataset.labelPrefix + ': ' : '')
      + current + ' → ' + (VIEWPORT_LABELS[upcoming] || upcoming);
    btn.setAttribute('aria-label', label);
    btn.title = label;
    const text = btn.querySelector('.viewport-toggle-label');
    if (text) text.textContent = current;
  }

  // The one entry point. Idempotent, so every caller can just invoke it.
  // Derives the effective mode from the preference WITHOUT writing back to
  // it — see the two-variable comment at the top of this IIFE.
  function applyViewport() {
    const spec = viewportSpec();
    viewportMode = (viewportPref && spec.modes.indexOf(viewportPref) >= 0)
      ? viewportPref : spec.initial;
    document.body.dataset.viewportMode = viewportMode;   // what is rendered
    document.body.dataset.viewportPref = viewportPref || '';  // what was chosen
    document.body.dataset.singleViewport = spec.modes.length <= 1 ? 'true' : 'false';
    renderViewportToggle(spec);
    renderDeviceStage(spec);
    fitDeviceStage();
  }
  window.applyViewport = applyViewport;

  function cycleViewport() {
    const spec = viewportSpec();
    if (spec.modes.length <= 1) return;
    // Advances from what is CURRENTLY RENDERED, not from the stored
    // preference: the user is clicking what they can see.
    viewportPref = nextViewportMode(spec.modes, viewportMode);
    applyViewport();
    if (typeof saveState === 'function') saveState();
  }

  document.getElementById('viewport-toggle')?.addEventListener('click', cycleViewport);

  // Exactly ONE resize listener, installed here at IIFE level rather than in
  // the stage builder — installing it per build would accumulate one listener
  // per screen switch, each measuring a detached stage.
  let fitFrame = 0;
  function scheduleFit() {
    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitDeviceStage(); });
  }
  window.addEventListener('resize', scheduleFit);
  // Late-arriving webfonts and images change the mock's intrinsic size after
  // the first measurement.
  window.addEventListener('load', scheduleFit);

  // Switches the active design (and, within it, the given page or its
  // remembered last-viewed page). Closes over showScreen defined below.
  window.showDesign = function(designId, screenId) {
    const it = visibleIteration();
    if (!it) return;
    // Leaving view mode, if we were in it (§ Views (optional)) — no-op when
    // already in design mode (every view already hidden/inactive). Views'
    // own data-view-active memory is intentionally NOT preserved across a
    // design switch: unlike designs, there is no "last active view" to
    // return to, showView() is always an explicit click.
    it.querySelectorAll('section[data-view]').forEach(v => {
      v.hidden = true;
      v.dataset.viewActive = 'false';
    });
    document.querySelectorAll('.view-switch-item, .screen-nav-view-item').forEach(item => {
      item.dataset.active = 'false';
    });
    document.body.dataset.viewActive = 'false';
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
    // showScreen() is the usual route to applyViewport(). A design with no
    // screens has no target, so that route does not exist here — and the
    // device stage cloned for the PREVIOUS design's screen would stay in the
    // DOM, showing the old design's mockup under the new design's name.
    // Teardown lives inside renderDeviceStage(), so the call has to happen
    // either way.
    if (target) showScreen(target);
    else applyViewport();
    updateDesignNoteMarkers();
  };

  // Switches the active top-level item to a view (§ Views (optional)).
  // Mirrors showDesign() above: hides every OTHER top-level item (every
  // design AND every other view), marks the target visible + active, and
  // re-derives every piece of chrome that cares which item is on screen
  // (switcher, screen-nav, indicator, dock). Unlike showScreen(), there is
  // no "remembered" view to restore — the user always reaches a view via an
  // explicit click on its switcher segment or nav item.
  window.showView = function(viewId) {
    const it = visibleIteration();
    if (!it) return;
    // Hide every design (top-level) without touching data-design-active —
    // that attribute is design-vs-design memory, orthogonal to whether
    // design mode itself is what's on screen right now.
    it.querySelectorAll('section[data-design]').forEach(d => { d.hidden = true; });
    const allViews = views();
    let target = null;
    allViews.forEach(v => {
      const match = v.dataset.view === viewId;
      v.hidden = !match;
      v.dataset.viewActive = match ? 'true' : 'false';
      if (match) target = v;
    });
    if (!target) return; // unknown view id — leave the page as-is rather than blanking it
    document.querySelectorAll('.design-switch-item').forEach(item => { item.dataset.active = 'false'; });
    document.querySelectorAll('.view-switch-item').forEach(item => {
      item.dataset.active = String(item.dataset.viewId === viewId);
    });
    document.querySelectorAll('.screen-nav-design-heading, .screen-nav-item').forEach(item => {
      item.dataset.active = 'false';
    });
    document.querySelectorAll('.screen-nav-view-item').forEach(item => {
      item.dataset.active = String(item.dataset.viewId === viewId);
    });
    document.querySelectorAll('#feedback-dock [data-view-comment]').forEach(ta => {
      ta.hidden = ta.dataset.viewComment !== viewId;
    });
    const label = target.dataset.navLabel || viewId;
    const dockViewLabel = document.getElementById('dock-view-label');
    if (dockViewLabel) dockViewLabel.textContent = label;
    document.body.dataset.viewActive = 'true';
    updateIndicator();
    updateViewNoteMarkers();
    if (typeof saveState === 'function') saveState();
    // Consistent with showScreen()'s screen:changed below — lets
    // wireAnnotationLayer() and any other cross-cutting listener react
    // without knowing views exist.
    document.dispatchEvent(new CustomEvent('view:changed', { detail: { id: viewId } }));
  };

  function updateViewNoteMarkers() {
    document.querySelectorAll('[data-view-note-marker]').forEach(marker => {
      const id = marker.dataset.viewNoteMarker;
      const ta = document.querySelector(`#feedback-dock [data-view-comment="${CSS.escape(id)}"]`);
      marker.textContent = (ta && ta.value.trim()) ? '●' : '';
    });
  }

  window.showScreen = function(id) {
    const design = activeDesign();
    if (!design) return;
    const screens = design.querySelectorAll('section[data-screen][id]');
    // Membership guard. `hidden = s.id !== id` is a blanket hide when NO
    // screen carries `id` — one foreign id (a nav entry of another design, a
    // stale deep link, a restored state pointing at a deleted screen) empties
    // the canvas with no error anywhere. Fall back to the design's first
    // screen instead: something always paints.
    if (!screens.length) return;
    if (![...screens].some(s => s.id === id)) id = screens[0].id;
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
    // Rebuilds the device frames for the screen that just became active, and
    // re-clamps the mode against what THIS design declares. Runs before
    // saveState() so the persisted `_viewportMode` is the one now on screen.
    // Every other entry point (showDesign, iteration:changed, boot) reaches
    // the switcher through this call rather than duplicating it.
    applyViewport();
    updateIndicator();
    updateNoteMarkers();
    if (typeof saveState === 'function') saveState();
    // Lets the (optional) annotation layer refresh its per-screen counter
    // without this function knowing that layer exists — see
    // wireAnnotationLayer() below. Fired even when no listener is attached.
    document.dispatchEvent(new CustomEvent('screen:changed', { detail: { id } }));
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
    // View label swap (§ Views (optional)) — while a view is the visible
    // top-level item, the screen-counter segment hides and the view label
    // takes its place. Both spans are optional/null-guarded, same
    // discipline as every other indicator segment above.
    const viewInfoEl = document.getElementById('indicator-screen-info');
    const viewLabelEl = document.getElementById('indicator-view');
    const activeView = activeViewVisible();
    if (viewInfoEl) viewInfoEl.hidden = !!activeView;
    if (viewLabelEl) {
      viewLabelEl.hidden = !activeView;
      if (activeView) {
        const labelEl = document.getElementById('active-view-label');
        if (labelEl) labelEl.textContent = activeView.dataset.navLabel || activeView.dataset.view;
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
    updateViewNoteMarkers();
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
  // The ☰ panel and the 💬 dock are both right-edge overlays and are
  // therefore mutually exclusive: opening one minimises the other, so they
  // can never sit expanded on top of each other. The reciprocal call belongs
  // in the OPEN paths only — a close path must never touch the other
  // overlay, or dismissing one would resurrect the other.
  // The call goes through `window.` and is optional on purpose: the dock
  // wiring below has its own markup preconditions, and a page missing them
  // must not take the panel down with it (same failure mode the guard above
  // documents).
  window.openPanel = () => {
    const fromDock = dock?.contains(document.activeElement);
    window.closeDock?.(true);
    panel?.classList.add('open');
    backdrop?.classList.add('visible');
    panelToggle?.classList.add('hidden');
    // Tooltip + a11y label name the NEXT action, exactly like the 💬 FAB
    // below. Written inline (no shared helper) because both labels are read
    // off the button's own dataset — the locale substitution happened once,
    // at generation time, in the markup.
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'true');
      const lbl = panelToggle.dataset.labelClose;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.title = lbl; }
    }
    document.body.classList.add('panel-open');
    // Only re-home focus that the dock just lost — never steal it from a
    // pointer user who was not typing anywhere.
    if (fromDock) panelCloseBtn?.focus();
  };
  window.closePanel = () => {
    panel?.classList.remove('open');
    backdrop?.classList.remove('visible');
    panelToggle?.classList.remove('hidden');
    if (panelToggle) {
      panelToggle.setAttribute('aria-expanded', 'false');
      const lbl = panelToggle.dataset.labelOpen;
      if (lbl) { panelToggle.setAttribute('aria-label', lbl); panelToggle.title = lbl; }
    }
    document.body.classList.remove('panel-open');
  };
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
    window.closePanel?.();   // mutually exclusive overlays, see openPanel above
    dock.dataset.open = 'true';
    dockToggle.setAttribute('aria-expanded', 'true');
    dockToggle.setAttribute('aria-label', LABEL_CLOSE);
    dockToggle.title = LABEL_CLOSE;
  }
  // `handOff` = the dock is closing because the panel is taking over. Then
  // the FAB must NOT be focused: it sits at z-index 220, above the panel
  // backdrop, so a keyboard user would be left standing on a control that
  // dismisses the overlay that just opened. openPanel() moves focus into the
  // panel instead. Every other close still restores the FAB, or focus would
  // be orphaned inside a display:none dock.
  function closeDock(handOff) {
    const focusWasInside = !handOff && dock.contains(document.activeElement);
    dock.dataset.open = 'false';
    dockToggle.setAttribute('aria-expanded', 'false');
    dockToggle.setAttribute('aria-label', LABEL_OPEN);
    dockToggle.title = LABEL_OPEN;
    if (focusWasInside) dockToggle.focus();
  }
  window.closeDock = closeDock;
  // The one-shot pulse (§ Layout CSS) ends the moment the user proves they
  // found the FAB. Two independent proofs, because either can come first:
  // opening the dock from the FAB, or typing into it (a restored session can
  // land with the dock already open, and closeDock() is also reached by the
  // panel hand-off, which proves nothing about the dock).
  const stopFabPulse = () => dockToggle.removeAttribute('data-untouched');
  dockToggle.addEventListener('click', () => {
    stopFabPulse();
    if (dock.dataset.open === 'true') closeDock();
    else openDock();
  });
  dock.addEventListener('input', stopFabPulse);
  dockClose.addEventListener('click', closeDock);

  // Maximise/restore (Work package B) — a RESIZE, never a close. Distinct
  // from minimise above: minimise flips data-open, this flips
  // data-userMaximized, a SEPARATE attribute from data-size (applyDockSize()
  // below still only ever computes compact/wide from the iteration shape,
  // unchanged) — § Layout CSS composes the two via
  // `.feedback-dock[data-size][data-user-maximized="true"]`, which applies on top of
  // whichever of compact/wide is current. The choice is persisted
  // (state['dockMaximized'], § State Persistence) and restored on reload via
  // window.applyDockSize() (see restoreState()) — primeDock() must never
  // silently clear data-userMaximized on an iteration switch, and it does
  // not: applyDockSize() only ever writes data-size.
  const dockMaximize = document.getElementById('feedback-maximize');
  function syncMaximizeButton() {
    if (!dockMaximize) return;
    const on = dock.dataset.userMaximized === 'true';
    dockMaximize.setAttribute('aria-pressed', String(on));
    const label = on ? '{{panel.restore_size}}' : '{{panel.maximize}}';
    dockMaximize.setAttribute('aria-label', label);
    dockMaximize.title = label;
  }
  dockMaximize?.addEventListener('click', () => {
    dock.dataset.userMaximized = dock.dataset.userMaximized === 'true' ? 'false' : 'true';
    applyDockSize();
    if (typeof saveState === 'function') saveState();
  });

  // ── Closed by default, opened only by the user ──
  // The dock starts minimised (data-open="false" in markup). It used to open
  // itself on load and auto-close on the first mockup click, which meant the
  // first thing a concept showed was three empty textareas over the artefact
  // the user came to look at. Now the 💬 FAB is the only thing that opens it,
  // in every iteration state including frozen ones — no auto-open, no
  // auto-close, nothing to un-learn.
  //
  // Size is one of exactly two values, derived from the same body flags the
  // layout already sets. Never size the dock to its content or to the
  // viewport: content-sizing produces the mini-box nobody can type in, and
  // viewport-sizing produces the full-width panel whose textareas never wrap.
  function applyDockSize() {
    // Sync the maximise button's a11y state on every call — cheap, and
    // covers both the click handler's own call and any call site that
    // re-applies sizing without having touched the button (restoreState(),
    // an iteration switch via primeDock()).
    syncMaximizeButton();
    // The automatic compact/wide computation is UNCHANGED and always runs —
    // still exactly two sizes, same as before Work package B. The user's
    // maximise override lives on a SEPARATE attribute (data-userMaximized)
    // and composes with whichever of these two is current via CSS (§ Layout
    // CSS `.feedback-dock[data-size][data-user-maximized="true"]`), rather than
    // replacing this value — so it also survives an iteration switch
    // untouched: primeDock() calls this on every switch but never clears
    // data-userMaximized itself.
    const singleScreen = document.body.dataset.singleScreen === 'true';
    const singleDesign = document.body.dataset.singleDesign === 'true';
    dock.dataset.size = (singleScreen && singleDesign) ? 'compact' : 'wide';
  }
  // Exposed so restoreState() (§ State Persistence, a separate script block
  // whose DOMContentLoaded listener may run before OR after this one — see
  // the ordering note there) can re-apply sizing immediately after it sets
  // dock.dataset.userMaximized from the persisted value, rather than waiting
  // for a switch that may never come.
  window.applyDockSize = applyDockSize;
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
        // Views (§ Views (optional)) — same treatment as designs/screens
        // above: the dock lives outside section[data-iteration], so its
        // view-level textareas need the same frozen blob restore.
        else if (ta.dataset.viewComment) ta.value = (data.views || {})[ta.dataset.viewComment] || '';
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

  // Runs on load and after every iteration / design / screen switch: keep the
  // frozen-vs-live field state and the dock size in sync with what is on
  // screen. It deliberately does NOT open or close the dock — that is the
  // user's call alone, and a switch must never yank the dock open over the
  // mockup they just navigated to.
  function primeDock() {
    applyDockFreezeState();
    applyDockSize();
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildDesignUI();
    // IMMEDIATELY after the rebuild and BEFORE showView()/showScreen(): the
    // dock textareas exist only NOW, and buildDesignUI() created them EMPTY.
    // showScreen() ends in saveState(), and saveState()'s merge cannot protect
    // a key whose node IS present — it would serialise those empty textareas
    // straight over the stored notes, and the restore further down would then
    // read the blob it had just blanked. Measured in a browser: one reload
    // emptied `text:{screen-id}` for good.
    // § State Persistence's own DOMContentLoaded listener is not guaranteed to
    // run before this one (the same unguaranteed ordering applyDockSize()
    // already works around), so its restoreState() may have scanned a dock
    // that did not exist yet, written nothing, and it never re-runs on its
    // own. Re-restoring here is safe: restoreState() is idempotent (it only
    // assigns values off the same stored blob) and no user input can have
    // happened before DOMContentLoaded.
    // Also deliberately BEFORE primeDock(): on a frozen tab
    // applyDockFreezeState() stashes the live values into liveDockValues and
    // paints the frozen blob over them, so restoring afterwards would clobber
    // the frozen view and lose the stash.
    if (typeof restoreState === 'function') restoreState();
    if (typeof updateNoteMarkers === 'function') updateNoteMarkers();
    const active = document.querySelector('section[data-iteration][data-active]');
    if (active) {
      // Work package C — restore an active VIEW first. Defensive by
      // design: an unknown/removed view id (edited between sessions, or
      // belongs to a different iteration after a reload) simply fails the
      // querySelector check below and falls through to the pre-existing
      // screen-restore path exactly as if no view had ever been active —
      // it must never leave the page blank.
      let restoredView = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restoredView = JSON.parse(raw)._activeView;
      } catch (e) {}
      const viewTarget = restoredView && active.querySelector(`section[data-view="${CSS.escape(restoredView)}"]`);
      if (viewTarget) {
        showView(restoredView);
      } else {
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
    }
    updateIndicator();
    document.addEventListener('input', updateNoteMarkers);
    // Runs after the restore above, once buildDesignUI() has set the
    // body[data-single-*] flags applyDockSize() reads. The dock stays closed —
    // priming only syncs its field state and its size.
    primeDock();
    // The stage showScreen() just built cloned the mock BEFORE restoreState()
    // ran: that listener lives in a later block and therefore fires after this
    // one. A rAF callback lands after EVERY DOMContentLoaded listener, so this
    // rebuild clones the restored DOM instead of the pristine one. It is also
    // the only viewport pass a design with zero screens gets, since showScreen()
    // never runs there and the toggle would otherwise stay unbuilt.
    requestAnimationFrame(applyViewport);
  });

  // Rebuild after iteration switches (fresh designs, fresh screens, fresh
  // textareas). Preserve the previously active screen if it still exists in
  // the newly visible design; otherwise fall back to that design's
  // remembered page, or its first page.
  document.addEventListener('iteration:changed', () => {
    // Stash the OUTGOING iteration's unsent dock text before buildDesignUI()
    // empties the three containers. applyDockFreezeState() (via primeDock()
    // at the end of this handler) does the same stash, but by then the
    // harvest reads an already-rebuilt dock and writes empty strings over
    // the user's text. Design and screen ids happen to repeat across
    // iterations so harvestDockValues() masks it there; view ids are unique
    // page-wide, so a view note was lost every single time.
    // showIteration() sets body.viewing-frozen BEFORE dispatching this
    // event, so the class already describes the tab we are moving TO.
    if (document.body.classList.contains('viewing-frozen') && liveDockValues === null) {
      liveDockValues = harvestDockValues();
    }
    // A question view never survives a tab switch. buildDesignUI() requires
    // an active design, and a stale body[data-view-active] leaves the
    // position indicator empty, kills arrow-key navigation and makes every
    // data-screen-link click-dummy inert with no visible cause.
    document.querySelectorAll('section[data-view]').forEach(v => {
      v.dataset.viewActive = 'false';
      v.hidden = true;
    });
    document.body.dataset.viewActive = 'false';
    // ...and put the designs back on screen. showView() hides every design
    // when a question view takes over the viewport, and nothing else undoes
    // that: only showDesign() un-hides, and it is not on this path. Without
    // this, a view -> other iteration tab -> back round trip lands on a
    // design that still says data-design-active="true" while being
    // display:none — no mockup, dead click-dummy, dead arrow keys, and no
    // visible cause. Verified in a browser, not deduced.
    const incoming = visibleIteration();
    if (incoming) {
      incoming.querySelectorAll(':scope > section[data-design]').forEach(d => {
        d.hidden = d.dataset.designActive !== 'true';
      });
    }
    buildDesignUI();
    // buildDesignUI() above destroyed and rebuilt the three dock containers,
    // so the textareas below it are EMPTY again. Restore them here — before
    // applyViewport(), showScreen() and primeDock(), every one of which ends
    // in a saveState() that would write those empty nodes over the stored
    // notes (the merge only protects keys whose node is ABSENT).
    // harvestDockValues() carries what was on screen, but only that: a note
    // belonging to a screen the OUTGOING iteration never rendered a textarea
    // for exists in localStorage and nowhere else, and would come back blank.
    // Skipped while a frozen tab is on screen: applyDockFreezeState() has
    // already painted the frozen blob into the same fields and stashed the
    // live values in liveDockValues, and writing localStorage over that would
    // show live text under a read-only frozen iteration.
    if (!document.body.classList.contains('viewing-frozen')
        && typeof restoreState === 'function') restoreState();
    // BEFORE the early return below, not after: switching to a decision/free
    // iteration leaves no active design, so showScreen() — the usual route to
    // applyViewport() — never runs. Without this call the device stage of the
    // design iteration the user just left stays in the DOM, and the toggle
    // keeps offering viewports that iteration never declared.
    applyViewport();
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
    // Re-sync frozen-vs-live fields and the dock size for the iteration we
    // just switched to. Never touches open/closed — a tab switch must not
    // yank the dock open over the mockup the user just navigated to.
    primeDock();
    // Last, so the ☰ "has notes" dots describe the values primeDock() left in
    // the fields — restored, stashed or frozen.
    updateNoteMarkers();
  });

  // Keyboard: Arrow Left/Right (and Space) jump between screens (within the
  // active design) when no textarea/input is focused and no overlay is open.
  document.addEventListener('keydown', e => {
    if (dock.dataset.open === 'true' || panel.classList.contains('open')) return;
    // Bailing out on textarea/input alone was too narrow: Space activates a
    // FOCUSED BUTTON, so pressing it on a mock's "Continue" advanced the
    // screen and swallowed the click at the same time. Device mode doubles
    // the focusable mock surface, which is what made it worth fixing here.
    if (e.target && e.target.closest
        && e.target.closest('textarea, input, select, button, a[href], [contenteditable], [role="button"]')) return;
    // A view is scrollable prose/questions, not a screen sequence — Arrow
    // Left/Right must not hijack it into switching designs (§ Views (optional)).
    // It has no device frames either, so `v` below is equally out of scope.
    if (document.body.dataset.viewActive === 'true') return;
    // `v` cycles the device view — the keyboard equivalent of the bottom-left
    // toggle, and a no-op on concepts that declare a single viewport.
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); cycleViewport(); return; }
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

## Annotation Layer JS — `wireAnnotationLayer()`

Entirely independent of `wireDesignLayout()` above: a page with no
`[data-anno-layer]` anywhere runs this IIFE and does nothing else, forever
(the `!toggle` early return). It never reaches into `wireDesignLayout()`'s
closed-over state — the two communicate only via the `screen:changed` /
`iteration:changed` DOM events and via `document.body.classList`, exactly
like every other cross-cutting concern on this page (`viewing-frozen`,
`panel-open`, `single-screen`, …).

```javascript
(function wireAnnotationLayer() {
  const toggle = document.getElementById('anno-toggle');
  if (!toggle) return; // no eye pill mounted — layer not used on this page

  function activeScreen() {
    // Scoped through the visible iteration and its active design, exactly
    // like wireDesignLayout()'s own activeDesign()/activeScreen() lookups —
    // this IIFE cannot reuse those closures (see note above) so the same
    // scoping is reimplemented here. An unscoped
    // 'section[data-screen][data-screen-active="true"]' would always
    // resolve to the FIRST such screen in document order: the reference
    // markup ships two simultaneously-active screens (one per design), and
    // frozen iterations keep their own data-screen-active too. Without this
    // scoping the eye pill would permanently report design 1 of iteration 1.
    const it = document.querySelector('section[data-iteration]:not([hidden])');
    if (!it) return null;
    const design = it.querySelector('section[data-design][data-design-active="true"]');
    if (!design) return null;
    return design.querySelector('section[data-screen][data-screen-active="true"]');
  }
  function annotationsInScreen(screen) {
    return screen ? [...screen.querySelectorAll('[data-anno]')] : [];
  }

  // Only one bubble open at a time, across every screen/design — a bubble
  // left open under a screen the user has since navigated away from would
  // otherwise reappear open on return.
  function openBubble(id) {
    document.querySelectorAll('[data-anno-bubble]').forEach(b => {
      b.dataset.open = String(b.dataset.annoBubble === id);
    });
    document.querySelectorAll('[data-anno-pin], [data-anno-summary]').forEach(el => {
      const owns = el.dataset.annoPin === id || el.dataset.annoSummary === id;
      el.setAttribute('aria-expanded', String(owns));
    });
    openBubbleAt(id);
  }
  function closeAllBubbles() {
    document.querySelectorAll('[data-anno-bubble]').forEach(b => { b.dataset.open = 'false'; });
    document.querySelectorAll('[data-anno-pin], [data-anno-summary]').forEach(el => {
      el.setAttribute('aria-expanded', 'false');
    });
  }

  // Recomputed on every input, not just at generation time — an answer
  // typed and then deleted must revert the pin to "unanswered".
  function recomputeAnswered(anno) {
    const ta = anno.querySelector('textarea[data-annotation]');
    const pin = anno.querySelector('[data-anno-pin]');
    if (!ta || !pin) return;
    pin.dataset.answered = String(!!ta.value.trim());
  }

  // --- placement ---------------------------------------------------------
  // Two problems the percentage-only approach had, both reported from a real
  // page: pins landed in empty space next to the element they asked about,
  // and bubbles opened straight off the edge of the screen. Authored
  // coordinates stay supported (and stay the fallback), but a pin can now
  // name the element it belongs to and the bubble is always pulled back into
  // view.
  function annoLayerOf(anno) { return anno.closest('[data-anno-layer]'); }

  // data-anno-target is a CSS selector resolved INSIDE the pin's own screen,
  // so the same selector may repeat on other screens without colliding.
  function anchorToTarget(anno) {
    const sel = anno.dataset.annoTarget;
    if (!sel) return;                       // authored --anno-x/--anno-y wins
    const screen = anno.closest('section[data-screen]');
    const layer = annoLayerOf(anno);
    if (!screen || !layer) return;
    let target = null;
    try { target = screen.querySelector(sel); } catch (e) { target = null; }
    if (!target) return;                    // stale selector: keep last known spot
    const box = layer.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    if (!box.width || !box.height || !t.width) return;   // not laid out yet
    const x = ((t.right - box.left) / box.width) * 100;
    const y = ((t.top + t.height / 2 - box.top) / box.height) * 100;
    anno.style.setProperty('--anno-x', Math.max(0, Math.min(100, x)).toFixed(2) + '%');
    anno.style.setProperty('--anno-y', Math.max(0, Math.min(100, y)).toFixed(2) + '%');
  }

  // Keep an open bubble inside the viewport: flip to the opposite side first
  // (that is what the authored side is for), then shift by whatever is still
  // sticking out. A bubble the user cannot read is worse than one that opens
  // on the "wrong" side.
  function placeBubble(anno) {
    if (!anno) return;
    const bubble = anno.querySelector('[data-anno-bubble]');
    if (!bubble || bubble.dataset.open !== 'true') return;
    if (!anno.dataset.annoSideAuthored) {
      anno.dataset.annoSideAuthored = anno.dataset.annoSide || 'right';
    }
    anno.dataset.annoSide = anno.dataset.annoSideAuthored;
    bubble.style.marginLeft = '';
    bubble.style.marginTop = '';
    const pad = 12;
    let r = bubble.getBoundingClientRect();
    if (anno.dataset.annoSide === 'right' && r.right > window.innerWidth - pad) {
      anno.dataset.annoSide = 'left';
      r = bubble.getBoundingClientRect();
    } else if (anno.dataset.annoSide === 'left' && r.left < pad) {
      anno.dataset.annoSide = 'right';
      r = bubble.getBoundingClientRect();
    }
    let dx = 0;
    if (r.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    if (dx) bubble.style.marginLeft = Math.round(dx) + 'px';
    r = bubble.getBoundingClientRect();
    let dy = 0;
    if (r.bottom > window.innerHeight - pad) dy = (window.innerHeight - pad) - r.bottom;
    if (r.top + dy < pad) dy = pad - r.top;
    if (dy) bubble.style.marginTop = Math.round(dy) + 'px';
  }

  function openBubbleAt(id) {
    const anno = document.querySelector(`[data-anno="${CSS.escape(id)}"]`);
    if (anno) { anchorToTarget(anno); placeBubble(anno); }
  }

  function updateAnnoUI() {
    const screen = activeScreen();
    // Reconciliation with § Views (optional): showView() never clears the
    // previously-active screen's data-screen-active, so activeScreen()
    // above can still resolve to a (now hidden) screen while a view is on
    // screen. The eye pill must not show a stale count — or render at all —
    // over a view's own content. body[data-view-active] is undefined on
    // pages that never use views, so this is a pure no-op there.
    const viewActive = document.body.dataset.viewActive === 'true';
    const all = viewActive ? [] : annotationsInScreen(screen);
    // Recompute here, not only on `input`: restoreState() writes persisted
    // answers back programmatically and fires no input event, so a reloaded
    // page would otherwise paint every already-answered pin as unanswered.
    all.forEach(anno => recomputeAnswered(anno));
    all.forEach(anchorToTarget);
    toggle.hidden = all.length === 0;
    // The pill counts OPEN questions, not annotations — an answered pin is
    // done, and a pill stuck at "3" after answering all three reads as broken.
    const open = all.filter(anno => {
      const pin = anno.querySelector('[data-anno-pin]');
      return !pin || pin.dataset.answered !== 'true';
    }).length;
    const countEl = document.getElementById('anno-count');
    if (countEl) countEl.textContent = String(open);
    const hidden = document.body.classList.contains('anno-hidden');
    const label = (hidden ? toggle.dataset.labelShow : toggle.dataset.labelHide) || '';
    if (label) toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(!hidden));
  }
  // Called from § State Persistence's DOMContentLoaded handler AFTER
  // restoreState() has applied the persisted body.anno-hidden class — see
  // the note there. Exposed the same way updateNoteMarkers() is.
  window.updateAnnoUI = updateAnnoUI;

  document.querySelectorAll('[data-anno]').forEach(recomputeAnswered);

  // Pin clicks toggle their own bubble. Bubble-summary clicks (the
  // collapsed truncated-question row) do the same — either is a valid way
  // to open the same bubble. Neither must ever reach the click-through
  // handler's data-screen-link lookup — guarded there directly (§
  // Click-through Handler), not by relying on event ordering here.
  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-anno-pin], [data-anno-summary]');
    if (trigger) {
      const id = trigger.dataset.annoPin || trigger.dataset.annoSummary;
      const bubble = document.querySelector(`[data-anno-bubble="${CSS.escape(id)}"]`);
      const isOpen = bubble && bubble.dataset.open === 'true';
      if (isOpen) closeAllBubbles(); else openBubble(id);
      return;
    }
    // Clicking anywhere else in the bubble (the textarea, the attach slot)
    // must never close it; clicking anywhere outside the layer does.
    if (e.target.closest('.anno-bubble')) return;
    closeAllBubbles();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllBubbles();
  });

  document.addEventListener('input', e => {
    if (!e.target.matches('textarea[data-annotation]')) return;
    const anno = e.target.closest('[data-anno]');
    if (!anno) return;
    recomputeAnswered(anno);
    updateAnnoUI();
    // data-comment on the same textarea already drives saveState()/
    // restoreState() (§ State Persistence) — no extra persistence code
    // needed for the answer text itself.
  });

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('anno-hidden');
    // Hiding the layer must not leave a bubble open underneath it —
    // reopening later should start from a clean collapsed state.
    if (document.body.classList.contains('anno-hidden')) closeAllBubbles();
    updateAnnoUI();
    if (typeof saveState === 'function') saveState();
  });

  // The IIFE runs before the mock has its final layout, so the first anchor
  // pass can read a half-measured box and pin the marker to a corner — where
  // it then STAYS, because nothing else recomputes on a page that is simply
  // sitting there. Re-run once the frame is painted and again on load (web
  // fonts and images move things a second time).
  requestAnimationFrame(() => updateAnnoUI());
  window.addEventListener('load', () => updateAnnoUI());

  document.addEventListener('screen:changed', updateAnnoUI);
  document.addEventListener('iteration:changed', updateAnnoUI);
  // A view takes over the whole viewport, so the pill must not keep floating
  // over it with the previous screen's count. showView() dispatches this;
  // without the listener the guard inside updateAnnoUI() never runs on the
  // design -> view transition (the reverse works only by accident, because
  // showDesign() routes through showScreen()).
  document.addEventListener('view:changed', updateAnnoUI);
  // A resize moves every anchored pin and can push an open bubble off-screen.
  window.addEventListener('resize', () => {
    updateAnnoUI();
    const open = document.querySelector('[data-anno-bubble][data-open="true"]');
    if (open) placeBubble(open.closest('[data-anno]'));
  });
  updateAnnoUI();
})();
```

**Persistence extension:** the design layout's `saveState()` must also write
`_activeScreen: '{current-screen-id}'` AND `_activeScreenByDesign: {designId:
screenId, …}` into the localStorage payload — the former for the currently
active design (kept for backward compatibility with the single-design
degenerate case), the latter so EVERY design's last-viewed page survives a
reload, not just the one on screen at save time. **Work package C** adds
`_activeView` the same way (§ State Persistence `saveState()` already shows
the literal code, a plain DOM read of `section[data-view-active="true"]`) —
a reload used to always drop back to design mode even when the user was
reading a question view; the `DOMContentLoaded` handler below now tries the
restored view FIRST and only falls back to the screen-restore path when
there is no view id, or the id no longer resolves to a `section[data-view]`
in the active iteration. `_viewportMode` rides along
in the shared `saveState()` block below, read straight off
`body[data-viewport-pref]` so there is exactly one writer of the state blob
and no cross-scope variable to keep in sync.

## Click-through Handler

Single delegated listener that interprets `data-screen-link` on any element
inside a `[data-screen]` section, **scoped to the active design** — a link
may only target screens within its own design, never reach across into
another design's pages. Closes the ☰ panel (harmless no-op if it's not open)
and fires `showScreen()`. Returns immediately while a view is the active
top-level item (§ Views (optional)) — there is no screen on screen to
navigate within.

```javascript
document.addEventListener('click', e => {
  // Annotation pins/bubbles (§ Annotation Layer JS) live inside
  // [data-screen] too and have their own click handling — they must never
  // fall through to click-dummy navigation, even if a future pin design
  // nests a [data-screen-link] ancestor by accident.
  if (e.target.closest('[data-anno-pin], [data-anno-summary], .anno-bubble')) return;
  // A view (§ Views (optional)) is the active top-level item — no design is
  // on screen to navigate within, even though a hidden design still carries
  // data-design-active="true" as its own "last shown page" memory. Bail
  // before the lookup below would otherwise resolve to that hidden design.
  if (document.body.dataset.viewActive === 'true') return;
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
<section data-iteration="1" data-active
         data-viewports="desktop phone" data-viewport-default="phone">
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
- **Form factors are declared on the iteration** via `data-viewports` /
  `data-viewport-default` / `data-orientations` (§ Responsive device views).
  Omit them for a desktop-only concept. The example above declares a
  phone-first app that also has a desktop view, so the page opens in the
  phone frames and the bottom-left toggle cycles the two.
- **A screen's children are the clone source.** Everything inside
  `section[data-screen]` (whether or not it is wrapped in `.device-frame`)
  is cloned into each device frame, so it must be declarative markup —
  no `<script>`, `<canvas>`, `<style>` or `<iframe>`, no `vh`/`vw` units, no
  `position: fixed`, and no `#id` selectors in its CSS. § Responsive device
  views explains what each of those does when cloned.

### Annotated screen (optional annotation layer)

A screen with concrete, element-level questions adds `[data-anno-layer]`
inside the `<section data-screen>`, one `.anno` per question. This is
**additive** to the plain shape above — `data-screen`/`id`/`data-nav-label`
work exactly the same either way:

```html
<section id="d1-s1" data-nav-label="Welcome" data-screen data-screen-active="true">
  <div class="device-frame">…mockup HTML for welcome screen…</div>

  <div class="anno-layer" data-anno-layer>
    <div class="anno" data-anno="a1" data-anno-side="right" style="--anno-x:62.5%;--anno-y:31.2%">
      <button class="anno-pin" type="button" data-anno-pin="a1"
              aria-expanded="false" aria-controls="anno-bubble-a1"
              aria-label="{{anno.pin_label}}">1</button>
      <div class="anno-bubble" id="anno-bubble-a1" data-anno-bubble="a1" data-open="false">
        <button type="button" class="anno-bubble-summary" data-anno-summary="a1"
                aria-expanded="false" aria-controls="anno-bubble-a1">
          <span class="anno-bubble-question">Should the dispatch queue auto-refresh, or stay manual?</span>
          <span class="anno-chevron" aria-hidden="true">›</span>
        </button>
        <div class="anno-bubble-body">
          <textarea class="anno-answer" data-comment="anno-a1" data-annotation="a1" data-attachable
                    placeholder="{{anno.answer_placeholder}}"></textarea>
          <div class="attach-slot" data-attach-slot="anno-a1"></div>
        </div>
      </div>
    </div>
  </div>
</section>
```

**Rules (in addition to the plain screen rules above):**
- `[data-anno-layer]` is a plain wrapper (no positioning of its own) placed
  anywhere inside the `[data-screen]` section — it is absolutely positioned
  to the screen's own box by CSS (§ Layout CSS), so it does not need to
  live inside `.device-frame` specifically.
- Annotation ids (`data-anno`, `data-anno-pin`, `data-anno-bubble`,
  `data-anno-summary`, `data-annotation`, `data-attach-slot`'s `anno-{id}`
  suffix) MUST be unique **page-wide**. Prefix them with the screen id —
  `d1-s2-a1`, `d2-s1-a1` — which makes uniqueness structural instead of
  something the author has to remember.
  Do NOT number them `a1`, `a2` per screen. That reads harmless and is not:
  `saveState()` keys the answer as `text:anno-{id}`, so two screens both
  using `a1` share ONE storage slot — the last field saved wins, the other
  answer is gone on reload, and both pins come back showing the same text.
  The payload's `annotations[]` entries collide the same way
  (§ Decision schema). Observed in a browser, not theorised.
- **Prefer `data-anno-target` over hand-picked coordinates.** It takes a CSS
  selector resolved inside the pin's own screen (`data-anno-target=".kb-card
  .kb-title"`), and the pin is placed on that element's right edge at load,
  on every screen/design/iteration switch and on resize. Hand-guessed
  percentages drift the moment the mock reflows, and the reported symptom is
  exactly that: numbered pins floating in empty space next to the thing they
  ask about.
- `--anno-x` / `--anno-y` stay supported as percentages of the screen box and
  are the fallback whenever no target is given or the selector matches
  nothing — a stale selector keeps the last known position instead of
  collapsing the pin into a corner.
- `data-anno-side` picks the side the bubble PREFERS to open toward. It is a
  preference, not a promise: `placeBubble()` flips to the opposite side when
  the preferred one would overflow the viewport, then shifts by whatever is
  still sticking out, so a bubble is never half off-screen. The authored side
  is remembered, so the bubble returns to it as soon as there is room again.
- The pin number (`1`, `2`, …) and `{{anno.pin_label}}`'s `{n}` MUST match —
  both are the 1-based order Claude assigns per screen, not a global counter
  across the whole design.
- Every answer textarea MUST carry `data-comment="anno-{id}"` (state
  persistence, § State Persistence), `data-annotation="{id}"` (the payload
  scan, § collectDecisions (design branch)) and `data-attachable` (hook for
  a later change — do not wire uploads here). The immediately-following
  `<div class="attach-slot" data-attach-slot="anno-{id}"></div>` stays empty.
- Do not add the eye pill (`#anno-toggle`) or `body.anno-hidden` handling
  per screen — both are page-global, emitted once in § Layout, driven by
  `wireAnnotationLayer()` (§ Annotation Layer JS).

### View sections (optional)

`section[data-view]` is a top-level sibling of `section[data-design]`, not
something nested inside one — see § Views (optional) above (right before
§ Layout) for the full worked reference markup of both view kinds
(`data-view-kind="decision"` and `data-view-kind="comparison"`), their CSS
(`section[data-view]`, `.view-frame`, `.cmp-*`, `.view-switch-item`,
`.screen-nav-view-item`) and their JS (`views()`, `showView()`,
`buildViewTextareas()`). This subsection exists only as the same
cross-reference anchor § Annotated screen has above, so a reader scanning
top-to-bottom through § Screen-pattern markup does not miss that views
exist. **≥1 `data-design` remains mandatory** alongside any number of views
— see § Rules.

## Decision schema

The design submit payload's comments are keyed by feedback level (general /
designs / screens / **views**). `comments.screens` keeps flat screen-id
keying regardless of which design a screen belongs to, so no consumer needs
to learn the design nesting to read page feedback. `decisions` was always
`[]` for a design iteration with no views — it is now populated whenever the
iteration has ≥1 `data-view-kind="decision"` or `"comparison"` view, one
entry per `[data-decision]` group across every view, each tagged with the
owning `view` id (§ Views (optional)):

```json
{
  "submitted": true,
  "template": "design",
  "iteration": 2,
  "decisions": [
    { "id": "nav-tabs", "label": "Tabs", "evaluation": "include", "view": "nav-model", "note": "only for the desktop layout" },
    { "id": "nav-drawer", "label": "Drawer", "evaluation": "discard", "view": "nav-model", "note": "" },
    { "id": "compact", "label": "Compact", "evaluation": "include", "view": "card-density", "note": "" }
  ],
  "comments": {
    "general": "...",
    "designs": { "dispatch": "...", "holotable": "..." },
    "screens": { "d1-s1": "...", "d1-s2": "..." },
    "views": { "nav-model": "...", "card-density": "..." }
  },
  "annotations": [
    {
      "id": "a1",
      "screen": "d1-s1",
      "design": "dispatch",
      "question": "Should the dispatch queue auto-refresh, or stay manual?",
      "answer": "Auto-refresh, but with a manual pause toggle."
    }
  ],
  "attachments": {
    "general": [ { "id": "<sha256>.png", "name": "shot.png", "mime": "image/png", "size": 84213, "path": ".claude/concepts/{{slug}}/attachments/<sha256>.png" } ],
    "design-dispatch": [],
    "d1-s1": [],
    "view-nav-model": [],
    "anno-a1": [],
    "nav-tabs-note": []
  }
}
```

`decisions[]` entries use the **same shape as the decision template's own
schema** (`{id, label, evaluation}` — § Bi-State Variant Evaluation →
Decision schema — `evaluation` is `"include"` or `"discard"`), plus the
`view` field so Claude knows which view each entry answers and the `note`
field carrying the mandatory adjacent `{decisionId}-note` textarea (empty
string when the user left it blank) — the verdict without the reasoning is
half the message, and it must not be reachable only through `allFields`.
The comparison view's freer controls (favourite radios, criteria-matrix
selects, weight sliders) deliberately stay untyped and arrive in
`allFields` — they are author-invented per page, so no fixed schema can
describe them. A design
iteration with no views still emits `"decisions": []`, never omits the key
— same empty-array convention as `annotations` above. `comments.views` is
**optional and only present when the iteration has ≥1 view** — a view-less
design iteration emits `"views": {}`, matching how `comments.designs`
already degenerates to `{}` for a single-design iteration. Only views with
non-empty, trimmed dock text are included, same trimming rule as every
other `comments.*` level.

`annotations` is **optional** and only present when the page uses the
annotation layer (§ Annotation Layer (optional)) — a page with none emits
`"annotations": []`, never omits the key (same convention as the empty
`"decisions": []` above, so consumers never need an existence check). Only
entries with a non-empty, trimmed `answer` are included — an unanswered pin
contributes nothing to the payload, matching how `comments.*` already skips
empty fields. `question` is read from the pin's bubble markup at submit
time (`.anno-bubble-question` textContent), not hand-duplicated anywhere.

`attachments` is a top-level map, keyed by the same slot key every
`textarea[data-attachable]` carries as its `data-comment` value (`general`,
`design-{id}`, `{screenId}`, `view-{id}`, `anno-{id}`, `{decisionId}-note`)
— see § Attachments. Each value is the array `attachmentsFor(slotKey)`
already produces (`{id, name, mime, size, path}`, synced files only). A slot
with zero attachments is simply absent from the map — it is not padded with
an empty array, unlike `comments.*`, because the map itself may legitimately
be `{}` for an iteration where nothing was attached. This is a *separate*
top-level key from the decision template's own inline `comments[].attachments`
(§ collectDecisions (dispatcher)) — the design template's comments are a
keyed object, not an array of `{id, text}` records, so attachments cannot be
inlined the same way and get their own top-level map instead.

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
  const comments = { general: '', designs: {}, screens: {}, views: {} };
  document.querySelectorAll('#feedback-dock input, #feedback-dock select, #feedback-dock textarea').forEach(el => {
    const value = (el.value || '').trim();
    if (!value) return;
    if (el.dataset.designComment) comments.designs[el.dataset.designComment] = value;
    else if (el.dataset.screenComment) comments.screens[el.dataset.screenComment] = value;
    // Views (§ Views (optional)) — same "dock lives outside
    // section[data-iteration]" reasoning as designs/screens above.
    else if (el.dataset.viewComment) comments.views[el.dataset.viewComment] = value;
    else if (el.dataset.comment === 'general') comments.general = value;
  });
  const active = document.querySelector('section[data-iteration][data-active]');
  // Decisions authored inside views (§ Views (optional)) — reuses the same
  // [data-decision] bi-state markup and value convention
  // ("include"/"discard") as the decision template's own cards (§ Bi-State
  // Variant Evaluation), just scanned wherever it lives on THIS page: unlike
  // the dock, views live INSIDE section[data-iteration][data-active], so
  // this scan is scoped to `active` directly, same as the annotations scan
  // below. Every view is scanned regardless of which is on screen — a view
  // rebuilds nothing on switch (only `hidden` flips), so this sees all of
  // them. A design iteration with no views yields `decisions: []`, the same
  // empty-but-present convention as `annotations` below.
  const decisions = [];
  if (active) {
    active.querySelectorAll('section[data-view]').forEach(view => {
      view.querySelectorAll('[data-decision]').forEach(group => {
        const checked = group.querySelector('input[type="radio"]:checked');
        if (!checked) return;
        // The adjacent {decisionId}-note textarea is mandatory (§ View kind
        // decision, and ensureCommentSlots() injects it when an author
        // forgets). Without it here the typed payload reports the verdict
        // and drops the reasoning, leaving it reachable only through the
        // untyped allFields bag. Look inside the group, then its card, then
        // the view — ensureCommentSlots() appends next to the group, hand
        // authored markup tends to put it one level up.
        const decisionId = group.dataset.decision;
        const noteEl = group.querySelector(`[data-comment="${decisionId}-note"]`)
          || (group.parentElement && group.parentElement.querySelector(`[data-comment="${decisionId}-note"]`))
          || view.querySelector(`[data-comment="${decisionId}-note"]`);
        decisions.push({
          id: decisionId,
          label: group.dataset.label || decisionId,
          evaluation: checked.value,
          view: view.dataset.view,
          note: ((noteEl && noteEl.value) || '').trim()
        });
      });
    });
  }
  // Annotations (§ Annotation Layer (optional)) live INSIDE
  // section[data-iteration][data-active] — unlike the dock above, which is
  // an overlay outside it — so this scan is scoped to `active` directly.
  // Every design's screens are scanned regardless of which is on screen
  // (same "every design, not just the active one" rule the dock scan
  // relies on): the annotation layer is a per-screen DOM fixture, not
  // something rebuilt on design switch, so querySelectorAll sees all of
  // them whether their screen is currently `hidden` or not. Only answered
  // pins (non-empty, trimmed textarea) produce an entry — an optional
  // feature that ships zero completed annotations must still emit
  // "annotations": [] (see § Decision schema), not omit the key.
  const annotations = [];
  if (active) {
    active.querySelectorAll('[data-anno]').forEach(anno => {
      const ta = anno.querySelector('textarea[data-annotation]');
      const answer = ta ? (ta.value || '').trim() : '';
      if (!answer) return;
      const screen = anno.closest('section[data-screen][id]');
      const design = anno.closest('section[data-design]');
      const questionEl = anno.querySelector('.anno-bubble-question');
      annotations.push({
        id: anno.dataset.anno,
        screen: screen ? screen.id : null,
        design: design ? design.dataset.design : null,
        question: questionEl ? questionEl.textContent.trim() : '',
        answer
      });
    });
  }
  // Attachments (§ Attachments) — one entry per slot key that has at least
  // one synced file. Design iterations have no single [data-comment] scan
  // point the way the decision/free branches do (their comments are a flat
  // array), so this walks every slot the attachment engine knows about
  // rather than re-deriving the slot-key list from the DOM.
  const attachments = {};
  if (typeof attachmentsFor === 'function' && typeof _attachments !== 'undefined') {
    for (const slotKey of _attachments.keys()) {
      const list = attachmentsFor(slotKey);
      if (list.length) attachments[slotKey] = list;
    }
  }
  return {
    submitted: true,
    template: 'design',
    iteration: active ? Number(active.dataset.iteration) : undefined,
    decisions,
    comments,
    annotations,
    attachments
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
    const text = el.value.trim();
    const attachments = (typeof attachmentsFor === 'function')
      ? attachmentsFor(el.dataset.comment) : [];
    if (text || attachments.length) comments.push({ id: el.dataset.comment, text, attachments });
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

/* Frozen panel state — same indicator language as the submitted panel, in the
   muted border colour rather than a status colour: a frozen tab is neither
   good news nor a warning, it is history. */
.frozen-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border-color, #30363d);
  background: color-mix(in srgb, var(--text-secondary, #8b949e) 10%, transparent);
  color: var(--text-secondary, #8b949e);
}
.frozen-indicator .frozen-icon { font-size: 1.2rem; }

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

/* Persistent status channel — the always-visible pipeline recap that hands
   over to the close-out wizard. Boxed so it reads as a distinct "status"
   surface. Pure DOM / connection-independent by design: the close-out
   affordance must never disappear just because the heartbeat went stale. */
.status-channel {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  padding: 0.85rem 0.95rem 0.9rem;
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
.status-channel .status-steps { margin-bottom: 0; }

/* Close-out wizard. One step visible at a time; the surrounding box is what
   tells the user they are inside a bounded flow rather than staring at a wall
   of independent buttons.
   The padding deliberately undercuts the 1.5rem "card padding" token from
   § Design System: the panel is 360px (min(360px, 90vw) — 337px at a 375px
   viewport), and after the panel's own 1.5rem gutters a 1.5rem wizard padding
   would leave ~230px for two-column rows like [radio][label]. Do not "restore"
   it to the token without re-checking that budget. */
.finalize-wizard {
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  padding: 0.9rem 0.95rem 1rem;
}
.finalize-wizard .wizard-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}
.finalize-wizard .wizard-title {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary, #8b949e);
}
.finalize-wizard .wizard-count {
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  font-variant-numeric: tabular-nums;
}
.finalize-wizard .wizard-q {
  margin: 0 0 0.5rem 0;
  font-size: 0.95rem;
  font-weight: 600;
}
.finalize-wizard .wizard-step[hidden] { display: none; }
.finalize-wizard .wizard-issue-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.6rem 0 0.2rem;
}
.finalize-wizard .wizard-issue,
.finalize-wizard .wizard-choice {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1.4;
}
.finalize-wizard .wizard-issue:hover,
.finalize-wizard .wizard-choice:hover {
  border-color: var(--accent-color, #58a6ff);
}
.finalize-wizard .wizard-choice { margin-bottom: 0.45rem; }
.finalize-wizard .wizard-choice input[type="radio"],
.finalize-wizard .wizard-issue input[type="checkbox"] {
  margin-top: 0.15rem;
  flex-shrink: 0;
}
.finalize-wizard .wizard-choice-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
/* Flex items default to min-width:auto, so a row only refuses to shrink below
   its longest unbroken token — which in German (and in any URL-ish
   data-issue-title) is easily 35+ characters. At the 375px viewport the row
   has ~240px to work with, so without these three the step scrolls
   horizontally instead of wrapping. */
.finalize-wizard .wizard-issue > span,
.finalize-wizard .wizard-choice-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
.finalize-wizard .wizard-sub {
  color: var(--text-secondary, #8b949e);
  font-size: 0.78rem;
  line-height: 1.4;
}
/* Review list — the only screen that names every consequence at once. */
.finalize-wizard .wizard-plan {
  margin: 0.6rem 0 0.8rem;
  padding-left: 1.2rem;
  font-size: 0.85rem;
  line-height: 1.6;
}
.finalize-wizard .wizard-plan li { margin-bottom: 0.2rem; }
.finalize-wizard .wizard-plan li[data-plan-kind="ship"] {
  color: var(--warning-color, #d29922);
  font-weight: 600;
}
.finalize-wizard .wizard-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-top: 0.9rem;
}
.finalize-wizard .wizard-nav #wizard-next { flex: 1; }
.finalize-wizard .wizard-nav #wizard-back { margin-top: 0; white-space: nowrap; }
.finalize-wizard #wizard-next:disabled { opacity: 0.5; cursor: not-allowed; }
.finalize-wizard #wizard-execute {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 600;
}
.finalize-wizard #wizard-execute:disabled { opacity: 0.5; cursor: not-allowed; }
.finalize-wizard .hint[data-finalize-state="running"] { color: var(--accent-color, #58a6ff); }
.finalize-wizard .hint[data-finalize-state="done"] { color: var(--success-color, #3fb950); }
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

.finalize-wizard #wizard-issues-none {
  color: var(--warning-color, #d29922);
}

/* Disposition fieldset — controls Step 6 cleanup. Lives inside the wizard's
   "files" step; default selection is "discard" (matches the typical one-shot
   refinement workflow). */
.dispose-fieldset {
  margin-top: 0;
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

// A QuotaExceededError from localStorage.setItem, unguarded, throws OUT of
// every change/input handler — one oversized state (e.g. a very long
// session with many iterations) then silently kills ALL persistence for the
// rest of the page, with nothing telling the user their edits stopped being
// saved. Every setItem call site in this file (saveState, both `-pending`
// writes near the submit handler) MUST go through this wrapper rather than
// calling localStorage.setItem directly.
let _persistWarnEl = null;
let _persistWarned = false;
function _showPersistWarning() {
  // Once is enough — re-showing it on every subsequent failed write would
  // spam the page while the underlying problem (storage full) persists
  // across many `input` events in a row.
  if (_persistWarned) return;
  _persistWarned = true;
  if (!_persistWarnEl) {
    _persistWarnEl = document.createElement('div');
    _persistWarnEl.className = 'persist-warning-banner';
    _persistWarnEl.setAttribute('role', 'alert');
    _persistWarnEl.textContent = '{{state.persist_failed}}';
    document.body.appendChild(_persistWarnEl);
  }
  _persistWarnEl.hidden = false;
}
function _guardedSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    // QuotaExceededError (or, rarely, a disabled/private-mode store) — the
    // in-memory state (and the IndexedDB attachment mirror, § Attachments)
    // is unaffected, only this localStorage mirror failed to write.
    _showPersistWarning();
    return false;
  }
}

function saveState() {
  const _pageVersion = document.documentElement.dataset.pageVersion || '';
  // MERGE over the stored blob; never rebuild it from the DOM alone. The scans
  // below only see nodes that exist RIGHT NOW, and the design template's dock
  // is built by a different script block (§ Layout JS `buildDesignUI()`) whose
  // DOMContentLoaded listener may not have run yet, and is torn down and
  // rebuilt on every iteration switch. A from-scratch rebuild therefore wrote
  // a blob with no `text:{screen-id}` keys on the first `input` event after
  // load — deleting the user's notes rather than merely failing to show them.
  // Keys whose node IS present are overwritten below as before, so this only
  // ever preserves entries the current DOM has nothing to say about.
  let state = {};
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Same two rejections restoreState() makes. Without them a merge would
    // resurrect an expired or foreign-version blob that the restore path
    // would have deleted, and carry its dead keys forward for another day.
    if (prev && typeof prev === 'object'
        && !(prev._savedAt && (Date.now() - prev._savedAt) > STATE_TTL_MS)
        && !(prev._pageVersion && prev._pageVersion !== _pageVersion)) {
      state = prev;
    }
  } catch (e) { /* corrupt storage — start from an empty blob */ }
  state._savedAt = Date.now();
  state._pageVersion = _pageVersion;
  // Device-view frames are CLONES of a mockup (§ Responsive device views).
  // They carry namespaced ids, so persisting them would fill the blob with
  // dead `dv1-*` / `dv2-*` keys — and, worse, the next screen switch tears the
  // stage down before saveState() runs, which would DELETE those keys again.
  // The authored original is still in the DOM (display:none) and is the one
  // legitimate copy, so skipping the clones loses nothing.
  const persistable = el => !el.closest('[data-device-clone]');
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    // data-no-persist opts a control out of reload restoration. Used by the
    // close-out wizard's ship question, which must be answered fresh every
    // time: a restored "yes" from hours ago would sail through a later
    // wizard run and trigger a real release the user never re-authorised.
    if (el.dataset.noPersist !== undefined) return;
    if (!persistable(el)) return;
    if (el.name || el.id) state['input:' + (el.name || el.id) + ':' + el.value] = el.checked;
  });
  document.querySelectorAll('textarea, input[type="text"], input[type="number"]').forEach(el => {
    if (!persistable(el)) return;
    const _key = el.id || el.dataset.comment;
    if (!_key) return;
    // Belt-and-braces for the dock rebuild: buildDesignUI() re-creates every
    // dock textarea EMPTY, so a saveState() that runs between the rebuild and
    // the restore would blank a stored note (the merge above only protects
    // keys whose node is ABSENT — these nodes are present). An empty field
    // therefore may only overwrite a non-empty stored value once the user has
    // actually typed into it: `data-touched` is stamped from a TRUSTED input
    // event (see the capture-phase listener at the bottom of this block), so
    // deliberately clearing a note — type, then delete — still persists "".
    if (el.value === '' && state['text:' + _key] && el.dataset.touched === undefined) return;
    state['text:' + _key] = el.value;
  });
  document.querySelectorAll('input[type="range"]').forEach(el => {
    if (!persistable(el)) return;
    if (el.id || el.name) state['range:' + (el.id || el.name)] = el.value;
  });
  document.querySelectorAll('select').forEach(el => {
    if (!persistable(el)) return;
    if (el.id || el.name) state['select:' + (el.id || el.name)] = el.value;
  });
  // Design template only, and read off the DOM rather than passed in: the
  // design layout keeps its viewport state inside its own IIFE, and
  // applyViewport() mirrors it onto the body precisely so this one writer can
  // see it. Absent on every other template, where the key is simply not
  // written. It persists the PREFERENCE (data-viewport-pref), not the mode
  // currently rendered — saving while a decision-template tab is open would
  // otherwise write back the clamped `desktop` and lose the user's choice.
  if (document.body.dataset.viewportPref) state['_viewportMode'] = document.body.dataset.viewportPref;
  state['theme'] = document.documentElement.getAttribute('data-theme');
  // Same non-form-state precedent as 'theme' above: the (optional)
  // annotation layer's show/hide toggle is global and outlives a single
  // element, so it is keyed directly rather than through the input/text/
  // range/select scans. Written unconditionally (not just when true) so
  // toggling back to visible also persists past a reload.
  state['annoHidden'] = document.body.classList.contains('anno-hidden');
  // Work package B — the dock's user-controlled maximise override (a DOM
  // attribute, not a JS closure variable, so it can be read/written from
  // this script block even though applyDockSize() lives in a different
  // IIFE — § Layout JS `wireDesignLayout()`). Only meaningful for the
  // design template's dock; absent everywhere else, so the `?.` guard
  // degenerates to `undefined` -> falsy, never a crash.
  state['dockMaximized'] = document.getElementById('feedback-dock')?.dataset.userMaximized === 'true';
  // Work package C — persist the active VIEW (§ Views (optional)) the same
  // DOM-read way: a view's active state lives on the element itself
  // (data-view-active), so this needs no dependency on wireDesignLayout()'s
  // closures despite living in a different script block. Absent on pages
  // with no views, or while a design (not a view) is on screen.
  // Explicitly DELETED when no view is active — this key means "the user was
  // reading a view when they left", and under the merge above an absent write
  // would silently keep the last one, sending every later reload back into a
  // view the user had already navigated away from.
  const _activeViewEl = document.querySelector('section[data-view][data-view-active="true"]:not([hidden])');
  if (_activeViewEl) state['_activeView'] = _activeViewEl.dataset.view;
  else delete state['_activeView'];
  // Persist the user-interacted flag so a reload while the user has unsaved
  // edits does not re-arm the empty-submit confirm dialog. Restored values
  // would otherwise look like "untouched defaults" because change/input
  // events fire from restoreState() (isTrusted=false) and are ignored.
  // Deleted rather than left alone when false, for the same reason as
  // _activeView above: the merge would otherwise make the flag permanent
  // once set, surviving the clearDock() that is supposed to reset it.
  if (typeof _userInteracted !== 'undefined' && _userInteracted) {
    state['_userInteracted'] = true;
  } else {
    delete state['_userInteracted'];
  }
  _guardedSetItem(STORAGE_KEY, JSON.stringify(state));
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
    // Mirror of the theme restore above — see saveState(). Only ADDS the
    // class; never removes it here, since the default (no class) already
    // means "visible" and a missing/false key must not fight that default.
    if (state.annoHidden) document.body.classList.add('anno-hidden');
    // Mirror of the annoHidden restore above — see saveState(). Re-applies
    // sizing immediately (not just on the next iteration switch) because
    // this script block's DOMContentLoaded listener is not guaranteed to
    // run after wireDesignLayout()'s own initial applyDockSize() call.
    if (state.dockMaximized) {
      const dockEl = document.getElementById('feedback-dock');
      if (dockEl) dockEl.dataset.userMaximized = 'true';
    }
    if (typeof window.applyDockSize === 'function') window.applyDockSize();
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
        // Mirror of the saveState() guard — also covers stale entries written
        // before a control was marked data-no-persist.
        if (el && el.dataset.noPersist === undefined) el.checked = value;
      } else if (type === 'text') {
        const id = rest.join(':');
        // Resolve inside the LIVE iteration first. Annotation ids (`anno-a1`)
        // and `{decisionId}-note` keys are only unique per iteration, so a
        // page-wide first match writes the live text into iteration 1's
        // frozen textarea and brings the live field back blank. Frozen
        // iterations carry their submitted values in the HTML and must never
        // be restored from localStorage. The page-wide fallback is what the
        // feedback dock needs — it is an overlay outside section[data-iteration].
        const live = document.querySelector('section[data-iteration][data-active]');
        const el = (live && live.querySelector(`[data-comment="${id}"]`))
          || document.querySelector(`[data-comment="${id}"]`)
          || document.querySelector(`textarea#${CSS.escape(id)}, input#${CSS.escape(id)}`);
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
  // Re-sync the (optional) annotation eye pill's aria-label/aria-pressed
  // AFTER restoreState() has applied the persisted body.anno-hidden class —
  // wireAnnotationLayer()'s own DOMContentLoaded-time updateAnnoUI() call
  // may run before this listener (script order is not guaranteed across
  // the page's several IIFEs), so relying on that alone would read the
  // toggle's pre-restore state. See § Annotation Layer JS.
  if (typeof updateAnnoUI === 'function') updateAnnoUI();
});
// Stamps the field the user is actually typing in, so saveState()'s
// empty-value guard can tell "cleared on purpose" from "not restored yet".
// CAPTURE phase, so it runs before the bubble-phase saveState below no matter
// what else listens. isTrusted filters out the synthetic events restoreState()
// dispatches — a restore must never count as user input.
document.addEventListener('input', e => {
  if (e.isTrusted && e.target && e.target.dataset) e.target.dataset.touched = 'true';
}, true);
document.addEventListener('change', saveState);
document.addEventListener('input', saveState);
```

**Rules:**
- Use `localStorage` with a 24-hour TTL
- Save on every `change` and `input` event — not just on submit
- Restore runs on `DOMContentLoaded` — before the user sees the page. The
  design template re-runs it once more from § Layout JS, IMMEDIATELY after
  `buildDesignUI()` has created the dock textareas and before anything that can
  call `saveState()` (`showScreen()`, `primeDock()`): the two script blocks'
  listeners have no guaranteed order, so the restore here may have scanned a
  dock that did not exist yet
- An empty `text:` field never overwrites a non-empty stored value unless the
  user has typed into it (`data-touched`) — a rebuilt, not-yet-restored dock
  textarea must not be mistaken for a cleared note
- `saveState()` MERGES over the stored blob and never rebuilds it from the DOM
  alone — a key whose node is currently absent must survive the write
- `ensureCommentSlots()` runs IMMEDIATELY before `restoreState()` — see
  § Comment Slot Injection for the rationale (must inject the slots before
  the restore step rehydrates their values)
- The `concept-submitted` class is NOT persisted
- Theme preference IS persisted — prevents dark/light flash on reload
- The (optional) annotation layer's global show/hide state IS persisted the
  same way (`state['annoHidden']`) — see § Annotation Layer (optional).
  Individual answers persist for free via the ordinary `text:` scan since
  their textareas carry `data-comment`.
- Every `localStorage.setItem` call site (here and the two `-pending` writes
  near the submit handler) goes through `_guardedSetItem()`, never a bare
  `localStorage.setItem` — a `QuotaExceededError` is caught, surfaces a
  visible `.persist-warning-banner` (`{{state.persist_failed}}`) instead of
  throwing out of the `change`/`input` handler, and further writes keep
  being attempted (a later one may succeed once the user frees up space).

### Persist Warning Banner CSS

`_showPersistWarning()` (above) creates this element on first failure —
there is no static markup for it, it never appears unless a write actually
fails, so nothing needs to reserve space for it up front.

```css
.persist-warning-banner {
  position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
  z-index: 10000; max-width: min(480px, calc(100vw - 2rem));
  background: var(--danger-color, #f85149); color: #fff;
  padding: .6rem 1rem; border-radius: 8px; font-size: .82rem;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}
```

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
    ta.dataset.attachable = '';
    ta.placeholder = '{{decision.comment_placeholder}}';
    ta.rows = 2;

    row.appendChild(label);
    row.appendChild(ta);
    // Attachments for this comment (§ Attachments) — initCommentAttachments()
    // (called at the bottom of this function) mounts the bar itself; it is
    // the single place a bar is ever created, so it is not built here too.

    // Insert right after the bi-state group when both share the same parent;
    // otherwise append to the card so the override is visually attached.
    if (group.nextSibling && group.parentNode === card) {
      group.parentNode.insertBefore(row, group.nextSibling);
    } else {
      card.appendChild(row);
    }
  });
  // Wire paste / drop / button on every comment textarea, including the ones
  // emitted inline by the generator rather than injected above.
  initCommentAttachments();
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

## Attachments

Every field marked `textarea[data-attachable]` — the feedback dock (general,
per-design, per-screen, per-view), annotation answers, comparison option and
view notes, and decision comment slots — accepts a file: a 📎 button, **drag
& drop** onto the textarea, and **Ctrl/Cmd+V paste**. A screenshot, a log
file, a PDF spec, a recording — whatever explains the feedback best — beats
re-describing it in prose, and the user should never have to pick which
field "supports" attachments: they all do.

**The marker is `data-attachable`, never `data-comment`.** Several
attachable fields — annotation answers, the decision-note textareas — also
carry `data-comment` for `saveState()`/`restoreState()` and the comment
collectors. Matching on `data-comment` would wire an attachment bar onto
*every* comment field a second time wherever `data-attachable` is also
present, and would wire one onto plain text-only comment fields that were
never meant to take a file. `data-attachable` is the one selector
`initCommentAttachments()` uses, so there is exactly one bar per field,
full stop.

**One bar per field, one mount rule.** A field may already own a dedicated
`<div class="attach-slot" data-attach-slot="{slotKey}">` immediately after
it — the annotation layer and every dock-built textarea (design/screen/view
rows, § Layout JS) declare one. When that mount exists, the bar is placed
inside it; when it does not (decision comment slots, comparison notes,
inline decision-template textareas), the bar is appended right after the
textarea, exactly like the original image-only version of this section did.
Either way, `initCommentAttachments()` is idempotent: it flags each wired
textarea (`dataset.attachWired`) and never creates a second bar for the
same slot key, so calling it again after `ensureCommentSlots()`, after a
dock rebuild (§ Layout JS `buildDesignUI()`), or after an iteration append
is always safe.

**One bar per field is not one bar on screen — the mount must follow its
field's visibility.** The dock builds a textarea per screen, per design and
per view up front and then only flips `hidden` on switch (§ Layout JS), so
at any moment most attachable fields are hidden. Their `.attach-slot` mounts
are *siblings* of those textareas, and `.attach-slot:empty { display: none }`
stops covering them the instant a bar is mounted — which is why the dock
rendered one 📎 row per hidden field stacked under the single visible
textarea. `textarea[hidden] + .attach-slot { display: none }` (§ Layout
CSS) is what keeps the two in step; it works because the mount is always
emitted directly after the textarea it belongs to. **Emit it that way** — a
mount separated from its field, or one nested somewhere else in the row,
silently reintroduces the stack. The same rule names `.attach-bar` for the
mountless path, where `_mountAttachmentBar()` inserts the bar itself
`afterend` of the textarea for exactly this reason. Hiding the bar is deliberately CSS-only:
`showScreen()`/`showDesign()`/`showView()` must stay free to toggle nothing
but `ta.hidden`, and the bar has to keep existing (and stay wired) while
hidden so the attachments already on an inactive field are still there when
the user switches back to it.

**The durability rule is unchanged: upload on ATTACH, never on submit.** The
file is sent to the bridge the moment it is picked/pasted/dropped and is
fsynced to `.claude/concepts/<slug>/attachments/<sha256>.<ext>` shortly
after. A teardown mid-review cannot lose it. Deferring the upload to submit
time would put every attached file back inside the exact window that made
submissions disappear (#284).

Two independent copies exist until the submission is processed:

| Copy | Written when | Survives |
|------|-------------|----------|
| IndexedDB (`concept-attachments`) | immediately, before the network call | server down, bridge reaped, offline |
| `attachments/<sha256>.<ext>` on disk | on the `POST /attachments` ack | browser cache wipe, tab close, PC restart |

The local copy is kept — not deleted on a successful upload — until the
whole submission has been processed. An upload that fails leaves the
attachment marked `synced: false` with a visible retry control, and it is
retried on the next reconnect (`restoreAttachments()`) alongside
`retryPendingSubmission()`.

Content addressing by sha256 makes all of this idempotent: attaching the
same file twice, or a retry re-sending one, resolves to the same file. A
retry can never duplicate a blob.

**Any file type is accepted.** The picker's `accept` restriction is gone,
drag & drop and Ctrl+V no longer filter on `type.startsWith('image/')` —
see § Bridge server: the server accepts "basically any file type", so the
client no longer gatekeeps ahead of it. Plain-text paste is untouched: only
`clipboardData.files` is intercepted, so pasting text into a focused
textarea behaves exactly as before — a paste event with zero files falls
through to the browser's default text-paste handling.

**Rendering — only four raster types get a thumbnail.** `png`, `jpeg`,
`gif`, `webp` render as an `<img>` thumbnail, same as before. Every other
type — including a server-hosted SVG/PDF/office/archive file, which always
comes back `application/octet-stream` (§ Bridge server, `GET
/attachments/<id>` serving policy) and can never be rendered in an `<img>`
— renders as a **file chip**: a type-derived icon, the original filename,
a human-readable size, and a remove control. Chips and thumbnails share the
same `.attach-thumb` wrapper and remove affordance; only the inner content
differs.

**Streaming upload with progress, JSON fallback.** The primary upload path
sends the raw `File`/`Blob` via `XMLHttpRequest` with `X-Attach-Name`
(percent-encoded) and `X-Attach-Mime` headers — the streaming shape from
§ Bridge server. `xhr.upload.onprogress` drives a per-attachment progress
bar so a large file never looks frozen. If the streaming shape is rejected
as unsupported (a `404`/`501`-shaped response from an older bridge that
only knows the legacy JSON shape), the client automatically falls back to
the base64 JSON path used before this change. `413`/`507` responses are
parsed for `reason` and surfaced as a readable message on the chip
(too large / bridge storage full / bridge disk full) instead of a silent
failure — the attachment stays local and marked unsynced either way, so
nothing is lost, only unsynced until the next successful retry.

### HTML

The bar is injected per field by `ensureCommentSlots()` and
`initCommentAttachments()`; generated pages may also emit it inline. No
`accept` attribute on the file input — every type is allowed:

```html
<div class="attach-bar" data-attach-for="variant-a-note">
  <button type="button" class="attach-btn"
          title="{{attach.button_title}}" aria-label="{{attach.button_title}}">📎</button>
  <input type="file" multiple hidden>
  <div class="attach-thumbs"></div>
</div>
```

`{{attach.button_title}}` → e.g. "Datei anhängen (oder Strg+V / hierher
ziehen)". Resolve it at generation time per § UI Locale.

**The 📎 alone is the affordance — no hint label.** Every attachable field
carries a bar, so a spelled-out "Ctrl+V or drop any file" line repeated under
each one is pure noise: it out-weighs the field it decorates and reads as
clutter down a dock of them. The paste/drop shortcuts live in the button's
`title`/`aria-label`, which is where a discoverable-but-quiet affordance
belongs, and the drop target itself stays advertised by the dashed
`.attach-dragover` outline the moment a file is dragged over the textarea.

### CSS

```css
.attach-bar { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; margin-top: .4rem; }
.attach-btn {
  background: var(--surface-2); border: 1px solid var(--border-color);
  color: var(--text-secondary); border-radius: 6px; cursor: pointer;
  padding: .15rem .45rem; font-size: .95rem; line-height: 1.4;
}
.attach-btn:hover { border-color: var(--accent-color); color: var(--text-primary); }
.attach-thumbs { display: flex; gap: .4rem; flex-wrap: wrap; width: 100%; }
.attach-thumb { position: relative; width: 64px; height: 64px; border-radius: 6px;
                overflow: hidden; border: 1px solid var(--border-color); }
.attach-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* File chip — anything that is not one of the four raster types. Fixed
   height to match .attach-thumb so a mixed row of thumbnails and chips
   stays aligned; width grows to fit the filename instead of clipping it,
   since (unlike a thumbnail) there is no image to fall back on. */
.attach-chip {
  display: flex; align-items: center; gap: .35rem; height: 64px; min-width: 64px;
  max-width: 160px; padding: 0 .5rem; border-radius: 6px;
  border: 1px solid var(--border-color); background: var(--surface-2);
}
.attach-chip .attach-chip-icon { font-size: 1.3rem; flex: none; }
.attach-chip .attach-chip-meta { min-width: 0; display: flex; flex-direction: column; gap: .1rem; }
.attach-chip .attach-chip-name {
  font-size: .7rem; color: var(--text-primary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 100px;
}
.attach-chip .attach-chip-size { font-size: .65rem; color: var(--text-tertiary); }
.attach-thumb .attach-remove, .attach-chip .attach-remove {
  position: absolute; top: 1px; right: 1px; width: 16px; height: 16px;
  border: none; border-radius: 50%; cursor: pointer; font-size: .7rem; line-height: 1;
  background: rgba(0,0,0,.65); color: #fff;
}
.attach-chip { position: relative; }
/* Unsynced = on this machine only. Must be visible: it is the difference
   between "safe everywhere" and "safe until this browser forgets". */
.attach-thumb[data-synced="false"], .attach-chip[data-synced="false"] { border-color: var(--warning-color, #d08c30); }
.attach-thumb[data-synced="false"]::after, .attach-chip[data-synced="false"]::after {
  content: "⟳"; position: absolute; bottom: 1px; left: 3px;
  font-size: .7rem; color: var(--warning-color, #d08c30);
}
/* Upload-in-flight progress bar — bottom edge of the thumb/chip. Width is
   driven inline (style.width) from xhr.upload.onprogress; the element only
   exists while synced === false AND a request is actually in flight. */
.attach-progress {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 0;
  background: var(--accent-color); transition: width .15s linear;
}
/* Failed upload — distinct from "still trying" (data-synced=false with no
   error) so the user knows a retry needs a click, not just patience. */
.attach-thumb[data-error="true"], .attach-chip[data-error="true"] { border-color: var(--danger-color, #f85149); }
.attach-retry {
  position: absolute; bottom: 1px; right: 1px; width: 16px; height: 16px;
  border: none; border-radius: 50%; cursor: pointer; font-size: .65rem; line-height: 1;
  background: var(--danger-color, #f85149); color: #fff;
}
/* Drop affordance on the textarea itself. */
textarea[data-attachable].attach-dragover { outline: 2px dashed var(--accent-color); outline-offset: 2px; }
```

### JS

```javascript
// --- IndexedDB mirror: the copy that survives the bridge being gone ---
const ATTACH_DB_NAME = 'concept-attachments';
const ATTACH_STORE = 'blobs';
const ATTACH_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function attachDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACH_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATTACH_STORE)) {
        const os = db.createObjectStore(ATTACH_STORE, { keyPath: 'key' });
        os.createIndex('bySlot', 'slot', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function attachDBPut(rec) {
  const db = await attachDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, 'readwrite');
    tx.objectStore(ATTACH_STORE).put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function attachDBAll() {
  const db = await attachDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, 'readonly');
    const req = tx.objectStore(ATTACH_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function attachDBDelete(key) {
  const db = await attachDB();
  return new Promise((resolve) => {
    const tx = db.transaction(ATTACH_STORE, 'readwrite');
    tx.objectStore(ATTACH_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

// Slot key -> [{key, slot, id, name, mime, size, synced, error, blob}]
const _attachments = new Map();

function buildAttachmentBar(slotKey) {
  const bar = document.createElement('div');
  bar.className = 'attach-bar';
  bar.dataset.attachFor = slotKey;
  bar.innerHTML =
    '<button type="button" class="attach-btn" title="{{attach.button_title}}"' +
    ' aria-label="{{attach.button_title}}">📎</button>' +
    '<input type="file" multiple hidden>' +
    '<div class="attach-thumbs"></div>';
  return bar;
}

function _slotKeyOf(ta) { return ta.dataset.comment || ta.id || ''; }

function _barFor(slotKey) {
  return document.querySelector('.attach-bar[data-attach-for="' + CSS.escape(slotKey) + '"]');
}

// Resolves where a slot's bar lives: a dedicated .attach-slot mount when the
// markup declares one (annotation answers, every dock-built textarea — see
// § Layout JS), otherwise appended straight after the textarea (decision
// comment slots, comparison notes, inline decision-template textareas) —
// same fallback the original image-only bar used.
function _mountAttachmentBar(ta, slotKey) {
  const existing = _barFor(slotKey);
  if (existing) return existing;
  const bar = buildAttachmentBar(slotKey);
  const dedicated = document.querySelector('.attach-slot[data-attach-slot="' + CSS.escape(slotKey) + '"]');
  if (dedicated) dedicated.appendChild(bar);
  // `afterend`, not parentElement.appendChild: the bar belongs to ITS field,
  // and appending to the container drops it after whatever else the row holds
  // — far from the textarea, and out of reach of the
  // `textarea[hidden] + .attach-bar` rule that hides it with its field.
  else if (ta.parentElement) ta.insertAdjacentElement('afterend', bar);
  return bar;
}

function formatAttachSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

function attachFileIcon(mime, name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if ((mime || '').startsWith('image/')) return '🖼️';
  if ((mime || '').startsWith('video/')) return '🎬';
  if ((mime || '').startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'java', 'go', 'rs', 'c', 'cpp'].includes(ext)) return '💻';
  return '📎';
}

function initCommentAttachments() {
  document.querySelectorAll('textarea[data-attachable]').forEach(ta => {
    const slotKey = _slotKeyOf(ta);
    if (!slotKey) return;
    // Idempotent: a rebuilt textarea (dock rebuild, iteration append) is a
    // brand-new node with a clean dataset, so this only short-circuits a
    // genuine double-call on the SAME still-attached node.
    if (ta.dataset.attachWired && _barFor(slotKey)) { renderAttachments(slotKey); return; }
    ta.dataset.attachWired = '1';
    const bar = _mountAttachmentBar(ta, slotKey);
    if (bar.dataset.wired) { renderAttachments(slotKey); return; }
    bar.dataset.wired = '1';

    const fileInput = bar.querySelector('input[type="file"]');
    bar.querySelector('.attach-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      addAttachments(slotKey, Array.from(fileInput.files || []));
      fileInput.value = '';
    });

    // Ctrl/Cmd+V into the textarea — ANY file type in the clipboard, not
    // just images. Plain text paste (files.length === 0) is left alone so
    // the default text-paste behaviour is never touched.
    ta.addEventListener('paste', ev => {
      const items = Array.from((ev.clipboardData || {}).items || []);
      const files = items.filter(i => i.kind === 'file')
                         .map(i => i.getAsFile())
                         .filter(Boolean);
      if (!files.length) return;             // plain text paste — leave it alone
      ev.preventDefault();
      addAttachments(slotKey, files);
    });

    ['dragenter', 'dragover'].forEach(evt =>
      ta.addEventListener(evt, e => { e.preventDefault(); ta.classList.add('attach-dragover'); }));
    ['dragleave', 'drop'].forEach(evt =>
      ta.addEventListener(evt, () => ta.classList.remove('attach-dragover')));
    ta.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []);   // any type
      if (!files.length) return;
      e.preventDefault();
      addAttachments(slotKey, files);
    });

    renderAttachments(slotKey);
  });
}

async function addAttachments(slotKey, files) {
  for (const file of files) {
    const key = slotKey + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    const rec = {
      key, slot: slotKey, id: null, name: file.name || 'attachment',
      mime: file.type || 'application/octet-stream', size: file.size,
      synced: false, error: null, progress: 0, blob: file,
    };
    // LOCAL FIRST — before the network call, so a failure at any point after
    // this leaves the file recoverable on this machine.
    try { await attachDBPut(rec); } catch { /* private mode: server copy still applies */ }
    const list = _attachments.get(slotKey) || [];
    list.push(rec);
    _attachments.set(slotKey, list);
    renderAttachments(slotKey);
    uploadAttachment(rec).then(() => renderAttachments(slotKey));
    if (typeof _markUserInteracted === 'function') _markUserInteracted();
  }
}

// Streaming upload (§ Bridge server, Shape B) with progress, falling back to
// the legacy base64-in-JSON path (Shape A) only when the streaming shape is
// rejected as unsupported — an older bridge that has never heard of it.
function _uploadStreaming(rec) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/attachments');
    xhr.setRequestHeader('Content-Type', rec.mime || 'application/octet-stream');
    xhr.setRequestHeader('X-Attach-Name', encodeURIComponent(rec.name));
    xhr.setRequestHeader('X-Attach-Mime', rec.mime || 'application/octet-stream');
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      rec.progress = Math.round((e.loaded / e.total) * 100);
      renderAttachments(rec.slot);
    };
    xhr.onload = () => {
      if (xhr.status === 404 || xhr.status === 501) { resolve({ unsupported: true }); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        let reason = 'error_generic';
        try { reason = 'error_' + (JSON.parse(xhr.responseText).reason || 'generic'); } catch { /* ignore */ }
        resolve({ ok: false, reason });
        return;
      }
      try { resolve({ ok: true, meta: JSON.parse(xhr.responseText) }); }
      catch { resolve({ ok: false, reason: 'error_generic' }); }
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'error_offline' });
    xhr.send(rec.blob);
  });
}

function _uploadLegacyJSON(rec) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onerror = () => resolve({ ok: false, reason: 'error_offline' });
    fr.onload = async () => {
      const data = String(fr.result).split(',')[1] || '';
      try {
        const res = await fetch('/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: rec.name, mime: rec.mime, data })
        });
        if (!res.ok) {
          let reason = 'error_generic';
          try { reason = 'error_' + ((await res.json()).reason || 'generic'); } catch { /* ignore */ }
          resolve({ ok: false, reason });
          return;
        }
        resolve({ ok: true, meta: await res.json() });
      } catch { resolve({ ok: false, reason: 'error_offline' }); }
    };
    fr.readAsDataURL(rec.blob);
  });
}

async function uploadAttachment(rec) {
  rec.error = null;
  let result;
  try { result = await _uploadStreaming(rec); }
  catch { result = { ok: false, reason: 'error_offline' }; }
  if (result.unsupported) result = await _uploadLegacyJSON(rec);
  if (result.ok) {
    rec.id = result.meta.id;
    rec.synced = true;
    rec.progress = 100;
    try { await attachDBPut(rec); } catch { /* ignore */ }
    return true;
  }
  rec.error = result.reason || 'error_generic';    // {{attach.<reason>}} on the chip
  return false;
}

function renderAttachments(slotKey) {
  const bar = _barFor(slotKey);
  if (!bar) return;
  const thumbs = bar.querySelector('.attach-thumbs');
  thumbs.innerHTML = '';
  for (const rec of _attachments.get(slotKey) || []) {
    const raster = ATTACH_RASTER_MIME.has(rec.mime);
    const wrap = document.createElement('div');
    wrap.className = raster ? 'attach-thumb' : 'attach-chip';
    wrap.dataset.synced = String(!!rec.synced);
    wrap.dataset.error = String(!!rec.error);
    wrap.title = rec.name + (rec.synced ? '' : rec.error ? ' — {{attach.' + rec.error + '}}' : ' — {{attach.uploading}}');

    if (raster) {
      const img = document.createElement('img');
      // Prefer the server copy once it exists: it proves the durable write
      // landed, and it survives an IndexedDB eviction.
      img.src = rec.synced && rec.id ? '/attachments/' + rec.id : URL.createObjectURL(rec.blob);
      img.alt = rec.name;
      wrap.appendChild(img);
    } else {
      // Never <img> a non-raster blob — a server-hosted SVG/PDF/etc. is
      // always served application/octet-stream (§ Bridge server), so there
      // is nothing an <img> tag could show.
      const icon = document.createElement('span');
      icon.className = 'attach-chip-icon';
      icon.textContent = attachFileIcon(rec.mime, rec.name);
      const meta = document.createElement('div');
      meta.className = 'attach-chip-meta';
      const nameEl = document.createElement('span');
      nameEl.className = 'attach-chip-name';
      nameEl.textContent = rec.name;
      const sizeEl = document.createElement('span');
      sizeEl.className = 'attach-chip-size';
      sizeEl.textContent = formatAttachSize(rec.size);
      meta.appendChild(nameEl);
      meta.appendChild(sizeEl);
      wrap.appendChild(icon);
      wrap.appendChild(meta);
    }

    // In-flight progress — only while genuinely uploading (not yet synced,
    // no error recorded yet).
    if (!rec.synced && !rec.error) {
      const bar2 = document.createElement('div');
      bar2.className = 'attach-progress';
      bar2.style.width = (rec.progress || 0) + '%';
      wrap.appendChild(bar2);
    }

    if (rec.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'attach-retry';
      retry.title = '{{attach.retry}}';
      retry.textContent = '⟳';
      retry.addEventListener('click', () => { uploadAttachment(rec).then(() => renderAttachments(slotKey)); });
      wrap.appendChild(retry);
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'attach-remove';
    rm.title = '{{attach.remove}}';
    rm.textContent = '×';
    rm.addEventListener('click', () => removeAttachment(slotKey, rec.key));
    wrap.appendChild(rm);
    thumbs.appendChild(wrap);
  }
}

async function removeAttachment(slotKey, key) {
  // Drops the LOCAL reference only. The server blob is content-addressed and
  // may be referenced by another slot or an earlier round; the store is
  // cleaned as a whole by the disposition step, never piecemeal from the UI.
  _attachments.set(slotKey, (_attachments.get(slotKey) || []).filter(r => r.key !== key));
  await attachDBDelete(key);
  renderAttachments(slotKey);
}

async function restoreAttachments() {
  let all = [];
  try { all = await attachDBAll(); } catch { return; }
  for (const rec of all) {
    const list = _attachments.get(rec.slot) || [];
    list.push(rec);
    _attachments.set(rec.slot, list);
  }
  // Anything that never reached the bridge gets another chance now.
  for (const rec of all.filter(r => !r.synced)) await uploadAttachment(rec);
  for (const slot of _attachments.keys()) renderAttachments(slot);
}

// Called from every collectDecisions branch — only synced attachments are
// named in the payload, because Claude reads them from disk by id. An
// unsynced one is still on this machine and is retried, but it must not be
// advertised as a path that does not exist.
function attachmentsFor(slotKey) {
  return (_attachments.get(slotKey) || [])
    .filter(r => r.synced && r.id)
    .map(r => ({ id: r.id, name: r.name, mime: r.mime, size: r.size,
                 path: '.claude/concepts/{{slug}}/attachments/' + r.id }));
}

function unsyncedAttachmentCount() {
  let n = 0;
  for (const list of _attachments.values()) n += list.filter(r => !r.synced).length;
  return n;
}
```

Wire `restoreAttachments()` into `DOMContentLoaded` **after** `ensureCommentSlots()`
(the bars must exist before thumbnails render), and call `initCommentAttachments()`
again after any iteration append, exactly like `ensureCommentSlots()` — and,
for the design template, after every dock rebuild (§ Layout JS
`buildDesignUI()` already does this — see the `initCommentAttachments()` call
at the end of that function).

`{{slug}}` is the concept's date-slug, substituted at generation time — it is
the store directory name, so Claude can open the referenced file directly with
the Read tool.

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
    // Device-view frames are CLONES of the mockup (§ Responsive device views)
    // and they live inside section[data-iteration][data-active], i.e. exactly
    // this scope. Without this filter a login mock ships `email`, `dv1-email`
    // and `dv2-email` — three fields for one control, under names no human
    // ever typed into, and the panel goes green either way. The authored
    // original is untouched and still collected; only the copies are dropped.
    // Additive on purpose: the selector string above is pinned by
    // validation-gate.md pattern 21 and must stay literal.
    if (el.closest('[data-device-clone]')) return;
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
    const text = el.value.trim();
    const attachments = (typeof attachmentsFor === 'function')
      ? attachmentsFor(el.dataset.comment) : [];
    // An image with no prose is a complete comment — a screenshot often says
    // it better than a sentence. Gating on `text` alone (as this did before
    // attachments existed) would silently drop an image-only remark.
    if (text || attachments.length) {
      comments.push({ id: el.dataset.comment, text, attachments });
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

/* Durability warning strip — shown when a submission or an attachment did
   not reach the bridge's durable store. Deliberately loud: a silent failure
   here is the exact bug the store exists to remove. */
.submit-warning {
  display: none;
  margin: 0 0 .75rem;
  padding: .5rem .7rem;
  border: 1px solid var(--warning-color, #d29922);
  border-left-width: 3px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--warning-color, #d29922) 12%, transparent);
  color: var(--text-primary);
  font-size: .8rem;
  line-height: 1.4;
}
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

  // The submitted panel is already on screen, and it is a promise that the
  // payload is safe. That promise must be backed by a DURABLE ack, not by
  // "the request did not throw". `fetch` rejects only on a transport failure,
  // so a 507 (bridge could not persist) resolved like any other response and
  // the old code counted it as success — then cleared the local copy. That is
  // the client-side half of #284.
  let durable = false;
  let transportFailed = false;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    durable = res.ok && body.durable !== false;
  } catch (e) {
    transportFailed = true;
  }

  if (!durable) {
    // Keep a local copy first, whatever went wrong.
    _guardedSetItem(STORAGE_KEY + '-pending', JSON.stringify(data));
    if (transportFailed) {
      // Offline / bridge down. This case self-heals — retryPendingSubmission()
      // fires on reconnect — so the submitted panel stays up and we only
      // explain the delay.
      showSubmitWarning('{{panel.submit_queued_offline}}');
    } else {
      // The bridge answered but could not persist (disk full, store gone).
      // Nothing retries this on its own, so do NOT leave a "sent" panel
      // standing over it: hand control back and say why.
      restorePanelToReady();
      showSubmitWarning('{{panel.submit_not_durable}}');
    }
  }

  const unsynced = (typeof unsyncedAttachmentCount === 'function')
    ? unsyncedAttachmentCount() : 0;
  if (unsynced > 0) showSubmitWarning('{{panel.attachments_not_synced}}');

  saveState();
  _submitInFlight = false;
}

wireSubmit('submit-iterate-btn', 'iterate');
wireSubmit('submit-implement-btn', 'implement');

// --- Submit warnings ---
// A submission that did not reach disk must SAY SO on the page. The whole
// failure mode this guards against is a confident "übermittelt" panel sitting
// on top of work that no longer exists anywhere, which is what sends the user
// away believing Claude will pick it up.
//
// Locale strings, resolved at generation time per § UI Locale:
//   {{panel.submit_queued_offline}}   — "Bridge nicht erreichbar — wird bei
//                                        Reconnect automatisch nachgeholt.
//                                        Deine Eingaben sind lokal gesichert."
//   {{panel.submit_not_durable}}      — "Die Bridge konnte die Übermittlung
//                                        nicht sichern (Speicherproblem).
//                                        Nichts ist verloren — deine Eingaben
//                                        liegen lokal. Bitte erneut absenden."
//   {{panel.attachments_not_synced}}  — "Ein Bild liegt noch nur lokal vor und
//                                        wird automatisch nachgereicht."
function showSubmitWarning(msg) {
  const host = document.getElementById('panel-submitted')
            || document.getElementById('panel-ready');
  if (!host) return;
  let strip = host.querySelector('.submit-warning');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'submit-warning';
    strip.setAttribute('role', 'alert');
    host.insertBefore(strip, host.firstChild);
  }
  strip.textContent = msg;
  strip.style.display = 'block';
}

function clearSubmitWarning() {
  document.querySelectorAll('.submit-warning').forEach(el => el.remove());
}

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

// --- Final-report close-out wizard (action: "finalize") ---
// The final report used to hand the user four independent controls at once —
// Shippen, Issues erstellen, Concept beenden, Iterationen ansehen — each with
// its own submit. The execution order was implicit, and "I actually want three
// of these" had no expression at all: the first click sent a payload and ended
// the round. The wizard replaces them with ONE guided pass
// (issues → ship → files → review) and a SINGLE submit carrying every
// decision, which Claude then executes in a fixed order
// (SKILL.md Step 5b · finalize).
//
// The step list is computed, not fixed: the issues step is dropped when the
// report has no still-open questions, so the counter reads 3/3 rather than
// promising a step that would be skipped.
let _wizardSteps = [];
let _wizardIndex = 0;

function finalReportSection() {
  const active = document.querySelector('section[data-iteration][data-active]');
  return (active && active.hasAttribute('data-final-report')) ? active : null;
}

// The [data-open-questions] checkboxes in the REPORT BODY stay the single
// source of truth for issue selection. Already-routed items carry `disabled`
// (Claude sets it when it writes the [Issue #NNN] link), so they drop out here
// and the whole step disappears once everything is routed.
function openQuestionBoxes() {
  const active = finalReportSection();
  const block = active ? active.querySelector('[data-open-questions]') : null;
  return block
    ? Array.from(block.querySelectorAll('input[type="checkbox"]:not(:disabled)'))
    : [];
}

function collectIssueItems() {
  return openQuestionBoxes().filter(el => el.checked).map(el => {
    const labelEl = el.closest('label')?.querySelector('.oq-label');
    const labelText = labelEl ? labelEl.textContent.trim() : '';
    // description = explicit data-issue-body wins; otherwise the visible
    // .oq-label text. Either is enough for Claude to skip the setup-issue
    // AskUserQuestion path — the user committed on the review screen, so we
    // MUST NOT ask again.
    return {
      id: el.name || el.id || '',
      title: el.dataset.issueTitle || labelText,
      type: el.dataset.issueType || 'chore',
      description: el.dataset.issueBody || labelText,
      // Optional project-specific label hints — picked up by Claude when
      // present, silently ignored when absent. Concept HTML is generated by
      // Claude, so these are populated from concept context.
      role: el.dataset.issueRole || null,
      module: el.dataset.issueModule || null,
      milestone: el.dataset.issueMilestone || null,
      selected: true
    };
  });
}

function collectDisposition() {
  const radio = document.querySelector('input[name="dispose-mode"]:checked');
  const moveEl = document.getElementById('dispose-move-to');
  const mode = radio ? radio.value : 'discard';
  const moveTo = (moveEl && moveEl.value.trim()) ? moveEl.value.trim() : null;
  return { mode, moveTo };
}

function wizardShipChoice() {
  const el = document.querySelector('input[name="wizard-ship"]:checked');
  return el ? el.value : null;
}

// Recomputes the step list and re-renders. Called from showIteration() with
// { reset: true } (a tab switch restarts the flow) and from the change
// listener without it (the user is mid-flow; keep them where they are).
function refreshFinalizeWizard(opts) {
  const wiz = document.getElementById('finalize-wizard');
  if (!wiz) return;
  const steps = [];
  if (openQuestionBoxes().length) steps.push('issues');
  steps.push('ship', 'files', 'review');
  const previousIndex = _wizardIndex;
  const previous = _wizardSteps[previousIndex];
  _wizardSteps = steps;
  if (opts && opts.reset) {
    _wizardIndex = 0;
  } else {
    // Keep the user where they were. If their step vanished underneath them
    // (Claude routed the last open question while they sat on it), clamp to
    // the nearest surviving position instead of throwing them back to step 1
    // — a silent jump to the start with the counter reset reads as the wizard
    // losing their answers, which it has not.
    const kept = steps.indexOf(previous);
    _wizardIndex = kept >= 0 ? kept : Math.min(previousIndex, steps.length - 1);
  }
  renderWizard();
}

// Freezing is not cosmetic: after a submit the payload is fixed, so a live
// checkbox or a re-enabled execute button would let the user act on a screen
// that no longer describes what was sent.
// Scoped to the wizard's own controls ONLY. Never touch the body's
// [data-open-questions] checkboxes here: Claude disables those permanently as
// it routes each item, and a blanket re-enable on unfreeze would hand back
// checkboxes for issues that already exist.
function setWizardFrozen(frozen) {
  const wiz = document.getElementById('finalize-wizard');
  if (!wiz) return;
  wiz.dataset.frozen = frozen ? 'true' : 'false';
  wiz.querySelectorAll('input, button').forEach(el => { el.disabled = frozen; });
}

// Re-arm after a finalize that did not complete — a blocked ship, a stale
// processed state, a bridge that could not persist. Without this the execute
// button stays disabled forever and the user's only way out is a reload.
function restoreWizardToReady() {
  const wiz = document.getElementById('finalize-wizard');
  if (!wiz) return;
  wiz.querySelectorAll('.hint[data-finalize-state]').forEach(el => { el.hidden = true; });
  setWizardFrozen(false);
  renderWizard();
}

function renderWizard() {
  const wiz = document.getElementById('finalize-wizard');
  if (!wiz) return;

  // A closed-out report is done. Claude stamps data-closed on the section
  // before the final /reload, so the reloaded page shows the outcome instead
  // of re-arming a wizard whose bridge has already been shut down — a live
  // execute button there would queue a submission nobody will ever pick up.
  const section = finalReportSection();
  if (section && section.hasAttribute('data-closed')) {
    wiz.querySelectorAll('.wizard-step, .wizard-nav').forEach(el => { el.hidden = true; });
    const done = document.getElementById('wizard-execute');
    if (done) done.hidden = true;
    wiz.querySelectorAll('.hint[data-finalize-state]').forEach(el => {
      el.hidden = el.dataset.finalizeState !== 'done';
    });
    const label = document.getElementById('wizard-count');
    if (label) label.textContent = '';
    return;
  }

  const current = _wizardSteps[_wizardIndex];

  wiz.querySelectorAll('.wizard-step').forEach(sec => {
    sec.hidden = sec.dataset.wizardStep !== current;
  });

  const count = document.getElementById('wizard-count');
  if (count) {
    count.textContent = (wiz.dataset.wordStep || 'Step') + ' ' +
      (_wizardIndex + 1) + '/' + _wizardSteps.length;
  }

  const onReview = current === 'review';
  const back = document.getElementById('wizard-back');
  const next = document.getElementById('wizard-next');
  const exec = document.getElementById('wizard-execute');
  if (back) back.hidden = _wizardIndex === 0;
  if (next) next.hidden = onReview;
  if (exec) exec.hidden = !onReview;

  if (current === 'issues') buildWizardIssueList();
  if (onReview) buildWizardPlan();

  const none = document.getElementById('wizard-issues-none');
  if (none) none.hidden = !(current === 'issues' && collectIssueItems().length === 0);
  const req = document.getElementById('wizard-ship-required');
  if (req) req.hidden = true;

  // Re-apply after the rebuilds above: buildWizardIssueList() creates fresh
  // mirror checkboxes, which would otherwise come back live on a frozen
  // wizard.
  if (wiz.dataset.frozen === 'true') setWizardFrozen(true);
}

// The wizard's issue checkboxes MIRROR the body ones so the user never has to
// leave the panel to decide — the body block stays authoritative.
function buildWizardIssueList() {
  const host = document.getElementById('wizard-issue-list');
  if (!host) return;
  const boxes = openQuestionBoxes();
  // Only rebuild when the underlying item SET changed — a rebuild driven by a
  // mirror's own change event would tear the row out from under the user's
  // cursor mid-click. The comparison is by id, never by count: Claude can
  // route one item (it gains `disabled`, leaving openQuestionBoxes) while the
  // same rewrite appends another, and a count-keyed fast path would then sync
  // every mirror to the WRONG body checkbox — the user ticks a row labelled A
  // and files an issue for B.
  const ids = JSON.stringify(boxes.map(el => el.name || el.id || ''));
  if (host.dataset.itemKey === ids) {
    Array.from(host.children).forEach((row, i) => {
      const box = row.querySelector('input');
      if (box && boxes[i]) box.checked = boxes[i].checked;
    });
    return;
  }
  host.dataset.itemKey = ids;
  host.textContent = '';
  boxes.forEach(src => {
    const row = document.createElement('label');
    row.className = 'wizard-issue';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = src.checked;
    // Deliberately no name/id: saveState() and collectAllFormFields() key off
    // dataset.field / name / id, so a keyless control is never persisted and
    // never uploaded — no second source of truth, no duplicate payload field.
    box.dataset.mirrorFor = src.name || src.id || '';
    box.addEventListener('change', () => {
      src.checked = box.checked;
      src.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const labelEl = src.closest('label')?.querySelector('.oq-label');
    const text = document.createElement('span');
    text.textContent = src.dataset.issueTitle
      || (labelEl ? labelEl.textContent.trim() : '');
    row.appendChild(box);
    row.appendChild(text);
    host.appendChild(row);
  });
}

// The review screen is the only place that names every consequence at once —
// it is what makes a single "Alles ausführen" click legitimate.
function buildWizardPlan() {
  const wiz = document.getElementById('finalize-wizard');
  const list = document.getElementById('wizard-plan');
  if (!wiz || !list) return;
  list.textContent = '';
  const add = (kind, text) => {
    const li = document.createElement('li');
    li.dataset.planKind = kind;
    li.textContent = text;
    list.appendChild(li);
  };
  const items = collectIssueItems();
  if (items.length) add('issues', items.length + ' × ' + (wiz.dataset.planIssues || ''));
  if (wizardShipChoice() === 'yes') add('ship', wiz.dataset.planShip || '');
  const mode = document.querySelector('input[name="dispose-mode"]:checked');
  const modeLabel = mode?.closest('label')?.querySelector('strong')?.textContent.trim();
  const moveTo = collectDisposition().moveTo;
  if (modeLabel) add('files', modeLabel + (moveTo ? ' → ' + moveTo : ''));
  add('close', wiz.dataset.planClose || '');
}

document.getElementById('wizard-next')?.addEventListener('click', () => {
  // The ship step has no preselected answer on purpose: a release must never
  // be the by-product of clicking through. Explain the block instead of
  // disabling the button, which would look broken.
  if (_wizardSteps[_wizardIndex] === 'ship' && !wizardShipChoice()) {
    const req = document.getElementById('wizard-ship-required');
    if (req) {
      req.hidden = false;
      req.scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if (_wizardIndex < _wizardSteps.length - 1) _wizardIndex += 1;
  renderWizard();
});

document.getElementById('wizard-back')?.addEventListener('click', () => {
  if (_wizardIndex > 0) _wizardIndex -= 1;
  renderWizard();
});

// One submit for the whole close-out. Claude executes the parts in a fixed
// order (issues → ship → disposition), so the user never has to sequence
// outward-facing actions by clicking things in the right order.
// POST /decisions has NO version guard (that lives on /reset and /status), so
// a payload the bridge already fsynced but whose response never reached the
// browser sits in two places at once. For an iterate that is harmless; for a
// finalize it means a second `gh issue create` run and a second real release.
// The id is what lets retryPendingSubmission() recognise its own payload on
// the bridge and drop the local copy instead of re-sending it.
function newSubmissionId() {
  return 'sub-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function submitFinalize() {
  const active = finalReportSection();
  const wiz = document.getElementById('finalize-wizard');
  const btn = document.getElementById('wizard-execute');
  if (!active || !wiz || !btn) return;
  if (wiz.dataset.frozen === 'true') return;

  const items = collectIssueItems();
  const payload = {
    submitted: true,
    action: 'finalize',
    submission_id: newSubmissionId(),
    issues: { create: items.length > 0, items },
    ship: { run: wizardShipChoice() === 'yes' },
    disposition: collectDisposition()
  };

  setWizardFrozen(true);
  wiz.querySelectorAll('.hint[data-finalize-state]').forEach(el => {
    el.hidden = el.dataset.finalizeState !== 'running';
  });

  const container = document.getElementById('concept-decisions');
  if (container) container.textContent = JSON.stringify(payload);
  document.body.classList.add('concept-submitted', 'content-dimmed');
  showContentDimmer();
  // Same submit-state bookkeeping submitWithAction does. Without it
  // pollProcessedState() returns at its first line, so a finalize gets no
  // `_picked_up_at` progress in the status channel and — worse — no
  // PROCESSED_SAFETY_MS recovery: a Claude that dies mid-finalize would leave
  // the wizard disabled under a spinner forever.
  _submittedAt = Date.now();
  _submittedReloadCounter = _bootReloadCounter;
  _submittedAction = 'finalize';

  // A finalize can ship. "The request did not throw" is not good enough here —
  // require the bridge's durable ack, exactly as submitWithAction does.
  let durable = false;
  let transportFailed = false;
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    durable = res.ok && body.durable !== false;
  } catch (e) {
    transportFailed = true;
  }

  if (!durable) {
    _guardedSetItem(STORAGE_KEY + '-pending', JSON.stringify(payload));
    if (transportFailed) {
      // Offline / bridge down — retryPendingSubmission() delivers it on
      // reconnect, so leave the sent state up and just explain the delay.
      if (typeof showSubmitWarning === 'function') {
        showSubmitWarning('{{panel.submit_queued_offline}}');
      }
    } else {
      // The bridge answered but could not persist. Nothing retries that on its
      // own, so hand the wizard back rather than leave a "sent" state standing
      // over a payload that never landed.
      restoreWizardToReady();
      document.body.classList.remove('concept-submitted', 'content-dimmed');
      hideContentDimmer();
      _submittedAt = 0;
      _submittedReloadCounter = null;
      _submittedAction = null;
      if (typeof showSubmitWarning === 'function') {
        showSubmitWarning('{{panel.submit_not_durable}}');
      }
    }
  }
}

document.getElementById('wizard-execute')?.addEventListener('click', submitFinalize);

// "Iterationen ansehen" — non-committal, client-only. Scrolls the iteration
// tab bar into view and flashes it so the user can revisit earlier iterations
// / the agenda without leaving the final report. The wizard stays put — the
// whole point of the persistent panel is that there is nothing to re-open.
document.getElementById('view-iterations-btn')?.addEventListener('click', () => {
  const tabs = document.querySelector('.iteration-tabs');
  if (!tabs) return;
  tabs.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  tabs.classList.remove('tabs-nudge');
  void tabs.offsetWidth;  // force reflow so the animation restarts
  tabs.classList.add('tabs-nudge');
});

// Recompute whenever an input the wizard summarises changes — the
// open-questions checkboxes in the body, the ship choice, the disposition
// mode. The generic change listener (for saveState) fires the same event, so
// we just hook into the same channel.
document.addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.matches) return;
  // A frozen wizard describes a payload that is already on its way — nothing
  // on screen may still re-render against newer input.
  if (document.getElementById('finalize-wizard')?.dataset.frozen === 'true') return;
  // Element-agnostic on purpose: openQuestionBoxes() and the gating contract
  // both accept ANY element carrying [data-open-questions]. A listener pinned
  // to `section[...]` silently stops updating the mirrors and the review plan
  // on a report that used a div or ul — so the review screen would name the
  // wrong issue count right before the one irreversible click.
  if (t.matches('[data-open-questions] input[type="checkbox"]') ||
      t.matches('input[name="wizard-ship"]') ||
      t.matches('input[name="dispose-mode"]')) {
    refreshFinalizeWizard();
  }
});
document.addEventListener('DOMContentLoaded', () => {
  refreshFinalizeWizard({ reset: true });
});

// --- Offline Submit Queue ---
async function retryPendingSubmission() {
  const pendingKey = STORAGE_KEY + '-pending';
  const pending = localStorage.getItem(pendingKey);
  if (!pending) return;
  // Did this exact payload already land? `fetch` can throw after the bridge
  // has fsynced (tab closed, Wi-Fi drop mid-response), which queues a payload
  // that is already being processed. Re-POSTing a finalize that way runs its
  // side effects — issue creation, a real release, file deletion — a second
  // time. Payloads without a submission_id (iterate/implement, legacy pages)
  // keep the old unconditional-retry behaviour.
  try {
    const id = JSON.parse(pending).submission_id;
    if (id) {
      const cur = await fetch('/decisions', { cache: 'no-store' });
      const seen = cur.ok ? await cur.json().catch(() => ({})) : {};
      if (seen.submission_id === id) { localStorage.removeItem(pendingKey); return; }
    }
  } catch (e) { /* unparseable or bridge unreachable — fall through and retry */ }
  try {
    const res = await fetch('/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: pending
    });
    const body = res.ok ? await res.json().catch(() => ({})) : {};
    // Drop the local copy ONLY once the bridge confirms it reached disk.
    // `res.ok` alone is not that confirmation — see submitWithAction.
    if (res.ok && body.durable !== false) localStorage.removeItem(pendingKey);
  } catch (e) { /* still offline */ }
  // Images that never made it up get another attempt on the same trigger.
  if (typeof restoreAttachments === 'function') restoreAttachments();
}
```

Claude-side: on receiving the payload, branch on `action`:
- `iterate` → Step 5b iterate branch: summarize + append next iteration only
- `implement` → Step 5b implement branch: actually write code/files, then
  append the final-report section (frozen "implementiert" record)
- `finalize` → Step 5b finalize branch: run the selected close-out parts in a
  FIXED order — issues (`gh issue create` behind the user-value gate) → ship
  (full `/ship` pipeline) → Step 6 cleanup with the bundled disposition
- `create-issues` / `ship` / `dispose-concept` → **legacy**, still accepted:
  pages generated before the wizard send these one at a time. Each maps onto
  the matching part of the finalize branch (see SKILL.md § Legacy final-report
  actions); never emit them from newly generated pages

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
  // A final report has no ready panel — its ready state is a re-armed wizard.
  // Un-hiding #panel-ready here would paint the iterate/implement buttons over
  // a final report and let the user submit `iterate` against a closed session,
  // which showIteration() forbids by construction.
  const active = document.querySelector('section[data-iteration][data-active]');
  if (active && active.hasAttribute('data-final-report')) {
    if (typeof restoreWizardToReady === 'function') restoreWizardToReady();
  } else {
    document.getElementById('panel-submitted').style.display = 'none';
    document.getElementById('panel-ready').style.display = 'block';
    ['submit-iterate-btn', 'submit-implement-btn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = false;
    });
  }
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
| 2 · Claude verarbeitet | First `/pending=true` response on the server (the pickup waker, or the backup cron, picked up the submission) — surfaces via `_picked_up_at` in `/decisions` | Always |
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
const HEARTBEAT_STALE_MS = 90000;  // claude_ts older than this → nothing is pulsing
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
  // never gates on server_ts, or a dead pulser would read green forever.)
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
  //       the bridge is alive; the pickup waker (~20s), the backup cron tick (<=60s), or the setup-time
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
  accepted (the panel-final-report has no such buttons). The only
  submission the final-report tab can produce is `action: "finalize"`.

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
  if (typeof refreshFinalizeWizard === 'function') refreshFinalizeWizard({ reset: true });
  document.dispatchEvent(new CustomEvent('iteration:changed'));
}

document.querySelectorAll('.iteration-tab').forEach(tab => {
  tab.addEventListener('click', () => showIteration(tab.dataset.iteration));
});

// The frozen panel's way back. Without it the only exit from a past tab is to
// spot which chip is the live one — and the live tab is not always the last
// chip (the final report is), so guessing is a real failure mode.
document.getElementById('back-to-live-btn')?.addEventListener('click', () => {
  const live = document.querySelector('section[data-iteration][data-active]');
  if (live) showIteration(live.dataset.iteration);
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
— no iterate / implement buttons. It leads with the **persistent status
channel** (`#status-channel`), the full pipeline recap (Übermittelt →
verarbeitet → implementiert → Bereit), and hands over to the **close-out
wizard** (`#finalize-wizard`). A non-committal "Iterationen ansehen" link
sits below the wizard.

The status channel is deliberately **DOM-driven, not connection-driven**: it
is present because the section carries `data-final-report`, so it survives
reloads and stays fully visible even when the Claude heartbeat is stale. This
is the design reason it replaces a transient completion overlay — the close-out
affordance must never vanish just because the connection flickered. Reviewing
earlier iterations (via the ever-present tab bar or the "Iterationen ansehen"
nudge) never hides it, so there is nothing to "re-open".

### The close-out wizard

**Why a wizard and not buttons.** The panel used to show four controls at
once — 🚀 Shippen, Issues erstellen, Concept beenden, Iterationen ansehen —
each firing its own submit. Two things were wrong with that, and both are
structural rather than cosmetic:

1. **No order.** Three of the four were real, irreversible actions with a
   correct sequence (issues before ship before file cleanup), but the panel
   presented them as peers and left the sequencing to the user.
2. **No way to want more than one.** The first click submitted, dimmed the
   content and ended the round. A user who wanted issues *and* a ship *and*
   a specific disposition had no way to say so.

The wizard fixes both by collecting decisions client-side and submitting once.

**Steps** — exactly one visible at a time, list computed at render:

| Step | Shown when | Default | Produces |
|---|---|---|---|
| `issues` | the report has a `[data-open-questions]` block with ≥1 non-disabled checkbox | all items checked (opt-out) | `issues: { create, items[] }` |
| `ship` | always | **none — the user must pick** | `ship: { run }` |
| `files` | always | `discard` | `disposition: { mode, moveTo }` |
| `review` | always | — | the single `finalize` submit |

**The ship step has no default on purpose.** It is the one step that reaches
outside the repo, so it must be an answered question, never a skipped one.
"Weiter" stays enabled and explains the block (`#wizard-ship-required`) rather
than sitting there disabled and looking broken. Its radios also carry
`data-no-persist`, so the answer never survives a reload — `saveState()`
otherwise restores every named radio document-wide, and a "yes" from an
earlier round would sail through a later wizard run and ship without the user
re-authorising it. Every other wizard control persists normally.

**The review step is what licenses the single click.** It lists every
consequence in execution order — "2 × GitHub-Issue anlegen", "Ship-Pipeline
starten", "Verwerfen (Standard)", "Concept-Session beenden" — before the user
commits. `#wizard-execute` sits behind the same `.submit-gap` as the implement
button, so reaching it is a deliberate mouse move rather than a third click in
the same spot.

**Issue checkboxes are mirrors.** The wizard renders a copy of the
`[data-open-questions]` checkboxes so the user decides without leaving the
panel, but the body block stays the single source of truth: mirrors carry
`data-mirror-for` and no `name`/`id`, so they are never persisted by
`saveState()` and never collected by `collectAllFormFields()`.

**Payload:**

```json
{
  "submitted": true,
  "action": "finalize",
  "issues": { "create": true, "items": [ /* same shape as before */ ] },
  "ship": { "run": true },
  "disposition": { "mode": "discard", "moveTo": null }
}
```

`submitFinalize()` requires the bridge's **durable ack** (`body.durable`), not
just a non-throwing fetch — a finalize can ship, so a 507 that silently looked
like success would be the worst possible place to lose a payload. On transport
failure it queues via the offline submit queue; on a non-durable answer it
hands the wizard back and warns.

**Lifecycle of the wizard's own state:**

| Moment | State |
|---|---|
| Submit | `setWizardFrozen(true)` — every control disabled, running hint up, `_submittedAt` set so `pollProcessedState()` tracks the round like any other submission |
| Non-durable answer | `restoreWizardToReady()` — re-armed, warning shown; the payload is in the offline queue |
| Blocked ship / stuck round | `restorePanelToReady()` routes to `restoreWizardToReady()` for a final report — it must never un-hide `#panel-ready`, which would paint iterate/implement onto a closed session |
| Successful close-out | Claude stamps `data-closed` on the section before the last `/reload`; `renderWizard()` then shows the done hint and no controls at all |

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
       Each <li> is one item; data-issue-* attributes feed the finalize
       payload's issues.items[] directly so Claude can call
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
| `disabled` | set by Claude | Added after the item has been routed (becomes `[Issue #NNN]`) so `openQuestionBoxes()` ignores it on the next reload |

### After issues are created — HTML rewrite pattern

When Claude processes the issues part of a `finalize` payload, the response
loop rewrites each routed `<li>` so the user sees the resulting issue
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

Once every `<li>` in the section is `disabled`, the wizard's issues step
drops out of the step list automatically — the section becomes a read-only
audit log of what was routed.

### Wizard step gating

`refreshFinalizeWizard()` recomputes the step list on:
- `DOMContentLoaded`
- `iteration:changed` (via `showIteration()`) — with `{ reset: true }`, so a
  tab switch restarts the flow at step 1
- any `change` on a `[data-open-questions]` checkbox, the ship radios, or the
  disposition radios — without reset, so a user mid-flow stays put

The `issues` step exists iff all of:
1. Active section has `data-final-report`.
2. Active section contains a `[data-open-questions]` block.
3. That block has at least one `:not(:disabled)` checkbox.

Gating runs client-side only — Claude never adds or removes a step via the
bridge; it controls the issues step indirectly by disabling checkboxes when it
writes the issue-routed HTML.

### Disposition Control

The disposition fieldset (`#panel-dispose-concept`) is the wizard's `files`
step — always present, not gated on open-questions content. Its three radios +
optional `moveTo` text input drive Step 6 cleanup behaviour. The user chooses
how the concept files should land on disk before closing the session.

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

### One submission, three consequences

`finalize` is a single submission that can carry up to three real actions.
Claude executes them in a fixed order — **issues → ship → Step 6 cleanup** —
and the order is not negotiable:

- Issues first, because they are cheap, local to GitHub, and their creation
  must not depend on a release succeeding.
- Ship second, because it is the one part that can hard-fail on a gate. When
  it does, Claude stops there: already-created issues stand, **cleanup does
  not run**, and the concept session stays open so the user can retry.
- Cleanup last, because `discard` deletes the concept HTML — doing that before
  the outward-facing steps would destroy the record while it is still needed.

**Replay protection is client-side, and it has to be.** The `_version`
mismatch guard people reach for here only exists on `POST /reset` and
`POST /status` — `POST /decisions` has no such guard, it just creates a new
version and flips `/pending` to true. So a finalize whose response was lost
in transit after the bridge had already fsynced it sits in BOTH places, and
the offline queue would happily deliver it again: duplicate `gh issue create`,
a second real release, `discard` applied twice. That is why every finalize
carries a `submission_id` and `retryPendingSubmission()` compares it against
what `/decisions` already holds before re-POSTing (see § Offline Submit
Queue). Do not drop that field, and do not "simplify" the retry.

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
