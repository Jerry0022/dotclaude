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
| **2–3 agents, parallel** | Two *analysis* lenses on one question (`research` + `po`, `po` + `redteam`) | Spawn in one message, ~5–15 tool calls per agent. **Implementing** agents in parallel (`core` + `frontend` editing the working tree at once) are never auto-spawned: offer it in one sentence like a ceremony. A UI that consumes a new endpoint is not independent anyway: Inline if ~5 files or fewer, else Full ceremony. |
| **Full ceremony** | 3+ domains, a feature end-to-end, or a high-risk change (migration, auth, breaking contract, destructive op) | Never auto-start. Offer `/run-agents` (`/run-autonomous` if the user will be away) in one sentence; proceed only on a yes. |

Announce every spawn in one line that shows the mode:
`→ research agent (opus, ≤15 calls): <what>` / `→ research agent (sonnet, ≤10 calls, spare): <what>`.

## Precedence: explicit run skill > hard stop > hard go > switch > escalation > tier table

- **Explicit run skill** — inside `/run-agents`, `/run-autonomous`,
  `/run-backlog`, `/run-burn` the invocation itself is the answer: never ask
  the budget question, never downgrade a model for budget (run-burn upgrades
  on purpose). The hooks drop the budget suffix on `AUTONOMOUS_*` prompts.
- **Hard stop** — the user *narrows the request* with "just", "quick",
  "inline", "no agents" (de: "nur X", "schnell", "keine Agents") → Inline
  regardless of tier. A filler use ("kannst du einfach mal prüfen, ob unsere
  Auth sound ist") is not a stop — the request itself is still a sweep.
  A high-risk change still gets its inline pre-mortem (`pre-mortem.md`).
- **Hard go** — the user says "agents", "mit Agents", "full", "komplett
  durchziehen" → spawn as designed, no budget question.
- **Switch** — the `[delegation] mode` line (`.claude/delegation.json`
  `{"mode":"auto"|"ask"|"off"}`, project over `~/.claude/`): `ask` → every
  tier above Inline is offered in one sentence and runs only on a yes;
  `off` → Inline always, no offers. Both cap only *proactive* spawns — an
  explicit run skill or a hard go still spawns as designed.
- **Escalation** — same area iterated 2+ times without converging → one tier
  up (`qa` recurring bug, `designer` UI polish, `core` repeated refactor).
- Never spawn for an explanation or a single-fact lookup; never spawn silently.
- `redteam` only after the inline pre-mortem hits a higher-stakes trigger.

## Budget (the `[budget] … → class` line; plan × window × week)

Volume goes where opus·high agents are spawned — model × effort × tool
calls. The Agent tool has no effort parameter (effort is the agent's
frontmatter), so the spare path uses the two levers it has: `model: sonnet`
and a hard tool-call ceiling written into the agent prompt. The class names
say what they do, not how full the meter is.

- **free** → tiers as above; ceilings per `agent-orchestration.md`.
- **ask-before-parallel** (Pro from 0 %, Max 5x ≥ 80 %/90 %, Max 20x
  ≥ 90 %/95 %, unknown plan with unknown usage) → the 1-agent tier runs on
  `model: sonnet` with ≤ 10 tool calls, no question. Before a **parallel**
  spawn or a **ceremony**, ask ONCE per session via AskUserQuestion — one
  question, three options, localized per `[ui-locale]`, first = default:
  *spare the window* (1 sonnet agent, ≤ 10 calls, primary lens) /
  *the right agents regardless of the window* / *no agent, inline now*.
  For a ceremony the second option is the ceremony itself, so the user never
  sees two questions in a row.
- **sonnet-only** (Pro ≥ 70 %/85 %, Max 5x ≥ 95 %/98 %, Max 20x ≥ 98 %/99 %)
  → the 1-agent tier runs on `model: sonnet` with ≤ 5 tool calls;
  parallel/ceremony ask as above, and the question names the binding reset
  ("window resets in N min" / "week resets in N h").
- **The answer holds for the whole session and every tier**: after "the right
  agents", also the 1-agent tier is back on its frontmatter model; after
  "spare", parallel stays collapsed. Re-ask only when you cannot tell whether
  you asked (after a context compaction) or the class changed (a reset, a
  window filling up) — one question is cheaper than a wrong assumption.
  A new session asks again; nothing is persisted.
- Never ask on Inline or 1-agent prompts: there is no real alternative there.
- The class comes from `~/.claude/usage-live.json`. On the Desktop app that
  file is only as fresh as the last completion card, so a snapshot past its
  window reset (the morning-after session) starts one detached refresh —
  the card's own scraper, `--no-login`, never awaited — and the per-prompt
  `budget:` suffix carries the live class from the next prompt on.

Details: `agent-orchestration.md` (roster, waves, QA protocol, budget item in
the spawn template), `agent-collaboration.md` (handoffs), `/run-agents`
(explicit Full ceremony).
