# Hierarchical Merge Workflow

When multiple agents work on sub-branches of a feature branch:

```
feat/42-video-filters              ← feature branch (integration)
├── feat/42-video-filters/core     ← sub-branch (Core agent)
├── feat/42-video-filters/frontend ← sub-branch (Frontend agent)
└── feat/42-video-filters/ai       ← sub-branch (AI agent)
```

Each sub-agent ships independently via `/ship`. The pipeline
auto-detects the parent:

1. **Core finishes** → `/ship` on `feat/42-video-filters/core`
   - Preflight detects base: `feat/42-video-filters`
   - Squash-merges into feature branch, no tag/version
2. **Frontend finishes** → `/ship` on `feat/42-video-filters/frontend`
   - Same: intermediate merge into feature branch
3. **All sub-branches merged** → `/ship` on `feat/42-video-filters`
   - No parent detected → ships to `main`
   - Full ship: version bump + `alpha/vX.Y.Z` tag. Under the ring model NO
     GitHub Release is created at ship time — promotion to beta/stable and the
     published GitHub Release are owned by `/promote`.

This requires no manual `base` parameter — detection is automatic based
on branch naming convention (`<parent>/<role>`).
