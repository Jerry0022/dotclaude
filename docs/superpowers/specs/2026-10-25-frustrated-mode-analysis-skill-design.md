# Frustrated Mode — analysis skill with independent sub-agents

Date: 2026-10-25 · Status: design (no implementation) · Issue: #859 ·
Epic: #857 · Builds on the trigger spec of #858
(`docs/superpowers/specs/2026-10-25-frustrated-mode-trigger-detection-design.md`,
"the #858 spec" below). Approval and hand-off (#860), Alpha-only visibility
(#861) and the Ultracode / workflow integration (#862) are only referenced.

## Why

Once a user and Claude have gone round the same target three times, the
main thread is the worst place to work out why. It wrote every failed
attempt, its context is full of its own reasoning, and each new idea gets
anchored by the last one. `do-run rethink` already makes the same
observation about code. [V] `plugins/devops/skills/do-run/modes/rethink.md:20-24`.

This skill does one thing: it **finds out why repeated attempts miss the
goal and proposes a plan with reasons. It never implements anything.** It
does this through several sub-agents that each see a deliberately different
slice of the evidence. A synthesis then keeps consensus, dissent and
unverified assumptions apart.

**Verdict in one line:** a new user-invoked door skill `do-frustrated` runs
five independent roles (four new role prompts on two new agent types, plus the
existing `rethinker` unchanged) and one blind synthesizer. Read-only is
enforced by two things: agent tool lists, and a mode-scoped PreToolUse guard
for Bash and writes. The result is a five-section report that ends with a
named plan type and no execution.

## Method and evidence levels

Same convention as the #858 spec:

- **[V]**: verified in this repo, with `path:line`;
- **[A]**: an assumption (harness behaviour no file here proves, estimates,
  naming). All of them are collected again in § Assumptions.

This spec was written under an autonomous directive, without asking the
user. Every choice a user might want to make is either logged as an
assumption or listed as an open question.

## 1. Shape of the skill

| Aspect | Decision |
|--------|----------|
| Name | `do-frustrated`, a `do-*` door: user-opened and in the slash menu [V convention `plugins/devops/CONVENTIONS.md:200-212`]. Slash form `/devops:do-frustrated`. [A, name] |
| Why not a `do-run` mode | `do-run rethink` ends by implementing on its own: "Two exits, no questions… Autonomous (the default)" [V] `rethink.md:9-18`, `:200-216`. Frustrated Mode must never do that (epic #857). Putting both behind one door would make a single mode flag the only thing between "analyse" and "implement". A separate skill keeps the read-only guarantee structural. |
| Layer | 1 (user door). It invokes no implementing skill itself. The hand-off goes through #860. |
| Arguments | `[target or complaint] [--session=<id>] [--lite]`. Everything is optional, and the target is derived when missing (§ 3.1). |
| Questions during the run | **None.** Missing information becomes an open decision in output section 5, the same rule as rethink [V] `rethink.md:16-18`, `:243-245`. The only interaction is the plan approval in #860. |
| Visibility | Alpha-only per #861. This spec makes no claim about how that gets enforced. |

### 1.1 Explicit trigger phrases (resolves the #858 open item)

The #858 spec left the final list to this issue. It requires that the
phrases be about the *approach*, not the symptom, and that single words
never count. [V] #858 spec § 7. Two collisions exist today:

- `auto-fix` routes "this is broken", "doesn't work", "funktioniert nicht",
  "warum geht das nicht". [V] `plugins/devops/skills/auto-fix/SKILL.md:7-8`,
  `:15-17`.
- `do-run` (rethink) already owns "festgefahren", "stuck", "unstuck", "wir
  drehen uns im Kreis", "neu denken", "das führt zu nichts". [V]
  `plugins/devops/skills/do-run/SKILL.md:23-25`. "festgefahren" and
  "unstuck" are even forced single-word triggers. [V]
  `plugins/devops/hooks/lib/skill-trigger-router.js:156-158`. The #858 spec's
  example "wir drehen uns im Kreis" is therefore **already taken**.

The router turns any multi-word frontmatter phrase that is not on the
denylist into a mandatory skill load. [V] `skill-trigger-router.js:35-45`,
`:139`. So the list has to be unambiguous on its own merits:

| Lang | Phrases |
|------|---------|
| en | "frustrated mode", "step back and analyse", "step back and analyze", "stop and analyse first", "analyse why this keeps failing", "why does this keep failing" |
| de | "frustrated mode", "frustriert-modus", "tritt einen schritt zurück", "analysier erstmal, warum das nicht klappt", "analysiere erst, warum das nicht klappt", "erst analysieren, nicht umsetzen" |

Deliberately excluded:

- "immer noch nicht", "schon wieder" and "again": these are T1 detector
  signals in the #858 spec. As triggers they would bypass its staged
  rollout.
- "frustrated" or "frustriert" on its own: single words are never triggers.
- Every phrase owned by do-run or auto-fix. Re-pointing "wir drehen uns im
  Kreis" from rethink to here would change existing behaviour. Whether
  do-run should offer "analyse first (Frustrated Mode)" as a rethink
  alternative is **deferred to #862** (workflow integration).

### 1.2 auto-fix → Frustrated Mode hand-off (resolves the #858 open item)

**Decided: no automatic hand-off.** `auto-fix` is *mandated* by
`post.flow.debug` after two shell failures. [V] `auto-fix/SKILL.md:9-10`;
#858 spec § 9. If a mandated skill chained into a mode with several agents,
the user would lose the right to refuse that the #858 spec gives them (§ 9,
rule 3). It would also bypass the stage-1 shadow gate. Repeated auto-fix
without convergence already feeds the detector as T7. [V] #858 spec § 2.
**Deferred to #862:** a one-line *mention* in auto-fix's report ("this looks
like an intent mismatch rather than a bug, Frustrated Mode can analyse it")
when its root-cause analysis lands on a non-technical cause. That is an
auto-fix change and belongs to the integration issue.

## 2. Roles

Five independent roles. Each role is defined by **what it may see**, what it
may call, and what counts as evidence for it. Role prompts live in a new
`skills/do-frustrated/deep-knowledge/roles.md`, the same pattern as rethink's
`lenses.md`. [V] `rethink.md:94-96`;
`plugins/devops/skills/do-run/modes/rethink/deep-knowledge/lenses.md:83-88`.

| # | Role | Owns the question | Input slice | Agent type | Tool allowlist | Evidence rule |
|---|------|-------------------|-------------|-----------|----------------|---------------|
| R1 | **Intent** | What did the user actually want, and how would they recognise success? | The user's prompts of the session, **verbatim, inline in the prompt**, extracted mechanically (§ 3.2). No assistant turns, no tool output, no code. | new `devops:analyst-blind` | `WebSearch`, `WebFetch` (only to look up external references the user named, e.g. "like Linear's palette") | Every intent claim quotes a prompt (`P<n>` plus a ≤ 20-word quote). A paraphrase without a quote is an inference. |
| R2 | **History** | What was tried, in what order, what changed, what each attempt produced, and what was reverted? | The full session transcript (user, assistant, tool calls and results) plus git **read-only** for the session window | new `devops:analyst` | `Read`, `Grep`, `Glob`, `Bash` (git read allowlist, § 5) | Every attempt cites a transcript entry (`T:<line or uuid>`) and, where code changed, a commit sha or a `git diff` range. |
| R3 | **Technical cause** | Is there a technical root cause the attempts kept missing (wrong layer, stale build, environment, library behaviour, test that cannot fail)? | The evidence brief (target, files, verbatim error signatures) plus the repo and the web. **Not** the transcript: it judges the code without Claude's story of it. | `devops:analyst` | `Read`, `Grep`, `Glob`, `Bash` (git read allowlist), `WebSearch`, `WebFetch` | `path:line`, a sha, or a primary-source URL with its date, per `research.md` rules [V] `plugins/devops/agents/research.md:60-65`. No running of project code (§ 5). |
| R4 | **Workflow & product** | Did the process cause the loop: missing or ambiguous requirement, the wrong skill or agent for the job, no verification step, a fix verified in the wrong environment, scope drift, a product goal that conflicts with the ask? | Transcript **metadata** (skill calls, agent spawns, tool names, cards and claims, with tool output stripped), plus `CLAUDE.md`, project docs and the plugin's skill descriptions | `devops:analyst` | `Read`, `Grep`, `Glob` (no `Bash`, no web) | Cites a transcript entry or a doc `path:line`. Product judgements follow the po customer lens [V] `plugins/devops/agents/po.md:32-39`. |
| R5 | **Fresh alternative** | From the goal alone, what would a different approach or architecture look like? | A **code-free** cut of the brief: goal, success criteria, no-gos and the symptom in plain words. No paths, no code. | existing `devops:rethinker`, **unchanged** [V] `plugins/devops/agents/rethinker.md:14`, `:32-40` | `WebSearch`, `WebFetch` (its own frontmatter) | Its `RETHINK_APPROACH` block [V] `rethinker.md:56-59`. Inspiration has to be cited. Everything it says counts as a hypothesis. |

Plus one non-analysing role:

| | Role | Input | Agent type | Tools | Rule |
|---|------|-------|-----------|-------|------|
| S | **Synthesizer** | The five role outputs, the brief, and the sealed **loop hypothesis** (§ 3.3). Not the transcript. | `devops:analyst-blind` | `WebSearch`, `WebFetch` (for fact checks only) | Applies § 4 mechanically and may not drop a finding, only merge it. |

**Why these five.** The issue asks for four classes of cause: technical,
conceptual, product and workflow. It also asks for intent, history and
external information. R1 covers intent and the product goal, R2 history,
R3 technical causes plus external docs, R4 workflow and product fit, and
R5 conceptual alternatives, including a different architecture
(acceptance criterion 3). Fewer roles would merge slices and so weaken
independence. A sixth role, e.g. a separate "external research" one, would
duplicate R3's web leg.

**Lite variant** (`--lite`, or the budget class `ask-before-parallel` /
`sonnet-only` [V] `plugins/devops/deep-knowledge/agent-proactivity.md:56-74`):
R1, R2+R4 merged into one agent, and R3. No R5, and the synthesis happens in
the main thread under the same § 4 rules. Section 4 of the output then says
"alternatives not independently generated".

**Models** [A]: R3 and S on `opus`/high. R1, R2 and R4 on `sonnet`/medium,
because their work is mostly extraction. R5 keeps its own frontmatter.

## 3. Evidence brief and where independence ends

### 3.1 Intake (main thread)

The main thread derives the target the same way rethink does: the args,
then the area the conversation iterated on most, then the densest recent
`git log` churn. It names the derived target as an assumption. [V]
`rethink.md:35-41`. When the #858 detector state exists, its target key and
score breakdown are attached as well.

### 3.2 The brief: mechanical, not narrated

The main thread is the anchored party, so the brief carries **pointers and
raw extracts, never its own diagnosis**. An extraction script (new, e.g.
`scripts/frustrated-brief.js`) builds the brief from:

| Field | Source | Who gets it |
|-------|--------|-------------|
| target and scope boundary | intake | all |
| user prompts `P1..Pn`, verbatim; code blocks and pasted logs collapsed to `[log: N lines]` | transcript `user` entries that are not `isMeta` and not pure `tool_result` [V] `plugins/devops/hooks/lib/skill-invocations.js:60-66` (cited in #858 § 1) | R1 inline; R2 and R4 via the transcript |
| `transcript_path`, session window (first and last timestamp) | hook payload / session | R2, R4 |
| base commit at session start, `HEAD`, branch | git | R2, R3 |
| files edited in the session (`Edit`/`Write` `file_path`) | transcript `tool_use` blocks [V] `plugins/devops/hooks/lib/card-guard.js:306-322` | R2, R3 |
| error signatures, verbatim, deduplicated | transcript tool results | R3 |
| goal, success criteria and no-gos **as the user's own words** (quotes from `P*`) plus `CLAUDE.md` no-gos | prompts, docs | R5 (code-free cut), S |

Only the user's own words go into the brief. Claude's "what we tried" never
does: R2 reconstructs that from raw sources. That is the reason behind the
refinement decision that history roles read the transcript and git
themselves instead of getting a curated brief.

Compaction summaries and copied history segments can distort the
transcript. [A, carried over from #858 Assumption 1.] So R2 has to mark
every entry it suspects is a replay and must not count it as a separate
attempt.

**Sessions.** By default only the current session. An earlier session is
read only when the user passes `--session=<id>`. Its transcript is under
`~/.claude/projects/<slug>/`. [V layout, `plugins/devops/hooks/lib/stale-titles.js:9-12`].
That keeps the #858 privacy line (detection inside one session), and an
explicit invocation is what makes widening it acceptable. [A]

### 3.3 Independence matrix

| Source → / Role ↓ | user prompts | assistant turns | tool output | git | code | docs | web | other roles | loop hypothesis |
|---|---|---|---|---|---|---|---|---|---|
| R1 Intent | ✔ (inline) | — | — | — | — | — | ✔ | — | — |
| R2 History | ✔ | ✔ | ✔ | ✔ | diffs only | — | — | — | — |
| R3 Technical | quotes in brief | — | error signatures only | ✔ | ✔ | ✔ | ✔ | — | — |
| R4 Workflow | ✔ | metadata only | — | — | — | ✔ | — | — | — |
| R5 Fresh | goal quotes | — | — | — | — | — | ✔ | — | — |
| S Synthesis | via brief | — | — | — | — | — | fact checks | ✔ | ✔ (sealed) |

The **loop hypothesis** is one paragraph the main thread writes *before*
the fan-out: "what I believed the problem was during the failed attempts".
Only S sees it. S has to rate it explicitly as confirmed, refuted or open.
That turns the anchor into something the analysis tests instead of a hidden
bias in every role.

**Where independence ends.** These limits are stated in the report itself,
not hidden:

1. **One shared brief.** The target derivation and the extraction are a
   single point of failure. A wrong target misleads all five roles. Mitigation:
   the target is listed as an assumption in section 1 of the output.
2. **Shared raw sources.** R2 and R4 both read the transcript. R2 and R3
   both read git. Agreement between roles that share a source is **one**
   piece of evidence, not two (§ 4.2).
3. **One model family.** Every role runs on Claude, so its errors are
   correlated (the same blind spots, the same plausible-sounding guesses).
   Consensus is an *indication*, never proof, as the issue's quality
   principle demands.
4. **Enforcement differs by role.** Tool access is enforced hard by the agent
   `tools` list. That is the same mechanism rethink relies on for code
   blindness. [V] `rethink.md:107-109`. *Which files* R2–R4 read inside the
   repo is soft: it rests on the prompt. R1 and R5 have no file tools at all,
   so for them the slice is hard.
5. **Synthesis is a judgement.** S is fresh, with no transcript and no
   failed context, but it is one agent. The main thread may add a labelled
   "orchestrator note" under a finding. It may not edit or remove a finding.

## 4. Synthesis schema

### 4.1 Finding record

Every role returns `FINDINGS:` blocks, and S re-emits them merged:

```
FINDING:
  id: F7
  section: intent | cause | attempt | alternative | plan-input
  claim: <one sentence>
  kind: fact | inference | hypothesis
  cause_class: technical | conceptual | product | workflow   # section=cause only
  confidence: high | medium | low
  sources: [P3, T:412, git:a1b2c3d, file:src/x.ts:88, url:https://… (2026-09)]
  rests_on: [F2, F4]            # required for kind=inference
  check: <how to verify>        # required for kind=hypothesis
  raised_by: [R2, R3]
  status: consensus | single-source | dissent | unverified-assumption
  dissent: <counter-claim, by whom, with its sources>   # status=dissent only
```

### 4.2 Rules S applies

| Rule | Content |
|------|---------|
| Kind | **Fact**: a source a reader can open and check (quote, transcript line, sha, `path:line`, dated URL). **Inference**: derived from listed facts (`rests_on`). **Hypothesis**: plausible but untested, and it has to carry a `check`. |
| Confidence ceiling | A hypothesis is at most `medium`. An inference is at most the lowest confidence among its `rests_on`. A fact from a single source is at most `high` only if the source is primary. |
| Consensus | `consensus` needs ≥ 2 roles **with disjoint input slices** (§ 3.3). Two roles that share a source count once. Consensus can raise confidence by one step, never above the kind's ceiling. |
| Dissent | Contradicting claims are never averaged and never resolved by majority. Both sides stay, each with its sources. S may say which side has the stronger evidence and why, but the finding stays `dissent`. This deliberately departs from po's synthesis ("Weigh … do not average … decide" [V] `po.md:52-54`): here the decision belongs to the user at approval. |
| Unverified assumption | Anything the roles had to assume (brief assumptions included), plus every claim whose source could not be checked. Listed separately, never mixed into consensus. |
| Single-source | Kept and shown, but marked as such. |
| No drops | S merges duplicates and keeps the union of their sources. A finding no other role supports stays as `single-source`. It is not deleted. |
| Loop hypothesis | S gives an explicit verdict (`confirmed` / `refuted` / `open`) with the findings behind it. |
| Missing role | If a role died, S names it and the slice that went unexamined, as rethink does with dead agents. [V] `rethink.md:114-116`. |

The evidence rule ("every risk needs a `file:line` or an explicit plan-level
tag") is borrowed from redteam. [V] `plugins/devops/agents/redteam.md:97-98`.
"Mark load-bearing claims as surviving refutation or as contested" is
borrowed from research. [V] `research.md:54-56`.

## 5. Read-only guarantee

The acceptance criterion says "read-only by tool allowlist". Tool lists on
their own do **not** make Bash read-only: `scout` and `redteam` have `Bash`
and are read-only by instruction only. [V] `plugins/devops/agents/scout.md:14`,
`:24-25`; `redteam.md:14`, `:50-51`. Skill `allowed-tools` pre-approves tools
but is assumed not to *remove* any from the main thread. [A] So there are
three layers:

| Layer | Covers | Mechanism | Strength |
|-------|--------|-----------|----------|
| L1 agent `tools` | R1, R5, S: no file tools at all. R4: `Read`/`Grep`/`Glob` only. R2, R3: plus `Bash`. None of them has `Edit`, `Write`, `NotebookEdit`, `Agent`, `Skill`, or MCP write tools. | frontmatter `tools:` | hard [V pattern] `rethinker.md:14`, `rethink.md:107-109` |
| L2 mode guard | **every** tool call of the session while the mode is armed, main thread *and* subagents | new PreToolUse hook `pre.frustrated.readonly`, armed via a per-session state file in `os.tmpdir()` (the same pattern as `post.flow.debug` [V] `post.flow.debug.js:150-151`). Subagent calls carry `agent_id`/`agent_type` [V] `plugins/devops/hooks/pre-tool-use/pre.tokens.guard.js:240-253`, so the guard can apply per role. | hard, as long as hooks run |
| L3 skill rules | the main thread's own conduct | SKILL.md rules | soft |

**What L2 allows, everything else is denied with a reason:**

- `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `TodoWrite`;
- `Agent` spawns only of `analyst`, `analyst-blind`, `rethinker` (main
  thread only);
- the completion-card render, with the existing `analysis` variant [V
  variant named at `rethink.md:226`];
- `Bash` only when the whole command matches the git read allowlist:
  `git log`, `git show`, `git diff` (without `--output`), `git blame`,
  `git reflog` (without `expire`/`delete`), `git rev-parse`, `git ls-files`,
  `git grep`, `git branch --list`, `git merge-base`, `git cat-file -p`. No
  redirection (`>`, `>>`, `tee`), no `;`, `&&` or `|` into anything except
  `head`, `tail`, `wc` or `grep`. `git status` is **excluded** because it can
  rewrite the index stat cache. [A, behaviour of git]
- running project code (tests, builds, dev servers, `node`, `npm`) is
  **denied**. A hypothesis that only a test run could settle becomes a
  `check` in the plan. That way a test with side effects (snapshots,
  caches, DB fixtures) can't break the guarantee.

The extraction script (§ 3.2) runs once, before arming, and writes the brief
only into the session temp dir. The skill writes **nothing** into the
project tree, so there is no `.claude/frustrated/`, unlike rethink's
`.claude/rethink/` [V] `rethink.md:88`. The report lives in the chat and in
the temp dir.

**Disarm:** only by the #860 approval step, an explicit cancel, or a TTL
(e.g. 2 h). [A] A crash while armed means the next session start finds a
stale state file for a dead session id and ignores it.

**Follow-up for implementation:** add `analyst` and `analyst-blind` to
`READ_ONLY_AGENT_RE`, so the browser-test stop gate doesn't defer on them.
[V] `plugins/devops/hooks/stop/stop.flow.browsertest.js:51`.

## 6. Output: the report

The headings are fixed and follow the issue. Every claim refers to a
finding id.

1. **What you wanted.** The reconstructed intent and observable success
   criteria, from R1 with quotes. A conflicting reading stays visible side by
   side. The derived target is labelled as an assumption.
2. **Most likely causes.** Ranked by confidence. Each one has its cause
   class, kind, confidence, sources and status. The loop hypothesis verdict
   comes first.
3. **What was tried and why it probably didn't work.** R2's attempt
   timeline: attempt, then change, then result, then the cause finding it
   failed on. Reverts and repeats are marked.
4. **Alternative directions.** At least one alternative to the current
   approach, from R5, plus whatever R3 and R4 implied. Each comes with pros
   and cons, an effort class and its blast radius. **A different
   architecture is allowed and is explicitly asked for.** If none is viable,
   the report says why, with sources.
5. **Recommended plan.** The chosen direction and why it beats the runner-up,
   ordered steps, **open decisions** (each with the recommended option),
   risks, and the `check`s that should run first. Then the **plan type**:

| Plan type | Existing mechanism it would hand to (#860 decides how) |
|-----------|-------------------------------------------------------|
| implement | the do-run / `auto-agents` execution path [V] `do-run/SKILL.md:201-210` |
| concept | `auto-concept` [V] `plugins/devops/skills/auto-concept/SKILL.md:4-13` |
| do-learn | `do-learn` (explicit-only skill) [V] `plugins/devops/skills/do-learn/SKILL.md:7-13` |
| webguide | `auto-guide` [V] `plugins/devops/skills/auto-guide/SKILL.md:4-17` |
| mixed | an ordered list of the above, e.g. concept, then learn, then implement |

A plan may also be **analysis only**: the report itself was the deliverable
(epic #857 addendum). Below section 5 comes a compact **Synthesis ledger**:
counts of consensus, dissent, single-source and unverified, the list of
dissents and assumptions, and the independence limits from § 3.3 that apply
to this run.

## 7. Flow (main thread)

1. Intake and target (§ 3.1). Budget question per the budget class, before
   any spawn. [V] `agent-proactivity.md:56-74`.
2. Write the loop hypothesis (sealed). Run the extraction script. **Arm the
   guard.**
3. Fan out R1–R5 in **one message** (parallel). Naming per agent
   conventions: `[role:analyst · Analysis] <role> for <target>`.
4. Spawn S with the role outputs, the brief and the loop hypothesis.
5. Render the report (§ 6) and the `analysis` card. Stop. Approval and
   hand-off are #860's job.

Cost [A, refines #858 § 8]: R1 0–5 tool calls, R2 10–20, R3 15–30, R4 5–15,
R5 0–8, S 0–5. That comes to about **250k–500k tokens** and 4–10 min wall
time. Lite is about 120k–250k.

## 8. Reuse map

| Source | Reused | Deliberately different |
|--------|--------|------------------------|
| `do-run rethink` (`skills/do-run/modes/rethink.md`) | target derivation [V `:35-41`]; the brief as the only context of blind agents [V `:85-91`]; code blindness enforced by the tool set [V `:107-109`]; continuing with survivors when an agent dies [V `:114-116`]; the no-questions rule [V `:16-18`]; the assumptions list [V `:249-251`] | rethink *decides and implements* [V `:9-18`, `:200-216`], while this skill never does. Rethink ideates forward from the goal, this skill diagnoses backward from the failures. Rethink persists to `.claude/rethink/` [V `:88`], this skill writes nothing into the project. |
| `rethinker` agent (`agents/rethinker.md`) | **reused unchanged** as R5, with its `RETHINK_APPROACH` output [V `:56-59`] | it gets a code-free cut of *this* brief, not a Rethink Brief. All of its output counts as hypothesis. |
| `research` agent (`agents/research.md`) | source rules: primary sources, dates, no fabrication [V `:60-65`]; marking contested claims [V `:54-56`]; findings and sources format [V `:37-52`]. These apply to R3's web leg. | not spawned itself: its tools include `Bash` for the Codex wrapper [V `:11`, `:20-25`], which the L2 guard denies. A Codex leg is out of scope for stage 1. [A] |
| `po` agent (`agents/po.md`) | the customer lens as R4's product yardstick [V `:32-39`]; "facts … cite the source, or mark them unverified" [V `:83-84`]; `open_questions` with a recommended option [V `:86-87`] | po's synthesis decides and does not keep dissent [V `:52-54`]. Here S keeps it, and the user decides at approval. |
| `redteam` agent (`agents/redteam.md`) | the evidence rule "file/line or plan-level tag" [V `:97-98`]; the list of read-only git commands as the starting point for the L2 allowlist [V `:50-51`]; "challenge, don't rewrite" [V `:52`] | not part of the default run. A redteam pass on the *approved* plan, when it hits pre-mortem triggers, is the existing elaboration path at hand-off (#860), not an analysis role. |
| `scout` agent | — | not used: "locate, don't judge" [V `scout.md:19-20`] is the wrong mandate for diagnosis, and haiku is too weak for R2's judgement. [A] |

New artefacts (for the implementation issue, not created here):
`skills/do-frustrated/SKILL.md`, `…/deep-knowledge/roles.md` (role blocks,
the `FINDINGS` contract, the § 4 rules), `agents/analyst.md`,
`agents/analyst-blind.md`, `hooks/pre-tool-use/pre.frustrated.readonly.js`,
`scripts/frustrated-brief.js`, the router triggers from § 1.1 (no denylist
entries needed), plus the `READ_ONLY_AGENT_RE` entry (§ 5).

## Assumptions

1. Skill name `do-frustrated` and agent names `analyst` / `analyst-blind` are
   placeholders that fit the naming convention.
2. Skill `allowed-tools` grants but does not restrict the main thread's
   tools, which is why the L2 guard exists.
3. An agent's frontmatter `tools:` list is a hard boundary. The repo relies
   on this (rethinker), but no file here tests it.
4. Subagent PreToolUse payloads carry the parent's `session_id`, so one
   session-keyed guard covers all roles.
5. `git status` can write the index, so it is excluded from the allowlist.
6. Compaction and copied history can fake attempts in the transcript (from
   #858).
7. Reading an earlier session's transcript is acceptable when the user names
   it explicitly with `--session`.
8. The cost, tool-call and model figures in § 2 and § 7 are estimates.
9. Codex is not used in stage 1, because the wrapper needs a Bash call the
   guard would deny.
10. A 2 h TTL for the armed guard is a placeholder.

## Open questions

- **Name.** `do-frustrated` is honest but sounds negative in the slash menu.
  The alternatives are `do-stepback` and `do-diagnose`, but the second
  collides in meaning with auto-fix. Recommended: keep `do-frustrated` while
  it is Alpha-only, and revisit before Beta.
- **Should "wir drehen uns im Kreis" / "stuck" offer Frustrated Mode** next
  to rethink in do-run's Q4? Deferred to #862. The recommended answer is
  yes, as a non-default option.
- **Reading earlier sessions:** an explicit `--session` only (proposed), or
  also "the last session on this branch" automatically?
- **Should test runs ever be allowed**, for example in a throwaway worktree?
  Proposed: no in stage 1. A `check` in the plan covers it.
- **Disarm timing:** does the guard stay armed through the #860 approval
  question (proposed), or drop as soon as the report renders?

## Acceptance (for this spec)

- [x] Five independent roles, each with an input slice, a tool allowlist and
  an evidence rule (§ 2, § 3.3).
- [x] Synthesis schema with consensus / dissent / unverified assumptions and
  fact / inference / hypothesis, with confidence and sources per finding
  (§ 4).
- [x] Output covers the five sections and explicitly allows a different
  architecture (§ 6). Plan types are only named, and the hand-off is #860.
- [x] Standalone invocation (§ 1, § 1.1) and a read-only guarantee via the
  tool allowlist plus the mode guard (§ 5).
- [x] Reuse map against rethink, rethinker, research, po, redteam (§ 8).
- [x] Both open items from #858 resolved or explicitly deferred: the trigger
  phrase list (§ 1.1) and the auto-fix hand-off (§ 1.2).
- [x] No plugin change; this file only.
