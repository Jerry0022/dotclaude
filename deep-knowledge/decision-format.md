# Decision Format

When presenting multiple options (via AskUserQuestion or inline), use this
structured format with risk markers and a clear recommendation.

## Format

```markdown
**Option A — [Kurzname]**
→ Was: Kurzbeschreibung
→ ⚠️ Risiko: niedrig / mittel / hoch + warum
→ Stärke: Was spricht dafür

**Option B — [Kurzname]**
→ Was: ...
→ ⚠️ Risiko: ...
→ Stärke: ...

✅ **Empfehlung: Option X** — weil [knapper Tradeoff-Grund]
```

## Rules

- Never present options as a neutral list — always take a position
- Never recommend without justification
- Never recommend out of convenience — only when the tradeoff is clear
- Risk levels are relative to the specific decision context
- If all options have equal risk, say so explicitly
- For AskUserQuestion: use the `description` field for risk/strength info

## When to use

- Architecture decisions (e.g., "Hook vs. Skill vs. Agent")
- Migration strategies (e.g., "1:1 vs. rewrite vs. drop")
- Implementation approaches (e.g., "quick fix vs. proper solution")
- Any situation where 2+ valid paths exist

## When NOT to use

- Single obvious solution — just do it
- User gave explicit instructions — follow them
- Trivial choices that don't warrant analysis
