# Tool Selection (Windows)

Preferred tool usage when operating on Windows environments.

## Dedicated Tools Over Bash
Always prefer Claude Code's dedicated tools over Bash equivalents:
- **Read** instead of `cat`, `head`, `tail`, or `sed` for reading files
- **Write** instead of `cat` with heredoc or `echo` redirection for creating files
- **Edit** instead of `sed` or `awk` for editing files
- **Glob** instead of `find` or `ls` for file search
- **Grep** instead of `grep` or `rg` for content search

## Bash Usage
- Reserve Bash exclusively for system commands and terminal operations that require shell execution.
- Batch Bash calls with `&&` when multiple sequential commands are needed.
- Use Unix shell syntax (forward slashes, /dev/null) even on Windows.

## Project Map as Search Index

Before running a full-repo Grep or Glob (no `path` parameter), **always** read
`.claude/project-map.md` first. The project map is a lightweight index of the
codebase structure — it tells you which directories and files exist and what they
contain.

Use it to derive the correct `path` parameter:

1. Read `.claude/project-map.md` (cheap — small file)
2. Find the relevant directory for your search term
3. Run Grep/Glob with that directory as `path`

This avoids the token guard blocking full-repo searches and produces faster,
more precise results.

**Example:** Searching for "livebrief" → project map shows
`skills/devops-livebrief/` exists → `Grep(pattern: "livebrief", path: "plugins/devops/skills/devops-livebrief")`.

**When to skip:** If the project has no `.claude/project-map.md`, fall back to
scoped searches using your best guess, or use the Explore agent for broad searches.

## Priority
Functionality > aesthetics. Get the job done with the right tool, don't optimize for pretty output.
