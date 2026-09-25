# Plugin evals

Behavioral suite for `claude plugin eval` (format: `evals/<case>/prompt.md` +
`graders/*.md`; distinct from the per-skill `skills/*/evals/evals.json` files
the skill-creator plugin reads). Results land in `evals/results/` (ignored).

## delegation/

Pins the always-on delegation policy (`deep-knowledge/agent-proactivity.md`):
simple prompts spawn no devops role agent, a question that needs the web
spawns one background `research` agent, a two-lens question spawns 2–3
parallel role agents, and Complex-tier work only *offers* `/auto-agents`.

Two things about how the graders are written:

- Every `Agent` grader matches `subagent_type: devops:*`. The plugin's Stop
  hook requires a completion card each turn; without Bash the model spawns
  `general-purpose` agents to render it, so a bare "Agent never called"
  count would fail for the wrong reason. (Bash cannot be granted on Windows —
  no sandbox backend — so the spawns are expected there.)
- "Said X" graders regex the assistant text inside `trace`, not
  `last_message` (that is the card) and not the whole trace (the injected
  policy itself mentions `/auto-agents`).
- Every prompt ends with the `[delegation-policy] …` nudge line that
  `prompt.knowledge.dispatch` injects per prompt in a real session — the
  eval runner fires no UserPromptSubmit hooks, so the case carries it.
  `prompt.knowledge.dispatch.test.js` pins the copies to each other.
  Measured 2026-09-14: with the SessionStart policy alone the model did
  web research inline; with the nudge it spawned `devops:research` first.
- Every case pins its budget class through `env: EVAL_DOTCLAUDE_BUDGET`
  (the only env the runner forwards): `free` for the tier cases, so a
  sandbox with no usage snapshot does not fall into "ask"; the
  `[budget]` SessionStart line is real hook output either way.
- `parallel-two-lenses-pro-budget` pins `ask-before-parallel` (what a Pro
  plan gets from 0 %) and appends the matching nudge suffix. Expected:
  never an opus role agent, never more than one — either the model asks
  the budget question (the runner cannot answer, so the run ends there)
  or it takes the 1-agent tier itself on sonnet. Measured 2026-09-14: one
  `devops:research` with `model: sonnet`, no second agent.
- `switch-off-research` is the research prompt with the kill-switch pinned
  through `env: EVAL_DOTCLAUDE_DELEGATION=off` (`lib/delegation.js`): the
  SessionStart hook then preloads the `[delegation] off` line instead of the
  policy, and the case carries NO nudge line (the hook emits none). Expected:
  zero role agents, the answer is researched inline.
- `agent-announce-quiet` scaffolds the Quiet output style into the
  workspace and spawns `devops:research` on a hard go. Expected: the
  agent card from `pre.agent.announce` (row
  `| 🔎 | **research** | … | opus | ●●● high |`) appears in the assistant
  text despite Quiet's "never narrate" rule.
- Role-agent graders exclude spawns whose input mentions the completion
  card: without Bash the Stop hook's offline card render is delegated to
  whichever agent has a shell — `devops:core` was observed doing it.
- `--scaffold` is required: each case checks out an `eval/work` branch,
  because the plugin's own `pre.edit.branch` hook refuses writes on `main`
  and the eval workspace starts as a fresh repo on `main`.

```bash
# from plugins/devops — with-arm only, one run per case
claude plugin eval . --runs 1 --ablation none --trust-plugin --no-publish --scaffold --allow-tools Write,Edit,WebSearch,WebFetch
claude plugin eval . --runs 1 --ablation none --trust-plugin --no-publish --scaffold --allow-tools Write,Edit --tag inline
```

Runs call the model with your credentials and count against your usage
(≈ $0.3–0.8 per case).

## triggers/

Pins whether a hidden (`user-invocable: false`) worker skill gets invoked from
a natural prompt alone — no slash command, no hook forcing it — in the top 10
languages (en, zh, hi, es, fr, ar, bn, pt, ru, ja) plus German. Every case is a
`Skill` tool-call grader (`tool_used`, `input_match` on `"skill":"<name>"`,
`min: 1`), tolerant of both the pre-PR2 and post-PR2 skill name (e.g.
`fix`/`auto-fix`) so the same cases survive the rename in PR 2.

- **Data, not 100+ hand-written directories**: `evals/triggers/cases.json`
  holds one entry per bug report / trigger phrase, each with a `translations`
  map keyed by language (or `languageIndependent: true` for the one pasted
  stack trace, which is a single case — error patterns route to `auto-fix`
  regardless of prompt language, so it is not translated).
- **Regenerate** after editing `cases.json`:
  ```bash
  node plugins/devops/scripts/gen-trigger-evals.js
  ```
  The script is idempotent (rerunning with unchanged `cases.json` writes
  nothing) and owns every directory under `evals/triggers/` except
  `cases.json` and this README section — it deletes stale case directories
  that no longer appear in `cases.json`. `gen-trigger-evals.test.js` fails the
  suite if the checked-in directories drift from `cases.json`
  (`node plugins/devops/scripts/gen-trigger-evals.js --check`).
- **Run a language subset**: `--tag lang-de`, or a skill subset with
  `--tag skill-fix`. Every case also carries the plain `trigger` tag.
  ```bash
  claude plugin eval . --runs 1 --ablation none --trust-plugin --no-publish --scaffold --allow-tools Write,Edit,Bash --tag lang-de
  ```
- **Cost note**: 100 generated cases at ≈$0.3–0.8 each is real money — run a
  `--tag skill-<x>` or `--tag lang-<xx>` slice, not the whole set, unless a
  full trigger-preservation sweep is actually needed (e.g. before PR 3 shortens
  descriptions).
- **What the eval runner does NOT fire, unlike a real session**: in a real
  session `prompt.skill.enforce` turns the unambiguous part of the
  `triggers:` frontmatter (multi-word phrases, slash forms, a curated
  single-word allowlist) into a mandatory invoke before the model even sees
  the prompt — for those, the router decides, not the model. Generic single
  words ("error", "audit", "polish") never pass the router, so for them these
  cases are the ONLY coverage. The eval runner
  fires no `UserPromptSubmit` hooks (same constraint noted in delegation/
  above), so a passing case here means the model chooses the skill from its
  description/training alone. That is a stronger, not weaker, signal than the
  router path, which is why these cases exist separately from the router's own
  unit tests.
- **`auto-guide` is intentionally absent here**: its trigger is
  `stop.guide.handoff`, a Stop hook on Claude's *own* answer (it fires when
  Claude hands a web step to the user), not on the user's prompt. There is no
  natural user prompt that should trigger it, so it has no case in this
  directory — coverage lives in the hook's own unit tests.
- Every prompt carries the same `[delegation-policy]` nudge line as
  `delegation/`, for the same reason: the eval runner injects no
  `prompt.knowledge.dispatch` SessionStart/UserPromptSubmit output, and the
  generator pins the line verbatim from that hook.
