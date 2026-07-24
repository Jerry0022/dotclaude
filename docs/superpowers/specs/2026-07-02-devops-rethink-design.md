# Design Spec — `/devops-rethink`

**Date:** 2026-07-02
**Status:** Draft (awaiting user review)
**Plugin:** devops (MINOR bump on release)

## Problem

Development gets stuck: Claude iterates in circles, progress needs many
prompts, and the named part of the app (or the whole app) is neither
functionally nor visually where it should be. Existing skills don't cover
this: `devops-flow` is tactical debugging ("something is broken"),
`devops-harden`/`devops-polish` are incremental improvement passes on the
existing approach. What's missing is a strategic reset: fresh, un-anchored
approaches that still respect the original goals and hard constraints.

## Goals

- Re-derive the original goals and the stuck state — largely self-served by
  Claude (repo evidence + live look at the running app), validated by a short
  question round with the user.
- Generate genuinely fresh approaches: ideation that is technically isolated
  from the current implementation, not merely asked to "think fresh".
- Integrate existing knowledge in a second, separate step (reconciliation).
- Let the user pick/steer on an interactive concept page, then implement the
  chosen approach fully autonomously, including test verification.

## Non-Goals

- Not a debugging tool (that is `devops-flow`).
- Not a micro-polish pass (button radius etc. → `devops-polish`).
- No implementation without an explicit "Implement" decision on the concept
  page.

## Skill Definition

- **Name:** `devops-rethink` — directory `plugins/devops/skills/devops-rethink/`
- **Version:** 0.1.0
- **Triggers:** "festgefahren", "stuck", "unstuck", "wir drehen uns im Kreis",
  "neu denken", "rethink", "frischer Ansatz", "fresh approach"
- **Do NOT trigger:** debugging/errors (→ `devops-flow`), incremental
  consistency or UI passes (→ `devops-harden`/`devops-polish`), normal feature
  work, README/doc tasks.
- **Frontmatter:** `description: >-` folded scalar (YAML-safety convention),
  `argument-hint: "[app or section that is stuck, e.g. 'the onboarding flow']"`.
- **Extension paths (Step 0):** `~/.claude/skills/rethink/` and
  `{project}/.claude/skills/rethink/` (SKILL.md + reference.md,
  project > global > plugin).

## Pipeline

### Step 0 — Load Extensions

Standard three-layer load per CONVENTIONS.md. Silent on missing files.

### Step 1 — Intake & Scope

`$ARGUMENTS` names the target (whole app or a section). The skill states the
scope boundary explicitly ("in scope: X incl. Y; out of scope: Z") and keeps
it in the brief. If `$ARGUMENTS` is empty, ask one question to name the
target before anything else.

### Step 2 — Evidence Mining (self-served)

Two source classes, gathered before any question is asked:

1. **Repo evidence:** git log for the target area, issues (open/closed),
   existing concept pages, docs, CHANGELOG, CLAUDE.md — reconstruct: intended
   goal, what was already tried, where iterations circled.
2. **Live evidence:** per deep-knowledge `test-autonomy.md` /
   `preview-testing.md` / `responsive-testing.md`: start the app (Claude
   Preview preferred), view the named area at multiple viewports, click
   through its core flows, capture screenshots/snapshots.

Output: a **hypothesis dossier** — "this was the goal, this is today's state,
here is the gap, this was tried". Explicitly marked as hypotheses.

Fallbacks: no repo evidence → question round carries more weight (more
questions allowed). App not startable → static evidence only; the dossier
notes "no live look possible".

### Step 3 — Question Round (validate + calibrate)

`AskUserQuestion`, one question per round, ~3–5 rounds, multiple-choice
preferred. Mandatory contents:

1. Confirm/correct the hypothesis dossier (goal, gap, tried-before).
2. Success criteria: "what does *good* look like?" for this target.
3. Biggest frustration / most-missed outcome.
4. Hard no-gos: stack, data model, deadlines, budget — non-negotiables.
5. **Demolition corridor (joint calibration):** how much may be torn down at
   the large scale — nothing / the named section / everything. This is agreed
   together, not assumed.

Output: the **Rethink Brief** — one completely code-free document containing
scope, goal, gap, success criteria, no-gos, corridor. Persisted to
`.claude/rethink/<date>-<slug>/brief.md` in the consumer project.

### Step 4 — Fresh Phase (code-blind fan-out)

**New agent:** `plugins/devops/agents/rethinker.md` (`devops:rethinker`).
Tools: **WebSearch, WebFetch only** — no Read/Grep/Glob/Bash. Code-blindness
is enforced by the tool set, not by a prompt request.

Three instances run in parallel; each receives ONLY the Rethink Brief plus
one lens (lens prompts live in `skills/devops-rethink/deep-knowledge/lenses.md`):

| Lens | Question it owns |
|------|------------------|
| Product/Value (PO view) | Does the approach achieve the purpose? What is the simplest thing that reaches the goal? |
| UX/Design | Structure, flow, layout idea, visual direction. |
| End-user feel | Journey, friction, "does it feel good?" |

For backend-only targets the End-user lens is swapped for an
**Architecture lens** (boundaries, data flow, simplification).

Each agent returns one approach: core idea, structure sketch, why it reaches
the success criteria, rough blast-radius estimate. Web research for
inspiration/best practices is allowed (per `fact-verification.md`).

Failure handling: if a lens agent dies, continue with the surviving
approaches (min. 1) and note the gap on the concept page.

### Step 5 — Reconciliation (the "second step")

Back in the main context, now WITH codebase access: evaluate each fresh
approach against reality — migration path, what survives, effort, risks.
Merge near-duplicates. Label every approach with its blast radius relative
to the corridor:

- **in-corridor** — eligible for implementation.
- **over-corridor** — shown as a flagged outlier for information; NEVER
  implemented without an explicit user decision that widens the corridor.

### Step 6 — Concept Page

Invoke `concept` (decision template). Each approach is a variant with:
pros/cons, blast-radius label, effort estimate, migration sketch, and which
success criteria it serves. Two decision actions:

- **Iterate:** feedback flows back → revise approaches (Step 5, or a new
  fresh round if the user's feedback changes direction fundamentally) →
  re-render. No implementation starts.
- **Implement:** locks the chosen approach and proceeds to Step 7.

Decision snapshot persisted to `.claude/rethink/<date>-<slug>/decision.md`.

### Step 7 — Autonomous Handoff

Only after an explicit **Implement** click. The skill assembles a task
briefing:

- chosen approach (full concept content),
- scope boundary, success criteria, no-gos, corridor,
- test mandate: pin the profile via `devops-test-plan`, verify per its
  recommendation,
- pointer to `.claude/rethink/<date>-<slug>/` artifacts.

Then invoke `devops-autonomous` with this briefing as the task. Autonomous
owns permission priming, confirmation, worktree, implementation, testing,
report — unchanged. `devops-rethink` does not re-implement any of that.

## Deliverables (implementation checklist)

1. `plugins/devops/skills/devops-rethink/SKILL.md` (lean; Step 0 extensions;
   steps as above)
2. `plugins/devops/skills/devops-rethink/deep-knowledge/lenses.md`
3. `plugins/devops/agents/rethinker.md` (WebSearch/WebFetch only; YAML-safe
   frontmatter; `<example>` tags per agent conventions)
4. README curated table row + generator run (`gen-readme-sections.js`)
5. Plugin MINOR version bump at ship time

## Error Handling Summary

| Situation | Behavior |
|-----------|----------|
| Empty `$ARGUMENTS` | One intake question first |
| No repo evidence | Heavier question round |
| App not startable | Static evidence; dossier notes it |
| Lens agent failure | Continue with ≥1 approach, gap noted |
| User picks over-corridor approach | Explicit corridor-widening question before handoff |
| No decision on concept page | Nothing is implemented; artifacts remain for a later resume |

## Testing

- `scripts/frontmatter-yaml.test.js` guards SKILL.md + agent frontmatter
  automatically.
- Roster/README markers verified by `gen-readme-sections.js --check`
  (existing ship gate).
- Behavioral dry-run: invoke `/devops-rethink` on a consumer project section
  and walk the pipeline to the concept page (handoff smoke-tested with a
  trivial target).
