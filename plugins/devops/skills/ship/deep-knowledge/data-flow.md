# Ship — Data Flow

Each MCP tool produces structured JSON that feeds directly into the next
step or the completion card. No Bash parsing, no regex extraction —
deterministic data flow.

## Direct ship (branch → main)

```
ship_preflight → { ready, branch, base: "main", intermediate: false }
      ↓
[purpose alignment gate — Claude-side, no MCP tool; see purpose-alignment.md]
      ↓
ship_build → { success, buildId, steps }
      ↓
ship_version_bump → { vOld, vNew, filesUpdated, verified }
      ↓
ship_release → { commit, pushed, pr, merged, tag, remoteBranchDeleted? }  ← in a worktree the tool deletes the remote head itself (#442)
      ↓
[ExitWorktree — only for a worktree this session entered via EnterWorktree;
 a harness-created (Claude Desktop) worktree goes straight to keep-mode]
      ↓
ship_cleanup → { cleaned }  |  ship_cleanup({ keep: true }) → { cleaned: ["sentinel"] }
      ↓
render_completion_card → card markdown (VERBATIM)
      ↓
[memory dream — silent, only if memories touched]
```

## Intermediate ship (sub-branch → feature branch)

```
ship_preflight → { ready, branch, base: "feat/42", intermediate: true, autoDetectedBase: "feat/42" }
      ↓
[purpose alignment gate — sources: sibling sub-branch PRs merged into feat/42]
      ↓
ship_build → { success, buildId, steps }
      ↓
[SKIP version bump]
      ↓
ship_release → { commit, pushed, pr, merged: "feat/42", tag: null, remoteBranchDeleted? }  ← only the sub-branch head, never feat/42
      ↓
[ExitWorktree — EnterWorktree worktrees only; harness-created → keep-mode]
      ↓
ship_cleanup → { cleaned, intermediate: true }  ← feature branch preserved
      ↓
render_completion_card → card markdown (VERBATIM)
      ↓
[memory dream — silent, only if memories touched]
```
