---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill, Bash]
tags: [skill-body, auto-fix, natural-bug]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

TypeError: Cannot read properties of undefined (reading 'name')
    at displayName (src/user.js:2:31)
    at main (src/index.js:5:3)
The app crashes for users that have no profile yet. Please fix it. Do not commit or ship.
