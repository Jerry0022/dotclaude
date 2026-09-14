---
max_turns: 14
allowed_tools: [Read, Glob, Grep, Agent, Write, Skill]
tags: [inline, hard-stop]
---

We need to migrate the users table primary key from integer to UUID. Keep it simple, no agents — just write the migration plan to PLAN.md.

[delegation-policy] Classify before the first tool call: Inline (≤~5 files, Q&A, quick fix) · 1 background agent (web pages → devops:research; >~10-file sweep → Explore; full tests → devops:qa; high-stakes diff → devops:redteam; "should we X?" trade-off → devops:po, plus devops:research when facts need checking) · 2–3 parallel (independent domains / two lenses) · Complex → offer the run-agents skill, never auto-start. Hard stop: "just/quick/nur/schnell/einfach/no agents" → Inline.
