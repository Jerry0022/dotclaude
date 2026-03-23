---
name: deep-research
description: >-
  Spawn an isolated research agent to deeply investigate any topic — keeps main
  context clean. Use when the user wants to research something thoroughly,
  compare technologies, understand the state of a field, find best practices,
  or asks "what is the current state of X". Also triggers on: "research",
  "investigate", "deep dive", "finde raus", "recherchiere", "was ist der Stand
  von", "compare X vs Y", "pros and cons of". Do NOT trigger for simple factual
  questions that can be answered with a single WebSearch — only for topics that
  need multiple angles and cross-referencing.
argument-hint: [topic or question]
context: fork
agent: Explore
allowed-tools: WebSearch, WebFetch, Read, Grep, Glob
---

# Deep Research

Research the topic `$ARGUMENTS` thoroughly and return a structured report.

## Step 0 — Depth check

Before spawning a full research agent, assess whether this actually needs deep research:

- **Simple fact** ("What version is X?", "When was X released?") → Do NOT use this skill. A single WebSearch suffices. Tell the user you'll answer directly instead.
- **Comparison or multi-faceted topic** ("X vs Y", "best practices for Z", "state of the art in W") → Proceed with full research.
- **Ambiguous** → Default to full research, but keep the scope tight (3 angles, not 5).

## Step 1 — Budget awareness

Check the session's token budget state (from the SessionStart dashboard data). Deep research typically costs 30K-80K tokens.

- **5h window >70%**: Warn the user before proceeding: "Deep Research ist token-intensiv (~50K). Dein 5h-Fenster ist bei X%. Trotzdem fortfahren?"
- **Weekly >60%**: Mention the budget state but proceed unless the user objects.
- **Budget healthy**: Proceed without comment.

## Step 2 — Break down the topic

Identify 3–5 research angles or sub-questions. Fewer angles for narrow topics, more for broad ones.

## Step 3 — Search and fetch

For each angle:
1. Search the web using `WebSearch`.
2. Fetch the 2–3 most relevant pages with `WebFetch`.
3. Prefer primary sources (official docs, GitHub, RFCs, academic papers) over blog posts.

## Step 4 — Cross-reference

Note agreements and contradictions across sources. If information conflicts, report both sides with context.

## Step 5 — Local codebase check

If the question is code-related, also search the local codebase with `Grep` and `Glob` for relevant patterns, implementations, or prior art.

## Step 6 — Adaptive output format

Match the output depth to the question complexity:

### For broad topics (3+ angles)
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
- [title](url) — <date, relevance note>
```

### For focused comparisons
```markdown
## Vergleich: X vs Y

### TL;DR
<1–2 sentences: which to choose when>

| Kriterium | X | Y |
|-----------|---|---|
| ... | ... | ... |

### Empfehlung
...

### Quellen
- [title](url)
```

### For "what is the state of X" questions
```markdown
## Stand der Technik: <topic>

### Zusammenfassung
<3–4 sentences>

### Aktuelle Entwicklungen
- ...

### Ausblick
- ...

### Quellen
- [title](url) — <date>
```

## Rules

- Note the date/recency of each source — flag anything older than 12 months.
- Do not fabricate sources or URLs.
- If the topic has no reliable sources, say so explicitly rather than speculating.
- End with an offer: "Soll ich auf einen bestimmten Aspekt tiefer eingehen?"
