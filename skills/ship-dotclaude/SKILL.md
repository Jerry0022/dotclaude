---
name: ship-dotclaude
description: >-
  Sync changed global Claude Code config files back to the dotclaude repo,
  commit, push, and verify. Use when global config files have been modified
  and need to be shipped. Also triggers on: "sync my config", "push claude
  settings", "dotclaude aktualisieren", "config shippen". Supports --dry-run
  to preview changes without committing.
argument-hint: "[optional: commit message] [--dry-run]"
allowed-tools: Bash(git *), Bash(node *), Bash(diff *), Bash(cp *), Read, Glob, Grep, AskUserQuestion
---

# Ship Dotclaude

Ship modified global Claude Code configuration to the dotclaude repository.

## Context

The dotclaude repo stores the canonical versions of global Claude Code config files.
Live files in `~/.claude/` may be modified during any project session.
This skill syncs those changes back to the repo and pushes them.

The repo path is stored in `~/.claude/scripts/dotclaude-repo-path`.

## Arguments

- **Commit message**: If provided as `$ARGUMENTS` (without flags), use as the commit subject.
- **`--dry-run`**: Show what would be synced without committing or pushing. Useful for previewing changes before shipping.

## Tracked files (repo path → ~/.claude/ path)

- `CLAUDE.md`
- `commands/*.md`
- `skills/*/SKILL.md`
- `scripts/startup-summary.js`
- `scripts/precheck-cost.js`
- `scripts/scrape-usage.js`
- `scripts/check-dotclaude-sync.js`
- `scripts/sweep-branches.js`
- `scripts/render-diagram.js`
- `plugins/blocklist.json`
- `templates/settings.template.json` ← compare with `~/.claude/settings.json` (hooks, plugins, permissions only — ignore MCP UUIDs)

## Steps

1. Read the repo path from `~/.claude/scripts/dotclaude-repo-path`.
2. For each tracked file, compare `~/.claude/<file>` with `<repo>/<file>`.
3. List all files that differ — show the user a summary.
4. **If `--dry-run`**: Stop here. Show the diff summary and exit without making changes.
5. Copy changed files from `~/.claude/` to the repo.
6. **Settings.json handling** — compare `~/.claude/settings.json` with `<repo>/templates/settings.template.json`:
   - Strip all MCP server UUIDs and machine-specific paths before comparing.
   - If structural changes remain (new hooks, permissions, plugins) → update the template.
   - If only UUIDs/paths changed → skip (no meaningful change).
   - Never copy raw UUIDs into the template.
7. Run `git status` in the repo to confirm staged changes.
8. If there are new files, `git add` them specifically (never `git add -A`).
9. Determine version bump type:
   - **patch**: Bug fix, tweak, minor config change
   - **minor**: New skill, new rule, new script, structural change
10. Update `package.json` version, `README.md` version badge (both the text line and the shields.io badge URL), and add a new section to `CHANGELOG.md` with the new version, today's date, and a summary of what changed.
11. Commit with conventional commit format:
    ```
    chore(config): <describe what changed>

    Co-Authored-By: <dynamic model name from system prompt> <noreply@anthropic.com>
    ```
12. Push to origin.
13. Create a git tag (`v<version>`) on the commit and push it: `git tag v<version> && git push origin v<version>`. This triggers the `release.yml` GitHub Actions workflow which builds the `.exe`, creates the GitHub Release with the `.exe` asset, and publishes the npm package to GitHub Packages.
14. Wait for the pipeline to complete: `gh run list --workflow=release.yml --limit 1` then `gh run watch <run-id>` or poll with `gh run view <run-id>`. Verify all 3 jobs succeeded (build-exe, release, publish-npm).
15. Pull main locally to confirm.
16. Run `/refresh-usage` to update the usage dashboard with live data — shipping consumes tokens, so the dashboard should reflect the current state immediately.

## Conflict resolution

If both `~/.claude/<file>` and `<repo>/<file>` have changed since the last sync (detected via `.dotclaude-sync-state.json`):

1. Show the user both versions side by side (key differences only).
2. Use `AskUserQuestion` with options:
   - **Use local** — overwrite repo with the local version
   - **Use repo** — keep repo version, discard local changes
   - **Merge** — apply local changes on top of repo version (manual review)
3. Never silently overwrite in either direction when both sides changed.

## Rules

- Never `git add -A` or `git add .` — add specific files only.
- Never commit MCP server UUIDs or machine-specific paths.
- If `$ARGUMENTS` is provided (without `--dry-run`), use it as the commit message subject.
- Always bump the version in package.json, README.md (text + badge), and CHANGELOG.md.
- Always create a git tag and push it — the GitHub Actions pipeline handles Release creation, .exe build, and npm publish. Never create releases manually via `gh release create`.
- Use the dynamic co-author line matching the current model (see /commit skill Step 8).
