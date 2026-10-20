# Session Grader (weekly rule check)

Do recent sessions keep missing the same plugin rules after a skill change?

Script `scripts/session-grader.js`. Two layers per session (last `--days`,
max `--max-sessions`, top-level transcripts in `~/.claude/projects/*/*.jsonl`,
subagent files skipped):

- **Deterministic, no API**: guard refusals per rule — `stop.flow.guard`,
  `[card-pregate] Not rendered`, `[agent-card-relay]`, `[agent-model]`,
  `[run-contract] BLOCKED`, `[pre.ship.delegate] Refused`, manual-PR block,
  branch guards, `git stash` inside a worktree.
- **Haiku** (`claude-haiku-5-5`) grades a ≤30 k-char digest (prompts, assistant
  text, tool names + short args, refusals) against every rule incl. the
  model-only ones (answer before card, no recap after it, chat language).
  Runs only on the API credit (`api-credits.md`); switch off, no key or credit
  exhausted → **deterministic-only**, never the plan quota. Exit 0 either way.

```bash
node "{PLUGIN_ROOT}/scripts/session-grader.js" [--days 7] [--max-sessions 20] [--rules rules.json] [--out ~/.claude/session-grader] [--dry-run]
node "{PLUGIN_ROOT}/scripts/session-grader.js" --schedule [--day mon]   # weekly 09:00; --unschedule removes it
```

`--dry-run` lists the sessions, their guard counts and the token/$ estimate —
no API call, no report. `--rules` takes `[{id, description, signals?: [regex]}]`.
Cost: ~100 k in + 14 k out tokens for 20 sessions ≈ $0.02 per run.

**Schedule:** weekly. `--schedule` registers an OS job (Task Scheduler / cron)
through the `~/.claude/devops-jobs/session-grader.js` launcher, which finds
the newest installed plugin — no Claude session, no plan tokens.

## Reading `report-YYYY-MM-DD.md` / `.json`

- **Rate**: share of sessions violating the rule (graded: guard OR model;
  deterministic-only: guard sessions; `n/a` = model-only rule, not graded).
- **Trend** vs the previous report in the folder: `worse`/`better` at ±5 pts,
  else `same`; graded runs compare with graded, otherwise guard rates.
- **Strengthen first**: top 3 by rate. Stays `worse`/`same` two weeks after a
  skill change → the skill text is too weak; sharpen that rule or add a gate.
- Guard hits are refusals the hook caught — the rule was missed, then fixed.
