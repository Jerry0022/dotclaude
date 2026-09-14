---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Agent, WebSearch, WebFetch, AskUserQuestion]
tags: [parallel, budget]
---

Should we upgrade our service to Postgres 17 this quarter? Give me the case for and the case against, then a recommendation.

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel (independent domains / two lenses) · Complex → offer the run-agents skill, never auto-start. Hard stop: "just/quick/nur/schnell/einfach/no agents" → Inline. · budget: tight (parallel/ceremony → ask once: spare or full)
[budget] Pro · 5h 0% (reset 300 min) · week 0% → tight
