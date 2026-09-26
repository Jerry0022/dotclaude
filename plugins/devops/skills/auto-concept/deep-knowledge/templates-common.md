# Concept templates, part 01 of 16: Overview, UI locale, common structure

# Concept HTML Templates

Three **templates** (layout modes) cover every concept use case. A template is
picked **per iteration**, not per page — see § Per-Iteration Templates below:

| Template | Layout | When to use |
|---|---|---|
| **decision** | Document column + the ☰ overlay panel + the 💬 feedback dock (general note), multi-variant cards | Multi-option evaluation, trade-offs, architecture or tech decisions — the canonical "pick one" flow with bi-state (Verwerfen / Miteinbeziehen) per variant and multiple iterations |
| **design** | Fullscreen content + overlay decision panel (☰ FAB top-right, collapsed by default) + speech-bubble feedback dock anchored to the 💬 FAB (bottom-right, same 60px circle as ☰, dock collapsed by default) | UI mockups, wireframes, visual design concepts, click-through flows — one artefact that needs maximum screen real estate, plus structured per-screen feedback |
| **free** | Document column + the ☰ overlay panel + the 💬 feedback dock (general note), freeform body content | Analysis, walkthrough, brainstorm, explainer, timeline — structured content without forced variant framing. Bi-state evaluation is optional (opt-in per section) |

The decision panel itself is the SAME in all three — one ☰ overlay, page
chrome, never a sidebar and never moving between rounds (§ Panel Chrome (all
templates)). What the table calls the layout is only what fills the page
behind it.

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
| `panel.submitted_hint`         | Claude is processing your selection. Switch to the Claude chat to follow progress. | Claude verarbeitet deine Auswahl. Wechsle zum Claude-Chat, um den Fortschritt zu sehen. |
| `panel.step_submitted`         | Submitted                      | Übermittelt |
| `panel.step_received`          | Claude is processing           | Claude verarbeitet |
| `panel.step_implemented`       | Implementation complete        | Implementierung abgeschlossen |
| `panel.step_implemented_active`| Implementation in progress     | Implementierung läuft |
| `panel.step_waiting`           | Waiting…                       | Warten… |
| `panel.step_ready`             | Ready to ship                  | Bereit zum Shippen |
| `panel.step_reality_check`     | Reality check                  | Realitäts-Check |
| `panel.step_reality_check_active` | Checking against the default branch… | Prüfe gegen den Default-Branch… |
| `panel.frozen`                 | Frozen iteration               | Eingefrorene Iteration |
| `panel.frozen_hint`            | You are reading an earlier round. It is read-only — its decisions were already submitted. | Du liest eine frühere Runde. Sie ist schreibgeschützt — ihre Entscheidungen wurden bereits übermittelt. |
| `panel.frozen_back`            | Back to the current round      | Zurück zur aktuellen Runde |
| `frozen.bar_hint`              | · earlier round, read-only     | · frühere Runde, schreibgeschützt |
| `frozen.bar_back`              | Go to current round            | Zur aktuellen Runde |
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
| `theme.to_light`               | Switch to the light theme      | Zum hellen Theme wechseln |
| `theme.to_dark`                | Switch to the dark theme       | Zum dunklen Theme wechseln |
| `panel.dim_dismiss`            | Dismiss overlay                | Schimmer entfernen |
| `panel.status_saved`           | Saved · connected              | Gespeichert · verbunden |
| `panel.status_saving`          | Saving…                        | Speichert… |
| `panel.status_connecting`      | Saved · connecting…            | Gespeichert · verbinde… |
| `panel.status_local_only`      | Saved locally only · disconnected | Nur lokal gespeichert · getrennt |
| `panel.status_local_only_connected` | Saved locally only       | Nur lokal gespeichert |
| `panel.status_working`         | Submitted · Claude is working  | Übermittelt · Claude arbeitet |
| `panel.status_frozen`          | read-only                      | nur lesen |
| `panel.status_detail`          | Progress                       | Fortschritt |
| `panel.submit_menu`            | More submit options            | Weitere Absende-Optionen |
| `panel.submit_menu_hint`       | The primary button never writes code. | Kein Code beim Primär-Button. |
| `panel.here_back`              | back to round                  | zur Runde |
| `panel.archive_summary`        | previous rounds                | vorherige Runden |
| `panel.submit_collect_failed`  | Could not collect your decisions — nothing was sent. Reload the page and try again | Entscheidungen konnten nicht eingesammelt werden — nichts wurde gesendet. Seite neu laden und erneut versuchen |
| `nav.summary_entries`          | entries                        | Einträge |
| `nav.summary_discarded`        | discarded                      | verworfen |
| `nav.group_context`            | Context                        | Kontext |
| `nav.group_variants`           | Variants                       | Varianten |
| `nav.rounds_chip`              | Previous rounds                | Vorherige Runden |
| `nav.archived`                 | archived                       | archiviert |
| `nav.other_variants`           | Other variants                 | Weitere Varianten |
| `nav.more_entries`             | more                           | weitere |
| `variant.include`              | Include                        | Miteinbeziehen |
| `variant.discard`              | Discard                        | Verwerfen |
| `decision.comment_label`       | Note / override (optional)     | Notiz / Override (optional) |
| `decision.comment_placeholder` | e.g. "only for X", "with variant Y"… | z.B. „nur für X", „mit Variante Y"… |
| `iteration.label`              | Iterations                     | Iterationen |
| `iteration.active_suffix`      | · active                       | · aktiv |
| `iteration.final_tab`          | Final report                   | Abschlussbericht |
| `iteration.reality_tab`        | Reality check                  | Realitäts-Check |
| `nav.sections`                 | Sections                       | Abschnitte |
| `reality.headline`             | The default branch moved while this concept was open | Der Default-Branch hat sich bewegt, während dieses Konzept offen war |
| `reality.intro`                | These changes landed after this concept was written. Implementing it unchanged would produce wrong, dead or duplicate code — so this round asks you about them first. | Diese Änderungen sind gelandet, nachdem dieses Konzept geschrieben wurde. Unverändert umgesetzt würde das falschen, toten oder doppelten Code erzeugen — deshalb fragt diese Runde sie zuerst ab. |
| `reality.reassure`             | Your implement order is not lost: submitting this round with "Implement with feedback" implements directly, with no further check. | Dein Implement-Auftrag ist nicht verloren: Wenn du diese Runde mit „Mit Feedback implementieren" abschickst, wird direkt implementiert — ohne erneute Prüfung. |
| `reality.evidence`             | Landed on the default branch   | Auf dem Default-Branch gelandet |
| `reality.recommendation`       | Recommendation                 | Empfehlung |
| `final.open_questions`         | Open questions & TODOs         | Offene Fragen & TODOs |
| `final.followups_hint`         | Issue = tracked for later. Implement now = built during this close-out, by the devops agents. Drop = it ends with the concept. | Issue = für später festgehalten. Jetzt umsetzen = wird in diesem Abschluss gebaut, von den devops-Agents. Ignorieren = fällt mit dem Concept weg. |
| `final.followups_none`         | Everything dropped — no issue, no implementation. | Alles ignoriert — kein Issue, keine Umsetzung. |
| `final.route_issue`            | Issue                          | Issue |
| `final.route_implement`        | Implement now                  | Jetzt umsetzen |
| `final.route_ignore`           | Drop                           | Ignorieren |
| `final.origin_deferred`        | deferred by you                | bewusst vertagt |
| `final.origin_found`           | found on the way               | unterwegs gefunden |
| `final.issue_link_prefix`      | Issue                          | Issue |
| `final.done_prefix`            | implemented                    | umgesetzt |
| `final.dispose_heading`        | This concept page              | Diese Konzeptseite |
| `final.dispose_hint`           | Only the page is at stake here — whatever was implemented, shipped or filed stays. | Hier geht es nur um die Seite — alles Umgesetzte, Geshippte und Angelegte bleibt. |
| `final.dispose_discard`        | Delete the page (default)      | Seite löschen (Standard) |
| `final.dispose_discard_hint`   | Removes the HTML + its decisions JSON. The implementation is untouched. | Entfernt die HTML + ihr Decisions-JSON. Die Umsetzung bleibt unberührt. |
| `final.dispose_keep`           | Keep in project                | Im Projekt behalten |
| `final.dispose_keep_hint`      | Files stay in docs/concepts/ and become git-tracked artefacts. | Files bleiben in docs/concepts/ und sind git-getrackte Artefakte. |
| `final.dispose_gitignore`      | Local only / .gitignore        | Nur lokal / .gitignore |
| `final.dispose_gitignore_hint` | Files stay locally, an entry is appended to .gitignore. | Files bleiben lokal, ein Eintrag wird zur .gitignore hinzugefügt. |
| `final.dispose_move_label`     | Move to (optional):            | Verschieben nach (optional): |
| `final.dispose_move_placeholder` | e.g. docs/architecture/      | z.B. docs/architecture/ |
| `final.ship_hint`              | Runs the full ship pipeline (build, version bump, release, merge). | Startet die komplette Ship-Pipeline (Build, Version-Bump, Release, Merge). |
| `final.closeout_heading`       | Close-out                      | Abschluss |
| `final.followups_q`            | Open points                    | Offene Punkte |
| `final.closeout_ship_q`        | Ship this now?                 | Jetzt shippen? |
| `final.closeout_ship_yes`      | Yes, run the ship pipeline     | Ja, Ship-Pipeline starten |
| `final.closeout_ship_no`       | No, leave it unreleased        | Nein, nicht releasen |
| `final.closeout_ship_no_hint`  | The code stays as committed. You can ship later from the chat. | Der Code bleibt wie committed. Shippen geht später jederzeit im Chat. |
| `final.closeout_choice_required` | Answer this one — it is the only step that reaches outside the repo. | Beantworte diese eine Frage — sie ist der einzige Schritt, der das Repo verlässt. |
| `final.closeout_plan_warn`     | One click, all of it — including anything outward-facing. | Ein Klick, alles davon — inklusive allem was nach aussen geht. |
| `final.closeout_execute`       | Execute                        | Ausführen |
| `final.closeout_execute_offline` | Execute · will be queued     | Ausführen · wird zwischengespeichert |
| `final.closeout_next`          | Continue ›                     | Weiter › |
| `final.closeout_progress`      | {n} of {total} answered        | {n} von {total} beantwortet |
| `final.closeout_unanswered`    | unanswered                     | unbeantwortet |
| `final.closeout_steps`         | {n} steps                      | {n} Schritte |
| `final.closeout_label_files`   | This page                      | Diese Seite |
| `final.closeout_summary_ship_yes` | ship                        | shippen |
| `final.closeout_summary_ship_no` | no release                   | nicht releasen |
| `final.closeout_running`       | Claude is working through it … | Claude arbeitet es ab … |
| `final.closeout_done`          | Concept closed.                | Concept abgeschlossen. |
| `final.closeout_stalled`       | Delivered, but Claude stopped answering. Nothing more can be sent from this page — check the chat. | Übermittelt, aber Claude antwortet nicht mehr. Von dieser Seite kann nichts mehr gesendet werden — schau in den Chat. |
| `final.closeout_stalled_short` | Delivered · Claude stopped answering | Übermittelt · Claude antwortet nicht |
| `final.handoffs`               | By hand, afterwards            | Danach von Hand |
| `final.handoffs_hint`          | Claude cannot do these — they stay with you once this is through. | Das kann Claude nicht übernehmen — das bleibt bei dir, sobald das hier durch ist. |
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
| `attach.error_quota_exceeded`  | Storage full on the bridge       | Speicher auf der Bridge voll |
| `attach.error_disk_full`       | Bridge disk is full               | Bridge-Festplatte ist voll |
| `attach.error_offline`         | Bridge unreachable — kept locally, will retry on reconnect | Bridge nicht erreichbar — lokal gespeichert, Wiederholung bei Verbindung |
| `attach.error_empty`           | Empty file — nothing to upload   | Leere Datei — nichts hochzuladen |
| `attach.error_length_required` | Upload rejected — size unknown (no Content-Length) | Upload abgelehnt — Größe unbekannt (keine Content-Length) |
| `attach.error_client_aborted`  | Upload interrupted — retry       | Upload abgebrochen — bitte wiederholen |
| `attach.error_store_write_failed` | Bridge could not write the file — retry | Bridge konnte die Datei nicht schreiben — bitte wiederholen |
| `attach.error_store_unavailable` | Bridge store unavailable — restart the bridge | Bridge-Speicher nicht verfügbar — Bridge neu starten |
| `state.persist_failed`         | Could not save your changes locally — storage is full. Free up space or export your work soon. | Deine Änderungen konnten lokal nicht gespeichert werden — der Speicher ist voll. Platz freigeben oder Arbeit bald exportieren. |
| `state.recovered_found`        | Notes from an earlier version of this page were restored. | Notizen aus einer früheren Fassung dieser Seite wurden wiederhergestellt. |
| `state.recovered_dismiss`      | Dismiss                          | Ausblenden |
| `state.draft_local_only`       | Notes are saved in this browser only — the bridge is unreachable. | Notizen liegen nur in diesem Browser — die Bridge ist nicht erreichbar. |
| `state.draft_save_failed`      | Notes are saved in this browser only — the bridge did not store them. | Notizen liegen nur in diesem Browser — die Bridge hat sie nicht gespeichert. |
| `state.dock_submitted`         | Sent to Claude — read-only until the next round. | An Claude gesendet — schreibgeschützt bis zur nächsten Runde. |
| `design.viewport_switch`       | View                           | Ansicht |
| `design.viewport_desktop`      | Desktop                        | Desktop |
| `design.viewport_tablet`       | Tablet                         | Tablet |
| `design.viewport_phone`        | Phone                          | Handy |
| `design.orientation_portrait`  | Portrait                       | Hochkant |
| `design.orientation_landscape` | Landscape                      | Querformat |
| `map.view_schema`              | Schema                         | Schema |
| `map.view_matrix`              | Matrix                         | Matrix |
| `map.tier_first`               | At first glance                | Auf den ersten Blick |
| `map.tier_after`               | After click                    | Nach Klick |
| `map.items`                    | Items                          | Einträge |
| `map.search`                   | Search…                        | Suchen… |
| `map.filter_all`               | All                            | Alle |
| `map.filter_unassigned`        | Unassigned                     | Nicht zugeordnet |
| `map.filter_multiple`          | Multiple                       | Mehrfach |
| `map.filter_changed`           | Changed                        | Geändert |
| `map.reset`                    | Reset to proposal              | Auf Vorschlag zurücksetzen |
| `map.reset_confirm`            | Reset this matrix to the proposal? | Diese Matrix auf Claudes Vorschlag zurücksetzen? |
| `map.copy`                     | Copy {from} → {to}             | {from} → {to} kopieren |
| `map.copy_confirm`             | Overwrite {to} with {from}?    | {to} mit {from} überschreiben? |
| `map.add_item`                 | item                           | Eintrag |
| `map.add_item_prompt`          | Label of the new item          | Bezeichnung des neuen Eintrags |
| `map.add_item_duplicate`       | An item with this label already exists | Ein Eintrag mit dieser Bezeichnung existiert bereits |
| `map.added_group`              | Added by you                   | Von dir ergänzt |
| `map.armed_item`               | {label}: tap a slot — Esc ends | {label}: Slot antippen — Esc beendet |
| `map.armed_slot`               | {label}: tap items — Esc ends  | {label}: Einträge antippen — Esc beendet |
| `map.summary_unassigned`       | {n} unassigned                 | {n} nicht zugeordnet |
| `map.summary_violations`       | {n} constraint(s) open         | {n} Regel(n) offen |
| `map.summary_ok`               | all assigned                   | alles zugeordnet |
| `map.slot_empty_min`           | empty – min. {n}               | leer – mind. {n} |
| `map.slot_over_max`            | over max {n}                   | über Maximum {n} |
| `map.item_required`            | required, unassigned           | Pflicht, nicht zugeordnet |
| `map.remove`                   | Remove                         | Entfernen |
| `map.slot_note`                | Note for this slot             | Notiz zu diesem Slot |
| `map.context`                  | Context                        | Kontext |
| `map.axis`                     | Axis                           | Achse |
| `map.tab_open`                 | {n} open                       | {n} offen |
| `map.frozen_missing`           | Submitted state missing — showing the proposal | Übermittelter Stand fehlt — zeigt Claudes Vorschlag |
| `map.spec_error`               | Mapping spec could not be read: {error} | Mapping-Spezifikation nicht lesbar: {error} |

**`map.*` strings are rendered by the mapping engine** (§ Information
Mapping (engine)), not authored: Claude substitutes the `{{map.*}}` tokens
inside the engine's `MAP_LOCALE` table when copying the block. `{n}`,
`{label}`, `{from}`, `{to}` and `{error}` are runtime placeholders the engine
fills (`fmt()`) — keep them in every translation. `map.items` doubles as the
palette title ("Items (40)") and the aria-label of the palette collapse
button; `map.reset` / `map.add_item` / `map.copy` get their `↺` / `+` / `⧉`
glyph prefixed by the engine (the button reads "+ item"), so the strings
carry none. Every `map.*` cell is substituted into a single-quoted JS string
literal in `MAP_LOCALE`, so **no cell may contain an ASCII apostrophe (`'`),
a backtick (`` ` ``) or a backslash (`\`)** — any of these would break the
engine block's `<script>` fence and throw a `SyntaxError` before the page
renders. Reword around the restriction (e.g. drop possessives) rather than
escaping the character.

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
             iteration-intro) eat vertical space and duplicate context.
             No controls in here: the theme toggle lives in the ☰ panel's
             head row (page chrome, every template), not in the reading
             column. -->
        <h1>{title}</h1>
        <p class="subtitle">{optional one-line context — omit if not needed}</p>
      </header>

      <main>
        <!-- One <section data-iteration="N"> per iteration. Exactly one has
             data-active. All others render their controls disabled/readonly
             and preserve the values the user submitted that round.
             Each iteration section may open with its own iteration-intro
             block (title + one paragraph) BEFORE the variant/content cards. -->
        <!--
        <section data-iteration="1" data-iteration-template="decision" hidden>...frozen first round...</section>
        <section data-iteration="2" data-iteration-template="decision" data-active>...current round (active)...</section>
        -->
      </main>
    </div>

    <!-- Decision panel — ONE ☰ overlay in every template (§ Panel Chrome
         (all templates)). The #panel-toggle FAB and the .panel-backdrop after
         the aside are part of the same component and are not optional on a
         decision/free page: without them the panel has no way to open. -->
    <aside class="concept-decision-panel" id="decision-panel">
      <!-- Head row — the panel's chrome line, right-aligned: the theme toggle
           and the ✕. The toggle is page chrome exactly like the panel itself
           (§ Theme Toggle): one control, the same place in every template,
           and the reading column stays content-only. It names the NEXT
           action the way the ☰/💬 FABs do (☀️ while dark) — glyph via CSS,
           tooltip + aria-label via the data-label-* pair (§ Theme Toggle JS).
           Both labels come from the locale table, never baked text. -->
      <!-- The head row IS the "you are here" line: [data-here-round] at the
           left (mirrors the selected tab's label via showIteration — no
           "· aktiv"/"· active" suffix on the live round, an {{nav.archived}}
           marker on a frozen one, "(Variante)" appended by
           updateHereRoundParenthesis while the reading line sits inside a
           variant section), then — right-aligned as one group —
           #panel-here-back (frozen rounds only), the 🕘 rounds chip (count
           of PREVIOUS rounds, hidden when there are none), the theme toggle
           and ✕. One row for all of it: the round label used to sit on its
           own line under the chrome row, which cost a line of the panel's
           height for nothing (the user's call). -->
      <div class="panel-head">
        <span class="panel-here-round" data-here-round></span>
        <!-- Right end, as a group: the wrapper (not either child) carries
             margin-left: auto, so the pair stays right-aligned whether or
             not #panel-here-back is [hidden] (the live round has no back
             link — the chip must not lose its right alignment then). -->
        <span class="panel-here-right">
          <button type="button" id="panel-here-back" class="link-btn panel-here-back" hidden></button>
          <!-- 🕘 rounds chip — count of PREVIOUS rounds, hidden when there are
               none (§ Section Navigation, buildRoundsChip). Click toggles
               #panel-here-rounds-list, a plain non-persisted disclosure that
               lists every previous round with its generated summary and an
               "archived" tag; a row click switches to that round via the same
               showIteration() path as an iteration tab. -->
          <button type="button" id="panel-here-rounds" class="panel-here-rounds-btn" hidden
                  aria-haspopup="true" aria-expanded="false" aria-controls="panel-here-rounds-list"
                  data-tip="{{nav.rounds_chip}}" aria-label="{{nav.rounds_chip}}">
            <span aria-hidden="true">🕘</span> <span data-here-rounds-count></span>
          </button>
        </span>
        <button type="button" id="theme-toggle" class="theme-toggle-btn"
                data-label-light="{{theme.to_light}}"
                data-label-dark="{{theme.to_dark}}"
                data-tip="{{theme.to_light}}" aria-label="{{theme.to_light}}">
          <span class="theme-glyph" data-glyph="sun" aria-hidden="true">☀️</span>
          <span class="theme-glyph" data-glyph="moon" aria-hidden="true">🌙</span>
        </button>
        <button id="panel-close" class="panel-close-btn" aria-label="{{panel.close}}">✕</button>
      </div>
      <!-- All visible strings are referenced by key in the locale table above.
           Swap to the `de` column when [ui-locale: de] is active. -->

      <!-- PANEL ANATOMY. Below the .panel-head row (round label · 🕘 chip ·
           theme toggle · ✕) the aside is a flex column of exactly four
           children and only the second one scrolls (§ Decision Panel State
           CSS, "Panel anatomy"):
             .panel-here        pinned   "› TOC entry" sub-line + the 🕘 rounds list
             .panel-nav-scroll  flex 1   iteration tabs (hidden) + live TOC
             .panel-status      pinned   ONE status line (+ progress dots after submit)
             .panel-cta         pinned   #panel-ready | #panel-submitted | #panel-frozen | #panel-final-report
           The pin is structural (flex split), never position:sticky inside the
           scroll box: the call to action is reachable without scrolling the
           menu, however many rounds or TOC entries the page has, and the foot
           is the same ≤120px in the smallest and the largest case. -->

      <!-- "You are here", second part: [data-here-section], the "› TOC entry"
           sub-line (dropped entirely on the final report), and
           #panel-here-rounds-list (buildRoundsChip), shown only while the 🕘
           chip in the head row is unfolded. The round label and the chip
           themselves live in .panel-head above. -->
      <div class="panel-here" id="panel-here">
        <span class="panel-here-section" data-here-section hidden></span>
        <div class="panel-here-rounds-list" id="panel-here-rounds-list" hidden role="list">
          <!-- auto-populated by buildRoundsChip() -->
        </div>
      </div>

      <div class="panel-nav-scroll">
        <!-- Iteration tabs — live at the TOP of the decision panel (not in the
             content area). Compact vertical chip list; the active tab shows
             the current round, older tabs stay clickable but show frozen
             snapshots when selected. Auto-populated, one entry per
             <section data-iteration="N">, appended by string edit
             (iteration-rules.md § Iteration append checklist). -->
        <nav class="iteration-tabs" role="tablist" aria-label="{{iteration.label}}">
          <!--
          <button class="iteration-tab" role="tab" data-iteration="1" aria-selected="false">Iteration 1</button>
          <button class="iteration-tab" role="tab" data-iteration="2" aria-selected="true">Iteration 2</button>
          -->
        </nav>

        <!-- Section TOC — auto-populated from EVERY top-level <section id="..."
             data-nav-label="..."> inside the active iteration, not just variants.
             Sections that carry a bi-state radio group (eval-{id}) display their
             current state label; plain sections (Ist-Zustand, Context, Design-Notes,
             etc.) just show the label and anchor-scroll on click.
             buildSectionNav() rebuilds it here — inside the scroll box, on its
             own — on every load and every switch: it holds ONLY the live
             round's TOC now, grouped around the selected variant when one is
             unambiguous (its own sub-sections nested and open, every other
             variant collapsed into one row) or the old flat/kind-grouped list
             otherwise (Kompass, § Section Navigation). The other rounds live
             in the pinned head's 🕘 rounds list, not here. -->
        <nav class="section-nav" id="section-nav" aria-label="{{nav.sections}}">
          <!-- auto-populated -->
        </nav>
      </div>

      <!-- Status line — pinned, ONE line, six mutually exclusive states on
           .panel-status[data-status] (saved | saving | connecting | local-only |
           submitted | frozen), rendered by renderPanelStatus() from three
           inputs: the heartbeat, the draft mirror and the panel state.
           #connection-status keeps its id and its [data-state] contract
           (connecting | connected | disconnected, set by checkClaudeConnection
           in EVERY panel state — it lives OUTSIDE #panel-ready now). The line
           NEVER overlays or disables the submit buttons and has NO acknowledge
           button: a disconnected submit is cached and auto-delivered on
           reconnect (see Offline Submit Queue), so the line + the cache badge
           on the button are the only signals needed. Starting in "connecting"
           (never "disconnected") is the fix for the fresh-page
           connect→disconnect→connect flash. -->
      <div class="panel-status" id="panel-status" data-status="connecting">
        <div id="connection-status" class="status-line" data-state="connecting" role="status" aria-live="polite">
          <span class="status-glyph" aria-hidden="true">◐</span>
          <span class="conn-label">{{panel.status_connecting}}</span>
        </div>
        <!-- Progress after submit. The <ol> is the real list — § Submit
             Progress Steps writes data-state on its <li>s so the user can see
             whether the submission has only been sent (step 1), whether
             Claude's cron has picked it up (step 2), whether the concept is
             being re-checked against the default branch (step 3) and — for
             implement-action submissions — whether the code change finished
             (step 4). Step 4 is hidden for iterate-action submissions;
             submitWithAction sets its `hidden` from the action. Step 3 stays
             hidden until the check actually runs and reveals it. The dots in
             the <summary> are a compact rendering of the same data-state
             values (renderStatusDots); the list expands under the line.
             Hidden until submit, never tooltip-only. -->
        <details class="status-detail" id="status-detail" hidden>
          <summary class="status-detail-row">
            <span class="status-dots" id="status-dots" aria-hidden="true"></span>
            <span class="status-detail-label">{{panel.status_detail}}</span>
          </summary>
          <ol class="status-steps" id="status-steps" aria-live="polite">
            <li data-step="submitted" data-state="done">
              <span class="step-icon" aria-hidden="true">✓</span>
              <span class="step-label">{{panel.step_submitted}}</span>
            </li>
            <li data-step="received" data-state="active">
              <span class="step-icon" aria-hidden="true">⏳</span>
              <span class="step-label">{{panel.step_received}}</span>
            </li>
            <li data-step="reality-check" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_reality_check}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_reality_check_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_reality_check}}</span>
            </li>
            <li data-step="implemented" data-state="pending" hidden>
              <span class="step-icon" aria-hidden="true">○</span>
              <span class="step-label" data-state-label="pending">{{panel.step_waiting}}</span>
              <span class="step-label" data-state-label="active">{{panel.step_implemented_active}}</span>
              <span class="step-label" data-state-label="done">{{panel.step_implemented}}</span>
            </li>
          </ol>
        </details>
      </div>

      <!-- CTA foot — pinned, hard-capped at 120px. Exactly one of the four
           blocks inside is visible; showIteration() / submitWithAction() /
           restorePanelToReady() switch them. -->
      <div class="panel-cta">
      <!-- Normal state: decision summary + the split button. The primary
           action fills the row; the ▾ caret opens #submit-menu, which holds
           the implement action one level deeper. The misclick barrier is
           colour + border + the extra click, not distance — there is no
           .submit-gap in here any more. The two hint lines moved into
           `data-tip` tooltips; the cache hint stays an inline badge on the
           primary button and a line inside the menu (both toggled by
           _setCacheHints while disconnected). -->
      <div id="panel-ready">
        <div id="decision-summary">
          <!-- Auto-populated summary of current selections -->
        </div>

        <div class="submit-split">
          <button id="submit-iterate-btn" class="primary submit-btn" data-tip="{{panel.submit_iterate_hint}}">
            <span class="submit-label">{{panel.submit_iterate}}</span>
            <span class="hint-cache" data-cache-hint="iterate" hidden>
              <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
            </span>
          </button>
          <button type="button" id="submit-menu-btn" class="submit-menu-btn"
                  aria-haspopup="menu" aria-expanded="false" aria-controls="submit-menu"
                  aria-label="{{panel.submit_menu}}" data-tip="{{panel.submit_menu}}">
            <span aria-hidden="true">▾</span>
          </button>
        </div>
        <div id="submit-menu" class="submit-menu" role="menu" hidden>
          <button id="submit-implement-btn" class="implement-btn" role="menuitem" data-tip="{{panel.submit_implement_hint}}">
            <span class="warn-icon" aria-hidden="true">⚠</span>
            {{panel.submit_implement}}
          </button>
          <p class="hint hint-cache" data-cache-hint="implement" hidden>
            <span aria-hidden="true">⚠</span> {{panel.btn_cache_hint}}
          </p>
          <p class="hint submit-menu-hint">{{panel.submit_menu_hint}}</p>
        </div>
      </div>

      <!-- Post-submit state: the status line above now reads "Übermittelt ·
           Claude arbeitet" and carries the progress dots; this block only
           tells the user where to look next. -->
      <div id="panel-submitted" style="display: none;">
        <div class="submitted-indicator">
          <span class="check-icon">✓</span>
          <strong>{{panel.submitted}}</strong>
        </div>
        <p class="submitted-hint">{{panel.submitted_hint}}</p>
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
           data-final-report. No iterate/implement submit, no status line, no
           pipeline recap — the panel holds ONLY the CLOSE-OUT SHEET: the
           questions in execution order (open points → ship → this page →
           hand-offs) as a strictly sequential accordion, and a SINGLE button
           (action: "finalize") that carries every decision at once and then
           becomes the status of that submission. Nothing on the sheet
           commits anything until #closeout-execute reads "⚠ Ausführen" —
           see § Final Report Panel. -->
      <div id="panel-final-report" style="display: none;">
        <!-- Close-out sheet: a SEQUENTIAL ACCORDION of answerable rows plus
             one button. It replaced, in turn: four buttons at once, a
             four-step wizard (Weiter/Zurück, counter, review screen), a
             free-click accordion with a "Gewählt: …" plan line and three
             status hints under the button, and a status line + pipeline
             recap above it — every one of those cost the rows region the
             height it needs, and the plan line only repeated what the rows'
             own inline summaries already said.
             Each row collapses to ONE line — ○/●/✓ marker, icon (native
             data-tip + aria-label), short label, current-answer summary — and
             exactly one is open at a time (openCloseoutRow()). The order is
             enforced: the first unanswered row opens by itself, every LATER
             unanswered row is locked (data-locked, head `disabled`, no
             summary) and only "Weiter ›" unlocks the next one; an ANSWERED
             row stays clickable to go back and change the answer
             (closeoutRowClick()). "Answered" means the row was open when the
             single #closeout-execute button was clicked
             (closeoutButtonClick()), never a per-row control: a pre-selected
             default may stand as-is, confirming just means the user looked.
             The button reads "Weiter ›" until every visible row is answered,
             then transforms into the warning-coloured "⚠ Ausführen" (the
             consequence warning is its data-tip tooltip) that submits
             `finalize`, and after that click it IS the status: "⏳ Claude
             arbeitet es ab …", then "✓ Concept abgeschlossen." — never two
             buttons, never a status paragraph beneath it
             (setCloseoutButtonState()). The data-label-* attributes carry
             localised strings into the JS; the JS itself never hard-codes
             user-facing text. Row-answered state is mirrored to
             sessionStorage (closeoutStorageKey(), keyed by STORAGE_KEY +
             iteration) so a reload within the session does not re-ask
             already-answered rows — never localStorage, which stays reserved
             for the (data-no-persist) route/ship radios' deliberate reset. -->
        <div id="closeout-sheet" class="closeout-sheet"
             data-label-progress="{{final.closeout_progress}}"
             data-label-unanswered="{{final.closeout_unanswered}}"
             data-label-ship-yes="{{final.closeout_summary_ship_yes}}"
             data-label-ship-no="{{final.closeout_summary_ship_no}}"
             data-label-steps="{{final.closeout_steps}}">
          <div class="closeout-head">
            <strong class="closeout-title">{{final.closeout_heading}}</strong>
            <span class="closeout-progress" id="closeout-progress" aria-live="polite"></span>
          </div>

          <!-- The rows region — every accordion head plus whichever ONE body
               is open. `flex: 1 1 auto; min-height: 0` + its own overflow-y
               (§ CSS) is what keeps #closeout-execute pinned below it: on the
               close-out sheet's own history a hand-offs row with a full list
               open pushed the button off a 768px/900px viewport, the exact
               "viel Scrollen, Button nicht an der gleichen Stelle" complaint
               this fixes. Every head inside is `position: sticky` on BOTH
               `top` and `bottom` (offsets set per visible block by
               layoutCloseoutRowHeads(), § JS) — a fixed pixel/percentage
               floor on this region either squeezed the pinned foot below the
               fold or still only fit one head at a time with a body open;
               sticky-both-edges keeps all four heads visible regardless of
               how little height the region actually gets. -->
          <div class="closeout-rows" id="closeout-rows">
          <!-- Block 1 (conditional) — the still-open points, one row each,
               three routes per row. Rendered from the [data-open-questions]
               checkboxes in the report body, which stay the single source of
               truth for WHICH points are still open: "Ignorieren" unchecks
               the body box, the other two check it. The route radios are
               data-no-persist for the same reason the ship radios are: after
               a reload every row must fall back to the harmless default
               (Issue — nothing is built), never to a remembered
               "jetzt umsetzen" the user cannot see. -->
          <section class="closeout-block" data-closeout-block="followups" hidden>
            <button type="button" class="closeout-row" data-closeout-row aria-expanded="false">
              <span class="closeout-mark" data-closeout-mark aria-hidden="true">○</span>
              <span class="closeout-row-icon" aria-hidden="true" data-tip="{{final.followups_q}}" aria-label="{{final.followups_q}}">📌</span>
              <span class="closeout-row-label">{{final.followups_q}}</span>
              <span class="closeout-count" id="closeout-followup-count" aria-live="polite"></span>
              <span class="closeout-row-summary" data-closeout-summary></span>
            </button>
            <div class="closeout-row-body" data-closeout-row-body hidden>
              <p class="hint">{{final.followups_hint}}</p>
              <div class="followup-list" id="closeout-followup-list"
                   data-label-issue="{{final.route_issue}}"
                   data-label-implement="{{final.route_implement}}"
                   data-label-ignore="{{final.route_ignore}}"
                   data-label-origin-deferred="{{final.origin_deferred}}"
                   data-label-origin-found="{{final.origin_found}}"></div>
              <p class="hint hint-none" id="closeout-followups-none" hidden>
                <span aria-hidden="true">⚠</span> {{final.followups_none}}
              </p>
            </div>
          </section>

          <!-- Block 2 — ship or not. Deliberately has NO default, so the row
               can only be CONFIRMED once a radio is chosen: advanceCloseout()
               refuses and shows #closeout-ship-required instead — opening and
               looking at the row is free, answering it is not. -->
          <section class="closeout-block" data-closeout-block="ship">
            <button type="button" class="closeout-row" data-closeout-row aria-expanded="false">
              <span class="closeout-mark" data-closeout-mark aria-hidden="true">○</span>
              <span class="closeout-row-icon" aria-hidden="true" data-tip="{{final.closeout_ship_q}}" aria-label="{{final.closeout_ship_q}}">🚀</span>
              <span class="closeout-row-label">{{final.closeout_ship_q}}</span>
              <span class="closeout-row-summary" data-closeout-summary></span>
            </button>
            <div class="closeout-row-body" data-closeout-row-body hidden>
              <label class="closeout-choice">
                <input type="radio" name="closeout-ship" value="yes" data-no-persist>
                <span class="closeout-choice-label">
                  <strong><span aria-hidden="true">🚀</span> {{final.closeout_ship_yes}}</strong>
                  <span class="closeout-sub">{{final.ship_hint}}</span>
                </span>
              </label>
              <label class="closeout-choice">
                <input type="radio" name="closeout-ship" value="no" data-no-persist>
                <span class="closeout-choice-label">
                  <strong>{{final.closeout_ship_no}}</strong>
                  <span class="closeout-sub">{{final.closeout_ship_no_hint}}</span>
                </span>
              </label>
              <p class="hint hint-warn" id="closeout-ship-required" role="alert" aria-live="polite" hidden>
                <span aria-hidden="true">⚠</span> {{final.closeout_choice_required}}
              </p>
            </div>
          </section>

          <!-- Block 3 — what happens to this page. Drives Step 6 cleanup
               (discard / keep / gitignore / optional moveTo). Default =
               discard: the decisions already landed in commits, issues and
               the implementation, so the HTML rarely needs to live in git.
               The label says "delete the page", never "discard" — the old
               wording read as "throw the work away" and collided with the
               bi-state Verwerfen on every variant card. -->
          <section class="closeout-block" data-closeout-block="files">
            <button type="button" class="closeout-row" data-closeout-row aria-expanded="false">
              <span class="closeout-mark" data-closeout-mark aria-hidden="true">○</span>
              <span class="closeout-row-icon" aria-hidden="true" data-tip="{{final.closeout_label_files}}" aria-label="{{final.closeout_label_files}}">🗂</span>
              <span class="closeout-row-label">{{final.closeout_label_files}}</span>
              <span class="closeout-row-summary" data-closeout-summary></span>
            </button>
            <div class="closeout-row-body" data-closeout-row-body hidden>
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
            </div>
          </section>

          <!-- Block 4 (conditional) — what the USER has to do by hand once
               the close-out is through. Mirrors the report's [data-handoffs]
               section (renderHandoffs) so the one thing nothing here can
               automate is the last thing on the sheet — and the only block
               that stays visible after data-closed (renderCloseout() then
               hides this row's own head, leaving only its read-only body).
               Hidden when the report has no such section: the normal case.
               "Answered" here means opened once — there is nothing to choose. -->
          <section class="closeout-block closeout-handoffs" data-closeout-block="handoffs" hidden>
            <button type="button" class="closeout-row" data-closeout-row aria-expanded="false">
              <span class="closeout-mark" data-closeout-mark aria-hidden="true">○</span>
              <span class="closeout-row-icon" aria-hidden="true" data-tip="{{final.handoffs}}" aria-label="{{final.handoffs}}">⚠</span>
              <span class="closeout-row-label">{{final.handoffs}}</span>
              <span class="closeout-count" id="closeout-handoffs-count"></span>
              <span class="closeout-row-summary" data-closeout-summary></span>
            </button>
            <div class="closeout-row-body" data-closeout-row-body hidden>
              <p class="hint">{{final.handoffs_hint}}</p>
              <ol class="closeout-handoffs-list" id="closeout-handoffs-list"></ol>
            </div>
          </section>
          </div><!-- /.closeout-rows -->

          <!-- The one button, fixed place, five states on [data-ready] /
               [data-finalize-state] — see updateCloseoutButton() and
               setCloseoutButtonState():
                 next     "Weiter ›"                      accent   (rows unanswered)
                 execute  "⚠ Ausführen"                   warning  (all answered; title = the
                          — or "⚠ Ausführen · wird zwischengespeichert" while the bridge
                          is disconnected, the ONLY place the final report says so)
                 running  "⏳ Claude arbeitet es ab …"     accent, disabled
                 done     "✓ Concept abgeschlossen."       success, disabled
                 stalled  "⚠ Übermittelt · Claude antwortet nicht"  warning, disabled
                          (+ the one hint below: it carries an instruction)
               Every label string is baked in at generation time (data-label-*)
               and swapped at runtime. The icon span is EMPTY in the "next"
               state — the label string already carries its own "›"
               (`final.closeout_next` = "Weiter ›"), so an always-visible icon
               rendered "› Weiter ›". -->
          <button type="button" id="closeout-execute" class="implement-btn"
                  data-label-next="{{final.closeout_next}}"
                  data-label-execute="{{final.closeout_execute}}"
                  data-label-execute-offline="{{final.closeout_execute_offline}}"
                  data-label-running="{{final.closeout_running}}"
                  data-label-done="{{final.closeout_done}}"
                  data-label-stalled="{{final.closeout_stalled_short}}"
                  data-title-execute="{{final.closeout_plan_warn}}">
            <span aria-hidden="true" data-closeout-btn-icon hidden>⚠</span>
            <span data-closeout-btn-label>{{final.closeout_next}}</span>
          </button>

          <!-- Shown when the round was delivered but Claude stopped answering
               (markCloseoutStalled). The sheet stays frozen: the payload IS
               on the bridge, and a second execute from here would run the
               whole close-out twice. The one status that keeps a paragraph —
               it tells the user where to go next. -->
          <p class="hint hint-warn" data-finalize-state="stalled" hidden>
            <span aria-hidden="true">⚠</span> {{final.closeout_stalled}}
          </p>
        </div>
      </div>
      </div><!-- /.panel-cta -->
    </aside>

    <!-- ☰ FAB + backdrop — page chrome, same markup in every template. -->
    <button id="panel-toggle" class="panel-fab"
            aria-label="{{panel.toggle_open}}"
            data-tip="{{panel.toggle_open}}"
            aria-expanded="false"
            data-label-open="{{panel.toggle_open}}"
            data-label-close="{{panel.toggle_close}}">☰</button>
    <div class="panel-backdrop" id="panel-backdrop"></div>

    <!-- 💬 FAB + feedback dock — page chrome in EVERY template (§ Panel
         Chrome (all templates) → Feedback dock). A document round carries
         exactly this: the header row (maximise · minimise) and the
         general-notes section with its attachment slot. The design skeleton
         (§ Layout — Fullscreen single-screen) adds the per-screen /
         per-design / per-view rows ABOVE the general section; on a page that
         mixes templates those rows hide by CSS while a document round is on
         screen. Same ids everywhere: #feedback-toggle, #feedback-dock,
         #feedback-maximize, #feedback-close, #design-general-feedback.
         CLOSED by default (data-open="false"); data-size is written by
         applyDockSize() (§ Panel Chrome JS) — always `compact` on a document
         round. `data-untouched` drives the one-shot pulse that the JS clears
         on the first open or the first keystroke. Every label comes from the
         locale table; never bake English (or "Feedback") in here. -->
    <button id="feedback-toggle" class="feedback-fab"
            aria-label="{{proto.feedback_toggle}}"
            data-tip="{{proto.feedback_toggle}}"
            aria-expanded="false"
            data-untouched="true"
            data-label-open="{{proto.feedback_toggle}}"
            data-label-close="{{panel.minimize}}">💬</button>
    <aside class="feedback-dock" id="feedback-dock" data-open="false" data-size="compact" data-user-maximized="false">
      <div class="feedback-dock-header">
        <strong>{{proto.feedback_title}}</strong>
        <!-- Maximise is a distinct control from minimise: minimise CLOSES
             the dock (data-open toggle), maximise RESIZES it (data-size
             override) without touching data-open at all. Never merge them. -->
        <button id="feedback-maximize" class="feedback-maximize-btn" aria-pressed="false"
                aria-label="{{panel.maximize}}" data-tip="{{panel.maximize}}">⤢</button>
        <button id="feedback-close" class="feedback-close-btn" aria-label="{{panel.minimize}}" data-tip="{{panel.minimize}}">−</button>
      </div>
      <div class="feedback-section">
        <label>{{proto.feedback_general}}</label>
        <textarea id="design-general-feedback" data-comment="general" data-attachable
                  placeholder="{{proto.feedback_general}}"></textarea>
        <div class="attach-slot" data-attach-slot="general"></div>
      </div>
    </aside>
  </div>

  <!-- Content dimmer (all templates) — two jobs, one element.
       (1) Submitted-state focus shifter: after a submit, body.content-dimmed
       flips this on so the user's focus lands on the decision panel / FAB.
       (2) Frozen veil: showIteration() re-arms it on EVERY entry into a
       non-live tab, locking the past round behind the same overlay. In both
       roles the panel + FABs sit above z-index 50 and stay clickable, and the
       dimmer is click/Escape-to-dismiss. The submit role comes back on a
       reload while the round is still sent (restoreInFlightRound() /
       restoreInFlightCloseout() ask the bridge) and on every tab switch back
       to it; the Claude-driven reload onto the next round comes back clear.
       The veil role comes back on the next tab switch, so at most the one
       past round on screen is ever unlocked. -->
  <div class="content-dimmer" id="content-dimmer"
       role="button" tabindex="-1"
       aria-label="{{panel.dim_dismiss}}"
       data-tip="{{panel.dim_dismiss}}" hidden></div>

  <!-- Frozen-iteration floating bar (all templates). Page-level chrome, so it
       lives OUTSIDE section[data-iteration], next to the dimmer. showIteration()
       unhides it on every non-live tab and fills [data-frozen-bar-title] with
       that tab's chip label. It exists because the veil is lifted by reflex:
       once the dimmer is clicked away, nothing on the page says "this is an
       earlier round" except the small chip highlight in the panel — and the
       live chip is not always the last one. Its button is the second way back
       to the live round (#back-to-live-btn in #panel-frozen is the first). -->
  <div class="frozen-bar" id="frozen-bar" role="status" hidden>
    <span class="frozen-bar-text">🕘 <strong data-frozen-bar-title>Iteration 1</strong> {{frozen.bar_hint}}</span>
    <button type="button" id="frozen-bar-back">{{frozen.bar_back}}</button>
  </div>

  <script type="application/json" id="concept-decisions">
    {"submitted": false, "decisions": [], "comments": {"general": {"text": "", "attachments": []}, "items": []}}
  </script>
  <script>/* all JS inline */</script>
</body>
</html>
```

