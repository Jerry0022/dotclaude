---
name: completion-card
description: Master template for task completion cards — all variants derive from this single source.
version: 0.10.1
used-by: ship, test, start, commit, review, analysis, and any skill/agent that completes work
---

# Completion Card — Master Template

The completion card is the **last thing** in every response that completes a task.
No text after the closing `---`. No preamble before the opening `---`.

**Single source of truth for the anatomy, per-variant mapping, and the Desktop
widget: `deep-knowledge/completion-card-design.md`.** This template only points
callers at the renderer and the field contract — it does not restate the design.

## Structure (summary — see the design doc for the full anatomy)

Two visual blocks, both rendered by `render_completion_card` / `--render-card`:

```
&nbsp;
---
### **✨✨✨ {title} ✨✨✨**                 ← outcome, ≤ 60 chars
› result line 1                            ┐  Block 1 — "what happened"
› result line 2 (≤ 3, deviation first)     │  (Desktop: one surface, no border)
✓ 3/3 Anforderungen  ✓ 3464 Tests grün     │  evidence row
○ commit → ○ push → ○ PR → ○ merge · Build │  pipeline line
5h [bar] 3 h 39 m   Wk [bar] 6 d 20 h      │  budget line (omitted when low + far from reset)
## 📦 {decision as a question}?            ┐  Block 2 — "what to decide"
› optional context line                    │  (Desktop: quiet accent-tinted box)
1. reservation / test step (≤ 3)           │
[Ship ↗] [Ändern ↗]                        ┘  Desktop widget only; terminal: nothing
---
```

- No `Changes`/`Geprüft`/`OFFEN`/`Delivery`/footer/state blocks any more — every
  fact they used to carry now lives in the result lines, the evidence row, the
  pipeline line, or the decision points. See design doc § 2 for exactly where.
- The per-variant heading/points/buttons mapping is § 3 of the design doc —
  do not duplicate that table here; it drifts.
- On Desktop the markdown shrinks to the `### **✨✨✨ {title} ✨✨✨**` line
  (marker + transcript record); the widget draws the title and the body once.
- The Desktop widget (title, both blocks, tooltips, budget bars, buttons) is built by
  `mcp-server/lib/card-widget.js` from the same structured model the markdown
  renderer uses (`buildCardModel` in `mcp-server/index.js`).

## How to call it

Always through `render_completion_card` (or the `--render-card` CLI fallback,
same schema, same renderer). Populate the fields described in the tool's
`inputSchema` — every field maps onto a specific piece of the § 2 anatomy;
grep `mcp-server/index.js` for `input.<field>` to see exactly where each one
lands. Never hand-write the card markdown.

## Guards

`hooks/lib/card-guard.js` and `hooks/stop/stop.flow.guard.js` enforce the
anatomy rules (result-line cap, points cap, heading punctuation, notification
turns with no card obligation) — see design doc § 5.
