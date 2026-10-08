---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit]
deny_tools: ['Bash(git push*)', 'Bash(gh *)', 'Bash(npm *)', 'Bash(npx *)']
tags: [skill-body, auto-harden]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Run the devops:auto-harden skill with the arguments `--invoked-by=ship --base=main src/math.js test/math.test.js` (the diff-scoped check do-ship uses) and show me the JSON it returns.
