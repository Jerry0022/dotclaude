---
name: devops-agents
version: 0.4.0
description: >-
  Evaluate which agents are useful for a task and orchestrate their parallel or
  sequential execution. Use when the user explicitly wants orchestrated agent
  work instead of inline execution, or when a task clearly benefits from
  multi-agent collaboration. Triggers on: "agents", "orchestrate",
  "use agents", "parallel agents", "multi-agent", "delegate to agents",
  "agent workflow". Do NOT trigger for: simple single-file edits, quick fixes,
  explanations, or research-only tasks (use /devops-deep-research).
argument-hint: "[task description or goal]"
allowed-tools: Agent, Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__*, mcp__Claude_Preview__preview_start, mcp__Claude_Preview__preview_list
---

# Orchestrate

Evaluate which agents add value for `$ARGUMENTS`, then orchestrate their execution.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/devops-agents/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/devops-agents/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Task Analysis

Analyze `$ARGUMENTS` to understand:

1. **Domains touched** — which areas of the codebase are affected?
2. **Complexity** — single-domain vs. cross-cutting?
3. **Dependencies** — what must happen before what?
4. **Risk level** — does this need QA/PO review?

If `$ARGUMENTS` is empty or vague, ask ONE focused question via `AskUserQuestion`.
Use the wording matching the active `[ui-locale: ...]` (defaults to `en`):
- en: "What exactly should be orchestrated? (Feature, refactoring, bugfix, research...)"
- de: "Was genau soll orchestriert werden? (Feature, Refactoring, Bugfix, Research...)"

## Step 1.5 — Permission Audit

Before spawning agents, scan recent sessions for MCP tools that were used but
are NOT covered by the current `~/.claude/settings.json` allow-list. Prevents
permission prompts from interrupting wave execution — especially painful with
parallel agents.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/permission-audit.js" --days=7 --quiet
```

Parse the JSON `suggestions` array:

- **Empty** → skip silently, continue to Step 2.
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

The audit is read-only on no findings — never blocks the flow when there's
nothing to fix.

## Step 2 — Agent Selection

Select agents using the roster, criteria, and complexity tiers from
`deep-knowledge/agent-orchestration.md` § Agent Selection.

## Step 3 — Present Plan

Present the orchestration plan to the user. Use the headings/labels for the
active `[ui-locale: ...]` (defaults to `en`):

| Key             | en               | de                  |
|-----------------|------------------|---------------------|
| `plan.heading`  | Orchestration plan | Orchestrierungsplan |
| `plan.task_col` | Task             | Aufgabe             |
| `plan.deps`     | Dependencies     | Abhängigkeiten      |
| `plan.estimate` | Estimated agents | Geschätzte Agents   |

Template (`{key}` → resolved per locale):

```
## {plan.heading}: <task summary>

### Agents (N selected)

| Wave | Agent(s) | {plan.task_col} |
|------|----------|-----------------|
| 0 | research | <what they investigate> |
| 1 | core | <what contracts/APIs they define> |
| 2 | frontend, windows | <what they build, in parallel> |
| 3 | qa | <what they verify> |

### {plan.deps}
- Wave 2 waits on Wave 1 (core contracts)   [de: Wave 2 wartet auf Wave 1 (Core-Contracts)]
- Wave 3 verifies all changes from Wave 1+2  [de: Wave 3 prüft alle Änderungen aus Wave 1+2]

### {plan.estimate}: N
```

Wait for user confirmation before proceeding. Accept:
- en: "yes" / "go" / "do it" → proceed as planned
- de: "ja" / "go" / "mach" → proceed as planned
- Modifications → adjust plan
- en: "less" / "only X" — de: "weniger" / "nur X" → reduce scope

## Step 4 — Execution Mode

After the plan is confirmed, ask the user for the execution mode via
`AskUserQuestion`. Use the version matching the active `[ui-locale: ...]`:

**en:**
```
question: "How should the agents work?"
header: "Mode"
options:
  - label: "Background (recommended)"
    description: "Agents run autonomously in the background. You get a single final report."
  - label: "Interactive"
    description: "Agents ask on decisions and stream interim results inline in chat."
```

**de:**
```
question: "Wie sollen die Agents arbeiten?"
header: "Modus"
options:
  - label: "Hintergrund (Recommended)"
    description: "Agents arbeiten autonom im Hintergrund. Du bekommst am Ende einen Gesamtbericht."
  - label: "Interaktiv"
    description: "Agents fragen bei Entscheidungen nach und liefern Zwischenergebnisse inline im Chat."
```

Store the result as `$EXEC_MODE` (`background` or `interactive`).

## Step 5 — Execution

Follow `deep-knowledge/agent-orchestration.md` § Wave Execution for spawning mechanics,
agent prompt template, branch strategy, and single-agent shortcut.

Collaboration protocol (handoffs, merge order, shipping): `deep-knowledge/agent-collaboration.md`.

### Mode-Specific Behavior

- **Background** (`$EXEC_MODE`): Use interaction directive "Autonomous" from the
  orchestration doc. Spawn with `run_in_background: true`. Continue with other work
  or inform the user. Collect results when notified.
- **Interactive** (`$EXEC_MODE`): Use interaction directive "Interactive" from the
  orchestration doc. Spawn in foreground. Present interim results after each wave
  with inline analysis text.

QA Wave testing protocol and single-agent shortcut: see `deep-knowledge/agent-orchestration.md`
§ QA Wave — Testing Protocol and § Single-Agent Shortcut.

## Step 6 — Synthesis

After all waves complete:

1. Summarize what each agent accomplished
2. List any unresolved findings or open questions
3. Show final branch/PR state
4. Remind the user to run `/devops-ship` manually when ready to merge
5. Trigger completion flow

## Rules

- **Never skip the plan step** — always present and confirm before executing
- **Never run agents silently** — announce each agent launch
- **Respect wave dependencies** — Core before Frontend, QA after all code changes
- **Never ship automatically** — agents commit and push only. The user decides when to run `/devops-ship`
- **Follow handoff protocol** — every agent-to-agent transition uses structured handoffs
- If the user says "just do it" without agents → respect that, don't orchestrate
- If only 1 domain is affected → consider if a single inline execution is simpler
- The user called this skill explicitly — they WANT orchestration, so deliver it
