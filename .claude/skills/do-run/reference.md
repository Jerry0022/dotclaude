# Run Reference — dotclaude (plugin-source repo)

Applies when `/do-run` asks its questions here, and to every `AskUserQuestion`
this repo's skills define (`plugins/devops/skills/**`, their `deep-knowledge/`
question blocks and mode files) — authored or changed in this repo.

## Question option order

- **Fixed order.** A question keeps the same options in the same order in
  every call, so the user finds each answer where it was last time. Never
  reorder options per run, per budget or per context.
- **The recommendation moves, the options do not.** When the best choice
  depends on context, move only the `(Recommended)` marker to another
  option; the list stays as it is.
- **Recommended is usually first.** Order the options so the choice that
  is recommended in the common case stands first. A marker on a later
  option is the exception for a stated condition, and the question block
  names that condition next to the option.
- **Recommend only what is recommended.** A marker that is right only in a
  rare case belongs on the common-case option; a click-through must never
  land on a choice the user would have to undo.
- Hiding an option that does not apply (e.g. F2 "Chat-Arbeit prüfen" when
  this chat wrote nothing) is allowed; the remaining options keep their
  relative order.
