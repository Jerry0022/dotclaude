# Frustrated Mode — explicit plan approval and hand-off to existing workflows

Date: 2026-10-25 · Status: design (no implementation) · Issue: #860 ·
Epic: #857 · Builds on the trigger spec of #858
(`docs/superpowers/specs/2026-10-25-frustrated-mode-trigger-detection-design.md`,
"the #858 spec") and the analysis-skill spec of #859
(`docs/superpowers/specs/2026-10-25-frustrated-mode-analysis-skill-design.md`,
"the #859 spec"). Alpha-only gating (#861) is taken as given:
`plugins/devops/deep-knowledge/channel-gating.md` and
`plugins/devops/hooks/lib/channel-gate.js`. Ultracode / workflow integration
(#862) points here for approval and hand-off.

## Why

The #859 spec ends with a report and a named plan type. Then it stops:
"Approval and hand-off are #860's job" [V] #859 spec `:358-359`. That is
where the epic's guarantee lives or dies. The epic says "Without explicit
plan approval nothing is implemented" (success criterion 6), and "the
confirmed hand-off uses the existing dotclaude workflows" (criterion 7).

dotclaude already has most of the parts:

- a contract that records what the user chose and refuses tool calls that
  walk past it [V] `plugins/devops/deep-knowledge/run-contract.md:1-3`, `:43-49`;
- a marker that blocks edits and commits until a plan is handed to
  `do-run` / `auto-concept` [V] `run-contract.md:84`,
  `plugins/devops/hooks/pre-tool-use/pre.run.contract.js:37-45`, `:189-196`;
- literal-scope enforcement [V] `plugins/devops/deep-knowledge/strict.md:72-106`;
- explicit approval moments in each downstream skill (`auto-concept`'s
  implement click, `auto-agents`' plan confirmation, `do-learn`'s "richtig?").

What is missing is a **plan identity**: something that says *which* plan was
approved, so that a later step can be checked against it. The refinement
decision fixes the answer: plan ID + hash in the run contract, because a chat
confirmation on its own is too weak (#860 § Decisions).

**Verdict in one line:** the analysis phase stays write-locked by the #859
guard **until** an explicit approval, an abort or "analysis only". Approval is
a structured answer bound to `plan <id> v<n> · <hash8>`, recorded into the run
contract as a new header field plus a new contract mode `plan` with one
obligation per plan step. Each step goes to the mechanism that already owns
it. The approved plan becomes strict mode's "request". Eleven small
extensions, no new pipeline.

## Method and evidence levels

Same convention as the #858 and #859 specs:

- **[V]**: verified in this repo, with `path:line` (paths under
  `plugins/devops/` unless stated otherwise; upstream specs by their `:line`);
- **[A]**: an assumption. All of them are collected again in § Assumptions.

Written under an autonomous directive, without asking the user. Every choice
a user might want to make is logged as an assumption or an open question.

## 1. Phase boundary

### 1.1 Three phases, one guard

| Phase | Starts | Ends | Writes allowed | Enforced by |
|-------|--------|------|----------------|-------------|
| **A · Analysis** | `#859 § 7` step 2: guard armed [V] #859 spec `:353-354` | report and approval question rendered | none in the project tree; the brief and the pending plan record in the session temp dir only | #859 L1 agent `tools` + L2 `pre.frustrated.readonly` [V] #859 spec `:273-277` |
| **B · Decision** | approval question shown | one of: *approve*, *change*, *alternative*, *analysis only*, *abort*, TTL | **none** (same guard, still armed) | same L2 guard |
| **C · Execution** | approval recorded into the run contract | every plan step done, skipped with reason, or the run aborted | only through the mechanism of the current step, under the run-contract gates and strict | run contract (`plan` mode, § 4) + strict (§ 5.6) |

**Resolves the #859 open question** "does the guard stay armed through the
#860 approval question, or drop as soon as the report renders?" [V] #859 spec
`:416-417`: **it stays armed through phase B.** Reasons:

1. Phase B is the most dangerous moment. The report has just named a
   concrete fix, and "let me just try that quickly" is exactly the reflex
   that produced the loop. A guard that drops on render would leave the main
   thread unguarded at the very moment it is most tempted.
2. Disarming on render would make the approval a soft rule (L3) again, which
   the #859 spec rejects for the analysis phase for the same reason [V]
   #859 spec `:266-277`.
3. The cost is small: an unrelated request typed during phase B is refused
   with a message that names the three ways out (approve, analysis only,
   abort). That is one click, not a lost session.

The guard **disarms only after the contract was armed successfully** (§ 3.4).
If arming fails, the guard stays armed and the user gets the failure. Losing
both the guard and the contract would leave nothing in charge, so this fails
closed.

### 1.2 The write block, precisely

During phases A and B the #859 L2 allowlist applies unchanged [V] #859 spec
`:279-296`. It has two additions:

| Addition | Why |
|----------|-----|
| `AskUserQuestion` | The approval question itself. The #859 allowlist does not list it [V] #859 spec `:281-286`, so as written the guard would refuse its own exit. |
| exactly `node "<PLUGIN_ROOT>/scripts/frustrated-plan.js" propose\|status\|discard …` | Computes the canonical hash and writes the pending plan record **into the session temp dir only** (§ 2.2). No other `node` call is allowed. The #859 rule "running project code is denied" [V] #859 spec `:293-296` still holds. |

Everything else stays denied with a reason: `Edit`, `Write`, `NotebookEdit`,
`Skill` (any, including the hand-off targets), `Agent` beyond the analysis
roles, write-capable MCP tools, and Bash outside the git read allowlist
(commit, push, deploy, `gh` writes, issue edits, package installs). That
covers every item on the issue's list: no file changes, no writing commands,
no commits, pushes or deploys, no other implementation.

### 1.3 Safe end states

| End state | User signal | What happens | What is left behind |
|-----------|-------------|--------------|---------------------|
| **Abort** | approval option "Abbrechen", or typed "abbrechen" / "cancel" / "stop" | pending plan record discarded, guard disarmed, no contract armed | nothing in the project tree (#859 writes nothing there [V] #859 spec `:298-302`); the report stays in the chat |
| **Analysis only** | option "Nur Analyse — nichts umsetzen" (first option, § 2.4) | guard disarmed, no contract armed; the pending plan record is **kept** in the temp dir until the guard's TTL | the report is the deliverable (epic addendum; #859 spec `:343-344`). Within the TTL the user may come back with "freigeben" and approve the *same* version (§ 2.5 drift rule applies). |
| **TTL expiry** | none (silence) | treated like *analysis only*. **Never** like approval. | same as analysis only, then the record is gone |
| **Crash / session end in A or B** | none | the next session ignores the stale state file of a dead session id [V] #859 spec `:304-306` | nothing; nothing was approved |

Abort and analysis-only both count as a **decline** for the #858
suppression logic (#858 spec § 6). The detector must not re-suggest the mode
for the same target right away. [A: the #858 suppression keys on the target,
so a decline here can feed it.]

Neither end state creates a commit, an issue, a learning or a file. If the
user wants the report saved (an issue, a doc, a learning), that is a **plan
step** that needs approval like any other (§ 4: `learn`, or an `implement`
step whose scope is "write the report to docs/…").

## 2. The approval record

### 2.1 Plan identity

| Field | Content | Changes when |
|-------|---------|--------------|
| `id` | `fm-<yyyymmdd>-<4 base36>`, one per analysis run | never within a run |
| `version` | `1, 2, …` | every change, alternative pick or re-approval |
| `hash` | `sha256` over the **canonical plan** (§ 2.2), full hex stored | every content change; it does not depend on `version` or timestamps |
| `short` | first 8 hex of `hash` | with `hash` |

Display form, used everywhere (§ 2.6): **`fm-20261025-k3q9 v2 · 3f9a1c2e`**.

The ID says *which run*, the version says *which revision*, and the hash
says *which exact content*. The version alone is not enough: two edits can
both claim "v2" (a compaction, a re-render after a crash). The hash alone is
not readable. Both together make the approved version unambiguous and
checkable by a hook.

### 2.2 Canonical plan (what the hash covers)

Built from report section 5 of the #859 spec [V] #859 spec `:331-341`:

```
PLAN (canonical JSON, keys sorted, strings NFC + whitespace-collapsed):
  id: fm-20261025-k3q9
  direction: <the chosen direction, one sentence>
  steps:                                   # ordered; order is content
    - n: 1
      type: implement | concept | learn | webguide
      goal: <one sentence, observable>
      objects: [<the closed set: files, components, symbols, sites, rule text>]
      payload: <type-specific, § 4>
  out_of_scope: [<things the report named and the plan excludes>]
  decisions: [{id: D1, chosen: <option>}]  # the open decisions, resolved
  checks: [<checks that run first>]
  base: {branch, sha}                      # HEAD at approval time
```

The hash does **not** cover version, timestamps, the rendered prose of the
report, or the evidence ledger. Rewording the explanation does not change
the plan. Changing a step, an object, a decision or the order does. "Mixed"
is not a stored type: a plan with steps of more than one type *is* mixed.

`scripts/frustrated-plan.js propose` (new, § 6 G2) reads this JSON from
stdin, normalises it, computes the hash, assigns the next version and writes
`<tmp>/dotclaude-frustrated-<session>/plan.v<n>.json`. Then it prints
`{id, version, hash, short}`. Hashing is mechanical, so the model never
types a hash by hand.

### 2.3 Size cap

The canonical plan is capped at 16 KB [A]. A plan that does not fit is too
big to approve as one unit. The skill must cut it into steps or name an
`out_of_scope`, not truncate it silently.

### 2.4 The approval question

One `AskUserQuestion`, rendered after the report and the `analysis` card.

```
header:   "Plan freigeben?"            # exact; the recorder matches on it
question: "Plan fm-20261025-k3q9 v2 · 3f9a1c2e — <direction>.
           <n> Schritte: 1 Konzept · 2 Umsetzen · 3 Learn. Was nun?"
options:
  1. "Nur Analyse — nichts umsetzen"   — Report behalten, nichts ändern.
  2. "Freigeben · v2 · 3f9a1c2e"        — Genau diesen Plan an die Workflows übergeben.
  3. "Ändern oder Alternative wählen"   — Plan anpassen; danach neue Version zur Freigabe.
  4. "Abbrechen"                        — Alles verwerfen.
  (Other: free text = change request)
```

Design decisions:

- **The safe end state is the first option, and nothing is marked
  "(Recommended)".** Every click-through path in dotclaude takes the first
  option: the AFK lockout "take the click-through answers (every first
  option)" [V] `skills/do-run/SKILL.md:71-74`, and the run contract's
  fallback arm with "click-through defaults" [V] `run-contract.md:15`. With
  this order, any default, lockout or fallback lands on *analysis only*,
  never on approval. The report has already recommended a plan. The question
  only asks for a decision.
- **The approve label carries `v<n> · <short>`.** The recorder (§ 3)
  compares the clicked label's short hash with the newest pending record. If
  they differ, it records no approval: the user clicked a stale question
  after a newer version was rendered.
- **"Other" is a change request**, never an approval. `post.ask.answers`
  already turns an empty "Other" into a follow-up question [V]
  `run-contract.md:88`.
- **"Ändern oder Alternative wählen"** asks one follow-up: which alternative
  from report section 4, or what to change. The result is a new
  `propose` (v+1) and the question again. The phase stays B and the guard
  stays armed.

### 2.5 Never from silence

Approval is recorded **only** from:

| Source | Condition | `approvedBy` |
|--------|-----------|--------------|
| the approval question | header `Plan freigeben?`, approve option clicked, short hash equals the newest pending version | `ask` |
| a typed prompt | the whole prompt is an approval token (`ja`, `go`, `freigeben`, `mach`, `yes`, `do it`, the same accept list as `auto-agents` [V] `skills/auto-agents/SKILL.md:237-239`), optionally followed by `v<n>` or the short hash; exactly one pending version exists; it has not been superseded | `typed` |
| `auto-concept`'s implement click inside a `concept` step | § 4.2 | `concept-implement` |

Explicitly **not** an approval:

- silence, TTL expiry, session end;
- the do-run bedtime autostart [V] `skills/do-run/SKILL.md:88`, the
  autonomous 3-minute start gate [V] `skills/do-run/modes/autonomous.md:332`,
  an `AUTONOMOUS_AUTOSTART:` / `RUN_BACKLOG_AUTOSTART:` machine prompt [V]
  `skills/do-run/SKILL.md:64-69`;
- the AFK lockout's click-through [V] `skills/do-run/SKILL.md:71-74`;
- a run-contract fallback arm (`source: fallback`) [V] `run-contract.md:15`;
- a chat message that *contains* "ja" inside a longer sentence, or a reply to
  some other question;
- the `analysis` card or any chip on it. A chip prompt is a typed prompt and
  goes through the typed rule above like any other.

**Drift rule.** Approval stores `base.sha`. If `HEAD` on the plan's branch
moved between rendering and approval (possible after *analysis only* and a
later "freigeben"), the recorder refuses. The skill re-proposes, which gives
a new version because `base` is part of the hash, and asks again. This is
the same idea as `auto-concept`'s reality check before implementing [V]
`skills/auto-concept/SKILL.md:245-263`, reduced to the cheapest form.

### 2.6 Where the approved version is shown

| Place | Shows | Why |
|-------|-------|-----|
| approval question label | `v<n> · <short>` | what the user clicks is what gets recorded |
| one line after recording | `Freigegeben: Plan fm-… v2 · 3f9a1c2e (3 Schritte)` | chat echo; not the record itself |
| run-contract header `plan` (§ 3.2) | full record | the record, which hooks read |
| `run-contract.js status` | `plan: fm-… v2 · 3f9a1c2e · step 2/3 implement` | inspectable at any time [V] CLI `run-contract.md:61-72` |
| completion card summary line | `Plan fm-… v2 · 3f9a1c2e · Schritt 2/3` | via `summaryForCard` [V] `hooks/lib/run-contract.js:66`, the existing card line of the contract |
| every hand-off's args | `--plan=fm-…@3f9a1c2e --step=<n>` | the receiving skill can check it, and it shows in the transcript |
| a superseding approval | `v3 · 9b04e7d1 ersetzt v2 · 3f9a1c2e` | it is always clear which version is current |

## 3. Recording into the run contract

### 3.1 What exists, and why it is close but not enough

- The contract is session-bound, expires, survives compaction, has a lock
  and quarantine, and a CLI with `skip` / `park` / `abort` / `done`, each of
  which needs a reason [V] `run-contract.md:19-21`, `:78`.
- `record()` accepts any event kind (`k` is only type-checked) [V]
  `hooks/lib/run-contract-store.js:913-914`. Compaction keeps every kind
  other than `block` / `measure` / `card` [V] `run-contract.md:21`.
- `sanitize()` copies unknown header fields through unchanged
  (`{ ...h }`) [V] `run-contract-store.js:495-496`, so a `plan` field would
  survive today, but **unvalidated**. The mode is forced into
  `prompt | backlog | audit` [V] `run-contract-store.js:508`.
- A contract exists only after do-run's router answered or a machine prompt
  armed one [V] `run-contract.md:59`. Frustrated Mode runs **before** any
  do-run, and three of its four plan types never touch do-run.
- In `prompt` mode, an Edit/Write on a gated path is refused while
  `auto-agents` is open [V] `run-contract.md:29`, `:45`. A `learn` step
  (which writes `CLAUDE.md` / skill files) under a `prompt`-mode contract
  would therefore be blocked as if it were an implementation.

So the plan cannot just ride on a `prompt` contract. It needs its own mode.

### 3.2 Header extension

```
{
  mode: "plan",                         # new (store :508)
  flow, ship, strict, passes, …         # unchanged; filled by do-run's Q2 merge (§ 4.1)
  plan: {
    id, version, hash, short,
    approvedAt, approvedBy: ask | typed | concept-implement,
    base: {branch, sha},
    steps: [{n, type, goal, objects, payload, state: open | done | skipped}],
    out_of_scope, decisions, checks,
    supersedes: <previous hash> | null
  }
}
```

`sanitize()` validates `plan`: required fields, `type` from the four
values, `hash` 64 hex, size cap. An invalid `plan` makes the header invalid
and the store quarantines it, as for any corrupt header [V]
`run-contract.md:21`. The plan is not silently dropped.

Events: `{k: "plan-approved", id, version, hash, by}` on every (re-)approval,
and `{k: "step", n, state}` on each step transition. Both survive compaction
under the existing rule.

### 3.3 Obligations of `plan` mode

| Obligation | Applies | Satisfied by |
|------------|---------|--------------|
| `step:<n>` for each step | always, in order | the step's mechanism ran with `--plan=<id>@<short> --step=<n>` **and** reached its end signal (§ 4 table, column "done when"); or `skip step:<n> --reason`, the existing skip semantics [V] `run-contract.md:39`, `:78` |
| inside an `implement` step | that step's segment | the existing `prompt` obligations unchanged: `auto-agents`, `harden`, `polish` (UI only), `qa`, `do-ship` (when `ship: auto`) [V] `run-contract.md:27-33` |

A `step` start event is a **segment boundary**. That way the implement
obligations are evaluated only on the implement step's own work, and a
`learn` step's edits never owe `auto-agents`. Today a segment ends at a
release, a park or a backlog item branch [V] `run-contract.md:25`. The
`plan`-mode boundary is the one addition.

### 3.4 Gates added in `plan` mode

The existing PreToolUse hook `pre.run.contract.js` refuses (exit 2, with a
message naming the fix):

1. **Out of order:** a `Skill` call to a hand-off mechanism whose step is
   not the lowest open one, unless the earlier steps are `skip`ped.
2. **Not in the plan:** a `Skill` call to a hand-off mechanism no open step
   names (for example `do-ship` in a plan that has only `learn` and
   `concept`). Message: "not in plan fm-… v2 · 3f9a1c2e: re-approve or
   abort".
3. **Stale plan reference:** a hand-off whose `--plan=<id>@<short>` does not
   match the header (a superseded version).
4. **Unchanged:** every existing `prompt`-mode gate inside an implement
   step, for example the release gate and the final-card gate [V]
   `run-contract.md:45-49`.

Disarm order on approval: `arm({mode:"plan", plan, …})` → read it back → write
`plan-approved` → **then** disarm the #859 guard. If an active contract from
*another* run exists, `arm` refuses without `--replace` [V]
`run-contract.md:80`. The approval question then says so in its description
("ersetzt laufenden Run <mode> seit <armedAt>"), and approval passes
`--replace`. The archived run is the failing loop the mode was opened for [A].

## 4. Hand-off matrix

Every hand-off is one `Skill(...)` call with args
`--from=frustrated --plan=<id>@<short> --step=<n>` plus the step's payload
**verbatim**. `auto-agents` already demands "the approved plan, verbatim …
never a paraphrase" [V] `skills/auto-agents/SKILL.md:54`. The same rule
applies to every target.

| Plan step type | Mechanism | Receives | Own approval moment, kept or replaced | Done when |
|----------------|-----------|----------|----------------------------------------|-----------|
| **implement** | `Skill("devops:do-run", "--from=frustrated --plan=… --step=n <payload>")` → router → `auto-agents` (the single execution path [V] `skills/do-run/SKILL.md:197-205`) → Step 7 passes and ship [V] `skills/do-run/SKILL.md:220-229` | goal, `objects` as the closed scope, the root-cause findings the step rests on (ids + one line each), `decisions`, `checks` to run **first**, `out_of_scope` | Q1 dropped (preset, like `--from=do-batch` [V] `do-run/SKILL.md:83`). Q3 dropped → Strikt (§ 5.6). Q4 dropped: no rethink and no burn, the plan is decided. **Q2 (flow and ship) is still asked**: ship authority lives in the router [V] `do-run/SKILL.md:263`, and plan approval is not ship approval. `auto-agents`' own confirmation is **skipped**, because the plan approval was the go (§ 6 G5). | the implement segment closes through the existing release / final-card rules |
| **concept** | `Skill("devops:auto-concept", "--from=frustrated --plan=… --step=n <payload>")` | the open question, the alternatives from report section 4 (with pros, cons, effort and blast radius), the evidence for and against each, the dissent findings verbatim, and the decisions the user still has to make | `iterate` never touches code [V] `skills/auto-concept/SKILL.md:238-240`. Its **implement click** is a new explicit approval (§ 4.2). | `finalize`, or an implement click recorded as a re-approval |
| **learn** | `Skill("devops:do-learn", "--from=frustrated --plan=… --step=n <rule text>")` | the rule text as approved (from a `workflow` / `conceptual` cause finding), the finding ids as evidence, a suggested target class | its "Learning: `<rule>` — richtig?" line [V] `skills/do-learn/SKILL.md:69-71` is skipped **only** when the text equals the approved text; its routing matrix still picks the file (an attribute, § 5.3); its per-match deletion confirmations and conflict display stay [V] `do-learn/SKILL.md:237-239`, `:247` | the `do-learn` card |
| **webguide** | `Skill("devops:auto-guide", "--from=frustrated --plan=… --step=n <payload>")` | `$GOAL`, `$START_URL`, `$RESULTS`, `$SINK` [V] `skills/auto-guide/SKILL.md:51-60`, all filled from the plan; `$SINK` (for example `.env → KEY`) is one of the step's `objects` | the guide is user-paced, one step at a time, so no extra approval | the guide's results returned |
| **mixed** | the steps above in plan order, sequenced by the `plan`-mode contract (§ 3.3, gates 1–3) | per step, as above | per step, as above | all steps done or skipped |

**Strict mode is not a step type.** It is the scope enforcement around every
`implement` step (§ 5.6).

### 4.1 Implement: how the contract and do-run meet

1. The approval arms the `plan` contract (§ 3.4). No `prompt` contract
   exists yet.
2. `do-run --from=frustrated` asks only Q2. A partial router call already
   "merges its answered fields into this session's active contract" [V]
   `run-contract.md:15`, so flow and ship land in the `plan` header with no
   second contract. A do-run that skips the router "never replaces an active
   contract" [V] `run-contract.md:15`.
3. `--rethink` is never passed, and `Rethink vorher` is never offered
   (preset).
4. Autonomous flow: the autonomous start gate's 3-minute autostart [V]
   `modes/autonomous.md:332` may confirm only a task that **equals the
   approved step payload**. A changed task means no autostart, and the step
   waits. [A: whether Step 4 runs on the "Prompt umsetzen · Autonom" path
   [V] `do-run/SKILL.md:210`; the rule holds either way.]

### 4.2 Concept: when its implement click counts

`auto-concept` makes decisions. Its implement click is explicit and bound to
the concept's own version (`$NOTED_VERSION` [V] `auto-concept/SKILL.md:252`).
So it counts as an approval, but of a **new plan version**: the concept's
approved decisions are folded into a v+1 canonical plan (the implement step's
`objects` and `decisions` come from the concept), `propose` hashes it, and the
recorder writes `plan-approved` with `by: concept-implement`. Then the
implement step runs under v+1. A plan whose concept step had no following
implement step treats the click as **adding a step** (a material deviation,
§ 5): the concept shows "neue Umsetzung — Plan v3 freigeben?" and does not
run its § 5b implement path until that is answered.

## 5. Material deviation and re-approval

### 5.1 Rule

Approval covers **the objects, the order and the decisions** of one plan
version. Anything that changes one of them is material and needs a new
version and a new explicit approval (§ 2.4 question, phase B semantics: the
current step pauses, nothing is written meanwhile).

### 5.2 Material (needs re-approval)

- a new step, a dropped step, or a reordering;
- a new object: a file, component or symbol outside the step's `objects`,
  a new dependency, a new external system (an issue, a comment, a deploy
  target);
- a decision resolved differently from `decisions`;
- an `out_of_scope` item touched;
- a step whose premise turned out false: a `check` failed, the root cause
  the step rests on was refuted while the work was running, or the plan's
  files moved on `main` (the reality-check idea [V]
  `auto-concept/SKILL.md:245-263`);
- an ambiguous object (strict's "ambiguous object" case [V]
  `strict.md:88-90`): in a plan run it is **never** guessed, even in
  autonomous flow (§ 5.6). A wrong guess is how the loop started.

### 5.3 Not material (no re-approval; reported)

- **attributes** the plan leaves open, which strict leaves to Claude: colour,
  pixel value, wording, the route (import, selector) [V] `strict.md:88-90`;
- the **companions** strict counts as part of the change: the tests, docs
  and callers of the changed thing [V] `strict.md:12-16`;
- `auto-agents`' tier or wave layout [V] `auto-agents/SKILL.md:8-10`;
- `do-learn`'s choice of target file within its routing matrix;
- harden and polish findings inside the touched objects (their own scope
  fences apply [V] `strict.md:225-227`).

All of them go into strict's `chosen:` / `done:` report lines [V]
`strict.md:98-103`, so a wrong one is a one-word correction.

### 5.4 Who detects it

| Detector | Strength | Covers |
|----------|----------|--------|
| `plan`-mode gates 1–3 (§ 3.4) | hard | step added, reordered, not in plan, stale version |
| drift rule (§ 2.5) | hard | `HEAD` moved before approval |
| strict contract in every agent prompt [V] `strict.md:96-97`, refused without it by `pre.strict.agent-gate` [V] `strict.md:18-24` | soft (judgement), but propagated mechanically | new objects, out-of-scope edits |
| strict's `untouched:` report line [V] `strict.md:102` | soft | noticed but not done: these become **follow-up candidates** on the card, never executed |
| a path-level check against `objects` | **not proposed for stage 1** | file-level objects could be gated hard, but visual and symbol objects cannot; a half-hard gate would suggest more safety than it gives [A] |

### 5.5 Re-approval mechanics

The step stops (no `done`), the main thread proposes v+1 (`propose`), and
the guard is **re-armed** for the decision (phase B again). The same
question is asked, showing `v3 · <short> ersetzt v2 · <short>` plus a
three-line diff of steps, objects and decisions. On approval the recorder
calls `update()` with the new `plan` and appends `plan-approved` with
`supersedes`. `update()` already refuses to write over a header whose id
changed since it read it [V] `run-contract.md:21`. On *analysis only* or
*abort* the run closes with `abort --reason "plan v3 declined"` [V]
`run-contract.md:78`. What already landed stays, and the card names it.

### 5.6 Strict as scope enforcement

On every `implement` hand-off, do-run arms strict **inline** (Q3 preset
→ Strikt [V] `do-run/SKILL.md:179-181`; the `inline` verb [V]
`strict.md:211-213`). The approved step's payload is the "request" whose
vocabulary sets the scope [V] `strict.md:110-117`. So the plan's `objects`
become strict's closed set, with no new scope engine. One change is needed
(§ 6 G9): under `--plan`, strict's "autonomous → touch the single most
probable one" [V] `strict.md:89-90` becomes "→ stop the step, re-approval".

## 6. Gap list — smallest extension per gap

No parallel pipeline: every row extends an existing file or adds one small
helper next to the #859 artefacts.

| # | Gap | Smallest extension | Where |
|---|-----|-------------------|-------|
| G1 | The contract has no plan identity and no mode for non-do-run work [V] `run-contract-store.js:495-512`, `run-contract.md:59` | `mode: "plan"` in the mode enum; validated `plan` header field; `plan-approved` and `step` events | `hooks/lib/run-contract-store.js` (sanitize), `run-contract-obligations.js` |
| G2 | No mechanical hash; the model would type it | `scripts/frustrated-plan.js propose\|status\|discard` (canonicalise, sha256, versioned temp records) | new script, beside `scripts/frustrated-brief.js` from #859 [V] #859 spec `:156` |
| G3 | No recorder for a plan approval | a third answer branch next to the router and follow-ups: `isPlanApprovalCall` (header `Plan freigeben?`) → hash check → `arm`/`update`; typed approval in the prompt hook | `hooks/lib/run-contract-answers.js`, `post-tool-use/post.run.contract.js`, `prompt.run.contract.js` |
| G4 | No `plan`-mode obligations or gates | `step:<n>` obligations, the step boundary, gates 1–3; `skip step:<n>`; `status` and the card line show the plan | `run-contract-obligations.js`, `pre.run.contract.js`, `run-contract-cli.js`, `summaryForCard` [V] `run-contract.js:66` |
| G5 | `auto-agents` would ask a second confirmation under `--from=do-run --mode=interactive` [V] `auto-agents/SKILL.md:230-236` | add "a frustrated hand-off (`--plan=`)" to the list of callers whose own gate was the confirmation; the plan card is still shown | `skills/auto-agents/SKILL.md` Step 3 |
| G6 | `do-run` has no `--from=frustrated` preset | one preset row: Q1 → Prompt umsetzen with the step payload as the task, Q3 → Strikt, Q4 dropped; pass `--plan`/`--step` through to `auto-agents` | `skills/do-run/SKILL.md` Step 1 presets [V] `:81-92` |
| G7 | `auto-concept`'s implement click would bypass the plan | under `--from=frustrated`: fold the click into v+1 and record it (§ 4.2) before its § 5b implement path | `skills/auto-concept/SKILL.md` § 5b, one CLI call |
| G8 | `do-learn` re-confirms an already approved rule | skip the "richtig?" line when `--from=frustrated` and the text is unchanged; everything else stays | `skills/do-learn/SKILL.md` Step 1 [V] `:69-71` |
| G9 | strict guesses an ambiguous object in autonomous flow | `strict-state.js inline --ask-on-ambiguity` (or a `plan` flag in the strict state): ambiguous → stop, never guess | `hooks/lib/strict-state.js`, `CONTRACT_BLOCK` + `strict.md` § The contract (kept identical by its test [V] `strict.md:74-77`) |
| G10 | The #859 guard would refuse its own approval question and the hash script, and has no defined disarm order | allowlist `AskUserQuestion` + the exact `frustrated-plan.js` command; disarm only after a successful arm (§ 3.4); re-arm on re-approval (§ 5.5) | `hooks/pre-tool-use/pre.frustrated.readonly.js` (#859, not yet built) |
| G11 | `auto-guide` | **none.** It takes its goal table from args already [V] `auto-guide/SKILL.md:51-60` and is user-paced. Only `--from`/`--plan` pass-through, which it can ignore. | — |

The batch hand-off gate [V] `run-contract.md:84` was considered as the
carrier and **rejected**. It blocks only Edit/Write and `git commit` [V]
`pre.run.contract.js:78`, `:89`, not arbitrary writing Bash. It has no plan
identity. And any do-run / auto-concept call clears it [V]
`post-tool-use/post.run.contract.js:175`. It is the right precedent (a marker
that makes "hand off, don't implement" mechanical) but too weak for phase B.
The #859 guard already covers that phase.

## 7. Naming: `do-frustrated` vs the alpha gate

The #861 rule: gated skills "must be `auto-*` with `user-invocable: false`",
because the slash menu "cannot be filtered at runtime" [V]
`deep-knowledge/channel-gating.md:16-18`. The #859 spec proposes
`do-frustrated` [V] #859 spec `:46`.

**Position: `auto-frustrated`, `user-invocable: false`, for as long as the
feature is alpha-only.** Reasons:

1. Epic criterion 8, "beta and stable users do not see the skill", is a hard
   requirement. A slash-menu entry on beta and stable breaks it, and #861
   explicitly forbids a "not available" hint [V] `channel-gating.md:12-14`.
   A known leak is not acceptable for the one criterion that is binary.
2. Explicit invocation keeps working on alpha. The #859 trigger phrases
   [V] #859 spec `:73-76` go through the router, which applies the gate per
   prompt [V] `channel-gating.md:25`, and the model can call the skill by
   name [V] `channel-gating.md:27`. Two existing auto skills are invoked
   this way every day (`auto-concept`, `auto-guide`: `user-invocable: false`
   [V] `auto-concept/SKILL.md:16`, `auto-guide/SKILL.md:20`).
3. The `do-*` convention ("user-opened, in the slash menu") describes the
   menu, not who decides. A `do-frustrated` door is the right shape **after
   promotion**. At promotion time the rename is a frontmatter change plus one
   `skill-names.js` `RENAMED` entry, done once [V] `channel-gating.md:28`
   (never add a gated skill to an alias list *while* gated) [A: that the
   promotion is the point to rename].

Consequences for this spec: the `--from` value is `frustrated`, which is
independent of the skill name. Every new hook branch (G3, G4, G10) acts only
on frustrated state that cannot exist on beta or stable, and still calls
`isFeatureEnabled('frustrated-mode')` first, silent when false [V]
`hooks/lib/channel-gate.js:48-59`, `channel-gating.md:29`.

## 8. End-to-end example (mixed plan)

1. The user runs Frustrated Mode → the guard is armed → the report with
   `fm-20261025-k3q9 v1 · 77c0a1f4` (1 concept, 2 implement, 3 learn).
2. The user picks "Ändern oder Alternative wählen" → "nimm Alternative A2" →
   `propose` → v2 · 3f9a1c2e → the question again.
3. The user clicks "Freigeben · v2 · 3f9a1c2e" → the recorder checks the hash
   → `arm(mode: plan, plan v2)` → `plan-approved` → the guard is disarmed →
   "Freigegeben: Plan fm-… v2 · 3f9a1c2e (3 Schritte)".
4. Step 1 → `auto-concept --from=frustrated --plan=fm-…@3f9a1c2e --step=1`.
   The user iterates, then clicks implement → folded into v3 · 9b04e7d1
   (`by: concept-implement`, `supersedes` v2) → step 1 done.
5. Step 2 → `do-run --from=frustrated --plan=fm-…@9b04e7d1 --step=2` → only
   Q2 (Interaktiv · Ship manuell) is merged → strict inline → `auto-agents`
   (no second confirmation) → harden → card. Strict reports
   `untouched: header z-index`, which becomes a follow-up candidate, not
   work.
6. Step 3 → `do-learn --from=frustrated … <approved rule>` → no "richtig?",
   routed to `CLAUDE.md` → the card shows `Plan fm-… v3 · 9b04e7d1 · 3/3`.
   The contract closes.

## Assumptions

1. The #858 suppression can take a decline from here as a target-keyed
   signal.
2. A 16 KB cap on the canonical plan is enough for any plan worth approving
   as one unit.
3. When approval meets an active contract from another run, that run is the
   failing loop, and archiving it with `--replace` (announced in the
   question) is what the user wants.
4. The "Prompt umsetzen · Autonom" path may or may not reach autonomous
   Step 4's autostart. The "autostart only on an unchanged payload" rule is
   written to hold either way.
5. `do-learn` accepts a given rule text as its learning when invoked with
   args, and is callable by the model through `Skill` despite "triggers ONLY
   on explicit invocation" [V] `do-learn/SKILL.md:10`. The plan approval is
   that explicit act.
6. The #859 guard (`pre.frustrated.readonly`) is built as specified. This
   spec only adds allowlist entries and the disarm order.
7. A file-level hard gate on `objects` is left out of stage 1 on purpose
   (§ 5.4). Strict plus the step gates are judged sufficient.
8. Renaming to `do-frustrated` at promotion is a one-time frontmatter change
   plus a `RENAMED` entry.
9. The bare approval tokens (typed rule, § 2.5) match `auto-agents`' accept
   list and are unambiguous when exactly one pending version exists.
10. `scripts/frustrated-plan.js` and the temp-dir layout
    `dotclaude-frustrated-<session>/` are placeholders. They follow the
    #859 per-session temp-state pattern [V] #859 spec `:276`.

## Open questions

- **Typed approval at all?** It is proposed with a strict whole-prompt rule.
  The stricter alternative is to accept only the structured question, and
  turn a typed "go" into a re-ask. Recommended: keep the typed rule, because
  the Desktop app sometimes loses an open question; the hash echo makes
  every approval visible.
- **Path-level gate on `objects`** for file objects only, as a stage-2
  hardening? Recommended: decide after the first alpha runs show whether
  strict's soft enforcement drifts.
- **Replacing a live run on approval** (Assumption 3) versus refusing and
  asking the user to close it first. Recommended: replace, announced in the
  question, because the failing run is what the mode was opened for.
- **Q2 inside the approval question** (one prompt fewer for implement plans)
  versus a separate do-run Q2. Proposed: separate. Ship consent stays where
  ship authority already lives [V] `do-run/SKILL.md:263`.
- **#862:** whether Ultracode / dynamic workflows become a fifth step type or
  stay inside `implement` via `auto-agents`. This spec assumes the latter.

## Acceptance (for this spec)

- [x] Analysis and execution are separate phases, with a write block for
  phases A and B and the safe end states "abort" and "analysis only"
  (§ 1). This resolves the #859 disarm question.
- [x] Approval is an explicit user decision, never from silence, bound to
  plan ID + hash in the run contract. A material deviation forces
  re-approval, and the approved version is shown in seven places (§ 2, § 3,
  § 5).
- [x] The hand-off matrix maps implement, concept, learn, webguide and mixed
  to `do-run`/`auto-agents`, `auto-concept`, `do-learn`, `auto-guide` and
  `plan`-mode sequencing in the run contract, with what each receives.
  Strict is the scope enforcement (§ 4, § 5.6).
- [x] Gaps are listed with the smallest extension each, and no parallel
  pipeline. The batch gate was considered and rejected as the carrier (§ 6).
- [x] Takes a position on the `do-frustrated` / `auto-*` naming conflict
  (§ 7).
- [x] No plugin change; this file only.
