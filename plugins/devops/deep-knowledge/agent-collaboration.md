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

| Wave | Agents | Why |
|------|--------|-----|
| 1 | **Core** | Defines contracts and interfaces first |
| 2 | **Frontend**, **Windows**, **AI** (parallel) | Consume Core contracts |
| 3 | **QA** | Verifies all changes together |
| 4 | **PO** | Validates against requirements |

Agents in the same wave can run in parallel (`||` suffix in naming).

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

When the Feature agent delegates to domain agents:

```
feat/42-video-filters          ← Feature agent (integration branch)
├── feat/42/core               ← Core agent worktree
├── feat/42/frontend           ← Frontend agent worktree
├── feat/42/windows            ← Windows agent worktree
└── feat/42/ai                 ← AI agent worktree
```

Merge order follows wave order: Core → Frontend/Windows/AI → integration branch.

Each sub-agent ships via `/devops-ship` — the pipeline auto-detects the parent branch from naming convention. See `skills/devops-ship/SKILL.md` → "Hierarchical Merge Workflow".

## Branch Inheritance Protocol

Claude Code's `isolation: worktree` always creates worktrees from the repo's HEAD (main).
To ensure agents work on the correct branch, every isolated agent MUST follow this protocol:

### For the Orchestrator (Feature Agent or direct caller)

1. **Push the integration branch to origin before spawning any sub-agent:**
   `git push -u origin <integration-branch>`
   This is mandatory — sub-agents need the branch on origin to auto-detect it as their parent.
2. Before spawning any sub-agent, capture the current branch:
   `PARENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)`
3. Include in EVERY agent prompt:
   `Parent branch: <branch-name>`
4. After each sub-agent completes, merge their branch back:
   `git merge --no-ff <sub-agent-branch>`

### For every isolated Sub-Agent (first action after spawn)

1. Fetch and reset to parent branch:
   ```bash
   git fetch origin
   git reset --hard origin/<parent-branch>  # or local ref if not pushed
   ```
2. Create your working branch from there:
   ```bash
   git checkout -b <sub-branch-name>
   ```
3. Work, commit, push
4. Report branch name in handoff

### Branch naming

Sub-branches follow: `<parent-branch>/<role>`
Example: If parent is `feat/42-video-filters`, core agent works on `feat/42-video-filters/core`

### Merge order

Same as wave order. Feature agent merges each wave's branches before spawning the next wave.

### Shipping sub-branches

Sub-agents call `/devops-ship` from their branch. The ship pipeline auto-detects the parent:
- `feat/42-video-filters/core` → detects base `feat/42-video-filters` → intermediate merge
- `feat/42-video-filters` → no parent detected → ships to `main` with full release

Intermediate merges skip version bump, tag, and GitHub release. These only happen on the final ship to main.

### Shipping order within a wave

**Sub-agents within the same wave must ship sequentially, not in parallel.**
The Feature agent orchestrates shipping one sub-branch at a time:

1. Sub-agent A completes → Feature agent calls `/devops-ship` for A's branch → waits for merge
2. Sub-agent B completes → Feature agent calls `/devops-ship` for B's branch → waits for merge
3. Continue until all sub-branches in the wave are merged

This prevents merge conflicts from concurrent PRs targeting the same feature branch.
Parallel **work** within a wave is fine — only the **shipping** must be sequential.

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

All happens within the single `/devops-new-issue` execution.

## Rules

- **Never skip a wave.** Core must commit contracts before Frontend starts.
- **Never skip QA review.** Even "trivial" changes get reviewed.
- **Handoff data is mandatory.** No agent starts without knowing what came before.
- **Conflicts resolve at integration.** The Feature agent handles merge conflicts per `deep-knowledge/merge-safety.md`. Never use `--ours`/`--theirs`. Auto-resolve complementary changes; escalate design decisions to user.
- **Parallel agents don't cross-depend.** Frontend and Windows never import from each other.
- **Push integration branch before spawning sub-agents.** Sub-agents rely on the branch existing on origin for auto-detection.
- **Ship sub-branches sequentially.** Parallel work is fine, but shipping must be one at a time to avoid merge conflicts.

## Extension

Projects define their own roles by creating agent definitions in:
```
{project}/.claude/agents/{role}/AGENT.md
```

Custom roles automatically participate in the collaboration protocol.
The Feature agent discovers available roles from the project's agents directory.
