# Global Claude Preferences — Jerry0022

These rules apply to ALL projects and sessions. Context-specific rules live in skill deep-knowledge and are loaded on demand.

## Inheritance Model — Global ↔ Project

This global CLAUDE.md is the **baseline** for every project. Project-level CLAUDE.md files extend or override it — they must never duplicate global rules.

### Principles
- **Global = default**: Every rule here applies automatically in every project session.
- **Project = delta only**: Only additions, overrides, or project-specific details. Use `**Override (global §SectionName):**` or `**Extends (global §SectionName):**` syntax.
- Project-level skills with the same name **extend** the global skill — describe only the delta.
- Hooks follow the same principle: extend, not replace (unless marked as **Override**).

### New Project Setup
1. Do **not** copy any global rules into the project file.
2. Start with `<!-- Inherits from ~/.claude/CLAUDE.md — do not duplicate global rules here -->`.
3. Use **Extends** syntax for project-specific parameters.

### Drift Detection
At session start, compare global CLAUDE.md against the project's `<!-- global-sync: YYYY-MM-DD -->` comment. If changed: identify affected sections, check for redundancy/conflicts, ask user (AskUserQuestion) to adopt/keep/merge, update sync date.

### Conflict Resolution Priority
1. Explicit project **Override** → wins over global.
2. Project **Extends** → global applies, project additions layered on top.
3. No annotation → global applies (project duplicate should be cleaned up).

### The dotclaude Repository
`~/.claude/` **is** the dotclaude git repo (`Jerry0022/dotclaude`). `settings.json` and session state are in `.gitignore`. The `.claude/` subdirectory holds project-level Claude settings (also gitignored). Since `~/.claude/` is both global config dir and project root, Claude Code loads CLAUDE.md twice — ignore the project copy.

## Autonomy
- Full autonomous access to all local files, commands, programs, and project actions.
- Never ask for per-action permission. Act, then report.
- Only confirm before: force-push to `main`/`master`, sending external communications, purchases.

## Language
- **Conversation language**: Always match the user's language — **German** for all chat, AskUserQuestion, explanations, plan text.
- **Project artifacts**: English for all documentation, GitHub artifacts, commit messages, code comments, README, CHANGELOG.
- Exception: explicit i18n/localization resource files.

## Token Awareness

### Per-operation guard
- Avoid reading files >20,000 tokens unless absolutely necessary.
- Confirm with user before operations estimated to cost ≥2% of session limit.
- **Token cost = Claude processing cost only.** Commands Claude merely executes (git, rm, mkdir, etc.) have zero token cost and must never be blocked.

### Strategic budget awareness
- Before actions consuming >2% of weekly limit: evaluate if proportionate, ask if uncertain, choose cheaper approach if disproportionate.
- When 5h window >70%: prefer targeted over broad operations.
- When weekly limit >60%: mention budget state when proposing large tasks.
- **Never refuse work** — the user decides. Surface the cost trade-off.

## Response Style
- Be concise. Lead with the action or answer — no preamble.
- No trailing summaries restating what was just done.
- GitHub-flavored Markdown when structure helps. No emojis unless requested.
- **Completion card**: Always end completed tasks with a completion card. Format details in `/ship` skill deep-knowledge (`completion-card.md`).

## Agent Naming Convention

### Format: `[role:X · Type] Task description`
- **role:X** — agent team role (`po`, `gamer`, `frontend`, `core`, `windows`, `ai`, `qa`). If no role applies, use type alone: `[Explore]`, `[Plan]`, `[Agent]`.
- **Type** — `Explore`, `Plan`, `Agent`, or custom `subagent_type`.
- Append `||` for parallel agents. Keep task description 3-6 words.

### Inline role attribution
When roles execute inline (no subagent): `[core] IPC contract updated`, `[qa] Tests: 14 passed`.

### Agent collaboration protocol
Roles collaborate via structured handoffs — finding-to-task principle. Post structured comments on GitHub issues: Starting, Handoff, Review clean/findings, Blocker. Never skip a role's review.

## Interactive Questions (AskUserQuestion)
- **Prefer AskUserQuestion** when 2–4 clear options exist. Labels short, context in description.
- Chain rounds for complex topics. Use up to 4 independent questions per call. Use preview fields for visual comparisons.
- **WARTE Option**: Add `WARTE - Erst durchlesen` as first option when relevant context above might be scrolled out of view. Sequential questions: hold all follow-ups until WARTE is resolved.
- Fall back to inline text only for nuanced, open-ended discussions.

## Visual Diagrams (Mermaid)
Proactively include Mermaid diagrams for architecture, decisions, status, explanations. One concept per diagram, `LR` direction preferred, always give descriptive `title`.

### Rendering
Pipe into `node ~/.claude/scripts/render-diagram.js "Title"` → served on port 9753 via Preview panel.

## Git Hygiene
- Before every commit: `git status --short` — zero `??` (untracked) entries.
- Every new file: staged or added to `.gitignore`. Previously tracked but should be ignored: `git rm --cached`.

## Commit Style
- Conventional commits: `type(scope): subject`. Never `--no-verify`. Never `git add -A`.
- Co-author footer: detect model dynamically from system prompt (Opus/Sonnet/Haiku).
- Commit granularity details in `/commit` skill deep-knowledge (`commit-granularity.md`).

## Branching, Versioning & Shipping
Core rules live in `/ship` skill deep-knowledge — loaded when shipping. Key summaries:
- **Branches**: `feat/<issue>-<desc>`, `fix/<issue>-<desc>`, `chore/<issue>-<desc>`. Details in `branching.md`.
- **Versioning**: Semantic versioning in `package.json` + README badge. Build ID via `git write-tree | cut -c1-7`. Bump decision at ship time. Details in `versioning.md`.
- **Release**: Tag `vX.Y.Z` after merge, trigger GitHub Actions. Details in `release-flow.md`.
- **When to ship**: Auto-ship complete work, offer for uncertain, skip intermediate. Details in `when-to-ship.md`.
- **Build-ID bei App-Start**: After every app start, show the **test prompt card** via the `/start` skill (format in its deep-knowledge `test-prompt-card.md`). Minimal version for standalone starts, with test steps after code changes. Projects extend `/start` with project-specific launch methods (e.g. `/dev-start`).

## GitHub Issues & Milestones
Managed via `/new-issue` skill. Key rules:
- Title: `[TYPE] Short imperative description`. Never `[FIX]` — use `[BUG]`.
- Required: `type:*` + `role:*` + `module:*` labels, milestone, project board item.
- Link PRs via `Closes #NNN`. Details in `/new-issue` deep-knowledge.

## Test Execution
Details in `/test` skill deep-knowledge (`test-strategy.md`). Key rules:
- Task-specific tests immediately after changes. Full suite only at ship time.
- Skip preview for non-runtime changes (config, docs, build assets).
- Always include user-facing test plan for visible changes.
- **Test prompt card**: Every app start ends with the test prompt card. Owned by `/start` skill (see its deep-knowledge `test-prompt-card.md`).

## AI Configuration Files in .gitignore
Details in `/project-setup` skill. Key rule: track shared config (CLAUDE.md, skills, hooks), ignore session state (worktrees, todos, caches).

## Skill Creation & Refinement
- Always use the Anthropic `skill-creator` skill to refine new skills.
- At minimum: draft, then run description optimizer. For verifiable outputs: run eval loop.

## Code Defaults
- UTF-8. English identifiers/comments/strings (except localization).
- Minimal changes — no refactoring or features beyond what was asked.
- No fallbacks by default — propose as option, implement only with explicit approval.

## Tool Selection — Minimize Terminal Windows (Windows)
- Always prefer dedicated tools (Read, Write, Edit, Glob, Grep) over Bash equivalents.
- Batch Bash calls with `&&`. Priority: functionality > aesthetics.

## Session Startup
### Branch & worktree sweep (hook)
Handled automatically by `sweep-branches.js` SessionStart hook. Cleans up garbage, preserves branches with remote counterparts.
