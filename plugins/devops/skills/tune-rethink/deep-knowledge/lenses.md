# Rethink Lenses — Fresh-Phase Prompt Blocks

Used by `/tune-rethink` Step 4. Each `devops:rethinker` agent receives the
full Rethink Brief plus exactly ONE lens block below. The lens focuses the
agent's divergence — three agents with the same prompt produce three similar
answers; three agents with different lenses produce genuinely different ones.

## Shared prompt scaffold

Compose each agent prompt as:

```
[role:rethinker · Ideation] <lens> approach for <target>

You are rethinking <target> from scratch. You have deliberately NOT been
given the current implementation — do not ask for it, do not assume its
structure. Everything you know is in this brief:

<full Rethink Brief text>

<lens block — one of the four below>

Return exactly one RETHINK_APPROACH block (format at the end of this prompt).
Stay inside the demolition corridor from the brief. If your single best idea
exceeds the corridor, you may return it anyway — but set blast_radius
honestly so it gets flagged as an outlier.
```

## Lens: product-value

```
LENS: product-value (the PO view)
Own this question: what is the SIMPLEST thing that fully reaches the goal?
- Judge every idea against the success criteria in the brief, nothing else.
- Cut scope aggressively: which parts of the stated gap actually matter to
  the outcome, which are decoration?
- Prefer one sharp core mechanism over three mediocre features.
- Name explicitly what you would NOT build and why that is acceptable.
```

## Lens: ux-design

```
LENS: ux-design (structure and visual direction)
Own this question: what structure, flow, and visual idea makes the target
feel coherent and obvious?
- Propose the information architecture and screen/section flow from zero.
- Give a concrete visual direction (layout pattern, hierarchy, density,
  one signature design idea) — not a token-level style guide.
- Design for the success criteria and the frustration named in the brief.
- WebSearch for current best-practice patterns of this kind of surface is
  encouraged; cite what inspired you.
```

## Lens: enduser-feel

```
LENS: enduser-feel (journey and friction)
Own this question: does it feel good — from first contact to goal reached?
- Walk the user journey step by step as a first-time user AND a daily user.
- Hunt friction: waiting, confusion, dead ends, needless decisions.
- Name the emotional beat of the experience (confidence, delight, control)
  and how the approach produces it.
- Judge against the "biggest frustration" from the brief — your approach
  must visibly kill it.
```

## Lens: architecture (backend-only swap)

Used instead of `enduser-feel` when the target has no UI surface in scope.

```
LENS: architecture (boundaries and data flow)
Own this question: what module boundaries and data flow make this simple,
testable, and hard to break?
- Propose the component split and ownership from zero — ignore how it is
  cut today (you don't know anyway).
- Trace the main data flow end to end; name every boundary it crosses.
- Optimize for: fewest moving parts that still meet the success criteria,
  clear failure isolation, easy verification.
```

## Output contract — RETHINK_APPROACH

Every rethinker returns exactly this block:

```
RETHINK_APPROACH:
  lens: product-value | ux-design | enduser-feel | architecture
  title: <3-6 word name for the approach>
  core_idea: <2-4 sentences — the one idea that makes this approach work>
  structure: <bullet sketch of the parts/screens/modules and how they connect>
  why_it_reaches_the_goal: <map to the brief's success criteria, point by point>
  kills_the_frustration: <how the brief's biggest frustration disappears>
  not_built: <what is deliberately left out, one line each>
  blast_radius: rework | section-rewrite | new-approach
  inspiration: <optional — external patterns/products found via WebSearch>
```

Rules for the orchestrator (Step 5):
- `blast_radius` is the agent's estimate from the brief alone; re-label it
  against the actual codebase during reconciliation (in-corridor /
  over-corridor).
- Do not average approaches into mush. If two are near-identical, merge
  them; otherwise keep them distinct on the concept page.
