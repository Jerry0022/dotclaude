# Concept templates, part 01 of 46: Overview, UI locale

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
| `panel.submit_hint` | Your selection is sent straight away. | Deine Auswahl wird direkt übermittelt. |
| `panel.submit_iterate` | 👉 Next round | 👉 Zur nächsten Runde |
| `panel.submit_iterate_hint` | Your selection goes into the next round. No code changes. | Deine Auswahl geht in die nächste Runde. Es wird kein Code geschrieben. |
| `panel.submit_implement` | Implement now | Jetzt umsetzen |
| `panel.submit_implement_hint` | You approve the scope — it is turned into real changes now. | Du gibst den Umfang frei — er wird jetzt in echte Änderungen umgesetzt. |
| `panel.submitted` | Submitted | Übermittelt |
| `panel.submitted_hint` | Your selection is on its way into the next round. | Deine Auswahl ist unterwegs in die nächste Runde. |
| `panel.step_submitted`         | Submitted                      | Übermittelt |
| `panel.step_received` | In progress | In Arbeit |
| `panel.step_implemented`       | Implementation complete        | Implementierung abgeschlossen |
| `panel.step_implemented_active`| Implementation in progress     | Implementierung läuft |
| `panel.step_waiting`           | Waiting…                       | Warten… |
| `panel.step_ready`             | Ready to ship                  | Bereit zum Shippen |
| `panel.step_reality_check`     | Reality check                  | Realitäts-Check |
| `panel.step_reality_check_active` | Checking against the default branch… | Prüfe gegen den Default-Branch… |
| `panel.frozen` | Frozen round | Eingefrorene Runde |
| `panel.frozen_hint`            | You are reading an earlier round. It is read-only — its decisions were already submitted. | Du liest eine frühere Runde. Sie ist schreibgeschützt — ihre Entscheidungen wurden bereits übermittelt. |
| `panel.frozen_back`            | Back to the current round      | Zurück zur aktuellen Runde |
| `frozen.bar_hint`              | · earlier round, read-only     | · frühere Runde, schreibgeschützt |
| `frozen.bar_back`              | Go to current round            | Zur aktuellen Runde |
| `panel.connecting_title` | Connecting to the bridge | Verbindung wird aufgebaut |
| `panel.connected_title` | Connected — every change is saved | Verbunden — jede Änderung ist gespeichert |
| `panel.disconnected_title` | Not connected — your input stays saved and is sent on reconnect | Nicht verbunden — deine Eingaben bleiben gespeichert und gehen beim Verbinden raus |
| `panel.btn_cache_hint`         | cached — sent on reconnect     | gecached — wird beim Verbinden gesendet |
| `panel.empty_iterate_confirm` | Nothing was changed. Submit "Next round" anyway? | Du hast nichts geändert. Trotzdem "Zur nächsten Runde" absenden? |
| `panel.empty_implement_confirm` | Nothing was changed. Implement with feedback anyway? Code will still be written. | Du hast nichts geändert. Trotzdem mit Feedback implementieren? Dann wird Code geschrieben. |
| `panel.toggle_open`            | Open decisions                 | Entscheidungen öffnen |
| `panel.toggle_close`           | Close decisions                | Entscheidungen schliessen |
| `panel.close`                  | Close                          | Schliessen |
| `panel.minimize`               | Minimize                       | Minimieren |
| `theme.to_light`               | Switch to the light theme      | Zum hellen Theme wechseln |
| `theme.to_dark`                | Switch to the dark theme       | Zum dunklen Theme wechseln |
| `panel.dim_dismiss`            | Dismiss overlay                | Schimmer entfernen |
| `panel.status_saved` | saved | gespeichert |
| `panel.status_saving` | saving… | speichert… |
| `panel.status_connecting` | connecting… | verbindet… |
| `panel.status_local_only` | all saved · reconnecting… | alles gespeichert · verbinde… |
| `panel.status_local_only_connected` | saved in this browser only | nur in diesem Browser gespeichert |
| `panel.status_working` | saved | gespeichert |
| `panel.toast_open` | Open the panel | Panel öffnen |
| `panel.status_frozen`          | read-only                      | nur lesen |
| `panel.status_closed`          | concept closed                 | Concept abgeschlossen |
| `panel.submit_implement_sub` | no further round | keine weitere Runde |
| `panel.turn_you` | Your turn | Du bist dran |
| `panel.turn_rethinking` | rethinking | überdenkt |
| `panel.turn_implementing` | implementing | setzt um |
| `panel.status_reconnecting` | reconnecting… | verbinde… |
| `panel.journey_label` | Round progress | Rundenverlauf |
| `panel.journey_rethinking` | Rethinking | Rethinking |
| `panel.journey_implement` | Implementation | Umsetzung |
| `panel.journey_finish` | Close-out | Abschluss |
| `panel.journey_lock` | Enough rounds? Implement now | Genug Runden? Jetzt umsetzen |
| `panel.journey_back` | Back — one more round | Zurück — doch noch eine Runde |
| `panel.journey_done` | Approved | Freigegeben |
| `panel.journey_step` | Step {n} of {m}: {label} | Schritt {n} von {m}: {label} |
| `panel.journey_req` | Requirement {n} of {m} | Anforderung {n} von {m} |
| `panel.toast_round` | Round {n} | Runde {n} |
| `panel.toast_new_round` | New round | Neue Runde |
| `panel.toast_all_saved` | all saved | alles gespeichert |
| `panel.toast_reconnecting` | reconnecting | verbinde |
| `panel.status_detail`          | Progress                       | Fortschritt |
| `panel.submit_menu`            | More submit options            | Weitere Absende-Optionen |
| `panel.submit_menu_hint`       | The primary button never writes code. | Kein Code beim Primär-Button. |
| `panel.here_back`              | back to round                  | zur Runde |
| `panel.archive_summary`        | previous rounds                | vorherige Runden |
| `panel.submit_collect_failed`  | Could not collect your decisions — nothing was sent. Reload the page and try again | Entscheidungen konnten nicht eingesammelt werden — nichts wurde gesendet. Seite neu laden und erneut versuchen |
| `panel.submit_queued_offline` | Bridge unreachable — it is sent automatically on reconnect. Your input is saved locally. | Bridge nicht erreichbar — wird bei Reconnect automatisch nachgeholt. Deine Eingaben sind lokal gesichert. |
| `panel.submit_not_durable`    | The bridge could not save the submission (storage problem). Nothing is lost — your input is stored locally. Please submit again. | Die Bridge konnte die Übermittlung nicht sichern (Speicherproblem). Nichts ist verloren — deine Eingaben liegen lokal. Bitte erneut absenden. |
| `panel.processed_no_round` | Finished without a new round — your answers are still here. Submit again if they were not addressed. | Ohne neue Runde abgeschlossen — deine Eingaben sind erhalten. Bitte erneut absenden, falls sie nicht beantwortet wurden. |
| `panel.attachments_not_synced` | An image is still only stored locally and will be sent automatically. | Ein Bild liegt noch nur lokal vor und wird automatisch nachgereicht. |
| `nav.summary_entries`          | entries                        | Einträge |
| `nav.summary_discarded`        | discarded                      | verworfen |
| `nav.group_context`            | Context                        | Kontext |
| `nav.group_variants`           | Decisions                      | Entscheidungen |
| `nav.group_findings`           | Findings                       | Befunde |
| `nav.rounds_chip`              | Previous rounds                | Vorherige Runden |
| `nav.archived`                 | archived                       | archiviert |
| `nav.other_variants`           | Other variants                 | Weitere Varianten |
| `nav.more_entries`             | more                           | weitere |
| `variant.include`              | Include                        | Miteinbeziehen |
| `variant.discard`              | Discard                        | Verwerfen |
| `decision.comment_label`       | Note / override (optional)     | Notiz / Override (optional) |
| `decision.comment_placeholder` | e.g. “only for X”, “with variant Y”… | z.B. „nur für X“, „mit Variante Y“… |
| `iteration.label` | Rounds | Runden |
| `iteration.tab`                | Round                          | Runde |
| `iteration.active_suffix`      | · active                       | · aktiv |
| `iteration.final_tab`          | Final report                   | Abschlussbericht |
| `iteration.reality_tab`        | Reality check                  | Realitäts-Check |
| `nav.sections`                 | Sections                       | Abschnitte |
| `reality.headline`             | The default branch moved while this concept was open | Der Default-Branch hat sich bewegt, während dieses Konzept offen war |
| `reality.intro`                | These changes landed after this concept was written. Implementing it unchanged would produce wrong, dead or duplicate code — so this round asks you about them first. | Diese Änderungen sind gelandet, nachdem dieses Konzept geschrieben wurde. Unverändert umgesetzt würde das falschen, toten oder doppelten Code erzeugen — deshalb fragt diese Runde sie zuerst ab. |
| `reality.reassure`             | Your implement order is not lost: submitting this round with "Implement with feedback" implements directly, with no further check. | Dein Implement-Auftrag ist nicht verloren: Wenn du diese Runde mit „Mit Feedback implementieren" abschickst, wird direkt implementiert — ohne erneute Prüfung. |
| `reality.evidence`             | Landed on the default branch   | Auf dem Default-Branch gelandet |
| `reality.recommendation`       | Recommendation                 | Empfehlung |
| `final.phase`                  | Close-out                      | Abschluss |
| `final.done_what`              | What was done                  | Was getan wurde |
| `final.results`                | What came out                  | Was kam raus |
| `final.holds`                  | What it withstands             | Was es aushält |
| `final.depth`                  | Test depth                     | Prüftiefe |
| `final.level_of`               | level {n} of 7                 | Stufe {n} von 7 |
| `final.level_code`                | Code check                     | Code-Check |
| `final.level_dry`                | Dry run                        | Trockentest |
| `final.level_interplay`                | Interplay                      | Zusammenspiel |
| `final.level_local`                | Played through locally         | Lokal durchgespielt |
| `final.level_prod`                | Prod build checked             | Prod-Build geprüft |
| `final.level_live`                | Tested live                    | Live vertestet |
| `final.level_accept`                | Accepted by you                | Von dir abgenommen |
| `final.target_met`             | target met                     | Ziel erreicht |
| `final.target_short`           | {n} short of the target        | {n} fehlen bis Ziel |
| `final.before`                 | Before                         | Vorher |
| `final.after`                  | After                          | Nachher |
| `final.try_it`                 | Try it yourself                | Selbst ausprobieren |
| `final.open_live`              | Open the live version          | Live-Version öffnen |
| `final.banner_done`            | Closed                         | Abgeschlossen |
| `final.banner_live`            | live as {version}              | live als {version} |
| `final.funde_fold`             | {n} findings on the way        | {n} Funde unterwegs |
| `final.dev_fold`               | For developers                 | Für Entwickler |
| `final.fund_what`              | What                           | Was |
| `final.fund_where`             | Where                          | Wo |
| `final.fund_why`               | Why pre-selected               | Warum vorbelegt |
| `final.route_issue`            | Issue                          | Issue |
| `final.route_implement`        | Implement now                  | Jetzt umsetzen |
| `final.route_implement_short`  | Now                            | Jetzt |
| `final.route_ignore`           | Drop                           | Ignorieren |
| `final.route_implement_hint`   | Built in this close-out, before any ship. | Wird in diesem Abschluss gebaut, vor dem Shippen. |
| `final.route_issue_hint`       | Filed as a GitHub issue for later. Nothing is built now. | Wird als GitHub-Issue für später angelegt. Jetzt wird nichts gebaut. |
| `final.route_ignore_hint`      | Ends with the concept. Nothing is filed or built. | Fällt mit dem Concept weg. Nichts wird angelegt oder gebaut. |
| `final.route_recommended`      | Recommended:                   | Empfohlen: |
| `final.origin_deferred`        | deferred by you                | bewusst vertagt |
| `final.origin_found`           | found on the way               | unterwegs gefunden |
| `final.sammel_row`             | {n} more findings → one collected issue | {n} weitere Funde → ein Sammel-Issue |
| `final.sammel_title`           | [CHORE] Collected findings ({n}) | [CHORE] Gesammelte Funde ({n}) |
| `final.sheet_close`            | Close without changing         | Ohne Änderung schließen |
| `final.group_decide`           | You decide                     | Du entscheidest |
| `final.group_tests`            | You test                       | Du testest |
| `final.group_handoffs`         | You do afterwards              | Du machst danach |
| `final.group_claude`           | Claude does on the click       | Claude macht beim Klick |
| `final.mode_skip`              | Not needed                     | Muss nicht |
| `final.mode_guide`             | With guidance                  | Mit Anleitung |
| `final.mode_self`              | I'll do it                     | Mach ich selbst |
| `final.guide_web`              | Guidance: 🧭 web guide          | Anleitung: 🧭 Web-Guide |
| `final.guide_desktop`          | Guidance: 🖥 desktop help       | Anleitung: 🖥 Desktop-Hilfe |
| `final.guide_inline`           | Guidance: 📄 written steps in the chat | Anleitung: 📄 Schritte im Chat |
| `final.crit_low`               | low                            | niedrig |
| `final.crit_mid`               | medium                         | mittel |
| `final.crit_high`              | high                           | hoch |
| `final.todo_more`              | +{n} more in the report        | +{n} weitere im Bericht |
| `final.plan_implement`         | {n} × implement now            | {n} × jetzt umsetzen |
| `final.plan_issue`             | {n} × file an issue            | {n} × Issue anlegen |
| `final.closeout_empty`         | Nothing left to decide — just close it out. | Nichts mehr zu entscheiden — nur noch abschließen. |
| `final.issue_link_prefix`      | Issue                          | Issue |
| `final.done_prefix`            | implemented                    | umgesetzt |
| `final.dispose_line_discard`   | This page gets deleted         | Diese Seite wird gelöscht |
| `final.dispose_line_keep`      | This page stays in the project | Diese Seite bleibt im Projekt |
| `final.dispose_line_gitignore` | This page stays local (.gitignore) | Diese Seite bleibt lokal (.gitignore) |
| `final.dispose_change`         | change                         | ändern |
| `final.dispose_heading`        | This concept page              | Diese Konzeptseite |
| `final.dispose_discard`        | Delete the page (default)      | Seite löschen (Standard) |
| `final.dispose_discard_hint`   | Removes the HTML + its decisions JSON. The implementation is untouched; after built or shipped code the spec stays local for 30 days so you can check the result. | Entfernt die HTML + ihr Decisions-JSON. Die Umsetzung bleibt unberührt; nach gebautem oder geshipptem Code bleibt die Vorlage 30 Tage lokal zum Abgleich. |
| `final.dispose_keep`           | Keep in project                | Im Projekt behalten |
| `final.dispose_keep_hint`      | Files stay in docs/concepts/ and become git-tracked artefacts. | Files bleiben in docs/concepts/ und sind git-getrackte Artefakte. |
| `final.dispose_gitignore`      | Local only / .gitignore        | Nur lokal / .gitignore |
| `final.dispose_gitignore_hint` | Files stay locally, an entry is appended to .gitignore. | Files bleiben lokal, ein Eintrag wird zur .gitignore hinzugefügt. |
| `final.dispose_move_label`     | Move to (optional):            | Verschieben nach (optional): |
| `final.dispose_move_placeholder` | e.g. docs/architecture/      | z.B. docs/architecture/ |
| `final.closeout_ship_go`       | Close out & ship               | Abschließen & shippen |
| `final.closeout_noship_go`     | Close out only, don't ship     | Nur abschließen, nicht shippen |
| `final.closeout_ship_go_hint`  | One click, all of it: findings, then the full ship pipeline (build, version bump, release, merge), then this page. | Ein Klick, alles davon: die Funde, dann die komplette Ship-Pipeline (Build, Version-Bump, Release, Merge), dann diese Seite. |
| `final.closeout_noship_go_hint` | One click: findings and this page — no release. You can ship later from the chat. | Ein Klick: die Funde und diese Seite — kein Release. Shippen geht später jederzeit im Chat. |
| `final.closeout_go_offline`    | · will be queued               | · wird zwischengespeichert |
| `final.closeout_running` | Working through it … | Wird abgearbeitet … |
| `final.closeout_done_close`    | Concept closed · close         | Concept abgeschlossen · schließen |
| `final.closeout_stalled` | Delivered, but nothing is answering any more. Nothing more can be sent from this page — check the chat. | Übermittelt, aber es kommt keine Antwort mehr. Von dieser Seite kann nichts mehr gesendet werden — schau in den Chat. |
| `final.closeout_stalled_short` | Delivered · no answer any more | Übermittelt · keine Antwort mehr |
| `proto.feedback_title` | Notes | Notizen |
| `proto.feedback_toggle` | Open notes | Notizen öffnen |
| `proto.feedback_general`       | General notes on this concept  | Allgemeine Notizen zum Konzept |
| `proto.feedback_general_hint`  | Persists across all screens    | Screen-übergreifend persistent |
| `proto.feedback_current`       | this page                      | diese Seite |
| `proto.feedback_placeholder`   | A note on just this page…      | Notiz nur zu dieser Seite… |
| `proto.screen_counter`         | Screen {n} / {total}           | Screen {n} / {total} |
| `design.feedback_design` | whole variant | ganze Variante |
| `design.feedback_design_placeholder` | A note on the variant as a whole… | Notiz zur Variante als Ganzes… |
| `design.switch_label`          | Switch design                  | Design wechseln |
| `design.position_iteration` | Round | Runde |
| `design.position_page`         | Page                           | Seite |
| `anno.toggle_show` | Show notes | Notizen einblenden |
| `anno.toggle_hide` | Hide notes | Notizen ausblenden |
| `anno.toggle_calm_hide` | Hide notes and navigation | Notizen und Navigation ausblenden |
| `anno.toggle_calm_show` | Show notes and navigation | Notizen und Navigation einblenden |
| `anno.answer_placeholder`      | Your answer…                    | Deine Antwort… |
| `anno.pin_label`                | Question {n}                    | Frage {n} |
| `design.nav_views_heading`     | Questions                       | Fragen |
| `design.feedback_view` | this view | diese Ansicht |
| `design.feedback_view_placeholder` | Write a note on this view… | Notiz zu dieser Ansicht… |
| `design.overview`              | Overview                        | Übersicht |
| `design.overview_back`         | Back to the overview            | Zurück zur Übersicht |
| `design.overview_count` | {n} designs · pick a favourite or just add notes | {n} Designs · Favorit wählen oder einfach Notizen machen |
| `design.overview_open`         | Open this design                | Design öffnen |
| `design.overview_notes`        | Notes on this design            | Notizen zu diesem Design |
| `design.overview_count_plain` | {n} designs · just add notes | {n} Designs · einfach Notizen machen |
| `design.overview_prev`         | Previous                        | Vorherige |
| `design.overview_next`         | Next                            | Nächste |
| `design.overview_overlay`      | Show or hide the overlay        | Overlay ein- oder ausblenden |
| `design.keys_carousel`         | Previous / next slide (overview) | Vorherige / nächste Folie (Übersicht) |
| `design.keys_overlay`          | Overlay on / off (overview)     | Overlay ein / aus (Übersicht) |
| `design.key_space`             | Space                           | Leertaste |
| `design.favorite`              | Favourite                       | Favorit |
| `design.favorite_badge`        | FAVOURITE                       | FAVORIT |
| `design.favorite_set`          | Mark as favourite               | Als Favorit markieren |
| `design.favorite_unset`        | Remove the favourite            | Favorit entfernen |
| `design.favorite_hint_set` | The favourite is the starting point; notes on every design still count. | Der Favorit ist der Startpunkt; Notizen zu allen Designs fließen ein. |
| `design.next_screen`           | Next page                       | Nächste Seite |
| `design.change_new`            | New this round                  | Neu in dieser Runde |
| `design.change_changed`        | Changed                         | Geändert |
| `design.change_same`           | Unchanged                       | Unverändert |
| `design.change_preview`        | Preview: {page}                 | Vorschau: {page} |
| `design.change_dot`            | New since the last round        | Neu seit der letzten Runde |
| `design.change_rethought` | Rethought | Neugedacht |
| `design.change_improved` | Improved | Verbessert |
| `design.keys_dock` | Notes dock open / closed | Notiz-Dock auf / zu |
| `design.keys_dock_next` | In a note field: next field, last one closes the dock | Im Notizfeld: nächstes Feld, im letzten schließt der Dock |
| `design.keys_dock_close` | Close the notes dock | Notiz-Dock schließen |
| `design.keys_level` | Level up / down (overview, variant) | Ebene hoch / runter (Übersicht, Variante) |
| `nudge.keys` | Press ? to see all hotkeys | ? zeigt alle Hotkeys |
| `nudge.variants` | Keys 1–{n} switch the variant | Tasten 1–{n} wechseln die Variante |
| `nudge.pages` | Keys ←/→ flip between pages | Tasten ←/→ blättern zwischen Seiten |
| `nudge.dock` | Space opens your notes | Leertaste öffnet deine Notizen |
| `nudge.dismiss` | Hide this tip for 30 days | Tipp 30 Tage ausblenden |
| `design.questions`             | Questions                       | Fragen |
| `design.questions_open`        | {n} questions still open        | {n} Fragen noch offen |
| `design.questions_progress`    | {done} of {n} answered          | {done} von {n} beantwortet |
| `design.questions_all_done`    | All questions answered          | Alle Fragen beantwortet |
| `design.questions_submit_hint` | {n} questions still open —      | {n} Fragen noch offen — |
| `design.questions_jump`        | go to the first                 | zur ersten springen |
| `design.questions_open_one`    | 1 question still open           | 1 Frage noch offen |
| `design.questions_submit_hint_one` | 1 question still open —     | 1 Frage noch offen — |
| `design.pages_of`              | Pages of {label}                | Seiten von {label} |
| `design.keys_title`            | Keyboard shortcuts              | Tastenkürzel |
| `design.keys_design`           | Design 1–9                      | Design 1–9 |
| `design.keys_view`             | Question 1–9                    | Frage 1–9 |
| `design.keys_next`             | Next page of this design        | Nächste Seite dieses Designs |
| `design.keys_round` | Round tab 1–9 | Runden-Tab 1–9 |
| `design.keys_notes`            | Open or close the notes         | Notizen öffnen oder schließen |
| `design.keys_viewport` | Switch the device view | Geräteansicht wechseln |
| `design.keys_menu` | Open or close the menu | Menü öffnen oder schließen |
| `design.keys_hide` | Hide or show notes and navigation | Notizen und Navigation aus- / einblenden |
| `design.keys_theme` | Light or dark | Hell oder dunkel |
| `design.keys_pin` | Place a note on the design | Notiz auf dem Design platzieren |
| `design.keys_click`            | click                           | Klick |
| `design.keys_close`            | Close                           | Schließen |
| `design.key_ctrl`              | Ctrl                            | Strg |
| `design.upin_hint` | + click places a note on the design here | + Klick platziert hier eine Notiz auf dem Design |
| `doc.pin_hint` | + click places a note on this passage | + Klick platziert eine Notiz an dieser Stelle |
| `design.upin_arm` | Place a note on the design | Notiz auf dem Design platzieren |
| `design.upin_tap_hint` | Tap the spot for your note · Esc cancels | Tippe auf die Stelle für deine Notiz · Esc bricht ab |
| `design.upin_placeholder` | Your note on this spot… | Deine Notiz zu dieser Stelle… |
| `design.upin_keys`             | Enter saves · Esc discards      | Enter speichert · Esc verwirft |
| `design.upin_delete` | Delete note | Notiz löschen |
| `design.upin_label` | Your note {n} | Deine Notiz {n} |
| `dock.crumb_concept`           | Concept                         | Concept |
| `dock.tag_general`             | general                         | allgemein |
| `dock.tip_title`               | Did you know?                   | Wusstest du schon? |
| `anno.open_count`              | {n} open notes                  | {n} offene Notizen |
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
| `state.dock_submitted` | Sent — read-only until the next round. | Gesendet — schreibgeschützt bis zur nächsten Runde. |
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
| `map.reset_confirm` | Reset this matrix to the proposal? | Diese Matrix auf den Vorschlag zurücksetzen? |
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
| `map.frozen_missing` | Submitted state missing — showing the proposal | Übermittelter Stand fehlt — zeigt den Vorschlag |
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

