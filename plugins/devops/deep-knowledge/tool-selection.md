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

## Priority
Functionality > aesthetics. Get the job done with the right tool, don't optimize for pretty output.
