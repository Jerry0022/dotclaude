# Commit Frequency & Granularity

Commits and build numbers are **independent systems**. A commit captures a code snapshot in git; a build number marks a testable state. They do not need to align 1:1.

## When to commit (new commit = completed logical unit)

| Situation | Commit? | Example |
|-----------|---------|---------|
| Data model / interface / contract complete | Yes | New TypeScript interface + service, ready to build on |
| API endpoint fully implemented (route + handler + validation) | Yes | Backend could be deployed independently |
| UI component complete (template + logic + styling) | Yes | Component is self-contained, could be used elsewhere |
| Migration / schema change | Yes | Structural change that must be revertable as a unit |
| Bug fix | Yes | Always own commit — clear `git bisect` point |
| Test suite for a feature | Yes | Standalone value, independent of feature code |
| User switches topic and current state has uncommitted work | Yes | WIP commit (`wip(scope): ...`) to secure state before context switch |
| User switches topic but last commit is clean | No | No WIP needed, just start the new topic |
| Mid-implementation (function half-written, not compiling) | No | Not a logical unit yet |

**Commit limit per branch (soft cap: 50):** At ~40 commits, proactively ask (AskUserQuestion): "Branch has N commits — ship before it drifts too far from main?" The user decides — the limit can be exceeded with explicit approval.
