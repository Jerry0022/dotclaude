# Global Claude Preferences — Jerry0022

These rules apply to ALL projects and sessions. Context-specific rules live in skill deep-knowledge and are loaded on demand.

## Inheritance Model
- **Global = default**: `~/.claude/CLAUDE.md` applies to every session automatically.
- **Project = delta only**: Use `**Override (global §X):**` or `**Extends (global §X):**`. Never duplicate global rules.
- **Priority**: Override > Extends > Global. Details in `/project-setup` deep-knowledge (`inheritance-model.md`).

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
- **Completion card mandatory** after every completed task — format in `/ship` deep-knowledge (`completion-card.md`).

## Agent Naming
Format: `[role:X · Type] Task description`. Roles: `po`, `gamer`, `frontend`, `core`, `windows`, `ai`, `qa`. Append `||` for parallel agents.
Details (inline attribution, collaboration protocol): agent-conventions deep-knowledge (`naming-rules.md`).

## Interactive Questions (AskUserQuestion)
- **Prefer AskUserQuestion** when 2–4 clear options exist. Labels short, context in description.
- Chain rounds for complex topics. Use up to 4 independent questions per call. Use preview fields for visual comparisons.
- **WARTE Option**: Add `WARTE - Erst durchlesen` as first option when relevant context above might be scrolled out of view.
- Fall back to inline text only for nuanced, open-ended discussions.

## Visual Diagrams (Mermaid)
Proactively include Mermaid diagrams for architecture, decisions, status, explanations. One concept per diagram, `LR` direction preferred, always give descriptive `title`.
Render: `node ~/.claude/scripts/render-diagram.js "Title"` → port 9753 via Preview panel.

## Code Defaults
- UTF-8. English identifiers/comments/strings (except localization).
- Minimal changes — no refactoring or features beyond what was asked.
- No fallbacks by default — propose as option, implement only with explicit approval.

## Tool Selection (Windows)
- Always prefer dedicated tools (Read, Write, Edit, Glob, Grep) over Bash equivalents.
- Batch Bash calls with `&&`. Priority: functionality > aesthetics.

## Skill References
Commit, Ship, Test, Issues, Project-Setup, Agent-Conventions, Skill-Creation: detail rules in respective skill deep-knowledge files.
