---
name: claude-learn
version: 0.2.0
description: >-
  Capture a long-term learning/correction and route it to the correct project-
  specific instructions (skill, skill-extension, deep-knowledge, or as a last
  resort CLAUDE.md) — NOT to personal feedback memory. Also prunes now-duplicate
  `feedback_*.md` entries with confirmation. Routing is one decision matrix
  (Step 2); per-branch execution lives in `deep-knowledge/routing-details.md`.
  Triggers ONLY on explicit invocation: "/claude-learn", "lerne das", "merk dir
  das fürs Projekt", "remember this for the project", "capture learning". Do NOT
  trigger for one-off conversational corrections or for personal feedback memory.
argument-hint: "<learning text>"
allowed-tools: Bash(git *), AskUserQuestion, Read, Write, Edit, Glob, Grep, Skill, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Learn — Capture a Project-Persistent Learning

Persist a correction so it survives across sessions. Personal style/tone
feedback belongs in auto-memory and is handled elsewhere — this skill writes
**project- or plugin-specific rules**.

## Step 0 — Load extensions

Use **Glob** to verify each path exists before reading; skip missing files
silently (no output). Merge project > global > plugin defaults.

1. Global: `~/.claude/skills/learn/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/learn/SKILL.md` + `reference.md`

## Step 1 — Collect the learning

Text passed after `/claude-learn` is the learning. Otherwise ask once: "Was soll
ich langfristig lernen?"

The learning MUST end up a self-contained rule. Vague input ("die Farben waren
falsch") → one clarifying question before continuing. Capture the **why** when
the user gives it — without the reason the rule becomes superstition and future
Claude cannot judge edge cases.

## Step 2 — Route

**One decision, three inputs, exactly one branch.** Answer in order; the first
two are almost always enough.

**Q1 — Whose rules does this learning change?** This is the only judgment call
in the skill.

- **the devops plugin** — a plugin skill, hook, agent, the MCP server, scripts
  under `plugins/devops/`, a plugin convention (commit format, ship pipeline),
  or a cross-cutting topic already in `plugins/devops/deep-knowledge/`.
- **this project** — its build commands, architecture, business-logic
  conventions, file layout. Anything that would be wrong or meaningless for
  another consumer of the plugin.

**Q2 — Is this session the plugin source repo?** A fact, not a judgment:
`{git-root}/plugins/devops/.claude-plugin/plugin.json` exists and its `name` is
`devops`. Everything else is a consumer project. Same detection as
`hooks/lib/plugin-scope.js`; canonical rules in
`deep-knowledge/plugin-scope-routing.md`.

**Q3 — Does the text name a different project?** Only ask this when the learning
text points somewhere else (detection recipe: `deep-knowledge/routing-details.md`).
Default is the current project — do not go looking.

| Q1 — changes rules of | Q2 — session is plugin repo | Branch                                        |
|-----------------------|-----------------------------|-----------------------------------------------|
| the devops plugin     | yes                         | **A** — edit the plugin files directly        |
| the devops plugin     | no                          | **B** — issue in the plugin repo, nothing local |
| this project          | either                      | **C** — this project's own `.claude/` instructions |

| Special case (overrides the table above)              | Branch                          |
|--------------------------------------------------------|---------------------------------|
| Q3 named another project, and Q1 = that project's rules | **D** — issue or hand-off prompt |
| The rule belongs to no single project (`~/.claude/**`)  | **E** — ASK FIRST, never auto-write |

Three tie-breakers, in force order:

1. **Q1 outranks Q3.** A plugin rule goes to A/B no matter which project
   surfaced it — an issue against the wrong repo helps nobody.
2. **Unsure between plugin and project → plugin.** A plugin defect fixed
   locally stays live for every other consumer; a plugin issue that turns out
   to be project-specific costs one closed issue.
3. **In branch B, never write locally.** Not into this project's tree, and
   never into `~/.claude/plugins/**` (`pre.plugin.scope` blocks the latter).
   The single exception is **C-override** — a deliberate deviation from a plugin
   default that must not become the plugin's behavior, and only when you can
   state why. No reason → branch B.

## Step 3 — Execute the branch

Per-branch procedure — which file, what to hand over, how to scaffold —
lives in `deep-knowledge/routing-details.md`. Read the section for your branch.

Within whatever container you land in, prefer **deep-knowledge > skill >
CLAUDE.md**, and re-route to the next-larger container rather than busting a
budget. Sizing, re-route triggers, the reference-over-duplicate rule, and tone:
`deep-knowledge/content-conventions.md`.

Branches B and D persist nothing locally — skip Step 4.

## Step 4 — Prune duplicate feedback memory

The canonical file now owns this rule, so an auto-memory `feedback_*.md` entry
covering the same ground is a stale duplicate: auto-memory is for personal
style and tone, not project rules. Delete matched entries **with per-match
confirmation**.

Mechanics — memory-dir resolution, matching criteria, the confirmation
prompt: `deep-knowledge/feedback-cleanup.md`.

## Step 5 — Report

- Which file(s) changed (path + line delta), and the verbatim rule added
- CLAUDE.md touched → relay the `/claude-lint` output, do not re-count lines
- Feedback memories deleted in Step 4 → list them
- Branch B / D → the issue URL; branch D without a remote → the hand-off block

## Step 6 — Completion card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` with
`variant`, `summary`, `lang`, `session_id`, and `changes` (file/issue → short
delta). Output the markdown VERBATIM as the LAST thing in the response.

| Situation                                | Variant    |
|------------------------------------------|------------|
| Files written (branch A or C)            | `ready`    |
| Issue created (branch B or D)            | `fallback` |
| Hand-off prompt only (branch D)          | `fallback` |
| User aborted at branch E                 | `analysis` |

## Rules

- **Never write to user feedback memory** from this skill — auto-memory owns
  that channel. The only permitted writes are the Step 4 deletions, each
  confirmed.
- **Fix a rule where it lives.** Full hierarchy, detection, and the
  never-hand-edit-an-installed-copy boundary:
  `deep-knowledge/plugin-scope-routing.md`.
- **Always reference, never duplicate** existing skill/agent/hook/deep-knowledge
  logic — see `deep-knowledge/content-conventions.md`.
- **Always ask** before a global change, or any cross-project file edit that is
  not a GitHub issue.
- **Never silently overwrite a rule that says the opposite.** Show the conflict
  and ask which wins.
