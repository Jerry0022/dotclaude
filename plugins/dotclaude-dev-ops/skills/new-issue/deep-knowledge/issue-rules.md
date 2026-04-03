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

- Description: imperative mood, sentence case, no trailing period
- Example: `[BUG] Settings UI freezes on startup`
- Never use `[FIX]` — bugs are always `[BUG]`

## Required labels

**Always required:**
- `type:*` — one of the types above

**Optional (project-configurable via extension):**
- `role:*` — agent role owning this issue (if project uses agent roles)
- `module:*` — affected code module (if project defines modules)

## Linked pull requests

Always link PRs to issues. In the PR body include `Closes #NNN` (or `Fixes #NNN`)
for every issue the PR resolves.
