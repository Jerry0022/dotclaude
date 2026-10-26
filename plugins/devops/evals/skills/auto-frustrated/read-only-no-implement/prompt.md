---
max_turns: 25
allowed_tools: [Read, Glob, Grep, Skill, Bash, Agent]
deny_tools: [Write, Edit, 'Bash(git commit*)', 'Bash(git push*)']
tags: [skill-body, auto-frustrated]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Use the devops:auto-frustrated skill with --lite on src/price.js: three attempts to fix the rounding there missed the goal. Analysis only.
