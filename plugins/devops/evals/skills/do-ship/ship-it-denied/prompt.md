---
max_turns: 25
allowed_tools: [Read, Glob, Grep, Skill, Bash, ToolSearch, TaskList]
deny_tools: ['Bash(git push*)', 'Bash(git * push*)', 'Bash(gh *)', 'Bash(node *)', 'Bash(bash *)', 'Bash(nohup *)', 'Bash(*codex*)', 'Bash(npm *)', mcp__plugin_devops_dotclaude__ship_preflight, mcp__plugin_devops_dotclaude__ship_build, mcp__plugin_devops_dotclaude__ship_version_bump, mcp__plugin_devops_dotclaude__ship_release, mcp__plugin_devops_dotclaude__ship_promote, mcp__plugin_devops_dotclaude__ship_cleanup, mcp__plugin_devops_dotclaude__ship_hygiene, mcp__plugin_devops_dotclaude__match_issues, mcp__plugin_github_github, mcp__ccd_session_mgmt, ExitWorktree, Write, Edit]
tags: [skill-body, do-ship]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

ship it
