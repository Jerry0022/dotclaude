# Autonomous Abschluss page — report-only authoring

The static `AUTONOMOUS-REPORT.html` is gone. Step 7b builds the **report-only
Abschluss page** through `auto-concept --report` (`skills/auto-concept/SKILL.md`
§ Report-only entry): a concept page whose only round is the final report, with
the same bridge, FAB and close-out as after a concept. Structure, visual rules
and gate are the engine's, not this file's — see
`skills/auto-concept/deep-knowledge/templates-final-report.md` and
`step5-update-page.md` § Final-report append. This file only says what an
autonomous run puts in it.

## When

Only when there is something for the user to do: a Fund out of scope, a 🧪 test
(`userFinalTest`), a 👉 hand-off, or an open ship decision. Nothing → no page,
the completion card alone. Under "Autonom" the page waits for the user's return.

## Content mapping (run context → report)

| Report part | From the run |
|---|---|
| Heading + banner | Status: COMPLETED (🏁 Abgeschlossen), INTERRUPTED / BLOCKED (amber / red banner, what is missing) |
| Vorher/Nachher + "Selbst ausprobieren" | Live-test screenshots and the preview/live URL from Step 5; a short flow when nothing visual changed |
| One sentence "Was getan wurde" | The task goal (`implement`); for `analyze`, the one-line finding |
| Was kam raus / Was es aushält | Verification results from Step 5 (build, tests, live test) |
| Prüftiefe-Leiter | Levels actually reached; gaps stay hollow |
| Funde | Related fixes, blocked actions, warnings and open questions outside the task — each with its pre-selected route (`step5-finalize.md` § E) |
| 🧪 / 👉 | `userFinalTest` items and manual hand-offs, each with its pre-selected mode |
| 🛠 Für Entwickler (≤ 5 lines) | Branch/commit, areas + key files, tests in one line, **decision journal in short** (the calls from `AUTONOMOUS-LOG.md` that mattered), INTERRUPTED resume instruction |

Analyze mode: findings and recommendations that need routing become Funde;
screenshots go into the Vorher/Nachher slot or the dev fold. A run that only
analysed and found nothing to route has no page.

Backlog issue decisions and audit proposals are NOT this page — they stay
concept pages with decision rounds (`modes/backlog.md` Step 5 · 1b,
`modes/audit.md` Step 7b). This page is the step after an implementation.
