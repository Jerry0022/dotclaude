# Skill Extension Guide — For Plugin Integrators

How to customize devops skills and agents for your project.

## The 3-Layer Extension Model

Every skill and agent supports three layers of customization:

```
Layer 1: Plugin defaults        ← devops (immutable)
Layer 2: User global overrides  ← ~/.claude/skills/{name}/
Layer 3: Project overrides      ← {project}/.claude/skills/{name}/
```

**Priority:** Project > Global > Plugin. The most specific layer wins on conflict.

## What you can create

In each layer, you can create two files:

| File | Purpose | Example |
|---|---|---|
| `SKILL.md` | Override or add steps to the skill | Add a deploy step to /devops-ship |
| `reference.md` | Add context the skill reads before executing | List version files, deploy targets |

Both are optional. Create only what you need.

## Layer 2: User Global Extensions

Lives in `~/.claude/skills/{skill-name}/`. Applies to ALL your projects.

```
~/.claude/
└── skills/
    └── commit/
        └── reference.md    ← "Always use scope 'app' for this user"
```

**Use for:** Personal conventions that apply everywhere (commit style, preferred
tools, default configurations).

## Layer 3: Project Extensions

Lives in `{project}/.claude/skills/{skill-name}/`. Applies only to this project.

```
my-angular-app/
└── .claude/
    └── skills/
        ├── ship/
        │   ├── SKILL.md        ← "Before PR: run ng build --prod"
        │   └── reference.md    ← "Deploy via SSH to 192.168.178.32"
        ├── commit/
        │   └── reference.md    ← "Scope must be one of: core, ui, api"
        └── debug/
            └── reference.md    ← "Logs at %APPDATA%/MyApp/logs/"
```

**Use for:** Project-specific build commands, deploy targets, version files,
log paths, test commands, CI integration.

## How extensions are loaded

Every plugin skill starts with Step 0:

```
1. Read ~/.claude/skills/{name}/SKILL.md + reference.md      → global
2. Read {project}/.claude/skills/{name}/SKILL.md + reference.md → project
3. Merge all layers: project rules > global rules > plugin defaults
4. Proceed with merged ruleset
```

## Extension examples by skill

### /devops-ship
```markdown
# reference.md
## Quality gates
- Run `npm run lint && npm run test:unit` before PR
- Run `dotnet publish` for .NET projects

## Deploy target
- SSH deploy: scp dist/ user@192.168.178.32:/var/www/

## Version files
- src/environments/version.ts → `export const VERSION = 'X.Y.Z'`
- electron-builder.json → `"version": "X.Y.Z"`
```

### /devops-commit
```markdown
# reference.md
## Scope rules
- Valid scopes: core, ui, api, auth, config
- Always use module name as scope, not file name
```

### /debug
```markdown
# reference.md
## Log locations
- Electron main: %APPDATA%/MyApp/logs/main.log
- Electron renderer: DevTools console
- Angular dev server: terminal output
```

### /devops-setup-issue
```markdown
# reference.md
## Project board
- Owner: MyOrg
- Project ID: 5
- Status field ID: PVTF_abc123
- "In Progress" option ID: 98765

## Required labels
- role:frontend, role:backend, role:qa
- module:auth, module:dashboard, module:api
```

## Delivery targets

Configure how `/devops-ship` delivers the release by setting a `deliver:` field in
`{project}/.claude/skills/ship/reference.md`.

### 1. `git+gh` (default)

No extension needed. `/devops-ship` creates a PR via `gh`, merges it, and pushes the
tag. This is the built-in behavior when no `deliver:` field is present.

### 2. `ssh-rsync` *(future work)*

Planned extension that will copy build output to a remote server after the PR merges.
Currently the value is accepted but falls through to `none` — the documented schema is
stable so consumer reference.md files can be authored now.

```yaml
# .claude/skills/ship/reference.md
deliver: ssh-rsync
target: user@host:/var/www/app
rsync_args: ["-az", "--delete"]
```

Prerequisites (when implemented): SSH key in `~/.ssh/` and host in `known_hosts`.

### 3. `ha-rest` *(future work)*

Planned extension that will push config to a Home Assistant instance after ship.
Currently the value is accepted but falls through to `none`.

```yaml
# .claude/skills/ship/reference.md
deliver: ha-rest
base_url: http://homeassistant.local:8123
token_env: HA_TOKEN
```

When implemented, the handler will `POST /api/services/homeassistant/reload_core_config`
after upload. Canonical use case: shipping HA YAML configs managed in git.

### 4. `none`

For projects that only edit files in-place with no delivery step. `deliver: none` makes
`/devops-ship` skip Step 4a entirely.

## Post-merge deploy verification

Independent of `deliver:`, projects can opt into a background watcher that probes
production after CI goes green. Add a `verify:` block to the same
`{project}/.claude/skills/ship/reference.md`:

```yaml
verify:
  mode: http
  url: https://my-app.example.com
  expected_status: 200
  selector: '<meta name="version" content="([^"]+)"'
  expected: "$VERSION"
  timeout_seconds: 600
```

Full field reference: see [`skills/devops-ship/deep-knowledge/post-merge-verify.md`](../skills/devops-ship/deep-knowledge/post-merge-verify.md).

Failures (CI red or verify probe failing) land in `<repo>/.claude/.ship-watcher/<sha>.json`
and surface at the next SessionStart via the `ss.ship.verify` hook, plus a
best-effort Windows toast at the moment of failure.

## Agent extensions

Same pattern applies to agents:

```
{project}/.claude/agents/{agent-name}/AGENT.md
```

Override responsibilities, tools, or collaboration rules per project.

## Session-opened files (file:// URL tracking)

When a project-side skill extension opens a local HTML file in the browser
via `file://` (instead of the bridge-server's `http://localhost:…`), the
URL becomes invalid as soon as `/devops-ship` cleans up the worktree the
file lived in. The user sees a 404 / blank tab and thinks the content
itself is broken — when in reality the merged HTML is fine at the
equivalent path inside the main repo.

To opt into the automatic re-open behaviour, call the session-open
tracker right after every `start msedge "file://…"` your extension issues:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/session-open-tracker.js" track \
  "<absolute native path of the file>" \
  --context=<short-tag>
```

- `<absolute native path>`: on Windows, run `cygpath -w` over a Git-Bash
  path first; on macOS/Linux a plain absolute path is enough.
- `--context=<tag>` is optional metadata used in `/devops-ship` logs
  (e.g. `concept`, `prototype`, `mockup`, `report`). Pick whatever makes
  the trail readable.

`/devops-ship` Step 5c invokes the tracker's `reopen-main` subcommand
after `ship_cleanup` removes the worktree:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/session-open-tracker.js" reopen-main \
  --worktree="$WORKTREE_PATH"
```

The script reads `<main-repo>/.claude/session-opened-files.json`,
filters entries that lived under the cleaned-up worktree, maps each to
the main-repo equivalent path, and re-opens every still-existing file
in Edge.

**When to opt in:** every skill extension that ships an interactive HTML
artefact (decision panel, prototype, analysis report) anchored to a
worktree path. If you only ever open `http://localhost:…` URLs (e.g. via
the concept bridge server), tracking is unnecessary because the URL is
already invalid the moment the bridge server is killed.

## Scaffolding

Run `/devops-claude-extend-skill` to interactively scaffold an extension for any plugin skill.
It lists all available skills, checks whether an extension already exists in your
project, and either scaffolds new files or opens the existing ones for editing.

## Rules

- Never edit plugin files directly — always extend via Layer 2 or 3
- Extensions are additive by default — they add to the plugin behavior
- To override a specific step, redefine it in your SKILL.md
- To add context, use reference.md (no step redefinition needed)
- Plugin updates (via Claude Code marketplace) never overwrite your extensions
