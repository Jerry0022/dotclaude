# Code Defaults

Standard coding conventions enforced across all projects using the devops plugin.

## Encoding & Language
- UTF-8 encoding for all files.
- English identifiers, comments, and strings (except explicit i18n/localization resource files).

## Change Philosophy
- Minimal changes only — no refactoring or features beyond what was asked.
- No fallbacks by default — propose as an option, implement only with explicit approval.
- Avoid over-engineering: only make changes that are directly requested or clearly necessary.

## What NOT to Do
- Don't add docstrings, comments, or type annotations to code you didn't change.
- Don't add error handling for scenarios that can't happen.
- Don't create helpers or abstractions for one-time operations.
- Don't design for hypothetical future requirements.
- Don't add backwards-compatibility hacks for removed code.

## Strict Mode (`/claude-strict`)

The rules above are the always-on baseline. When a `[claude-strict contract]`
block is in context — injected by `prompt.strict.enforce` while
`/claude-strict` is armed for this worktree + branch, or carried at the top of
an agent prompt — it is the **hard, reported, propagated** form of the same
idea and takes precedence on the scope axis:

- The deliverable is exactly what the request names, measured in the request's
  own vocabulary (visual request → the visible element; technical request →
  the symbol). Unnamed attributes are discretionary and are reported.
- Under the block, documentation-maintenance, pre-mortem outputs (extra guards,
  tests, narrowed scope) and "make reasonable decisions independently" do not
  widen the diff; what they would have changed goes to the strict report's
  `untouched` line instead.
- Unaffected: the completion card, `/ship` Step 2.6 docs-sync, the
  `/tune-polish` approval rule.

Every spawned agent inherits the block verbatim (`pre.strict.agent-gate`
refuses a spawn without it). Skill: `skills/claude-strict/SKILL.md`.
