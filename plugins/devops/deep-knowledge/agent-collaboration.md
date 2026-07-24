# Agent Collaboration Protocol

How agents work together on multi-role tasks.

## Collaboration Model

```
User Request
    │
    ▼
Feature Agent (orchestrator)
    │
    ├──→ Core Agent      (business logic, contracts)
    │       │
    │       ▼
    ├──→ Frontend Agent  (UI, depends on Core contracts)
    │       │
    │       ▼
    ├──→ Windows Agent   (platform-specific, depends on Core)
    │       │
    │       ▼
    ├──→ AI Agent        (AI features, depends on Core data)
    │
    ▼
QA Agent (verifies all changes)
    │
    ▼
PO Agent (validates against requirements)
    │
    ▼
Ship (if approved)
```

## Execution Waves

When multiple agents work on a feature, they execute in waves:

| Wave | Agents | Model | Why |
|------|--------|-------|-----|
| 1 | **Core** | sonnet | Defines contracts and interfaces first |
| 2 | **Frontend**, **Windows**, **AI** (parallel) | sonnet | Consume Core contracts |
| 3 | **QA** | sonnet | Verifies all changes together |
| 4 | **PO** | opus | Validates against requirements |

Agents in the same wave can run in parallel (`||` suffix in naming). The `Model`
column is each agent's frontmatter default — see `agent-orchestration.md`
§ Model & Effort Defaults for the full roster and override rules.

## Handoff Protocol

Every agent-to-agent transition uses structured handoffs:

### Starting (when an agent begins work)

```
[role:X] Starting: <what I will do>
Context: <relevant findings from previous agent>
Branch: <my-branch-name>
```

### Handoff (when passing to next agent)

```
[role:X] Handoff to [role:Y]:
Completed: <what was done>
Contracts: <new interfaces/APIs available>
Notes: <anything Y needs to know>
Files: <key files changed>
```

### Review (QA or PO reviewing work)

```
[role:qa] Review:
Status: clean | findings
Findings:
- <issue 1: file:line — description>
- <issue 2: file:line — description>
Action: proceed | fix-required
```

### Blocker (when an agent can't continue)

```
[role:X] Blocker:
Blocked by: <what's missing>
Needs: <which agent/action can unblock>
Workaround: <temporary solution if any>
```

## Sub-Branch Strategy

When the Feature agent delegates to domain agents, each sub-agent works on its own
branch off the integration branch:

```
feat/42-video-filters               ← Feature agent (integration branch)
├── feat/42-video-filters-core      ← Core agent worktree
├── feat/42-video-filters-frontend  ← Frontend agent worktree
├── feat/42-video-filters-windows   ← Windows agent worktree
└── feat/42-video-filters-ai        ← AI agent worktree
```

The orchestrator merges each sub-branch back into the integration branch (merge order
follows wave order: Core → Frontend/Windows/AI → integration). The integration branch is
shipped to `main` **once**, at the end, via `/ship` — sub-branches are NOT shipped
individually.

## Branch Inheritance Protocol

Claude Code's `isolation: worktree` always creates worktrees from the repo's HEAD (main).
To ensure agents work on the correct branch, every isolated agent MUST follow this protocol:

### For the Orchestrator (Feature Agent or direct caller)

1. **Push the integration branch to origin before spawning any sub-agent:**
   `git push -u origin <integration-branch>`
   Mandatory — sub-agents reset to `origin/<integration-branch>` so they start from the
   integration tip rather than from main.
2. Before spawning any sub-agent, capture the current branch:
   `PARENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)`
3. Include in EVERY agent prompt: `Parent branch: <branch-name>` plus the exact
   sub-branch name to use (see § Branch naming).
4. After each sub-agent completes, merge its branch back:
   `git merge --no-ff <sub-agent-branch>`

### For every isolated Sub-Agent (first action after spawn)

1. Fetch and start your branch from the parent tip. Use `checkout -B` (not `-b`) so it
   works whether or not the fresh worktree already sits on a branch of that name:
   ```bash
   git fetch origin
   git checkout -B <sub-branch-name> origin/<parent-branch>
   ```
2. Work, commit, push: `git push -u origin <sub-branch-name>`
3. Report the exact branch name in the handoff.

### Branch naming

Sub-branches use a **flat, dash-joined** name: `<parent-branch>-<role>`
Example: parent `feat/42-video-filters` → core agent works on `feat/42-video-filters-core`.

**Never use a slash (`<parent-branch>/<role>`).** Git stores branches as files under
`.git/refs/heads`, so it refuses to create `foo/bar` while a branch `foo` exists
(`cannot lock ref 'refs/heads/foo/bar': 'refs/heads/foo' exists`). The orchestrator keeps
the integration branch checked out locally, so a slash-nested child ALWAYS collides. The
dash form never collides — every sub-agent must use it.

### Merge order

Same as wave order. The Feature agent merges each wave's sub-branches into the integration
branch before spawning the next wave. Disjoint-file sub-branches merge cleanly; resolve any
conflicts per `deep-knowledge/merge-safety.md`.

### Hierarchical ship (separate, optional)

The ship pipeline can also auto-detect a parent from a **slash-nested** branch name
(`detectParentBranch`: `feat/42/core` → base `feat/42` → intermediate merge; full release
only on the final ship to main). This is a distinct capability for genuine multi-stage
feature branches, with a hard precondition: the parent must exist **on origin only** and
NOT be checked out as a local branch — otherwise the slash-nested child cannot be created
(see § Branch naming). The agent-orchestration default does NOT use this; it uses dash
sub-branches + orchestrator merge-back (above), which always works regardless of what is
checked out locally.

### Conflict resolution during integration

When the Feature agent merges sub-agent branches into the integration branch and
conflicts occur, follow `deep-knowledge/merge-safety.md` strictly:

1. **Attempt merge**: `git merge --no-ff <sub-branch>`
2. **On conflict** — for each conflicted file:
   - Read both sides and the common ancestor to understand intent
   - Classify each hunk: complementary, redundant, superseding, or mutually exclusive
   - **Complementary** (both agents added different functions, imports, config entries): keep both
   - **Redundant** (both agents made the same or equivalent change): keep one copy
   - **Superseding** (one agent refined what the other started): keep the more complete version
   - **Technical choice** (different import paths, utility names): AI picks the better option
   - **Design decision** (different user-facing behavior): ask the user
3. **Semantic verification**: after textual resolution, read the merged file and verify
   logical correctness. Watch for silent semantic conflicts — code that merges cleanly
   but is logically broken (e.g., function signature changed by Core, new call added
   by Frontend without the new parameter).
4. **Never skip a conflict**: every hunk must be explicitly resolved. No `--ours`, no `--theirs`.
5. **Never leave markers**: `<<<<<<<` must never be committed.

## Issue Creation as Team Refinement

Creating an issue is a refinement session, not a solo task. All relevant roles participate:

1. `po` — drafts scope, user story, acceptance criteria
2. Domain roles — add technical notes, flag assumptions, identify risks
3. UX/user role (if applicable) — validates user story from the end-user perspective, challenges vague AC
4. `qa` — defines testability: what does "done" look like?

All happens within the single `/setup-issue` execution.

## Rules

- **Never skip a wave.** Core must commit contracts before Frontend starts.
- **Never skip QA review.** Even "trivial" changes get reviewed.
- **Handoff data is mandatory.** No agent starts without knowing what came before.
- **Conflicts resolve at integration.** The Feature agent handles merge conflicts per `deep-knowledge/merge-safety.md`. Never use `--ours`/`--theirs`. Auto-resolve complementary changes; escalate design decisions to user.
- **Parallel agents don't cross-depend.** Frontend and Windows never import from each other.
- **Push integration branch before spawning sub-agents.** Sub-agents reset to `origin/<integration-branch>` to start from the integration tip.
- **Sub-branches use dash names, never slashes.** `<parent>-<role>` — a slash-nested child collides with the checked-out integration branch ref (see § Branch naming).
- **Merge sub-branches back in wave order; ship the integration branch once.** Sub-branches are not shipped individually.

## Extension

Projects define their own roles by creating agent definitions in:
```
{project}/.claude/agents/{role}/AGENT.md
```

Custom roles automatically participate in the collaboration protocol.
The Feature agent discovers available roles from the project's agents directory.
