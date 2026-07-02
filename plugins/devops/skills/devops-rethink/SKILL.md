---
name: devops-rethink
version: 0.1.0
description: >-
  Strategic reset for stuck development: iterations circle without reaching
  the goal, or a named part of the app (or the whole app) is functionally and
  visually not where it should be and incremental fixes stopped helping.
  Re-derives the original goals from repo + live-app evidence, validates them
  in a short question round (incl. jointly calibrating how much may be torn
  down), generates genuinely fresh approaches via code-blind lens agents,
  reconciles them against the codebase, lets the user decide on a
  devops-concept page, then hands the chosen approach to devops-autonomous
  for implementation with devops-test-plan verification.
  Triggers on: "festgefahren", "stuck", "unstuck", "wir drehen uns im Kreis",
  "neu denken", "rethink", "frischer Ansatz", "fresh approach",
  "komplett neu denken", "das führt zu nichts".
  Do NOT trigger for: debugging/errors (use /devops-flow), incremental
  consistency or UI passes (/devops-harden, /devops-polish), or normal
  feature work.
argument-hint: "[app or section that is stuck, e.g. 'the onboarding flow']"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent, AskUserQuestion, CronCreate, CronDelete, mcp__Claude_Preview__*, mcp__plugin_playwright_playwright__*, mcp__plugin_devops_dotclaude-completion__*
---

# Rethink — Strategic Reset

Break out of a stuck development loop for `$ARGUMENTS`: rebuild the goal
picture, think fresh without being anchored by the current implementation,
then reconcile, decide, and implement autonomously.

**Why this skill exists:** when the same area has been iterated on many times
without reaching the goal, the current implementation itself anchors every
new attempt. This skill enforces un-anchored ideation *structurally* — the
ideation agents cannot read the code — and re-introduces existing knowledge
only in a second, explicit step.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before
reading. Skip missing files silently.

1. Global: `~/.claude/skills/rethink/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/rethink/SKILL.md` + `reference.md`
3. Merge order: project > global > plugin defaults

## Step 1 — Intake & Scope

`$ARGUMENTS` names the target — the whole app or a section of it. The rethink
is holistic for the named target (not a micro-polish of one control).

- If `$ARGUMENTS` is empty: ask ONE question (AskUserQuestion) to name the
  target before anything else.
- State the scope boundary explicitly: "In scope: X including Y. Out of
  scope: Z." This boundary travels with the brief through every later step.

## Step 2 — Evidence Mining (self-served)

Build your own picture BEFORE asking the user anything. Two source classes:

1. **Repo evidence:** git log for the target area, open/closed issues,
   existing concept pages, docs, CHANGELOG, CLAUDE.md. Reconstruct: what was
   the intended goal, what was already tried, where did iterations circle.
2. **Live evidence:** look at the running app — this is the only honest
   source for "it doesn't look/feel right". Follow
   `{PLUGIN_ROOT}/deep-knowledge/test-autonomy.md` and
   `preview-testing.md`: start the app (Claude Preview preferred), view the
   target at the profile viewports (`responsive-testing.md`), click through
   its core flows, capture snapshots.

Output: a **hypothesis dossier**, explicitly marked as hypotheses —
"this was the goal, this is today's state, here is the gap, this was tried".

Fallbacks: no repo evidence → the question round carries more weight (more
questions allowed). App not startable → static evidence only; note
"no live look possible" in the dossier.

## Step 3 — Question Round (validate + calibrate)

AskUserQuestion, ONE question per round, ~3–5 rounds, multiple-choice
preferred. Mandatory contents, in this order:

1. Confirm/correct the hypothesis dossier (goal, gap, tried-before).
2. Success criteria: what does *good* look like for this target?
3. Biggest frustration / most-missed outcome.
4. Hard no-gos: stack, data model, deadlines — non-negotiables.
5. **Demolition corridor — calibrated together, never assumed:** how much
   may be torn down at the large scale (nothing / the named section /
   everything). The corridor bounds what gets seriously developed; it is
   agreed jointly so radical options don't surprise the user later.

Output: the **Rethink Brief** — ONE completely code-free document containing
scope, goal, gap, success criteria, no-gos, corridor. Persist it to
`.claude/rethink/<YYYY-MM-DD>-<slug>/brief.md`. The brief is the ONLY project
context the fresh-phase agents receive, so it must stand alone.

## Step 4 — Fresh Phase (code-blind fan-out)

Spawn **three `devops:rethinker` agents in parallel** (one message, three
Agent calls). Each prompt = the full Rethink Brief + ONE lens block from
`deep-knowledge/lenses.md`:

| Lens | Owns the question |
|---|---|
| `product-value` | Does the approach achieve the purpose — simplest thing that reaches the goal? |
| `ux-design` | Structure, flow, layout idea, visual direction |
| `enduser-feel` | Journey, friction, "does it feel good?" |

For backend-only targets (no UI surface in scope), replace `enduser-feel`
with the `architecture` lens.

The rethinker agent has **no file tools** — code-blindness is enforced by
its tool set, not by a polite request. Do NOT paste code, file paths, or
implementation details into its prompt; that would defeat the isolation.

Naming per `deep-knowledge/agent-conventions.md`:
`[role:rethinker · Ideation] <lens> approach for <target>`.

Each agent returns one `RETHINK_APPROACH` block (format in `lenses.md`).
If an agent dies, continue with the survivors (minimum 1) and note the gap
on the concept page.

## Step 5 — Reconciliation (the second step)

Back in the main context, now WITH codebase access, integrate what is
already known:

- Evaluate each approach against reality: migration path, what survives,
  effort, risks, which success criteria it serves.
- Merge near-duplicate approaches.
- Label every approach with its blast radius **relative to the corridor**:
  - `in-corridor` — eligible for implementation.
  - `over-corridor` — shown as a flagged outlier for information; NEVER
    implemented without the user explicitly widening the corridor first.

Persist the reconciled set to `.claude/rethink/<date>-<slug>/approaches.md`.

## Step 6 — Concept Page

Invoke `devops-concept` (decision template). Each approach is a variant
with: pros/cons, blast-radius label, effort estimate, migration sketch, and
which success criteria it serves. The page offers two decision actions:

- **Iterate** — feedback flows back: revise via Step 5, or run a new fresh
  round (Step 4) when the feedback changes direction fundamentally. Then
  re-render. Nothing is implemented.
- **Implement** — locks the chosen approach and proceeds to Step 7. Only
  this explicit action starts implementation.

Persist the decision to `.claude/rethink/<date>-<slug>/decision.md`.

## Step 7 — Autonomous Handoff

Only after an explicit **Implement** decision. Assemble the task briefing:

- the chosen approach (full concept content),
- scope boundary, success criteria, no-gos, corridor,
- test mandate: pin the profile via `devops-test-plan` and verify per its
  recommendation,
- pointer to the `.claude/rethink/<date>-<slug>/` artifacts.

Then invoke `devops-autonomous` with this briefing as the task. Autonomous
owns permission priming, confirmation, worktree, implementation, testing,
and the report — do not re-implement any of that here.

If the user chose an `over-corridor` approach: ask ONE explicit
corridor-widening question before the handoff.

## Completion

- Handoff happened (Step 7) → `devops-autonomous` owns the completion card.
- Run ends earlier (no decision yet, or user stops at the concept page) →
  render a completion card yourself (`analysis` if nothing was written,
  `ready` if brief/approaches were persisted). Artifacts remain on disk for
  a later resume.

## Error Handling

| Situation | Behavior |
|---|---|
| Empty `$ARGUMENTS` | One intake question first |
| No repo evidence | Heavier question round |
| App not startable | Static evidence; dossier notes it |
| Lens agent failure | Continue with ≥1 approach, gap noted on page |
| User picks over-corridor approach | Explicit corridor-widening question before handoff |
| No decision on concept page | Nothing implemented; artifacts kept for resume |

## Rules

- Never skip the question round — evidence hypotheses are validated, not
  assumed correct.
- Never feed code, file paths, or current-implementation details to the
  fresh-phase agents.
- Never start implementation without the explicit Implement decision.
- The corridor is agreed with the user, never assumed.
