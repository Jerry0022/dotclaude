---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Agent, WebSearch, WebFetch, AskUserQuestion]
tags: [parallel, budget]
env: { EVAL_DOTCLAUDE_BUDGET: ask-before-parallel }
---

Should we upgrade our service to Postgres 17 this quarter? Give me the case for and the case against, then a recommendation.

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel only for two analysis lenses (parallel implementers → offer) · Complex → offer the auto-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed. · budget: ask-before-parallel (1-agent tier → sonnet ≤10 calls; parallel/ceremony → ask once: inline / 1 sonnet agent / full)
