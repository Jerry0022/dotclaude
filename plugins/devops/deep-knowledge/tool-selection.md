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

## cmd.exe Caret Trap (Node `execSync`/`exec`)

Node's `execSync("git …")` runs through **cmd.exe** on Windows, where `^` is the
escape character — it is silently eaten before git sees the argument. Git
revision syntax breaks invisibly: `HEAD^{tree}` becomes `HEAD{tree}` (fatal),
`HEAD^` becomes `HEAD`, `<a>^..<b>` corrupts ranges. Because wrappers like
`git()` swallow errors into `null`, this surfaces as a *permanent* silent
failure, not a crash (real case: `treeOf()` returned null on every Windows call,
so `ship_release`'s post-merge tree guard fired a false `postMergeWarning` on
every ship — fixed in v0.107.1).

Rules for any JS that shells out to git:
- Prefer caret-free spellings: `git show -s --format=%T <ref>` instead of
  `rev-parse <ref>^{tree}`; `<ref>~1` instead of `<ref>^`.
- If caret syntax is unavoidable, use `execFileSync("git", [args…])` (no shell,
  no escaping) — never a shell string.
- The Bash *tool* is unaffected (Git Bash / POSIX sh); this trap is specific to
  Node child_process with a shell string on Windows.

## Project Map as Search Index

Before running a full-repo Grep or Glob (no `path` parameter), **always** read
`.claude/project-map.md` first. The project map is a lightweight index of the
codebase structure — it tells you which directories and files exist and what they
contain.

> **Note:** The `pre.tokens.guard` hook also injects the project map automatically
> on the *first* broad Grep/Glob of a session (no `path`), so you usually receive
> the structure without an explicit read. Use it to scope every following search.

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
