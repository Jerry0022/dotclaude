# Implement brief — Frustrated Mode for alpha (concept round 2, action implement)

Repo: plugin SOURCE repo, worktree `C:\Users\Jerem\IdeaProjects\dotclaude\.claude\worktrees\backlog-frustrated-k7q2`
(branch `worktree-backlog-frustrated-k7q2`, origin/main merged in at 21eea878). Never commit to main, never push.
Concept: `docs/concepts/20261025-1124-backlog-frustrated-mode/rounds/02.html` (the submitted round).
Specs (the design): `docs/superpowers/specs/2026-10-25-frustrated-mode-*.md` (umbrella, trigger-detection,
analysis-skill, plan-approval-handoff, integration). The decisions below OVERRIDE the specs where they differ.

## User's overrides (verbatim notes in quotes)

General: "mach bitte stufe 1 und 2 für alpha nutzer direkt … da du das feature voll flaggst, dass nur alpha
nutzer claude es automatisch detektiert reicht das. Wir brauchen btw. keinen weiteren skill automatisch claude
reicht mir, wenn dieser das vorschlägt."

→ No shadow-only stage. On the alpha channel the detector is LIVE from day one: Claude detects the
frustration signal and *proposes* the analysis. Stable/beta: completely invisible (feature flag).
F9 "shadow mode + offline replay" shrinks to: the marker log (D2) + a replay script for tuning, not a gate.
F10 "Stufe-1-Review / Stufe-2-Go/No-go" is dropped — stage 2 ships directly (note on F10: "Stufe 2 direkt").
D4 timebox becomes moot (keep nothing for it).

| Id | Decision as approved |
|---|---|
| item-859 | "aber ein auto skill! und vernetzt mit allen anderen" → skill `auto-frustrated` (plugins/devops/skills/auto-frustrated/), wired to do-run, auto-concept, auto-agents, auto-fix, the run contract, as the specs describe |
| d1 | Name is `auto-frustrated`, stays `auto-` (no later rename to do-) |
| item-861 | "das haben wir schon parallel umgesetzt, bring main hierein und check ob das ausreichend funktioniert … du musst natürlich noch flaggen" → main has `plugins/devops/features.json` + `hooks/lib/features.js` + `scripts/feature-flag.js` + `docs/dev/feature-flags.md`. It is the ONE mechanism. Consolidate: `skill-trigger-router.js` uses `features.gatedSkills()` instead of `channel-gate.js filterSkills`; remove `hooks/lib/channel-gate.js`, its test and `deep-knowledge/channel-gating.md` (move anything still useful — the find-point inventory — into `docs/dev/feature-flags.md`; drop the INDEX.md line and README/architecture mentions; regenerate counters with `node plugins/devops/scripts/gen-readme-sections.mjs`). Register feature `frustrated-mode` (minChannel `alpha`) with all its docs/scripts/skill, and gate all four find-points per `docs/dev/feature-flags.md` § Rules |
| skill gating vs auto | `docs/dev/feature-flags.md` wants gated skills to set `disable-model-invocation: true`. Keep that (stable never sees/picks it). The automatic path goes through the alpha-only detector hook: when it fires it injects context telling Claude to offer the analysis, and on the user's yes to `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md` and follow it (the hook path only exists where `featureAllowed('frustrated-mode')`). The slash command stays the explicit entry. The skill's first step runs `feature-flag.js check frustrated-mode` and stops on rc 126 |
| d2 | Marker-only log in `~/.claude/` with rotation (~300 lines). "aufräumen irgendwann aber nicht vergessen" → add a cleanup/rotation that really runs, and say in the doc when it is removed |
| d3 | No offline maintainer labelling. "du als claude bewertest ob da hänger waren und dann schlägst du vor damit umzugehen" → Claude itself judges (from the transcript/context) whether the session is stuck, then proposes |
| d15 | Opt-out key `frustratedMode.suggest` (devops-config), default true — active now (stage 2 direct) |
| d5 | Earlier sessions only on request — "dann aber den nutzer explizit fragen!" → ask explicitly before reading another session |
| d6 | "tests sind ok, es geht um veränderndes … write ist ok, wenn es nicht die app selber betrifft, also snapshots, caches" → analysis phase may RUN tests and write test artifacts/snapshots/caches; it must not change the app's source/config. The read-only guard (F3 `pre.frustrated.readonly`) encodes exactly that |
| d14 | No Ultracode field in the report |
| d7 | "immer eine completion card bei inline analyse und dann abfrage oder die ausführung von devops concept … nach der completion card reicht etwas interpretierbares, nicht strikt" → after the analysis: a completion card (or the concept page); the user's approval is any interpretable yes in the next prompt, no fixed phrase |
| item-860 | "Lass uns den plan als devops concept machen … wenn trivial genug, dann inline freigeben lassen mit pre text oberhalb der completion card. Siehe bisherige Regeln wann automatisch ein concept erstellt wird (z. B. bei visuellen ein muss)" → plan presentation follows the existing concept-vs-card rules (Quiet style rule 3, visual ⇒ concept, auto-concept triggers): non-trivial plan → `/auto-concept` page; trivial → inline plan text above the card + interpretable approval |
| d8 | Approval replaces a running other run contract, announced in the question |
| d9 | "nie ship autonom oder nachfragend, außer wenn z. B. im rahmen von devops concept dann freigegeben (da kann man es im abschluss auswählen)" → frustrated hand-off never ships and never asks to ship; only a concept close-out sheet may include ship |
| d10 | DISCARDED: no path-level gate — keep as it is today |
| d16 | Guard and plan record each with their own 2-h expiry |
| d11 | do-run Q4: Frustrated Mode wins over other passes — "und nur wenn erkannt wurde, dass das ein thema hier gerade ist, dann die option nur darein" → the "Erst analysieren" option appears in do-run's question ONLY when the detector currently flags the session |
| d12 | auto-fix hint: logged only — ok |
| d13 | DISCARDED: a negative workflow-hook test does NOT mean "never Workflow"; re-test on later Claude Code builds (document it) |
| #863 | Not built (item-863 discarded, w-* discarded: "wir verwerfen die idee"; w-b1 "B1 nicht bauen" kept). Nothing to implement |
| #864 | Hook agents: confirmed "nicht einsetzen". Nothing to implement |
| F1–F8 | Build them (F1 spike first — its result decides the subagent-hook boundary F3 relies on). F9 reduced as above, F10 dropped |

## Done means

- `features.json` has `frustrated-mode` (alpha); every doc/script/skill of it registered; `features.test.js` green; the stable context-budget check from `docs/dev/feature-flags.md` § Rules 4 shows 0 mentions.
- Detector hook (UserPromptSubmit) live on alpha, silent elsewhere, honours `frustratedMode.suggest`.
- `auto-frustrated` skill + analyst agents + read-only guard + plan record/approval + hand-off presets + do-run Q4 option, each with tests.
- channel-gate.js consolidated away; router uses features.js; tests green.
- Full `npm test` and `npm run lint` green (one pre-existing red `hidden-skill-mentions.test.js` on main is known — report if still red, do not "fix" by weakening).
- Commits on this branch (conventional commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), no push, no ship.
- Report: per F-item what was built (files), what was cut and why, test counts.
