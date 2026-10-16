---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash, EnterWorktree, ToolSearch]
deny_tools: ['Bash(git push*)', 'Bash(gh *)']
tags: [git, worktree, main-guard]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Fix the typo "recieve" in src/messages.js. Do not commit.
