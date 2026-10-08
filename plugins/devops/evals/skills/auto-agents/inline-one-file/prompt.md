---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit]
deny_tools: ['Bash(git push*)', 'Bash(gh *)']
tags: [skill-body, auto-agents]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Invoke the Skill tool with skill `devops:auto-agents` and args `--from=do-run --mode=background fix the typo "recieve" in src/messages.js`, then follow it. Do not commit.
