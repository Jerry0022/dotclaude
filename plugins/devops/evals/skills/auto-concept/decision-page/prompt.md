---
max_turns: 60
allowed_tools: [Read, Write, Edit, Glob, Grep, Skill, Bash]
deny_tools: ['Bash(python *)', 'Bash(python3 *)', 'Bash(py *)', 'Bash(nohup *)', 'Bash(setsid *)', 'Bash(*concept-server*)', 'Bash(*concept-port-registry*)', 'Bash(*concept-watch*)', 'Bash(*concept-tick*)', 'Bash(curl *)', 'Bash(start *)', 'Bash(cmd *)', 'Bash(powershell *)', 'Bash(pwsh *)', 'Bash(explorer *)', 'Bash(*msedge*)', 'Bash(kill *)', 'Bash(taskkill *)', 'Bash(git push*)', 'Bash(git * push*)', 'Bash(gh *)', CronCreate, CronDelete, mcp__claude-in-chrome, mcp__Claude_Browser, mcp__Claude_Preview, mcp__plugin_playwright_playwright, mcp__computer-use, mcp__ccd_session_mgmt]
tags: [skill-body, auto-concept]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Make a decision concept page with the devops:auto-concept skill: how should notes-cli persist its notes — a JSON file, SQLite, or plain Markdown files? Decision mode, three alternatives, no mockups.
