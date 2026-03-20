# Global Claude Preferences — Jerry0022

These rules apply to ALL projects and sessions.

## Autonomy
- Full autonomous access to all local files, commands, programs, and project actions.
- Never ask for per-action permission. Act, then report.
- Only confirm before: force-push to `main`/`master`, sending external communications, purchases.

## Sprint Planning vs. Sprint Execution
- "Plan a sprint" / "sprint planen" = **planning mode only**: create GitHub issues, ask clarifying questions, set milestones/labels. No code, no commits.
- Implementation only begins when the user explicitly says to implement/execute a sprint.

## Language
- All documentation, GitHub artifacts (issues, PRs, milestones, project titles/views), commit messages, and code comments must be in **English**.
- Exception: explicit i18n/localization resource files (e.g. `de.json`, `i18n/de/`).
- Apply this retroactively when editing existing files.

## Token Awareness

### Per-operation guard
- Avoid reading files listed as expensive (>20,000 tokens) unless absolutely necessary.
- Use targeted skills (`/ipc-validate`, `/angular-health`, `/rsi-style`) instead of reading raw large files.
- Confirm with the user before any operation estimated to cost ≥2% of the session limit (~20,000 tokens).

### Strategic budget awareness
The SessionStart hook displays live rate limit data (5h window + weekly). **Actively use this data** when planning work:

- Before any action likely to consume **>2% of the weekly limit** (broad codebase exploration, large Explore agents, full-repo grep, multi-file rewrites), pause and evaluate:
  1. **Prompt justifies it** (complex implementation, broad concept, large sprint) → proceed, this is what tokens are for.
  2. **Uncertain** whether the cost is proportionate → ask the user: "This will be token-intensive (~X%). Proceed?"
  3. **Clearly disproportionate** (simple question or small fix triggering massive exploration) → choose a cheaper approach first (targeted grep, read specific files, use cached knowledge).
- When the **5h window is >70%**, prefer targeted over broad operations. Ask before launching Explore agents or reading >5 files.
- When the **weekly limit is >60%**, mention the budget state when proposing large tasks so the user can prioritize.
- **Never refuse work** because of budget — the user decides. But surface the cost trade-off so they can make an informed choice.
- Goal: spread usage comfortably across the week. Using 90% by day 5 of 7 is fine. Using 90% on day 1 is not.

## Response Style
- Be concise. Lead with the action or answer — no preamble.
- No trailing summaries restating what was just done.
- Use GitHub-flavored Markdown when structure helps.
- No emojis unless explicitly requested.

## Git Hygiene
- Before every commit: run `git status --short` and ensure zero `??` (untracked) entries.
- Every new file must be either staged for the commit or added to `.gitignore`/`.npmignore`.
- If a file was previously tracked but should be ignored, run `git rm --cached <file>` to remove it from the index.

## Commit Style
- Conventional commits: `type(scope): subject`
- Always append: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Never `--no-verify`. Never `git add -A`.

## Versioning
- Every project must use **semantic versioning** (`major.minor.patch`) in `package.json`.
- The `README.md` must display the current version as `**Version: x.y.z**` near the top.
- When bumping the version: update `package.json` **and** the README version line in the same commit.
- Increment rules: `patch` for bug fixes, `minor` for new features, `major` for breaking changes.
- Apply retroactively when touching a project that lacks a version badge in the README.

## Release Flow (major/minor versions)
Before committing a new **major or minor** version tag (`vX.Y.0` with Y or X incremented):
1. Run the project's release pipeline — use GitHub Actions where possible; fall back to a Windows self-hosted runner for anything requiring native Windows (installers, platform-specific tooling).
2. Update `CHANGELOG.md` (or equivalent) before tagging. See per-project memory for tone/format requirements.
- Patch versions do **not** trigger this full flow.
- Specific pipeline details (scripts, artifact names, runner requirements) are stored in per-project memory.

## GitHub Issues

**Title format:** `[TYPE] Short imperative description`

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

**Required parameters — every issue must have all five:**
1. **Labels:** at least one each of `type:*`, `role:*`, `priority:*`, `module:*`, and the active `sprint:N`
2. **Milestone:** set to the current sprint milestone (query open milestones if unsure)
3. **Assignees:** omit (Claude is not a GitHub user); roles are captured in labels
4. **Project board:** immediately after creation run `gh project item-add 2 --owner Jerry0022 --url <issue-url>`
5. **Agent Role field:** after adding to the project board, set the "Agent Role" text field on the board item to match the `role:*` labels (comma-separated agent codes, e.g., `frontend, qa`). Use the GraphQL API via `gh api graphql`. Project-specific field IDs are stored in the project's `/new-issue` and `/sprint` skills — use those IDs directly instead of querying them each time.

Missing any of these five is a hard error — do not consider the issue created until all are set.

**Linked pull requests:** Always link PRs to their issues. In the PR body include `Closes #NNN` (or `Fixes #NNN`) for every issue the PR resolves — GitHub will then populate the "Linked pull requests" column automatically.

## AI Configuration Files in .gitignore
When auditing or writing ignore files for any project:
- **Share** (must NOT be ignored): `CLAUDE.md`, `.claude/commands/`, `.claude/skills/`, `.claude/hooks/`, `.cursor/rules`, project-level AI settings
- **Ignore** (must be excluded): `.claude/worktrees/`, `.claude/todos/`, token caches, local model files, personal session state
- Section heading to use in `.gitignore`: `# AI tooling — shared config tracked, session state excluded`

## Sprint Regression Testing
After implementing **all issues in a sprint**, run a comprehensive regression test before closing issues or raising a PR:
1. Run the full unit test suite: `npm run test:unit`
2. Run the syntax and contract lints: `npm run precommit`
3. Verify all modules start without errors (check logs, no uncaught exceptions)
4. Confirm all UI content loads (Angular components render, no blank screens)
5. Confirm all UI interactive elements work (toggles, buttons, navigation)
6. If any failures are found: fix them, re-run from step 1, repeat until clean
7. Only after a clean pass: close sprint GitHub issues and open the sprint PR

## Completion Flow — Ship & Verify

When a unit of work is complete (feature, bug fix, design asset, refactor — anything with committed changes on a branch), execute the **full shipping pipeline** as a single uninterrupted step. Do not stop at the PR — carry through to merge and verification.

1. **Sync main**: `git fetch origin main && git checkout main && git pull origin main`
2. **Rebase/merge branch onto main**: resolve any conflicts inline — do not leave them for the user.
3. **Quality gates**: run the project's lint, contract checks, and tests (see Sprint Regression Testing). If anything fails, fix and re-run.
4. **Create PR**: `gh pr create` with `Closes #NNN`, summary, and test plan.
5. **Merge PR**: `gh pr merge --squash --delete-branch` (or `--merge` if the project prefers merge commits). If merge checks fail, diagnose and fix.
6. **Update local main**: `git checkout main && git pull origin main` — confirm the merge landed.
7. **Verify changes are live**: start/restart the app or dev server so the user can see and test the changes immediately. Use whatever the project's start command is (`npm run dev-start`, `npm start`, etc.). If the project has a preview tool, use it to confirm rendering.

This flow is codified in the `/ship` skill (project-level). If a project lacks `/ship`, follow these steps manually.

**Key rules:**
- Never leave merged PRs with a stale local `main` — always pull after merge.
- Never stop at "PR created" — the work is not done until the user can test it locally.
- If running in a worktree: after merge, ensure the main repo's `main` branch is also updated.

## Skill Creation & Refinement
- When creating ANY new skill (global or project-level), always use the Anthropic `skill-creator` skill to refine it.
- At minimum: draft the skill, then run the skill-creator's description optimizer to improve triggering accuracy.
- For skills with objectively verifiable outputs: also run test cases through the eval loop.
- This applies everywhere — not just this project.

## Code Defaults
- UTF-8 encoding.
- English identifiers, comments, and strings (except localization files).
- Minimal changes — do not refactor or add features beyond what was asked.
- No fallbacks by default — propose as option, implement only with explicit approval.

## Session Startup — Automatic Background Tasks

On every session start, silently run these as a **background agent** (do not block the user or show output unless there's an error):

1. **Refresh live usage data**: If `~/.claude/scripts/usage-live.json` is missing or older than 30 minutes, execute `/refresh-usage` in the background. This scrapes `claude.ai/settings/usage` via the Chrome extension and writes fresh rate limit percentages to `usage-live.json`. If the browser is unavailable or not logged in, silently skip — the startup hook falls back to local estimates.
