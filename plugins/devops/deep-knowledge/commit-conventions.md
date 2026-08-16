# Commit Conventions

How commits are written in projects using this plugin. Referenced by `/ship`,
the role agents, and any inline commit. Staging, branch, and worktree rules live
in [git-hygiene.md](git-hygiene.md) — not repeated here.

There is deliberately **no `/commit` skill**. Writing a conventional commit is
something the model does well unaided; a skill wrapper around it only added a
turn. These are the conventions to apply directly.

## Message format

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude <Model> <noreply@anthropic.com>
```

| Type | When |
|------|------|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `refactor` | Internal restructure, no behavior change |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Tooling, deps, CI, config |
| `style` | Formatting, whitespace |

**Scope** — the module, component, or subsystem most affected. Derive it from the
changed paths and the project's structure; there is no fixed list.

**Subject** — ≤72 chars, imperative mood, no trailing period. Say what it does,
not what changed.
- Bad: "Updated the login screen"
- Good: "add dark mode toggle to settings"

**Body** (optional, recommended for anything non-obvious) — explain the *why*,
not the *what*. Wrap at 72 chars.

**Co-author footer** — extract the model name from the current session and format
it as `Co-Authored-By: Claude {Model} <noreply@anthropic.com>`. Always detect it
dynamically; never hardcode a version.

## Frequency & granularity

Commits and build numbers are **independent systems**. A commit captures a code
snapshot in git; a build number marks a testable state. They need not align 1:1.

A new commit = one completed logical unit:

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

**Commit limit per branch — soft cap 50.** At ~40, proactively ask: "Branch has N
commits — ship before it drifts too far from main?" The user decides; the cap can
be exceeded with explicit approval.

## Rules

- Never `--no-verify` unless the user explicitly asks.
- Never `git add -A` or `git add .` — stage specific files (`git-hygiene.md`).
- A failing pre-commit hook means: fix the issue and make a **new** commit. Never
  `--amend` unless the user asked for an amend.
- Never commit files that may hold secrets (`.env`, credentials, keys).
- Merge commits are out of scope — handle them manually.
