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
- **A free-text answer via "Sonstiges" (Other) is a real answer and outranks
  every offered option.** The options are suggestions; typing something else is
  the user telling you the list was incomplete. Take the typed value as the
  decision — never dismiss it as "that doesn't answer the question", and never
  silently fall back to your own recommendation. Only push back when the value
  is genuinely unusable for the mechanism behind it (wrong type, out of range,
  technically impossible), and then say exactly why and ask again. If it merely
  carries a downside, apply it and name the downside in one clause.
- For AskUserQuestion after inline results: if the preceding output contains
  substantial inline content (analysis, report, long text), the **first option
  of the first question** must always be **"Erstmal in Ruhe durchlesen"** with
  description: "Es wird nichts implementiert oder weiter geändert, bis du
  weiter sagst." — the options overlay often covers the results, and the user
  needs a one-click way to dismiss and read first. When the user selects this
  option, re-present the same questions **without** the "Erstmal in Ruhe
  durchlesen" option (they already read). This applies only to the first
  question; follow-up questions don't need this option.

## Option order

Applies to every `AskUserQuestion` — asked at runtime and authored in a
skill's question block alike.

- **Fixed order.** A question keeps the same options in the same order in
  every call, so the user finds each answer where it was last time. Never
  reorder options per run, per budget or per context.
- **The recommendation moves, the options do not.** When the best choice
  depends on context, move only the `(Recommended)` marker to another
  option; the list stays as it is.
- **Recommended is usually first.** Order the options so the choice that is
  recommended in the common case stands first. A marker on a later option is
  the exception for a stated condition, and the question block names that
  condition next to the option.
- **Recommend only what is recommended.** A marker that is right only in a
  rare case belongs on the common-case option; a click-through must never
  land on a choice the user would have to undo.
- Hiding an option that does not apply is allowed; the remaining options
  keep their relative order. The "Erstmal in Ruhe durchlesen" option above
  is prepended, never mixed into the list.

## When to use

- Architecture decisions (e.g., "Hook vs. Skill vs. Agent")
- Migration strategies (e.g., "1:1 vs. rewrite vs. drop")
- Implementation approaches (e.g., "quick fix vs. proper solution")
- Any situation where 2+ valid paths exist

## When NOT to use

- Single obvious solution — just do it
- User gave explicit instructions — follow them
- Trivial choices that don't warrant analysis
