---
name: self-calibration
description: Periodic self-audit and learning loop — review feedback, internalize skills, calibrate behavior.
version: 0.1.0
schedule: "*/30 * * * *"
---

# Self-Calibration Loop

Periodic self-audit to keep Claude aligned with the user's preferences and
the plugin's rules. Runs every 30 minutes during active sessions.

## Step 1 — Self-Audit

Find all `feedback_*.md` files in the current project's memory directory.
Read each file. Check session behavior against each rule.

When auditing completion-flow rules, check whether the **full completion flow**
was executed (verify → issue status → completion card → ship recommendation),
not just whether a card was output. Directly rendering a card without going
through the flow bypasses verify and issue-update steps — that is also a violation.

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

Silently read and internalize plugin knowledge:

1. Read the project's CLAUDE.md (if exists)
2. Discover all deep-knowledge files in the plugin:
   - `deep-knowledge/*.md` (plugin-level)
   - `skills/*/deep-knowledge/*.md` (skill-level)
3. Sort alphabetically by path
4. Calculate batch: `ceil(total * 0.25)`
5. Read the current batch (rotate index each cycle, wrap around)
6. Silent self-calibration — no output needed

This ensures Claude stays familiar with all plugin rules, even those
not directly triggered in the current session.

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
- Deep-knowledge files are discovered dynamically via Glob
- Batch rotation uses explicit index math: `startIndex = (cycle * batchSize) % total`
- This task is **opt-in** — users enable it via scheduled task configuration
- Token budget: ~5K-15K per cycle (mostly reads, minimal writes)
