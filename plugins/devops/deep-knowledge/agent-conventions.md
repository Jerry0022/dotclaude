# Agent Naming & Collaboration Conventions

## Naming format

```
[role:X · Type] Task description
```

- **role:X** — agent team role, defined per project extension. If no role applies, use type alone: `[Explore]`, `[Plan]`, `[Agent]`.
- **Type** — `Explore`, `Plan`, `Agent`, or custom `subagent_type`.
- Append `||` for parallel agents.
- Keep task description 3-6 words.

**Roles are project-specific.** Define them in your project extension:
```
{project}/.claude/deep-knowledge/agent-conventions.md
```

Example: `po` (product owner), `frontend`, `backend`, `qa`, `devops`

## Inline role attribution

When roles execute inline (no subagent), tag their output:
- `[core] IPC contract updated`
- `[qa] Tests: 14 passed`

## Collaboration protocol

Roles collaborate via structured handoffs — finding-to-task principle.

Post structured comments on GitHub issues:
- **Starting**: Announce which role is taking over and what they will do
- **Handoff**: Pass findings to the next role with context
- **Review**: `clean` (no issues) or `findings` (list issues found)
- **Blocker**: Escalate issues that prevent progress

Never skip a role's review.
