# Skill usage scan

This is a **dotclaude project extension** — not part of the devops plugin
that ships to consumers (see `.gitignore`'s `plugins/**/.claude/` rule and the
"Measuring (dotclaude repo only)" section of
`docs/superpowers/specs/2026-09-24-skill-restructure-design.md`). It lives
under `.claude/skill-usage/` in this repo specifically so it is checked into
git and survives a machine loss — the same reasoning documented in project
memory for other durable state. It has no runtime effect on the plugin or on
consumer projects; it is a read-only analysis tool for whoever maintains this
repo.

## What it does

`scan.js` reads local Claude Code session history
(`~/.claude/projects/*/*.jsonl`, one file per session, skipping subagent
sidechains and nested `subagents/**/*.jsonl` files) and reports, per devops
skill:

- total invocation count
- how many were **model-initiated** (the assistant called the `Skill` tool on
  its own) vs **following a user slash command** (the triggering turn's
  prompt contains Claude Code's `<command-name>…</command-name>` wrapper
  naming that skill)
- for `fix`/`auto-fix` specifically: how many bug-like human prompts (a small
  regex heuristic — "kaputt", "broken", "error", "traceback", "geht nicht",
  etc.) were **not** followed by a fix invocation before the next real user
  turn

The devops skill list is read from `plugins/devops/skills/` at run time, so
the report never drifts from the plugin's own skill set as it is renamed or
restructured (PR 2 / PR 3 of the skill-restructure spec).

## Running it

```bash
node .claude/skill-usage/scan.js [sessionCount]
```

`sessionCount` (default 100) is how many of the most recently modified
session files to read, across **all** local projects — the devops plugin is
installed globally, so its usage data is scattered across every project's
session history, not just this repo's. There is no dependency beyond Node's
standard library.

Run it weekly by hand (`node .claude/skill-usage/scan.js 200` covers roughly
a week at typical volume) or from a habit/reminder of your own choosing. This
extension deliberately does **not** ship a scheduled task for it — scheduled
tasks are devops-plugin runtime state
(`docs/superpowers/specs/2026-09-24-skill-restructure-design.md` explicitly
scopes the measuring extension to "dotclaude repo only, not shipped with the
plugin"), and wiring a periodic run through the plugin's own scheduler would
blur that boundary.

## Known limitations

- The bug-like regex is a coarse heuristic (the same words that flag a real
  bug report also match unrelated sentences that happen to contain "error" or
  "crash"); treat the gap count as a lower bound worth spot-checking, not an
  exact figure — this is exactly how the 2026-09 usage numbers behind the
  skill-restructure spec were produced.
- "Model-initiated" does not distinguish a natural-language trigger from the
  model deciding to invoke a skill mid-conversation for an unrelated reason;
  the `evals/triggers/` suite in `plugins/devops/evals/` is the tool for
  isolating trigger-phrase reliability specifically.
- Sessions are attributed by file mtime, not by the conversation's actual
  timestamps, since only the former is cheap to sort without parsing every
  file up front.
