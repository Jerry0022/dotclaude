---
max_turns: 20
timeout_seconds: 540
allowed_tools: [Read, Glob, Grep, Agent, WebSearch, WebFetch]
tags: [background]
env: { EVAL_DOTCLAUDE_BUDGET: free }
---

Check the official Vite release notes and migration guide: what are the breaking changes from Vite 6 to Vite 7 that would affect a plain TypeScript SPA? List them with the source URL for each.

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel only for two analysis lenses (parallel implementers → offer) · Complex → offer the auto-agents skill, never auto-start. Hard stop (request narrowed: "just/quick/nur/schnell/keine Agents") → Inline; hard go ("agents/full") → as designed.
