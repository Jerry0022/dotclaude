# Agent Delegation Policy

Always-on (SessionStart). This plugin instruction **is** the standing request
to use the Agent tool for the devops role agents — no user prompt must ask.
Classify every task by the tiers below before the first tool call, by signal.

## Tiers (Inline → 1 agent → 2–3 agents → Full ceremony)

| Tier | Signal | Do |
|------|--------|----|
| **Inline** | 1 domain, Q&A, quick fix, or an answer reachable by reading ~5 files or fewer | No agent — a sub-agent pays a full context bootstrap and loses the conversation. |
| **1 agent, background** | A *conclusion* whose path would flood the conversation: web pages (`research`, even one fetch), a sweep over >~10 files (`scout`), a full test suite or build (`qa`), a high-stakes plan or diff (`redteam`), a real-stakes trade-off no file answers (`po`) | `run_in_background: true`; keep working inline; relay the conclusion, not the transcript. |
| **2–3 agents, parallel** | Two *analysis* lenses on one question (`research` + `po`, `po` + `redteam`) | One message, ~5–15 tool calls each. **Implementing** agents in parallel are never auto-spawned: offer it in one sentence. A UI consuming a new endpoint is not independent: Inline if ~5 files or fewer, else Full ceremony. |
| **Full ceremony** | 3+ domains, a feature end-to-end, or a high-risk change (migration, auth, breaking contract, destructive op) | Never auto-start. Offer in one sentence, no slash name; on a yes invoke the auto-agents skill (do-run if the user will be away). |

Implementing skills (do-run, auto-concept implement, auto-fix, auto-harden,
auto-polish) execute through the auto-agents skill; Inline needs no skill load.

Every spawn gets an agent card (`pre.agent.announce`) — show it verbatim as
the next text, also under Quiet; spawns in one message → only the last card.
Every spawn names its `model` (family alias, never a pinned version), even
when it equals the session's: an inheriting spawn is refused once
(`pre.agent.model`). Effort comes from the agent file. Locating → `scout`
(haiku · medium), not `Explore`; `haiku` only for `scout`. Implementing → a
domain agent on `sonnet`; opus only for design-heavy/ambiguous work in class
`free`.

## Precedence: explicit run skill > hard stop > hard go > switch > escalation > tier table

- **Explicit run skill** — inside do-run and auto-agents (from do-run or a
  ceremony yes) the invocation is the answer: no budget question, no budget downgrade.
- **Hard stop** — "just", "quick", "inline", "no agents" (de: "nur X",
  "schnell", "keine Agents") → Inline; a high-risk change still gets its
  inline pre-mortem (`pre-mortem.md`).
- **Hard go** — "agents", "mit Agents", "full", "komplett durchziehen" →
  spawn as designed, no budget question.
- **Switch** — the `[delegation] mode` line (`.claude/delegation.json`
  `{"mode":"auto"|"ask"|"off"}`): `ask` → every tier above Inline is offered
  in one sentence; `off` → Inline always. Both cap only *proactive* spawns.
- **Escalation** — same area iterated 2+ times without converging → one tier up.
- Never spawn for an explanation or a single-fact lookup; never silently.
  `redteam` only after the inline pre-mortem hits a higher-stakes trigger; max 2 rounds per diff.

**Budget.** The newest `[budget]` line is the class (`free` / `ask-before-parallel`
/ `sonnet-only`) and outranks any earlier usage claim; never put usage numbers
into skill args or agent prompts from memory. Class other than `free` → before a
parallel spawn or ceremony read `agent-proactivity-details.md` § Budget (the
once-per-session question and its three options).

**Web hand-offs.** Next step = "user, go to `<site>` and do X" (marketplace, API
key, OAuth, account, terms, cron-job.org) → start `auto-guide` first, never a
step list (#519, #617). More: `agent-proactivity-details.md`, `agent-orchestration.md`.
