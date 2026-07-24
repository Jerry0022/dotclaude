# Purpose Alignment Gate — Cross-Branch Purpose & Regression Check

Referenced by `/ship` Step 1d. Verifies that a ship honors not only the
**code** of recently merged branches (that is `deep-knowledge/merge-safety.md`)
but their **purposes**: the goals and conventions each branch established.

## Why code-level merge safety is not enough

Two branches developed in parallel:

- **Branch A** — "Add hotkeys to all interactive elements." Ships first.
- **Branch B** — "Add a new export button." Ships second; the rebase onto main
  succeeds without a single textual conflict.

Every merge-safety check passes — no overlapping files, tests green. Yet the
merged result violates A's purpose: the new export button has no hotkey,
because B was written before A's convention existed. Conversely, B's button
may sit in a container A's hotkey handler re-renders, silently breaking A's
feature. Neither problem is visible at the diff level. Both are visible at the
**purpose** level.

The same holds for branches merged long ago and no longer "relevant" to any
conflict: their purposes may still impose obligations on new work (a standing
convention does not expire when its PR leaves the git log's first page).

## When it runs

| Situation | Intensity |
|---|---|
| Every ship (direct or intermediate) once preflight reports `ready: true` | **Light** — purpose gathering + propagation audit (P1–P3, P5–P6) |
| A rebase/merge happened in Step 1b, or `ship_release` bounced with `baseAdvancedDuringChecks` | **Full** — light + regression audit (adds P4) |
| `mode: "file-only"`, zero purpose sources, or every purpose clearly out of scope for the diff | **Skip** silently |

Intermediate ships (sub-branch → feature branch) use the sibling sub-branches
merged into the feature branch as sources — parallel role agents (core,
frontend, ai) are precisely the scenario where one agent's convention must
propagate to another agent's work.

## Step P1 — Gather purpose sources

Select the last **N merged branches** into `<base>`, newest first.

**N:** default 5. Use at least 3 when available; fewer only when fewer exist.
Discretionary widening (up to ~8) when several recent merges carry no purpose
(see exclusions); narrowing to 3 when PR bodies are unusually large.

Primary source — merged PRs (richest, usually Claude-authored):

```bash
gh pr list --base <base> --state merged --limit 15 \
  --json number,title,body,mergedAt,headRefName,author
```

Exclude, then keep the newest N:

- PRs of the **current branch** itself (own intermediate ships)
- Reverts, version-bump-only, changelog-only, and other purely mechanical PRs
- PRs whose changes lie fully outside the active codebase (vendored deps)

Fallbacks, in order:

1. No `gh` / no remote → merge commits:
   `git log <base> --merges -n 15 --format='%h %s%n%b'` plus matching
   `CHANGELOG.md` entries.
2. Squash-only history (no merge commits) →
   `git log <base> -n 30 --format='%h %s'`, grouped by the PR reference
   `(#NNN)` in the subjects.
3. Nothing usable → skip the gate silently. **Never fabricate purposes.**

Claude-authored PR bodies (structured `## Summary` sections, "Generated with
Claude Code" trailer) are the preferred purpose statements — the user's task
briefs usually survive there. Human PRs without a body contribute only their
title + commit subjects; mark those purposes **low-confidence**.

**Cost control:** do NOT read PR diffs during gathering. Truncate each body
after ~40 lines. Total purpose material stays under ~3K tokens.

## Step P2 — Distill purpose records

For each source, produce one record:

```
{ branch, pr, mergedAt,
  purpose:     <1–2 sentences — what the branch was FOR>,
  conventions: [ <cross-cutting obligations it established — may be empty> ],
  surfaces:    [ <files / areas / features it delivered> ],
  confidence:  high | low }
```

The key judgment is separating two kinds of intent:

- **Local purpose** — "add export button", "fix crash in parser". Imposes no
  obligation on other branches; relevant only for the regression audit (P4).
- **Cross-cutting convention** — a rule the branch established that future and
  parallel code must follow: "ALL interactive elements get hotkeys", "every
  API call goes through the retry wrapper", "all dialogs close on ESC",
  "every skill loads extensions in Step 0". Relevant for the propagation
  audit (P3).

Markers of a convention: universal quantifiers in the purpose ("alle",
"every", "überall", "konsistent"), a migration applied across many files,
lint-rule or guard additions, template changes.

## Step P3 — Propagation audit

*Does OUR diff honor THEIR conventions — and does the existing repo honor OURS?*

### Forward propagation

For each convention from a merged branch:

1. Determine whether the current diff (`git diff origin/<base>...HEAD`)
   introduces anything inside the convention's scope (a new element, a new
   API call, a new dialog, a new skill, …).
2. If yes → check the introduced artifact against the convention. When
   compliance is unclear, read ONE reference implementation from the source
   branch's surface to see what compliance looks like.
3. Violation found → record `{ convention, artifact, fixSize }`.

### Reverse propagation (retro-application)

The audit runs in **both directions**. When the CURRENT branch establishes a
new cross-cutting convention (distill it from the branch's own diff + task
context, same P2 markers), the artifacts that already exist on `<base>` fall
inside its scope too — a convention "all elements get hotkeys" introduced on
THIS branch obligates the elements the repo already has, not only future ones.

1. Enumerate existing in-scope artifacts on `origin/<base>` — targeted
   Grep/Glob over the convention's surface, not a full-repo read.
2. Apply the convention to each site **as part of this ship** when the fix is
   mechanical (same escalation rules as P5). The retro-fixes commit on the
   current branch and ship with the PR.
3. When the retro-migration would dwarf the branch's own diff, or individual
   sites need per-site design decisions → include it in the ONE batched
   AskUserQuestion with a recommendation (apply now vs. explicit user call).
   Never drop it silently and never demote it to an unasked "follow-up".

## Step P4 — Regression audit (full check only)

*Does the merged result still deliver ALL purposes — theirs and ours?*

Runs only when a rebase/merge actually happened during this ship.

For each purpose record (local purposes included):

1. **Intersection check:** does the current diff touch the record's surfaces?
   Use preflight's `file-overlap` result plus a targeted
   `git log --oneline origin/<base> -n 20 -- <surface paths>`.
2. **No intersection** → mark `intact (no overlap)`. Done — do not deep-read.
3. **Intersection** → verify the delivered feature still works:
   - Tests covering the surface exist → confirm they run (Step 1b/6, Step 2)
     and are green.
   - No test coverage → read the merged result at the intersection and verify
     the feature's mechanism is still wired (merge-safety.md Step 5 semantic
     patterns: signatures, config keys, imports, render paths).
   - **Symmetric direction:** check OUR feature still works where THEIR
     merged code touched our surfaces — a rebase replays our commits on top
     of theirs, so our side can silently lose too.
4. Broken → treat as a **merge defect**: fix as part of the ship. This is not
   scope creep — the ship caused the breakage.

## Step P5 — Resolve & escalate

| Finding | Action |
|---|---|
| Violation with a mechanical, clearly-implied fix (add the missing hotkey, wrap the call, register the handler) | Fix autonomously, commit on the current branch, re-run affected tests |
| Regression caused by the merge/rebase | Fix autonomously (merge defect) |
| Retro-application of a convention THIS branch introduces (existing sites on `<base>`, see P3 reverse propagation) | Apply autonomously when mechanical — ships with this PR. If it dwarfs the branch's own diff or needs per-site design decisions → **AskUserQuestion** (batched, with recommendation) |
| Two gathered purposes contradict each other as applied to this diff | **AskUserQuestion** |
| Compliance needs a design decision (where the hotkey goes, which UX pattern) and no reference implementation exists to copy | **AskUserQuestion** |
| Fix would require substantial rework of this branch's approach, or changes user-visible behavior beyond this branch's own scope (high impact) | **AskUserQuestion** |
| Low-confidence purpose (title-only source) with an ambiguous violation | Do NOT block; surface as `userFinalTest` item |

**Batching rule** (same as merge-safety): resolve all autonomous findings
first, then present ALL user decisions in a single AskUserQuestion — never
one question per finding. Each option shows: the purpose (with PR number),
the violating artifact, and a recommendation.

After autonomous fixes: they ship with this PR; re-run the test suite if any
code changed.

## Step P6 — Report

Feed into the completion card (ship Step 6):

- Fixed violations/regressions → `changes` entries phrased as behavior
  ("Export-Button folgt jetzt der Hotkey-Konvention aus #47").
- Open or unverifiable items (low-confidence, user-deferred) →
  `userFinalTest` items, most critical first.
- Gate found nothing → stay silent. No "purpose check passed" noise on the
  card.

## Configuration (project extension)

Projects can tune the gate in `{project}/.claude/skills/ship/reference.md`:

```yaml
purpose_alignment:
  depth: 5          # merged branches to gather (min 3 is enforced)
  disable: false    # true = skip the gate entirely
  conventions:      # standing conventions checked on EVERY ship,
    - "All interactive elements have hotkeys"    # independent of history depth
    - "Every dialog closes on ESC"
```

Standing `conventions:` entries behave like P2 conventions with **high**
confidence — the escape hatch once a convention is older than the gathering
window.

## Anti-patterns

- **Reading full PR diffs during gathering.** Purposes come from
  titles/bodies; code is consulted per-finding in P3/P4 only.
- **Demoting retro-application to a silent "follow-up".** A convention this
  branch introduces obligates existing artifacts NOW — apply it mechanically
  or put it in the batched question; never defer it unasked.
- **Blocking the ship on low-confidence violations.** Title-only purposes
  produce `userFinalTest` items, not gates.
- **"Tests pass, so purposes hold."** Tests cover what was written; a missing
  hotkey on a new element has no failing test. The propagation audit is a
  judgment pass, not a test run.
- **Asking the user per finding.** One batched question, autonomous-first.
- **Fabricating purposes from thin sources.** A branch with no recoverable
  intent contributes nothing — skip it.
