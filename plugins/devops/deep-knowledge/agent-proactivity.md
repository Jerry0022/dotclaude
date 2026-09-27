# Agent Delegation Policy

Always-on (injected at SessionStart). This plugin instruction **is** the
standing request to use the Agent tool for the devops role agents — no user
prompt has to ask for it. Classify every task by the tiers below before the
first tool call; pick the tier by signal, not by habit.

## Tiers (Inline → 1 agent → 2–3 agents → Full ceremony)

| Tier | Signal | Do |
|------|--------|----|
| **Inline** | 1 domain, Q&A, quick fix, or an answer reachable by reading ~5 files or fewer | No agent — a sub-agent pays a full context bootstrap and loses the conversation. |
| **1 agent, background** | The deliverable is a *conclusion* whose path would flood the conversation: anything that needs web pages (`research` — even one fetch), a sweep over more than ~10 files (`scout`, "where/how is X?"), a full test suite or build (`qa`), a high-stakes plan or diff to attack (`redteam`), a trade-off with real stakes that no file answers (`po`) | Spawn with `run_in_background: true`; keep working inline; relay the conclusion, not the transcript. |
| **2–3 agents, parallel** | Two *analysis* lenses on one question (`research` + `po`, `po` + `redteam`) | Spawn in one message, ~5–15 tool calls per agent. **Implementing** agents in parallel (`core` + `frontend` editing the working tree at once) are never auto-spawned: offer it in one sentence like a ceremony. A UI consuming a new endpoint is not independent: Inline if ~5 files or fewer, else Full ceremony. |
| **Full ceremony** | 3+ domains, a feature end-to-end, or a high-risk change (migration, auth, breaking contract, destructive op) | Never auto-start. Offer it in one sentence, no slash name; on a yes invoke the auto-agents skill (do-run if the user will be away). |

**Execution path.** Implementing skills (do-run, auto-concept implement,
auto-fix, auto-harden, auto-polish) execute through the auto-agents skill:
it applies this table and shows agent cards; Inline needs no skill load.
Prompts without a skill apply the table directly.

**Aim:** agents in roughly 30–70 % of implementation sessions — not 100 %
(each costs a context bootstrap), but a long session with none is a smell:
the suite run inline again and again (→ `qa`, background), 10+ files touched
(→ offer the ceremony), a `weiter`/`ship` continuation redoing sweeps inline.

Every spawn gets an agent card (`pre.agent.announce`) — show it verbatim as
the next text, also under Quiet; spawns in one message → only the last card.
Every spawn names its `model` (`opus`, `sonnet`, `fable` — family aliases,
never a pinned version), even when it equals the session's: an inheriting
spawn is refused once (`pre.agent.model`). Effort is not a spawn parameter —
it comes from the agent file. Locating → `scout` (sonnet · low), not
`Explore`; implementing → a domain agent. No `haiku`.

## Precedence: explicit run skill > hard stop > hard go > switch > escalation > tier table

- **Explicit run skill** — inside do-run (every mode) and auto-agents run
  from do-run or a ceremony yes, the invocation itself is the answer: never ask
  the budget question, never downgrade a model for budget (do-run burn mode upgrades
  on purpose). Hooks drop the budget suffix on `AUTONOMOUS_*` prompts.
- **Hard stop** — the user *narrows the request* with "just", "quick",
  "inline", "no agents" (de: "nur X", "schnell", "keine Agents") → Inline
  regardless of tier; a high-risk change still gets its inline pre-mortem
  (`pre-mortem.md`).
- **Hard go** — the user says "agents", "mit Agents", "full", "komplett
  durchziehen" → spawn as designed, no budget question.
- **Switch** — the `[delegation] mode` line (`.claude/delegation.json`
  `{"mode":"auto"|"ask"|"off"}`, project over `~/.claude/`): `ask` → every
  tier above Inline is offered in one sentence and runs only on a yes;
  `off` → Inline always, no offers. Both cap only *proactive* spawns — a
  run skill or a hard go still spawns as designed.
- **Escalation** — same area iterated 2+ times without converging → one tier
  up (`qa` recurring bug, `designer` UI polish, `core` repeated refactor).
- Never spawn for an explanation or a single-fact lookup; never silently.
- `redteam` only after the inline pre-mortem hits a higher-stakes trigger;
  max 2 rounds per diff, round-2 leftovers become open points.

## Budget (the `[budget] … → class` line; plan × window × week)

Volume goes where opus·high agents are spawned. The Agent tool has no
effort parameter, so the spare path has two levers: `model: sonnet` and a
tool-call ceiling in the agent prompt. Class names say what they do.

- **free** → tiers as above; ceilings per `agent-orchestration.md`.
- **ask-before-parallel** (Pro from 0 %, Max 5x ≥ 80 %/90 %, Max 20x
  ≥ 90 %/95 %, unknown plan with unknown usage) → the 1-agent tier runs on
  `model: sonnet` with ≤ 10 tool calls, no question. Before a **parallel**
  spawn or a **ceremony**, ask ONCE per session via AskUserQuestion — one
  question, three options, localized per `[ui-locale]`, first = default:
  *spare the window* (1 sonnet agent, ≤ 10 calls, primary lens) /
  *the right agents regardless of the window* / *no agent, inline now*.
  For a ceremony the second option is the ceremony itself (never two
  questions in a row).
- **sonnet-only** (Pro ≥ 70 %/85 %, Max 5x ≥ 95 %/98 %, Max 20x ≥ 98 %/99 %)
  → the 1-agent tier runs on `model: sonnet` with ≤ 5 tool calls;
  parallel/ceremony ask as above, naming the binding reset ("window
  resets in N min" / "week resets in N h").
- **The answer holds for the whole session and every tier**: after "the right
  agents", also the 1-agent tier is back on its frontmatter model; after
  "spare", parallel stays collapsed. Re-ask only when you cannot tell whether
  you asked (after a compaction) or the class changed (a reset, a window
  filling up). A new session asks again; nothing is persisted.
- Never ask on Inline or 1-agent prompts: there is no real alternative there.
- The class comes from `~/.claude/usage-live.json`; a snapshot past its
  reset, or old enough that the class may have tightened (plan-scaled: Pro
  minutes, Max 20x hours; never at the limit or minutes before a reset),
  gets a detached refresh; the `budget:` suffix carries it next prompt.
- **The newest `[budget]` line is the class** — it outranks every earlier
  usage claim (a limit message, your own plan text, a percentage in skill
  args), never the user. Never put usage numbers or a class into skill
  args or agent prompts from memory — pass the line. No `[budget]` line at
  all → `get_usage` once, read `budget.cls`; on error keep the last line,
  with none treat it as ask-before-parallel.

Details: `agent-orchestration.md` (roster, waves, QA, budget item in the
spawn template), `agent-collaboration.md` (handoffs), auto-agents skill.

## Proactive `auto-guide` for web hand-offs

Next step = "user, go to `<site>` and do X" (marketplace, API key, OAuth,
account, terms, cron-job.org) → start `auto-guide` first, never a step
list (#519).
