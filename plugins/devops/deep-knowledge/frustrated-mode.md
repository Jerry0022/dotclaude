# Frustrated Mode (alpha)

Gated feature `frustrated-mode` (`features.json`, minChannel `alpha`). On beta and stable nothing of it is visible: no hook, no skill alias, no doc.

## What it is

When a session looks stuck (repeated failed attempts, the user's growing frustration), Claude notices it, offers a way out, and only acts after the user agrees.

## Flow

detect -> offer -> read-only analysis -> plan -> approval -> hand-off

1. **Detect** - an alpha-only UserPromptSubmit hook (`prompt.frustrated.detect`) flags the signal and injects context telling Claude to offer the analysis. Claude itself judges from the transcript whether the session is really stuck.
2. **Offer** - one question, never an automatic start. Earlier sessions are read only after an explicit yes.
3. **Read-only analysis** - the `auto-frustrated` skill (entry on yes: `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md`; also the explicit slash command). Tests may run and test artifacts, snapshots and caches may be written; the app's source and config must not change.
4. **Plan** - presented by the existing concept-vs-card rules: non-trivial -> `/auto-concept` page, trivial -> inline text above the completion card.
5. **Approval** - any interpretable yes in the next prompt, no fixed phrase.
6. **Hand-off** - preset run or fix; it never ships and never asks to ship (only a concept close-out sheet may include a ship choice).

## Config

| Key | Default | Meaning |
|---|---|---|
| `frustratedMode.suggest` | `true` | `false` silences the prompt detector: no stuck-session notice reaches Claude, nothing is offered. The explicit slash entry stays available. Set with `/devops-config` or in `.claude/devops-config.json` (project) / `~/.claude/devops-config.json` (global). |

## Detector log

`~/.claude/devops-frustration.log` holds one marker line per non-silent verdict
(time, short session id, `suggest` or `band`, rounds, score, signal markers such
as `T1s`/`T2`) and never any prompt text. Every append cuts the file back to its
newest 300 lines, so the cleanup runs with the log itself. It goes with the feature when Frustrated Mode graduates or is dropped. `scripts/frustration-replay.js
<transcript.jsonl|dir>` replays transcripts through the scorer for tuning.

## Session flag

The detector keeps per-session state in the temp dir (2 h expiry).
`isSessionFlagged(sessionId)` from `hooks/lib/frustration-state.js` answers
"is the session flagged right now" (>= 3 rounds, score >= 6, not snoozed).

## Plan record and approval recorder (`run-contract.js plan …`)

The frustrated analysis ends in a plan. The plan is recorded beside the run contract (`<project>/.claude/run-contract.plan.json`), and nothing executes until the user's approval of exactly that plan is recorded. A pending record is inert: "Nur Analyse" is the default, silence is never approval. Code: `hooks/lib/run-contract-plan.js`, CLI in `hooks/lib/run-contract-cli.js`. All subcommands exit 126 (`{"ok":false,"disabled":true,"error":"not available"}`) when the `frustrated-mode` feature is off.

Always pass `--cwd` from a script or smoke test; a bare call acts on this session's live project.

| Call | Does | Output (JSON, one line) |
|---|---|---|
| `plan record [--file <plan.json>] [--id <fm-id>] [--from-concept-closeout]` (plan JSON on stdin when no `--file`) | Hashes the canonical plan, writes a `pending` record with a 2 h expiry | `{ok, recorded, plan:{id,version,hash,short,state,recordedAt,approvedAt,expiresAt,fromConceptCloseout}, display:"fm-… v1 · 3f9a1c2e"}` |
| `plan approve --id <fm-id> --hash <hash\|short>` | Records the approval after checking id, hash (8+ hex chars), expiry; replaces a running other contract | `{ok, approved, plan, replaced:{id,mode,flow,armedAt}\|null}`; on refusal `{ok:false, approved:false, error}`, exit 1 |
| `plan status` | Current record, and the contract an approval would replace | `{ok, active, plan\|null, steps, wouldReplace:{…}\|null}` |
| `plan clear` | Removes the record | `{ok, cleared}` |

Plan JSON: `{direction, steps:[{n, type: implement|concept|learn|webguide, goal, objects, payload}], out_of_scope, decisions, checks, base}`, at most 16 KB. The hash (sha256, keys sorted, strings NFC and whitespace-collapsed) covers the content only, never `id`, `version` or timestamps. Recording again under the same id with changed content raises `version` and drops an earlier approval; identical content keeps version and approval.

Rules:

- **Approval is any interpretable yes** in the user's next prompt (no fixed phrase). Claude judges the prompt, then calls `plan approve` with the id and hash it showed. The recorder only verifies id/hash/expiry; it does not read the prompt.
- **Announce the replacement.** Call `plan status` before asking: `wouldReplace` names a running contract that the approval will close (aborted, reason `replaced by approved plan …`). A refused approval leaves it untouched.
- **Own expiry.** The plan record expires 2 h after recording (and 2 h after approval), independent of the contract's expiry. An expired record is removed on read; approving it fails.
- **Never ships.** A step of type `ship`/`release`/`merge`/`push`/`deploy` (or `ship: true`) is rejected by `record`, and by `approve` for a hand-edited record, unless `--from-concept-closeout` was given. The plan path never arms a contract or a ship step itself.

## Guard (`pre.frustrated.readonly`)

While an analysis runs, the session's guard marker is armed
(`os.tmpdir()/dotclaude-devops-frustrated-guard-<session_id>`, 2 h expiry of
its own). Subagent hook payloads carry the parent's `session_id`, so the guard
covers the main thread and every analyst; frontmatter `tools:` is only defence
in depth. Code: `hooks/lib/frustrated-guard.js`, CLI `scripts/frustrated-guard.js arm [--target …] | disarm | status`
(session from `--session` or `$CLAUDE_CODE_SESSION_ID`; the hook applies `arm` / `disarm` itself; a subagent cannot disarm).

| Allowed while armed | Denied (exit 2, with the reason) |
|---|---|
| Read / Grep / Glob / web / Agent spawns | Edit / Write / NotebookEdit / MultiEdit of the app's source or config |
| git read commands (`log`, `show`, `diff`, `blame`, `status`, `branch --list`, …) | git that changes the repository (`commit`, `checkout`, `reset`, `stash`, `push`, `branch -D`, …) |
| tests, lint, typecheck (`npm test`, `npm run test:*`, `vitest`, `pytest`, `go test`, …; snapshot updates included) | `--fix` / format / install / migrate runs, `node -e`, any other command |
| writes into the temp dir / scratchpad, `.claude/` state, `~/.claude/` state, snapshots, coverage, caches, test reports, concept pages (`docs/concepts/`) | `.claude/settings*.json`, `devops-config.json`, `CLAUDE.md`, `.claude/{agents,skills,commands,hooks,worktrees,plugins}/` |
| plugin scripts `feature-flag.js`, `run-contract.js`, `frustrated-guard.js`, `frustrated-brief.js`, the card renderer | `Workflow` (also under ultracode), mutating ship / GitHub MCP tools |

A project that itself lives in the temp dir keeps its source protected. The
guard ends on `disarm` (after the approval, a no, or before a concept
hand-off) or after 2 h. Silent on every channel below alpha.

## Analysis

Brief: `scripts/frustrated-brief.js [--transcript <jsonl> | --session <id>] --out <temp file>`
reads the bounded tail (4 MB) of the transcript and extracts the user's own
prompts (logs collapsed), edited files, error signatures, skills and agents
used, plus a code-free cut. It writes only into the temp dir. Another session
is read only after the user's explicit yes.

Roles (existing agents, role blocks in `skills/auto-frustrated/deep-knowledge/roles.md`):
R1 intent `po`, R2 history `redteam`, R3 technical cause `research`, R4
workflow & product `po`, R5 fresh alternative `rethinker`, S synthesis
`research`. Lite: R1, R2+R4, R3, synthesis in the main thread. No new agent
files.

## Skill (`auto-frustrated`)

User-only (`disable-model-invocation: true`), first step
`feature-flag.js check frustrated-mode` (stop on 126). Flow: intake and sealed
loop hypothesis → arm the guard, build the brief → R1–R5 in parallel →
synthesis → `plan record` → present (non-trivial: disarm, then
`/auto-concept`; trivial: plan text above the `analysis` card) → next prompt:
any interpretable yes → `plan approve` → disarm → hand-off per step
(`do-run --from=frustrated`, `auto-fix --from=frustrated`, `auto-concept`,
`do-learn`, `auto-guide`). A no → `plan clear` and disarm. Never ships, never
asks to ship; no Ultracode field in the report.

## Hand-off

Entered as `/do-run --from=frustrated --plan=<id>@<short> [--step=<n>] <payload>` after `plan approve`. do-run finds it through `scripts/run-extras.js from frustrated` (`{known:true, doc, section}` only where the feature is allowed; the ungated router names no feature, it just reads the doc the helper returns). Read this section before anything else; it replaces the router's presets and questions.

1. **Verify first.** Run `node "{PLUGIN_ROOT}/scripts/run-extras.js" handoff --plan <id>@<short>` (add `--cwd` from scripts). It checks through `plan status` that the record exists, is `approved`, is not expired (2 h) and matches id and hash. Exit 1 / `ok:false` -> stop, print its `error`, execute nothing, arm nothing.
2. **Presets (answers in advance, nothing asked):** Q1 = Prompt umsetzen with the step payload as the task, verbatim; Q2 = **Interaktiv · Ship manuell**; Q3 = Strikt, scope = the approved plan's steps (`objects` are the closed scope, `out_of_scope` is off limits); Q4 dropped (no Rethink, no burn, no analysis option); passes as the plan's `checks` say, Harden/Polish as always. Q2 is not asked either: plan approval is not ship approval, and the hand-off never asks about shipping.
3. **Never ships.** No ship question, no `ship: auto`, no `do-ship` call, no `ship_*` tool. A ship wish in the payload is ignored and reported as out of scope.
4. **Run.** Implementation goes through `auto-agents` (`--from=do-run --via=frustrated --mode=interactive --ship=manual --plan=<id>@<short> --step=<n>`: pass `--via`, `--plan` and `--step` through verbatim, § Hand-off in auto-agents); the plan approval was its confirmation, the plan card is still shown. Several `implement` steps run in plan order; `concept`, `learn` and `webguide` steps go to `auto-concept`, `do-learn` and `auto-guide` with the same `--from=frustrated --plan=… --step=n` args. **After a `concept` step** the plan may have moved to v+1 (§ Hand-off in auto-concept): re-read `plan status`, continue with its new short, and skip every `implement` step the concept's implement click already built — never build a step twice, never resume with the old short (it fails `handoff`).
5. **Single-bug plans** stay in do-run -> `auto-agents`. `auto-fix` is not an entry for the hand-off (it is mandated for failures and only ever gets a log-only hint); it takes no `--from=frustrated`.
6. Anything unclear about the plan -> stop and say so; never fall back to the router's default questions.

## Hand-off in auto-agents

auto-agents names no feature: its Step 3 skips the second confirmation (spec G5) only for `--via` plus a `--plan=<ref>` that `run-extras.js handoff --plan <ref>` confirms (rc 0; rc 126 off alpha or `ok:false` -> it asks as usual) — never for a bare `--via`; the plan card is still shown, once. Everything else rides in the **task text** the caller hands over, because auto-agents passes it verbatim into every agent prompt. So the caller (do-run's hand-off above, or auto-concept under § Hand-off in auto-concept) first verifies with `run-extras.js handoff --plan <id>@<short>` (`ok:false` -> stop, spawn nothing) and then writes this block into the task, filled from the approved step:

1. **Scope is the step.** Build only step `<n>` (`--step`, else every `implement` step in order). Its `objects` are the closed file scope of every agent prompt, `out_of_scope` goes into each prompt as off limits, its `checks` run first in the QA wave. A needed file outside `objects` is a material deviation: stop that agent and return it as `needs-decision` ("Plan-Abweichung: <file> — neue Version freigeben?"); never widen silently.
2. `ship` in the result stays `manual`.

## Hand-off in auto-concept

Reached when auto-concept runs with `--from=frustrated --plan=<id>@<short> --step=<n>` (a `concept` step); found via `run-extras.js from frustrated --skill auto-concept`.

- **Verify first**: `node "{PLUGIN_ROOT}/scripts/run-extras.js" handoff --plan <id>@<short>` — as soon as this section is read (auto-concept looks it up at the implement click, so the check runs there at the latest). Exit 1 / `ok:false` -> stop, print its `error`, build nothing further; the concept never mints an approval for a plan that is not approved.
- The page is built and iterated as always; iterate clicks change nothing outside the page.
- **The implement click is a re-approval of a new plan version** (spec § 4.2, G7). Before § 5b's implement path:
  1. Run the `handoff` check again (the 2-h expiry may have passed while the page was open); `ok:false` -> stop as above.
  2. Take the current plan from `node "{PLUGIN_ROOT}/hooks/lib/run-contract.js" plan status` (its `plan` object), fold the submitted decisions into it — the target implement step's `objects` and `decisions` come from the concept — and write it with the Write tool to `plan-v<next>.json` in the session scratchpad.
  3. Record it as v+1 under the **same id** (`plan record --id <id> --file <that file>`) and approve it at once with the hash that call printed (`plan approve --id <id> --hash <hash>`); the click is the user's explicit yes.
  4. Run § 5b with `--via=frustrated --plan=<id>@<new short> --step=<m>` added to its auto-agents args, where `<m>` is the **first `implement` step after step `<n>`** in the new version, and write the § Hand-off in auto-agents scope block into its task, filled from step `<m>` of the new version (auto-agents enforces scope only through that task text).
- A plan with **no implement step after this concept step**: the click adds a step (material). Do not run § 5b; show "Neue Umsetzung — Plan v<next> freigeben?" in chat. On an interpretable yes: steps 1–3 above with the new `implement` step appended (its `objects`/`decisions` from the concept), then step 4 with that step's number. On a no: leave the plan as it is and say the concept's decisions were not built.
- Close-out: ship stays a separate choice on the sheet (the only place the hand-off may ship).

## Hand-off in do-learn

Reached when do-learn runs with `--from=frustrated --plan=<id>@<short> --step=<n>` (a `learn` step, payload = the rule text); found via `run-extras.js from frustrated --skill do-learn`.

- **Verify first**: `node "{PLUGIN_ROOT}/scripts/run-extras.js" handoff --plan <id>@<short>`. Exit 1 / `ok:false` -> keep the normal "richtig?" confirmation (the plan proves nothing), and say the plan was not valid.
- **The payload is the rule.** Under the hand-off skip the surprise detection over recent prompts; `<rule>` = the payload verbatim.
- **No "richtig?" line** (spec G8) only when that check passed **and** the payload equals step `<n>`'s rule text in the approved plan (`plan status` → `steps`). Any difference -> confirm as usual.
- Routing (Step 2), the target-container grep and the report run unchanged.

## do-run option

do-run's Q4 (the "Durchgänge?" multi-select) gets one extra option, **"Erst analysieren"** ("Ursachen klären, Plan vorschlagen, nichts umsetzen"), decided in code: `node "{PLUGIN_ROOT}/scripts/run-extras.js" q4` prints `{"extra":null}` or `{"extra":{id:"analyze-first",label,description,wins:true,…}}`. It is non-null only when `featureAllowed('frustrated-mode')` **and** `isSessionFlagged(<this session>)` (session id: `--session`, else `$CLAUDE_CODE_SESSION_ID` / `$CLAUDE_SESSION_ID`; none -> not shown). Stable/beta: the script exits 126, nothing is added.

- Position: last option before "Nichts davon"; never `(Recommended)`, never first.
- **It wins.** Ticked together with other passes (Rethink vorher, Budget verbrennen), the others are dropped and named in one line ("Rethink und Budget entfallen: erst Analyse"). Q2/Q3 answers are discarded; no `prompt` contract is armed (or one just armed is aborted with `--reason "handed to frustrated"`).
- Effect: `Read {PLUGIN_ROOT}/skills/auto-frustrated/SKILL.md` and follow it with the prompt. It counts as an explicit invocation.
- Not shown for machine prompts, backlog, audit or burn runs.
