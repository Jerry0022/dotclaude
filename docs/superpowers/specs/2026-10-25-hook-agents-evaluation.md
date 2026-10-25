# Hook Agents — evaluation for the devops plugin

Date: 2026-10-25 · Status: research / decision record · Issue: #864 · Owner: devops plugin

**Decision: don't use hook agents (`type: "agent"`) or prompt hooks
(`type: "prompt"`) in the devops plugin now.** Every recurring friction
pattern in the sample is a deterministic, state-based condition that the
existing command hooks already detect, or a knowledge gap that no hook can
close. The revisit conditions are listed in § 9.

## 1. Sample

**Rule (from the refinement in #864):** take the newest 50 session transcripts by
file mtime across every project dir matching
`~/.claude/projects/C--Users-Jerem-IdeaProjects-dotclaude*` (the main dir plus
the `--claude-worktrees-*` dirs). The following are left out:

- every dir whose name contains `-agent-`. These are the isolated worktrees of
  subagents (8 of the 80 dirs).
- every `agent-*.jsonl` file, and the per-session `subagents/` folders. Only
  top-level `<uuid>.jsonl` files count.
- this evaluation session (`7e1dc425-5213-452d-85aa-fdf8da2e6b2f`). Its agent
  sessions from the backlog run on 2026-10-25 live in `-agent-` dirs and are
  already excluded by the first rule.
- **duplicate copies.** Three session IDs (`58246180…`, `69d8ebc0…`,
  `c743bd3d…`) exist in both the main dir and a worktree dir, because Desktop
  copied the history when the session moved. Each counts once, as its newest
  copy. Without this rule three sessions would have counted twice.

**Candidates:** 418 transcripts in 72 dirs. **N = 50** unique sessions, from
2026-10-22 12:59 UTC to 2026-10-25 08:39 UTC.

**Composition: this matters for every number below.** The `entrypoint` field splits
the sample in two:

- **11 interactive sessions** (`claude-desktop`, marked **D**). These hold
  2,178 tool calls and 150 completion-card renders.
- **39 automated security-review runs** (`sdk-py`, marked **S**). Each is a
  single prompt, either "Review this change for security vulnerabilities…" or
  a follow-up "You previously flagged…". They make 1–4 tool calls each, render
  no cards, and fire no plugin hooks. For example, `ea22072a` has an empty hook
  attachment set. The plugin repo does not start them (grep: no caller), so
  they most likely come from an automatic review in the host app. See open
  question Q1.

The S sessions add nothing to the hook question, apart from showing that the
plugin's hooks do not run there. **The usable evidence therefore comes from 11
sessions.** The refinement mandated this sample, and it is reported as drawn.
It has not been padded with other sessions.

Runtime version: the transcripts record Claude Code **2.1.304 – 2.1.310**, which
is the Desktop-bundled runtime. The standalone npm `claude --version` on this
machine reports **2.1.175** and is stale. The docs cited in § 3 are the current
pages and match the 2.1.30x runtime. The page mentions features gated at
v2.1.290 and later.

| # | Session ID | Dir | First event (UTC) | Kind | Tool calls | Cards |
|--:|:--|:--|:--|:-:|--:|--:|
| 1 | `97e8c159-2201-40bc-880f-8dc9f35ee0f4` | wt session-user-input-wait-fd9683 | 2026-10-25 07:14 | D | 75 | 7 |
| 2 | `337f5cab-a929-4da1-84ce-b7e9806886ff` | wt concept-api-features-q4m7 | 2026-10-23 16:50 | D | 143 | 9 |
| 3 | `7e0c10e4-d797-4128-be83-5fcbcb8f7f4a` | wt session-user-input-wait-fd9683 | 2026-10-25 08:38 | S | 2 | 0 |
| 4 | `58246180-0c18-4529-bb86-5f218f4464b0` | main | 2026-10-22 20:39 | D | 500 | 38 |
| 5 | `a6291704-cbee-426b-b362-b88822f9aedb` | wt concept-api-features-q4m7 | 2026-10-25 08:37 | S | 2 | 0 |
| 6 | `b10e1423-22d0-4100-b703-a459b2704e68` | wt concept-panel-status-k7q2 | 2026-10-25 08:32 | S | 2 | 0 |
| 7 | `99dd6b7f-bd94-431c-bf28-006eb2c00ea3` | wt hooks-audit-q7k3 | 2026-10-25 07:05 | D | 134 | 5 |
| 8 | `dc340e50-24ab-40ab-9d08-1ccc58ba874d` | wt concept-panel-status-k7q2 | 2026-10-25 08:11 | S | 1 | 0 |
| 9 | `825bdb81-4ccd-4b0b-9fa3-9bcd2deb7d0c` | wt concept-panel-status-k7q2 | 2026-10-25 07:53 | S | 2 | 0 |
| 10 | `c5e697a2-fe5f-4c05-a038-971a5c8b5ed2` | wt session-user-input-wait-fd9683 | 2026-10-25 07:32 | S | 2 | 0 |
| 11 | `4c4c2a45-a2d2-4cda-a13d-38f53e087b0e` | wt batch-ack-visual | 2026-10-25 07:09 | D | 44 | 0 |
| 12 | `158c9345-7f0b-4a31-9d79-962be86e8e6c` | main | 2026-10-23 11:22 | D | 116 | 7 |
| 13 | `ea22072a-c544-49a6-8f8b-4312752a9c28` | wt concept-panel-status-k7q2 | 2026-10-23 15:48 | S | 1 | 0 |
| 14 | `002d1876-fe6f-4a11-a41d-1f16e8537a75` | wt stale-title-sweep-k7q2 | 2026-10-23 13:08 | S | 3 | 0 |
| 15 | `4983b46c-ace0-4443-b59b-102319ce0583` | wt concept-panel-status-k7q2 | 2026-10-23 12:46 | S | 2 | 0 |
| 16 | `487fd584-a8e4-4797-98dd-dca0c864f8ff` | wt stale-title-sweep-k7q2 | 2026-10-23 12:19 | S | 3 | 0 |
| 17 | `36e97947-0f7b-4970-8905-66a042cb9e7e` | wt stale-title-sweep-k7q2 | 2026-10-23 12:19 | S | 1 | 0 |
| 18 | `4784cd40-5c05-4484-b66c-140450fdd06f` | wt stale-title-sweep-k7q2 | 2026-10-23 12:19 | S | 2 | 0 |
| 19 | `98c37510-44ea-4950-9541-98171b7d449f` | wt concept-panel-status-k7q2 | 2026-10-23 12:14 | S | 2 | 0 |
| 20 | `bc00e415-0f28-4fc8-b35c-e72c38dab9cf` | wt concept-panel-status-k7q2 | 2026-10-23 11:47 | S | 2 | 0 |
| 21 | `35fa7019-5809-40b0-9546-e5cee2127274` | wt concept-panel-status-k7q2 | 2026-10-23 11:21 | S | 1 | 0 |
| 22 | `ba7ea18f-2c9b-40e4-8e85-bbe6d5dd3994` | wt concept-panel-status-k7q2 | 2026-10-23 11:16 | S | 2 | 0 |
| 23 | `3ca48875-e187-4034-8602-f59f0c00a190` | wt concept-panel-status-k7q2 | 2026-10-23 11:11 | S | 2 | 0 |
| 24 | `69d8ebc0-fa63-4c3f-8e68-f4e686ae0256` | main | 2026-10-22 18:44 | D | 158 | 3 |
| 25 | `c743bd3d-87c3-4407-89e5-efc094c5bfd3` | main | 2026-10-22 12:59 | D | 650 | 54 |
| 26 | `8cd2d835-791d-40e4-9894-b9fdae543954` | wt concept-overview-redesign-k7q2 | 2026-10-23 07:20 | S | 1 | 0 |
| 27 | `6fee6a7b-1b44-4006-a1b6-70c4ab1bb8a0` | wt backlog-run-k7q2 | 2026-10-23 06:58 | S | 2 | 0 |
| 28 | `876e2b63-b6e7-4148-8e54-f8b9988179c1` | wt concept-overview-redesign-k7q2 | 2026-10-22 20:42 | S | 2 | 0 |
| 29 | `d2e1c2df-ac18-4a03-93e0-04f50238027c` | wt concept-overview-redesign-k7q2 | 2026-10-22 20:42 | S | 2 | 0 |
| 30 | `248064c3-aa1c-461d-9589-f5cc7e9d07e0` | wt backlog-run-k7q2 | 2026-10-22 20:36 | S | 2 | 0 |
| 31 | `f2ce6423-7897-45ee-9797-1ced971f1ff9` | wt backlog-run-k7q2 | 2026-10-22 19:32 | S | 2 | 0 |
| 32 | `339b00cc-fb6f-42e6-8e97-88f62a3ed897` | wt backlog-run-k7q2 | 2026-10-22 19:21 | S | 3 | 0 |
| 33 | `a0b81033-56da-49d2-9fbb-bdd00811a524` | wt readme-refresh-k7q2 | 2026-10-22 17:13 | D | 167 | 10 |
| 34 | `59096fc6-0f77-470b-9be0-b36cc58285f5` | wt backlog-run-k7q2 | 2026-10-22 19:08 | S | 1 | 0 |
| 35 | `c942aba2-cd27-4197-b718-8b9d62fa3998` | main | 2026-10-22 17:20 | D | 88 | 5 |
| 36 | `ed8216d9-486f-4a0d-b580-3d455affa701` | wt readme-refresh-k7q2 | 2026-10-22 18:11 | S | 1 | 0 |
| 37 | `32b2af21-f203-4404-b676-e3c4d239b4ea` | wt backlog-run-k7q2 | 2026-10-22 18:10 | S | 2 | 0 |
| 38 | `c7a1795f-c1ea-4a84-8623-1c81b9e0edc8` | wt backlog-run-k7q2 | 2026-10-22 18:08 | S | 2 | 0 |
| 39 | `ad908912-fd06-4c57-b784-b3fea4b05676` | wt readme-refresh-k7q2 | 2026-10-22 18:04 | S | 4 | 0 |
| 40 | `82a4c080-3959-4071-8ec1-1b8db8424fb3` | wt readme-refresh-k7q2 | 2026-10-22 18:03 | S | 2 | 0 |
| 41 | `5abed854-cabf-454f-a6ba-943a1050e329` | wt readme-refresh-k7q2 | 2026-10-22 18:02 | S | 2 | 0 |
| 42 | `a2adee09-b04b-404b-9600-f2cc03bde52f` | main | 2026-10-22 16:43 | D | 103 | 12 |
| 43 | `74c53045-c9ea-41da-82a5-9c42b9412c44` | wt backlog-run-k7q2 | 2026-10-22 17:59 | S | 3 | 0 |
| 44 | `6dd58685-7602-48f6-9966-9fac445cfa60` | wt backlog-run-k7q2 | 2026-10-22 17:59 | S | 2 | 0 |
| 45 | `edb8a394-cf8d-47a7-8b9c-9edb7d4448b3` | wt backlog-run-k7q2 | 2026-10-22 17:58 | S | 4 | 0 |
| 46 | `50892507-de6c-4e5a-a81b-abff49b7a1ad` | wt backlog-run-k7q2 | 2026-10-22 17:56 | S | 2 | 0 |
| 47 | `e7eeccbe-77e4-421b-ac62-bfef396a44d4` | wt readme-refresh-k7q2 | 2026-10-22 17:52 | S | 2 | 0 |
| 48 | `3ca85777-64fd-4245-9898-882f07be1fd3` | wt title-arrow-k3q8 | 2026-10-22 17:44 | S | 2 | 0 |
| 49 | `1c9117cc-e76a-4826-a8cf-050c56fa3475` | wt backlog-run-k7q2 | 2026-10-22 17:28 | S | 3 | 0 |
| 50 | `b658ad4d-c08f-4d45-90d0-f4f8d8be4f69` | wt backlog-run-k7q2 | 2026-10-22 17:28 | S | 2 | 0 |

## 2. Method

No transcript was read whole. Two node scripts in the session scratchpad,
outside the repo, streamed each `.jsonl` line by line. They extracted:

- tool calls per name;
- Agent calls by `subagent_type`, and repeated Agent prompts (an md5 hash of
  the first 400 characters of each prompt);
- typed user turns, with `isMeta`, tool results, system tags and task
  notifications removed;
- correction candidates: a user turn under 400 characters after an assistant
  turn that matches a de/en negation or correction word list;
- hook attachments by `type` and `hookName`, with `hook_blocking_error` and
  `hook_stopped_continuation` examples truncated to about 10 words;
- tool results matching a hook deny or block;
- consecutive identical tool calls (same name and same input JSON);
- `render_completion_card` calls, plus a second or later render inside one
  user turn, counted as a re-render.

Only a few words are quoted per finding. No personal data or secrets were copied.

**Limits of the heuristics.** The correction detector over-reports. Of six hits,
two are not corrections: a pasted status line in `58246180` and a "continue"
instruction in `c743bd3d`. The retry detector counts *intended* re-sends as
well, for example a card re-sent after the pre-gate refused it. Both numbers
are upper bounds.

### Aggregate (11 interactive sessions)

| Signal | Count |
|:--|--:|
| Typed user turns | 34 |
| Tool calls | 2,178 (Bash 763, Read 198, Edit 187, `render_completion_card` 150, `set_session_title` 105, Grep 103, `show_widget` 100) |
| Agent calls | 63 (40 in the backlog run `c743bd3d`); 1 repeated prompt |
| `hook_success` / `hook_additional_context` attachments | 659 / 688 |
| `hook_blocking_error` (almost all `Stop` → `stop.flow.guard`) | 22 |
| `hook_stopped_continuation` (by design: "Card shown — turn ended") | 64 |
| `hook_cancelled` (mostly `SessionStart:startup`) | 48 |
| `hook_non_blocking_error` | 18 |
| Tool results matching a hook deny (mostly `[card-pregate]`) | 43 |
| Identical consecutive tool calls | 40 |
| Card re-renders within one turn | 19 |
| Tool results flagged `is_error` | 171 |
| Correction candidates (upper bound, see limits) | 6 → 4 genuine |

## 3. What hook agents are (verified)

Sources: the hooks reference, <https://code.claude.com/docs/en/hooks>, under
"Prompt-based hooks" and "Agent-based hooks". The costs page,
<https://code.claude.com/docs/en/costs>. The plugin manifest reference,
<https://code.claude.com/docs/en/plugins-reference>. All were fetched on
2026-10-25.

| Aspect | `type: "prompt"` | `type: "agent"` |
|:--|:--|:--|
| What runs | One model call with the prompt and the hook input (`$ARGUMENTS`) | A subagent that "can use tools like Read, Grep, and Glob", up to **50 turns** |
| Status | Stable | **"Agent hooks are experimental. Behavior and configuration may change"**; the docs say "For production workflows, prefer command hooks" |
| Response | `{ ok, reason, impossible? }` | `{ ok }` or `{ ok: false, reason }`; no `impossible`, no `continueOnBlock` |
| Default timeout | 30 s | 60 s |
| Model | `model` field; default is "the model Claude Code uses for background functionality". The docs name no model, so whether it is Haiku is **unverified** | Same |
| Events | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `UserPromptExpansion`, `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `PermissionRequest`, `PermissionDenied` (output discarded) | Same, **except `PermissionRequest`** |
| Not available on | `SessionStart`, `Setup`, `SubagentStart`, `SessionEnd`, `PreCompact`/`PostCompact`, `Notification`, `WorktreeCreate`/`Remove`, `FileChanged`, … | Same |
| `ok: false` on `Stop` / `SubagentStop` | The reason is fed back as the next instruction and the turn continues, unless `impossible: true` | Feeds back and continues (as if `continueOnBlock: true`) |
| `ok: false` on `PreToolUse` | Denies; the turn ends by default; `continueOnBlock: true` returns the reason as a tool error instead | The tool error comes back and the turn continues |
| `ok: false` on `PostToolUse` | The turn ends by default; `continueOnBlock: true` continues | Continues with the reason |
| `ok: false` on `UserPromptSubmit` / `PostToolBatch` | The turn ends; the reason shows as a warning line | Same |
| Concurrency | Above 12 prompt or agent hooks, 12 run at once and the rest queue | Same |
| Async | `async: true` is "only available on `type: "command"` hooks" | Same |
| In plugins | The plugin `hooks` field takes "the same shape as `hooks` in `settings.json`", so a plugin can ship them. This is inferred: no sentence names prompt or agent for plugins explicitly | Same |
| Cost | Every firing is a model request on the user's plan or API. The costs page has no hook-specific figure | Up to 50 turns per firing |

What remains unverified:

1. The exact tool set of an agent hook. The docs say "tools like Read, Grep, and
   Glob", yet their own example prompt says "Run the test suite". It is not
   documented whether Bash, Write or Edit are available, so **a no-write
   guarantee cannot be confirmed from the docs**.
2. The background model's identity and price.
3. Whether `stop_hook_active` recursion protection applies to prompt and agent
   hooks the way it does to command hooks.
4. Which runtime version first shipped `continueOnBlock` and `impossible`.

## 4. Recurring patterns (session evidence)

### P1 — Completion-card gate loop (deterministic)

`stop.flow.guard` blocks a stop that has no card ("Completion card required —
not yet rendered"). The model then renders a card. The PreToolUse card
pre-gate refuses a card that would not render ("[card-pregate] Not rendered…").
The model sends the call again.

- `337f5cab`: Stop block 2026-10-25T07:52:05Z → pre-gate deny 07:52:26Z → card call repeated 07:52:34Z.
- `a0b81033`: Stop block 2026-10-22T17:40:53Z and 18:00:14Z; pre-gate deny 17:50:55Z; re-renders 17:50:53Z, 18:34:54Z, 18:49:20Z.
- `c743bd3d`: Stop blocks 2026-10-22T13:45:26Z and 13:52:17Z; pre-gate deny 13:52:27Z.

Across the sample: 22 blocking Stop errors, 43 pre-gate denies and 19 re-renders.
Each block depends only on state: whether a card was rendered this turn,
whether its fields are valid, whether it was relayed. A command hook already
decides all three with no model call.

### P2 — Card rendered but not relayed, or background work still running at stop (deterministic)

- `69d8ebc0` 2026-10-22T20:38:46Z and `c743bd3d` 2026-10-22T16:59:32Z: "Card rendered but never relayed".
- `97e8c159` 2026-10-25T07:35:18Z and `58246180` 2026-10-23T15:47:00Z: "Background work is STILL RUNNING".

These are again state checks (a marker in the transcript, the running-task
list). `stop.flow.guard` already handles them.

### P3 — Hook latency and cancellation at session start (platform constraint)

`hook_cancelled@SessionStart:startup` appeared 9× in `337f5cab` (first event
2026-10-23T16:50Z), 7× in `97e8c159` (2026-10-25T07:14Z) and 6× in `69d8ebc0`
(2026-10-22T18:44Z). That is 48 hook cancellations in the sample. The plugin
already runs 25 SessionStart command hooks. Prompt and agent hooks are **not
available** on `SessionStart` at all. Wherever they are available, they would
add 30–60 s timeouts on top of a hook budget that is already being cut.

### P4 — Command-hook crashes surface as tool errors (reliability)

`c743bd3d`: "PreToolUse:Edit hook error" at 2026-10-22T16:14:13Z and
16:47:47Z, and "PreToolUse:Bash hook error" at 16:19:20Z. The sample also has
18 `hook_non_blocking_error` attachments. A hook's failure mode is already a
visible cost. A model-backed hook adds timeouts, malformed JSON and model
errors on top, and none of these can be reproduced in vitest.

### P5 — Genuine user corrections are knowledge gaps, not missed hook signals

`a2adee09` holds a cluster of four corrections in 15 minutes, about onboarding a
new plugin user:

- 2026-10-22T16:48:05Z "warum steeht das nicht im readme" (sic; why is this not in the README);
- 16:53:58Z "hat nicht funktioniert" (did not work);
- 16:55:53Z: adding the marketplace failed;
- 17:01:54Z: it worked on a retry.

The fix is documentation and installer behaviour. A Stop or PostToolUse
verifier would have seen the same wrong belief as the main model. It was not a
missing check. Outside this session, the 11 interactive sessions hold no
genuine correction.

**Additional observation: agent fan-out is already orchestrated.** `c743bd3d`
(the backlog run) issued 40 Agent calls (24 general-purpose, 9 `devops:qa`,
7 `devops:core`). Only one Agent prompt in the whole sample was repeated
(`58246180`). `auto-agents`, `pre.agent.*` and `substop.agent.wip` already
govern this flow. The sample shows no recurring "a subagent claimed work it
did not do" case.

## 5. Overlap matrix

How existing mechanisms cover each pattern: ● covered deterministically, ◐
partly covered, ○ not covered, — not applicable. The last column says what a
hook agent would add.

| Pattern | Command hooks | Plugin agents (12) | Skills (15) | Subagents / auto-agents | Completion card | What a hook agent would add |
|:--|:-:|:-:|:-:|:-:|:-:|:--|
| P1 card gate loop | ● `stop.flow.guard`, card pre-gate, `post.flow.completion` | — | ◐ do-ship card step | — | ● | Nothing; the condition is state, not judgment. A second Stop blocker risks ping-pong with `stop.flow.guard` |
| P2 relay / background running | ● `stop.flow.guard` | — | — | ◐ `stop.agent.relay` | ● | Nothing |
| P3 session-start latency | ◐ timeouts and fail-cache | — | — | — | — | Not allowed on SessionStart; adds latency elsewhere |
| P4 hook crashes | ◐ per-hook try/exit 0 | — | ◐ auto-fix | — | — | A new class of failure |
| P5 knowledge-gap corrections | ○ | ◐ research | ◐ do-learn, auto-fix | — | ◐ open points | Nothing; a verifier shares the model's wrong belief |
| Bash failure diagnosis | ● `post.flow.debug` (mandates `auto-fix` after 2+ failures) | — | ● auto-fix | ◐ qa | — | Diagnosis inside a 30–60 s hook, duplicating auto-fix |
| Subagent output not picked up | ● `substop.agent.wip`, `stop.agent.relay` | ● qa | ● auto-agents | ● | ◐ | A semantic "did it do what it claimed" check (candidate C1) |
| Choice walked past (do-run) | ● run-contract hooks (`pre/post/prompt.run.contract`) | — | ● do-run | ● | ● ✗/⚠ rows | Nothing; already enforced deterministically |

## 6. Candidates

Three candidates were derived from the patterns and tested against the
alternatives. None passes.

### C1 — SubagentStop agent hook: verify the subagent's claimed result

- **Trigger:** `SubagentStop` for implementing agents (`devops:core`, `frontend`, `feature`).
- **Task:** read the subagent's final message, inspect `git log` and `git diff` in its worktree, and return `ok: false` with the reason when the claimed commits, files or tests do not exist.
- **Delimitation:** `substop.agent.wip` already commits leftover work. `qa` verifies on request. Memory rule *verify claimed work against git* covers the parent.
- **Success metric:** among implementing agents, the share whose claim does not match git (target: below 2 %), measured over 50 sessions.
- **Evidence:** none in this sample, since no mismatch was observed.
- **Simpler alternative:** extend `substop.agent.wip` (deterministic). Parse a SHA or file list from the agent's final message and compare it to `git rev-parse` / `git diff --name-only`. A mismatch becomes additionalContext.
- **Verdict: don't.** There is no evidence, the check is deterministic, the
  feature is experimental, and the tool set is unverified, so Bash may be
  needed and a no-write guarantee is not documented.

### C2 — Stop prompt hook: "is the task really finished?"

- **Trigger:** `Stop`.
- **Task:** judge from `$ARGUMENTS` whether the user's request is complete, and feed back the gap if it is not.
- **Delimitation:** `stop.flow.guard` (12 sub-rules), `/goal` (the built-in session-scoped prompt Stop hook), the completion card's open points, and the run contract.
- **Success metric:** fewer "you forgot X" user turns. The sample has zero such turns outside P5.
- **Simpler alternative:** `/goal` when a user wants it for one session; the card's open-points list.
- **Verdict: don't.** It would be a ninth Stop hook and a second blocker next
  to `stop.flow.guard`. It could block every one of the 22 observed stop cycles
  again and add up to 30 s to every turn end. The `impossible` escape exists
  only for prompt hooks, and recursion protection is unverified (§ 3, item 3).

### C3 — PostToolUseFailure prompt hook: diagnose shell failures

- **Trigger:** `PostToolUseFailure` with matcher `Bash|PowerShell`.
- **Task:** classify the error (environment, syntax, real bug) and suggest the next step.
- **Delimitation:** `post.flow.debug` mandates `auto-fix` after two or more consecutive failures.
- **Success metric:** shorter failure streaks. Baseline: 171 `is_error` tool results across 11 sessions.
- **Simpler alternative:** what exists today, plus pattern tables in `post.flow.debug` for known environment errors (Windows paths, a stale npm CLI).
- **Verdict: don't.** At about 15 failures per session, a prompt hook adds
  15 model calls and up to 7.5 min of potential blocking per session (at the
  30 s timeout). The main model already sees the error text.

## 7. Deterministic vs. genuinely agentic

| Task in this plugin | Kind | Right mechanism |
|:--|:--|:--|
| Card present, valid, relayed; background tasks done | Deterministic (state) | Command hook (as is) |
| Run-contract obligations (passes, ship path) | Deterministic (recorded answers) | Command hook (as is) |
| Branch, worktree and main guards, issue writes, crawl and token guards | Deterministic (pattern/path) | Command hook (as is) |
| Leftover agent work | Deterministic (git status) | Command hook (as is) |
| Claimed vs. actual agent output | Mostly deterministic (SHA, file list) | Command hook extension (C1 alternative) |
| "Is the work semantically complete / correct?" | Agentic | The main model, `qa` or `redteam` agents, and the user via the card. These run *inside* the workflow, where the cost is chosen and visible |
| Why a user had to correct (P5) | Agentic, after the fact | `do-learn`, `do-run audit`; never a per-turn hook |

Every task that runs per event in this plugin is deterministic. The genuinely
agentic tasks already have an explicit, user-visible home.

## 8. Assessment

| Dimension | Command hooks (today) | Prompt / agent hooks |
|:--|:--|:--|
| **Cost** | No tokens | One model call per firing for prompt hooks, up to 50 turns for agent hooks. A `*` PostToolUse hook would fire about 200× per interactive session (2,178 tool calls / 11 sessions) |
| **Latency** | Milliseconds to a few seconds; SessionStart already loses 48 hooks to cancellation | 30 s / 60 s default timeouts; above 12 hooks they queue |
| **Reliability** | Pure functions unit-tested in vitest (`lib/card-guard.js` and others) | Non-deterministic. Testable only with real model runs (`evals/ab-run.js`, which costs usage). Agent hooks are experimental |
| **Idempotency** | Same input gives the same decision | Same input can give a different decision; a Stop feedback loop can block repeatedly |
| **Bounded execution** | Short timeouts; every error path exits 0 | Bounded by timeout and 50 turns. The bound is coarse, and a timeout means silent pass or fail |
| **Fallback** | Explicit in code | Platform-defined, with no plugin control over it |
| **No unwanted writes** | Code review of each hook | **Cannot be guaranteed from the docs**, because the tool set is unverified |
| **User control** | Hooks run silently; the card shows ✗/⚠ for contract skips | Consumers get no per-hook opt-out unless the plugin builds one. The extra spend is attributed only at plugin level in `/usage` |
| **Maintainability** | The prompt is code, versioned and tested | The prompt is prose, and model or runtime changes alter its behaviour. Each runtime update needs re-validation |

## 9. Decision

**Don't use. Neither `type: "agent"` nor `type: "prompt"` hooks go into
`plugins/devops/hooks/hooks.json` now.**

Revisit this decision only when **all** of these hold:

1. agent hooks lose the "experimental" warning, and the docs list their tool set, including whether Bash and Write are available;
2. a pattern recurs in at least 3 sessions of a fresh 50-session sample that **cannot** be decided from state: no marker, git fact or recorded answer would identify it;
3. the hook can be scoped to a narrow matcher (not `*`), runs on `SubagentStop` or a single tool, and has a deterministic pre-filter that skips the model call in at least 90 % of firings.

A future candidate must run as a short eval A/B (`evals/ab-run.js`) against the
deterministic alternative before it ships.

## 10. Open questions

- **Q1.** What starts the 39 `sdk-py` "Review this change for security
  vulnerabilities" runs, one per worktree and several per hour? The plugin
  source does not contain the prompt. If they come from the host app, they
  dilute every mtime-based sample, and future evaluations should filter on
  `entrypoint`.
- **Q2.** Does recursion protection (`stop_hook_active`) cover prompt and agent
  Stop hooks? The docs leave it open.
- **Q3.** The standalone npm CLI is at 2.1.175 while Desktop runs 2.1.30x. `claude -p` evals (`evals/ab-run.js`) may therefore test against a much older runtime than the sessions they model.
