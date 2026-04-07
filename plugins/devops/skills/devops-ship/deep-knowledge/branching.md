# Branching Strategy

## Branch naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<issue>-<short-desc>` | `feat/42-video-filters` |
| Agent sub-branch | `feat/<issue>/<role>` | `feat/42/core` |
| Bugfix | `fix/<issue>-<short-desc>` | `fix/55-startup-crash` |
| Chore | `chore/<issue>-<short-desc>` | `chore/60-cleanup-imports` |

## Multi-branch workflow

```
main
 └── feat/42-video-filters          ← integration branch
      ├── feat/42/core               ← agent worktree
      ├── feat/42/frontend            ← agent worktree
      └── feat/42/windows             ← agent worktree
```

Merge order follows wave order (see `deep-knowledge/agent-collaboration.md`):
Core → Frontend/Windows/AI → integration branch → main.

## When to use sub-branches

| Scope | Strategy |
|---|---|
| Simple (1-2 roles, <5 files) | Single branch, no sub-branches |
| Multi-role (3+ roles) | Integration branch + sub-branches per agent |

## Branch lifecycle

| Phase | Cleanup rule |
|---|---|
| Active work | Never touch |
| Pushed (WIP) | Worktree may be removed, branch stays |
| Consolidated (sub merged into integration) | Sub-branch + worktree deleted |
| Shipped (merged to main) | Everything deleted — zero leftover |
