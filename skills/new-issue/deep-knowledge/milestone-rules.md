# Milestone Rules

## Planning vs. Execution
- "Plan a milestone" / "milestone planen" = **planning mode only**: create GitHub milestone + issues, ask clarifying questions, set labels. No code, no commits.
- Implementation only begins when the user explicitly says to implement/execute a milestone or specific issues.
- Milestones are **not time-boxed** — they are done when all issues are closed. No due dates unless explicitly requested.

## Milestone naming convention

**Format:** `[Level] Short Title — descriptive half-sentence or list`

- **Title**: max 3 words, no `&` symbol. A mini-summary of what is being built.
- **Description**: after the dash, one half-sentence or comma-separated list. Never more than one sentence.

**Level prefix — auto-assigned based on issue composition:**

| Level | Rule | Example |
|-------|------|---------|
| `[New]` | Creates something that does not exist yet (new module, new feature area) | `[New] Profile Sync — Google Drive settings backup and restore` |
| `[Evolve]` | Improves or extends existing functionality | `[Evolve] UI Polish — internationalization, layout fixes, host shell cleanup` |
| `[Overhaul]` | Fundamentally redesigns or restructures existing code | `[Overhaul] Agent Architecture — crawler module redesign to read+execute agents` |
| `[Fix]` | **Only** when 100% of issues are `type:bug` | `[Fix] Startup Stability — settings freeze, tray daemon crash, overlay init` |

**Auto-assignment logic (evaluated when milestone is created or issues change):**
1. All issues `type:bug` → `[Fix]`
2. At least one issue creates a completely new feature area or module → `[New]`
3. Issues fundamentally restructure or redesign existing code → `[Overhaul]`
4. Otherwise (extend, polish, add minor features to existing) → `[Evolve]`

**Living title:** When issues are added or removed, re-evaluate the level and update the milestone title if the level no longer fits.

## Milestone labels

Milestones do **not** use `sprint:N` labels. Issue-to-milestone assignment is handled via the GitHub milestone field directly. The `sprint:*` label family is deprecated and should not be created for new projects.
