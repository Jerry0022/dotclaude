---
name: ship-dotclaude
description: Sync changed global Claude Code config files back to the dotclaude repo, commit, push, and verify. Use when global config files have been modified and need to be shipped.
argument-hint: [optional: commit message]
allowed-tools: Bash(git *), Bash(node *), Bash(diff *), Bash(cp *), Read, Glob, Grep
---

# Ship Dotclaude

Ship modified global Claude Code configuration to the dotclaude repository.

## Context

The dotclaude repo stores the canonical versions of global Claude Code config files.
Live files in `~/.claude/` may be modified during any project session.
This skill syncs those changes back to the repo and pushes them.

The repo path is stored in `~/.claude/scripts/dotclaude-repo-path`.

## Tracked files (repo path → ~/.claude/ path)

- `CLAUDE.md`
- `commands/*.md`
- `skills/*/SKILL.md`
- `scripts/startup-summary.js`
- `scripts/precheck-cost.js`
- `scripts/scrape-usage.js`
- `scripts/check-dotclaude-sync.js`
- `plugins/blocklist.json`
- `templates/settings.template.json` ← compare with `~/.claude/settings.json` (hooks, plugins, permissions only — ignore MCP UUIDs)

## Steps

1. Read the repo path from `~/.claude/scripts/dotclaude-repo-path`.
2. For each tracked file, compare `~/.claude/<file>` with `<repo>/<file>`.
3. List all files that differ — show the user a summary.
4. Copy changed files from `~/.claude/` to the repo.
5. Check if `settings.json` changed (beyond MCP UUIDs) — if so, update `templates/settings.template.json`.
6. Run `git status` in the repo to confirm staged changes.
7. If there are new files, `git add` them specifically (never `git add -A`).
8. Determine if changes are a patch (bug fix, tweak) or minor (new skill, new rule) version bump.
9. Update `package.json` version and `README.md` version badge.
10. Commit with conventional commit format:
    ```
    chore(config): <describe what changed>

    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
    ```
11. Push to origin.
12. Verify push succeeded and remote is up to date.
13. Pull main locally to confirm.
14. Run `/refresh-usage` to update the usage dashboard with live data — shipping consumes tokens, so the dashboard should reflect the current state immediately.

## Rules
- Never `git add -A` or `git add .` — add specific files only.
- Never commit MCP server UUIDs or machine-specific paths.
- If `$ARGUMENTS` is provided, use it as the commit message subject.
- If settings.json has new MCP permissions with UUIDs, warn the user but do NOT copy those to the template.
- Always bump the version in package.json and README.md.
