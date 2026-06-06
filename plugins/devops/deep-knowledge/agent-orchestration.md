# Agent Orchestration

> **Single-Source-of-Truth for test autonomy decisions:** see [test-autonomy.md](test-autonomy.md).
> This file retains Agent wave model + QA testing protocol.

Shared orchestration logic for agent selection, prompting, and wave execution.
Referenced by `/devops-agents` and `/devops-autonomous`.

## Agent Selection

Select agents based on domains touched, complexity, and risk:

| Agent | When to include | Wave |
|-------|----------------|------|
| **research** | Topic needs investigation first | 0 (pre-work) |
| **core** | Business logic, APIs, data models | 1 |
| **frontend** | UI components, templates, styling | 2 |
| **windows** | Platform-specific (system tray, native APIs) | 2 |
| **ai** | AI/ML integration, embeddings, prompts | 2 |
| **designer** | UX/UI decisions, design system, specs | 0 or 2 |
| **qa** | Unit tests, build check, browser-based visual verification | 3 |
| **po** | Requirements validation, trade-off review | 4 |
| **gamer** | End-user/player perspective | 3 or 4 |

### Selection Criteria

- Include an agent only if it adds **concrete value** — not for coverage
- Prefer fewer agents with clear purpose over many with vague roles
- Always include **qa** for any code changes (Wave 3)
- Include **po** only for feature-level work, not bugfixes or refactoring

### Model & Effort Defaults

Each agent defines `model` and optionally `effort` in its frontmatter.
The orchestrator can override `model` at invocation time but **not** `effort`.

| Agent | model | effort | Notes |
|-------|-------|--------|-------|
| **po** | opus | high | Strategic decisions — needs deep reasoning |
| **research** | opus | high | Cross-referencing, fact verification |
| **core** | sonnet | *(default)* | Standard code generation |
| **frontend** | sonnet | *(default)* | Standard code generation |
| **ai** | sonnet | *(default)* | Standard code generation |
| **windows** | sonnet | *(default)* | Standard code generation |
| **designer** | sonnet | *(default)* | Design specs |
| **qa** | sonnet | *(default)* | Test execution + evaluation |
| **gamer** | sonnet | *(default)* | Quick UX feedback |
| **feature** | inherit | *(inherit)* | Inherits from parent session |

**Model override rules:**
- Override `model` at invocation for cost control: `Agent({ subagent_type: "research", model: "sonnet", ... })`
- **Never downgrade to haiku** for agents with `effort: high` (po, research) — haiku + high effort wastes tokens without quality gain
- Upgrading to opus is fine for any agent when task complexity warrants it

### Complexity Tiers

| Tier | Signals | Strategy |
|------|---------|----------|
| **Simple** | Single domain, < 5 files, clear scope | Work directly, no sub-agents |
| **Medium** | 2 independent domains, no cross-deps | 2-3 parallel agents for independent domains |
| **Complex** | 3+ domains, cross-cutting, or high risk | Full agent roster with wave model |

**Effort budget per agent** (Step 4 of the prompt template — embed it, scaled to
tier). Anthropic's multi-agent work found over-investment on simple queries to be
a primary failure mode; coding has *fewer* parallelizable parts than research, so
budget tightly:

- **Simple** → no sub-agent; handled inline.
- **Medium** → ~5–15 tool calls per agent, one focused domain, no exploratory sprawl.
- **Complex** → ~15–30 tool calls per agent; beyond that, report a scope-cut or
  sub-split rather than grinding on.

These are guide rails, not hard limits — the point is that an agent which blows
past its budget **pauses and reports** instead of disappearing into a long,
unsupervised tail. Reserve large fan-out (many agents) for genuinely
breadth-parallel work; most coding tasks do not need it (15× token overhead).

## Wave Execution

Follow the wave model from `agent-collaboration.md`. The execution mechanics below
apply regardless of whether the caller is interactive or autonomous.

### Agent Prompt Template

Every spawned agent MUST receive:

1. **Parent branch name** — for branch inheritance protocol
2. **Task description** — specific to their role, not the full user request
3. **Context from previous waves** — handoff data (contracts, findings, decisions)
4. **Commit instruction** — follow commit conventions from `/devops-commit`
5. **Interaction directive** — set by the calling skill (see below)
6. **Effort budget** — a tool-call / scope ceiling scaled to the complexity tier
   (see § Complexity Tiers). Counters the "over-investment on simple work" failure
   mode. An agent that hits its budget **pauses and reports** a scope-cut or
   sub-split — it does not silently grind past it.
7. **Stopping criteria** — an explicit "you are done when …" so the agent stops at
   sufficiency instead of polishing endlessly. Endless work is token burn and, in
   autonomous mode, a wedge risk. State the concrete done-signal (tests green +
   contract exported, finding answered, etc.).
8. **Distinct scope boundary** — for parallel agents in the same wave, state what
   each one **owns and does NOT touch**. Vague sub-tasks are the #1 cause of
   duplicate work; two agents must never independently solve the same thing.

### Interaction Directives

The calling skill sets the interaction mode for all spawned agents:

| Mode | Directive |
|------|-----------|
| **Autonomous** | "Work autonomously. Do NOT use AskUserQuestion. Make reasonable decisions independently. Document all decisions in your commit messages." |
| **Background** | Same as Autonomous |
| **Interactive** | See § Interactive Mode — Engagement Rules below. Pass the full rule block as the agent's interaction directive. |

### Interactive Mode — Engagement Rules

The user chose interactive because they want to shape the work, not just receive
it. Default to involving them; silent execution is the exception. Their reason
for picking interactive is usually that the task has **2+ conceptual forks**
across the run OR one fork too large / multi-dimensional to settle textually —
otherwise they would have picked background. Match that expectation: even though
the operational floor below is "≥1 checkpoint per wave", a fully silent
orchestration is almost certainly wrong for interactive mode.

**Precedence rule — what counts as a checkpoint:**
Ask for **user-visible** decisions and **plan-shaping conceptual forks**
(architecture pattern, contract shape between waves, scope cuts, public naming,
strategy picks). Proceed **silently** on implementation details once the
shaping decisions are fixed (variable layout, internal helper names, file order,
library minor versions, code style choices already covered by conventions).

**Operational floor — at least one checkpoint per wave** (not per agent), unless
the wave is mechanically unambiguous (apply a known refactor pattern, fix an
explicit bug, run tests, mechanical rename). With multiple agents in one wave,
one shared checkpoint covers the wave — don't fan out the same question per
agent.

**Reporting silence:**
- **Sub-agent** — if you genuinely have no fork worth asking about, state that
  in your return / handoff: `"no conceptual forks — proceeded directly"`.
- **Orchestrator** — aggregate these signals into the wave summary so the user
  can see the silence was intentional, not laziness.

**Use `AskUserQuestion` for lightweight, in-chat decisions:**
- Mode / strategy picks with 2–4 named alternatives
- Naming the user will see (commands, labels, public API names, file names exposed
  in UI)
- Trade-offs with a clear axis (speed vs. flexibility, strict vs. permissive,
  inline vs. extracted)
- Ambiguous requirements where one short clarification unblocks 30+ minutes of
  work
- Scope cuts (do X now, defer Y? include Z or skip?)

**Use `/devops-concept` instead when:**
- 3+ design alternatives need side-by-side comparison with pros/cons
- A UI/UX layout decision benefits from a visual mockup (prototype template)
- An architecture or strategy choice has multi-dimensional trade-offs
  (decision template)
- Multiple related decisions cluster on the same topic — bundle them on one page
  rather than firing 3+ separate `AskUserQuestion` prompts
- The artefact would be hard to describe textually in <10 lines, or benefits from
  toggles/comments the user can leave on individual items
- Scenarios need to be sketched out (state A → action → state B) and compared

**Skip the question only when:**
- The answer is forced by the codebase, an existing convention, or the prompt
  itself
- The user already answered the same (or equivalent) question earlier in the
  session
- Asking would feel like nagging on a trivial choice (import order, internal
  helper name, file location inside an obvious folder)

**Phrasing rules:**
- Lead with your recommendation as the first option, labeled `(Recommended)`,
  followed by 1–3 alternatives
- Never ask open questions ("What do you think?", "How should we do this?") —
  always give choices
- Always explain your reasoning inline before/after the question, never decide
  silently

### Spawning Mechanics

For each wave:

1. **Spawn agents** — parallel within the same wave, sequential across waves
2. **Isolation** — each agent works in an isolated worktree (`isolation: "worktree"`)
3. **Background agents** — use `run_in_background: true`
4. **Foreground agents** — wait for completion before next wave
5. **Collect results** — gather handoff data before spawning next wave

### Single-Agent Shortcut

If only 1 agent is selected (e.g., just research or just qa):
- Skip branching strategy entirely
- Launch the agent directly with full context
- Autonomous/background: `run_in_background: true`
- Interactive: foreground with inline questions

## Inter-Wave Verification Gate

Cascading errors are the dominant multi-agent failure mode: a wrong contract or a
hallucinated "fact" from one wave propagates unchecked into every wave that builds
on it, and surfaces only at the end — or never. QA at Wave 3 is **too late**; by
then two or three agents have already reasoned from the bad output. Independent
verification before the next consumer is the single most underused reliability
mechanism in multi-agent systems.

**Rule: verify each wave's handoff before the next wave consumes it.** Scale the
check to risk:

- **Low risk** (additive, disjoint files): a lightweight self-check — the
  orchestrator reads the handoff (contracts, signatures, findings) and confirms it
  is internally consistent and matches what the next wave was told to expect.
- **Contract-defining waves** (Core → Frontend/Windows/AI): before spawning the
  dependent wave, validate the contract concretely — types compile, exported
  signatures match the handoff, no TODO stubs where the next wave expects real
  APIs. A mismatch here is exactly what cascades.
- **High risk** (security, migration, breaking change, 3+ dependents): spawn the
  `redteam` agent as an explicit inter-wave gate. It returns concrete file/line
  risks the next wave must fold in **before** that wave starts — not after.

Treat a handoff claim as **data to verify, not fact to trust**: a finding like
"the API already returns X" gets a 10-second check against the code, not blind
reuse (this is how memory pollution turns one agent's hallucination into the
team's shared assumption). This is the cheapest place to stop an error — the cost
rises with every wave it survives.

**Verify handoff *durability*, not just handoff content.** The content checks
above assume the prior wave's commits are still in the working tree. That is not
guaranteed: a between-wave working-tree reset can silently erase them — observed
when a background-agent spawn triggers a worktree re-sync that does
`git reset --hard origin/<base>`, but equally possible from a CI reset, an
accidental `git reset`, or a junction/worktree refresh. The next wave then runs
on a tree **missing the prior wave's files** and re-invents (or stubs with
`as any`) work that was already committed. Two cheap guards, both mandatory
before a wave consumes the prior wave's handoff:

1. **Push, don't just commit.** A local-only commit is not durable against a
   reset. After each wave, `git push -u origin <integration-branch>` so the work
   survives in `origin` and is recoverable.
2. **Re-assert HEAD.** Confirm the expected commit is still reachable:
   ```bash
   git log --oneline -1            # is this the wave-N commit you expect?
   git merge-base --is-ancestor <expected-sha> HEAD || echo "✗ HEAD diverged"
   ```
   If HEAD diverged, restore before proceeding — `git reset --hard origin/<integration-branch>`
   (work was pushed in guard 1), or recover dropped commits from `git reflog` +
   `git checkout <sha> -- <paths>`. Never let a wave start on a tree that lost a
   prior wave's output.

If the environment is prone to between-wave resets, prefer **inline (foreground)
wave handoffs** over background-agent spawns — a foreground handoff has no
spawn-triggered refresh window.

## QA Wave — Testing Protocol

The QA agent (Wave 3) MUST follow these testing rules. Include ALL applicable
instructions in the QA agent prompt.

**1. Unit/Integration Tests**
Run relevant test suites via Bash (`npm test`, `npm run test:unit`, etc.).
Target specific test files for changed modules — see `deep-knowledge/test-strategy.md`.

**2. Build Verification**
Run the build command (`npm run build` or equivalent) to verify compilation succeeds.

**3. Browser-Based Visual Verification — MANDATORY for Web Tech**

See `deep-knowledge/test-strategy.md` § Web Tech → Always Browser-Test.
If any web-tech gate signal is true (HTML/CSS/JS framework files changed, UI dep
in `package.json`, static `index.html` present) → browser verification is
**required**, mocks are expected. No "browser not needed" exit for web tech.

- **Orchestrator** (before spawning QA): probe the browser tool waterfall from
  `deep-knowledge/browser-tool-strategy.md` (Chrome MCP → Playwright → Preview).
  Set `$BROWSER_TOOL` to the first responder. If Preview is selected, start a
  server via `preview_start` and capture `$SERVER_ID`. If no dev server exists,
  fall back to opening static HTML via `file:///`.
- **QA agent** uses whichever tool the orchestrator selected:
  - Chrome MCP: `computer` (screenshot), `read_page`
  - Playwright: `browser_take_screenshot`, `browser_snapshot`
  - Preview: `preview_screenshot`, `preview_snapshot` (pass `serverId`)
- All three are DOM/protocol-based — no desktop takeover, no user interruption.
- Skip only for genuinely non-UI changes (pure config, scripts, docs, backend-only).

**4. Electron / Native UI — Dev-Browser + User-Final-Test**

See `deep-knowledge/test-strategy.md` § Electron / Native UI.
Renderer-level verification happens via rule 3 (mount renderer HTML in Edge, mock
main-process calls). Final integration test on the packaged app requires
`computer-use` — **only** if the user chose "Desktop übernehmen", otherwise QA
flags the completion card with `🔬 TESTE bitte noch:` plus concrete
steps. Never claim an Electron/Tauri change "verified" based on dev-browser mocks
alone.

**5. Third-Party Integrations — Mock-First + User-Final-Test**

See `deep-knowledge/test-strategy.md` § Third-Party Integrations.
Any code calling external services (OAuth, payments, social APIs, webhooks,
analytics, LLM APIs) follows two mandatory steps:
1. Automated mock test (MSW/nock/fixtures) — verifies integration shape.
2. Real test — flagged in completion card as
   `🔬 TESTE bitte noch:` + bullet with `— nach Deployment` suffix.

The mock step is **not** a substitute for step 2. Both are required.

**6. Computer-Use Restriction — HARD RULE**

**NEVER** use computer-use (`mcp__computer-use__*`) for testing unless the user
**explicitly** requested desktop takeover (e.g., "Desktop übernehmen", "use
computer-use", "nimm den Desktop", "desktop testing") — with the single exception
of the packaged-Electron final test (rule 4) when desktop mode is active.

Browser-based testing via the waterfall tools is always allowed and runs in the
background. Computer-use is the **only** testing method that requires explicit
user opt-in.

**QA Agent Prompt — Append These Instructions:**
```
Test the changes (follow deep-knowledge/test-strategy.md):
1. Run unit/integration tests for changed modules
2. Run the build to verify it succeeds
3. [If web tech] Use {$BROWSER_TOOL} to verify changed views — snapshots preferred,
   screenshots for layout/styling. Mocks for missing backends are expected.
4. [If 3rd-party integration] Mock the external calls in automated tests, THEN
   add a userFinalTest item with afterDeployment: true and a concrete action.
5. [If packaged Electron/Tauri without desktop takeover] Renderer tests via step 3;
   add a userFinalTest item (afterDeployment: false) with a concrete action.
6. Do NOT use computer-use unless desktop takeover is explicitly active.
7. Report results as:
   - tests: [{ method, result: "pass" | "fail — reason" }]
   - userFinalTest: [{ action, afterDeployment? }]  // forwarded to render_completion_card
```

**Orchestrator handoff:** When the QA agent returns `userFinalTest` items, pass
them through to `render_completion_card` as the `userFinalTest` input so the
completion card displays the unified `🔬 TESTE bitte noch:` block.
Never drop this field — it's the only signal the user sees about work that
automation couldn't cover.

## Branch Strategy

See `agent-collaboration.md` § Sub-Branch Strategy and § Branch Inheritance Protocol.
The orchestrator (calling skill) is responsible for:

1. Creating the integration branch if not already on a feature branch
2. Pushing it to origin before spawning sub-agents
3. Merging each wave's branches back before spawning the next wave — then
   **pushing the integration branch again** (`git push origin <integration-branch>`)
   so the merged-back work is durable before the next wave spawns. A reset
   between waves can only lose what was never pushed (see Inter-Wave Verification
   Gate § handoff durability).
4. Shipping the integration branch ONCE at the end — sub-branches are merged back (step 3), not shipped individually. Sub-branch names are dash-joined `<parent>-<role>`, never slash-nested (a slash collides with the checked-out integration branch's ref).
