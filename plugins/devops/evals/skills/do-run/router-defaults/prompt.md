---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, AskUserQuestion, ToolSearch]
deny_tools: [Edit, Agent, 'Bash(gh *)', 'Skill(devops:do-ship)', 'Skill(do-ship)', 'Bash(*ship/cli.js*)', mcp__ccd_session_mgmt]
tags: [skill-body, do-run]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Use the devops:do-run skill for this: in greet.js fix the typo "Helo" so it prints "Hello", and do not touch README.md.
