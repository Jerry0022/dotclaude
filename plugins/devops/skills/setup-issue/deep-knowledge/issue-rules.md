# GitHub Issue Rules

## User-value gate (mandatory — checked BEFORE creating any issue)

Every issue must deliver a positive user-experience effect **on its own**.
The test: *"If ONLY this issue is implemented and shipped — nothing else —
does the user notice a positive difference?"*

Accepted value, either kind:
- **Direct**: visible feature, UI improvement, bug fixed, fewer crashes
- **Indirect**: performance, stability, security, lower resource usage

If the honest answer is *"only in combination with other issues"* → do NOT
create it as its own issue.

**Bundling rule:** Technical sub-tasks that only produce value together
(e.g. "change file A", "adapt module B", "extend schema C" — all serving one
use case) become **ONE issue**, titled and scoped by the user value they
jointly deliver. List the sub-tasks as a checklist in the issue body.

**Body requirement:** every issue body states the user value in one line:
`**User value:** <direct or indirect effect>`. If you cannot write that
line honestly, the issue fails the gate.

**What remains fine:**
- Creating multiple issues at once — as long as EACH passes the gate in isolation
- Milestones bundling issues into a larger goal — the milestone aggregates
  value, but each member issue must still pass the gate on its own
- `type:chore` / `type:refactor` issues — IF the body names the indirect
  user effect (e.g. "removes crash-prone code path", "cuts startup time")

**Anti-pattern (never):** decomposing one use case into many file-level or
layer-level issues that each describe a code change but no user-perceivable
outcome. That floods the tracker without adding plannable value.

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
