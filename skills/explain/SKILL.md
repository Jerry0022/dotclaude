---
name: explain
description: Explain code, architecture, or a concept in clear terms — reads the relevant files and explains with analogies. Use when the user wants to understand something.
argument-hint: [file, function, concept, or question]
allowed-tools: Read, Grep, Glob
---

# Explain

Explain `$ARGUMENTS` clearly, tailored to an experienced developer who may be new to this specific module.

## Steps

1. If `$ARGUMENTS` is a file path or function name, read the file(s) and locate the relevant code.
2. If `$ARGUMENTS` is a concept, identify the key components in the codebase via `Grep`.
3. Produce an explanation structured as:

```markdown
## What it is
<1-paragraph plain-English description>

## The mental model / analogy
<one concrete real-world or system analogy>

## How it works (step by step)
1. ...
2. ...

## Key files / entry points
- `path/to/file.ts:42` — <what it does>

## Common gotchas
- ...

## Related concepts
- ...
```

## Rules
- Use the user's own codebase as examples — quote actual file paths and line numbers.
- No jargon without definition.
- Keep the analogy concrete and relevant (not generic "like a factory").
- If the scope is too large, explain the top-level first and offer to drill into sub-parts.
