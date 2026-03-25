---
name: new-issue
description: >-
  Create GitHub issues with enforced title format, labels, milestone, and project
  board integration. Also handles milestone creation and naming. Use when the user
  wants to create a GitHub issue, plan a milestone, or manage issue lifecycle on
  the project board. Triggers on: "neues Issue", "create issue", "Issue erstellen",
  "mach ein Issue", "new issue", "milestone planen", "plan a milestone",
  "Issue #N auf In Progress setzen". Do NOT trigger for: PR creation (use /ship),
  commit operations (use /commit), or code implementation.
allowed-tools: Bash(gh *), AskUserQuestion, Read, Grep
---

# New Issue — GitHub Issue & Milestone Management

Create issues and milestones with enforced formatting, labels, and board integration.

## Issue Creation Flow

### Step 1 — Gather details

Determine from user input or ask via AskUserQuestion:
- **Title**: Must follow `[TYPE] Short imperative description` format
- **Type**: bug, feature, refactor, chore, design, docs
- **Description**: Imperative mood, sentence case, no trailing period
- **Role(s)**: Which agent role(s) own this issue
- **Module(s)**: Which code module(s) are affected

### Step 2 — Create the issue

```bash
gh issue create --title "[TYPE] Title" --body "Description" --label "type:X,role:Y,module:Z" --milestone "Milestone Name"
```

### Step 3 — Add to project board

Immediately after creation:
```bash
gh project item-add 2 --owner Jerry0022 --url <issue-url>
```

Then set the "Agent Role" text field on the board item to match the `role:*` labels. Use the GraphQL API via `gh api graphql`. Project-specific field IDs are stored in the project's skill overrides.

### Step 4 — Verify

Confirm all three required parameters are set:
1. Labels (at least one each of `type:*`, `role:*`, `module:*`)
2. Milestone assigned
3. Project board item added with Agent Role set

Missing any = hard error. Fix before reporting success.

## Milestone Creation

See deep-knowledge/milestone-rules.md for naming conventions and auto-assignment logic.

## Issue Status Tracking

See deep-knowledge/issue-status.md for board status management (In Progress, Done).

## Rules

- Never use `[FIX]` — bugs are always `[BUG]`
- Always link PRs to issues via `Closes #NNN` in PR body
- Re-evaluate milestone level prefix when issues are added/removed
