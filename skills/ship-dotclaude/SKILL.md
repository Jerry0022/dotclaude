---
name: ship-dotclaude
description: >-
  Commit and push global Claude Code config changes from ~/.claude/ (which is
  the dotclaude git repo). Use when global config files have been modified and
  need to be shipped. Also triggers on: "sync my config", "push claude
  settings", "dotclaude aktualisieren", "config shippen". Supports --dry-run
  to preview changes without committing.
argument-hint: "[optional: commit message] [--dry-run]"
allowed-tools: Bash(git *), Bash(node *), Read, Glob, Grep, AskUserQuestion
---

# Ship Dotclaude

Commit and push modified global Claude Code configuration from `~/.claude/`.

## Context

The `~/.claude/` directory IS the dotclaude git repo — no sync between two locations needed.
Changes to global config files (CLAUDE.md, skills, scripts, etc.) are made directly in the repo.
This skill commits and pushes those changes.

## Arguments

- **Commit message**: If provided as `$ARGUMENTS` (without flags), use as the commit subject.
- **`--dry-run`**: Show what would be committed without making changes.

## Tracked files

Everything not in `.gitignore` — key files include:
- `CLAUDE.md`, `CLAUDE-lite.md`
- `commands/*.md`
- `skills/*/SKILL.md`
- `scripts/*.js` (but not runtime data like config.json, usage-live.json)
- `plugins/blocklist.json`
- `templates/*.json`
- `bin/`, `.github/`, `setup.ps1`, `setup.sh`
- `README.md`, `CHANGELOG.md`, `BUILDLOG.md`, `package.json`

## Steps

1. `cd ~/.claude && git status --short` — show changed files.
2. **If `--dry-run`**: Show the diff summary and exit.
3. Show the user a summary of changes. Use `AskUserQuestion` to confirm.
4. Stage changed files specifically (never `git add -A`).
5. Determine version bump type:
   - **patch**: Bug fix, tweak, minor config change
   - **minor**: New skill, new rule, new script, structural change
6. Update `package.json` version, `README.md` version badge (text line + shields.io badge URL), and add a new section to `CHANGELOG.md`.
7. Commit with conventional commit format:
   ```
   chore(config): <describe what changed>

   Co-Authored-By: <dynamic model name from system prompt> <noreply@anthropic.com>
   ```
8. Push to origin.
9. Write a new entry to `BUILDLOG.md` (see `~/.claude/CLAUDE.md §Build Log`). Generate build hash via `git write-tree | cut -c1-7`. Commit: `chore: update build log`.
10. Create a git tag (`v<version>`) and push it: `git tag v<version> && git push origin v<version>`. This triggers the release pipeline.
11. Wait for the pipeline to complete: `gh run list --workflow=release.yml --limit 1` then poll with `gh run view <run-id>`. Verify all jobs succeeded.
12. Pull main locally to confirm.
13. Run `/refresh-usage` to update the usage dashboard.

## Cross-project usage

When working in another project and global config was modified, this skill can be invoked to commit from `~/.claude/`:

```bash
cd ~/.claude && git add <files> && git commit -m "..." && git push
```

The skill handles this automatically — no manual cd needed.

## Rules

- Never `git add -A` or `git add .` — add specific files only.
- Never commit `settings.json` (contains MCP UUIDs and local paths).
- If `$ARGUMENTS` is provided (without `--dry-run`), use it as the commit message subject.
- Always bump version in package.json, README.md (text + badge), and CHANGELOG.md.
- Always create a git tag and push it — GitHub Actions handles the release.
- Use the dynamic co-author line matching the current model (see /commit skill Step 8).
