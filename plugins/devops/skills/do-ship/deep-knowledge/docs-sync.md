# Ship — Docs-Sync (Step 2.6)

Referenced by `/do-ship` Step 2.6. The non-blocking rule stays in SKILL.md.

## Procedure

Reconcile living documentation against the **frozen shipped diff** before the
version bump — so doc edits land in the same version-bump commit.

1. Determine what this ship actually changes — new feature, changed flow, new
   subsystem, architecture/contract change, or removal. Use the diff since the
   merge-base, not intentions. When `ship_preflight` returned a
   `doc-readme-sections` check (plugin-source repo), read each named README
   section against the diff — that map, not memory, says which prose describes
   the changed code.
1b. **Rendered output is checked by its literal strings.** A change to what the
   user sees (a card heading, a title prefix, a command name, a setting key, a
   CLI flag) is grepped across the living docs by its OLD literal string; every
   hit is fixed in place. Hand-copied examples of rendered output rot silently —
   prefer generating them from the real code (the plugin-source repo does this
   for card examples in `gen-readme-sections.mjs`).
2. Apply the **proportional** doc action per
   `{PLUGIN_ROOT}/deep-knowledge/documentation-maintenance.md` § Trigger Matrix:
   - trivial (typo / refactor / dep or version bump / pure bugfix) → no
     living-doc change; note "no living-docs impact" and continue.
   - new or changed behavior, flow, or architecture → update the affected living
     docs (`docs/`, README prose, architecture/flow docs) in place; restructure
     `docs/` only when the layout no longer fits (additive-first, never delete
     dated specs/concepts).
3. Commit any doc edits on the current branch so they ship with this version.

**Non-blocking:** never abort a ship over docs. Unavoidable doc debt proceeds —
record the gap in the CHANGELOG entry (Step 3). The mechanical roster markers
(counts, rosters) are handled separately by `ship_build` in Step 2.
