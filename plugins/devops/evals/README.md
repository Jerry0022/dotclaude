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
