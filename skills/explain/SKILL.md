---
name: explain
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

## Step 0 — Scope assessment

Before diving in, determine the scope of what needs explaining:

| Scope | Indicators | Response depth |
|-------|-----------|----------------|
| **Single line/expression** | User points at specific code | 2-3 sentences inline, no template |
| **Function/method** | User asks about a specific function | Short explanation with key logic, no full template |
| **Module/component** | User asks about a file or class | Medium explanation, use template sections selectively |
| **Architecture/system** | User asks how things connect, data flow, or "the big picture" | Full template + Mermaid diagram |

Match your response depth to the scope — a single function doesn't need 6 sections.

## Step 1 — Gather context

- If `$ARGUMENTS` is a file path or function name → read the file(s) and locate the relevant code.
- If `$ARGUMENTS` is a concept → identify the key components in the codebase via `Grep`.
- If the user has known expertise (from memory) → tailor the explanation depth. An experienced dev doesn't need basics explained; a newcomer benefits from more context.

## Step 2 — Explain

### For single line / function scope:

Explain directly in prose. No template needed. Include the file:line reference.

### For module / architecture scope:

Use this structure (omit sections that don't add value):

```markdown
## What it is
<1-paragraph plain-English description>

## The mental model
<one concrete real-world analogy — not generic "like a factory", but specific to the domain>

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

### For architecture scope — add a Mermaid diagram:

When explaining how multiple components interact, always include a Mermaid diagram. Render it via the diagram pipeline (see CLAUDE.md §Visual Diagrams). Use:
- **Flowchart LR** for data/request flows
- **Sequence diagram** for interaction sequences between components
- **Class diagram** for data model relationships

## Rules

- Use the user's own codebase as examples — quote actual file paths and line numbers.
- No jargon without definition (unless user's known expertise makes it redundant).
- Keep the analogy concrete and relevant — tied to the specific domain, not generic.
- If the scope is too large, explain the top-level first and offer to drill into sub-parts.
- End architecture explanations with: "Soll ich auf einen bestimmten Teil genauer eingehen?"
