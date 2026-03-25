# GitHub Issue Rules

## Title format

`[TYPE] Short imperative description`

| `type:` label | Title prefix |
|---|---|
| `type:bug` | `[BUG]` |
| `type:feature` | `[FEATURE]` |
| `type:refactor` | `[REFACTOR]` |
| `type:chore` | `[CHORE]` |
| `type:design` | `[DESIGN]` |
| `type:docs` | `[DOCS]` |

- Description: imperative mood, sentence case, no trailing period (e.g. `[BUG] Settings UI freezes on startup`)
- Never use `[FIX]` — bugs are always `[BUG]`

## Required parameters — every issue must have all three:

1. **Labels:** at least one each of `type:*`, `role:*`, `module:*`
2. **Milestone:** assign to the appropriate milestone (query open milestones if unsure)
3. **Project board:** immediately after creation run `gh project item-add 2 --owner Jerry0022 --url <issue-url>`, then set the "Agent Role" text field on the board item to match the `role:*` labels (comma-separated agent codes, e.g., `frontend, qa`). Use the GraphQL API via `gh api graphql`. Project-specific field IDs are stored in the project's `/new-issue` and `/milestone` skills — use those IDs directly instead of querying them each time.

Missing any of these three is a hard error — do not consider the issue created until all are set.

## Linked pull requests

Always link PRs to their issues. In the PR body include `Closes #NNN` (or `Fixes #NNN`) for every issue the PR resolves — GitHub will then populate the "Linked pull requests" column automatically.
