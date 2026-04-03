---
name: new-issue
version: 0.1.0
description: >-
  Create GitHub issues with enforced title format, labels, and optional milestone
  and project board integration. Also handles milestone creation and naming. Use
  when the user wants to create a GitHub issue, plan a milestone, or manage issue
  lifecycle. Triggers on: "neues Issue", "create issue", "Issue erstellen",
  "mach ein Issue", "new issue", "milestone planen", "plan a milestone".
  Do NOT trigger for: PR creation (use /ship), commit operations (use /commit),
  or code implementation.
allowed-tools: Bash(gh *), AskUserQuestion, Read, Grep, mcp__plugin_dotclaude-dev-ops_dotclaude-issues__*
---

# New Issue — GitHub Issue & Milestone Management

Create issues and milestones with enforced formatting and optional board integration.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/new-issue/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/new-issue/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

**Project extensions define:**
- GitHub owner and project board ID
- Additional required labels (e.g., `role:*`, `module:*`)
- GraphQL field IDs for board status/custom fields
- Milestone naming preferences

## Step 1 — Gather details

Determine from user input or ask via AskUserQuestion:
- **Title**: Must follow `[TYPE] Short imperative description` format
- **Type**: bug, feature, refactor, chore, design, docs
- **Description**: Imperative mood, sentence case, no trailing period

If project extension defines additional required fields (roles, modules), ask for those too.

## Step 2 — Create the issue

```bash
gh issue create --title "[TYPE] Title" --body "Description" --label "type:X"
```

Add optional flags based on project extension:
- `--label "role:Y,module:Z"` — if project defines these label categories
- `--milestone "Name"` — if milestones are configured

## Step 3 — Add to project board (if configured)

Only if the project extension provides owner + project ID:

Add the issue to the project board via the GitHub API.

Set custom fields (e.g., "Agent Role") via GraphQL if field IDs are provided in project extension.

## Step 4 — Verify

Confirm all required parameters are set:
1. Labels: at least `type:*` (plus any project-specific requirements)
2. Milestone: if configured
3. Project board item: if configured

Missing required items = hard error. Fix before reporting success.

## Milestone Creation

See deep-knowledge/milestone-rules.md for naming conventions and level prefixes.

## Rules

- Never use `[FIX]` — bugs are always `[BUG]`
- Always link PRs to issues via `Closes #NNN` in PR body
- Re-evaluate milestone level prefix when issues are added/removed
- Issue status tracking (In Progress / Done) is handled by hooks, not this skill
