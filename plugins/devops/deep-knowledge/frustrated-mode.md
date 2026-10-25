# Frustrated Mode (alpha)

Gated feature `frustrated-mode` (`features.json`, minChannel `alpha`). On beta and stable nothing of it is visible: no hook, no skill alias, no doc.

## What it is

When a session looks stuck (repeated failed attempts, the user's growing frustration), Claude notices it, offers a way out, and only acts after the user agrees.

## Flow

detect -> offer -> read-only analysis -> plan -> approval -> hand-off

1. **Detect** - an alpha-only UserPromptSubmit hook flags the signal and injects context telling Claude to offer the analysis. Claude itself judges from the transcript whether the session is really stuck.
2. **Offer** - one question, never an automatic start. Earlier sessions are read only after an explicit yes.
3. **Read-only analysis** - the `auto-frustrated` skill (entry on yes: `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md`; also the explicit slash command). Tests may run and test artifacts, snapshots and caches may be written; the app's source and config must not change.
4. **Plan** - presented by the existing concept-vs-card rules: non-trivial -> `/auto-concept` page, trivial -> inline text above the completion card.
5. **Approval** - any interpretable yes in the next prompt, no fixed phrase.
6. **Hand-off** - preset run or fix; it never ships and never asks to ship.

## Opt-out

`frustratedMode.suggest` in the devops config (default `true`); `false` silences the detector.

## Never ships

The hand-off stops before ship. Only a concept close-out sheet may include a ship choice.

Developer notes: `docs/dev/feature-flags.md`.
