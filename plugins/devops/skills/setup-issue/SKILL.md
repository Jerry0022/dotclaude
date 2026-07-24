---
name: setup-issue
version: 0.2.0
description: >-
  Create GitHub issues with enforced title format, labels, and optional milestone
  and project board integration. Also handles milestone creation and naming. Use
  when the user wants to create a GitHub issue, plan a milestone, or manage issue
  lifecycle. Triggers on: "neues Issue", "create issue", "Issue erstellen",
  "mach ein Issue", "new issue", "milestone planen", "plan a milestone".
  Do NOT trigger for: PR creation (use /ship), commit operations (use /commit),
  or code implementation.
allowed-tools: Bash(gh *), AskUserQuestion, Read, Grep, mcp__plugin_devops_dotclaude-issues__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Setup Issue — GitHub Issue & Milestone Management

Create issues and milestones with enforced formatting and optional board integration.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/setup-issue/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/setup-issue/SKILL.md` + `reference.md`
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

## Step 1a — User-value gate (mandatory)

Apply the gate from deep-knowledge/issue-rules.md to EVERY issue before
creating it: implementing this one issue alone must already produce a
positive user effect — direct (feature, visual, bug fixed, fewer crashes)
or indirect (performance, stability, security).

- Fails the gate ("only valuable together with other issues") → do NOT
  create it. Bundle the technical sub-tasks into ONE issue scoped by the
  user value they jointly deliver, sub-tasks as a checklist in the body.
- Multiple issues in one request: gate each one in isolation. If several
  only pass together, propose the merged issue(s) to the user instead of
  creating the originals.
- Milestones may aggregate issues into a larger goal, but never use a
  milestone to justify member issues that fail the gate individually.

## Step 2 — Create the issue

```bash
gh issue create --title "[TYPE] Title" --body "Description" --label "type:X"
```

The body MUST include the user-value line (see deep-knowledge/issue-rules.md):
`**User value:** <direct or indirect effect>`

Add optional flags based on project extension:
- `--label "role:Y,module:Z"` — if project defines these label categories
- `--milestone "Name"` — if milestones are configured

## Step 3 — Add to project board (if configured)

Only if the project extension provides owner + project ID:

Add the issue to the project board via the GitHub API.

Set custom fields (e.g., "Agent Role") via GraphQL if field IDs are provided in project extension.

## Step 4 — Verify

Confirm all required parameters are set:
1. User-value gate passed and body contains the `**User value:**` line
2. Labels: at least `type:*` (plus any project-specific requirements)
3. Milestone: if configured
4. Project board item: if configured

Missing required items = hard error. Fix before reporting success.

## Milestone Creation

See deep-knowledge/milestone-rules.md for naming conventions and level prefixes.

## Step 5 — Completion Card

After the issue/milestone is created and verified, call
`mcp__plugin_devops_dotclaude-completion__render_completion_card` with variant
`fallback` (no code change, no ship — just a GitHub artifact created).

Pass: `variant: "fallback"`, `summary` (e.g. "Issue #123 created"), `lang`,
`session_id`, and `changes` (issue number → title, labels, milestone).
Output the markdown VERBATIM as the LAST thing in the response.

## Rules

- Every issue passes the user-value gate on its own (deep-knowledge/issue-rules.md) —
  never create file-level/layer-level tasks that only deliver value in combination
- Never use `[FIX]` — bugs are always `[BUG]`
- Always link PRs to issues via `Closes #NNN` in PR body
- Re-evaluate milestone level prefix when issues are added/removed
- Issue status tracking (In Progress / Done) is handled by hooks, not this skill
