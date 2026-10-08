---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash]
deny_tools: ['Bash(*batch-watchdog*)', mcp__ccd_session_mgmt, Write, Edit]
tags: [skill-body, do-batch]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Switch on the devops:do-batch collect mode, and park this as the first note: add a dark mode toggle to the settings page, and remember the user's choice across reloads
