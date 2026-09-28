<!-- do-run mode `rethink` — the body of the former `tune-rethink` skill (v0.2.0), moved verbatim in PR 2 of the skill restructure (docs/superpowers/specs/2026-09-24-skill-restructure-design.md). Its triggers, allowed tools and argument hint now live in ../SKILL.md. -->

# Tune Rethink — Strategic Reset

Break out of a stuck development loop for `$ARGUMENTS`: rebuild the goal
picture, think fresh without being anchored by the current implementation,
then reconcile, decide, and implement autonomously.

**Two exits, no questions.** A rethink ends in exactly one of two ways:

1. **Autonomous** (the default) — Claude picks the approach itself and hands
   it to implementation (Step 7). The user is not asked anything.
2. **Concept page** — only when a real fork remains that the evidence cannot
   settle (Step 6 gate). The page is where the user decides.

This mode never asks the user a question: no `AskUserQuestion`, no inline
question in chat, at any step. Whatever used to be asked is derived from
the evidence and written down as an explicit assumption instead.

**Why this skill exists:** when the same area has been iterated on many times
without reaching the goal, the current implementation itself anchors every
new attempt. This skill enforces un-anchored ideation *structurally* — the
ideation agents cannot read the code — and re-introduces existing knowledge
only in a second, explicit step.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before
reading. Skip missing files silently.

1. Global: `~/.claude/skills/do-run/SKILL.md` + `reference.md` — the do-run extension (already loaded by do-run Step 0)
2. Project: `{project}/.claude/skills/do-run/SKILL.md` + `reference.md` — same
   Pre-PR-2 fallback: also read `~/.claude/skills/tune-rethink/` and `{project}/.claude/skills/tune-rethink/` (`SKILL.md` + `reference.md`) when present — an extension written for the old `tune-rethink` skill applies to this mode unchanged.
3. Merge order: project > global > plugin defaults

## Step 1 — Intake & Scope

`$ARGUMENTS` names the target — the whole app or a section of it. The rethink
is holistic for the named target (not a micro-polish of one control).

- If `$ARGUMENTS` is empty, derive the target — never ask for it. First
  that yields one: the task the do-run prompt names ("Rethink vorher") →
  the area this conversation iterated on most → the area with the densest
  recent `git log` churn → the whole app. Name the derived target in the
  brief as an assumption.
- State the scope boundary explicitly: "In scope: X including Y. Out of
  scope: Z." This boundary travels with the brief through every later step.

## Step 2 — Evidence Mining (self-served)

Build the whole picture yourself — the user is not asked. Two source classes:

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

Fallbacks: no repo evidence → the conversation and the prompt carry more
weight, and more brief items end up as assumptions. App not startable →
static evidence only; note "no live look possible" in the dossier. A live
look that would hit a must-ask trigger (desktop takeover, real credentials)
is skipped the same way — the rethink does not ask for it.

## Step 3 — Self-Calibration (no question round)

Turn the dossier into the brief yourself. Every item the user used to be
asked is derived from the evidence and marked **assumed** where the
evidence is thin:

1. Goal, gap, tried-before — the dossier's strongest reading; conflicting
   readings stay listed side by side (they may open the Step 6 gate).
2. Success criteria — from issues, concept pages, the prompt and this
   conversation's complaints; phrased observable ("the flow takes ≤ 3
   steps"), not as taste.
3. Biggest frustration — what the conversation circled on most.
4. Hard no-gos — stack, data model, public contracts, deadlines found in
   CLAUDE.md, docs and config. Unknown → keep today's stack and data model.
5. **Demolition corridor — derived, conservative:** the named target may be
   torn down; everything outside it stays. Widen it only when the evidence
   itself demands it (the prompt says "komplett neu", the target cannot be
   fixed without its neighbour). Never assume "everything".

Output: the **Rethink Brief** — ONE completely code-free document containing
scope, goal, gap, success criteria, no-gos, corridor, plus an
**Assumptions** list (every derived item that neither the user nor an
artifact stated). Persist it to `.claude/rethink/<YYYY-MM-DD>-<slug>/brief.md`.
The brief is the ONLY project context the fresh-phase agents receive, so it
must stand alone.

## Step 4 — Fresh Phase (code-blind fan-out)

Spawn **three `devops:rethinker` agents in parallel** (one message, three
Agent calls). Each prompt = the full Rethink Brief + ONE lens block from
`{PLUGIN_ROOT}/skills/do-run/modes/rethink/deep-knowledge/lenses.md`:

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

Naming per `{PLUGIN_ROOT}/deep-knowledge/agent-conventions.md`:
`[role:rethinker · Ideation] <lens> approach for <target>`.

Each agent returns one `RETHINK_APPROACH` block (format in `lenses.md`).
If an agent dies, continue with the survivors (minimum 1) and note the gap
in `decision.md` (and on the concept page, if one opens).

## Step 5 — Reconciliation (the second step)

Back in the main context, now WITH codebase access, integrate what is
already known:

- Evaluate each approach against reality: migration path, what survives,
  effort, risks, which success criteria it serves.
- Merge near-duplicate approaches.
- Label every approach with its blast radius **relative to the corridor**:
  - `in-corridor` — eligible for implementation.
  - `over-corridor` — NEVER implemented from the autonomous path; only the
    user can widen the corridor, and only on the concept page (Step 6).

Persist the reconciled set to `.claude/rethink/<date>-<slug>/approaches.md`.

## Step 6 — Decision Gate: decide yourself, or a concept page

Score the reconciled approaches against the brief's success criteria,
no-gos and corridor. Then take exactly one exit — never a question:

**Decide autonomously (default)** when one `in-corridor` approach clearly
leads: it serves the most success criteria at acceptable risk, or the
approaches converged on one direction in reconciliation. Record the pick,
the runner-up and the reason in `.claude/rethink/<date>-<slug>/decision.md`
and go to Step 7. On a criteria tie the lower risk wins, then the lower
effort.

**Precedence:** the page conditions below outrank this default. When the
strongest approach overall is `over-corridor`, the best `in-corridor` one
does not "clearly lead" — the page opens, even if it is the only
in-corridor option left.

**Concept page** only when at least one of these holds — name which in
`decision.md`:

- **Real fork** — two or more `in-corridor` approaches stay close and the
  choice between them turns on a preference the brief cannot rank (which
  success criterion matters more, competing visual directions with no
  evidence-backed winner).
- **Over-corridor winner** — the strongest approach needs a wider corridor
  than the derived one. Widening is the user's call; the page is where it
  is made, not a question.
- **Goal unclear** — the dossier's conflicting goal readings could not be
  resolved from the evidence, and the approaches differ by which reading
  they serve.

A close call on effort alone, or a doubt Claude could settle by looking
further, is not a fork — look further and decide.

When the gate opens the page, invoke `Skill("devops:auto-concept")`. Do not
hard-wire the template: apply its own per-iteration template rule
(`skills/auto-concept/SKILL.md` § Step 1a) to the reconciled set of
approaches.

- If the approaches are substantive non-visual alternatives (architecture,
  strategy, library, migration path) → a `decision` iteration. Each
  approach is a variant with: pros/cons, blast-radius label, effort
  estimate, migration sketch, and which success criteria it serves. The
  brief's Assumptions list is shown too, so a wrong one can be corrected.
- If one or more approaches are primarily visual — competing UX/layout/
  visual directions surfaced by the `ux-design` lens — those land in a
  separate `design` iteration with real mockups per approach, not flattened
  into variant cards. `enduser-feel`/`architecture` alternatives that are
  entangled with the visual ones still get their own `decision` iteration;
  split them rather than mixing layout and non-visual tradeoffs on one page.
- A run that surfaces both kinds of approaches renders **both iterations on
  the same concept page** — a `decision` iteration for the non-visual call
  and a `design` iteration for the visual one — not two separate pages.

Whichever iteration(s) result, the page offers two decision actions per
iteration:

- **Iterate** — feedback flows back: revise via Step 5, or run a new fresh
  round (Step 4) when the feedback changes direction fundamentally. Then
  re-render (append a new iteration; the existing ones stay as frozen
  history). Nothing is implemented.
- **Implement** — locks the chosen approach and proceeds to Step 7. Picking
  an `over-corridor` approach here IS the corridor widening — the label is
  on the variant, no extra question follows.

Persist the page decision to `.claude/rethink/<date>-<slug>/decision.md`.

## Step 7 — Autonomous Handoff

After the Step 6 autonomous pick, or an **Implement** on the concept page.
Assemble the task briefing:

- the chosen approach (full concept content),
- scope boundary, success criteria, no-gos, corridor, assumptions,
- test mandate: pin the profile per `{PLUGIN_ROOT}/deep-knowledge/test-plan.md` and verify per its
  recommendation,
- pointer to the `.claude/rethink/<date>-<slug>/` artifacts.

Then hand this briefing back to the do-run router (`../SKILL.md` Step 6) as
the task: Ablauf "Interaktiv" → `auto-agents` with `--rethink` added to its
args (the pick was the go — `auto-agents` asks no plan confirmation); "Autonom" → autonomous mode
(`modes/autonomous.md`, same skill), which owns permission priming,
confirmation, worktree, implementation, testing and the report — do not
re-implement any of that here.

## Completion

- Handoff happened (Step 7) → the router's execution path owns the
  completion card; it names the rethink pick and the assumptions it rests on.
- Concept page opened and waiting → render a completion card yourself with
  the `concept` field (the page is the open decision). With Ablauf
  "Autonom" the page waits for the user's return; nothing is implemented
  until **Implement**.
- Run ends earlier (nothing to reconcile) → `analysis` if nothing was
  written, `ready` if brief/approaches were persisted. Artifacts remain on
  disk for a later resume.

## Error Handling

| Situation | Behavior |
|---|---|
| Empty `$ARGUMENTS` | Target derived (Step 1), noted as an assumption — no question |
| No repo evidence | More assumptions in the brief; a goal left open opens the concept gate |
| App not startable | Static evidence; dossier notes it |
| Lens agent failure | Continue with ≥1 approach; gap noted in `decision.md` (and on the page, if one opens) |
| Strongest approach is over-corridor | Concept page (Step 6 gate), never a question |
| No decision on concept page | Nothing implemented; artifacts kept for resume |

## Rules

- Never ask the user — no `AskUserQuestion`, no question in chat. The only
  place the user decides is the concept page, and only when the Step 6 gate
  opens it.
- Exactly two exits: autonomous pick → Step 7, or concept page. Nothing in
  between.
- Never feed code, file paths, or current-implementation details to the
  fresh-phase agents.
- Never implement an `over-corridor` approach from the autonomous path.
- Every derived brief item that nobody stated is listed as an assumption.
