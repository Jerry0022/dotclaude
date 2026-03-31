# Codex Integration

Cross-cutting reference for all points where `codex-plugin-cc` skills are
integrated into dotclaude-dev-ops workflows. All integrations are **optional** —
they activate only when codex-plugin-cc is installed.

## Detection

Before calling any `/codex:*` skill, check availability. The simplest method:
attempt to invoke the skill and handle graceful failure. Do NOT block workflows
if Codex is unavailable.

**Pattern used across all integration points:**

```
If codex-plugin-cc is installed → offer/run the Codex step
If not installed → skip silently, proceed with normal workflow
```

## Integration Points

### 1. /ship — Pre-PR Code Review (Step 2, Quality Gates)

**When:** After build + lint + tests pass, before commit/push/PR.
**Skill:** `/codex:review` (standard) or `/codex:adversarial-review` (major bumps).
**Behavior:**
- patch/minor bump → `/codex:review` on the diff (read-only)
- major bump → `/codex:adversarial-review` (challenges design trade-offs)
- Present Codex findings to user before proceeding to PR
- User decides: address findings, ignore, or abort

**Value:** Only point in the pipeline where a second AI reviews the code
systematically. Tests verify behavior; Codex reviews design and logic.

### 2. /flow — Rescue on Unclear Root Cause (Step 6, Decision)

**When:** Root cause analysis yields no clear result after investigation.
**Skill:** `/codex:rescue`
**Behavior:**
- After Step 5 (Root cause analysis), if root cause is unclear
- Offer `/codex:rescue` as an option alongside the existing hypothesis approach
- Codex investigates independently with fresh context
- Results feed back into the decision matrix

**Value:** Fresh perspective when Claude is stuck in a debugging loop.

### 3. post.flow.debug Hook — Rescue Suggestion

**When:** 2+ consecutive Bash failures detected.
**Skill:** `/codex:rescue` (mentioned as alternative)
**Behavior:**
- Existing behavior: recommend `/flow`
- Added: mention `/codex:rescue` as alternative for delegation
- No automatic invocation — suggestion only

**Value:** Low-cost addition, gives user a choice between self-debug and delegation.

### 4. QA Agent — Adversarial Review

**When:** QA agent runs verification on changes.
**Skill:** `/codex:adversarial-review`
**Behavior:**
- Added as optional step in QA responsibilities
- QA agent can suggest running adversarial review for complex changes
- Findings included in QA_RESULT output

**Value:** Harder review that challenges assumptions, not just verifies correctness.

### 5. Research Agent — Parallel Delegation

**When:** Research topic has multiple independent angles.
**Skill:** `/codex:rescue`
**Behavior:**
- Research agent can delegate sub-questions to Codex for parallel investigation
- Results merged into the final research report
- Codex findings clearly attributed

**Value:** Parallel research capacity — two AIs investigating simultaneously.

## Token Cost

| Integration Point | Estimated Cost | Frequency |
|---|---|---|
| /ship review | ~20-40K tokens | Per ship (~2-5/week) |
| /ship adversarial | ~30-60K tokens | Major bumps only |
| /flow rescue | ~30-50K tokens | When stuck (~1-3/week) |
| post.flow.debug | 0 (suggestion only) | N/A |
| QA adversarial | ~20-40K tokens | Per QA run |
| Research delegation | ~20-40K tokens | Per research task |

Note: These tokens are consumed on the **Codex/OpenAI side**, not the Claude
session budget. The only Claude-side cost is the skill invocation overhead.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/codex:review` not found | Plugin not installed | Install via Settings → Plugins |
| Codex auth error | Token expired | Run `codex auth` in terminal |
| Review returns empty | No diff to review | Ensure changes exist vs. main |
| Rescue hangs | Codex job stuck | `/codex:cancel` then retry |
