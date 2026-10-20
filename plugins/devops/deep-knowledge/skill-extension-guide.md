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

In each layer, the override file is `reference.md`:

| File | Purpose | Example |
|---|---|---|
| `reference.md` | Context and rules the skill applies, plus Add / Skip / Replace Step directives (§ Directives) | List version files, deploy targets; `## Add after Step 1` → "run ng build --prod" |

**Legacy `SKILL.md` overrides are deprecated.** A `SKILL.md` in an extension
folder is still read as a fallback so nothing breaks, but rename it to
`reference.md` (merge the text when both exist): Claude Code loads every
`SKILL.md` under `~/.claude/skills/` or `{project}/.claude/skills/` as a user
skill of its own — a bare `/do-ship` next to the plugin's `devops:do-ship`.

## Layer 2: User Global Extensions

Lives in `~/.claude/skills/{skill-name}/`. Applies to ALL your projects.

```
~/.claude/
└── skills/
    └── do-ship/
        └── reference.md    ← "Always run the e2e suite before the PR"
```

**Use for:** Personal conventions that apply everywhere (documentation style,
preferred tools, default configurations).

## Layer 3: Project Extensions

Lives in `{project}/.claude/skills/{skill-name}/`. Applies only to this project.

```
my-angular-app/
└── .claude/
    └── skills/
        ├── do-ship/
        │   └── reference.md    ← "Before PR: run ng build --prod · deploy via SSH to 192.168.178.32"
        ├── do-run/
        │   └── reference.md    ← "Backlog mode: also trust @our-release-bot as an author"
        └── auto-fix/
            └── reference.md    ← "Logs at %APPDATA%/MyApp/logs/"
```

**Use for:** Project-specific build commands, deploy targets, version files,
log paths, test commands, CI integration.

## Renamed skills — the old directory keeps working

The skill restructure (PR 2) renamed most skills (`ship` → `do-ship`, `fix` →
`auto-fix`, `concept` → `auto-concept`, …) and folded others into modes
(`run-backlog` → `do-run` backlog mode, `promote` → `do-ship` promote mode).
An extension written under the old name is still read: the override loader
looks up the new directory first and falls back to the old one; a folded
mode's old directory is injected in addition, labelled with its mode
("backlog mode only"). The full table lives in `hooks/lib/skill-names.js`
(`RENAMED`, `FOLDED`); hooks that read an extension file themselves use its
`resolveExtensionFile()`. New extensions go under the new name.

## How extensions are loaded

ONE override loader serves every skill (`hooks/lib/skill-overrides.js`, hooks
`post.skill.overrides` for a Skill-tool start and `prompt.skill.overrides` for
a typed `/skill`). When a devops skill starts it:

1. reads `~/.claude/skills/{name}/reference.md` (global) and
   `{project}/.claude/skills/{name}/reference.md` (project) — a legacy
   `SKILL.md` there as a deprecated fallback, old names as above;
2. parses the directive headings (below) into explicit orders;
3. injects ONE block into the session, layers in the order plugin defaults →
   global → project (project wins on conflict):

```
[skill-overrides] do-ship: project reference.md
Override loader (this IS do-ship's Step 0): …
Directives:
- SKIP Step 3 of do-ship (project override) — do not run it …
- ADD after Step 4 of do-ship (project override) — run the section "Add after Step 4" below right after it.
- RULES (project override) — the rest of the file applies throughout do-ship.
=== project: …/.claude/skills/do-ship/reference.md ===
…file text…
```

   File bodies are inlined up to 6000 characters in total; a larger file is
   named with "Read this file in full before Step 1", its directives still
   listed. No override file → no block, no output.
4. records the active overrides for this session — the completion card shows
   them as one line, e.g. `🧩 Override aktiv: Projekt do-ship (Step 8 ergänzt)`.
   The line names the overrides loaded since the previous card.

Each skill's own Step 0 is a single line pointing at this block.

A bare skill name the plugin does not ship (your own `.claude/skills/<your-skill>/`)
is never treated as an override — that folder IS the skill. A foreign
plugin's skill (`other:foo`) gets its `reference.md` injected when one exists.

## Directives

Headings in `reference.md` (any level from `##`, outside code fences) that
the loader turns into explicit orders. Use the step numbers of the plugin's
SKILL.md.

| Heading | Effect | Card label |
|---|---|---|
| `## Add after Step 4` / `## Add before Step 4` | the section runs right after / before Step 4 | `nach Step 4 ergänzt` |
| `## Skip Step 3` (also `## Skip Steps 3, 5`) | Step 3 is not run | `Step 3 übersprungen` |
| `## Replace Step 2` | the section runs instead of Step 2 | `Step 2 ersetzt` |
| `## Step 8 — Self-update` | the section extends Step 8 | `Step 8 ergänzt` |
| any other text | additional rules for the whole skill | `Regeln` |

German spellings parse the same: `Ergänze nach Schritt 4`, `Überspringe
Schritt 3`, `Ersetze Schritt 2`, `Schritt 8 — …`. A directive's section ends
at the next heading of the same or a higher level.

## Extension examples by skill

### /do-ship
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

### /auto-polish
```markdown
# reference.md
## UI rules
- disable: R2b, R4b                # standing rules to switch off (named on the ship card)
- tooltip.mechanisms: appTooltip, <HelpHint>
- tooltip.delay: info 1200, label 400   # ms, the two R1 tier values (default 1500 / 500)
- hotkey.mechanisms: useShortcut(, data-hotkey
- hotkey.display: inline           # R4b hints marked in the word instead of hover-revealed
- menu.components: <AppMenu>, <ContextMenu>
- files: src/renderer/**/*.ts      # extra UI file globs for detection + the reminder hook
- Icon-only buttons in the title bar are exempt from R1 (platform chrome).
- All list rows use `--space-3` vertical rhythm.
```
The same section is read by the `post.design.remind` hook (prevention while
writing), by `/do-ship` Step 1e through `/auto-polish --invoked-by=ship`
(static check on the diff) and by a full `/auto-polish` pass (static +
runtime). Rule ids and the default allowlists: `deep-knowledge/ui-defaults.md`.

### /do-run backlog
```markdown
# reference.md
## Issue trust
- Additionally trust: @our-release-bot (opens the weekly chore issues)
- Never queue issues labelled `discussion`
```

### /auto-fix
```markdown
# reference.md
## Log locations
- Electron main: %APPDATA%/MyApp/logs/main.log
- Electron renderer: DevTools console
- Angular dev server: terminal output
```

### /auto-issue
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

Configure how `/do-ship` delivers the release by setting a `deliver:` field in
`{project}/.claude/skills/do-ship/reference.md`.

### 1. `git+gh` (default)

No extension needed. `/do-ship` creates a PR via `gh`, merges it, and pushes the
tag. This is the built-in behavior when no `deliver:` field is present.

### 2. `ssh-rsync` *(future work)*

Planned extension that will copy build output to a remote server after the PR merges.
Currently the value is accepted but falls through to `none` — the documented schema is
stable so consumer reference.md files can be authored now.

```yaml
# .claude/skills/do-ship/reference.md
deliver: ssh-rsync
target: user@host:/var/www/app
rsync_args: ["-az", "--delete"]
```

Prerequisites (when implemented): SSH key in `~/.ssh/` and host in `known_hosts`.

### 3. `ha-rest` *(future work)*

Planned extension that will push config to a Home Assistant instance after ship.
Currently the value is accepted but falls through to `none`.

```yaml
# .claude/skills/do-ship/reference.md
deliver: ha-rest
base_url: http://homeassistant.local:8123
token_env: HA_TOKEN
```

When implemented, the handler will `POST /api/services/homeassistant/reload_core_config`
after upload. Canonical use case: shipping HA YAML configs managed in git.

### 4. `none`

For projects that only edit files in-place with no delivery step. `deliver: none` makes
`/do-ship` skip Step 4a entirely.

## Post-merge deploy verification

Independent of `deliver:`, projects can opt into a background watcher that probes
production after CI goes green. Add a `verify:` block to the same
`{project}/.claude/skills/do-ship/reference.md`:

```yaml
verify:
  mode: http
  url: https://my-app.example.com
  expected_status: 200
  selector: '<meta name="version" content="([^"]+)"'
  expected: "$VERSION"
  timeout_seconds: 600
```

Full field reference: see [`skills/do-ship/deep-knowledge/post-merge-verify.md`](../skills/do-ship/deep-knowledge/post-merge-verify.md).

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
URL becomes invalid as soon as `/do-ship` cleans up the worktree the
file lived in. The user sees a 404 / blank tab and thinks the content
itself is broken — when in reality the merged HTML is fine at the
equivalent path inside the main repo.

To opt into the automatic re-open behaviour, call the session-open
tracker right after every `start msedge "file://…"` your extension issues:

```bash
node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" track \
  "<absolute native path of the file>" \
  --context=<short-tag>
```

- `<absolute native path>`: on Windows, run `cygpath -w` over a Git-Bash
  path first; on macOS/Linux a plain absolute path is enough.
- `--context=<tag>` is optional metadata used in `/do-ship` logs
  (e.g. `concept`, `prototype`, `mockup`, `report`). Pick whatever makes
  the trail readable.

`/do-ship` Step 5c invokes the tracker's `reopen-main` subcommand
after `ship_cleanup` removes the worktree:

```bash
node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" reopen-main \
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

Say "extend skill" (the hidden `auto-extend` skill) to interactively scaffold an extension for any plugin skill.
It lists all available skills, checks whether an extension already exists in your
project, and either scaffolds new files or opens the existing ones for editing.

## Rules

- Never edit plugin files directly — always extend via Layer 2 or 3
- Extensions are additive by default — they add to the plugin behavior
- To skip, replace or add a step, use the directive headings (§ Directives) in reference.md
- Never create a SKILL.md in an extension folder — Claude Code loads it as a separate skill
- Plugin updates (via Claude Code marketplace) never overwrite your extensions
