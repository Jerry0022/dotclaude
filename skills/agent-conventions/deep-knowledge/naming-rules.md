# Agent Naming Convention

## Format: `[role:X · Type] Task description`
- **role:X** — agent team role (`po`, `gamer`, `frontend`, `core`, `windows`, `ai`, `qa`). If no role applies, use type alone: `[Explore]`, `[Plan]`, `[Agent]`.
- **Type** — `Explore`, `Plan`, `Agent`, or custom `subagent_type`.
- Append `||` for parallel agents. Keep task description 3-6 words.

## Inline Role Attribution
When roles execute inline (no subagent): `[core] IPC contract updated`, `[qa] Tests: 14 passed`.

## Agent Collaboration Protocol
Roles collaborate via structured handoffs — finding-to-task principle.

Post structured comments on GitHub issues:
- **Starting**: Announce which role is taking over and what they will do.
- **Handoff**: Pass findings to the next role with context.
- **Review**: `clean` (no issues) or `findings` (list issues found).
- **Blocker**: Escalate issues that prevent progress.

Never skip a role's review.
