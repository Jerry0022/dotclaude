---
name: devops-deep-research
version: 0.1.0
description: >-
  Spawn an isolated research agent to deeply investigate any topic — keeps main
  context clean. Use when the user wants to research something thoroughly,
  compare technologies, understand the state of a field, find best practices,
  or asks "what is the current state of X". Also triggers on: "research",
  "investigate", "deep dive", "finde raus", "recherchiere", "was ist der Stand
  von", "compare X vs Y", "pros and cons of". Do NOT trigger for simple factual
  questions that can be answered with a single WebSearch.
argument-hint: "[topic or question]"
context: fork
allowed-tools: WebSearch, WebFetch, Read, Grep, Glob
---

# Deep Research

Research the topic `$ARGUMENTS` thoroughly and return a structured report.

## Step 0 — Load Extensions

Silently check for optional overrides (do not surface "not found" in output):

1. Global skill extension: `~/.claude/skills/deep-research/SKILL.md` + `reference.md`
2. Project skill extension: `{project}/.claude/skills/deep-research/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Depth check

Before spawning a full research agent, assess:

- **Simple fact** ("What version is X?") → Do NOT use this skill. A single WebSearch suffices.
- **Comparison or multi-faceted topic** ("X vs Y", "best practices for Z") → Proceed.
- **Ambiguous** → Default to full research, keep scope tight (3 angles).

## Step 2 — Budget awareness

Check the session's token budget state. Deep research typically costs 30K-80K tokens.

- **5h burn-rate > 1.3**: Warn user: "Deep Research ist token-intensiv (~50K). Dein Verbrauch ist hoch. Trotzdem fortfahren?"
- **Otherwise**: Proceed without comment.

## Step 3 — Break down the topic

Identify 3–5 research angles or sub-questions.

## Step 4 — Search and fetch

For each angle:
1. Search the web using `WebSearch`.
2. Fetch the 2–3 most relevant pages with `WebFetch`.
3. Prefer primary sources (official docs, GitHub, RFCs) over blog posts.

## Step 5 — Cross-reference

Note agreements and contradictions across sources. If information conflicts, report both sides.

## Step 6 — Local codebase check

If the question is code-related, search the local codebase with `Grep` and `Glob`.

## Step 7 — Adaptive output format

Match output depth to question complexity:

### Broad topics (3+ angles)
```markdown
## Research: <topic>

### TL;DR
<2–3 sentence executive summary>

### Findings
#### <Angle 1>
...

### Recommendations
- ...

### Sources
- [title](url) — <date, relevance note>
```

### Focused comparisons
```markdown
## Vergleich: X vs Y

### TL;DR
<1–2 sentences: which to choose when>

| Kriterium | X | Y |
|-----------|---|---|
| ... | ... | ... |

### Empfehlung
...
```

### "State of X" questions
```markdown
## Stand der Technik: <topic>

### Zusammenfassung
<3–4 sentences>

### Aktuelle Entwicklungen
- ...

### Ausblick
- ...
```

## Rules

- Note the date/recency of each source — flag anything older than 12 months.
- Do not fabricate sources or URLs.
- If no reliable sources exist, say so explicitly.
- **Fact verification mandatory** — double-check every claim and statistic.
  If 3+ fact references in the output, include a verification table
  (see `deep-knowledge/fact-verification.md` for format).
- End with: "Soll ich auf einen bestimmten Aspekt tiefer eingehen?"
