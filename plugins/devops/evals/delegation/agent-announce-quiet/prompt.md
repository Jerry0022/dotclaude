---
max_turns: 20
timeout_seconds: 540
allowed_tools: [Read, Glob, Grep, Agent, WebSearch, WebFetch]
tags: [background, announce]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Mit Agents: prüf die offiziellen Vite-Release-Notes — welche Breaking Changes von Vite 6 auf Vite 7 betreffen eine reine TypeScript-SPA? Mit Quell-URL je Punkt.

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel only for two analysis lenses (parallel implementers → offer) · Complex → offer the auto-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed.
