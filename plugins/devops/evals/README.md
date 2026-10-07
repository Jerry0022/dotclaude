# Plugin evals

Behavioral suite (format: `evals/<set>/<case>/case.yaml` + `prompt.md` +
optional `scaffold.sh` + `graders/*.md`; distinct from the per-skill
`skills/*/evals/evals.json` files the skill-creator plugin reads). Results
land in `evals/results/` (ignored).

`claude plugin eval` no longer exists in the installed CLI (2.1.175), so the
cases run through `ab-run.js`, a `claude -p` runner. Notes below that say
"the eval runner" describe the retired `claude plugin eval` and are kept
for the measurements they record.

## A/B runner (`ab-run.js`)

Runs each case's prompt through `claude -p` against one or two plugin
directories — variant A (e.g. a skill's current text) vs variant B (e.g. the
trimmed text) — and compares them. Per run it:

1. creates a temp project dir and runs `scaffold.sh` in it (Git Bash on
   Windows; override with `EVAL_BASH`),
2. calls `claude -p "<prompt>" --output-format stream-json --verbose
   --no-session-persistence --plugin-dir <variant dir> --settings
   '{"enabledPlugins":{"devops@dotclaude":false}}' --allowedTools <case
   allowed_tools>` with the case's `env:` (the installed devops is disabled
   so only the variant under test loads; `init.plugins` in the stream shows
   it as `devops@inline`),
3. writes `<case>__<variant>__r<n>.json` (exit code, duration, final text,
   tool calls, Skill invocations, Agent spawns, token usage, cost, grades)
   plus the raw `.stream.jsonl` into `evals/results/ab-<timestamp>/`, and
   finally `summary.json` (pass rate per case × grader per variant, token
   totals, cost, mean duration).

```bash
# preview the exact commands, no model call
node plugins/devops/evals/ab-run.js --case delegation/inline-typo-fix --a-ref origin/main --dry-run
# working tree (B) vs origin/main (A), 3 runs each
node plugins/devops/evals/ab-run.js --case 'delegation/inline-*' --a-ref origin/main --runs 3
# two explicit plugin dirs; re-summarise an existing run dir
node plugins/devops/evals/ab-run.js --case triggers/auto-fix-blurry-square-en --a <dirA> --b <dirB>
node plugins/devops/evals/ab-run.js --summarize plugins/devops/evals/results/ab-<timestamp>
```

`--a-ref <ref>` checks the ref out into a detached temp `git worktree` and
removes it afterwards. `--b` defaults to this working tree's
`plugins/devops`. Other flags: `--runs`, `--out`, `--model`,
`--timeout-min` (default 5), `--disable <plugin@marketplace>`,
`--keep-workdir`. The CLI has no `--max-turns`, so a case's `max_turns` is
recorded but not enforced.

Differences from the retired runner: real plugin hooks fire (SessionStart,
UserPromptSubmit, Stop), so a prompt's carried `[delegation-policy]` line
appears next to the hook's own copy — identical for both variants, so A/B
comparisons are unaffected. Your other installed plugins stay enabled.

**Grading is deterministic.** `graders/*.md` frontmatter of type
`tool_used`, `regex` (`target: trace` = any stream line, `{ source: file }`,
or the final text) and `file_exists` is compiled into predicates (`arm` is
ignored — both variants load the plugin). A case may add `graders.js`:

```js
module.exports = (g) => ({
  "fix-skill": g.skillInvoked("auto-fix"),        // devops:auto-fix matches too
  "no-role-agent": g.noDevopsAgent(),              // ignores card-render spawns
  "research-on-sonnet": g.agentSpawned("devops:research", { model: "sonnet" }),
  "card": g.cardRendered(),
  "said-ok": g.textMatches(/\bok\b/i),
});
```

Other predicates: `skillNotInvoked`, `toolUsed(name, { inputMatch, min,
max })`, `finalTextMatches`, `traceMatches`, `fileExists`, `fileMatches`.
Main-thread calls only unless `{ includeSubagents: true }`. A failed run
(non-zero exit, auth error, timeout) grades every check as `null`
(undecided, excluded from the pass rate). LLM-graded checks are not
implemented; the `.md` body stays the human-readable intent.

Record skill-trim evidence with `TRIM-TEMPLATE.md`.

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
- Each case's `scaffold.sh` checks out an `eval/work` branch, because the
  plugin's own `pre.edit.branch` hook refuses writes on `main` and the eval
  workspace starts as a fresh repo on `main` (`ab-run.js` always runs it).

```bash
# one run per case
node plugins/devops/evals/ab-run.js --case 'delegation/*' --runs 1
node plugins/devops/evals/ab-run.js --case 'delegation/inline-*' --runs 1
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
- **Run a language subset** with a case glob (`*-de`), or a skill subset
  (`auto-fix-*`). The `tags:` in `prompt.md` are recorded, not filtered on.
  ```bash
  node plugins/devops/evals/ab-run.js --case 'triggers/*-de' --runs 1
  ```
- **Cost note**: 100 generated cases at ≈$0.3–0.8 each is real money — run a
  skill or language slice, not the whole set, unless a
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
