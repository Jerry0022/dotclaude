---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash]
tags: [skill-body, auto-polish]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Run the devops:auto-polish skill with the arguments `--invoked-by=ship src/Toolbar.jsx` (the rules-only check do-ship uses) and show me the findings it returns.
