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

## Branch Inheritance Protocol

Claude Code's `isolation: worktree` always creates worktrees from the repo's HEAD (main).
To ensure agents work on the correct branch, every isolated agent MUST follow this protocol:

### For the Orchestrator (Feature Agent or direct caller)

1. Before spawning any sub-agent, capture the current branch:
   `PARENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)`
2. Include in EVERY agent prompt:
   `Parent branch: <branch-name>`
3. After each sub-agent completes, merge their branch back:
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

## Rules

- **Never skip a wave.** Core must commit contracts before Frontend starts.
- **Never skip QA review.** Even "trivial" changes get reviewed.
- **Handoff data is mandatory.** No agent starts without knowing what came before.
- **Conflicts resolve at integration.** The Feature agent handles merge conflicts.
- **Parallel agents don't cross-depend.** Frontend and Windows never import from each other.

## Extension

Projects define their own roles by creating agent definitions in:
```
{project}/.claude/agents/{role}/AGENT.md
```

Custom roles automatically participate in the collaboration protocol.
The Feature agent discovers available roles from the project's agents directory.
