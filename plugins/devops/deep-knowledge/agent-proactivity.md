# Agent Delegation Policy

Always-on (injected at SessionStart). This plugin instruction **is** the
standing request to use the Agent tool for the devops role agents — no user
prompt has to ask for it. Classify every task by the tiers below before the
first tool call; pick the tier by signal, never by habit.

## Tiers (Inline → 1 agent → 2–3 agents → Full ceremony)

| Tier | Signal | Do |
|------|--------|----|
| **Inline** | 1 domain, Q&A, quick fix, or an answer reachable by reading ~5 files or fewer | No agent — a sub-agent pays a full context bootstrap and loses the conversation. |
| **1 agent, background** | The deliverable is a *conclusion* whose path would flood the conversation: anything that needs web pages (`research` — even one fetch, pages are huge), a sweep over more than ~10 files (`Explore`, "is our X sound?"), a full test suite or build (`qa`), a high-stakes plan or diff to attack (`redteam`), a trade-off with real stakes that no file answers (`po`) | Spawn automatically with `run_in_background: true`; keep working inline; relay the conclusion, not the transcript. |
| **2–3 agents, parallel** | Domains that can each be built *and tested* without the other's output (`core` fixes a service while `frontend` fixes an unrelated layout; two analysis lenses: `research` + `po`, `po` + `redteam`). A UI that consumes a new endpoint is **not** independent: Inline if ~5 files or fewer, else Full ceremony | Spawn in one message, ~5–15 tool calls per agent. |
| **Full ceremony** | 3+ domains, a feature end-to-end, or a high-risk change (migration, auth, breaking contract, destructive op) | Never auto-start. Offer `/run-agents` (`/run-autonomous` if the user will be away) in one sentence; proceed only on a yes. |

## Precedence: hard stop > escalation > tier table

- **Hard stop** — "just", "quick", "inline", "no agents" (de: "nur", "schnell",
  "einfach", "keine Agents") → Inline regardless of tier. A high-risk change
  still gets its inline pre-mortem (`pre-mortem.md`), just no agent.
- **Escalation** — same area iterated 2+ times without converging → one tier
  up (`qa` recurring bug, `designer` UI polish, `core` repeated refactor).
- Never spawn for an explanation or a single-fact lookup; never spawn silently;
  one announcement line per spawn (`→ research agent: <what>`).
- `redteam` only after the inline pre-mortem hits a higher-stakes trigger.

Details: `agent-orchestration.md` (roster, waves, QA protocol),
`agent-collaboration.md` (handoffs), `/run-agents` (explicit Full ceremony).
