---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash]
deny_tools: [mcp__claude-in-chrome, mcp__Claude_Browser, mcp__Claude_Preview, mcp__computer-use, mcp__plugin_playwright_playwright, 'Bash(start *)', 'Bash(explorer *)', 'Bash(*msedge*)', 'Bash(cmd *)', 'Bash(powershell *)', Write, Edit]
tags: [skill-body, auto-guide]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Guide me through creating a fine-grained GitHub personal access token on github.com with the devops:auto-guide skill — this project needs it as GITHUB_TOKEN in .env.
