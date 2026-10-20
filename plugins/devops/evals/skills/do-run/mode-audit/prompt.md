---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, AskUserQuestion, ToolSearch]
deny_tools: [Edit, Agent, 'Bash(gh *)', 'Bash(git commit*)', 'Bash(git push*)', 'Bash(git * push*)', 'Skill(devops:do-ship)', 'Skill(do-ship)', 'Skill(devops:auto-concept)', 'Skill(auto-concept)', 'Bash(*ship/cli.js*)', 'Bash(python *)', 'Bash(python3 *)', 'Bash(py *)', 'Bash(nohup *)', 'Bash(setsid *)', 'Bash(*concept-server*)', 'Bash(*concept-port-registry*)', 'Bash(*concept-watch*)', 'Bash(*concept-tick*)', 'Bash(curl *)', 'Bash(start *)', 'Bash(cmd *)', 'Bash(powershell *)', 'Bash(pwsh *)', 'Bash(explorer *)', 'Bash(*msedge*)', 'Bash(kill *)', 'Bash(taskkill *)', CronCreate, CronDelete, mcp__claude-in-chrome, mcp__Claude_Browser, mcp__Claude_Preview, mcp__plugin_playwright_playwright, mcp__computer-use, mcp__ccd_session_mgmt]
tags: [skill-body, do-run, audit]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Use the devops:do-run skill in audit mode: audit this project (scope: all, result as a concept page, change nothing). Analyze only.
