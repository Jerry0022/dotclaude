# Frustrated Mode — trigger and frustration detection

Date: 2026-10-25 · Status: design (no implementation) · Issue: #858 ·
Epic: #857 · First child of the epic; #859–#862 cite the triggers defined
here.

## Why

The epic (#857) wants an optional analysis mode for the moment a user and
Claude are stuck in a loop of failed corrections: instead of a fifth attempt
at the same fix, Claude stops, analyses intent, history and causes, and
proposes a plan. Before anything can *offer* that mode on its own, we need
to know whether a dead end can be told apart from normal iteration at all,
with what signals, at what cost per false alarm, and how a user switches it
off.

This spec answers that and nothing else. The analysis skill itself (#859),
approval and hand-off (#860), Alpha-only visibility (#861) and the
Ultracode / workflow integration (#862) are out of scope and only referenced.

**Verdict in one line:** feasible, but only as a staged rollout. Stage 1 is
explicit invocation plus a silent shadow detector. An automatic suggestion
comes in only after the shadow log shows it is precise enough, and even then
it is capped at one per session.

## Method and evidence levels

Every claim below is one of:

- **[V]** verified in this repo, with `path:line`;
- **[A]** an assumption (harness behaviour that no file here proves,
  thresholds that still need calibration, user-behaviour guesses). The
  assumptions are collected again in § Assumptions.

Autonomous directive: this spec was written without asking the user.
Every decision a user might want to make is logged as an assumption or as an
open question.

## 1. What a hook can actually see

The detector can only use what the hook events deliver. Inventory:

| Event | Payload fields used today | Can reach the model by | Evidence |
|-------|---------------------------|------------------------|----------|
| `UserPromptSubmit` | `prompt` (fallbacks `user_message`, `message`), `transcript_path`, `session_id` | plain stdout is injected as context | [V] `plugins/devops/hooks/user-prompt-submit/prompt.skill.enforce.js:465`, `:298`; `plugins/devops/CONVENTIONS.md:87-88` |
| `PostToolUse` | `tool_name`, `tool_input` (`command`, `file_path`, …), `tool_response`, `agent_id`, `session_id`, `transcript_path` | only `hookSpecificOutput.additionalContext`; plain stdout never reaches the model | [V] `plugins/devops/hooks/post-tool-use/post.flow.debug.js:13-20`, `:88`, `:150`, `:170-176`; `post.design.remind.js:90`; `CONVENTIONS.md:89-92` |
| `PostToolUseFailure` | as above plus `error` (`Exit code N…`), `is_interrupt` | as `PostToolUse` | [V] `post.flow.debug.js:13-20`, `:89-95`; registered at `plugins/devops/hooks/hooks.json:237` |
| `Stop` | `transcript_path`, `stop_hook_active`, `session_id` | `decision` JSON (can block the stop) | [V] `plugins/devops/hooks/stop/stop.flow.guard.js:190`, `:204`; `CONVENTIONS.md:87-88` |
| `SubagentStop` | (not needed here) | — | registered at `hooks.json:125` |

What follows from that:

- **The user's own words are visible at exactly one point:**
  `UserPromptSubmit`, before the model acts. That is the only sensible
  decision point for a suggestion. [V] above.
- **Not every prompt is from the user.** Cron ticks, task notifications,
  channel messages, scheduled tasks and autonomous resumes arrive through
  `UserPromptSubmit` too. `isNonUserPrompt()` already sorts them out.
  [V] `plugins/devops/hooks/lib/non-user-prompt.js:1-29`,
  `plugins/devops/hooks/user-prompt-submit/prompt.flow.silent-turn.js:54-73`.
  Task-chip prompts look like typed prompts and count as the user's.
  [V] `non-user-prompt.js:10-15`.
- **History comes only from the transcript tail.** Hooks read the JSONL
  transcript from `transcript_path` up to a byte budget: 200 KB / 1 MB in
  card-guard, 4 MB in prompt.skill.enforce. [V]
  `plugins/devops/hooks/lib/card-guard.js:1088`, `:1098`, `:1109-1123`;
  `prompt.skill.enforce.js:97`. Earlier prompts are the `user` entries that
  are not `isMeta` and not pure `tool_result`. [V]
  `plugins/devops/hooks/lib/skill-invocations.js:60-66`. Edits per turn can
  be counted from `tool_use` blocks. [V] `card-guard.js:306-322`.
- **Compaction and copied history make the transcript unreliable as a
  counter.** Compaction summaries appear as `user` entries, and copied
  history segments repeat old turns. [A, from earlier transcript-replay
  work; no file here proves the exact shape.] So the detector keeps its own
  per-session state file, the way `post.flow.debug` keeps its counter in
  `os.tmpdir()`. [V] `post.flow.debug.js:150-151`;
  `plugins/devops/hooks/lib/session-id.js:36-38`. It does not rebuild the
  counts from the transcript on every prompt.
- **Subagents are separable.** `agent_id` is present in tool hooks, so
  subagent tool activity can be kept out of the main thread's evidence.
  [V] `post.flow.debug.js:27-29`, `:150`.
- **Invisible to every hook** [A]: the Desktop/CLI *rewind/checkpoint
  restore* (no hook event for it is registered in `hooks.json`, and none is
  known to exist); edits the user makes in an editor outside Claude (only
  inferable later from `git status`/diffs); tone of voice, pauses and the
  user giving up silently.
- **Visible on disk, but out of scope for stage 1: earlier sessions.** Other
  sessions' transcripts live under `~/.claude/projects/<slug>/`. [V, path
  layout documented at `plugins/devops/hooks/lib/stale-titles.js:9-12`]
  Reading them for frustration signals is a privacy and cost step the
  epic does not ask for. Detection stays **within one session**. A loop
  that the user "escapes" by opening a new session is a known miss
  (§ 5.2).

## 2. Observable triggers

"Target" means the thing being corrected. Its key, in order of reliability:

1. explicit references in the prompt: a file name or path, an issue `#N`,
   a quoted error line, a component name;
2. the set of files edited in the turn before (`Edit`/`Write`
   `tool_input.file_path`);
3. a normalized error signature: the first error line, with paths, numbers
   and hashes stripped.

Two turns hit the **same target** if they share an explicit reference, if
their edited-file sets overlap with Jaccard ≥ 0.5, or if they show the same
error signature. [A, threshold to calibrate]

| # | Trigger | Source | Hook that sees it | Strength |
|---|---------|--------|-------------------|----------|
| T1 | **Explicit correction or dissatisfaction**: "still", "again not", "that's wrong", "not what I asked", "I already said", "immer noch", "schon wieder", "das ist falsch", "nicht das, was ich wollte", "hab ich doch gesagt" | prompt text | `UserPromptSubmit` (`prompt`) [V] | strong if the phrase refers to the previous result, weak otherwise |
| T2 | **Negated completion claim**: the previous turn ended with a "done/fixed" card or claim, and the next user prompt says it isn't | transcript (last card) + prompt | `UserPromptSubmit` via `transcript_path`; card detection exists [V] `card-guard.js:214-246`, `cardDelivered` | strong |
| T3 | **Same target, consecutive rounds**: the N-th user prompt in a row on the same target, without that target being accepted in between | prompt refs + per-session state from `PostToolUse` (`file_path`) | `UserPromptSubmit` (decides) + `PostToolUse` (records edits) [V] | base counter, not a signal on its own |
| T4 | **Reverting an earlier result**: an `Edit` whose `new_string` restores an earlier `old_string` on the same file; Bash `git checkout -- <f>`, `git restore`, `git revert`, `git reset --hard`; or the user asking for it ("undo", "revert", "mach das rückgängig", "wie vorher") | `tool_input` / prompt | `PostToolUse` (`tool_input.command`, `old_string`/`new_string`) [V for `command` and `file_path`; `old_string`/`new_string` are the Edit tool's input fields, A that they are always present in the payload] | strong |
| T5 | **Unchanged failure across turns**: the same error signature (test, build, runtime) after a turn that claimed to fix it | `PostToolUseFailure.error`, `tool_response` stdout/stderr | `PostToolUse(Failure)` [V] `post.flow.debug.js:89-108` | strong |
| T6 | **The user interrupts a turn** (Esc) on the same target | `is_interrupt` on the failure event [V] `post.flow.debug.js:90`; an interrupt marker in the transcript [A] | `PostToolUseFailure` / transcript | weak (also used to redirect, not only out of frustration) |
| T7 | **Repeated auto-fix without convergence**: `auto-fix` ran on the same target in two or more turns and the target came back | transcript skill calls [V] `skill-invocations.js` (`skillInvokedThisTurn`, used at `post.flow.debug.js:111-123`) + T3 | `UserPromptSubmit` | strong |
| T8 | **Prompt shape**: very short, all caps, multiple "!", swearing, a lone "??" or "nein" | prompt text | `UserPromptSubmit` [V] | weak; never enough on its own |
| T9 | **Restated requirement**: high token overlap with an earlier prompt in the session (the user repeats their original ask) | prompt + earlier prompt entries | `UserPromptSubmit` via transcript [V for access, A for the metric] | medium |

Preprocessing rule for T1/T8/T9: strip code blocks, quoted text,
stack traces and pasted logs before matching. Pasted logs are full of
"error", "failed", "still". The same lesson is already applied to issue
references. [V] `non-user-prompt.js:13-15`.

## 3. Counter-indicators

A counter-indicator either resets the target's counter or vetoes a
suggestion in this turn.

| # | Counter-indicator | Source | Effect |
|---|-------------------|--------|--------|
| C1 | **Positive acknowledgment** of the last result ("good", "works", "passt", "perfekt", "danke", "ok, next") | prompt | reset the target to 0 |
| C2 | **Additive / new scope** ("and now also", "next", "jetzt noch", "außerdem") or a different target | prompt + target key | new target; old target closed as accepted |
| C3 | **Progress**: the error signature changes between rounds, or the failing test count drops | `PostToolUse(Failure)` | that round does not count (debugging that moves is not a dead end) |
| C4 | **An iterative skill is active**: `auto-concept` (variant overview), `auto-polish`, design tuning ("a bit larger", "more spacing"). Iteration is the point there. | transcript skill calls [V] `skill-invocations.js` | weak T1 phrases are ignored; only T2/T4/T5 count |
| C5 | **Not the user's prompt** (machine / cron / notification / scheduled) | [V] `non-user-prompt.js:24-27` | detector skipped |
| C6 | **Subagent context** (`agent_id` set) | [V] `post.flow.debug.js:150` | evidence is not attributed to the main thread; no suggestion from a subagent |
| C7 | **Autonomous run** (`do-run`, `AUTONOMOUS_*` / `BURN_RESUME:` prompts): nobody is there to be frustrated | [V] `plugins/devops/hooks/user-prompt-submit/prompt.burn.resume.js:46`; `prompt.batch.collect.js:20` | detector skipped |
| C8 | **The user brings new information** (a screenshot, a new log, a clarified requirement) | prompt length/attachments | that round counts half: it is cooperative debugging, though it can still be a loop |
| C9 | **Walking through a list** ("no, the next one", reviewing findings one by one) | prompt + changing target | no same target, so T3 never builds up |
| C10 | **Too early**: fewer than 3 user prompts in the session, or the target is younger than 2 rounds | state | no suggestion |
| C11 | **Already handled**: Frustrated Mode ran, or was declined, on this target | state | cooldown (§ 6) |

## 4. Decision logic and thresholds

### 4.1 Where it runs

- **`PostToolUse` / `PostToolUseFailure` (record only, no output).** These
  append the edited files, error signatures, revert events and interrupts of
  the main thread to the session state file. Pure Node, no model. Budget: a
  few milliseconds, like `post.flow.debug`.
- **`Stop` (record only).** Notes whether the turn ended with a completion
  claim (a card), so that T2 has something to negate.
- **`UserPromptSubmit` (decide).** Classifies the new prompt (target, T1,
  T8, T9, C1, C2, C8). Updates the target's round counter and score. Decides
  between `silent`, `shadow` and `suggest`.

No model call, and no local-LLM classifier, in the detector for stage 1–2.
A detector that spends tokens to find out whether to spend tokens defeats
the cost goal. A local-LLM sentiment pass (the repo has a `local-llm`
plugin) is a possible stage-3 refinement. [A]

### 4.2 Score per target

For each round (one user prompt on the same target, after C-filtering):

| Evidence in this round | Points |
|------------------------|--------|
| T2 negated completion claim | +3 |
| T4 revert (by Claude or asked for by the user) | +2 |
| T5 unchanged failure signature | +2 |
| T7 auto-fix ran on this target before and it came back | +2 |
| T1 strong correction phrase | +2 |
| T9 restated requirement | +1 |
| T1 weak phrase, T6 interrupt, T8 prompt shape | +1 each, at most +1 total |
| C3 progress | round does not count, score −1 |
| C8 new information | round counts ½ |
| C1 acknowledgment / C2 new target | reset |

### 4.3 Thresholds

```
rounds(target) >= 3  AND  score(target) >= 6  AND  no veto (C4 strict, C5–C7, C10, C11)
    -> suggest            (stage 2 and later; in stage 1 only logged)
rounds(target) >= 3  AND  3 <= score < 6
    -> shadow             (logged, never shown)
otherwise
    -> silent
Explicit invocation (§ 7) ignores every threshold.
```

**Why three rounds, not two.** Two rounds are normal iteration: you ask, it
is almost right, you correct it, it fits. The repo already responds at two
in two other places. `post.flow.debug` mandates auto-fix after 2
consecutive shell failures. [V] `post.flow.debug.js:46`, `:164-176`. The
Escalation rule goes one agent tier up when "same area iterated 2+ times
without converging". [V]
`plugins/devops/deep-knowledge/agent-proactivity.md:50-51`. Frustrated Mode
is a heavier step, a mode switch with several sub-agents, so it has to sit
*behind* those cheaper reactions. Round 3 is the first point where both of
them have already had their chance.

**Why a score of 6.** At three rounds, 6 points need either two strong
signals, e.g. a negated claim (+3) plus an unchanged failure (+2) plus any
weak one, or one strong signal in every round. Three rounds of "a bit more
padding" score at most 3, so design iteration with only weak phrases can't
get there. That is the most common false alarm we expect (§ 5.1). The exact
weights are a starting point. The shadow log (§ 8) is there to recalibrate
them. [A]

**Uncertainty is biased towards silence.** Missing a dead end costs one more
round, and the user can still invoke the mode by hand. A false suggestion
interrupts someone who is already irritated, which is the worst moment for
noise. So the band between 3 and 6 never shows anything.

## 5. Failure modes

### 5.1 False alarms (expected, with mitigation)

| Scenario | Why it looks like a loop | Mitigation |
|----------|--------------------------|------------|
| UI polish ("bigger", "less", "again a bit") | same file, many rounds | C4; weak phrases are capped at +1; T2/T4/T5 needed |
| Long debugging where every round moves | same target, many rounds | C3 (changing signature means progress) |
| Pasted logs full of "error/failed/still" | T1/T8 keywords | strip code/quotes/logs first (§ 2) |
| "Nochmal" meaning "do the same for file B" | T1 keyword | target key differs (C2) |
| Reviewing a findings list ("no, next") | negation words | target changes every round (C9) |
| Terse users who always write "nein, X" | T8 | T8 is capped and never enough on its own |
| Joking or sarcasm | T1 | requires rounds ≥ 3 and T2/T4/T5 evidence |
| Several sessions in parallel worktrees | shared temp state | state keyed per `session_id` (+ `agent_id`) like `post.flow.debug` [V] `:150` |

### 5.2 Misses (accepted)

- The user gives up silently or opens a new session (cross-session is out of
  scope, § 1).
- Polite users who never negate. T2/T4/T5 still catch some of them.
- Loops spread over targets that the key can't connect (two files, one
  concept). These are left to explicit invocation.
- A rewind/checkpoint restore that hooks don't see (§ 1).

## 6. Suggestion, decline and suppression

**Form of the suggestion (stage 2+).** `UserPromptSubmit` injects a short
instruction. Before it starts another attempt, the model asks **one**
`AskUserQuestion`, localized per `[ui-locale]`, with three options, the
first being the default:

1. *Analyse first (Frustrated Mode)*: start the analysis skill (#859). It
   researches and proposes, and nothing gets implemented without approval
   (#860).
2. *Keep going as before*: decline for this target.
3. *Don't suggest this again in this session*: session snooze.

The question uses the existing UI primitive, and its answer is machine
readable. Answers to `AskUserQuestion` are already captured by
`post.ask.answers`. [V] registered at `hooks.json:191-196`. A plain sentence
in the reply would be cheaper but cannot be declined in a machine-readable
way. [A, decided here]

**Suppression rules** (all in the per-session state file):

| Rule | Value | Reason |
|------|-------|--------|
| Session snooze | option 3, or the prompt "stop suggesting / nicht mehr vorschlagen": no automatic suggestion for the rest of the session | the user's explicit no wins |
| Per-target cooldown | after a decline: the same target needs **3 more rounds and +6 more score** before it can be suggested again | a decline means "I still believe in this path"; asking again on the next prompt would be nagging |
| After the mode ran | the target is closed for automatic suggestions; a new target starts at 0 | the analysis already happened |
| Session cap | **1** automatic suggestion per session in stage 2, at most 2 in stage 3 | a cap bounds the worst case regardless of weight errors |
| Persistent opt-out | a `devops` config switch (e.g. `frustratedMode.suggest: false` via the existing `hooks/lib/devops-config.js`) | users who never want it [A, key name to be fixed in #861/#859] |
| Budget class | in `ask-before-parallel` / `sonnet-only` the suggestion still shows, but option 1 goes through the existing budget question | [V] `agent-proactivity.md:56-74`; no parallel spending path of its own |
| Visibility | the detector is a no-op unless the channel gate of #861 allows it | Alpha-only visibility is #861's scope, only referenced here |

## 7. Explicit invocation vs automatic suggestion

| | Explicit invocation | Automatic suggestion |
|---|---|---|
| False-alarm cost | none: the user decided | one interruption per false alarm, plus a wrongly started analysis if the user just clicks the default |
| Precision needed | none | high (§ 4.3); not yet measured |
| Discoverability | low: a frustrated user doesn't remember a skill name | high: comes when needed |
| Implementation | a skill plus trigger phrases; the router already turns unambiguous multi-word phrases into a mandatory skill load [V] `plugins/devops/hooks/lib/skill-trigger-router.js:1-40` | detector (3 hooks + state) + suggestion + suppression |
| Risk | phrase collisions with `auto-fix`, whose triggers "doesn't work", "this is broken", "funktioniert nicht" are routed and not denylisted [V] `plugins/devops/skills/auto-fix/SKILL.md:7-8`, `:15-17`; `skill-trigger-router.js:139-151` | interrupting at the worst moment; teaching users to click "no" |
| Gate dependency | #861 (visibility) | #861 plus shadow-log evidence |

Explicit trigger phrases must be **distinct from auto-fix**: about the
approach, not the symptom. Examples: "we're going in circles", "wir drehen
uns im Kreis", "step back and analyse", "analysier erstmal, warum das nicht
klappt", plus the slash name. Single words ("again", "nochmal",
"frustrated") are never triggers. [A, final list in #859]

**Recommendation: staged rollout.**

| Stage | What runs | Exit criterion to the next stage |
|-------|-----------|-----------------------------------|
| **1 — explicit + shadow** | Skill invocable only explicitly (Alpha per #861). Detector runs in **shadow mode**: it computes `shadow`/`suggest` verdicts and appends them to a local log (verdict, target key, score breakdown, no prompt text beyond the matched markers), and shows nothing. | ≥ 20 `suggest` verdicts reviewed by the maintainer, ≥ 70 % judged "yes, that was a dead end", and every false one explained by a fixable weight [A] |
| **2 — opt-in suggestion** | Alpha only, `suggest` verdicts shown, cap 1/session, snooze/cooldown live. Declines and accepts are logged. | decline rate < 50 % over ≥ 15 suggestions; no "stop suggesting" in more than 1 of 5 sessions in which a suggestion was shown [A] |
| **3 — tuned** | cap 2, optional local-LLM tie-breaker for the shadow band | — |

If stage 1 never reaches its exit criterion, the recommendation is to stop at
explicit invocation. That is still worth having on its own.

## 8. Cost model

| Item | Cost | Basis |
|------|------|-------|
| Detector per prompt / tool call | 0 model tokens; a few ms of Node; one ≤ 1 MB transcript tail read per prompt | same pattern as `post.flow.debug` [V] `:47`, `:111-123` |
| Shadow mode | 0 tokens; one log line per non-silent verdict | — |
| Shown suggestion, declined | ~150–300 tokens (injected instruction + question + answer) and one user click | [A] |
| Shown suggestion, accepted but unnecessary | one full analysis: several sub-agents researching independently (#859). Estimated 3 agents × 15–30 tool calls, about 150k–400k tokens, plus 3–10 minutes of the user's time | [A]; refined in #859 |
| Missed dead end | each extra round is a full implementation turn. Unstructured retry loops have run 37–137 tool calls on real bugs | [V] `post.flow.debug.js:9-11`, `:131-132` |

So the real price of a false alarm is not the question but an analysis that
starts by accident. Three things guard against that: the 6-point threshold,
the session cap, and option 1 still passing through the budget question in
the tighter budget classes. A declined false alarm costs less than one
redundant tool call, so the cap matters more than the question itself.

## 9. Delimitation from existing mechanisms (baseline)

| | `post.flow.debug` | Escalation rule | Frustrated Mode (this spec) |
|---|---|---|---|
| Level | tool calls within a turn | the model's own judgement, prose rule | the user's prompts across turns |
| Signal | ≥ 2 consecutive shell exit codes ≥ 1, probes excused, reset on success [V] `post.flow.debug.js:45-55`, `:87-109`, `:153-167` | "same area iterated 2+ times without converging" [V] `agent-proactivity.md:50-51` | § 2 triggers, ≥ 3 rounds, score ≥ 6 |
| Sees the user's dissatisfaction | no (shell only) | implicitly, if the model notices | yes (prompt text, negated claims) |
| Reaction | **mandates** `auto-fix` (root cause of *a failure*) [V] `:125-138` | one agent tier **up** on the same approach | **offers** to stop executing and question intent and approach; implements nothing (epic #857) |
| Opt-out | none (mandatory) | delegation switch `off` [V] `agent-proactivity.md:45-49` | snooze / cooldown / cap / config (§ 6) |
| Scope | per session and agent [V] `:150` | per area | per session, main thread only |

Ordering rules, so the three don't fire on top of each other:

1. If `post.flow.debug` fires, or `auto-fix` runs, in this turn, Frustrated
   Mode stays silent for this turn. Auto-fix is the cheaper first answer.
   Its failure to converge across turns is evidence for later (T7).
2. Escalation comes first (round 2). If the target still hasn't converged
   after an escalation, that adds to round 3+. An `Agent` spawn on the same
   target can be seen in the transcript and can raise T3's confidence. [A]
3. Frustrated Mode never mandates anything. It is the only one of the three
   that the user can refuse.

## Assumptions

1. Compaction summaries and copied history can distort transcript-derived
   counts, so state is kept in a per-session file (§ 1). Not proven by a
   file here.
2. There is no hook event for rewind/checkpoint restore.
3. `Edit` payloads carry `old_string`/`new_string` reliably enough for T4.
4. A user interrupt leaves a marker in the transcript beyond `is_interrupt`
   on a running tool.
5. The weights (§ 4.2), thresholds (rounds ≥ 3, score ≥ 6, Jaccard ≥ 0.5)
   and stage exit criteria (§ 7) are starting values to calibrate on the
   shadow log, not measured facts.
6. The cost estimate for an accepted analysis (150k–400k tokens) depends on
   #859's agent design.
7. Detection stays inside one session. Cross-session history is excluded
   for privacy and cost.
8. Suggestion format = one `AskUserQuestion` with three options, not a plain
   sentence, because the decline has to be machine readable.
9. The config key name (`frustratedMode.suggest`) is a placeholder.

## Open questions

- **Shadow-log location and retention.** Should it be a per-user file under
  `~/.claude/` (survives sessions, needed for the stage-1 review) or
  temp-only? Proposed: `~/.claude/`, markers and scores only, no prompt
  text, capped at a few hundred lines. The user should confirm, because it
  is a new persistent artefact.
- **Who labels the stage-1 verdicts** ("was that a dead end?")? Proposed: the
  maintainer, by reviewing the log against the sessions. There is no
  in-chat labelling, because that would itself be the interruption we are
  trying to avoid.
- **Should `auto-fix` hand over to Frustrated Mode** when T7 fires (auto-fix
  ran twice on the same target without converging)? Then an auto-fix skill
  change would be needed. Belongs to #862 / #859.

## Acceptance (for this spec)

- [x] Observable triggers (§ 2) and counter-indicators (§ 3), each with its
  source and whether a hook can see it (§ 1).
- [x] Decision logic with thresholds, justified against false alarms (§ 4,
  § 5).
- [x] Behaviour under uncertainty and decline/suppression: snooze per
  session, cooldown per target, cap (§ 4.3, § 6).
- [x] Explicit invocation and automatic suggestion assessed separately, with
  a rollout recommendation (§ 7).
- [x] Baseline delimitation against `post.flow.debug` and the Escalation
  rule (§ 9).
- [x] No plugin change; this file only.
