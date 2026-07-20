# Content Conventions — Sizing & Self-Reference

How to size and structure project-persistent content (CLAUDE.md, skills,
deep-knowledge). Referenced by `/devops-learn`, `/devops-claude-lint`, and
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
concern handled by `/devops-claude-lint` and ordinary refactor passes.

## Self- and plugin-references over command redundancy

When a new rule says "do X", check first whether X is already a plugin skill,
agent, hook, or deep-knowledge doc. **A reference is always preferred over a
duplicate.** Examples:

- "always commit conventionally" → reference `/devops-commit`, do NOT
  re-document the commit format
- "always run pre-flight before shipping" → reference `/devops-ship`, do NOT
  re-list the pipeline steps
- "open issues with the right labels" → reference `/devops-setup-issue`, do NOT
  duplicate the label rules
- "check branch hygiene before shipping" → reference `/devops-repo-health`,
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
