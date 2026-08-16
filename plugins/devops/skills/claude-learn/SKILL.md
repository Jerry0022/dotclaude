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

1. Global: `~/.claude/skills/claude-learn/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/claude-learn/SKILL.md` + `reference.md`

The directory name is the skill's own `name` (`claude-learn`), per
`CONVENTIONS.md` → Extension Mechanism. Any other spelling silently loads
nothing.

## Step 1 — Collect the learning

Text passed after `/claude-learn` is the learning. Otherwise ask once: "Was soll
ich langfristig lernen?"

The learning MUST end up a self-contained rule. Vague input ("die Farben waren
falsch") → one clarifying question before continuing. Capture the **why** when
the user gives it — without the reason the rule becomes superstition and future
Claude cannot judge edge cases.

## Step 2 — Route

**One decision, exactly one branch.** Run the gate, then answer Q1–Q3 in order.

**Gate — before Q1: does the rule belong to any project at all?** A rule that
would land outside every project (`~/.claude/CLAUDE.md`, `~/.claude/skills/`) —
typically about how Claude answers, regardless of what is being worked on —
cannot answer Q1. Stop here: **branch E**, ask first, never auto-write.

Judge by where the rule has to live, not by the words in it. "In jedem Projekt"
is not the trigger: *"in jedem Projekt soll `/ship` die Issue-Nummer
schreiben"* changes a plugin default and is a plugin rule (Q1). Nor does naming
a plugin part keep the gate shut — *"sprich mich per Du an, auch wenn `/ship`
nachfragt"* is a tone preference that merely mentions `/ship` as the venue;
its home is auto-memory, so the gate fires. Ask what the rule is *about*: the
plugin's behavior, a project's, or how Claude talks to you.

**Q1 — Whose behavior changes: the plugin's, everywhere — or just here?** The
only judgment call in the skill. Reach and subject together, not either alone:

- **the devops plugin** — a plugin skill (`/ship`, `/fix`, `/concept`, …),
  hook, agent, MCP server, script under `plugins/devops/`, or plugin
  convention, **and** the change is one every consumer should get. The default
  for anything naming a plugin part.
- **a project** — build commands, architecture, business-logic conventions,
  file layout: things the plugin has no opinion about. *Which* project is Q3.

A learning that names a plugin part but must **not** reach other consumers is
neither — it is the C-override special case below.

**Q2 — Is this session the plugin source repo?** A fact, not a judgment. Get the
root with `git rev-parse --show-toplevel`; it is the plugin source repo when
`{git-root}/plugins/devops/.claude-plugin/plugin.json` exists with `name`
`devops`, **or** the root `.claude-plugin/marketplace.json` lists a `devops`
plugin — **except** when that root lives inside `~/.claude/plugins/{cache,
marketplaces,repos}/**`, which is an installed copy and never the source, however
authentic its metadata looks. Everything else is a consumer project, including a
session with no git root. This mirrors `isPluginSourceRepo` in
`hooks/lib/plugin-scope.js` branch for branch; canonical rules in
`{PLUGIN_ROOT}/deep-knowledge/plugin-scope-routing.md`.

**Q3 — Which project?** Only relevant when Q1 = *a project*. Scan the learning
**text** for a named project; nothing named → the current one. The scan reads
the text, it does not survey the disk. Recipe and the `~/IdeaProjects/` bound:
`deep-knowledge/routing-details.md` (sibling of this file).

| Q1 — changes rules of | Q2 — session is plugin repo | Q3 — which project | Branch                                             |
|-----------------------|-----------------------------|--------------------|----------------------------------------------------|
| the devops plugin     | yes                         | —                  | **A** — edit the plugin files directly             |
| the devops plugin     | no                          | —                  | **B** — issue in the plugin repo, nothing local    |
| a project             | either                      | this one           | **C** — this project's own `.claude/` instructions |
| a project             | either                      | another one        | **D** — issue there, or a hand-off prompt          |

| Special case — overrides the table above                                                  | Branch                                         |
|-----------------------------------------------------------------------------------------------|------------------------------------------------|
| Names a plugin part, **and** you can state why the rule must never become the plugin's default | **C-override** — local extension, this project |

The special case carries no Q2 condition on purpose. Being inside the plugin's
own repo does not make a repo-local rule a plugin default — dotclaude is a
consumer of its own plugin and keeps such rules in its `.claude/`, exactly like
any other project (`plugin-scope-routing.md` row 2).

Three tie-breakers, in force order:

1. **Q1 outranks Q3.** A plugin rule goes to A/B no matter which project
   surfaced it — an issue against the wrong repo helps nobody.
2. **Unsure between plugin and project, and Q2 = no → plugin.** A plugin defect
   fixed locally stays live for every other consumer; a plugin issue that turns
   out to be project-specific costs one closed issue. **When Q2 = yes this
   inverts** — nothing is at stake upstream, and a dotclaude-only rule filed as
   a plugin default ships to every consumer. In the plugin source repo, a tie
   falls to **C** (this repo dogfoods its own extensions in `.claude/skills/`).
3. **Unsure whether C-override applies → it does not.** Its entry condition is
   a reason you can state out loud. Without one, fall back through the matrix,
   not to a fixed branch: **Q2 = no → B**; **Q2 = yes → A**, or C when Q1 was
   the tie tie-breaker 2 covers. Filing an issue against dotclaude from inside
   dotclaude is never the answer.
   In branch B nothing is written locally — not into this project's tree, and
   never into `~/.claude/plugins/**`, which `pre.plugin.scope` blocks *from a
   consumer project*. In the plugin source repo that hook stands down by
   design, so there the rule is yours to keep, not the hook's to enforce.

Worked examples — each lands in exactly one branch:

| Learning (session in parentheses)                                                  | Branch                                       |
|------------------------------------------------------------------------------------|----------------------------------------------|
| "`/ship` bricht ab, wenn der Branchname einen Slash enthält" (consumer project)     | **B** — plugin defect, upstream issue        |
| same learning (dotclaude)                                                            | **A** — implement it here                    |
| "In diesem Repo muss vor jedem Commit `npm run lint` laufen" (dotclaude)             | **C** — its `.claude/`, per tie-breaker 2    |
| "Im Projekt Foo brauchen DB-Migrationen einen eigenen Commit" (a third project)      | **D** — Q1 = a project, Q3 = Foo             |
| same learning (session is Foo)                                                       | **C** — Q3 resolves to the current project   |
| "Antworte mir immer auf Deutsch" (any)                                               | **E** — the gate catches it before Q1        |
| "In jedem Projekt soll `/ship` die Issue-Nummer schreiben" (consumer project)        | **B** — plugin default, not the gate         |
| "`/ship` soll hier den Docker-Publish überspringen, wir bauen kein Image" (either)   | **C-override** — reason holds off upstream   |

## Step 3 — Execute the branch

Per-branch procedure — which file, what to hand over, how to scaffold —
lives in `deep-knowledge/routing-details.md` (sibling of this file). Read the
section for your branch.

Within whatever container you land in, prefer **deep-knowledge > skill >
CLAUDE.md**, and re-route to the next-larger container rather than busting a
budget. Sizing, re-route triggers, the reference-over-duplicate rule, and tone:
`{PLUGIN_ROOT}/deep-knowledge/content-conventions.md`.

Branches B and D persist nothing locally, and E writes outside every project —
all three skip Step 4.

## Step 4 — Prune duplicate feedback memory

The canonical file now owns this rule, so an auto-memory `feedback_*.md` entry
covering the same ground is a stale duplicate: auto-memory is for personal
style and tone, not project rules. Delete matched entries **with per-match
confirmation**.

Mechanics — memory-dir resolution, matching criteria, the confirmation
prompt: `deep-knowledge/feedback-cleanup.md` (sibling of this file).

## Step 5 — Report

- Which file(s) changed (path + line delta), and the verbatim rule added
- CLAUDE.md touched → relay what `post.claude.budget` reported, if anything; do
  not re-count lines by hand
- Feedback memories deleted in Step 4 → list them
- Branch B / D → the issue URL; branch D without a remote → the hand-off block

## Step 6 — Completion card

Call `mcp__plugin_devops_dotclaude-completion__render_completion_card` with
`variant`, `summary`, `lang`, `session_id`, and `changes` (file/issue → short
delta). Output the markdown VERBATIM as the LAST thing in the response.

| Situation                                        | Variant    |
|--------------------------------------------------|------------|
| Files written (branch A, C, C-override, or E)    | `ready`    |
| Issue created (branch B or D)                    | `fallback` |
| Hand-off prompt only (branch D)                  | `fallback` |
| User aborted at branch E                         | `analysis` |

## Rules

- **Never write to user feedback memory** from this skill — auto-memory owns
  that channel. The only permitted writes are the Step 4 deletions, each
  confirmed.
- **Fix a rule where it lives.** Full hierarchy, detection, and the
  never-hand-edit-an-installed-copy boundary:
  `{PLUGIN_ROOT}/deep-knowledge/plugin-scope-routing.md`.
- **Always reference, never duplicate** existing skill/agent/hook/deep-knowledge
  logic — see `{PLUGIN_ROOT}/deep-knowledge/content-conventions.md`.
- **Always ask** before a global change, or any cross-project file edit that is
  not a GitHub issue.
- **Never silently overwrite a rule that says the opposite.** Show the conflict
  and ask which wins.
