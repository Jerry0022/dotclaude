# Agent Delegation Policy

Always-on rule — injected in full at SessionStart by `ss.knowledge.index`, so it
is in context for every prompt without the user asking for agents. It is the
plugin's standing instruction for *when* to delegate to the devops role agents
and, just as hard, when *not* to. Pick the tier by signal, never by habit.

## Tiers

| Tier | Signal | Do |
|------|--------|----|
| **Inline** | 1 domain, ≤ ~5 files, Q&A, quick fix, or any task where the conversation context matters more than isolation | No agent. A sub-agent re-bootstraps ~20–30k tokens of context and loses the conversation — never spawn 1 agent for work that costs less than that inline. |
| **1 agent, background** | The deliverable is a *conclusion* and the path to it would flood the main context: web/tech research (`research`), broad codebase sweep (`Explore`), full test suite or build verification (`qa`), risk review of a plan or diff (`redteam`), product-value challenge of a decision (`po`) | Spawn automatically, `run_in_background: true`. One announcement line (`→ research agent: <what>`). Keep working inline meanwhile; relay the conclusion, not the transcript. |
| **2–3 agents, parallel** | Independent domains with no cross-dependencies (`core` + `frontend`; an analysis that wants two lenses: `research` + `po`, or `po` + `redteam`) | Spawn automatically in one message, one line naming all. Per-agent budget ~5–15 tool calls. |
| **Full ceremony** | 3+ domains, a feature end-to-end, or a high-risk change (migration, auth, breaking contract, destructive op) | Do **not** auto-start. Offer `/run-agents` (plan → confirm → mode → waves → gates) in one sentence and proceed only on a yes — the wave model with QA/PO is the expensive path. |

## Hard stops

- The user says "just", "quick", "inline", "no agents" (or the German
  equivalents "nur", "schnell", "einfach", "keine Agents") → Inline, whatever
  the tier says.
- Never spawn for a pure explanation or a single-fact lookup you can grep.
- Never spawn silently — and never narrate more than one line per spawn.
- Same area iterated 2+ times without converging → escalate exactly one tier
  (`qa` for a recurring bug, `designer` for UI polish, `core` for repeated
  refactors in one module).
- Non-trivial change → inline pre-mortem first (`pre-mortem.md`); only its
  higher-stakes triggers justify a `redteam` spawn.

## References

- Roster, model/effort defaults, prompt template, wave mechanics, QA protocol:
  `agent-orchestration.md`
- Handoffs, merge order, shipping between agents: `agent-collaboration.md`
- Explicit full-ceremony path: `/run-agents` skill
