# Ship — Data Flow

Each MCP tool produces structured JSON that feeds directly into the next
step or the completion card. No Bash parsing, no regex extraction —
deterministic data flow.

## Direct ship (branch → main)

```
ship_preflight → { ready, branch, base: "main", intermediate: false }
      ↓
ship_build → { success, buildId, steps }
      ↓
ship_version_bump → { vOld, vNew, filesUpdated, verified }
      ↓
ship_release → { commit, pushed, pr, merged, tag }
      ↓
[ExitWorktree if needed]
      ↓
ship_cleanup → { cleaned }
      ↓
render_completion_card → card markdown (VERBATIM)
      ↓
[memory dream — silent, only if memories touched]
```

## Intermediate ship (sub-branch → feature branch)

```
ship_preflight → { ready, branch, base: "feat/42", intermediate: true, autoDetectedBase: "feat/42" }
      ↓
ship_build → { success, buildId, steps }
      ↓
[SKIP version bump]
      ↓
ship_release → { commit, pushed, pr, merged: "feat/42", tag: null }
      ↓
[ExitWorktree if needed]
      ↓
ship_cleanup → { cleaned, intermediate: true }  ← feature branch preserved
      ↓
render_completion_card → card markdown (VERBATIM)
      ↓
[memory dream — silent, only if memories touched]
```
