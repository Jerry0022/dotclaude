# Reality Check — the implement gate

A concept session lives for hours or days. The default branch keeps moving
while it does: other sessions, other PRs, other ships. When the user finally
clicks **"Mit Feedback implementieren"**, the plan they approved may reference
a file that has since been renamed, a contract that has since changed, or work
somebody has already done. Implementing it verbatim then produces wrong, dead
or duplicate code — and the user only finds out in review.

So `action: "implement"` re-checks the concept against the current default
branch **before writing a single line**. If the drift materially conflicts with
the plan, Claude does not implement: it appends **one** extra round —
mechanically an ordinary iteration, marked `data-reality-check` — that asks the
user about the drift, and implements straight through on the next submit.

## The contract, in four sentences

1. An implement submission can be diverted into a reality-check round **at most
   once**. Submitting implement *from* a reality-check round always implements.
2. The diverted round contains **every** decision the drift raises. Nothing may
   be deferred to a hypothetical second forced round.
3. An ordinary `iterate` round re-arms the check — so a user who chooses to keep
   iterating still gets a fresh check when they next click implement. That is
   not a deadlock; it is the user opting back in.
4. Any condition that cannot be resolved — no remote, no default branch,
   offline, a force-pushed baseline — **fails safe**: implement proceeds.

## Why it cannot deadlock — two independent lines of defence

**Line 1, the marker.** The forced section carries `data-reality-check`. Step 0
below reads it off the just-submitted section and skips the whole check. This is
the primary guard and it is exact.

**Line 2, the baseline.** Every completed check advances the recorded baseline
to the commit it examined. So even if the marker were lost — a bad rewrite, a
legacy page, a resumed session working from a page it did not write — the drift
that caused the first round is now *behind* the baseline and cannot produce a
second one. The user would have to receive genuinely new drift, from commits
that landed after the first check, to see another forced round. That is a
correct outcome, not a loop.

Both lines have to fail simultaneously, on the same round, for the user to see
two forced rounds in a row. Neither is allowed to be treated as optional.

## Step 0 — the skip ladder

Run this **before** any code is written and before any `POST /status
{phase:"implemented"}`. First hit wins:

| # | Condition | How to check | Result |
|---|---|---|---|
| S1 | The submitted section carries `data-reality-check` | read the section you are about to freeze | **skip → implement** |
| S2 | This `_version` already has a reality-check checkpoint | `GET /recovery`, look for `step: "reality-check-*"` | **replay the recorded verdict** — never re-decide |
| S3 | Baseline unresolvable | `concept-drift.js` returns `verdict: "skip"` | **skip → implement**, note it in the final report |
| S4 | Remote tip == baseline | `verdict: "clear"`, `reason: "unchanged"` | **skip → implement** |
| S5 | Nothing the concept references was touched | `verdict: "clear"`, `reason: "no-overlap"` \| `"no-file-changes"` | **skip → implement**, advance the baseline |

Only `verdict: "candidates"` reaches the judgment step below. Everything else
implements, and S3–S5 additionally advance the baseline (§ Baseline).

**S1 is a read of the HTML, not of memory.** After a crash-and-resume you may be
looking at a page you did not write. The attribute on disk is the truth.

## The check

```bash
# 1. Tell the panel a check is starting — BEFORE the fetch, so the widened
#    pickup→write window cannot look like a stall (see § Timing below).
curl -s -X POST -H "Content-Type: application/json" \
     -d "{\"phase\":\"reality-check\",\"version\":$NOTED_VERSION}" \
     http://localhost:$PORT/status

# 2. Facts, not judgment. --paths carries the files/directories the concept
#    actually names; the script returns everything either way.
node "{plugin-root}/scripts/concept-drift.js" \
     --state "{project-root}/.claude/concept-active.json" \
     --paths "plugins/devops/hooks,plugins/devops/skills/concept/SKILL.md"
```

A 409 on step 1 means a newer submission landed while we were picking this one
up — abandon the check and loop back to Step 5a with the new payload. Do not
carry a verdict across submissions.

**What goes into `--paths`:** every file and directory the concept commits to
touching — the ones named in the variants the user kept, in their comments, and
in the plan you are about to implement. Directories are fine and preferred when
the concept talks about an area rather than a file. Err wide: a path too many
costs a cheap comparison, a path too few hides the drift this gate exists for.
Omitting `--paths` entirely is legitimate for a concept that names no paths at
all — the script then returns `candidates` with the full change list and the
force classes are applied to that by hand, rather than pretending the absence
of a filter means the absence of drift.

`concept-drift.js` is deliberately incapable of forcing a round. It resolves the
default branch without assuming it is called `main`, fetches with a timeout,
diffs baseline..tip, and returns commits, changed paths (renames contribute
*both* sides) and the intersection with `--paths`. Every failure it can hit —
no repo, no remote, no `origin/HEAD`, git missing, offline, shallow clone, a
baseline erased by a force-push — comes back `verdict: "skip", safe: true`.
**A network hiccup must never block an implement order.**

## Force classes

The whole judgment reduces to one question:

> Would implementing exactly as designed now produce code that is **wrong, dead
> or duplicate**?

Only then. Applied to `candidates`:

**Must force** — each of these on its own is enough:
1. A file, module or symbol the concept names was **deleted, renamed or moved**.
2. A contract the concept builds on **changed**: a function signature, a hook
   event name, a JSON/schema shape, a CLI flag, a template placeholder, a
   validation-gate entry, an endpoint's payload.
3. The functionality **already exists** — someone landed the same intent in the
   same artifact.
4. A decision the user already made has **lost its basis** (the variant they
   picked is gone, the file they chose to extend no longer exists).

**Never force** — regardless of commit count:
- no intersection with anything the concept references;
- version bumps, CHANGELOG, docs, tests-only changes, formatting, dependency
  patches, reverts that net out to zero.

**Mention, do not force:** neighbouring changes that break no contract, new
reusable helpers the implementation could now use, convention updates. These
belong in the final report's *Zusammenfassung* / *Nächste Schritte*, not on the
page. Interrupting an implement order for a nicety is how a safety feature turns
into a nuisance.

**Evidence is mandatory.** Every drift card names the short SHA and the path it
comes from, rendered in the section's `.reality-evidence` block. No SHA, no
card, no force. A claim the user cannot verify is a claim they have to take on
trust, and this round exists precisely because trust in the plan has become
questionable.

## The forced round

Mechanically an ordinary iteration — Step 5c in full: freeze the previous
section, run the append checklist (`iteration-rules.md` § Iteration append
checklist, including the `GET /draft` confirmation that the round's comments are
safe on the bridge), `/reload`, then `/reset`, then re-launch the pickup waker.
It is not a special case of the append; it is an append that happens to carry a
marker.

What differs:

- `<section data-iteration="N+1" data-reality-check data-reality-head="<sha>"
  data-active>` and a matching tab carrying `data-reality-check` with the label
  `{{iteration.reality_tab}}` — never "Iteration N+1". The markers go on the
  section and the tab, and nowhere else; in particular never inside a block that
  § 2.6's engine-drift re-sync copies verbatim from `templates.md`, which would
  overwrite them.
- `data-reality-head` is the commit the check examined. It is what the baseline
  advances to when this round is answered, and keeping it on the round rather
  than only in a checkpoint means a resumed session that never watched the check
  run can still advance correctly.
- **Read the file back after writing it** and confirm both attributes are
  present on the new section before posting `/reload`. The append is a
  hand-written HTML rewrite; a marker that silently failed to land re-arms a
  check the user has already answered, and nothing else in the pipeline would
  notice.
- The section opens with the `.reality-banner` explainer (`templates.md`
  § Reality-check section explainer): headline, what landed, the commit
  evidence, and the reassurance that the implement order still stands.
- Both submit buttons behave exactly as everywhere else. **No third button.**
  "Implement anyway, ignore the drift" is every card on Verwerfen plus the
  implement button; "this concept is obsolete" is Claude's own recommendation
  on a class-3 card, which the user accepts by submitting.

**Never POST `phase: "implemented"` on this path.** No code was written. The
panel would show "Implementierung abgeschlossen" over an empty diff, and the
user would believe the work shipped.

### Completeness — what "all important decisions" forbids

The round is generated from **one** completed diff pass. Before rendering it,
the analysis is finished; nothing is left to look up later. Concretely, the
following are forbidden in a reality-check round:

- any card that says "we'll clarify this in the next round";
- conditional cards ("if you pick A, we'll ask about B") — flatten them, every
  card independently answerable, each with Claude's recommendation;
- a card whose answer depends on another card of the same round;
- a catch-all "other open points" card.

If Claude discovers a new question *during* the subsequent implementation, it
does not go back to the page. It is decided, documented in the final report, and
routed to a follow-up issue via the close-out wizard.

## Baseline

Stored in `.claude/concept-active.json` — deliberately **not** in the HTML,
which the engine-drift re-sync rewrites:

```json
"baseline_ref": "main",
"baseline_sha": "4f2a1c9e77b3",
"baseline_captured_at": "2026-09-06T10:00:00.000Z"
```

It records the **remote** tip, so it stays valid no matter which checkout or
worktree the session runs in — the state file lives at the project root while
the session may well be working inside a worktree.

Captured at concept open (Step 3), and advanced by:

```bash
node "{plugin-root}/scripts/concept-drift.js" --capture \
     --state "{project-root}/.claude/concept-active.json" --sha <advanceTo>
```

**Advance it on every submission of a reality-check round — iterate as well as
implement — and after every check that came back clear.** `--sha` pins exactly
the commit the check examined (`advanceTo` from the script, and afterwards the
round's own `data-reality-head`), so commits that landed *during* the round are
still unexamined and can legitimately raise a later check.

Getting this wrong is the one way the feature can feel like a loop: leave the
baseline behind and a user who answers the drift cards, runs one ordinary
iterate round, and then clicks implement is handed the same, already-answered
cards a second time. Decisions the user has made are final and are never asked
again.

## Checkpoints and resume

A forced round produces no externally-visible artifact, but it **consumes** an
implement submission — so it is exactly the kind of state a resumed run cannot
reconstruct. Checkpoint it **before** the HTML write:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"action":"implement","step":"reality-check-forced","status":"done",
       "version":<noted _version>,
       "artifacts":{"baseline":"4f2a1c9","head":"9be03d1","items":3}}' \
  http://localhost:$PORT/progress
```

Use `reality-check-clear` for a check that let the implement through, and
`reality-check-skipped` with the script's `reason` for a fail-safe skip.

On resume, `GET /recovery` disambiguates the three states that otherwise look
identical from the outside:

| progress shows | What actually happened | Do this |
|---|---|---|
| nothing | the check never ran | run Step 0 normally |
| `reality-check-forced` | the round was decided; the HTML write may or may not have landed | read the page — marker present ⇒ done, absent ⇒ re-append from the recorded verdict. **Never re-decide** |
| `reality-check-clear` \| `-skipped` | the check passed; implement may be half-written | verify the artifacts (`git rev-parse`, `gh pr view`, read the files) and continue implementing from what you observe |

This also amends the equal-`_version` rule in SKILL.md § 5d. "Equal version on a
live `/pending` means the previous `/reset` never landed, so retry the reset" is
correct *unless* a reality-check checkpoint sits on that version — in which case
the previous run died mid-round and the reset was never due. Consult
`/recovery` before applying the shortcut; resetting there would silently
discard the user's implement click.

## Timing

The check adds work between pickup and the first code write, which is the window
the panel's stale-restore watches. That is why `POST /status
{phase:"reality-check"}` happens *first*, before the fetch: the user sees the
step, the page stays coherent, and a re-submission during the check surfaces as
a clean 409 rather than a second forced round.

The `git fetch` and everything after it are capped (`--timeout`, default 30 s).
A check that cannot finish inside its budget is a check that returns `skip`.
