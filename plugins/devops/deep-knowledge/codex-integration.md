# Codex Integration

Cross-cutting reference for all points where `codex-plugin-cc` skills are
integrated into devops workflows. All integrations are **optional** —
they activate only when codex-plugin-cc is installed.

## Detection & Behavior

Before calling any `/codex:*` skill, check availability. The simplest method:
attempt to invoke the skill and handle graceful failure. Do NOT block workflows
if Codex is unavailable.

## Hard Timeout & Failure-Tolerance (MANDATORY)

Codex calls **MUST** be wrapped so they cannot stall the main session. The
`/codex:rescue` subagent and `codex-companion.mjs task` helper have no built-in
wall-clock ceiling — when the user's Codex usage limit is exhausted, auth
expires, or the upstream service stalls, the Codex process hangs silently and
the calling devops workflow waits forever.

**Rule:** From every devops integration point (skills and agents), invoke
Codex via the plugin wrapper `{PLUGIN_ROOT}/scripts/codex-safe.sh` using the
Bash tool — NOT via `Agent(subagent_type: "codex:codex-rescue")` and NOT via
raw `node codex-companion.mjs` calls.

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-safe.sh" "<prompt text>"
# or with a custom ceiling / model:
CODEX_SAFE_TIMEOUT=180 bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-safe.sh" \
  --model gpt-5.3-codex "<prompt text>"
```

The wrapper enforces a **5-minute** default ceiling
(`CODEX_SAFE_TIMEOUT`, seconds) and exits deterministically:

| rc   | Meaning                          | Required Action                                                 |
|------|----------------------------------|-----------------------------------------------------------------|
| 0    | Codex returned output            | Use stdout as advisory input                                    |
| 124  | Timeout exceeded                 | **Continue without Codex findings.** Log "Codex timed out — proceeding without review." Do NOT retry. |
| 126  | `DEVOPS_DISABLE_CODEX=1`         | Skip silently                                                   |
| 127  | `codex` CLI missing              | Skip silently (graceful unavailability)                         |
| *    | Codex error (auth, quota, etc.)  | Skip Codex findings, note stderr briefly, continue              |

**Hard constraints:**

- Never retry on rc=124. One shot, then move on.
- Never block the user on a Codex result — all findings are advisory.
- Do NOT call `/codex:rescue` via the Agent tool from inside any devops
  skill or agent. The Agent tool has no timeout; if Codex hangs, the whole
  session hangs.
- Users can preemptively disable Codex integration for a session by setting
  `DEVOPS_DISABLE_CODEX=1` in `.claude/settings.local.json` env.

**Pattern used across all integration points:**

```
If codex-plugin-cc is installed → run the Codex step AUTOMATICALLY (no user prompt)
If not installed → skip silently, proceed with normal workflow
```

**Key principle:** When Codex is available, it is used **proactively and
automatically** at defined integration points. Codex steps are not "offered" or
"suggested" — they are executed as part of the normal workflow. The user does
not need to opt in per invocation. Codex findings are always **advisory** (never
a hard gate), so automatic execution carries no risk of blocking workflows.

## Integration Points

### 1. /devops-ship — Pre-PR Code Review (Step 2, Quality Gates)

**When:** After build + lint + tests pass, before commit/push/PR.
**Skill:** `/codex:rescue` (delegates diff review to Codex).
**Behavior:**
- **Automatically run** `/codex:rescue` with the diff as context for independent code review
- Evaluate findings:
  - No findings / clean → continue pipeline
  - Auto-fixable (typos, missing imports, style) → fix inline, continue
  - Judgment required (design concerns, logic flaws, security) → AskUserQuestion with options
- This is a **MUST run** gate, not optional or suggested

**Value:** Only point in the pipeline where a second AI reviews the code
systematically. Tests verify behavior; Codex reviews design and logic.

### 2. /devops-flow — Rescue on Unclear Root Cause (Step 6, Decision)

**When:** Root cause analysis yields no clear result after investigation.
**Skill:** `/codex:rescue`
**Behavior:**
- After Step 5 (Root cause analysis), if root cause is unclear
- **Automatically invoke** `/codex:rescue` — do not ask the user first
- Codex investigates independently with fresh context
- Results feed back into the decision matrix
- Continue with hypothesis approach in parallel while Codex works

**Value:** Fresh perspective when Claude is stuck in a debugging loop.

### 3. post.flow.debug Hook — Rescue Suggestion

**When:** 2+ consecutive Bash failures detected.
**Skill:** `/codex:rescue` (mentioned as alternative)
**Behavior:**
- Existing behavior: recommend `/devops-flow`
- Added: mention `/codex:rescue` as alternative for delegation
- No automatic invocation — hook outputs text only (cannot invoke skills)

**Value:** Low-cost hint. The actual automatic invocation happens when `/devops-flow`
runs and reaches Step 6 with an unclear root cause (see Integration Point 2).

### 4. QA Agent — Codex Review

**When:** QA agent runs verification on changes.
**Skill:** `/codex:rescue`
**Behavior:**
- **Automatically run** `/codex:rescue` when QA detects high-risk
  or complex changes (multi-file, architectural, security-sensitive)
- For simple changes (single file, trivial fix) → skip Codex, standard QA only
- Findings included in QA_RESULT output under `codex_review`

**Value:** Independent review from a second AI that challenges assumptions.

### 5. Research Agent — Parallel Delegation

**When:** Research topic has multiple independent angles.
**Skill:** `/codex:rescue`
**Behavior:**
- Research agent **automatically delegates** 1-2 sub-questions to Codex when
  the topic breaks into 3+ independent angles
- Results merged into the final research report
- Codex findings clearly attributed

**Value:** Parallel research capacity — two AIs investigating simultaneously.

## Token Cost

| Integration Point | Estimated Cost | Frequency |
|---|---|---|
| /devops-ship review | ~20-40K tokens | Per ship (~2-5/week) |
| /devops-flow rescue | ~30-50K tokens | When stuck (~1-3/week) |
| post.flow.debug | 0 (suggestion only) | N/A |
| QA review | ~20-40K tokens | Per QA run |
| Research delegation | ~20-40K tokens | Per research task |

Note: These tokens are consumed on the **Codex/OpenAI side**, not the Claude
session budget. The only Claude-side cost is the skill invocation overhead.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/codex:rescue` not found | Plugin not installed | Install via Settings → Plugins |
| Codex auth error | Token expired | Run `codex auth` in terminal |
| Review returns empty | No diff to review | Ensure changes exist vs. main |
| Rescue hangs | Codex job stuck | Cancel and retry |
