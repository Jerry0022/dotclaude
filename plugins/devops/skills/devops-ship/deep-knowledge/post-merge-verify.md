# Post-Merge Deploy Verification

Optional per-project extension. Opt-in by adding a `verify:` block to your
project's `{project}/.claude/skills/ship/reference.md`.

The post-merge watcher (`scripts/post-merge-watcher.js`) reads this block
**after** GitHub Actions on the merge commit have gone green, and probes the
configured target. Result lands in
`<repo>/.claude/.ship-watcher/<merge-sha>.json` and is surfaced by the
`ss.ship.verify` SessionStart hook in the next session.

## Format

The watcher accepts the `verify:` block either inline in the file body or
inside a fenced ` ```yaml ` block (preferred — keeps it visible as code in
GitHub previews).

```yaml
verify:
  mode: http                 # http (default) | command
  url: https://example.com   # required for mode: http
  expected_status: 200       # optional; default = no status check
  selector: 'data-version="([^"]+)"'   # optional regex on response body (first capture group used)
  expected: "$VERSION"       # optional; $VERSION expands to the just-shipped tag (vX.Y.Z)
  poll_interval_seconds: 15  # default 15
  timeout_seconds: 600       # default 600 (10 min)

# For command mode:
# verify:
#   mode: command
#   command: "./scripts/check-deploy.sh"
#   poll_interval_seconds: 30
#   timeout_seconds: 900
```

### Field reference

| Field | Mode | Purpose |
|---|---|---|
| `mode` | both | `http` (default) probes a URL; `command` runs a shell command |
| `url` | http | Production URL to probe |
| `expected_status` | http | Required HTTP status code (omit to skip status check) |
| `selector` | http | Regex applied to response body; first capture group is checked against `expected` |
| `expected` | http | String the captured group must contain. `$VERSION` placeholder expands to the just-shipped tag |
| `command` | command | Shell command. Exit 0 = success, anything else = retry |
| `poll_interval_seconds` | both | Pause between retries |
| `timeout_seconds` | both | Hard deadline. `failed` once exceeded |

## Failure handling

- **CI fails** → watcher writes `overall: "failed"`, fires PowerShell toast,
  does NOT run the verify block.
- **CI passes, verify fails** → `overall: "failed"`, toast, state file
  carries `verify.lastError` for triage.
- **CI passes, verify passes** → `overall: "success"`, silent. Surfaced
  silently at next SessionStart (still ack'd to clear the queue).
- **CI does not exist** → `ci: { status: "no-run" }`, verify still runs if
  configured. Pure-frontend repos without CI but with a deploy hook can use
  this pattern.
- **Watcher process killed before completion** → state file stays in
  `status: "watching"`. The SessionStart hook auto-acknowledges entries
  older than 24h.

## Example: SPA on Vercel

```yaml
verify:
  mode: http
  url: https://my-app.example.com/api/health
  expected_status: 200
  poll_interval_seconds: 20
  timeout_seconds: 900
```

## Example: NPM package on registry

```yaml
verify:
  mode: command
  command: "npm view my-package version | grep -q $VERSION"
  poll_interval_seconds: 30
  timeout_seconds: 1200
```

Note: `$VERSION` is also expanded in `command` mode.

## Example: Static site with version meta tag

```yaml
verify:
  mode: http
  url: https://docs.example.com
  expected_status: 200
  selector: '<meta name="version" content="([^"]+)"'
  expected: "$VERSION"
  timeout_seconds: 600
```

## Disabling

Remove the `verify:` block (or rename to `_verify:`) — the watcher then
only tracks CI status, not the deploy.

To skip the watcher entirely, pass `--no-watch` in the ship trigger or
remove the spawn step from a project-specific ship `SKILL.md` extension.
