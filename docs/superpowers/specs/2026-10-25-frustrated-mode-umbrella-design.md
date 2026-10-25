# Frustrated Mode — umbrella spec, criteria check and go / no-go

Date: 2026-10-25 · Status: decision record (no implementation) · Issue: #857
(epic) · Children: #858, #859, #860, #861, #862 · Related: #864.

This is the single place the user approves the Frustrated Mode concept from.
It links the five child specs, checks the epic's eight success criteria
against what they found, lists the conflicts and gaps between them, gathers
the open user decisions in one list, gives a recommendation and proposes how
to split the work into implementation issues. Binding refinement decision
(#857 § Decisions): **the epic is closed through this spec**, not just by
closing its children, because only this document checks the eight criteria.

**Verdict in one line:** **Go, descoped.** Build stage 1 only: an alpha-only
skill that is started explicitly, read-only enforcement by hook, plan approval
bound to an ID and hash, and the hand-off to the four existing mechanisms. The
detector runs in shadow mode and shows nothing. Automatic suggestions, the
auto-fix hint and a Workflow runtime inside `implement` are deferred behind
measurable gates. Five criteria are met at spec level, three are partly met,
and none is open. Every "partly" has a concrete resolution below.

## Method and evidence levels

Same convention as the child specs:

- **[V]**: verified in a repo file, with `path:line`. The child specs and
  the #861 code are on the integration branch
  (`.claude/worktrees/backlog-frustrated-k7q2`), not on `main` yet. They
  are cited by spec section;
- **[D]**: verified in **official Claude Code documentation** fetched on
  2026-10-25 (URL given). This level is new here. It is used for the
  `[P]` re-check of #862 (§ 7);
- **[A]**: an assumption.

Written under an autonomous directive, without asking the user. Every choice
a user might want to make is in § 5 with a recommended answer.

## 1. Child specs

### 1.1 #858 — trigger and frustration detection

[`2026-10-25-frustrated-mode-trigger-detection-design.md`](./2026-10-25-frustrated-mode-trigger-detection-design.md)

A dead end can be told apart from normal iteration only within one session,
from what hooks see: the prompt text in `UserPromptSubmit`, edits and errors
in `PostToolUse(Failure)`, and completion claims in `Stop`. The spec defines
nine triggers (T1–T9) and eleven counter-indicators (C1–C11). The detector
scores each target and suggests only when there have been at least 3 rounds
and a score of at least 6, with no model call. It sits behind `post.flow.debug`
and the Escalation rule. Rollout is staged: (1) explicit invocation plus a
silent shadow log, (2) one suggestion per session on alpha, (3) tuning. Each
step needs measured precision first.

### 1.2 #859 — analysis skill with independent sub-agents

[`2026-10-25-frustrated-mode-analysis-skill-design.md`](./2026-10-25-frustrated-mode-analysis-skill-design.md)

A separate skill, not a `do-run` mode, because rethink implements on its own.
Five roles each get a deliberately different slice of the evidence: R1 Intent
(user prompts only), R2 History, R3 Technical, R4 Workflow & product, and
R5 Fresh alternative, which reuses `rethinker` unchanged. A blind synthesizer
S merges them under fixed rules. Every finding is a fact, inference or
hypothesis and carries a status of consensus, dissent, single-source or
unverified, and consensus counts only across disjoint inputs. Read-only is
enforced in three layers: agent `tools` (L1), a mode-scoped PreToolUse guard
(L2), and skill rules (L3). The report has five sections and ends with a plan
type (implement, concept, learn, webguide or mixed) or "analysis only". Cost:
about 250k–500k tokens, 4–10 min.

### 1.3 #860 — plan approval and hand-off

[`2026-10-25-frustrated-mode-plan-approval-handoff-design.md`](./2026-10-25-frustrated-mode-plan-approval-handoff-design.md)

There are three phases: A Analysis and B Decision, both under the #859 guard,
then C Execution under the run contract. Approval is a structured answer bound
to `plan <id> v<n> · <hash8>`. The hash covers a canonical plan, never silence,
an autostart or a click-through, and "Nur Analyse" is the first option. The
run contract gains a `plan` mode with one obligation per step and three gates
(order, not in plan, stale version). Each step hands off verbatim to the
mechanism that owns it: do-run→auto-agents, auto-concept, do-learn or
auto-guide. Strict sets the scope. A material deviation forces re-approval.
The spec lists eleven small extensions (G1–G11) and no new pipeline.

### 1.4 #861 — alpha-only visibility (implemented)

[`plugins/devops/deep-knowledge/channel-gating.md`](../../../plugins/devops/deep-knowledge/channel-gating.md),
[`plugins/devops/hooks/lib/channel-gate.js`](../../../plugins/devops/hooks/lib/channel-gate.js)
(+ `channel-gate.test.js`)

This is the only child that is code. `isFeatureEnabled` is fail-closed. It
reads the pin from `~/.claude/plugins/.channels.json` at call time and turns
the feature off on beta, stable, an unknown pin or any error.
`'frustrated-mode': ['alpha']` is registered. `filterSkills` is wired into the
trigger router and tested per channel. Disabled means a silent no-op with no
hint. Because the slash menu cannot be filtered at runtime, gated skills must
be `auto-*` with `user-invocable: false`. The entry-point inventory lists the
hook-up points for later issues. `GATED_SKILLS` is still empty [V]
`channel-gate.js` (the skill's own issue adds the entry).

### 1.5 #862 — Ultracode, dynamic workflows, existing mechanisms

[`2026-10-25-frustrated-mode-integration-design.md`](./2026-10-25-frustrated-mode-integration-design.md)

Frustrated Mode docks only at the #860 approval record. Neither Ultracode nor
the Workflow tool is on the critical path (option O1, the permanent baseline).
A Workflow is at most a runtime *inside* an `implement` step, chosen by
`auto-agents` (O2, later), and never a fifth step type. The largest risk the
spec finds: no PreToolUse matcher in `hooks.json` names `Workflow`, so one
Workflow call could bypass the guard. Fixes: I1 adds Workflow to the guard,
I2 adds it to `pre.run.contract`. do-run Q4 gets an alpha-only "Erst
analysieren" option. auto-fix gets one passive hint line from stage 2.
The platform facts came from the installed CLI only and are re-checked in § 7.

### 1.6 Related: #864 — hook agents evaluation

[`2026-10-25-hook-agents-evaluation.md`](./2026-10-25-hook-agents-evaluation.md)

Decision: do not use hook agents or prompt hooks for now. Two findings matter
here. (a) An agent or prompt hook is no route for the #858 detector. That
confirms #858 § 4.1: no model call in the detector. (b) Its sample had only
**34 typed user turns in 11 interactive sessions over three days**, and a
naive correction word list misfired on 2 of 6 hits [V] #864 § 2. So the
signal base rate is low and keywords are noisy. Both feed conflict K6.

## 2. Success criteria check

| # | Criterion (#857) | Status | Evidence | What is missing |
|---|------------------|--------|----------|-----------------|
| 1 | Detects repeated failed correction loops without over-interrupting normal iteration | **partly** | #858 § 2–§ 5: triggers, counter-indicators, thresholds biased to silence, a cap of 1 per session, snooze and cooldown, and an ordering behind `post.flow.debug` / Escalation | The design exists, but its precision is **unmeasured**. All weights and thresholds are [A] (#858 Assumption 5). Stage 1 is the measurement, and the base rate may be too low to reach it soon (K6) |
| 2 | Explicit start possible; auto-suggestion not presupposed without confirmed criteria | **met** | #859 § 1.1 (trigger phrases, free of collisions with auto-fix and do-run); #858 § 7 (stage 1 shows nothing); #862 § 6a (do-run Q4 entry); #861 router gate | — |
| 3 | Analysis covers intent, conversation history, prior results, technical causes, external information | **met** | #859 § 2: R1 intent, R2 history and results (transcript + git), R3 technical + web, R4 workflow/product, R5 alternatives; § 3.2 brief | — (cross-session history is opt-in via `--session`, #859 § 3.2) |
| 4 | Several sub-agents analyse independently; synthesis shows consensus, dissent, uncertainty | **met** | #859 § 3.3 independence matrix; § 4 schema (consensus only across disjoint slices, dissent never averaged, sealed loop hypothesis); the report states the limits of independence | Independence is soft inside the repo for R2–R4 and all roles share one model family. The spec states this openly, as the epic's quality principle requires |
| 5 | Output has diagnosis, alternatives, prioritized recommendation, concrete plan | **met** | #859 § 6: five fixed sections, "different architecture explicitly asked for", plan types; #860 § 2.2 canonical plan with ordered steps | — |
| 6 | Nothing is implemented without explicit plan approval | **partly** | #859 § 5 L1–L3; #860 § 1 guard through phase B, § 2.5 "never from silence", § 3.4 gates, disarm only after the contract is armed; #862 I1/I2 Workflow deny | Holds only when K3 (all-tool matcher), K4 (the plugin's own mandatory tools on the allowlist) and the platform assumptions in K8 hold. The guard is "hard, as long as hooks run" (#859 § 5) |
| 7 | Confirmed hand-off uses existing dotclaude workflows | **met** | #860 § 4 hand-off matrix + § 6 G1–G11 (extensions only; batch gate considered and rejected); #862 § 3, § 4 (no new pipeline, no workflow step type) | — |
| 8 | Beta and stable users do not see the skill | **partly** | #861 gate is implemented and tested (router filtering per channel, fail-closed, silent); naming rule `auto-*` + `user-invocable: false`; #860 § 7 and #862 adopt `auto-frustrated` | Three surfaces are not closed yet: the skill list the model sees, the new agent types, and README/eval listings (K2). `GATED_SKILLS` is empty and no CLI exists for Markdown skills (K5) |

**Result: 5 met · 3 partly · 0 open.** All three "partly" rows are
resolvable in the stage-1 build (criteria 6 and 8) or are measurement by
design (criterion 1). None blocks a go.

## 3. Conflicts and gaps between the child specs

| # | Conflict / gap | Between | Proposed resolution |
|---|----------------|---------|---------------------|
| K1 | **Skill name.** #859 proposes `do-frustrated`, a slash-menu door. The #861 rule requires `auto-*` + `user-invocable: false`. #860 § 7 picks `auto-frustrated` and renames it at promotion. #862 already uses `auto-frustrated`. | #859 ↔ #861/#860/#862 | **`auto-frustrated`, `user-invocable: false`** for as long as `GATED_FEATURES` lists only alpha. At promotion: rename to `do-frustrated` (frontmatter + one `skill-names.js` `RENAMED` entry), widen the channel list, and add the README row in the same change. The `--from=frustrated` value, the feature id `frustrated-mode`, the hook names and the temp-dir names do not depend on the skill name, so the rename does not touch them. |
| K2 | **Visibility leaks the gate does not cover.** (a) `user-invocable: false` hides a skill from the slash menu, but not from the skill list in the model's system prompt. Every `auto-*` skill of this plugin is listed there on every channel [V, observed in this session's own skill listing]. On beta the model could still *mention* the mode from its description. (b) The new agent types `analyst` / `analyst-blind` (#859 § 8) show in agent lists on every channel, and a description that says "spawned by Frustrated Mode" would name the skill. (c) README tables, generated counters and trigger evals. | #861 inventory ↔ #859 artefacts | (a) The skill's `description` starts with a guard sentence, "Alpha-gated: invoke only when its trigger phrases appear; never suggest or name it otherwise", and step 0 calls the gate and ends silently (#861 rule). No user-facing text outside the skill names it. (b) The agents get generic, skill-free descriptions ("read-only evidence analyst; not proactive") and stay out of README agent tables until promotion. As generic read-only agents they are harmless on beta. (c) The README generator and the counter `--check` skip `GATED_SKILLS`. Trigger-eval cases for the skill are tagged alpha-only. Criterion 8 counts as met when (a)–(c) are in place. |
| K3 | **Workflow bypass of the read-only guard.** #859 specifies an allowlist, but a PreToolUse allowlist covers only the tools its matcher names. `Workflow` is in no matcher (#862 § 4.2). The same is true for any tool a future build adds. | #859/#860 ↔ #862 | Register `pre.frustrated.readonly` with an **all-tool matcher** (`*`), not an enumerated list. When no armed state file exists for the session it returns at once (one `fs.existsSync`), which keeps the per-call cost at the `post.flow.debug` level. That makes the allowlist real and covers I1 without naming Workflow. I2 (`Workflow` in the `pre.run.contract` matcher for `plan` mode) stays as #862 specifies. The docs confirm that a PreToolUse hook can decide on a Workflow call [D] (§ 7). |
| K4 | **The guard against the plugin's own mandatory tools.** The #859 allowlist lists Read/Grep/Glob/Web/TodoWrite/Agent(roles)/card. During phase A/B the plugin's own Stop and turn hooks still demand other tools: the session title, the plan tools of the host (`update_plan`, `wrap_up`), `get_usage` for the budget question, and `AskUserQuestion`, which #860 adds. A guard that refuses these would deadlock against `stop.flow.guard`. | #859 § 5 ↔ #860 § 1.2 ↔ existing Stop hooks | Define the allowlist as **read-only tools + an explicit "harmless platform/plugin" list** in one exported constant: card render, `get_usage`, title tools, host plan/wrap-up tools, `AskUserQuestion`, and the exact `frustrated-plan.js` command. A test asserts that every tool a Stop/UserPromptSubmit hook of this plugin can demand is on the list. |
| K5 | **No CLI for the gate.** Markdown skills (the skill itself, do-run Q4, auto-fix hint) have to call `isFeatureEnabled` / `isSkillEnabled`, but `channel-gate.js` has no CLI entry [V] (no `require.main` branch). #862 Assumption 5 flags this. | #861 ↔ #862 | Add a minimal CLI, `node channel-gate.js skill <name>`, which prints `1` or `0` and exits 0 on every path (fail-closed). Add `auto-frustrated: 'frustrated-mode'` to `GATED_SKILLS` in the same change. Both go in the first implementation issue. |
| K6 | **Stage-1 exit is probably slow to reach.** #858 needs ≥ 20 reviewed `suggest` verdicts. #864's sample had 34 typed user turns in 11 interactive sessions over three days, and a keyword-only detector misfired on a third of its hits. At that rate, 20 verdicts of ≥ 3 rounds and score ≥ 6 can take months. | #858 § 7 ↔ #864 § 2 | Run stage 1 with a **time box of 8 weeks**. In parallel, add a **dev-only offline replay**: run the same detector over the maintainer's own past transcripts (local, read-only, markers only) to calibrate the weights before live data exists. If the exit criterion is not met at the end of the time box, stay at explicit invocation permanently, which is #858's fallback. |
| K7 | **Trigger phrases.** #858's example "wir drehen uns im Kreis" is already owned by do-run rethink (#859 § 1.1). #859 replaces it with a collision-free list. #862 adds the do-run Q4 option as the bridge from rethink's stuck phrases. | #858 ↔ #859 ↔ #862 | Adopt the **#859 § 1.1 list** as final. Keep rethink's phrases untouched. The bridge is the Q4 option (#862 § 6a), shown only when `isSkillEnabled`. Add trigger evals: each phrase routes on alpha and is silent on beta, and every auto-fix and do-run phrase stays with its owner. Risk to watch: "step back and analyse" / "tritt einen Schritt zurück" are common prose. If the evals show misroutes, drop them first. |
| K8 | **Open platform assumptions the guarantees rest on.** (a) Subagent PreToolUse payloads carry the parent's `session_id` (#859 Assumption 4): the docs confirm that hooks fire in subagents with `agent_id` / `agent_type` [D], but not the session id. (b) Whether hooks fire for tool calls of **workflow** agents is undocumented [D, no mention]. (c) Whether an agent's `tools` frontmatter is a hard boundary (#859 Assumption 3). (d) Skill `allowed-tools` does not restrict (#859 Assumption 2). | #859, #860, #862 | (a) and (c) are load-bearing for criterion 6. Verify both in a **throwaway e2e spike** via `evals/ab-run.js` (temp repo, `--cwd` pinned, installed devops disabled in `--settings`) **before** building the guard. (b) affects only O2: the Workflow tool stays denied in plan runs until it is verified (#862 § 4.3). (d) needs no test, because the guard exists precisely so that it does not matter. |
| K9 | **Guard lifetime vs plan-record lifetime.** #859 disarms the guard by approval, cancel or a 2 h TTL. #860 keeps it armed through phase B (resolving #859's open question), disarms only after a successful contract arm and re-arms on re-approval. But in *analysis only* #860 disarms the guard and keeps the plan record "until the guard's TTL", a TTL that no longer exists once the guard is disarmed. | #859 § 5 ↔ #860 § 1.3 | Two separate clocks in the state file: `guardArmedUntil` (2 h, renewed on re-arm) and `planRecordUntil` (2 h from the last `propose`, independent of the guard). *Analysis only* clears the first and keeps the second. A resumed session with the same id and an expired `guardArmedUntil` is unguarded and logs that. "Stale state of a dead session id is ignored" (#859) stays. |
| K10 | **The order of options in the suggestion question and the approval question.** #860's principle is "safe end state first, because every click-through takes the first option". #858's *suggestion* question puts "Analyse first (Frustrated Mode)" first, which makes a click-through start an analysis of about 250k–500k tokens. | #858 § 6 ↔ #860 § 2.4 | This is moot for stage 1, which shows no suggestion. For stage 2: keep the analysis first, since it is read-only and the reason to ask, but add a veto: **no suggestion while any click-through path is armed** (AFK lockout, autonomous start gate, a contract with `source: fallback`). Option 1 still goes through the budget question in tight classes (#858 § 6). |
| K11 | **Cost figures differ.** #858 § 8: 150k–400k tokens. #859 § 7: 250k–500k (lite 120k–250k). At Ultracode, `inherit` agents follow the session's effort (#862 § 7). | #858 ↔ #859 ↔ #862 | **#859's figure is the reference.** The skill shows it in the budget question before any spawn. Role models are pinned in the agent frontmatter (#859 § 2: R3 and S opus, the rest sonnet), not `inherit`, so Ultracode does not raise the analysis cost. |
| K12 | **Config key for the opt-out** `frustratedMode.suggest` is a placeholder that #858 left to #859/#861. Neither fixed it. | #858 § 6 ↔ #859/#861 | Fix the key `frustratedMode.suggest` (boolean, default `true`) in `devops-config.js`, read only from stage 2. On beta and stable the gate makes it irrelevant. |
| K13 | **The approval spec's "not an approval" list misses platform consents.** #862 I4 wants the workflow review dialog and Ultracode's standing opt-in added, but #860 cannot be edited after the fact. | #860 § 2.5 ↔ #862 I4 | Carry I4 into the `auto-frustrated` SKILL.md and the recorder's test fixtures (a Workflow review "Yes" or a `ultracode:` keyword prompt never yields `plan-approved`). The docs strengthen I4: in bypass-permissions mode the review dialog is **never shown**, and in auto mode it is shown only once (§ 7). |

## 4. What this spec does **not** change

The decisions the children already settled stand as written. That includes:
no automatic auto-fix → Frustrated hand-off (#859 § 1.2); detection inside one
session (#858 § 1); the canonical plan hash and its coverage (#860 § 2.2); Q2
ship authority staying in do-run (#860 § 4.1); and Workflow never being a step
type (#862 § 6c).

## 5. Open user decisions (consolidated, deduplicated)

Items one child raised and a later child resolved are left out: the #858
trigger list, the #858 auto-fix hand-off, the #859 disarm timing, the #859
do-run Q4 question and the #860 Workflow step-type question.

| # | Decision | Raised in | Recommended answer |
|---|----------|-----------|--------------------|
| U1 | Skill name while alpha | #859, #860 § 7, #861 | `auto-frustrated` (hidden); rename to `do-frustrated` at promotion (K1) |
| U2 | Shadow-log location and retention | #858 | `~/.claude/` per user, markers and scores only, no prompt text, capped at about 300 lines |
| U3 | Who labels stage-1 verdicts | #858 | The maintainer, offline, plus the replay calibration of K6. No in-chat labelling |
| U4 | Stage-1 time box and the outcome when it is missed | this spec (K6) | 8 weeks. If missed, stay at explicit invocation permanently |
| U5 | Reading earlier sessions | #859 | Only with an explicit `--session=<id>`, never automatically |
| U6 | Test runs during analysis | #859 | No in stage 1. A hypothesis becomes a `check` in the plan |
| U7 | Typed approval besides the question | #860 | Yes, whole-prompt token rule + hash echo (the Desktop can lose an open question) |
| U8 | Approval while another run's contract is live | #860 | Replace with `--replace`, announced in the question |
| U9 | Q2 (flow/ship) inside the approval question | #860 | No: separate, ship authority stays in do-run |
| U10 | Path-level hard gate on file `objects` | #860 | Defer; decide after the first alpha runs show whether strict drifts |
| U11 | do-run Q4: Frustrated ticked together with other passes | #862 | Frustrated wins; drop the other ticks and name them in one line |
| U12 | auto-fix hint in stage 1 as a shadow marker | #862 | Yes, logged only, no visible text |
| U13 | Negative hook-coverage e2e for workflow agents | #862 | Permanent "no Workflow in plan runs" until the platform documents coverage |
| U14 | Ultracode note in the report | #862 | No new field; R4 sees it as transcript metadata |
| U15 | Opt-out key and default | #858 (K12) | `frustratedMode.suggest`, default `true`, effective from stage 2 |
| U16 | Guard and plan-record TTLs | #859, #860 (K9) | 2 h each, as two separate clocks |

## 6. Recommendation: go, descoped

**Go** for the explicit-only core on alpha. **Descope** everything whose
value depends on a number that nobody has measured yet.

| In stage 1 | Deferred | Why deferred |
|------------|----------|--------------|
| `auto-frustrated` skill, roles, synthesis, report (#859) | automatic suggestion (#858 stage 2) | precision unmeasured (criterion 1); K6 base rate |
| read-only guard with an all-tool matcher (K3, K4) | auto-fix hint text (#862 § 6b) | it is a suggestion too, so it waits for stage 2 (logged as a shadow marker per U12) |
| plan record + `plan` contract mode + hand-off adapters (#860 G1–G10) | Workflow runtime inside `implement` (#862 O2) | blocked by K8 (b) |
| `Workflow` deny in plan runs (#862 I2) | path-level objects gate (U10) | needs alpha evidence |
| do-run Q4 entry (#862 § 6a) | — | — |
| detector in **shadow** mode + offline replay (K6) | stage-3 local-LLM tie-breaker | stage-2 gate first |

Why not **no-go**: the core gives the user what was asked for, an analysis
that stops the loop and implements nothing, without any of the unmeasured
parts. Criteria 2–5 and 7 are met by design. Criteria 6 and 8 close during
the stage-1 build. Why not **go in full**: shipping suggestions before the
shadow log exists would break the epic's own guard-rail ("automatic detection
only after a feasibility check").

**Stop conditions** while building: if the K8 spike shows that subagent
PreToolUse calls do **not** reach the session-keyed guard, criterion 6 cannot
be guaranteed for R2/R3 (Bash). Then drop `Bash` from all roles, so R2/R3
read git through a brief that the main thread pre-extracts, before going on.
Do not weaken the guarantee.

## 7. Verification of #862's `[P]` platform facts

Sources: [Dynamic workflows](https://code.claude.com/docs/en/workflows)
(official docs; read in full), [Hooks reference](https://code.claude.com/docs/en/hooks)
(first 100k chars), the
[launch post](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code),
and the German docs page (version note, via search snippet only). All were
fetched on 2026-10-25. The #862 file is left unedited, as instructed.

| #862 claim [P] | Outcome | Detail [D] |
|----------------|---------|------------|
| Workflow = self-contained script, `export const meta`, `agent()/parallel()/pipeline()/phase()` | **confirmed** | also `log()` and an `args` global; no `import()`, no direct FS/shell from the script; `Date.now()`/`Math.random()` throw |
| Named workflows from `.claude/workflows/`, with `args` | **confirmed, extended** | also `~/.claude/workflows/`, and **plugins can ship workflows** in a `workflows/` dir, namespaced `/<plugin>:<name>`. Not used here (O1), but O2 could one day ship a saved workflow instead of an ad-hoc script, which would make it hashable |
| Script persisted under the session dir; resume same session | **confirmed** | resume also after backgrounding or `claude --resume`; a failed agent reruns all later agents |
| Runs asynchronously in the background | **confirmed** | `/workflows` progress view; "No mid-run user input". So a workflow **can never host the approval question**, which supports rejecting O3/O4 |
| `remote_launched` / cloud execution | **not confirmed** by the page | the page only covers result persistence in cloud sessions. #862's "always deny `remote: true`" stays as a precaution |
| Not available to sub-agents | **not in the docs** | still [V] by the repo test `agent-definitions.test.js:36-37` only |
| Can be turned off (`workflowsEnabled`, `disableWorkflows`, policy) | **confirmed, corrected names** | `/config` "Dynamic workflows" toggle; `"disableWorkflows": true` in user **or** managed settings; `CLAUDE_CODE_DISABLE_WORKFLOWS=1`; admin settings page. `workflowsEnabled` is not a documented key. Minimum version v2.1.154 (from the search summary) |
| Cost warning | **confirmed, extended** | a `Large workflow` warning above 25 agents or 1.5 M projected tokens; the size guideline defaults to `medium` (< 10 agents); the warning is **suppressed under Ultracode** |
| "Review dynamic workflow before running" dialog | **confirmed, and weaker than assumed** | it depends on the mode: auto mode asks only on the first launch and **not at all with Ultracode on**; manual/accept-edits asks every run unless "don't ask again"; **bypass permissions never asks**; `-p`/SDK never asks. This strengthens K13: the dialog is no approval |
| Ultracode = an effort level "xhigh + dynamic workflow orchestration" | **corrected** | the docs call Ultracode a **setting** that turns on workflow orchestration "at whichever effort level the session runs at". Only `claude --effort ultracode` also sets `xhigh`. `/effort ultracode` / `/effort ultracode off`; the `ultracode` settings key makes it start in every session. The agent-card label `●●●●●● ultracode` is dotclaude's own mapping and stays harmless, but it is not a platform effort value |
| Session-scoped; requires workflows | **confirmed** | turning workflows off removes the Ultracode toggle; no managed setting turns off Ultracode alone. The German docs say v2.1.203+ (search snippet only) |
| Standing rule "author and run a workflow for every substantive task" | **behaviour confirmed**, wording not | the docs say Claude "plans a workflow for each substantive task". The system-prompt wording stays [P] |
| Ultracode keyword trigger | **confirmed, keyword now known** | the keyword is `ultracode` in a prompt **typed by the user**; it can be turned off in `/config`. It does **not** fire from `-p`, scheduled tasks, unstamped SDK prompts or relayed webhooks/PR comments. So dotclaude's machine prompts can't trigger a workflow this way, but a frustrated user typing "ultracode: fix it" in phase A/B can. I1/K3 covers that |
| Hooks inside workflow sub-agents: unknown [A] | **still unknown** | the hooks docs say PreToolUse/PostToolUse "fire the same configured hooks" inside **subagents**, with `agent_id`/`agent_type`, but never mention workflows. Workflow agents are described as subagents, so coverage is likely but undocumented. The O2 precondition e2e stays (K8) |
| `agent()` can pin a plugin agent type: unknown [A] | **partly answered** | the docs list "agent type" among the parameters of an agent's cache prefix, so a per-agent type exists. Whether its `tools` frontmatter is enforced is not stated. O3 stays rejected |
| (new) Workflow is hookable | **confirmed** | "return `allow` for the call from a PreToolUse hook" is a documented way to approve a launch, so a PreToolUse matcher sees the `Workflow` tool. Denying it the same way is the symmetric case (I1/I2/K3) |
| (new) Build drift | **noted** | #862 checked the installed CLI 2.1.270. #864 found the Desktop runtime at 2.1.304–2.1.310. The docs reference fixes up to v2.1.305, so the [P] strings came from an older build than the one the user runs |

**Net effect on #862:** its recommendation (O1 now, O2 later behind
preconditions, no step type, deny in phases A/B) **stands**. One fact is
corrected: Ultracode is a setting, not an effort tier. Two facts became
stronger arguments: the review dialog is absent in bypass and auto+Ultracode
modes, and a workflow takes no mid-run input. One question remains open: hook
coverage inside workflow agents.

## 8. Proposed implementation issues (not created)

The dependency order runs top to bottom. Issues on the same level can run in
parallel. Sizes: S ≤ 1 day, M 1–3 days, L > 3 days [A].

| # | Title | Scope | Depends on | Size |
|---|-------|-------|-----------|------|
| F1 | `spike(frustrated): verify subagent hook payload and agent tools boundary` | throwaway e2e via `evals/ab-run.js` (temp repo, pinned `--cwd`): does a subagent's PreToolUse carry the parent `session_id`, and is frontmatter `tools:` enforced? Optionally: do hooks fire in a workflow agent? The result goes into the guard issue (K8) | — | S |
| F2 | `feat(gate): register auto-frustrated and add a channel-gate CLI` | `GATED_SKILLS` entry; `node channel-gate.js skill <name>` (K5); README/counter generator skips gated skills; alpha-only tag for trigger evals (K2 c) | — | S |
| F3 | `feat(hooks): pre.frustrated.readonly mode guard` | all-tool matcher (K3); allowlist constant incl. harmless platform/plugin tools (K4), `AskUserQuestion`, git read allowlist, the exact `frustrated-plan.js` command, a Workflow deny with reason (I1); state file with the two clocks (K9); arm/disarm CLI; tests incl. "every tool a plugin hook can demand is allowed" | F1, F2 | M |
| F4 | `feat(agents): analyst and analyst-blind read-only agents + brief extractor` | two agent files with skill-free descriptions (K2 b); `READ_ONLY_AGENT_RE` entry; `scripts/frustrated-brief.js` (mechanical brief, #859 § 3.2) + tests | F1 | M |
| F5 | `feat(skill): auto-frustrated analysis skill (alpha)` | `SKILL.md` with the guard line (K2 a) + step 0 gate; `deep-knowledge/roles.md` (R1–R5, S, FINDINGS contract, § 4 rules); #859 § 1.1 triggers + evals (K7); budget question with #859's cost figure (K11); report + `analysis` card; the "not an approval" list incl. platform consents (K13) | F2, F3, F4 | L |
| F6 | `feat(run-contract): plan mode, plan record and approval recorder` | #860 G1–G4 + G10: `mode: "plan"`, validated `plan` header, `plan-approved`/`step` events, `scripts/frustrated-plan.js propose\|status\|discard`, the `Plan freigeben?` recorder + typed rule, drift rule, the three gates, CLI/status/card line; `Workflow` in the `pre.run.contract` matcher (I2) | F3 | L |
| F7 | `feat(handoff): --from=frustrated presets in do-run, auto-agents, auto-concept, do-learn, strict` | #860 G5–G9 (G11 needs nothing); verbatim payload pass-through; the concept implement click folded into v+1 | F6 | M |
| F8 | `feat(do-run): alpha-only "Erst analysieren" Q4 option` | #862 § 6a via the F2 CLI; exclusive semantics (U11); never shown on machine prompts | F5 | S |
| F9 | `feat(hooks): frustrated detector in shadow mode + offline replay` | #858 stage 1: record hooks (`PostToolUse(Failure)`, `Stop`), `UserPromptSubmit` verdict, shadow log (U2), the auto-fix shadow marker (U12), a dev-only replay script over local transcripts (K6); all gated, silent on beta/stable | F2 | M |
| F10 | `chore(frustrated): stage-1 review and stage-2 go/no-go` | after the U4 time box: review the shadow log and decide on stage 2 (suggestion, auto-fix hint text, K10 veto, K12 key) | F9 + 8 weeks | S |

Deliberately **not** an issue now: the O2 Workflow runtime (needs F1's
optional result plus #862 § 4.3), the path-level objects gate (U10), and the
promotion/rename (K1). Each gets its own issue once its precondition is met.

Critical path: F1 → F3 → F6 → F7 (plus F5 for a usable feature). F2, F4 and F9
can start right away.

## Assumptions

1. The child specs and the #861 code are merged to `main` as they stand on
   the integration branch before any of F1–F10 starts.
2. Issue sizes are rough estimates for one agent-assisted implementer.
3. An 8-week stage-1 time box is long enough to see whether the base rate
   (K6) can ever reach the exit criterion.
4. The docs pages fetched on 2026-10-25 describe the runtime the user
   actually runs (Desktop 2.1.30x, per #864).
5. Generic `analyst` agents visible on beta/stable do not break criterion 8,
   which is about the *skill*, as long as their descriptions do not name it.
6. The all-tool PreToolUse matcher (`*`) is supported by the hook system,
   and an early-exit hook on every tool call costs no more than the
   existing `post.flow.debug` pattern.

## Acceptance (for this spec)

- [x] Links the five child specs (#858–#862) with a summary each (§ 1), plus
  the related #864.
- [x] A table checks the epic's 8 success criteria against the child findings
  (§ 2): 5 met · 3 partly · 0 open.
- [x] Conflicts and gaps between the child specs, each with a proposed
  resolution (§ 3, K1–K13).
- [x] Consolidated open user decisions with a recommended answer each (§ 5).
- [x] A recommendation, go descoped (§ 6), and a proposed issue split with
  dependencies and sizes (§ 8). No issues created.
- [x] #862's `[P]` facts checked against official docs (§ 7); the #862 file
  is not edited.
- [x] No code change; this file only.
