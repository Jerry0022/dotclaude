---
name: debug
description: Read session logs, runtime errors, and crash output to diagnose and fix the current issue — root-cause analysis first. Use when something is broken or behaving unexpectedly.
argument-hint: [optional: describe the symptom]
allowed-tools: Read, Grep, Glob, Bash(cat *), Bash(tail *), Bash(git log *), Bash(git diff *)
---

# Debug

Diagnose and fix the issue: `$ARGUMENTS`

## Steps

1. **Gather context** — what is broken? If no argument, ask one focused question.
2. **Read logs** — check all available log files:
   - `logs/` or `*.log` in the project root
   - Electron main process logs
   - Angular build errors
   - Any recent `npm run *` output
3. **Read recent changes** — `git log --oneline -10` + `git diff HEAD~1` to identify what changed recently.
4. **Locate the failure point** — search for error strings via `Grep`.
5. **Diagnose root cause** — do not treat symptoms. Find the actual broken invariant.
6. **Propose fix** — explain root cause first, then the fix. If multiple options exist, rank them.
7. **Implement fix** if the user confirms (or if the root cause is unambiguous and low-risk).
8. **Verify** — confirm the fix addresses the root cause, not just the symptom.

## Rules
- Root-cause first — never propose a symptom-only workaround unless explicitly asked.
- No fallbacks by default — propose them as alternatives if relevant.
- If logs point to a cross-module boundary, respect module ownership (see AGENTS.md).
- Report the exact file:line where the failure originates.
