---
name: devops-orchestrate
version: 0.1.0
description: >-
  Evaluate which agents are useful for a task and orchestrate their parallel or
  sequential execution. Use when the user explicitly wants orchestrated agent
  work instead of inline execution, or when a task clearly benefits from
  multi-agent collaboration. Triggers on: "orchestrate", "orchestriere",
  "agents einsetzen", "use agents", "parallel agents", "multi-agent",
  "lass agents das machen", "delegate to agents", "agent workflow".
  Do NOT trigger for: simple single-file edits, quick fixes, explanations
  (use /devops-explain), or research-only tasks (use /devops-deep-research).
argument-hint: "[task description or goal]"
allowed-tools: Agent, Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__*
---

# Orchestrate

Evaluate which agents add value for `$ARGUMENTS`, then orchestrate their execution.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/orchestrate/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/orchestrate/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Task Analysis

Analyze `$ARGUMENTS` to understand:

1. **Domains touched** — which areas of the codebase are affected?
2. **Complexity** — single-domain vs. cross-cutting?
3. **Dependencies** — what must happen before what?
4. **Risk level** — does this need QA/PO review?

If `$ARGUMENTS` is empty or vague, ask ONE focused question via `AskUserQuestion`:
- "Was genau soll orchestriert werden? (Feature, Refactoring, Bugfix, Research...)"

## Step 2 — Agent Selection

Based on the analysis, select agents from the available pool:

| Agent | When to include | Wave |
|-------|----------------|------|
| **research** | Topic needs investigation first | 0 (pre-work) |
| **core** | Business logic, APIs, data models | 1 |
| **frontend** | UI components, templates, styling | 2 |
| **windows** | Platform-specific (system tray, native APIs) | 2 |
| **ai** | AI/ML integration, embeddings, prompts | 2 |
| **designer** | UX/UI decisions, design system, specs | 0 or 2 |
| **qa** | Test, verify, screenshot | 3 |
| **po** | Requirements validation, trade-off review | 4 |
| **gamer** | End-user/player perspective | 3 or 4 |

**Selection criteria:**

- Include an agent only if it adds **concrete value** — not for coverage
- Prefer fewer agents with clear purpose over many with vague roles
- Always include **qa** for any code changes (Wave 3)
- Include **po** only for feature-level work, not bugfixes or refactoring

## Step 3 — Present Plan

Present the orchestration plan to the user:

```
## Orchestrierungsplan: <task summary>

### Agents (N selected)

| Wave | Agent(s) | Aufgabe |
|------|----------|---------|
| 0 | research | <what they investigate> |
| 1 | core | <what contracts/APIs they define> |
| 2 | frontend, windows | <what they build, in parallel> |
| 3 | qa | <what they verify> |

### Abhaengigkeiten
- Wave 2 wartet auf Wave 1 (Core-Contracts)
- Wave 3 prueft alle Aenderungen aus Wave 1+2

### Geschaetzte Agents: N
```

Wait for user confirmation before proceeding. Accept:
- "ja" / "go" / "mach" → proceed as planned
- Modifications → adjust plan
- "weniger" / "nur X" → reduce scope

## Step 4 — Execution

Follow the collaboration protocol from `deep-knowledge/agent-collaboration.md`:

### Branch Strategy

1. Create integration branch if not already on a feature branch
2. Push integration branch to origin before spawning sub-agents
3. Each agent works in an isolated worktree (`isolation: "worktree"`)

### Wave Execution

For each wave:

1. **Spawn agents** — parallel within the same wave, sequential across waves
2. **Include in every agent prompt:**
   - Parent branch name
   - Task description specific to their role
   - Context from previous waves (handoff data)
   - Instruction to follow commit conventions from `/devops-commit`
3. **Collect results** — wait for all agents in the wave to complete
4. **Merge** — ship each sub-branch via `/devops-ship` (sequential within wave)
5. **Handoff** — pass completed contracts/findings to next wave

### Single-Agent Shortcut

If only 1 agent was selected (e.g., just research or just qa):
- Skip branching strategy
- Launch the agent directly with full context
- Report results inline

## Step 5 — Synthesis

After all waves complete:

1. Summarize what each agent accomplished
2. List any unresolved findings or open questions
3. Show final branch/PR state
4. Trigger completion flow

## Rules

- **Never skip the plan step** — always present and confirm before executing
- **Never run agents silently** — announce each agent launch
- **Respect wave dependencies** — Core before Frontend, QA after all code changes
- **Ship sub-branches sequentially** — parallel work is fine, parallel shipping is not
- **Follow handoff protocol** — every agent-to-agent transition uses structured handoffs
- If the user says "just do it" without agents → respect that, don't orchestrate
- If only 1 domain is affected → consider if a single inline execution is simpler
- The user called this skill explicitly — they WANT orchestration, so deliver it
