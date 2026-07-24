# Post-Merge Deploy Verification

Optional per-project extension. Opt-in by adding a `verify:` block to your
project's `{project}/.claude/skills/ship/reference.md`.

There are **two complementary verifiers**, both driven from the same
`reference.md`:

| Verifier | Source key | When | Fidelity |
|---|---|---|---|
| **Headless watcher** (`scripts/post-merge-watcher.js`, ship Step 4b) | flat `verify:` block | post-session, after CI goes green | raw HTTP response / shell command |
| **Live browser check** (ship Step 4c) | `surfaces:` list (or `verify:` url) | in the ship flow, before the completion card | **rendered DOM** via Claude-in-Chrome (Edge) |

Use the headless watcher for unattended/AFK coverage (CI can take 30 min); use
the browser check for the high-fidelity "is the version users see actually the
new one" assertion before declaring done. A client-rendered SPA version, a
`prerelease`-flagged release that leaves the prior version as `/releases/latest`,
or a download page gated behind a DB row are all invisible to a raw HTTP probe
but caught by the browser check. See `SKILL.md → Step 4c`.

The post-merge watcher reads the flat `verify:` block **after** GitHub Actions on
the merge commit have gone green, and probes the configured target. Result lands
in `<repo>/.claude/.ship-watcher/<merge-sha>.json` and is surfaced by the
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

## Declarative surfaces (live browser verification)

For the **live browser check** (ship Step 4c), declare one or more user-facing
surfaces as a top-level `surfaces:` list (sibling to `verify:`). Each surface is
opened in Edge via Claude-in-Chrome and its **rendered** version marker is
asserted against the just-shipped version.

```yaml
surfaces:
  - name: "Web app"
    url: https://app.example.com
    selector: '[data-app-version]'        # CSS selector; its textContent / matching attribute is read via Eval JS
    expected: "$VERSION"                   # $VERSION = just-shipped vX.Y.Z (tag) or vNew
  - name: "Download page"
    url: https://example.com/download
    selector: '.latest-version'
    expected: "$VERSION"
  - name: "Edge function health"
    url: https://app.example.com/api/version
    selector: 'body'                       # JSON/text endpoint — match the version anywhere in the body
    expected: "$VERSION"
```

| Field | Purpose |
|---|---|
| `name` | Human label shown in the completion card if the surface lags |
| `url` | Page the browser opens (the real user-facing surface) |
| `selector` | CSS selector whose rendered text/attribute holds the version. Read with **Eval JS**, never "read page" |
| `expected` | String the rendered value must contain. `$VERSION` expands to the shipped tag / `vNew` |

Notes:
- A single surface can be declared in the flat `verify:` block instead — Step 4c
  falls back to `verify:`'s `url`/`selector`/`expected` when no `surfaces:` list
  exists, so simple projects need only one block.
- The `surfaces:` list drives the **interactive** browser check only. The
  headless watcher (Step 4b) still probes the single flat `verify:` target;
  multi-surface **headless** probing is not yet wired — list every surface under
  `surfaces:` so the supervised Step 4c covers them, and put the most critical
  one in `verify:` for unattended coverage.

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

### Security note for `command:` mode

The `command:` string is passed to `spawnSync(cmd, { shell: true })` from the
watcher process — so anything in this field runs with your user's permissions,
in the watcher's working directory, with no sandboxing. **Only enable
`command:` mode for repositories you trust to author this field.** A malicious
PR that adds a `command:` line could exfiltrate or destroy data the next time
a ship completes.

If you operate a multi-contributor repo where untrusted PRs can modify
`reference.md`, prefer `mode: http` exclusively, or move the verify block
into a file outside the repo (point `--verify-config` at e.g.
`~/.claude/verify/<repo>.md`).

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
