---
name: auto-agents
version: 0.12.0
description: >-
  The single execution path for everything that implements — do-run,
  auto-concept (implement), auto-fix, auto-harden, auto-polish — and for a
  yes to Claude's full-ceremony offer. Applies the always-on delegation
  policy tiers (inline · 1 agent · parallel · full ceremony), reads plan and
  usage via get_usage, shows one agent card (waves · task · model · effort) and
  runs the waves; full ceremony keeps plan → confirm → waves → gates →
  synthesis. Invokes no skill: shipping or a concept page is handed back to
  the caller. Triggers on: "run agents", "use agents", "orchestrate",
  "parallel agents", "multi-agent", "delegate to agents", "agent workflow",
  or the user saying yes to Claude's offer. Do NOT trigger for: simple edits,
  quick fixes, explanations, or single-agent research.
layer: 5
invokes: []
user-invocable: false
triggers:
  en: ["run agents", "use agents", "orchestrate", "parallel agents", "multi-agent", "delegate to agents", "agent workflow"]
argument-hint: "[--from=<caller>] [--mode=interactive|background] [--ship=auto|manual] <task or plan>"
allowed-tools: Agent, Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__*, mcp__Claude_Preview__preview_start, mcp__Claude_Preview__preview_list
---

# auto-agents — the execution path

Every skill that implements executes through this one: `do-run`,
`auto-concept` (implement click and close-out follow-ups), `auto-fix`,
`auto-harden`, `auto-polish`. It decides *how* the work runs — inline, one
agent, parallel agents or the full wave ceremony — by the always-on
delegation policy (`deep-knowledge/agent-proactivity.md`), shows what it is
about to run, runs it, and returns the result to its caller.

**This skill invokes no skill.** It sits at the bottom of the call graph
(layer 5, `invokes: []`) because it only spawns role agents. Everything that
would need another skill — shipping, a concept page, an issue — is returned
to the caller as a field of the result (Step 7), and the caller decides.
Spawned agents follow the same rule: they report, they do not start skills.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/auto-agents/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/auto-agents/SKILL.md` + `reference.md`
   Fallback (pre-PR-2 name): where `auto-agents/` does not exist, read `~/.claude/skills/run-agents/` / `{project}/.claude/skills/run-agents/` instead — an extension written before the rename keeps working.
3. Merge: project > global > plugin defaults

## Step 1 — Inputs: arguments, plan and usage

### Arguments

| Argument | Set by | Meaning |
|---|---|---|
| `--from=<caller>` | every calling skill: `do-run`, `auto-concept`, `auto-fix`, `auto-harden`, `auto-polish` | Who gets the result (Step 7). **Absent** = the model invoked this skill directly — the user said yes to the full-ceremony offer or typed a trigger phrase; the main conversation is then the caller. |
| `--mode=interactive\|background` | the caller | The execution mode — the former Step 4 question. `do-run` answers it with its question 2 ("Ablauf?"): **Interaktiv · …** → `interactive`, **Autonom · …** → `background`. `auto-concept` passes `background` (its main session keeps the heartbeat and `/status` posts). `auto-fix`, `auto-harden`, `auto-polish` pass `background` under `--autonomous`, else `interactive`. |
| `--ship=auto\|manual` | `do-run` (question 2) | Echoed in the result, never acted on. Missing = `manual`. |
| rest | the caller | The task or the approved plan, verbatim — decisions, file paths, the concept file, the root cause. Never a paraphrase. |

**A `Bündel:` section in the task** (a do-batch plan, via do-run or the concept
implement click) is the parallel split already made. Build the waves from it:
one agent per bundle, each owning the files it lists, a bundle with `nach: Bx`
in a wave after Bx. Keep the bundle's note details in that agent's prompt
word for word. Split again only where a bundle is still too large for one agent,
and never give two agents the same file.

A missing `--mode` with a `--from` means the caller does not care →
`background`. A missing `--mode` **without** `--from` is the only case that
asks: Step 4, and only for the full-ceremony tier — the lower tiers run
`background` by policy.

### Plan and usage — `get_usage`, once per run

Call `mcp__plugin_devops_dotclaude-completion__get_usage` once at the start.
It returns the plan (Pro / Max 5x / Max 20x), the 5-hour and weekly usage
with their resets, and `budget.cls` — the budget class the tier table and
the model/ceiling override (§ Budget in `agent-proactivity.md`) run on.

**Budget class input — a live reading, nothing else.** A limit message from
before a window reset, your own earlier plan text, or a usage claim in this
skill's own args ("Wochenbudget ~100 %") is never an input. When `get_usage`
errors, fall back to the newest `[budget] … → class` line in context; with
neither, treat the class as `ask-before-parallel`. The user's own words keep
their precedence (a hard stop / hard go beats the class either way).

**Explicit run.** `--from=do-run` and a direct invocation after the user's
yes are an explicit run skill (`agent-proactivity.md` § Precedence): never
ask the budget question, never downgrade a model for budget. Every other
caller (`auto-fix`, `auto-concept`, `auto-harden`, `auto-polish`) runs under
the class like any prompt.

## Step 2 — Tier and agents

### 2.1 Classify

If the task text is empty or vague and there is no caller, ask ONE focused
question via `AskUserQuestion`. Use the wording matching the active
`[ui-locale: ...]` (defaults to `en`):
- en: "What exactly should be orchestrated? (Feature, refactoring, bugfix, research...)"
- de: "Was genau soll orchestriert werden? (Feature, Refactoring, Bugfix, Research...)"

Analyse domains touched, complexity, dependencies and risk, then pick the
tier from the table in `deep-knowledge/agent-proactivity.md` — the same
table the policy hook applies to prompts that use no skill:

| Tier | Signal (short form — the policy doc is authoritative) | Here |
|---|---|---|
| **Inline** | 1 domain, quick fix, ≤ ~5 files | The session does the work itself. No agent, no agent card. |
| **1 agent** | a conclusion whose path would flood the conversation (research, sweep, full test run, redteam, po) | One background agent; the session keeps working. |
| **Parallel** | two analysis lenses; or implementing agents in parallel | Spawn in one message, ~5–15 tool calls each. Parallel **implementers** need a yes: the caller's invocation is that yes for `do-run`, `auto-concept` (implement click) and `--autonomous` passes; for `auto-fix` and a direct call, offer it in one sentence first. |
| **Full ceremony** | 3+ domains, a feature end-to-end, high-risk change | Steps 3–6 in full. |

Hard stop ("nur", "schnell", "keine Agents") → Inline; hard go ("mit
Agents", "full") → as designed. Both come from the user's words, never from
the caller.

**A caller may skip this skill for Inline.** When the caller's own
classification already lands on Inline (one domain, ≤ ~5 files — a typo, a
one-file fix, a copy change), it applies the change itself: the Inline tier
has no table, no agent and no result contract, so loading this skill would
only add a round of reading. Everything above Inline goes through here.

### 2.2 Agent selection

Select agents using the roster, criteria, and complexity tiers from
`deep-knowledge/agent-orchestration.md` § Agent Selection.

### 2.3 Permission audit (parallel and full ceremony)

Before spawning more than one agent, scan recent sessions for MCP tools that
were used but are NOT covered by the current `~/.claude/settings.json`
allow-list. Prevents permission prompts from interrupting wave execution —
especially painful with parallel agents.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/permission-audit.js" --days=7 --quiet
```

Parse the JSON `suggestions` array:

- **Empty** → skip silently.
- **Non-empty** → present ALL suggestions in **one** `AskUserQuestion`
  multi-select. Never auto-apply — every rule needs user confirmation,
  to prevent log-forgery from seeding the allow-list. Each option =
  one suggested rule, labeled with its risk marker:
  - 🟢 low: user-installed plugin/runtime MCPs (`mcp__plugin_*`, `mcp__ccd_*`)
  - 🟡 medium: third-party / unknown MCPs — include the rationale text

  Pre-recommend the 🟢 ones in the description. Header: "Permissions",
  question: "Diese MCP-Tools wurden zuletzt genutzt aber sind nicht erlaubt.
  Welche zur Allow-Liste hinzufügen?"

  Apply the user's selection via Bash (NOT the Edit tool — settings.json is
  tamper-protected; the script writes directly via Node `fs.writeFileSync`):

  ```bash
  node "$CLAUDE_PLUGIN_ROOT/scripts/permission-audit.js" --apply="<rule1>,<rule2>" --quiet
  ```

  The script re-validates each `--apply` rule against its own freshly-computed
  suggestions and rejects anything not in the list (defense in depth).

Under `--mode=background` with a `--from`, do not ask: the user may be away
(`do-run` "Autonom"), and a pending prompt would stall the run. List the
suggestions in the result's `open` field (Step 7) instead. The audit is read-only on no findings — never blocks the flow when
there's nothing to fix.

## Step 3 — Present Plan

**Full ceremony only.** Present the orchestration plan to the user. Use the headings/labels for the
active `[ui-locale: ...]` (defaults to `en`):

| Key             | en                            | de                             |
|-----------------|-------------------------------|--------------------------------|
| `plan.heading`  | Orchestration plan            | Orchestrierungsplan            |
| `plan.budget`   | Complexity · tool-call budget | Komplexität · Tool-Call-Budget |
| `plan.deps`     | Dependencies                  | Abhängigkeiten                 |
| `plan.estimate` | Estimated agents              | Geschätzte Agents              |

Template (`{key}` → resolved per locale):

```
## {plan.heading}: <task summary>

<plan card — Step 5, rendered by scripts/agent-card.js>

**{plan.budget}:** Complex → ~15–30 tool calls per agent   [de: Complex → ~15–30 Tool-Calls pro Agent]

### {plan.deps}
- Wave 2 waits on Wave 1 (core contracts)   [de: Wave 2 wartet auf Wave 1 (Core-Contracts)]
- Wave 3 verifies all changes from Wave 1+2  [de: Wave 3 prüft alle Änderungen aus Wave 1+2]

### {plan.estimate}: N
```

**The agents** are the Step 5 plan card, not a hand-drawn table: waves as
sections, model and effort resolved by the script (Model & Effort Defaults
in `deep-knowledge/agent-orchestration.md`), a model override shown as
`default → override` — the Agent tool has no effort parameter, so effort
never carries an arrow.

**`{plan.budget}` line** — the complexity tier of the task (same doc,
§ Complexity Tiers) and the per-agent tool-call ceiling it implies: Medium →
`~5–15`, Complex → `~15–30`. Simple means inline work with no sub-agents; if
agents are spawned for a Simple task anyway (the user asked for orchestration
explicitly), apply the Medium ceiling. The same ceiling goes into every agent
prompt as item 6 of § Agent Prompt Template — the plan shows the budget the
prompts will carry, so it is visible before anything is spawned.

**Confirmation — only where the user has not already said go.** Ask for it
on a direct invocation (no `--from`) and on `--from=do-run --mode=interactive`.
Every other caller's own gate was the confirmation — do-run's questions
answered with "Autonom", the concept's implement click, an `--autonomous` pass —
and the user may be away, so show the plan and continue; the plan card is
then the one agent overview of the run — Step 5 does not show it twice.
Accept:
- en: "yes" / "go" / "do it" → proceed as planned
- de: "ja" / "go" / "mach" → proceed as planned
- Modifications → adjust plan
- en: "less" / "only X" — de: "weniger" / "nur X" → reduce scope

## Step 4 — Execution Mode

The mode normally arrives as `--mode` (Step 1). Ask only when this skill was
invoked directly — no `--from`, no `--mode` — and the tier is full ceremony.
Ask after the plan is confirmed, via `AskUserQuestion`, in the version
matching the active `[ui-locale: ...]`:

**en:**
```
question: "How should the agents work?"
header: "Mode"
options:
  - label: "Background (recommended)"
    description: "Agents run autonomously. Single final report at the end."
  - label: "Interactive"
    description: "Agents involve you on design/concept decisions — AskUserQuestion for short trade-offs; a richer comparison ends the wave and comes back to you as an open decision. Expect ≥1 checkpoint per wave."
```

**de:**
```
question: "Wie sollen die Agents arbeiten?"
header: "Modus"
options:
  - label: "Hintergrund (Recommended)"
    description: "Agents arbeiten autonom. Am Ende ein Gesamtbericht."
  - label: "Interaktiv"
    description: "Agents binden dich bei Design-/Konzeptentscheidungen ein — AskUserQuestion für kurze Trade-offs; ein größerer Vergleich beendet die Wave und kommt als offene Entscheidung zu dir zurück. Rechne mit ≥1 Checkpoint pro Wave."
```

Store the result as `$EXEC_MODE` (`background` or `interactive`).

## Step 5 — Agent Cards

Every agent display is **one card from one template**
(`hooks/lib/agent-card.js`) — one agent, three or ten look alike, only the
rows grow. **Not for Inline**: nothing is spawned. Two kinds:

| Card | Who renders it | When |
|---|---|---|
| **Plan card** 🗺️ | `node {PLUGIN_ROOT}/scripts/agent-card.js` (JSON on stdin, see the script header) | Full ceremony: in the Step 3 plan, or — where Step 3 asks no confirmation — once when execution starts. Again only when the run changes shape (a wave added or dropped, a scope-cut, a sub-split) — the full card, not a diff. |
| **Spawn card** 🤖 | `pre.agent.announce`, for every launch | Every tier that spawns. Agents launched in one message each hand you a card that grows by one row — show **only the last one** of the message, verbatim; it lists them all. A prose summary ("vier Agenten setzen … um") never replaces it. |

Relay both verbatim, also under the Quiet output style. Neither is typed by
hand — the plan card comes from the script, the spawn card from the hook,
so model and effort are resolved the same way in both.

What the template does (so you know what you relay):

- **Header** — `🗺️ Agent-Plan · N Agents · M Waves · <tier>` or
  `🤖 N Agents gestartet · <mode>`; localised by `[ui-locale]` (`lang` in the
  script input, the session locale in the hook).
- **Newest note once** — `*Modelle: jeweils neueste Version der Familie*`
  under the header, never repeated per row; dropped when every agent inherits.
- **Waves** — sections (`#### Wave 1 · 2 Agents`) ordered numerically when a
  card spans more than one wave; a spawn batch within one wave names it in
  the header. Spawn descriptions therefore start with `[W<n>]`
  (`[W1] API contracts`) — the card strips the prefix from the task cell.
- **Rows** — role icon · agent · task · model · effort (`●●○ medium`).
- **Σ tally** — the last line groups agents by model · effort
  (`**3×** sonnet ●●○ medium  ·  **1×** opus ●●● high`), only when at
  least one combination occurs twice.

Cards have **no CTA**: no decision heading, no question, no buttons, no "say
go". Nothing waits on them — execution continues in the same turn. They
never carry the `✨✨✨` completion-card marker (reserved for the completion
card; the stop guard counts it).

**Model — resolved at runtime, never hard-coded.** A model id or version
number never appears in this skill, a frontmatter, an override or a prompt:

1. **The chosen family.** The agent's frontmatter `model`, or the override
   you pass at spawn. It must be a value of the Agent tool's `model`
   parameter enum as the tool schema lists it in this session — read the
   enum, do not assume it (today: `sonnet`, `opus`, `haiku`, `fable`). The
   harness resolves each alias to the **newest release** of that family at
   spawn — which is why the card says so once and the cells stay bare.
2. **The cell.** `inherit` → the session's own model with its version (the
   script takes it as `"session": "<model> · <effort>"`; the hook reads it
   from the transcript) — that is what the agent runs on. A family alias →
   the bare `<family>`. An override → `<default> → <override>`, e.g.
   `sonnet → opus`.

**Effort — per task.** The agent's frontmatter `effort` (the Agent tool has
no effort parameter, so that value is the effective one); `inherit` → the
session's effort. Never an arrow: a budget override lowers the tool-call
ceiling, not the effort.

## Step 6 — Execution

Follow `deep-knowledge/agent-orchestration.md` § Wave Execution for spawning mechanics,
agent prompt template (now incl. per-agent effort budget, stopping criteria, and
distinct scope boundary), branch strategy, and single-agent shortcut. Between waves,
apply § Inter-Wave Verification Gate — verify each wave's handoff before the next
wave builds on it (the cascading-error guard).

Collaboration protocol (handoffs, merge order): `deep-knowledge/agent-collaboration.md`.

Per tier:

- **Inline** — do the work in this session; no agent.
- **1 agent / parallel** — § Single-Agent Shortcut, or one message with all
  independent agents; no waves, no inter-wave gate. `devops:qa` verifies
  implementing work when the change is more than one file.
- **Full ceremony** — waves as planned in Step 3, inter-wave gates, QA wave.

### Mode-Specific Behavior

- **Background** (`$EXEC_MODE`): Use interaction directive "Autonomous" from the
  orchestration doc. Spawn with `run_in_background: true`. Continue with other work
  or inform the user. Collect results when notified.
- **Interactive** (`$EXEC_MODE`): Use interaction directive "Interactive" from the
  orchestration doc. Spawn in foreground. Present interim results after each wave
  with inline analysis text.
  The **orchestrator itself** also follows the Engagement Rules — for
  cross-wave conceptual decisions (overall approach, contract shape between
  waves, evaluation criteria, scope cuts) use `AskUserQuestion` *before*
  spawning the relevant wave, not only inside it. A decision too rich for
  `AskUserQuestion` (the Engagement Rules' concept-page cases) is **not**
  opened here: stop before that wave and return it as `needs-decision`
  (Step 7). The caller opens the concept page and re-enters this skill with
  the answer.
  Treat the user as a collaborator on the plan, not just a recipient of results.

QA Wave testing protocol and single-agent shortcut: see `deep-knowledge/agent-orchestration.md`
§ QA Wave — Testing Protocol and § Single-Agent Shortcut.

## Step 7 — Return to the caller

After the last wave (or when a `needs-decision` stops the run):

1. Summarize what each agent accomplished
2. List any unresolved findings or open questions
3. Show final branch/PR state
4. Hand the result back in this shape — the caller reads it, the user sees it:

```
auto-agents result
tier: <inline | 1 agent | parallel | full ceremony>
done: <what landed — commits, files, per agent>
open: <unresolved findings, shortfalls with their reason — or "none">
needs-decision: <the fork, its options, the wave it blocks — or "none">
ship: <auto | manual>
```

`ship` echoes `--ship` (missing = `manual`). **This skill never ships and
never tells the user to type a ship command.** `ship: auto` means the
caller runs `do-ship` next; `ship: manual` means the caller's completion
card offers shipping as its decision. A `needs-decision` means the caller
decides how to put it in front of the user (a concept page, a question) and
calls this skill again with the answer.

5. **Completion card.** With a caller (`--from`), the caller renders it —
   one card per turn, and the caller knows the whole run. On a direct
   invocation, render it here via `render_completion_card` (variant per
   outcome, see the card design doc); shipping is then its decision point,
   not a skill call.

## Rules

- **Invokes no skill** — not `do-ship`, not `auto-concept`, not
  `auto-issue`, not a nested `auto-agents`. Shipping, concept pages and
  issues are returned to the caller (Step 7).
- **Never skip the plan step in full ceremony** — the plan is always shown;
  confirmation is asked where Step 3 says so.
- **Agent cards, never hand-drawn tables** — the plan card from the script,
  the spawn card from `pre.agent.announce` (the last one of each message),
  both verbatim; no CTA, no hard-coded model version.
- **Never run agents silently** — a launch without its spawn card shown is a
  silent launch, also under the Quiet output style
- **Respect wave dependencies** — Core before Frontend, QA after all code changes
- **Never ship automatically** — agents commit and push only; `ship: auto`
  is an instruction to the caller, not an action here.
- **Follow handoff protocol** — every agent-to-agent transition uses structured handoffs
- If the user says "just do it" without agents → respect that, don't orchestrate
- The tier decision follows `deep-knowledge/agent-proactivity.md`; a caller
  that invoked this skill never re-litigates it, and neither does this skill
  once the user said yes to a ceremony.
