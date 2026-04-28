---
name: self-calibration
description: Stop-hook self-audit and learning loop — review feedback, internalize skills, calibrate behavior.
version: 1.0.0
trigger: stop-hook
cooldown: 10m
scope: per-worktree
---

# Self-Calibration Loop

Self-audit to keep Claude aligned with the user's preferences and
the plugin's rules. Triggered by the Stop hook after each response turn,
with a 10-minute worktree-specific cooldown — runs only when there was
real user interaction, never idle.

## Step 0 — Completion Flow Internalization (MANDATORY)

**This step runs FIRST, every cycle, without exception.**

The completion flow is the single most critical behavioral rule in this plugin.
It is **not a recommendation — it is a MUST**. Every self-calibration cycle
begins by re-reading and internalizing these rules before anything else.

Read and internalize `{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` § Completion Flow.
(Where `{PLUGIN_ROOT}` is the plugin root path provided by the hook at registration time.)
Then verify the following rules are active in your behavioral model:

### Rules (non-negotiable)

The completion flow is a **generic response-complete pattern**. It fires whenever
a task is fully completed and Claude is about to wait for the next user input.

**No exceptions based on:**
- Tool used (Edit, Write, Bash, Read, Grep, research tools, browser tools, etc.)
- File location (inside repo, outside repo, config files like `~/.claude/`, system files)
- Type of work (code change, config change, research, explanation, app start, analysis)

**"Discretionary skip" is always a violation.** Examples of invalid skips:
- "This was just a config file outside the repo" → invalid
- "This was only research, no code changed" → invalid
- "The edit was too small to warrant a card" → invalid

**Only valid reason to skip:** the turn was clearly mid-task (Claude is still gathering
context or executing a multi-step plan mid-flight). Once the task is done and Claude
is waiting for the next user prompt → completion card is mandatory.

**Full flow check:** verify that the complete flow ran:
verify → issue status → completion card → ship recommendation (if 5+ edits).
Directly rendering a card without going through the flow bypasses verify and
issue-update steps — that is also a violation.

If a violation is found → correct immediately and briefly report.

### Why this is Step 0

The Stop hook triggers calibration after each response turn (with 10-min
cooldown). Step 0 ensures the completion flow is re-internalized every cycle —
reinforcing it after real user interaction. Skipping or deprioritizing this
step is itself a violation.

## Step 1 — Self-Audit

Find all `feedback_*.md` files in the current project's memory directory.
Read each file. Check session behavior against each rule.

If a violation is found → correct immediately and briefly report.

## Step 2 — Learn

Scan the session history for new feedback patterns:
- User corrections ("no, not that", "don't do X")
- Confirmed approaches ("yes exactly", "perfect")
- Repeated patterns

If a new pattern is found → save as `feedback_*.md` memory with:
- Frontmatter (name, description, type: feedback)
- Rule statement
- **Why:** reason
- **How to apply:** when/where this kicks in

Update the MEMORY.md index.

## Step 3 — Proactive Check

Check if upcoming actions could violate feedback rules:
- Is a completion card due? → Ensure correct template
- Is a ship flow pending? → Verify pre-flight readiness
- Is a browser task queued? → Ensure silent execution

If found → take preparatory action.

## Step 4 — Skill Internalization

Silently read and internalize plugin knowledge.

**Discovery, batch math, and cycle persistence run in the Stop hook itself**
(`hooks/stop/stop.flow.selfcalibration.js`). The hook emits the current batch's
file paths directly in its prompt — just read them silently.

What the hook handles deterministically:
- Discovers `{PLUGIN_ROOT}/deep-knowledge/*.md` and
  `{PLUGIN_ROOT}/skills/*/deep-knowledge/*.md`, sorted alphabetically
- Computes `batchSize = ceil(total * 0.25)` and
  `startIndex = (cycle * batchSize) % total` (wraps around)
- Reads + advances + persists the cycle index in
  `$TMPDIR/dotclaude-devops-calibration-cycle.json`

What you do:
1. Read the project's CLAUDE.md (if exists)
2. Read each file the hook listed under "Step 4 batch" — silently, no output

This keeps Claude familiar with plugin rules that aren't directly
triggered in the current session. Coverage is **best-effort eventual**,
not guaranteed: persistence uses atomic write-temp-then-rename but no
inter-process lock, so two Stop events that interleave their cycle
read+write can lose one increment (worst case: one batch repeats — no
crash, no data loss). Over many cycles, every file still gets read in
rotation.

## Step 5 — Baseline Review

If Steps 1-3 had no findings (no violations, no new patterns, no prep needed):
- Read CLAUDE.md (global + project) as silent recalibration
- No output needed

## Configuration

Users can extend this task via:
```
~/.claude/scheduled-tasks/self-calibration/reference.md
```

Example extensions:
- Additional memory directories to scan
- Custom feedback pattern definitions
- Extra deep-knowledge paths to internalize

## Rules

- All paths use `~` or relative references — never hardcoded
- Deep-knowledge discovery + batch rotation are owned by the Stop hook
  (`hooks/stop/stop.flow.selfcalibration.js`), not Claude
- Batch math: `batchSize = ceil(total * 0.25)`,
  `startIndex = (cycle * batchSize) % total`
- Cycle index persisted to `$TMPDIR/dotclaude-devops-calibration-cycle.json`
  via atomic write-temp+rename. No inter-process lock — concurrent Stop
  events from different worktrees may lose one increment (acceptable
  best-effort behavior; one repeated batch, no crash)
- Cooldown marker uses the same atomic-write pattern. If `$TMPDIR` is
  unwritable, the cooldown silently degrades to "fire every turn"
- This task fires automatically on the Stop event with a 10-minute
  worktree-specific cooldown
- Token budget: ~5K-15K per cycle (mostly reads, minimal writes)
