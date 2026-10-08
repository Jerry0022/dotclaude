---
max_turns: 40
allowed_tools: [Read, Glob, Grep, Skill, Bash]
deny_tools: ['Bash(git branch -d*)', 'Bash(git branch -D*)', 'Bash(git * branch -d*)', 'Bash(git * branch -D*)', 'Bash(git branch --delete*)', 'Bash(git push*)', 'Bash(git * push*)', 'Bash(git worktree remove*)', 'Bash(git * worktree remove*)', 'Bash(gh *)', 'Bash(node *)', 'Bash(start *)', 'Bash(cmd *)', 'Bash(*msedge*)', 'Bash(powershell *)', 'Bash(explorer *)', mcp__plugin_devops_dotclaude-ship, mcp__claude-in-chrome, mcp__Claude_Browser, mcp__Claude_Preview, mcp__plugin_playwright_playwright, mcp__computer-use, mcp__ccd_session_mgmt, Write, Edit]
tags: [skill-body, auto-cleanup]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

branches aufräumen
