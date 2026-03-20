# Global Claude Preferences — dotclaude (Lite)

<!-- Token-optimized version for Free/Pro plans. ~1,200 tokens vs ~4,300 for full version. -->

These rules apply to ALL projects and sessions.

## Inheritance Model — Global ↔ Project

This global CLAUDE.md is the **baseline**. Project-level CLAUDE.md files extend or override — never duplicate.

- **Project = delta only**: Only additions, overrides, or project-specific details.
- **Override syntax**: `**Override (global §SectionName):**` + replacement rule.
- **Extension syntax**: `**Extends (global §SectionName):**` + additional details.
- New project CLAUDE.md: start with `<!-- Inherits from ~/.claude/CLAUDE.md — do not duplicate global rules here -->`, add only project-specific sections.
- Conflict resolution: explicit Override > Extends > global default.

## Autonomy
- Full autonomous access to all local files, commands, programs, and project actions.
- Never ask for per-action permission. Act, then report.
- Only confirm before: force-push to `main`/`master`, sending external communications, purchases.

## Language
- **Conversation language**: Match the user's language.
- **Project artifacts**: All documentation, GitHub artifacts, commit messages, code comments, README, CHANGELOG in **English**.
- Exception: explicit i18n/localization resource files.

## Token Awareness — Critical

Your context overhead is significant relative to the free plan budget. Every token counts.

- **Always choose the cheapest approach first**: targeted `Grep`/`Glob` over Explore agents, read specific files over broad searches.
- **Never launch Explore agents** for simple questions — use direct Grep/Glob/Read.
- **Read only what you need**: use `offset` and `limit` parameters for large files instead of reading the entire file.
- **Avoid reading files >500 lines** in full — read the relevant section only.
- **No speculative reads**: don't read files "just in case" — read only when you have a clear reason.
- **Batch tool calls**: make independent tool calls in parallel, not sequentially.
- **Keep responses short**: answer directly, no preamble, no trailing summary.
- **No proactive diagrams or research** unless explicitly requested.

## Response Style
- Be concise. Lead with the action or answer — no preamble.
- No trailing summaries restating what was just done.
- Use GitHub-flavored Markdown when structure helps.
- No emojis unless explicitly requested.

## Agent Naming Convention
When spawning subagents, format the `description` as: `[Type Mode] Task` — Type = `Explore`/`Plan`/`Agent`, Mode = `||` (parallel) or `->` (sequential). Example: `[Explore ||] Find nav components`

## Interactive Questions (AskUserQuestion)
- **Use AskUserQuestion** when the question has **2–4 clear options**. Keep labels short (1–5 words), context in description.
- **Chain multiple choice rounds** for complex topics.
- **Use up to 4 questions per call** when independent.
- **Fall back to inline text** only for nuanced open-ended discussions.

## Git Hygiene
- Before every commit: `git status --short` — ensure zero `??` untracked entries.
- Every new file: staged or added to `.gitignore`.

## Commit Style
- Conventional commits: `type(scope): subject`
- Always append: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Never `--no-verify`. Never `git add -A`.

## Versioning
- Semantic versioning (`major.minor.patch`) in `package.json`.
- `README.md` must display `**Version: x.y.z**` near the top.
- When bumping: update **all** version references in a **single commit** (package.json, README, CHANGELOG). Grep for old version before committing.
- Increment: `patch` for fixes, `minor` for features, `major` for breaking changes.

## GitHub Issues

**Title format:** `[TYPE] Short imperative description`

| `type:` label | Title prefix |
|---|---|
| `type:bug` | `[BUG]` |
| `type:feature` | `[FEATURE]` |
| `type:refactor` | `[REFACTOR]` |
| `type:chore` | `[CHORE]` |
| `type:design` | `[DESIGN]` |
| `type:docs` | `[DOCS]` |

- Imperative mood, sentence case, no trailing period. Never use `[FIX]`.
- **Required**: Labels (`type:*`, `role:*`, `priority:*`, `module:*`, `sprint:N`), Milestone, Project board.
- **Linked PRs**: Include `Closes #NNN` in PR body.

## AI Configuration Files in .gitignore
- **Share**: `CLAUDE.md`, `.claude/commands/`, `.claude/skills/`, `.claude/hooks/`
- **Ignore**: `.claude/worktrees/`, `.claude/todos/`, token caches, session state

## Code Defaults
- UTF-8 encoding. English identifiers, comments, strings (except i18n).
- Minimal changes — do not refactor or add features beyond what was asked.
- No fallbacks by default.
