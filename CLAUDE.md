# Global Claude Preferences — Jerry0022

These rules apply to ALL projects and sessions. Context-specific rules live in skill deep-knowledge and are loaded on demand.

## Inheritance Model
- **Global = default**: `~/.claude/CLAUDE.md` applies to every session automatically.
- **Project = delta only**: Use `**Override (global §X):**` or `**Extends (global §X):**`. Never duplicate global rules.
- **Priority**: Override > Extends > Global. Details in `/project-setup` deep-knowledge (`inheritance-model.md`).
- **Source of truth**: CLAUDE.md instructions, skill definitions, and agent configs are authoritative. Feedback memories are supplementary — when a memory conflicts with a current skill/agent/CLAUDE.md rule, the defined source wins. After skill or workflow updates, proactively reconcile stale feedback memories instead of preserving outdated behavior.

## Autonomy
- Full autonomous access to all local files, commands, programs, and project actions.
- Never ask for per-action permission. Act, then report.
- Only confirm before: force-push to `main`/`master`, sending external communications, purchases.

## Language
- **Conversation language**: Always match the user's language — **German** for all chat, AskUserQuestion, explanations, plan text.
- **Project artifacts**: English for all documentation, GitHub artifacts, commit messages, code comments, README, CHANGELOG.
- Exception: explicit i18n/localization resource files.

## Token Awareness
- Hooks guard expensive operations automatically (`precheck-cost.js`).
- **Never refuse work** — surface the cost trade-off, let the user decide.
- Details in `/refresh-usage` deep-knowledge (`token-awareness.md`).

## Response Style
- Be concise. Lead with the action or answer — no preamble. No trailing summaries.
- GitHub-flavored Markdown when structure helps. No emojis unless requested.
- **Completion card mandatory** after every completed task — invoke `/ship` deep-knowledge (`completion-card.md`) for format.
- **Test prompt card mandatory** after every app start — invoke `/start` skill to render it.
- **Test verification mandatory** after code changes — invoke `/test` skill to verify.
- **Completion Flow** (§below) defines the mandatory sequence: `/start` → `/test` → completion card. These are **explicit skill invocations**, not suggestions to follow a format. The skills contain project-specific logic that must execute.
- These cards are **non-negotiable output contracts** — skipping them is a rule violation, not a style choice.

## Agent Naming
Format: `[role:X · Type] Task description`. Roles: `po`, `gamer`, `frontend`, `core`, `windows`, `ai`, `qa`. Append `||` for parallel agents.
Details (inline attribution, collaboration protocol): agent-conventions deep-knowledge (`naming-rules.md`).

## Subagent Obligations
Subagents inherit **all output contracts** from the main context:
- **Completion card**: Every subagent that completes a code-change task must render a completion card (format in `/ship` deep-knowledge).
- **Test prompt card**: Every subagent that starts/restarts an app must render a test prompt card (format in `/start` deep-knowledge).
- **Skill invocation**: Subagents must invoke `/test` and `/start` skills when their trigger conditions are met — these are not optional for delegated work.
- If a subagent cannot render a card (e.g., pure research), the **main context** must render the card after receiving the subagent's result.
- The main context is responsible for verifying subagent output includes required cards before presenting results to the user.

## Interactive Questions (AskUserQuestion)
- **Prefer AskUserQuestion** when 2–4 clear options exist. Labels short, context in description.
- Chain rounds for complex topics. Use up to 4 independent questions per call. Use preview fields for visual comparisons.
- **WARTE Option**: Add `WARTE - Erst durchlesen` as first option when relevant context above might be scrolled out of view.
- Fall back to inline text only for nuanced, open-ended discussions.

## Visual Diagrams (Mermaid)
Proactively include Mermaid diagrams for architecture, decisions, status, explanations. One concept per diagram, `LR` direction preferred, always give descriptive `title`.
Render: `node ~/.claude/scripts/render-diagram.js "Title"` → port 9753 via Preview panel.

## Completion Flow
After completing code changes for a task, follow this mandatory sequence:

1. **Invoke `/start`** — triggers the project-specific dev server/app start. This is an **explicit skill invocation**, not a suggestion. Load the skill, execute its steps, render the test prompt card. If the project has no `/start` skill or launch config, skip to step 2.
2. **Invoke `/test`** — triggers verification of the changes. This is an **explicit skill invocation**. Load the skill, execute its verification steps, render the test plan. For non-runtime changes (docs, config, scripts), `/test` determines whether to skip preview — the skill handles this, not the caller.
3. **Render completion card** — format in `/ship` deep-knowledge (`completion-card.md`). Always the last thing in the response.

**Skill invocation is mandatory, not advisory.** The `/start` and `/test` skills contain project-specific logic (SSH deploy, browser testing, log inspection, etc.) that cannot be replicated by ad-hoc commands. Skipping the skill invocation means skipping the project's defined verification pipeline.

**When to invoke `/start`:**
- Implementation complete, test plan needed → invoke `/start`, then `/test`, then completion card.
- Ship flow quality gates → invoke `/start` if not already running, run tests against live app.

**When NOT to invoke `/start`:**
- Pure documentation, config, or non-code changes (nothing to test visually).
- User immediately brings up a new topic (no pause for testing).
- Dev server/app is already running from this session.

**When to invoke `/test`:**
- After every code change that affects visible output or runtime behavior.
- After `/start` completes, to verify the running app.
- The `/test` skill itself decides whether to skip (for non-runtime changes) — always invoke it and let it decide.

Projects extend this with project-specific launch methods, cache cleanup paths, and pre-conditions via `/start` skill extensions.

## Code Defaults
- UTF-8. English identifiers/comments/strings (except localization).
- Minimal changes — no refactoring or features beyond what was asked.
- No fallbacks by default — propose as option, implement only with explicit approval.

## Tool Selection (Windows)
- Always prefer dedicated tools (Read, Write, Edit, Glob, Grep) over Bash equivalents.
- Batch Bash calls with `&&`. Priority: functionality > aesthetics.

## Ship Safety — Zero-Loss Guarantee

These rules override any cleanup or convenience logic in the ship flow:

1. **No cleanup before confirmed merge.** Step 11 (branch/worktree deletion) MUST NOT execute unless the PR merge (Step 8) succeeded and the merge commit is visible on `main`. If any step fails, all branches and worktrees are preserved.
2. **No ship with dirty state.** Step 0 (Pre-Flight Gate) blocks shipping when untracked or uncommitted files exist. Every file must be either committed or explicitly gitignored before `/ship` proceeds.
3. **Warn about orphaned worktrees.** Before cleanup, check all worktrees for uncommitted changes and warn the user about any that would be lost.
4. **Never delete what isn't merged.** A branch may only be deleted (local or remote) after its commits are reachable from `main`. Verify with `git merge-base --is-ancestor <branch> main`.
5. **Session-end obligation.** When a session ends mid-work (without `/ship`), commit and push all current state — even WIP. Never leave uncommitted changes in a worktree that could be cleaned up by the next session.

## Skill References
Commit, Ship, Test, Issues, Project-Setup, Agent-Conventions, Skill-Creation: detail rules in respective skill deep-knowledge files.
