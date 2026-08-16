# Content Conventions — Sizing & Self-Reference

How to size and structure project-persistent content (CLAUDE.md, skills,
agents, deep-knowledge). Referenced by `/claude-learn`, `/setup-project`, the
`post.claude.budget` hook, and all skill authoring.

These are **soft caps** — they bias routing decisions, they don't hard-fail.
When content genuinely needs more space, re-route to the next-larger container
instead of cramming.

## Size budgets

Every file here is loaded as context, so its length is a cost paid again in
every session that touches it. Two numbers per kind: the **budget** is the
re-route trigger, the **ceiling** is where the file stops working as one
document and a split is no longer optional.

| File                                 | Budget | Ceiling | Rationale                                                    |
|--------------------------------------|--------|---------|--------------------------------------------------------------|
| `CLAUDE.md` (project or global)      | 25     | 50      | Index only — pointers to skills and deep-knowledge           |
| `SKILL.md` (any skill or extension)  | 250    | 500     | One coherent flow per skill; keep steps tight                |
| `agents/*.md`                        | 150    | 300     | Loaded whole on every dispatch — no room for reference bulk  |
| `<skill>/reference.md`               | 200    | 400     | Extension surface, not a manual                              |
| `deep-knowledge/*.md`                | 600    | —       | Depth is the point; no ceiling, but a split still pays       |

**Measured, not remembered.** `post.claude.budget` (PostToolUse, `Write|Edit`)
re-checks these files at write time and reports when an edit pushes one further
over. It reports **growth**, not size: a file already over budget that is not
getting worse stays silent, and so do generated files. The thresholds above are
mirrored in `{PLUGIN_ROOT}/hooks/lib/claude-file-budget.js` — change them in
both places or the hook and this table drift apart.

The hook is a reporter, never a blocker. It cannot judge whether the extraction
is worth doing *now*; that judgment stays with whoever made the edit.

## Re-route triggers

When adding new content would push a file past its budget:

- **CLAUDE.md over budget** → extract bulk to
  `<project>/.claude/deep-knowledge/<topic>.md`, leave a one-line pointer in
  CLAUDE.md.
- **SKILL.md over budget** → move detail to a sibling
  `<skill>/deep-knowledge/<topic>.md` (or to the plugin's top-level
  `plugins/devops/deep-knowledge/` if it is cross-cutting), then reference it
  from the relevant Step.
- **Agent over budget** → move reference material to plugin-level
  deep-knowledge and point at it by name; keep the agent's own behavior inline.
- **deep-knowledge over budget** → split by topic, then regenerate the index:
  `node {PLUGIN_ROOT}/scripts/gen-dk-index.js <dir>`.

The cap is stylistic. If the rule itself is short and the file is already over
budget for unrelated reasons, just append — size-rebalancing is a separate
concern handled by ordinary refactor passes.

## What to extract, and where it goes

Length is the symptom; these are the causes. Scan an over-budget file for them
in this order — the first match is usually most of the overage.

| Content in the file                     | Where it belongs                                  |
|-----------------------------------------|---------------------------------------------------|
| Code block longer than ~5 lines         | `deep-knowledge/<topic>.md`, or a script           |
| Step-by-step procedure                  | A skill, or `<skill>/deep-knowledge/<topic>.md`    |
| Architecture description                | `deep-knowledge/architecture.md`                   |
| API docs, endpoint or option lists       | `deep-knowledge/api.md`                            |
| Environment / setup walkthrough         | `deep-knowledge/setup.md`                          |
| Rationale, history, "why we chose X"    | `deep-knowledge/<topic>.md`                        |

What stays behind is the part a reader needs *before* deciding to open anything:
pointers to where detail lives, short rules and conventions (1–2 lines each),
and build/test/lint commands (one line each). A CLAUDE.md that reads as
documentation rather than as an index is over budget even when it is short.

## Extraction procedure

1. Pick the sections to move from the table above — largest first.
2. Create the target file. Append under a short heading if it already exists;
   grep the relevant `deep-knowledge/INDEX.md` first so a near-duplicate
   topic gets extended rather than forked.
3. Move the content **verbatim**. Rewriting while extracting turns one
   reviewable move into an unreviewable rewrite; polish afterwards if needed.
4. Replace the original section with a one-line pointer:
   `- <Topic>: see <path>`.
5. Regenerate the index if a deep-knowledge file was created:
   `node {PLUGIN_ROOT}/scripts/gen-dk-index.js <dir>`.
6. Verify: re-count the source file, and confirm every pointer resolves.
   An extraction that leaves a dead pointer is worse than the overage — the
   content is now both missing from the index and unreachable.

Extract only what the current edit is about. Restructuring unrelated sections
to make room is how a one-line rule turns into an unreviewable diff.

## When a CLAUDE.md is missing

A project without one has no index at all — every session rediscovers the same
facts. Offer this scaffold, filled from what the repo actually declares
(`package.json`, `Cargo.toml`, `pyproject.toml`, …); leave `TODO` where nothing
is detectable rather than guessing:

```markdown
# {project-name}

## Stack
{detected}

## Commands
- Build: `{detected or TODO}`
- Test: `{detected or TODO}`
- Lint: `{detected or TODO}`

## Conventions
- {1-2 key rules}

## References
- Project map: see `.claude/project-map.md`
- Architecture: see `.claude/deep-knowledge/architecture.md`
```

A missing **global** `~/.claude/CLAUDE.md` is not a defect — it holds personal
cross-project preferences (response style, language, conventions) and is the
user's call. Mention it once; never write it without explicit confirmation.

## Keep the decision separate from the procedure

Size is the visible symptom; a blurred decision is the expensive one. When a
skill has to *choose* — which branch, which target, which mode — the choice
degrades long before the file gets slow to read: the criteria drift apart into
several steps, execution prose grows between them, and a third axis gets bolted
on that only matters in two cases. What survives is a document you can follow
and still land in the wrong branch.

Structure any skill that routes like this:

- **One decision point.** All criteria in one step, as few questions as the
  choice truly needs, each answered before the next. Not spread across the
  steps that happen to mention them.
- **Name what each question is.** A judgment call and a lookable-up fact are
  different work — say which is which, so neither gets treated as the other.
- **One table, one branch per row.** If a row can send you two places, the
  axes are wrong; collapse or split them until every input has exactly one
  outcome.
- **Procedure lives elsewhere.** "I am in branch X, now what?" belongs in
  `<skill>/deep-knowledge/`, referenced from the step. Execution detail sitting
  between the criteria is what blurs them.
- **Tie-breakers in force order.** For the cases the table cannot settle —
  including the default when unsure. Ambiguity resolved by whoever reads it
  next is not resolved.

A third axis is the loudest warning sign. Before adding one, check whether it
is really an exception *inside* one branch: an exception costs a named
condition, an axis costs a row in every combination.

## Self- and plugin-references over command redundancy

When a new rule says "do X", check first whether X is already a plugin skill,
agent, hook, or deep-knowledge doc. **A reference is always preferred over a
duplicate.** Examples:

- "always commit conventionally" → reference
  `deep-knowledge/commit-conventions.md`, do NOT re-document the commit format
- "always run pre-flight before shipping" → reference `/ship`, do NOT
  re-list the pipeline steps
- "open issues with the right labels" → reference `/setup-issue`, do NOT
  duplicate the label rules
- "check branch hygiene before shipping" → reference `/setup-cleanup`,
  do NOT re-document the cleanup steps
- Generic conventions (browser tools, MCP deferred tools, code defaults,
  merge safety, …) → reference the existing `deep-knowledge/*.md` file by
  name; do not paraphrase

**If the referenced skill/doc is incomplete for the new rule, first extend
that skill/doc**, then reference it from the new learning. Never produce a
parallel inferior copy of an existing skill's logic.

Before writing a new rule: quick Grep on `plugins/devops/skills/` and on
`plugins/devops/deep-knowledge/INDEX.md` for the topic.

## Tone for learnings and rules

- Imperative mood, short sentences.
- Capture **why** when the user gave a reason. Without the reason the rule
  becomes superstition — future Claude needs it to judge edge cases.
- Capture **when** the rule applies (which step / which trigger), so future
  Claude does not over-apply it.
