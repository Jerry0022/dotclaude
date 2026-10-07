---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash]
deny_tools: ['Bash(node *)', 'Bash(*ss.plugin.update*)', 'Bash(git * pull*)', 'Bash(git * fetch*)', 'Bash(git * checkout*)', 'Bash(git * reset*)', 'Bash(cp *)', 'Bash(rm *)', Write, Edit]
tags: [skill-body, auto-update]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

devops update
