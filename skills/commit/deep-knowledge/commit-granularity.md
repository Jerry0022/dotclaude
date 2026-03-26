# Commit Frequency & Granularity

Commits and build numbers are **independent systems**. A commit captures a code snapshot in git; a build number marks a testable state. They do not need to align 1:1.

## When to commit (new commit = completed logical unit)

| Situation | Commit? | Example |
|-----------|---------|---------|
| Data model / interface / contract complete | Yes | New interface + service, ready to build on |
| API endpoint fully implemented | Yes | Backend could be deployed independently |
| UI component complete (template + logic + styling) | Yes | Component is self-contained |
| Migration / schema change | Yes | Structural change, must be revertable as a unit |
| Bug fix | Yes | Always own commit — clear `git bisect` point |
| Test suite for a feature | Yes | Standalone value, independent of feature code |
| User switches topic, uncommitted work exists | Yes | WIP commit (`wip(scope): ...`) to secure state |
| User switches topic, last commit is clean | No | No WIP needed |
| Mid-implementation, not compiling | No | Not a logical unit yet |

## Commit limit per branch

**Soft cap: 50 commits.** At ~40, proactively ask: "Branch has N commits — ship before it drifts too far from main?" User decides — the limit can be exceeded with explicit approval.
