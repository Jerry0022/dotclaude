# Frustrated Mode — integration with Ultracode, dynamic workflows and existing mechanisms

Date: 2026-10-25 · Status: design (no implementation) · Issue: #862 ·
Epic: #857 · Last child before the umbrella spec. Builds on:

- the trigger spec of #858
  (`docs/superpowers/specs/2026-10-25-frustrated-mode-trigger-detection-design.md`,
  "the #858 spec");
- the analysis-skill spec of #859
  (`docs/superpowers/specs/2026-10-25-frustrated-mode-analysis-skill-design.md`,
  "the #859 spec");
- the approval and hand-off spec of #860
  (`docs/superpowers/specs/2026-10-25-frustrated-mode-plan-approval-handoff-design.md`,
  "the #860 spec");
- the channel gate of #861 (`plugins/devops/deep-knowledge/channel-gating.md`,
  `plugins/devops/hooks/lib/channel-gate.js`).

This spec does not redefine roles (#859), the approval record, the `plan`
contract mode or the hand-off matrix (#860), or the gate (#861). It cites them
and answers only what they left to #862.

## Why

The issue asks one question: where does Frustrated Mode dock into dotclaude
so that no second, competing execution path appears? Two platform features
were named as candidates, Ultracode and dynamic workflows. The binding
refinement decision fixes the frame: **the plan stays Workflow-agnostic;
dynamic workflows are an optional runtime** (#862 § Decisions).

**Verdict in one line:** Frustrated Mode docks at the four existing
mechanisms #860 already names, with **neither** Ultracode nor the Workflow
tool on the critical path. Workflows stay out of phases A and B entirely,
and inside phase C they are at most a runtime *inside* an `implement` step
chosen by `auto-agents`, never a fifth step type. That runtime stays switched
off in stage 1 because no dotclaude hook sees a `Workflow` call today. Ultracode
is a session effort preference, not a trigger and not a mode. Four small
extensions, all of them deny rules or text lines, and no new pipeline.

## Method and evidence levels

Same convention as the #858–#860 specs, plus one level for platform facts:

- **[V]**: verified in this repo, with `path:line` (paths under
  `plugins/devops/` unless stated otherwise; upstream specs by their `:line`);
- **[P]**: verified in the **installed Claude Code build** on this machine
  (`@anthropic-ai/claude-code` 2.1.270, `package.json:3`): either its public
  type file `sdk-tools.d.ts` with line, or a UI/system-prompt string extracted
  from `bin/claude.exe`. These are real platform facts for that build, but
  they are **not** official documentation. No WebSearch/WebFetch tool was
  available to this run, so no `docs.anthropic.com` page could be checked.
  Capability claims beyond these strings are marked [A];
- **[A]**: an assumption. All of them are collected again in § Assumptions.

Written under an autonomous directive, without asking the user.

**Correction of the issue's starting fact.** The refinement says the Workflow
tool appears "only in a JSDoc line in `hooks/lib/pending-tasks.js`". The repo
actually knows it in four places: as a launcher kind
`workflow: new Set(['Workflow'])` [V] `hooks/lib/pending-tasks.js:130-134`
plus the name resolver [V] `:321-349`; as the "Workflows" row of the card's
pending list [V] `mcp-server/lib/pending.js:76` (introduced by #339, "name
running workflows on a row of their own"); in a completion-hook test [V]
`hooks/post-tool-use/post.flow.completion.test.js:373`; and as a tool Claude
Code strips from every sub-agent [V] `scripts/agent-definitions.test.js:36-37`.
None of them *uses* workflows. They only observe them. "Ultracode" appears
only as the top effort label [V] `hooks/lib/agent-card.js:57` (since #510)
and its test [V] `hooks/lib/agent-card.test.js:31-34`. No skill, agent or
deep-knowledge file mentions either.

## 1. What the two platform features are

### 1.1 Dynamic workflows (the `Workflow` tool)

| Fact | Evidence |
|------|----------|
| A tool that runs a **self-contained script** starting with `export const meta = { name, description, phases }`, whose body orchestrates sub-agents with `agent()/parallel()/pipeline()/phase()` | [P] `sdk-tools.d.ts:2805-2809` |
| Can also run a **named** workflow (built-in or from `.claude/workflows/`), with an `args` value | [P] `sdk-tools.d.ts:2810-2827` |
| Persists its script under the session dir; re-run via `scriptPath`; `resumeFromRunId` returns cached results of unchanged `agent()` calls, same session only | [P] `sdk-tools.d.ts:2828-2835`, `:4133-4136` |
| Runs **asynchronously** as a background task: `status: async_launched \| remote_launched`, `taskType: local_workflow \| remote_agent` (remote = a cloud session) | [P] `sdk-tools.d.ts:4113-4127`, `:4137-4144` |
| Sub-agent transcripts go to `…/subagents/workflows/wf_<id>` | [P] `sdk-tools.d.ts:4129-4132`; [V] fixture `hooks/lib/pending-tasks.test.js:690-692` |
| Not available to sub-agents: only the main thread can launch one | [V] `scripts/agent-definitions.test.js:36-37` |
| Can be off: a "Dynamic workflows" setting (`workflowsEnabled`), managed settings (`disableWorkflows`), org policy or a launch gate. Error text: "Dynamic workflows are not enabled for this session (org policy, launch gate, or the "Dynamic workflows" setting in /config)." | [P] binary strings |
| Platform cost warning: "Dynamic workflows can use a lot of tokens quickly by running many subagents in parallel, which counts against your usage limit." | [P] binary string |
| A platform permission step "Review dynamic workflow before running" exists | [P] binary string; whether it is shown by default is [A] |

Not verified, and important here [A]: whether **PreToolUse/PostToolUse hooks
fire for tool calls made by workflow sub-agents**; whether `agent()` can pin a
plugin agent type (and so its `tools` frontmatter); and whether workflow
agents get the session's plugin skills.

### 1.2 Ultracode

| Fact | Evidence |
|------|----------|
| An **effort level** next to `low…max`: "ultracode: xhigh + dynamic workflow orchestration (this session only)"; picker text "xhigh effort + dynamic workflows for maximum thoroughness" | [P] binary strings |
| Session-scoped; set via the effort picker / `--effort`, or the `ultracode` settings key (`--settings`); "Whether ultracode (xhigh effort plus standing dynamic-workflow orchestration) is active for the session" | [P] binary strings |
| Requires workflows: "Ultracode needs dynamic workflows enabled (see /config)"; requires an xhigh-capable model | [P] binary strings |
| Its system-prompt rule: "When a system-reminder confirms ultracode is on, that opt-in is standing: author and run a workflow for every substantive task by default. … token cost is not a constraint. For multi-phase work (understand → design → implement → review), that often means several workflows in sequence … Solo only on conversational turns or trivial mechanical edits." | [P] binary string |
| An optional "Ultracode keyword trigger" (`workflowKeywordTriggerEnabled`) can request a dynamic workflow for a single turn from a prompt keyword | [P] binary strings; the keyword itself is not verified [A] |
| dotclaude only *labels* it: `ultracode: '●●●●●●'` in the agent card | [V] `hooks/lib/agent-card.js:57`, `:88-92` |

**So neither is a planning, diagnosis or approval mechanism.** A workflow is
an orchestration *runtime* for sub-agents. Ultracode is a *standing
instruction* to use that runtime for everything substantive. Neither has a
notion of "a plan the user approved", and the platform review dialog is a
permission prompt for a script, not a plan approval.

## 2. Inventory: what Frustrated Mode touches

### 2.1 Skills

| Skill | Role for Frustrated Mode | Settled in |
|-------|--------------------------|-----------|
| `auto-frustrated` (new, `user-invocable: false`) | the analysis skill; detect → analyse → propose; never executes | #859 § 1 (name revised by #860 § 7 and channel-gating.md:16-18) |
| `do-run` (router, rethink, autonomous) | `implement` step target via `--from=frustrated`; possible entry point (§ 6a) | #860 § 4.1, G6 |
| `auto-agents` | the single execution path inside `implement` | #860 § 4, G5 |
| `auto-concept` | `concept` step; its implement click is a re-approval | #860 § 4.2, G7 |
| `do-learn` | `learn` step | #860 § 4, G8 |
| `auto-guide` | `webguide` step | #860 § 4, G11 |
| `auto-fix` | mandated failure fixer; feeds T7; possible hint (§ 6b) | #858 § 9; #859 § 1.2 |
| `do-ship` | only inside an `implement` step, under Q2 ship authority | #860 § 4 [V] `skills/do-run/SKILL.md:263` |
| `auto-harden`, `auto-polish` | `implement` obligations, unchanged | #860 § 3.3 |
| `do-batch`, `auto-issue`, `auto-cleanup`, `auto-extend`, `auto-update` | none | — |

[V] skill list: `skills/` (14 dirs).

### 2.2 Agents

Analysis roles R1–R5 and S, with `rethinker` reused unchanged: #859 § 2.
Execution agents (`core`, `frontend`, `qa`, `redteam`, …) are reached only via
`auto-agents` [V] icon roster `hooks/lib/agent-card.js:50-54`. Frustrated Mode
adds no execution agent.

### 2.3 Router, hooks, cards, approval mechanisms

| Mechanism | Where | Relevance |
|-----------|-------|-----------|
| Trigger router `routeMessage` + gate | [V] channel-gating.md:25 | explicit phrases (#859 § 1.1), filtered per prompt |
| #858 detector (3 hooks, shadow → suggest) | #858 § 4.1, § 7 | detection; this spec adds no detector input |
| `pre.frustrated.readonly` (to build) | #859 § 5, #860 G10 | phase A/B write guard; **needs `Workflow` in its matcher** (§ 4, I1) |
| `pre.run.contract` | [V] `hooks/hooks.json:114-116` | `plan` gates (#860 § 3.4); its matcher has **no `Workflow`** |
| `pre.strict.agent-gate`, `pre.agent.model`, `pre.agent.announce` | [V] `hooks/hooks.json:95-99`, matcher `Agent` only | strict propagation and the spawn card; blind to workflow agents |
| `post.ask.answers` | [V] `hooks/hooks.json:197` (#858 § 6) | records the approval question's answer |
| Completion card + pending list | [V] `mcp-server/lib/pending.js:76`, `hooks/lib/pending-tasks.js:130-134` | `analysis` card (#859 § 7); a running workflow keeps the card pending, which is already handled |
| `summaryForCard` | #860 § 2.6 | plan line on the card |
| Run contract (`plan` mode), strict, batch hand-off gate | #860 § 3, § 5.6, § 6 | approval carrier = run contract; batch gate rejected by #860 |
| Platform: workflow review dialog, permission modes | [P] | permission, never plan approval (§ 5) |

## 3. Responsibility matrix

| Duty | Owner | Not the owner | Source |
|------|-------|---------------|--------|
| **Detect** (suggest) | #858 detector hooks, plus explicit invocation through the router; alpha only | Ultracode, workflows, `auto-fix` (only feeds T7 and may print a hint, § 6b) | #858 § 4, § 7 |
| **Analyse** | `auto-frustrated` main thread + R1–R5 + S as plain `Agent` spawns | a Workflow script; Ultracode's "run a workflow for every substantive task" rule is suspended (§ 4) | #859 § 2, § 7 |
| **Approve** | the user, through the `Plan freigeben?` question or the strict typed rule, recorded with id + hash in the run contract | silence, autostart, click-through, the platform workflow review dialog, Ultracode's standing opt-in | #860 § 2.5 |
| **Execute** | per step: `do-run`→`auto-agents`, `auto-concept`, `do-learn`, `auto-guide`, sequenced by the `plan` contract | `auto-frustrated` itself; a Workflow as a step of its own | #860 § 4 |
| **Runtime inside `implement`** | `auto-agents` decides tier and waves; stage 1: Agent spawns only; later optionally a Workflow (§ 4.3) | the plan (it names outcomes and objects, not a runtime) | this spec |

## 4. Integration options and recommendation

### 4.1 Options

| # | Option | Verdict |
|---|--------|---------|
| O1 | **Neither Ultracode nor workflows.** Analysis by Agent fan-out (#859), execution by the four existing mechanisms (#860). | **Recommended for stage 1, and the permanent baseline.** Works on every build and every policy; every call is visible to the existing hooks. |
| O2 | Workflow as an **optional runtime inside `implement`**, chosen by `auto-agents` like a tier | **Recommended as a later extension**, behind three preconditions (§ 4.3). Matches the refinement decision. |
| O3 | Workflow as the **analysis runtime** (R1–R5 + S as one script; adversarial verify for S) | **Rejected for now.** The #859 independence and read-only guarantee rest on per-role agent `tools` (L1) and an Agent-type allowlist (L2) [V] #859 spec `:273-286`. Whether `agent()` can pin those is unverified, and no hook would see the inner calls. Revisit only if both are verified. |
| O4 | Workflow as a **fifth plan step type** (`workflow`) | **Rejected** (answer (c), § 6c). |
| O5 | Ultracode as a **trigger** or as a "deep" Frustrated variant | **Rejected.** Ultracode states a thoroughness preference chosen *before* any failure. It says nothing about frustration (#858 § 2 lists no such signal), and running the mode at ultracode effort is already the session's choice. |
| O6 | Frustrated Mode as a **`do-run` mode** | Already rejected by #859 § 1 (rethink implements on its own). Only an *entry* from do-run is added (§ 6a). |

### 4.2 Recommended integration point

The **approval record in the run contract** (#860 § 3) is the one integration
point. Everything before it is `auto-frustrated` (read-only). Everything after
it is an existing mechanism that receives `--from=frustrated --plan=<id>@<short>
--step=<n>`. Ultracode and workflows meet Frustrated Mode only as
**constraints on tools**, never as owners of a phase:

| Phase (#860 § 1.1) | `Workflow` tool | Ultracode on |
|--------------------|-----------------|--------------|
| A · Analysis | **denied** by `pre.frustrated.readonly` (I1) | its workflow default is suspended; the deny message says so |
| B · Decision | **denied** (same guard) | same |
| C · `implement` step | stage 1: **denied** by `pre.run.contract` in `plan` mode (I2), message points to `auto-agents`; stage 2: allowed per § 4.3 | stage 1: execution falls back to `auto-agents` Agent waves; card shows effort `●●●●●● ultracode` [V] `agent-card.js:57` |
| C · `concept` / `learn` / `webguide` step | **denied** (not in plan, #860 § 3.4 gate 2 by analogy) | no effect |

Why deny rather than ignore: today no PreToolUse matcher in `hooks.json`
contains `Workflow` [V] `hooks/hooks.json` (no match for "Workflow"); the
run-contract matcher is `Edit|Write|NotebookEdit|Bash|PowerShell|Skill|…`
[V] `hooks/hooks.json:116`. The #859 guard is specified as an allowlist
("everything else stays denied" [V] #860 spec `:96-101`), but an allowlist
only covers the tools its matcher names. Without I1, one Workflow call in
phase A would launch writing sub-agents past the guard. That is the single
largest risk this spec finds, and it applies with or without Ultracode,
because the model can call Workflow on any build where it is enabled.

### 4.3 Preconditions for O2 (workflow runtime inside `implement`)

1. **Hook coverage verified:** a PreToolUse hook demonstrably fires for an
   `Edit` made by a workflow sub-agent (one throwaway e2e via
   `evals/ab-run.js`, never in a live contract, per the `--cwd` lesson for
   contract smokes). If hooks do not fire inside workflows, O2 stays off for
   plan runs, permanently.
2. **Strict carried:** the workflow's `args` carry the strict contract block
   and the approved step payload verbatim, and `pre.run.contract` checks
   that before it allows the call. That mirrors `pre.strict.agent-gate` for
   `Agent` [V] `hooks/hooks.json:95` (#860 § 5.4).
3. **Budget honoured:** the call passes through the same budget class as an
   Agent wave (#858 § 6 budget row). Ultracode's "token cost is not a
   constraint" [P] does not override a `sonnet-only` or
   `ask-before-parallel` class.

`auto-agents` is the right owner because it already chooses the runtime
(tier, waves, model) and the plan does not [V] `skills/auto-agents/SKILL.md:8-10`
(#860 § 5.3: tier and wave layout are not material). Choosing a workflow is
then one more non-material runtime choice. It needs no re-approval and no
new plan field.

## 5. How the alpha gate and explicit approval are preserved

**Alpha gate (#861).** Nothing here adds an entry point that bypasses
`isFeatureEnabled('frustrated-mode')`:

- the do-run Q4 option (§ 6a) and the auto-fix hint (§ 6b) are suggestion
  surfaces, so each calls `isSkillEnabled` first and **renders nothing** when
  false: no greyed option, no "not available" line [V] channel-gating.md:12-14, `:29`;
- the deny rules I1/I2 act only on frustrated state, which cannot exist on
  beta or stable, and still check the gate first, silent when false (#860 § 7);
- Ultracode and workflows are platform features the gate does not touch. On
  beta and stable they behave exactly as today.

**Explicit approval (#860).** Neither feature can become an approval:

- the platform's "Review dynamic workflow before running" dialog [P] approves
  a *script*, may be pre-allowed in settings, and carries no plan hash. It is
  added to the #860 § 2.5 "not an approval" list (I4);
- Ultracode's "that opt-in is standing" [P] is consent to a runtime, not to a
  plan;
- the Ultracode keyword trigger [P] can only request a workflow, which I1
  denies in phases A/B;
- a workflow inside `implement` (O2) runs under an already approved step and
  is bounded by its `objects` (strict). It never starts a step.

## 6. Answers to the items deferred to #862

### 6a. Should do-run offer Frustrated Mode? (#859 open question, `:409-411`)

**Yes, as a non-default Q4 option, alpha only, exclusive.**

| Rule | Value | Why |
|------|-------|-----|
| Label | `"Erst analysieren (Frustrated Mode)"` — "Ursachen klären, Plan vorschlagen, nichts umsetzen." | the honest promise; matches #858 § 6 option 1 |
| Shown when | `isSkillEnabled('auto-frustrated')` **and** Q1 = Prompt umsetzen **and** the prompt reads stuck (the same condition that marks Rethink recommended [V] `skills/do-run/SKILL.md:87`, `:154`) | the only Q4 context where it fits; no new trigger |
| Never shown | machine prompts (`AUTONOMOUS_AUTOSTART:`, `RUN_BACKLOG_AUTOSTART:`), backlog, audit, burn | an unattended run must not start an analysis nobody reads |
| Position | after `Rethink vorher`, before `Budget verbrennen`; never first, never `(Recommended)` | any click-through takes the first option [V] `skills/do-run/SKILL.md:71-74`; rethink keeps the recommendation it has today |
| Ticked together with others | Frustrated wins; the other ticks are dropped and named in one line | the analysis may change the direction; rethinking or burning first would be the loop again |
| Effect | the router arms **no** `prompt` contract (or archives one it just armed with `abort --reason "handed to frustrated"` [V] `run-contract.md:78`), then `Skill("devops:auto-frustrated", <prompt>)`; Q2 and Q3 answers are discarded, and #860 asks Q2 again per `implement` step | ship authority stays per step (#860 § 4.1) |
| With Autonom in Q2 | still allowed: the analysis asks nothing (#859 § 1); the approval question waits for the user's return and is never auto-approved | #860 § 2.5 |
| Counts as | an explicit invocation, not an automatic suggestion; closes the target for the #858 detector | #858 § 6 "after the mode ran" |

Rejected alternative: re-pointing rethink's stuck phrases to Frustrated Mode.
That changes existing behaviour for all channels (#859 § 1.1 already rejected it).

### 6b. A hint in auto-fix's report? (#859 § 1.2, #858 open question)

**Yes, one passive line, from stage 2 of the #858 rollout, never a hand-off.**

- Where: the end of auto-fix's Step 8 report [V] `skills/auto-fix/SKILL.md:114-122`.
  Not a card chip and not an `AskUserQuestion`.
- When all hold: `isSkillEnabled('auto-frustrated')`; the #858 detector is in
  stage 2+ and not snoozed or opted out for the session; and auto-fix ended in
  Step 6 "Unclear root cause" or "Architectural issue" [V] `auto-fix/SKILL.md:78-79`,
  **or** its Step 5 found no broken technical invariant (the symptom is
  "works as coded, not as wanted"), **or** the #858 state shows T7 for this
  target.
- Text (German UI, per locale): "Sieht eher nach einem Missverständnis von
  Ziel oder Ansatz aus als nach einem Bug — Frustrated Mode kann das
  analysieren ('analysier erstmal, warum das nicht klappt')."
- Why stage 2, not stage 1: the epic allows automatic suggestions only after a
  feasibility check (#857 § Leitplanken), and #858 stage 1 shows none. A
  passive line is still a suggestion.
- It does **not** count against the #858 session cap (it interrupts nothing),
  but a declined or snoozed target suppresses it.
- auto-fix stays mandated and unchanged otherwise. The line never starts
  anything (#859 § 1.2, #858 § 9 rule 3).

### 6c. Ultracode / workflows: own step type or inside `implement`? (#860 open question, `:591-592`)

**Inside `implement`, via `auto-agents`. No fifth step type.** This confirms
the #860 assumption.

1. **Binding decision:** the plan is Workflow-agnostic (#862 § Decisions). A
   `workflow` step type would bind the plan to a runtime.
2. **Step types name an owner mechanism**, not a runtime (#860 § 4: implement,
   concept, learn, webguide). A workflow has no outcome of its own. It only
   runs agents that implement, research or review, and those outcomes are
   already types.
3. **Hashing:** the canonical plan hashes goal, objects and decisions (#860
   § 2.2). A workflow script is code. Hashing it would make every harmless
   script edit a "material deviation", and not hashing it would let an
   unapproved script run under an approved step.
4. **Availability:** workflows can be off by setting, managed policy or org
   policy [P]. A plan that names a workflow step could become unexecutable on
   the same machine a day later.
5. **Gate coverage:** step gates live in `pre.run.contract`, whose matcher
   does not see `Workflow` [V] `hooks/hooks.json:116`.

## 7. Dependencies, conflicts, cost, risks

| Kind | Item | Handling |
|------|------|----------|
| Dependency | #859 guard and #860 `plan` mode are unbuilt | I1/I2 are rows *in* those builds, not separate work |
| Dependency | Claude Code build: Workflow exists in 2.1.270 [P]; older builds lack it | O1 does not depend on it; I1/I2 deny a tool that may not exist, which is harmless |
| Conflict | Ultracode's standing rule ("run a workflow for every substantive task") vs the #859 Agent fan-out and `auto-agents` | deny + reason text (I1, I2); the skill text of `auto-frustrated` says once at start that the analysis uses its fixed roles regardless of effort |
| Conflict | Ultracode keyword trigger in a frustrated prompt | covered by I1 |
| Conflict | do-run Q4 is multi-select "passes before implementing"; Frustrated never implements | exclusive semantics (§ 6a) |
| Cost | analysis ≈ 250k–500k tokens, 4–10 min (#859 spec `:361-363`); at ultracode the session runs at xhigh, and `inherit` agents follow the session [V] `skills/auto-agents/SKILL.md:321-323` | the #858 budget class still applies; the analysis card shows the effort per agent |
| Cost | a workflow "can use a lot of tokens quickly" [P] | O2 only behind § 4.3 precondition 3 |
| Risk | **workflow sub-agents bypass all dotclaude PreToolUse gates** (unverified either way) | the largest one; the reason for I1/I2 and for O2's precondition 1 |
| Risk | the model retries Workflow after a deny, under Ultracode | one deny message with the reason and the alternative; a repeat is just another deny (no write happens) [A] |
| Risk | the card waits on a running workflow (pending list) | existing behaviour, correct [V] `mcp-server/lib/pending.js:76` |
| Risk | remote workflows (`remote_launched`, cloud session) clone the pushed branch [P] `sdk-tools.d.ts:4141-4144` and run outside local hooks entirely | denied in all phases of a plan run, including stage 2 (I2) |

## 8. Gap list — smallest extension per gap

| # | Gap | Smallest extension | Where |
|---|-----|-------------------|-------|
| I1 | The #859 guard's allowlist cannot deny a tool its matcher does not name; Workflow would pass phases A/B | add `Workflow` to the guard's matcher; deny with "Frustrated analysis runs its fixed roles; workflows (also under ultracode) are off until a plan is approved" | `hooks/hooks.json` entry of `pre.frustrated.readonly` (#860 G10) |
| I2 | `plan` gates do not see Workflow | add `Workflow` to the `pre.run.contract` matcher; in `plan` mode: deny outside an open `implement` step; inside it, deny in stage 1 with a pointer to `auto-agents`; always deny `remote: true`. Outside `plan` mode: no change | `hooks/hooks.json:116`, `pre-tool-use/pre.run.contract.js` |
| I3 | do-run Q4 has no Frustrated option; auto-fix has no hint | the Q4 row of § 6a (one option, gated); the Step 8 line of § 6b (gated, stage 2+) | `skills/do-run/SKILL.md` Q4 + `questions.md` § Reading Q4; `skills/auto-fix/SKILL.md` Step 8 |
| I4 | #860 § 2.5 does not list platform consents | add "the platform workflow review dialog" and "Ultracode's standing opt-in" to its "not an approval" list | the #860 spec, or the `auto-frustrated` SKILL.md that implements it |

Deliberately **not** proposed: any change to `agent-card.js` or
`pending-tasks.js`. They observe Ultracode and workflows correctly already.

## Assumptions

1. The installed build's strings (2.1.270) describe the current platform
   behaviour of Ultracode and dynamic workflows. Later builds may differ, and
   no official doc page was checked (no web tool in this run).
2. Whether hooks fire for tool calls inside workflow sub-agents is unknown.
   This spec is written so that both answers are safe (deny by default).
3. Whether a workflow `agent()` can pin a plugin agent type and its `tools`
   is unknown, which is why O3 is rejected rather than deferred to stage 1.
4. The platform's workflow review dialog may be pre-allowed in settings, so
   it can never stand in for an approval.
5. `isSkillEnabled` is reachable from a Markdown skill (do-run, auto-fix) by
   a one-line `node` call to `channel-gate.js`. If no CLI entry exists, a
   minimal one is part of I3.
6. A model under Ultracode accepts a reasoned deny and falls back to Agent
   spawns without a loop of retries.
7. "The prompt reads stuck" in do-run is the same predicate that marks
   Rethink recommended today, so § 6a needs no new classifier.

## Open questions

- **Stage-2 enablement of O2:** who runs the hook-coverage e2e (§ 4.3, 1),
  and is a negative result a permanent "no workflows in plan runs"?
  Recommended: yes, permanent until the platform documents hook coverage.
- **Q4 exclusivity:** drop the other ticks silently-but-named (proposed), or
  refuse the combination and ask again? Recommended: drop and name, because
  it costs one question less.
- **auto-fix hint in stage 1** as a pure shadow-log entry (no visible text),
  to measure how often it would fire? Recommended: yes, as a #858 shadow
  marker. That is cheap evidence for the stage-2 decision.
- **Ultracode note in the report:** should the analysis report mention that
  the session runs at ultracode, as context for R4 ("workflow & product")?
  Proposed: only as transcript metadata R4 already sees (#859 § 2), no new
  field.

## Acceptance (for this spec)

- [x] Relevant skills, agents, router, hooks, completion cards and approval
  mechanisms are inventoried (§ 2).
- [x] Ultracode and dynamic workflows are assessed against the repo state
  (with a correction of the issue's starting fact) and the installed Claude
  Code build, with unverified points marked (§ 1, Method).
- [x] Responsibility matrix (§ 3) and a recommended integration point,
  including the option without Ultracode or workflows (§ 4).
- [x] No duplication of #859 roles, #860 approval and hand-off, or #861 gate:
  each is cited (header, § 2, § 3).
- [x] Alpha gate and explicit approval are preserved (§ 5).
- [x] The deferred items (a), (b), (c) are answered (§ 6).
- [x] No plugin change; this file only.
