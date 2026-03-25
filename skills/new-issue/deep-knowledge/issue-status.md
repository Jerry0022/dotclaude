# Issue Status Tracking on the Project Board

## Trigger — session start & topic switch

At the beginning of every session and whenever the user switches topics mid-session, check whether the current work maps to an existing GitHub issue:
1. Infer the topic from the user's message (feature name, bug description, issue number, branch name pattern like `feat/42-*`).
2. Query open issues: `gh issue list --state open --json number,title --limit 20` (or search by keyword/label if the topic is vague).
3. If a matching issue is found → ask the user (AskUserQuestion): "Arbeitest du an Issue #N (<title>)?" with options `Ja` / `Nein`.
4. If the user confirms → set the issue's project board status to **In Progress** (see GraphQL below) and remember the issue number for the rest of the session/topic.
5. If the user declines → do nothing. Re-check on the next topic switch.

If the user **explicitly** mentions an issue number (e.g., "mach Issue #42"), skip the question — set it to In Progress immediately.

## Setting status via GraphQL

Use `gh api graphql` to update the project board item's "Status" field. Project-specific field IDs and option IDs (In Progress, Done, etc.) are stored in the project's `/new-issue` and `/milestone` skills — use those IDs directly.

## Completion — set to Done

When an issue's work is shipped and merged (PR merged to `main`), set the project board status to **Done**. This happens automatically as part of the `/ship` flow — after the PR merge step, update the board item status for every issue referenced in the PR body (`Closes #N`).

## Rules

- Never set status without user confirmation (except when the user explicitly names the issue).
- Only set In Progress for issues the session is actively working on — not for issues that are merely discussed or referenced.
- If multiple issues are being worked on simultaneously (e.g., multi-issue milestone), all active ones get In Progress.
- When the session ends without shipping, leave the status as In Progress — the next session will pick it up or the user will manage it.
