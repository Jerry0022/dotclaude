---
name: explain
version: 0.1.0
description: >-
  Explain code, architecture, or a concept in clear terms — reads the relevant
  files and explains with analogies. Use when the user wants to understand
  something. Triggers on: "explain", "how does X work", "what does this do",
  "walk me through", "was macht", "wie funktioniert", "erkläre mir", "I don't
  understand this code", "can you break this down". Also triggers when the user
  points at a file/function and asks a "why" or "how" question. Do NOT trigger
  for debugging (use /debug) or research (use /deep-research).
argument-hint: "[file, function, concept, or question]"
allowed-tools: Read, Grep, Glob
---

# Explain

Explain `$ARGUMENTS` clearly, tailored to the user's expertise level.

## Step 0 — Load Extensions

1. Read `~/.claude/skills/explain/SKILL.md` + `reference.md` if exists → global overrides
2. Read `{project}/.claude/skills/explain/SKILL.md` + `reference.md` if exists → project overrides
3. Merge: project > global > plugin defaults

## Step 1 — Scope assessment

| Scope | Indicators | Response depth |
|-------|-----------|----------------|
| **Single line/expression** | User points at specific code | 2-3 sentences inline |
| **Function/method** | User asks about a specific function | Short explanation with key logic |
| **Module/component** | User asks about a file or class | Medium, use template selectively |
| **Architecture/system** | User asks how things connect | Full template + diagram |

Match response depth to scope.

## Step 2 — Gather context

- File path or function name → read the file(s), locate relevant code.
- Concept → identify key components via `Grep`.
- Known user expertise (from memory) → tailor depth accordingly.

## Step 3 — Explain

### For single line / function scope:

Explain directly in prose. No template. Include file:line reference.

### For module / architecture scope:

```markdown
## What it is
<1-paragraph plain-English description>

## The mental model
<concrete real-world analogy specific to the domain>

## How it works
1. ...
2. ...

## Key files / entry points
- `path/to/file.ts:42` — <what it does>

## Common gotchas
- ...

## Related concepts
- ...
```

### Diagrams

- **Default**: HTML rendering in the project's design language via Preview panel — preferred for most explanations.
- **Exception**: When many flows, messages, dependencies, or sequences need to be shown → Mermaid diagram (LR preferred).

Rule of thumb: HTML unless the complexity of interconnections makes Mermaid clearer.

## Rules

- Use the user's own codebase as examples — quote actual file paths and line numbers.
- No jargon without definition (unless user's known expertise makes it redundant).
- Keep analogies concrete and domain-relevant — not generic.
- If scope is too large, explain top-level first and offer to drill into sub-parts.
- End architecture explanations with: "Soll ich auf einen bestimmten Teil genauer eingehen?"
