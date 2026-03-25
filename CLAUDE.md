# Global Claude Preferences — Jerry0022

These rules apply to ALL projects and sessions.

## Inheritance Model — Global ↔ Project

This global CLAUDE.md is the **baseline** for every project. Project-level CLAUDE.md files extend or override it — they must never duplicate global rules.

### Principles
- **Global = default**: Every rule here applies automatically in every project session. Project CLAUDE.md files inherit all global rules implicitly.
- **Project = delta only**: A project CLAUDE.md must contain **only** additions, overrides, or project-specific details. If a rule is identical to the global version, it does not belong in the project file.
- **Override syntax**: To explicitly override a global rule, use `**Override (global §SectionName):**` followed by the replacement rule. This makes it clear which global rule is being changed and why.
- **Extension syntax**: To extend a global rule with project-specific details, use `**Extends (global §SectionName):**` followed by the additional details.

### New Project Setup
When creating a CLAUDE.md for a new project:
1. Do **not** copy any global rules into the project file.
2. Start with a project header and only add sections that are project-specific (tech stack, architecture, custom commands, module map, etc.).
3. Include a comment at the top: `<!-- Inherits from ~/.claude/CLAUDE.md — do not duplicate global rules here -->`
4. If a global rule needs project-specific parameters (e.g., the test command differs from `npm run test:unit`), use the **Extends** syntax.

### Skill & Hook Inheritance
- **Global skills** (in `~/.claude/skills/`) are the canonical versions. Project-level skills with the same name **extend** the global skill — they must not redefine the entire flow.
- A project-level skill must reference the global version and describe **only the delta**: project-specific build steps, different commands, additional checks, etc.
- Example: A project `/ship` skill should say _"Extends global /ship with: use `npm run build:prod` in step 3, merge strategy is `--merge` not `--squash`"_ — not restate the entire 7-step flow.
- Same principle applies to hooks: project hooks extend global hooks, not replace them (unless explicitly marked as **Override**).

### Drift Detection — Global Changes in Project Sessions
At the start of every project session, compare the global CLAUDE.md's last-modified timestamp (or content hash) against the project's last-synced state. If the global has changed since the last project session:

1. **Identify affected sections**: Determine which global sections were added, modified, or removed.
2. **Check for redundancy**: If the project CLAUDE.md contains rules that are now covered by a new or updated global rule, flag them for removal.
3. **Check for conflicts**: If a project override or extension conflicts with the updated global rule, **ask the user** (via AskUserQuestion) which path to take:
   - **Adopt global**: Remove the project override and use the new global rule.
   - **Keep project override**: Retain the project-specific version and update the Override reference to point to the new global section.
   - **Merge**: Combine both — take the global update but keep project-specific additions.
4. **Track sync state**: After resolution, update a `<!-- global-sync: YYYY-MM-DD -->` comment in the project CLAUDE.md so future sessions know when the last sync happened.
5. **Report changes**: Briefly inform the user what was synced/resolved — do not silently change project behavior.

### The dotclaude Repository
The `~/.claude/` directory **is** the dotclaude git repo (`Jerry0022/dotclaude`). There is no separate project folder — the global config directory is the repo itself.

**Implications:**
- No sync needed — changes to global config are made directly in the repo.
- `/ship-dotclaude` commits and pushes from `~/.claude/` directly.
- `settings.json` is in `.gitignore` (contains MCP UUIDs and local paths).
- Session state (worktrees, todos, session-env, etc.) is in `.gitignore`.
- The `.claude/` subdirectory within `~/.claude/` holds project-level Claude settings for the dotclaude repo itself (also gitignored).

**Token note:** Since `~/.claude/` is both the global config dir and the project root, Claude Code loads `CLAUDE.md` as both global and project instructions. The content is identical — ignore the project copy to avoid processing it twice.

### Conflict Resolution Priority
When a rule exists at both levels:
1. Explicit project **Override** → wins over global.
2. Project **Extends** → global rule applies, project additions are layered on top.
3. No annotation → global rule applies (project duplicate is ignored and should be cleaned up).

## Autonomy
- Full autonomous access to all local files, commands, programs, and project actions.
- Never ask for per-action permission. Act, then report.
- Only confirm before: force-push to `main`/`master`, sending external communications, purchases.

## Milestone Planning vs. Execution
- "Plan a milestone" / "milestone planen" = **planning mode only**: create GitHub milestone + issues, ask clarifying questions, set labels. No code, no commits.
- Implementation only begins when the user explicitly says to implement/execute a milestone or specific issues.
- Milestones are **not time-boxed** — they are done when all issues are closed. No due dates unless explicitly requested.

### Milestone naming convention

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

**Living title:** When issues are added or removed, re-evaluate the level and update the milestone title if the level no longer fits. The `/milestone` skill (project-specific) handles creation; the `/new-issue` skill handles re-evaluation when assigning issues.

### Milestone labels

Milestones do **not** use `sprint:N` labels. Issue-to-milestone assignment is handled via the GitHub milestone field directly. The `sprint:*` label family is deprecated and should not be created for new projects.

## Language
- **Conversation language**: Always match the user's language. The user speaks **German** — all chat responses, AskUserQuestion labels/descriptions, inline explanations, and plan text must be in German.
- **Project artifacts**: All documentation, GitHub artifacts (issues, PRs, milestones, project titles/views), commit messages, code comments, README, and CHANGELOG must be in **English**.
- Exception: explicit i18n/localization resource files (e.g. `de.json`, `i18n/de/`).
- Apply this retroactively when editing existing files.

## Token Awareness

### Per-operation guard
- Avoid reading files listed as expensive (>20,000 tokens) unless absolutely necessary.
- Use targeted skills (`/ipc-validate`, `/angular-health`, `/rsi-style`) instead of reading raw large files.
- Confirm with the user before any operation estimated to cost ≥2% of the session limit (~20,000 tokens).
- **Token cost = Claude processing cost only.** The cost hook guards against operations where Claude must *read and analyze* large output. Commands that Claude merely *executes* without processing content (git push, git fetch, git add, git commit, gh pr create, rm, mkdir, cp, mv, etc.) have zero token cost and must never be blocked — even if they reference large files by name. The hook's `noTokenCostPattern` allowlist handles this automatically.
- When the cost hook blocks an operation, it lists the specific large files and their sizes/token estimates so you can report them to the user.

### Strategic budget awareness
The completion card displays live rate limit data (5h window + weekly) after every task. **Actively use this data** when planning work:

- Before any action likely to consume **>2% of the weekly limit** (broad codebase exploration, large Explore agents, full-repo grep, multi-file rewrites), pause and evaluate:
  1. **Prompt justifies it** (complex implementation, broad concept, large milestone) → proceed, this is what tokens are for.
  2. **Uncertain** whether the cost is proportionate → ask the user: "This will be token-intensive (~X%). Proceed?"
  3. **Clearly disproportionate** (simple question or small fix triggering massive exploration) → choose a cheaper approach first (targeted grep, read specific files, use cached knowledge).
- When the **5h window is >70%**, prefer targeted over broad operations. Ask before launching Explore agents or reading >5 files.
- When the **weekly limit is >60%**, mention the budget state when proposing large tasks so the user can prioritize.
- **Never refuse work** because of budget — the user decides. But surface the cost trade-off so they can make an informed choice.
- Goal: spread usage comfortably across the week. Using 90% by day 5 of 7 is fine. Using 90% on day 1 is not.

## Response Style
- Be concise. Lead with the action or answer — no preamble.
- No trailing summaries restating what was just done.
- Use GitHub-flavored Markdown when structure helps.
- No emojis unless explicitly requested.

### Task Completion Signal

When a task is complete, **always** end with a completion card. This is the only place where emojis are always allowed. The signal must be consistent and recognizable across all sessions. Note: `<details>` tags do NOT render in Claude Code — use blockquotes for the details section instead.

**Format:**
```markdown
---

## ✨ <build-id> · <short summary, max ~10 words>

<status> auf remote `<branch>` via <ship method>
\
First change or action
Second change or action

file1 — what changed
file2 — what changed

📊 5h: <pct>% (+<delta>%) | Weekly: <pct>% (+<delta>%) | Sonnet: <pct>% (+<delta>%)

---
```

**Title line logic:**
- **With build ID** (code changes that produced a testable state): `## ✨ a3f9b21 · Filter UI implementiert`
- **Without build ID** (no testable state — docs, config, research): `## ✨ Erledigt · CLAUDE.md aktualisiert`

**Status line variants:**
- **Shipped** — work is merged and live. Format: `Shipped auf remote <branch> via <method>`.
- **Nicht shipped** — work is done but not shipped. Append: "Soll ich shippen?" (or ship automatically per §Completion Flow rules).
- **Ship blockiert** — done but ship failed (tests, merge conflict, etc.). Explain why.
- **Erledigt** — for tasks without code changes (config, research, explanation). Omit status line.

**Ship methods:** `direct push` (pushed without PR), `Pull-Request-Merge (PR #N)` (merged via PR).

**Usage line (always last line before closing `---`):**
- **Always** run `/refresh-usage` (no caching — always scrape live data) right before rendering the completion card.
- Read `usage-live.json` **before** the refresh to capture the previous state. After the refresh, read the new state. Compute the delta (`new_pct - old_pct`) for each metric.
- Format: `📊 5h: <pct>% (+<delta>%) | Weekly: <pct>% (+<delta>%) | Sonnet: <pct>% (+<delta>%)`
- If the delta is 0, show `(+0%)`. If the previous file was missing (first refresh of the session), show `(+0%)` as well — never use `(—)` which looks like an error.
- If the refresh fails, show `📊 [no data]` — do not block the completion card.
- This is the **only** place where usage is displayed — no session start display, no background refresh.

**Rules:**
- The completion card is **always** the last thing in the response — nothing after it. If additional context arises after composing the card (hook output, afterthoughts, caveats), place it **before** the card block, never after. The `---` closing line is the absolute end of the response.
- Use `##` heading for the title line — gives it visual weight and spacing.
- Use a backslash `\` on its own line after the status line to force a visual break before the plain-text details (blank lines alone get swallowed by the renderer).
- The summary is in the user's language (German), max ~10 words.
- Branch info is omitted for branchless tasks.
- Plain text (no bold, no inline code, no bullet markers) for actions and files — this renders in the terminal's default gray, visually subdued compared to the bold title and status line. Actions first, then files below (separated by a blank line). The usage line comes after files (or after actions if no files). End the entire card with a `---` line at the very bottom. For non-code tasks, omit the files section but still show the usage line.
- Keep it factual — no commentary or praise.

## Agent Naming Convention
When spawning subagents via the Agent tool, the `description` field is the only thing the user sees in the UI. Make it informative — the user must always know **which role** is acting and **what it does**.

### Format
```
[role:X · Type] Task description
```

- **role:X** — the agent team role driving this work (`po`, `gamer`, `frontend`, `core`, `windows`, `ai`, `qa`). If no project role applies (e.g., pure codebase exploration unrelated to a role), use the technical type alone: `[Explore]`, `[Plan]`, `[Agent]`.
- **Type** — the technical subagent type: `Explore`, `Plan`, `Agent` (general-purpose), or a custom `subagent_type` name.
- Keep the task description short (3-6 words).

### Parallel vs. sequential indicator
When multiple agents launch in the same turn, append `||` after the bracket to signal parallel execution. For a single sequential agent, no indicator is needed.

### Examples
| Scenario | Description |
|----------|-------------|
| QA running tests | `[role:qa · Agent] Run test suite` |
| Gamer checking copy | `[role:gamer · Agent] Lore-check changed strings` |
| Frontend health check | `[role:frontend · Agent] Angular health check` |
| Two parallel explores | `[role:frontend · Explore ||] Find nav component` + `[role:core · Explore ||] Find IPC contract` |
| Non-role exploration | `[Explore] Find config files` |
| Planning agent | `[role:po · Plan] Review issue scope` |

### Inline role attribution (no subagent)
When roles execute inline (no subagent spawned — typical for small changes), attribute output with role tags so the user sees which role produced each result:

```
[core] IPC contract updated — new event: `foo:bar`
[frontend] Consuming `foo:bar` in FooComponent — /angular-health: clean
[gamer] Copy review — 2 strings updated, tone approved
[qa] Tests: 14 passed, 0 failed
```

This applies to both GitHub issue comments (structured handoff comments) and direct conversation output.

### Agent collaboration protocol

When multiple roles work on a shared task, they collaborate via structured handoffs. A finding by one role becomes a task for another — this is the **finding-to-task principle**.

**Finding → task examples:**
- `frontend` finds a broken contract → hands off to `core` to fix it first
- `gamer` finds an untranslated string → hands off to `frontend` to fix the template
- `qa` finds a failing test → hands off to the owning role to fix it
- `core` renames an event → triggers all consuming roles to update before proceeding

**When working on a GitHub issue — post a structured comment for every handoff:**
- Starting: `[role:X] Starting — scope: <summary>`
- Handoff: `[role:X] Done — <what changed>. Passing to role:Y for <reason>`
- Review clean: `[role:X] Review pass clean. Ready for role:Y`
- Review findings: `[role:X] Review pass — <N findings>, fixing now`
- Blocker: `[role:X] Blocked — <reason>. Needs: <decision>`

**When no GitHub issue exists** (direct code change, prompt-driven) — exchange results inline using the role attribution format above.

**Rules:**
- Never skip a role's review because "it probably won't find anything." Run it and let the output decide.
- If a role's finding requires changes outside its own module, it explicitly names the responsible role before proceeding.

## Interactive Questions (AskUserQuestion)
When a decision or clarification is needed, **prefer the AskUserQuestion tool** over inline text questions whenever possible. Rules:
- **Use AskUserQuestion** when the question has **2–4 clear options** (the tool always adds an "Other" free-text option automatically). Keep labels short (1–5 words), put context in the description field.
- **Chain multiple choice rounds** if the topic is complex: ask the first question, then based on the answer ask a follow-up — rather than dumping all options at once.
- **Use up to 4 questions per call** when the questions are independent of each other (e.g., "Which framework?" + "Which styling?" in one call).
- **Use preview fields** when options involve visual or code comparisons (ASCII mockups, config snippets, diagram variants).
- **"Erst reviewen" Option**: Wenn vor der AskUserQuestion-Frage viel Text ausgegeben wurde (Erklärungen, Pläne, Diffs, etc.), füge als **erste Option** immer eine "Erst reviewen" Variante hinzu — Label: `WARTE - Erst durchlesen`, Description: `Ich pausiere — lies den Text oben in Ruhe, dann antworte.` Das "WARTE" in Großbuchstaben macht die Option sofort erkennbar. Bei kurzen/einfachen Fragen ohne vorherigen Textblock ist diese Option nicht nötig.
- **Sequenzielle Fragen bei "WARTE"**: Wenn ein AskUserQuestion-Call mehrere Fragen enthält und der User bei einer Frage `WARTE - Erst durchlesen` wählt, werden **alle nachfolgenden Fragen zurückgehalten**. Erst wenn der User die wartende Frage real beantwortet hat (nicht nur "WARTE" geklickt), darf die nächste Frage gestellt werden. Niemals eine Folgefrage stellen, solange eine vorherige im WARTE-Status ist.
- **Fall back to inline text** only when the topic is too nuanced for bullet-point options — e.g., open-ended architecture discussions with many trade-offs. In that case, present a structured plan with numbered questions in the output text.
- Never mix both styles for the same question — either AskUserQuestion or inline, not both.

## Visual Diagrams (Mermaid)
Proactively include **Mermaid diagrams** to make responses clearer. Do not describe what could be shown — render it.
- **Architecture & planning**: flowcharts, sequence diagrams, or C4-style component diagrams when discussing system design, module interactions, or milestone plans.
- **Decision summaries**: flowcharts or decision trees when presenting options, trade-offs, or conditional logic.
- **Status & progress**: Gantt charts for milestone timelines, state diagrams for workflow states.
- **Explanations**: sequence diagrams for request flows, class diagrams for data models, ER diagrams for database schemas.
- Keep diagrams **focused** — one concept per diagram. Split into multiple diagrams rather than cramming everything into one.
- Always give the diagram a descriptive `title`.
- Prefer `LR` (left-to-right) direction for flowcharts unless vertical layout is clearly better.

### Rendering
Render diagrams via the Preview panel pipeline — do **not** use the Mermaid MCP tool (output too large):
1. Pipe Mermaid code into `node ~/.claude/scripts/render-diagram.js "Title"` — this writes `~/.claude/scripts/diagrams/index.html` using the styled template.
2. The diagram server (`launch.json` config `diagrams`, port 9753) serves the HTML. The Preview panel auto-reloads.
3. Template: `~/.claude/scripts/diagrams/template.html` — dark theme, Patrick Hand font, SVG postprocessing for cluster label positioning.

## Branching Strategy

### Branch naming convention

| Branch type | Pattern | Example |
|-------------|---------|---------|
| Feature/issue | `feat/<issue>-<short-desc>` | `feat/42-video-filters` |
| Agent sub-branch | `feat/<issue>/<role>` | `feat/42/core`, `feat/42/frontend` |
| Bugfix | `fix/<issue>-<short-desc>` | `fix/55-startup-crash` |
| Chore/refactor | `chore/<issue>-<short-desc>` | `chore/60-cleanup-imports` |

### When to use sub-branches

| Scope | Strategy |
|-------|----------|
| Simple change (1–2 roles, <5 files) | Single `feat/<issue>` branch — no sub-branches |
| Multi-role change (3+ roles) | Integration branch `feat/<issue>` + sub-branches `feat/<issue>/<role>` per agent |
| Orchestrated agents (`agents:run`) | Each agent gets its own sub-branch and worktree automatically |

### Multi-branch workflow

```
main
 └── feat/42-video-filters          ← integration branch
      ├── feat/42/core               ← agent sub-branch (worktree)
      ├── feat/42/frontend            ← agent sub-branch (worktree)
      └── feat/42/windows             ← agent sub-branch (worktree)
```

1. Create integration branch from `main`: `git checkout -b feat/42-video-filters main`
2. Each agent branches from the integration branch: `git checkout -b feat/42/core feat/42-video-filters`
3. Agents work in parallel — each in its own worktree (via `isolation: "worktree"` or manual `git worktree add`)
4. Merge sub-branches into integration branch in wave order (core → frontend → windows → ai), resolving conflicts at each step
5. Quality gates run on the integration branch
6. PR from integration branch → `main` (squash merge)
7. Cleanup: delete ALL local branches + worktrees (see §Local Cleanup)

### Branch lifecycle & intermediate states

Branches go through distinct phases. Cleanup rules depend on the phase:

| Phase | Branch state | Worktree | Cleanup rule |
|-------|-------------|----------|--------------|
| **Active work** | Has uncommitted or unpushed changes | Exists | Never touch — active session is using it |
| **Pushed (WIP)** | All changes committed + pushed to remote | May exist | Worktree may be removed (work is remote-safe). Branch stays until ship. |
| **Parked** | Committed + pushed, session ended | Should not exist | Branch stays (remote backup). Worktree should be gone. Next session recreates worktree from remote branch if needed. |
| **Consolidated** | Sub-branch merged into integration branch | Must not exist | Branch + worktree deleted immediately after merge into integration branch |
| **Shipped** | Integration branch merged to `main` via PR | Must not exist | Everything deleted — zero leftover policy (see below) |

**Key principle:** A branch's work must be **pushed to remote** before its worktree can be removed. The remote branch is the durable backup; worktrees are cheap, disposable working copies.

**Between sessions:**
- When a session ends mid-work: commit + push current state (even as WIP commit). The worktree will be cleaned up by the next session's sweep, but the branch persists on remote.
- Next session: if work needs to resume, `git worktree add` from the existing remote branch. No work is lost.

**Agent completion (before all agents are done):**
- When one agent finishes its sub-branch: commit, push, then delete the agent's worktree. The sub-branch stays until consolidation.
- Other agents continue working on their own sub-branches independently.

### Local cleanup — zero leftover policy (post-ship)

After a successful merge to remote `main`, **nothing must remain locally** except `main` itself:

- **All feature/sub-branches**: deleted with `git branch -D`
- **All worktrees**: removed with `git worktree remove --force`, then `git worktree prune`
- **Orphaned worktree directories**: `rm -rf` any leftover dirs in `.claude/worktrees/` (Windows file locking may require user intervention)
- **Stale remote refs**: `git remote prune origin`

**Traceability lives on GitHub, not locally.** The merged PR preserves the full diff, commit messages, and discussion. Local branches are ephemeral working state — never kept after merge.

### Session-start sweep (automated via hook)

The `sweep-branches.js` hook runs automatically at every session start (`SessionStart` in `settings.json`). It handles all cleanup:

**Safe to delete (garbage):**
- Worktree directories in `.claude/worktrees/` not listed in `git worktree list` **AND** containing no uncommitted changes
- Local branches whose upstream is gone (remote deleted after PR merge) **AND** not the current session's branch
- Stale remote tracking refs

**Never delete (protected):**
- **The current session's worktree and branch** — always preserved, even if the branch has no remote counterpart or was never pushed. The sweep detects the active session via `git rev-parse --show-toplevel` and `--abbrev-ref HEAD`.
- Local branches that have a remote counterpart (`origin/<branch>` exists) — parked or in-progress
- Worktrees listed in `git worktree list` with a valid branch checkout
- Orphaned worktree directories that contain uncommitted or untracked files (may be work-in-progress from a crashed session)

The hook reports what was cleaned and what was preserved. No manual action needed.

## Git Hygiene
- Before every commit: run `git status --short` and ensure zero `??` (untracked) entries.
- Every new file must be either staged for the commit or added to `.gitignore`/`.npmignore`.
- If a file was previously tracked but should be ignored, run `git rm --cached <file>` to remove it from the index.

## Commit Style
- Conventional commits: `type(scope): subject`
- Always append: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
- Never `--no-verify`. Never `git add -A`.

### Commit frequency & granularity

Commits and build numbers are **independent systems**. A commit captures a code snapshot in git; a build number marks a testable state. They do not need to align 1:1.

**When to commit (new commit = completed logical unit):**

| Situation | Commit? | Example |
|-----------|---------|---------|
| Data model / interface / contract complete | Yes | New TypeScript interface + service, ready to build on |
| API endpoint fully implemented (route + handler + validation) | Yes | Backend could be deployed independently |
| UI component complete (template + logic + styling) | Yes | Component is self-contained, could be used elsewhere |
| Migration / schema change | Yes | Structural change that must be revertable as a unit |
| Bug fix | Yes | Always own commit — clear `git bisect` point |
| Test suite for a feature | Yes | Standalone value, independent of feature code |
| User switches topic and current state has uncommitted work | Yes | WIP commit (`wip(scope): ...`) to secure state before context switch |
| User switches topic but last commit is clean | No | No WIP needed, just start the new topic |
| Mid-implementation (function half-written, not compiling) | No | Not a logical unit yet |

**Commit limit per branch (soft cap: 50):** At ~40 commits, proactively ask (AskUserQuestion): "Branch has N commits — ship before it drifts too far from main?" The user decides — the limit can be exceeded with explicit approval.

## Versioning
- Every project must use **semantic versioning** (`major.minor.patch`) in `package.json`.
- The `README.md` must display the current version as `**Version: x.y.z**` near the top.
- When bumping the version: update **all** files referencing the version in a **single commit**: `package.json`, `README.md` version line, `CHANGELOG.md` (new section with date and changes), and any other file containing the old version string. Before committing, grep the repo for the old version to catch every reference.
- Apply retroactively when touching a project that lacks a version badge in the README.

### Build number (developer-only)

The build number is a **content hash** of the working tree state, generated at every testable state — independent of commits. It identifies exactly which code state is running, even between commits.

**Generation:** `git write-tree | cut -c1-7` (hashes the full working tree including staged changes). Same code state = same hash (deterministic and reproducible).

**Where the build number lives:**

| Location | Included | Notes |
|----------|----------|-------|
| `package.json` field `buildId` | Yes | Separate field — not in `version` (npm ignores `+` metadata) |
| Console log on app start | Yes | Log `[build: a3f9b21]` at startup |
| Internal debug/about panel | Yes | Show full `1.2.3+a3f9b21` string |
| CI artifact names | Yes | e.g. `myapp-1.2.3+a3f9b21.exe` |
| README.md | No | User-facing — version only |
| CHANGELOG.md | No | User-facing — version only |
| Git tags | No | Tags use `vX.Y.Z` only |

**When to generate a new build number:**

| Situation | New build? | Why |
|-----------|------------|-----|
| Feature / sub-feature is testable — user could start the app and try it | Yes | Testable state = build |
| User switches topic and current state is runnable | Yes | Snapshot before context switch |
| User explicitly says "test this" / "check if it works" | Yes | Explicit test request |
| UI component renders correctly (even if further logic is missing) | Yes | Visually verifiable |
| Backend endpoint responds correctly (even if frontend is missing) | Yes | Functionally verifiable (curl/Postman) |
| Ship (squash merge to main) | Yes | Last build hash carries over to main |
| Code does not compile / app does not start | No | Not testable |
| Typo or comment fix, no functional change | No | No new testable state |
| Refactoring with no visible behavior change | No | Identical behavior → often identical hash anyway |
| WIP commit because session ends, code is half-finished | No | Not testable |
| Rebase / merge conflict resolution | No | Technical commit, no feature progress |

**Rule of thumb:** *Could someone start the app and see or try the difference compared to the previous build?* Yes = new build number. No = skip.

**Relationship between commits and builds (example):**

```
                                    Commits           Build-Nr.
                                    -------           ---------
Work on filter model...
  Model testable (service responds)  —                → a3f9b21

Commit abc1234: feat(video): add filter model + service

Work on filter UI...
  List renders                       —                → k7d2e44
  Apply button works                 —                → m2p8q11

Commit def5678: feat(video): add filter UI

User: "Make button red"
Commit ghi9012: style(header): red button
  Immediately testable               —                → x5v3n88

Ship → squash to main               —                → x5v3n88 (carried over)
```

3 commits, 4 builds — independent counts. Builds track testable states; commits track logical code units.

### Build Log (`BUILDLOG.md`)

Every project maintains a `BUILDLOG.md` in the repo root — a developer-facing log of every shipped build. The ship flow writes a new entry automatically (step 6).

**Format:**
```markdown
# Build Log

## <build-hash> — YYYY-MM-DD
Version: x.y.z
Branch: <branch-name>
PR: #<number>
Commit: <git-short-hash>
Changes:
- <change 1>
- <change 2>
```

**Rules:**
- Newest entry at the top (reverse chronological).
- `<build-hash>` is the content hash (build number) — the developer-facing identifier shown in debug panel and console log.
- `Commit` is the git commit hash on `main` (after squash merge) — the git-referenceable identifier for `git checkout`, `git bisect`.
- `Changes` list mirrors the PR description bullet points — keep it concise (1 line per change).
- `BUILDLOG.md` is **not** user-facing — it is not linked in README and not referenced in CHANGELOG.
- Apply retroactively when touching a project that lacks a BUILDLOG.md — create the file with the current ship as the first entry.

### When to bump (automatic — part of the ship flow)

Every ship must include a version bump decision. This is **not optional** — it is step 4.5 in the Completion Flow (between quality gates and PR creation). Evaluate the changes being shipped and apply the correct bump:

| Change type | Bump | Decision | Examples |
|-------------|------|----------|----------|
| Bug fix that a user could notice | **patch** | Automatic — no confirmation needed | UI glitch fixed, broken toggle repaired, crash on startup resolved |
| Internal-only fix (refactor, code cleanup, test fix) | **none** | No bump needed | Renamed internal variable, fixed flaky test, updated dev dependency |
| New UI feature or visible functionality | **minor** | Automatic — no confirmation needed | New settings panel, added filter option, new overlay widget |
| Complete redesign of a feature set, new major feature area | **major** | **Always ask the user** (AskUserQuestion): "Major version bump (→ X.0.0) or minor (→ 0.X.0)?" | Full settings redesign, new module added, breaking UX overhaul |

**Decision rule of thumb:** If a user would notice the change (positive or negative), bump the version. If only a developer would notice, skip.

**Multiple changes in one ship:** Use the highest applicable bump. If shipping a milestone with 3 bugfixes and 1 new feature → minor (not patch).

## Release Flow
Before committing a new version tag (`vX.Y.Z`):
1. Run the project's release pipeline — use GitHub Actions where possible; fall back to a Windows self-hosted runner for anything requiring native Windows (installers, platform-specific tooling).
2. Update `CHANGELOG.md` (or equivalent) before tagging. See per-project memory for tone/format requirements.
- This applies to **all** version bumps — major, minor, and patch alike.
- Specific pipeline details (scripts, artifact names, runner requirements) are stored in per-project memory.

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

- Description: imperative mood, sentence case, no trailing period (e.g. `[BUG] Settings UI freezes on startup`)
- Never use `[FIX]` — bugs are always `[BUG]`

**Required parameters — every issue must have all three:**
1. **Labels:** at least one each of `type:*`, `role:*`, `module:*`
2. **Milestone:** assign to the appropriate milestone (query open milestones if unsure)
3. **Project board:** immediately after creation run `gh project item-add 2 --owner Jerry0022 --url <issue-url>`, then set the "Agent Role" text field on the board item to match the `role:*` labels (comma-separated agent codes, e.g., `frontend, qa`). Use the GraphQL API via `gh api graphql`. Project-specific field IDs are stored in the project's `/new-issue` and `/milestone` skills — use those IDs directly instead of querying them each time.

Missing any of these three is a hard error — do not consider the issue created until all are set.

**Linked pull requests:** Always link PRs to their issues. In the PR body include `Closes #NNN` (or `Fixes #NNN`) for every issue the PR resolves — GitHub will then populate the "Linked pull requests" column automatically.

### Issue status tracking on the project board

**Trigger — session start & topic switch:**
At the beginning of every session and whenever the user switches topics mid-session, check whether the current work maps to an existing GitHub issue:
1. Infer the topic from the user's message (feature name, bug description, issue number, branch name pattern like `feat/42-*`).
2. Query open issues: `gh issue list --state open --json number,title --limit 20` (or search by keyword/label if the topic is vague).
3. If a matching issue is found → ask the user (AskUserQuestion): "Arbeitest du an Issue #N (<title>)?" with options `Ja` / `Nein`.
4. If the user confirms → set the issue's project board status to **In Progress** (see GraphQL below) and remember the issue number for the rest of the session/topic.
5. If the user declines → do nothing. Re-check on the next topic switch.

If the user **explicitly** mentions an issue number (e.g., "mach Issue #42"), skip the question — set it to In Progress immediately.

**Setting status via GraphQL:**
Use `gh api graphql` to update the project board item's "Status" field. Project-specific field IDs and option IDs (In Progress, Done, etc.) are stored in the project's `/new-issue` and `/milestone` skills — use those IDs directly.

**Completion — set to Done:**
When an issue's work is shipped and merged (PR merged to `main`), set the project board status to **Done**. This happens automatically as part of the `/ship` flow — after the PR merge step, update the board item status for every issue referenced in the PR body (`Closes #N`).

**Rules:**
- Never set status without user confirmation (except when the user explicitly names the issue).
- Only set In Progress for issues the session is actively working on — not for issues that are merely discussed or referenced.
- If multiple issues are being worked on simultaneously (e.g., multi-issue milestone), all active ones get In Progress.
- When the session ends without shipping, leave the status as In Progress — the next session will pick it up or the user will manage it.

## AI Configuration Files in .gitignore
When auditing or writing ignore files for any project:
- **Share** (must NOT be ignored): `CLAUDE.md`, `.claude/commands/`, `.claude/skills/`, `.claude/hooks/`, `.cursor/rules`, project-level AI settings
- **Ignore** (must be excluded): `.claude/worktrees/`, `.claude/todos/`, token caches, local model files, personal session state
- Section heading to use in `.gitignore`: `# AI tooling — shared config tracked, session state excluded`

## Test Execution Strategy

### Task-specific tests (run immediately)
After every code change, run only the tests directly related to the current task — e.g., the specific test file for the changed module, or a targeted `npm run test:unit -- --grep "pattern"`. This verifies the change works without the cost of a full regression suite.

### Full regression suite (run only at ship time)
The full test suite (`npm run test:unit` + `npm run precommit`) runs as part of the `/ship` quality gates (Step 4). Do **not** run the full suite after every implementation pass — this burns tokens on context (test output) and terminal windows without proportional value. The ship flow catches regressions before they reach `main`.

### Test deduplication at ship time
If the full test suite already passed on the **same code state** (same `git write-tree` hash) earlier in the session — e.g., task-specific tests covered the full suite, or the user explicitly ran all tests — the `/ship` quality gates skip redundant test execution. This saves tokens and avoids unnecessary terminal windows. Tests always re-run if the tree hash changed (e.g., due to rebase picking up new commits from main).

### Milestone regression (run before closing a milestone)
After implementing **all issues in a milestone**, run a comprehensive regression test before closing issues or raising a PR:
1. Run the full unit test suite: `npm run test:unit`
2. Run the syntax and contract lints: `npm run precommit`
3. Verify all modules start without errors (check logs, no uncaught exceptions)
4. Confirm all UI content loads (Angular components render, no blank screens)
5. Confirm all UI interactive elements work (toggles, buttons, navigation)
6. If any failures are found: fix them, re-run from step 1, repeat until clean
7. Only after a clean pass: close milestone GitHub issues and open the milestone PR

### User-facing test plan (after implementation)

After completing a unit of work that has user-visible effects, **always include a test plan** — a numbered checklist of concrete steps the user can follow to verify the change. Do not just say "it works" — prove it with actionable steps.

**Format:**
```
## Test Plan

> [Pre-conditions: app started, specific state needed, etc.]

1. [Concise test step — what to do and what to verify]
2. ...
```

**Rules:**
- Steps must be concrete and executable (click X, observe Y, enter Z).
- Cover the happy path first, then the most likely failure modes.
- Scale the number of steps to the scope: 1–2 for a trivial patch, up to 10 for a large feature.
- If hot-reload (HMR) is sufficient, note that a full restart is not required.
- Keep each step to one sentence.
- Skip the test plan for non-visible changes (pure refactors, internal config, documentation).

## Completion Flow — Ship & Verify

When a unit of work is complete (feature, bug fix, design asset, refactor — anything with committed changes on a branch), execute the **full shipping pipeline** as a single uninterrupted step. Do not stop at the PR — carry through to merge and verification.

**The step-by-step flow is defined in the global `/ship` skill** (`~/.claude/skills/ship/SKILL.md`). The skill is the canonical implementation — always invoke it rather than running steps manually. Project-level `/ship` skills extend the global skill with project-specific details (commands, extra steps, etc.).

**Summary of steps** (see `/ship` skill for full details):
1. Consolidate sub-branches → 2. Sync main → 3. Rebase → 4. Quality gates → 5. **Version bump** (§Versioning) → 6. Commit & push → 7. Create PR → 8. Merge PR → 9. Update local main → 10. Cleanup → 11. Verify live

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
- Post-ship cleanup: see §Local Cleanup. Session-ending WIP behavior: see §Branch Lifecycle.

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

## Skill Creation & Refinement
- When creating ANY new skill (global or project-level), always use the Anthropic `skill-creator` skill to refine it.
- At minimum: draft the skill, then run the skill-creator's description optimizer to improve triggering accuracy.
- For skills with objectively verifiable outputs: also run test cases through the eval loop.
- This applies everywhere — not just this project.

## Code Defaults
- UTF-8 encoding.
- English identifiers, comments, and strings (except localization files).
- Minimal changes — do not refactor or add features beyond what was asked.
- No fallbacks by default — propose as option, implement only with explicit approval.

## Tool Selection — Minimize Terminal Windows (Windows)
On Windows, each Bash tool call can open a visible CMD window that steals focus and clutters the taskbar. Minimize this:
- **Always prefer dedicated tools** (Read, Write, Edit, Glob, Grep, WebFetch, WebSearch) over Bash equivalents — these don't spawn terminal processes.
- **Never use Bash** for file reading (`cat`, `head`, `tail`), file searching (`find`, `grep`, `rg`), or file editing (`sed`, `awk`) — dedicated tools exist for all of these.
- **Batch Bash calls**: when Bash is unavoidable (git, npm, node), combine related commands into a single call using `&&` instead of multiple separate calls.
- **Priority: functionality > aesthetics**: If Bash is the only way to accomplish a task (starting apps, running servers, executing builds), use it — a console window is always better than a broken workflow. The goal is to avoid *unnecessary* terminal windows (e.g., using `cat` instead of Read), not to avoid terminals at all costs.
- **Exception**: when the user explicitly needs to see terminal output (interactive programs, dev servers, debugging), a visible terminal is expected and fine.

## Session Startup — Automatic Tasks

### 1. Branch & worktree sweep (hook)

Handled automatically by the `sweep-branches.js` SessionStart hook — no manual action needed. The hook cleans up garbage (orphaned worktrees, gone branches, stale refs) while preserving branches with remote counterparts. See §Session-start sweep for details.
