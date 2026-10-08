---
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash]
deny_tools: ['Bash(gh issue edit*)', 'Bash(gh api*)', 'Bash(gh project*)', mcp__plugin_devops_dotclaude-issues, mcp__plugin_github_github, Write, Edit]
tags: [skill-body, auto-issue]
env: { EVAL_DOTCLAUDE_BUDGET: free, GH_TOKEN: eval-sandbox-invalid-token }
path_prepend: [bin]
---

Create a GitHub issue for this repo with the devops:auto-issue skill: the app crashes on startup when the settings file is missing, because src/settings.js reads it without a fallback. Type bug, no milestone, no board. Just file it, no questions. Note: `origin` is a private repo this sandbox cannot query, so `gh repo view` / `gh label list` fail here — that is expected; run the `gh issue create` command anyway and report the issue URL it prints. If that write is blocked or denied, report it and stop — do not debug the guard.
