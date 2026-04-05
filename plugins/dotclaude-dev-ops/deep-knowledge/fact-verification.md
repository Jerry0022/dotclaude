# Fact Verification

Cross-cutting rule for all web research, claims, and statistics.
Referenced by: research agent, /devops-deep-research skill, and any task
involving external information.

## Core Rule

**Double-check every claim and statistic.** Never present unverified
information as fact. Every factual statement from a web source must be
cross-referenced with at least one independent source.

## Verification Process

1. **Find the claim** in the primary source
2. **Search for corroboration** — find at least one independent source
   that confirms or contradicts
3. **Assess confidence**:
   - Confirmed by 2+ independent sources → state as fact
   - Found in only one source → mark as "unverified, single source"
   - Sources contradict → present both sides with sources
   - No corroboration found → explicitly say so

## Verification Table

When a response contains **more than 3 fact references**, include a
verification table:

```markdown
## Fact Verification

| # | Claim | Source | Verified | Confidence |
|---|---|---|---|---|
| 1 | React has 45% market share | StateOfJS 2025 | ✅ Confirmed by StackOverflow Survey | High |
| 2 | Svelte is faster than React | Blog post X | ⚠️ Benchmark-dependent, not universal | Medium |
| 3 | Vue 4 releases Q2 2026 | Twitter post | ❌ No official confirmation | Low |
| 4 | Angular signals reduce re-renders by 60% | Angular blog | ✅ Confirmed by benchmark repo | High |
```

**Confidence levels:**
- **High** — confirmed by 2+ authoritative sources (official docs, peer-reviewed, major surveys)
- **Medium** — single authoritative source, or confirmed by non-authoritative sources
- **Low** — single non-authoritative source, or unverified claim

For **3 or fewer** fact references: verify inline without a table.
Example: "React has 45% market share (StateOfJS 2025, confirmed by StackOverflow Survey)."

## Special Rules

- **Statistics without a date** → flag: "Statistik ohne Datum — Aktualität unklar"
- **Statistics older than 12 months** → flag: "Daten von [date] — möglicherweise veraltet"
- **Vendor-published benchmarks** → always note: "Herstellerangabe — unabhängige Bestätigung empfohlen"
- **"Studies show" without citation** → reject: do not repeat, find the actual study or say it's unverifiable
- **Numbers that seem too round** (e.g., "exactly 50% faster") → suspicious, verify extra carefully

## When NOT to verify

- Common knowledge that doesn't need citation (e.g., "JavaScript runs in browsers")
- Direct quotes from official documentation being referenced
- Code examples and syntax (verify by reading, not by sourcing)
- User-provided data that Claude is asked to process
