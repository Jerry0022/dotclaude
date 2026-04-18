# Proactive Agent Orchestration

Cross-cutting rule for when to involve specialized agents without explicit user request.

## Core Rule

**Proactively evaluate whether specialized agents add value for the current task.**
Do not wait for the user to say "use agents" — assess this yourself based on task signals.

## When to Orchestrate Agents

### Complex or Multi-Domain Tasks

Spawn agents when the task touches **2+ domains** or requires **specialized expertise**:

- Frontend + Backend changes → core + frontend agents
- New feature end-to-end → feature agent (full wave orchestration)
- UI/UX decisions needed → designer agent
- AI/ML integration → ai agent
- Platform-specific work → windows agent
- Architecture or strategy questions → research agent + po agent

**Signal words** (non-exhaustive): implement, build, create, design, refactor, migrate,
end-to-end, full-stack, multi-, integrate, overhaul, rearchitect, new feature.

### Repeated Bug Fixes or Polishing

When the user addresses the **same area more than once** — fixing the same bug again,
polishing the same component, or iterating on the same file cluster — this signals
the problem space is larger than a quick fix:

- **2+ passes on the same bug/area** → spawn QA agent to verify holistically
- **Polishing iterations** (styling, copy, UX tweaks) → spawn designer agent for
  a cohesive review rather than incremental patches
- **Recurring test failures** → spawn QA agent with full test strategy
- **Repeated refactoring in same module** → spawn core agent for structural analysis

The pattern: if manual iteration isn't converging, an agent with fresh perspective
and specialized focus will resolve it faster.

### Research-Heavy Tasks

When the task requires investigation before implementation:

- Technology comparison → research agent
- Best practices lookup → research agent
- Competitive analysis → research agent
- User perspective validation → gamer agent

### Before Substantial Changes — Pre-Mortem

Before any non-trivial implementation, apply the inline pre-mortem defined
in [`pre-mortem.md`](pre-mortem.md). Trigger list (security paths, migrations,
breaking contracts, refactors >3 files, concurrency, destructive ops, external
integrations) is canonical there. For higher-stakes work, escalate to the
`redteam` agent in Wave 0, parallel to `po`.

## When NOT to Orchestrate

- Single-file, single-domain edits (typo fix, add a log line, rename a variable)
- Pure Q&A / explanations (no code changes)
- Tasks the user explicitly wants done quickly/simply ("just fix it", "quick change")
- When the user says "don't use agents" or similar

## How to Orchestrate

1. **Assess** the task against the signals above
2. **Announce briefly** which agents you're involving and why (one line)
3. **Launch** agents in parallel where independent, sequentially where dependent
4. **Follow** the wave model from `agent-collaboration.md` for multi-agent features

## Rules

- This is a **judgment call**, not a mechanical trigger — use context and common sense
- When in doubt about complexity: orchestrate. The cost of an unnecessary agent is low;
  the cost of a missed perspective is high.
- Never orchestrate silently — always tell the user which agents you're spinning up
- Respect explicit user intent: "just do X" means don't over-engineer with agents
