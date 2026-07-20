# Backlog-Runner Skill — Extension Guide

## How to extend

Create project-specific backlog rules in your project:

```
{project}/.claude/skills/run-backlog/
├── SKILL.md        ← Override or add steps
└── reference.md    ← Project-specific context
```

Merge priority: **project > global > plugin defaults** (most specific wins).

## What to customize

- **Selection filter**: default `$ARGUMENTS` filters (e.g. always exclude a
  `wontfix`/`blocked` label, or restrict to `type:bug` milestones).
- **Triage thresholds**: what counts as `oversized` vs `ready` for your project
  (e.g. "any issue spanning >3 modules is oversized").
- **Refine template**: extra sections to write back into each issue (test plan,
  rollout notes, telemetry checklist) on top of the acceptance criteria +
  `**User value:**` line.
- **Ship gate**: project-specific pre-ship checks — these compose with the
  project's own `ship/` extension, which `/devops-ship` already reads.
- **Per-milestone strategy**: e.g. force a single hierarchical ship per milestone
  instead of per-issue (overrides Step 4 shipping granularity).

## Example extension (SKILL.md)

```markdown
## Selection filter
- Always exclude issues labelled `needs-triage` from the queue.

## Triage
- Treat any issue whose body mentions a schema/migration as `needs-decision`.

## Refine template
- Append a `## Test plan` section to every refined issue body.
```

## Notes

- This skill is the **ship instance** — it does not modify or route ships
  through `devops-run-autonomous`. Extensions must keep the ship safeguards intact:
  MCP ship tools only, own repo only, no force-push.
- GitHub writes (refine, sub-issue creation) run only in the presence phase
  (Step 2). Do not add extension steps that write to GitHub after the
  Post-Confirmation Lockout.
