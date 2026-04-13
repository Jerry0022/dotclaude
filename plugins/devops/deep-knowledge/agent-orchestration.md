# Agent Orchestration

Shared orchestration logic for agent selection, prompting, and wave execution.
Referenced by `/devops-agents` and `/devops-autonomous`.

## Agent Selection

Select agents based on domains touched, complexity, and risk:

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

### Selection Criteria

- Include an agent only if it adds **concrete value** — not for coverage
- Prefer fewer agents with clear purpose over many with vague roles
- Always include **qa** for any code changes (Wave 3)
- Include **po** only for feature-level work, not bugfixes or refactoring

### Complexity Tiers

| Tier | Signals | Strategy |
|------|---------|----------|
| **Simple** | Single domain, < 5 files, clear scope | Work directly, no sub-agents |
| **Medium** | 2 independent domains, no cross-deps | 2-3 parallel agents for independent domains |
| **Complex** | 3+ domains, cross-cutting, or high risk | Full agent roster with wave model |

## Wave Execution

Follow the wave model from `agent-collaboration.md`. The execution mechanics below
apply regardless of whether the caller is interactive or autonomous.

### Agent Prompt Template

Every spawned agent MUST receive:

1. **Parent branch name** — for branch inheritance protocol
2. **Task description** — specific to their role, not the full user request
3. **Context from previous waves** — handoff data (contracts, findings, decisions)
4. **Commit instruction** — follow commit conventions from `/devops-commit`
5. **Interaction directive** — set by the calling skill (see below)

### Interaction Directives

The calling skill sets the interaction mode for all spawned agents:

| Mode | Directive |
|------|-----------|
| **Autonomous** | "Work autonomously. Do NOT use AskUserQuestion. Make reasonable decisions independently. Document all decisions in your commit messages." |
| **Background** | Same as Autonomous |
| **Interactive** | "Work interactively. Use AskUserQuestion with concrete options (2-4 choices) for design decisions, ambiguous requirements, or trade-offs. Provide detailed analysis and reasoning inline in the chat. Never decide silently — always explain your approach." |

### Spawning Mechanics

For each wave:

1. **Spawn agents** — parallel within the same wave, sequential across waves
2. **Isolation** — each agent works in an isolated worktree (`isolation: "worktree"`)
3. **Background agents** — use `run_in_background: true`
4. **Foreground agents** — wait for completion before next wave
5. **Collect results** — gather handoff data before spawning next wave

### Single-Agent Shortcut

If only 1 agent is selected (e.g., just research or just qa):
- Skip branching strategy entirely
- Launch the agent directly with full context
- Autonomous/background: `run_in_background: true`
- Interactive: foreground with inline questions

### Branch Strategy

See `agent-collaboration.md` § Sub-Branch Strategy and § Branch Inheritance Protocol.
The orchestrator (calling skill) is responsible for:

1. Creating the integration branch if not already on a feature branch
2. Pushing it to origin before spawning sub-agents
3. Merging each wave's branches back before spawning the next wave
4. Sequential shipping within a wave (parallel work, sequential ship)
