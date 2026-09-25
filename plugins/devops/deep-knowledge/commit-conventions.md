# Commit Conventions

How commits are written in projects using this plugin. Referenced by `/do-ship`,
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
| A spawned agent reaches a green sub-step on its own branch | Yes | Checkpoint `wip(scope): ...` — § Checkpoint commits |

## Checkpoint commits (agents)

Every agent that writes code — `core`, `frontend`, `ai`, `windows`,
`designer`, `feature` — works in checkpoints on its own branch:

- **Where — never above the session's branch:**
  - **No git repo** (e.g. files on a network share): no branches, no
    commits — the agent edits the files and reports `branch: none`.
  - **The session works on a feature / worktree branch** (the normal case):
    checkpoints go on the agent's own sub-branch (`<parent>/<role>`) or on
    that feature branch — **never on `main`, `master` or the remote's
    default branch, local or remote.** From there, `main` is reached only
    through `/do-ship`.
  - **The session itself works on `main`** (by necessity, no feature
    branch): `main` is the session's branch, so checkpoints and merges land
    there — or on the agent's sub-branch off it.

- **Commit `wip(<scope>): <what is done so far>` after every green
  sub-step** (it builds, the tests of the touched module pass) and at the
  latest every ~10 tool calls that changed files. The final commit of the
  task is an ordinary conventional commit.
- **Why:** an agent cut off mid-task — a usage limit, a crash, a session
  closed — never reaches "commit before returning". Whatever it did not
  commit exists only in its worktree and in its context, and both are the
  first things lost. A checkpoint turns a stop into "continue from the last
  commit" instead of "start over".
- **Cheap on main:** `/do-ship` squash-merges by default, so checkpoints
  never reach `main` as separate commits.
- Same rules as any commit: stage the task's files by name, hooks stay on (a
  pre-commit hook that refuses a checkpoint means: keep working, commit at
  the next green step — never `--no-verify`).
- Analysis-only agents (`po`, `research`, `redteam`, `qa`, `gamer`,
  `rethinker`) change no files and do not commit. The main session's own
  inline work follows the table above, not this section.

Continuing a cut-off agent: `agent-orchestration.md` § Recovering a cut-off
agent.

**Commit limit per branch — soft cap 50.** At ~40, proactively ask: "Branch has N
commits — ship before it drifts too far from main?" The user decides; the cap can
be exceeded with explicit approval.

## Rules

- Never `--no-verify` unless the user explicitly asks.
- Never `git add -A` or `git add .` — stage specific files (`git-hygiene.md`).
  The one exception is the salvage of a cut-off agent's worktree
  (`scripts/burn-plan.js resume-check --apply`): nobody knows which files the
  agent meant, so everything not ignored is staged — minus secret-shaped
  files (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`,
  `id_ed25519*`, `credentials.json`, `*.credentials`, `secrets.*`), which stay
  uncommitted in the worktree.
- A failing pre-commit hook means: fix the issue and make a **new** commit. Never
  `--amend` unless the user asked for an amend.
- Never commit files that may hold secrets (`.env`, credentials, keys).
- Merge commits are out of scope — handle them manually.
