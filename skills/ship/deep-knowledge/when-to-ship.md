# When to Ship & Completion Flow

When a unit of work is complete (feature, bug fix, design asset, refactor — anything with committed changes on a branch), execute the **full shipping pipeline** as a single uninterrupted step. Do not stop at the PR — carry through to merge and verification.

**The step-by-step flow is defined in the global `/ship` skill** (`~/.claude/skills/ship/SKILL.md`). The skill is the canonical implementation — always invoke it rather than running steps manually. Project-level `/ship` skills extend the global skill with project-specific details (commands, extra steps, etc.).

**Agent-delegated execution:** The ship flow runs inside a **subagent** to avoid consuming main-context tokens. The main context collects metadata (branch, issues, version bump decision) and spawns an Agent that executes all steps independently. This prevents mid-flow context compression (which would re-trigger SessionStart hooks). The agent returns a structured result; the main context renders the completion card.

**When to ship (project repos — NOT dotclaude):**
- **Ship automatically** (no user prompt) when a clear unit of work is complete: an issue is fully implemented, a whole topic is wrapped up, or the user explicitly says something is done.
- **Offer to ship** (AskUserQuestion) when uncertain — e.g., multiple small changes that might or might not be done, or when the user's intent is ambiguous.
- **Do NOT offer/ship** for intermediate states — this includes: small tweaks, WIP changes, code that hasn't been verified/tested yet, or when the user is clearly still iterating. A code edit without verification is not a complete unit of work. Avoid pestering the user after every request.
- **Ship prompt timing**: The ship prompt (automatic or AskUserQuestion) must come exactly **once**, at the very end — after all implementation, verification, and follow-up fixes are done. Never ask mid-task, then ask again after testing. If you plan to verify/test after editing, the ship prompt belongs after the test, not before it.
- Rule of thumb: ship should feel natural, not annoying. When in doubt, lean toward just doing it silently for complete work, and skipping it for incomplete work.

**Key rules:**
- Never leave merged PRs with a stale local `main` — always pull after merge.
- Never stop at "PR created" — the work is not done until the user can test it locally.
- If running in a worktree: after merge, ensure the main repo's `main` branch is also updated.
- Post-ship cleanup: see branching.md §Local Cleanup. Session-ending WIP behavior: see branching.md §Branch Lifecycle.

## Global Config — Dotclaude Repository

The `~/.claude/` directory is the dotclaude git repo. No separate project folder, no sync scripts. Changes are committed and pushed directly.

### Shipping global config changes

Use `/ship-dotclaude` to commit and push changes from `~/.claude/`. This works from any project session — the skill runs git commands against `~/.claude/` regardless of the current working directory.

**Rules:**
- Treat global config changes like code changes: they are not "done" until committed and pushed.
- If a session modifies both project files and global config, ship the project first (via `/ship`), then run `/ship-dotclaude`.
- If a session only modifies global config (no project changes), go straight to `/ship-dotclaude`.

### Proactive ship prompt (Jerry0022 only)

**Important:** Dotclaude config pushes **always require user confirmation** via AskUserQuestion. Never push global config changes silently.

When **any** global config file (`~/.claude/` — CLAUDE.md, skills, scripts, commands) is modified during a session, **proactively ask** whether to ship via `/ship-dotclaude`. Options:
1. **Ship** (recommended) — commit and push all uncommitted changes in `~/.claude/`
2. **Skip** — do not ship now
