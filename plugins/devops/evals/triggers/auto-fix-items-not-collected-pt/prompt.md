---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill, Agent, Write, Edit, Bash]
tags: [trigger, skill-auto-fix, lang-pt]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Muito melhor! Mas quando eu me movo de A1 para A2, o navio também se move, mas os itens não estão mais sendo coletados

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel only for two analysis lenses (parallel implementers → offer) · Complex → offer the auto-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed.
