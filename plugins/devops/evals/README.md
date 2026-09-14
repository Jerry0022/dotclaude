# Plugin evals

Behavioral suite for `claude plugin eval` (format: `evals/<case>/prompt.md` +
`graders/*.md`; distinct from the per-skill `skills/*/evals/evals.json` files
the skill-creator plugin reads). Results land in `evals/results/` (ignored).

## delegation/

Pins the always-on delegation policy (`deep-knowledge/agent-proactivity.md`):
simple prompts spawn no devops role agent, a question that needs the web
spawns one background `research` agent, a two-lens question spawns 2–3
parallel role agents, and Complex-tier work only *offers* `/run-agents`.

Two things about how the graders are written:

- Every `Agent` grader matches `subagent_type: devops:*`. The plugin's Stop
  hook requires a completion card each turn; without Bash the model spawns
  `general-purpose` agents to render it, so a bare "Agent never called"
  count would fail for the wrong reason. (Bash cannot be granted on Windows —
  no sandbox backend — so the spawns are expected there.)
- "Said X" graders regex the assistant text inside `trace`, not
  `last_message` (that is the card) and not the whole trace (the injected
  policy itself mentions `/run-agents`).
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
