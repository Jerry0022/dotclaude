# Milestone Rules

## Planning vs. Execution

- "Plan a milestone" = **planning mode only**: create GitHub milestone + issues, ask questions, set labels. No code.
- Implementation begins only when the user explicitly says to implement.
- Milestones are **not time-boxed** — done when all issues are closed.

## Naming convention

**Format:** `[Level] Short Title — descriptive half-sentence or list`

- **Title**: max 3 words, no `&` symbol.
- **Description**: after the dash, one half-sentence or comma-separated list.

## Level prefix (auto-assigned)

| Level | Rule | Example |
|-------|------|---------|
| `[New]` | Creates something that does not exist yet | `[New] Profile Sync — Google Drive settings backup` |
| `[Evolve]` | Improves or extends existing functionality | `[Evolve] UI Polish — internationalization, layout fixes` |
| `[Overhaul]` | Fundamentally redesigns or restructures | `[Overhaul] Agent Architecture — crawler module redesign` |
| `[Fix]` | **Only** when 100% of issues are `type:bug` | `[Fix] Startup Stability — settings freeze, tray crash` |

**Auto-assignment logic:**
1. All issues `type:bug` → `[Fix]`
2. At least one issue creates a new feature area → `[New]`
3. Issues restructure existing code → `[Overhaul]`
4. Otherwise → `[Evolve]`

**Living title:** Re-evaluate the level when issues are added or removed.
