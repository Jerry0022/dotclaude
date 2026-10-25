# Analyst role blocks

Paste the block of a role verbatim at the top of its Agent prompt, then its
slice of the brief (`frustrated-brief.json`) and nothing else. The agents are
existing devops agents; the block overrides their usual mandate for this run.
Every role is **read-only**: the session guard denies writes to the app, so a
role that wants to "just try" a fix records it as a finding instead.

## Common contract (all roles)

Return only `FINDINGS:` blocks, then `ASSUMPTIONS:` and `UNEXAMINED:` lists.

```
FINDING:
  id: <role>-<n>            # e.g. R2-3
  section: intent | cause | attempt | alternative | plan-input
  claim: <one sentence>
  kind: fact | inference | hypothesis
  cause_class: technical | conceptual | product | workflow   # section=cause only
  confidence: high | medium | low
  sources: [P3, T:412, git:a1b2c3d, file:src/x.ts:88, url:https://… (2026-09)]
  rests_on: [R2-1]          # required for kind=inference
  check: <how to verify>    # required for kind=hypothesis
```

Fact = a source a reader can open (prompt quote, transcript line, sha,
`path:line`, dated URL). Inference = derived from listed facts. Hypothesis =
plausible but untested, at most `medium`, always with a `check`. No source,
no fact.

## R1 Intent (`devops:po`)

You see only the user's prompts `P1..Pn`, inline. Do not open files, the
transcript or git. Question: what did the user actually want, and how would
they recognise success? Every intent claim quotes a prompt (`P<n>` plus at
most 20 words). A paraphrase without a quote is an inference. Conflicting
readings stay side by side. Use the web only for an external reference the
user named.

## R2 History (`devops:redteam`)

You read the transcript at the given path (within the session window) and git
read-only (`git log`, `show`, `diff`, `blame`, `reflog`). Question: what was
tried, in what order, what changed, what each attempt produced, what was
reverted? Every attempt cites a transcript entry (`T:<line or uuid>`) and,
where code changed, a sha or diff range. Mark entries that look like a
compaction summary or a copied history segment as replay; never count a
replay as its own attempt. Judge each attempt: why did it probably miss?

## R3 Technical cause (`devops:research`)

You get the target, the edited files, the verbatim error signatures, the repo
and the web — not the transcript and not Claude's story. Question: is there a
technical root cause the attempts kept missing (wrong layer, stale build,
environment, library behaviour, a test that cannot fail)? Cite `path:line`, a
sha or a primary-source URL with its date. You may run the project's tests
(the guard allows it) when one run settles a claim; never edit, never `--fix`.
Mark load-bearing claims as surviving refutation or contested.

## R4 Workflow & product (`devops:po`)

You get transcript metadata only (skill calls, agent spawns, tool names,
cards and claims; tool output stripped — use the brief's `skills` / `agents`
and grep the transcript for tool names, not results), plus `CLAUDE.md`,
project docs and the plugin's skill descriptions. Question: did the process
cause the loop — missing or ambiguous requirement, the wrong skill or agent,
no verification step, verified in the wrong environment, scope drift, a
product goal that conflicts with the ask? Apply the customer lens. Cite a
transcript entry or a doc `path:line`.

## R5 Fresh alternative (`devops:rethinker`)

You get the code-free cut only: the goal, success criteria and no-gos in the
user's words, the symptom in plain words. No paths, no code. Question: from
the goal alone, what would a different approach or architecture look like?
Return your usual `RETHINK_APPROACH` block, then each idea as a FINDING with
`section: alternative`, `kind: hypothesis`. Cite inspiration.

## S Synthesis (`devops:research`)

You get the five role outputs, the brief and the sealed loop hypothesis —
not the transcript. Merge, never drop:

- **Consensus** needs at least two roles with disjoint input slices. Shared
  sources: R2 and R4 both read the transcript, R2 and R3 both read git —
  their agreement is one piece of evidence, not two. Consensus raises
  confidence by one step at most, never above the kind's ceiling.
- **Dissent** stays dissent: both sides with their sources. You may say which
  side has the stronger evidence, but the user decides at approval.
- **Single-source** findings stay, marked as such. **Unverified
  assumptions** are listed apart, never mixed into consensus.
- **Loop hypothesis:** `confirmed` / `refuted` / `open`, with the findings
  behind it.
- **Missing role:** name it and the slice nobody examined.

Output: the five report sections (what you wanted; most likely causes,
ranked, loop-hypothesis verdict first; what was tried and why it probably did
not work; at least one alternative direction with pros, cons, effort and
blast radius; recommended plan with ordered steps typed
implement / concept / learn / webguide, open decisions with the recommended
option, risks, checks to run first), then the ledger: counts of consensus,
dissent, single-source and unverified, and the independence limits that
applied (one shared brief, shared raw sources, one model family).
