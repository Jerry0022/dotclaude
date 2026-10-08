# Polish Rules-only Path (ship)

What `/auto-polish --invoked-by=ship` does instead of the full pass. `SKILL.md` § Rules-only path decides when it runs.

It lets /do-ship measure the standing UI rules on every UI ship without a
full polish pass (agents, browser, viewports).

1. **Scope** = the files /do-ship passed (its diff filtered to UI files),
   resolved against `--cwd` when given (else the session's cwd). Empty
   scope → return `{ applicable: false, reason: "no UI files in diff" }` and
   stop. No UI profile (`test-autonomy.md` profiles `cli-node`, `lib`,
   `generic`) → same, reason `"no UI profile"` — unless a `files:` glob of
   the override names a scope file: that explicit opt-in counts as a UI
   profile for the files it names (how a CLI or plugin repo checks its own UI
   sources).
2. **Check** only the **static** halves of Step 4 #8 (R0, R1, R2a, R2b, R3, R4a, R4b, R5, R6, R7),
   inline — no scout agents, no browser, no screenshots. Runtime halves
   are never attempted here; they are listed once as
   `skipped: runtime rules (full /auto-polish)`.
3. **Never fix.** Return a findings list, one entry per finding:
   `{ rule, file, line, element, detail, mechanical: true|false,
   fix?: "<one-line change when mechanical>" }`. `mechanical: true` only when
   the fix needs no invented content (a spacing or colour token swap, an
   existing label reused as tooltip text through the app's tooltip
   component). The caller decides what to apply.
4. **Name the overrides**: `disabled: [ids]` from the project override,
   `notApplicable: [ids]` for mechanism classes absent from the project.
5. **No completion card, no AskUserQuestion, no session-title change** — the
   caller (/do-ship) owns the turn. Hand back the structure and return.
