# Ship — MCP Call Examples

Reference payloads for `ship_release`. Always pass `cwd` — the ship MCP
server runs in the plugin directory, not the target repo.

## Final ship to main

```
ship_release({
  base: "main",
  title: "feat(ship): add MCP server for ship pipeline",
  body: "## Summary\n...\n\nCloses #N",
  commitMessage: "chore(release): v0.18.0",
  tag: "v0.18.0",
  releaseNotes: "...",
  prerelease: false,
  mergeStrategy: "squash",
  cwd: "<cwd>"
})
```

## Intermediate ship (sub-branch → feature branch)

```
ship_release({
  base: "feat/42-video-filters",
  title: "feat(core): add video filter data models",
  body: "## Summary\n...",
  commitMessage: null,
  tag: null,
  releaseNotes: null,
  mergeStrategy: "squash",
  cwd: "<cwd>"
})
```

For intermediate merges: no tag, no release notes, no version commit. The
tool automatically skips tag/release creation when `base` is not `main`.

## With file overlap (merge commit preserves ancestry)

```
ship_release({
  ...
  mergeStrategy: "merge",
  cwd: "<cwd>"
})
```
