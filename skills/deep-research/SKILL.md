---
name: deep-research
description: Spawn an isolated research agent to deeply investigate any topic — keeps main context clean. Use when the user wants to research something thoroughly.
argument-hint: [topic or question]
context: fork
agent: Explore
allowed-tools: WebSearch, WebFetch, Read, Grep, Glob
---

# Deep Research

Research the topic `$ARGUMENTS` thoroughly and return a structured report.

## Steps

1. Break the topic into 3–5 research angles or sub-questions.
2. Search the web for each angle using `WebSearch`.
3. Fetch the 2–3 most relevant pages per angle with `WebFetch`.
4. Cross-reference findings — note agreements and contradictions.
5. If the question is code-related, also search the local codebase with `Grep` and `Glob`.
6. Return a structured Markdown report:

```markdown
## Research: <topic>

### TL;DR
<2–3 sentence executive summary>

### Findings
#### <Angle 1>
...
#### <Angle 2>
...

### Recommendations
- ...

### Sources
- [title](url)
```

## Rules
- Prefer primary sources (official docs, GitHub, RFC, academic papers) over blog posts.
- Note the date/recency of each source.
- If information is conflicting, report both sides with context.
- Do not fabricate sources or URLs.
