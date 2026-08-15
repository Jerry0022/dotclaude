# Content Conventions — Sizing & Self-Reference

How to size and structure project-persistent content (CLAUDE.md, skills,
deep-knowledge). Referenced by `/claude-learn`, `/claude-lint`, and
all skill authoring.

These are **soft caps** — they bias routing decisions, they don't hard-fail.
When content genuinely needs more space, re-route to the next-larger container
instead of cramming.

## Size budgets (soft)

| File type                                  | Target lines | Rationale                                              |
|--------------------------------------------|--------------|--------------------------------------------------------|
| `CLAUDE.md` (project or global)            | ~20          | Index only — pointers to skills and deep-knowledge     |
| `SKILL.md` (any skill or extension)        | ~200         | One coherent flow per skill; keep steps tight          |
| `deep-knowledge/*.md`                      | unbounded    | Reference material — depth is the point                |

## Re-route triggers

When adding new content would push a file past its budget:

- **CLAUDE.md > ~25 lines** → extract bulk to `deep-knowledge/<topic>.md`,
  leave a one-line pointer in CLAUDE.md.
- **SKILL.md > ~250 lines** → move detail to a sibling
  `<skill>/deep-knowledge/<topic>.md` (or to the plugin's top-level
  `plugins/devops/deep-knowledge/` if it is cross-cutting), then reference it
  from the relevant Step.

The cap is stylistic. If the rule itself is short and the file is already over
budget for unrelated reasons, just append — size-rebalancing is a separate
concern handled by `/claude-lint` and ordinary refactor passes.

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

- "always commit conventionally" → reference `/commit`, do NOT
  re-document the commit format
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
