---
name: auto-frustrated
version: 0.1.0
description: >-
  Read-only analysis of a session that keeps missing its goal: independent
  analysts reconstruct intent, history and causes, a synthesis keeps consensus
  and dissent apart, and the result is a recorded plan that runs only after the
  user approves it. Never implements, never ships.
layer: 0
invokes: [auto-concept, do-run, auto-fix, do-learn, auto-guide]
disable-model-invocation: true
triggers:
  en: []
  de: []
argument-hint: "[target or complaint] [--lite]"
allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion, Skill, mcp__plugin_devops_dotclaude-completion__*
---

# Frustrated analysis

Find out why repeated attempts at `$ARGUMENTS` (or the target the session kept
iterating on) miss the goal, and propose a plan with reasons. **This skill
changes nothing in the app.** Specs: `docs/superpowers/specs/2026-10-25-frustrated-mode-*.md`;
user-facing summary: `{PLUGIN_ROOT}/deep-knowledge/frustrated-mode.md`.

Entry points: the slash command, or the alpha detector hook
(`prompt.frustrated.detect`) after the user said yes to its offer
(`Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md`), or the do-run Q4
option "Erst analysieren". All three are the same explicit start.

## Step 0 — Gate

```bash
node "{PLUGIN_ROOT}/scripts/feature-flag.js" check frustrated-mode
```

Exit 126 → say in one line that this analysis is not available on this
channel, and stop. Nothing else of this skill runs.

## Step 1 — Intake and arm (no questions)

1. Target: the args, else the area the conversation iterated on most, else
   the densest recent `git log` churn. Name the derived target as an
   **assumption** in the report.
2. Write the **loop hypothesis** (one paragraph, sealed): "what I believed the
   problem was during the failed attempts". Only the synthesizer sees it.
3. Arm the read-only guard and build the brief:

   ```bash
   node "{PLUGIN_ROOT}/scripts/frustrated-guard.js" arm --target "<target>"
   node "{PLUGIN_ROOT}/scripts/frustrated-brief.js" --out "<scratchpad or temp>/frustrated-brief.json"
   ```

   From now on the guard `pre.frustrated.readonly` denies every change to the
   app's source and config, for the main thread and every analyst. Allowed:
   reading, git read commands, **running tests / lint / typecheck** (never
   `--fix`), writing into the temp dir / scratchpad, `.claude/` state,
   snapshots, coverage and caches, concept pages, and the plugin scripts named
   here. A deny is information, not an obstacle: record the change as a plan
   step instead. Under ultracode, too: this analysis runs its fixed roles as
   Agent spawns, never a Workflow.

**Earlier sessions (d5):** only this session by default. If an earlier session
looks relevant (the user referred to one, or the brief starts mid-story), ask
**explicitly** with `AskUserQuestion` before reading it — name the session and
why. Only on a yes: `frustrated-brief.js --session <id> --out …`. No answer or
no → continue without it and list it as an unexamined slice.

## Step 2 — Analysts in parallel

Spawn the five roles in **one message**, each with its role block from
`deep-knowledge/roles.md` (next to this file) and only its slice of the brief.
Naming: `[role:<agent> · Analysis] <role> for <target>`.

| # | Role | Agent | Slice |
|---|------|-------|-------|
| R1 | Intent | `devops:po` | the user's prompts `P1..Pn`, inline only |
| R2 | History | `devops:redteam` | transcript path + session window, git read-only |
| R3 | Technical cause | `devops:research` | target, edited files, error signatures, repo, web; not the transcript |
| R4 | Workflow & product | `devops:po` | transcript metadata (skills, agents, tools), CLAUDE.md, project docs |
| R5 | Fresh alternative | `devops:rethinker` | the code-free cut (`codeFree.prompts`, goal, no-gos) |

Budget class `ask-before-parallel` / `sonnet-only`
(`{PLUGIN_ROOT}/deep-knowledge/agent-proactivity.md`) or `--lite`: R1, R2+R4
as one `devops:redteam`, R3; no R5; synthesis in the main thread under the
same rules, and the report says "alternatives not independently generated".

A role that dies: continue with the rest, the synthesis names the unexamined
slice.

## Step 3 — Synthesis

Spawn `devops:research` as **S** with the five role outputs, the brief and the
sealed loop hypothesis (not the transcript), using the synthesis block of
`roles.md`: findings are fact / inference / hypothesis; consensus needs two
roles with disjoint slices; dissent stays dissent (never averaged); nothing is
dropped; the loop hypothesis gets `confirmed` / `refuted` / `open`. The main
thread may add a labelled orchestrator note, never edit a finding.

## Step 4 — Plan and record

Build the plan JSON from section 5 of the report and record it:

```bash
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" plan record --file "<temp>/plan.json"
node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" plan status
```

Schema `{direction, steps:[{n, type: implement|concept|learn|webguide, goal, objects, payload}], out_of_scope, decisions, checks, base}`
(≤ 16 KB). Never a `ship` / `release` / `merge` / `push` / `deploy` step.
Note the `display` (`fm-… v1 · 3f9a1c2e`) and, from `plan status`, a
`wouldReplace` contract (d8). "Analysis only" is a valid plan: zero steps.

## Step 5 — Present (d7, item-860)

The report has five fixed sections: 1 What you wanted · 2 Most likely causes
(loop-hypothesis verdict first) · 3 What was tried and why it probably did not
work · 4 Alternative directions (at least one, a different architecture is
explicitly welcome) · 5 Recommended plan (steps, open decisions with the
recommended option, risks, the checks to run first). Then a short synthesis
ledger (counts of consensus / dissent / single-source / unverified,
independence limits of this run). No Ultracode field (d14).

Choose the presentation by the existing concept-vs-card rules
(`{PLUGIN_ROOT}/deep-knowledge/completion-card-design.md`,
`{PLUGIN_ROOT}/skills/auto-concept/SKILL.md` triggers; visual work ⇒ concept):

- **Non-trivial plan** (several steps, open decisions, anything visual): the
  analysis is complete, so `frustrated-guard.js disarm` first (the concept
  flow starts its own page server), then hand the report and the recorded plan
  (id + short hash) to `Skill("devops:auto-concept", …)`; its page is where
  the user decides. Its implement click is the approval of that plan (then
  `plan approve` with that id/hash); a ship choice exists only on its
  close-out sheet (d9). The pending plan record stays inert until then.
- **Trivial plan** (one clear step, no open decision): the plan text **above**
  the completion card (variant `analysis`), with the plan display id. One line
  under the plan: what an approval starts, and — if `wouldReplace` is set —
  which running contract it replaces. The card's next step is the approval.

Stop after the card / page. On the inline path the guard stays armed while
the approval is pending.

## Step 6 — Approval and hand-off (next prompt)

Approval is **any interpretable yes** in the user's next prompt, no fixed
phrase. Silence, a click-through, a workflow review dialog or ultracode's
standing opt-in are never an approval.

- **Yes:** `plan approve --id <fm-id> --hash <short>` → on `approved:true`
  `frustrated-guard.js disarm` → hand off each step, in order:

  | Step type | Hand-off |
  |---|---|
  | implement | `Skill("devops:do-run", "--from=frustrated --plan=<id>@<short> --step=<n> <goal>")` (do-run asks its own ship question per step); a narrowly diagnosed defect: `Skill("devops:auto-fix", "--from=frustrated --plan=<id>@<short> --step=<n> <goal>")` |
  | concept | `Skill("devops:auto-concept", …)` |
  | learn | `Skill("devops:do-learn", …)` |
  | webguide | `Skill("devops:auto-guide", …)` |

  `auto-agents` is reached only through do-run. A refused approval (`approved:false`)
  → say why in one line, keep the guard, offer to record the plan again.
- **No / something else:** `plan clear`, `frustrated-guard.js disarm`, then
  follow the new prompt as usual.
- **Changes requested:** adjust the plan, `plan record` again (version +1),
  present again.

## Never

- Never ships and never asks to ship (d9); never arms a ship step.
- Never edits the app's source or config during Steps 1–5; never disarms the
  guard without an approval, a no, or the user ending the analysis.
- Never reads another session without the explicit yes (d5).
- Never starts a Workflow; never auto-approves.
