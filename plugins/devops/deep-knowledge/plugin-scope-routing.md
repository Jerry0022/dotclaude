# Plugin Scope Routing — Where a Fix Belongs

Cross-cutting rule for every skill, hook, and agent: a devops-plugin defect found
in some other project becomes an **issue in the plugin source repo**, never a
local fix there.

This is the single source of truth for the "which repo owns this change?"
question. `/claude-learn` Step 4b/5 implements it for captured learnings; every
other skill, agent, and ad-hoc turn follows the same hierarchy.

## The hierarchy

Two facts decide everything: **is this session the plugin source repo**, and
**does the problem belong to the plugin or to this project**.

| Session repo          | Problem belongs to  | Route                                                   |
|-----------------------|---------------------|---------------------------------------------------------|
| Plugin source repo    | plugin              | **Implement directly.** No issue needed.                |
| Plugin source repo    | that same repo      | Same as above — it is one repo.                          |
| Consumer project      | plugin              | **Issue in the plugin source repo.** Nothing local.     |
| Consumer project      | this project        | **This project's own `.claude/` instructions.**          |
| Consumer project      | deliberate override | Local skill extension — only with a stated reason.       |

The failure mode this prevents: noticing a plugin bug while working in another
project and fixing it *there* — as a local workaround, a CLAUDE.md patch, or a
hand-edit of the installed copy. Every one of those leaves the actual defect
live for every other consumer, and the installed-copy variant is erased on the
next sync.

## Detecting which repo you are in

The session is the **plugin source repo** when `{git-root}/plugins/devops/.claude-plugin/plugin.json`
exists and its `name` field is `devops`. Anything else is a **consumer project**
— including a worktree of an unrelated repo and a session with no git root at all.

Hooks share this detection via `hooks/lib/plugin-scope.js`
(`isPluginSourceRepo`, `managedPluginArtifact`, `upstreamSlug`, `scopeFor`).
Do not re-implement it.

## Consumer project + plugin problem → upstream issue

1. Resolve the upstream slug from the installed marketplace metadata
   (`{owner.name}/{name}`); canonical value is `Jerry0022/dotclaude`.
2. Invoke `/setup-issue` via the **Skill** tool — never `gh issue create`
   directly (see `plugin-behavior.md` → "Issue Creation — Always Delegate").
   Hand it a self-contained prompt:
   - **title** — `[BUG] <short>` for a defect, `[FEAT] <short>` for a gap
   - **body** — symptom, the affected plugin part (skill / hook / agent / MCP /
     convention), and `Captured from a session in {current-project}.`
   - **target repo** — the upstream slug, so it does not land in the consumer repo
3. Persist nothing locally. The issue *is* the deliverable.

Report the issue URL to the user in the same turn. "I filed it upstream" without
a link is not a completed handoff.

## Never hand-edit an installed plugin copy

`~/.claude/plugins/cache/**`, `~/.claude/plugins/marketplaces/**`, and
`~/.claude/plugins/repos/**` are installer-managed artifacts. Editing them from
a consumer project is blocked by `pre.plugin.scope` (exit 2). The block is
correct — route the defect upstream instead of bypassing it.

**Exception:** in the plugin source repo, touching the local install is allowed
(repairing or testing the installed copy). The hook lets it through there.

## Consumer project + this project's problem → local instructions

Build commands, architecture rules, business-logic conventions, and file layout
belong to the project that owns them. Persist inside that project's `.claude/`,
preferring the largest fitting container first: **deep-knowledge > skill
extension > CLAUDE.md** (sizing rules: `content-conventions.md`).

## Deliberate override — the narrow exception

A local skill extension under `{project}/.claude/skills/<skill>/` is justified
only when the rule must **not** become the plugin default: this project needs a
deviation every other project would be wrong to inherit. Name that reason
explicitly. If you cannot, it is an upstream issue.

## Cross-project work

When the target is a *third* project (neither this session's nor the plugin's),
the topic still wins: a plugin problem goes upstream regardless of which project
surfaced it. A genuinely project-specific rule for another repo becomes an issue
in that repo (via `/setup-issue`), or — if it has no GitHub remote — a
copy-pastable prompt for the user. Ask before writing files into another
project's tree.
