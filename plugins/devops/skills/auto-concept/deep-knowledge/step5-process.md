# Concept step 5a–5b — reading a submission and the iterate / implement / finalize branches

Round marking, reading a submission, checkpoints and the iterate / implement / finalize branches — execution detail of `SKILL.md` Step 5, 5a and 5b, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Mark the round as work

A submission usually arrives as the waker's task notification, not as a user
prompt, so `prompt.flow.title-work` leaves the compass alone on that turn —
the swap is yours. Once the wake is confirmed real (`/pending` is `true` with
a new `_version`, Step 5d § re-confirm) and before Step 5a, Desktop app only:
`mcp__ccd_session_mgmt__get_session` `self`; if the `title` starts with
`🧭 Concept – `, `mcp__ccd_session_mgmt__set_session_title` `self` with
`"⏳ " + {title without that prefix}`. Any other title is left as it is. A
stale wake changes nothing. Skip silently when the tools are missing or fail.

This round then MUST end with its completion card (`concept` field + `cwd`,
phase per the table in Step 3) — that card is what turns `⏳ ` back into the
compass when the page waits again. A round that ends without a card leaves
the sidebar on the hourglass while the page waits for the user.

## 5a · Read and parse

1. Read the JSON from `#concept-decisions`
2. Parse into structured decisions and comments
3. **Open every attachment — any file type, not just images.** A `decision`/
   `free` template comment may carry `attachments: [{id, name, mime, size,
   path}]` inline; a `design` template iteration instead carries a
   top-level `attachments` object keyed by slot (`general`, `design-{id}`,
   `{screenId}`, `view-{id}`, `anno-{id}`, `{decisionId}-note}` — see
   `deep-knowledge/templates-design-wiring.md` § Decision schema (design branch) — walk
   every key and treat each entry the same as an inline one. Both shapes
   are already persisted by the bridge at
   `.claude/concepts/{date}-{slug}/attachments/<id>` (§ Bridge server §
   Attachment HTTP contract). Read every one with the Read tool before
   acting on the comment it belongs to: text/code/markdown/JSON files read
   directly, images render inline, and for a format the Read tool cannot
   open (an archive, a binary office format) at least surface the filename
   and size to the user in your response rather than silently skipping it.
   A comment (or a design slot) can also be attachment-ONLY with an empty
   `text`; that is a complete remark, not an empty one, and skipping it
   because the text is blank silently discards the user's point.

**Coverage check:** before processing decisions, verify every named form
field that exists in the just-frozen iteration HTML appears in the
`decisions` payload (specifically the `allFields` catch-all). If a field
is in the DOM but missing in the payload, flag it to the user immediately
("the JS missed these fields, please re-submit after I fix the collection
function"). See `deep-knowledge/validation-gate.md` § Generic Form
Collection for the required pattern.

**Mappings:** `mappings[]` (`deep-knowledge/templates-mapping.md` § Information
Mapping (engine)) is typed and always present (`[]` when the round has
none) — read it before `decisions[]`. Its `diff` is what changed against
your proposal, `assigned` (keyed by matrix key) is the full truth,
`unassigned` / `violations` are what the user left open in the mapping
(handled per branch below — they never become report open points on their
own, § Open points admission gate); `note` is the mapping note
(dock view note in a design round, inline textarea in a free round),
`slotNotes` the per-target remarks, `adhocItems` the labels the user added.
The mapping's cells are generated inputs and are not part of the coverage
check above — the jsdom suite covers them; `allFields` carries only the
compact state strings.

## 5b · Checkpoint duty

**Checkpoint duty (all branches except `iterate`).** `implement` and the
issues / ship parts of `finalize` create real, externally-visible artifacts,
and any of them can be cut short mid-flight — a usage limit, a crash, a PC
restart.
POST a checkpoint to the bridge as each artifact comes into existence:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"action":"ship","step":"pr-opened","status":"done","version":<captured _version>,"artifacts":{"branch":"feat/x","pr":42}}' \
  http://localhost:$PORT/progress
```

Use `step` values that name what now exists in the world — `branch-created`,
`code-written`, `committed`, `pr-opened`, `merged`, `issues-created` (with the
numbers in `artifacts`) — not internal phases. A resumed session replays these
to learn how far the dead run got.

**Namespace the `action` for finalize parts:** `finalize:issues`,
`finalize:implement`, `finalize:ship`, `finalize:cleanup` — never a bare
`"ship"`. A bare `"ship"`
checkpoint is indistinguishable from a legacy stand-alone ship submission, and
a resumed session that reads it as one verifies the PR, calls the job done and
never runs part C — leaving the concept files, the durable store and
`.claude/concept-active.json` behind as a phantom resume hint.

**And on the receiving end: verify, never trust.** When you resume a run that
has checkpoints (`ss.concept.resume` hands you the mandate, or `GET /recovery`
shows them), establish the real state before acting — `git rev-parse --verify`
for a branch, `gh pr view <n> --json state,mergedAt` for a PR, `gh issue view`
for issues, and read the files for code changes. Then continue from what you
observed. Never re-create an artifact that exists, never re-merge a merged PR,
never re-run a completed step. The checkpoint records what the previous run
*believed* it had done, and it died for a reason.

## 5b · iterate steps 3–5

3. **If the submitted section carries `data-reality-check`, advance the
   baseline** before appending — the user has just answered that drift, and a
   decision they made is never asked again:
   ```bash
   node "{plugin-root}/scripts/concept-drift.js" --capture \
        --state "{session-cwd}/.claude/concept-active.json" --owner {owner} --sha <section's data-reality-head>
   ```
   The commit to pin is the one that round was generated from, and the round
   carries it itself in `data-reality-head` — so this works from a resumed
   session that never saw the check run.
   Skipping this is the one way the gate can feel like a loop: iterate once more
   after a reality check, click implement, and the same already-answered cards
   come back. The state file is not code and not an external system — this stays
   inside the iterate guarantee.
4. **Mappings:** the next round's proposal is the user's `assigned` — never
   re-propose what they moved away from; acknowledge the `diff` entries in
   the round intro (what moved, what you take from it). `unassigned` items
   and open `violations` are questions for the intro, not silent
   re-assignments. **Ad-hoc items:** promote every `adhocItems` label to a
   declared item with a fresh regular id in the next round's spec and
   rewrite every `u{n}` reference in `assigned` / `order` to the new id —
   reserved `u\d+` ids never appear in an authored spec.
5. Proceed to Step 5c (append next iteration with refined options that
   reflect the Miteinbeziehen/Verwerfen choices)

## 5b · implement — reality-check verdicts and steps 1–4

   - Otherwise `POST /status {"phase":"reality-check","version":$NOTED_VERSION}`
     (before the fetch, so the longer wait stays legible), then run
     `node "{plugin-root}/scripts/concept-drift.js" --state "{session-cwd}/.claude/concept-active.json" --owner {owner} --paths "<paths the concept names>"`.
   - `verdict: "skip"` or `"clear"` → advance the baseline (`--capture --sha
     <advanceTo>`) and continue with step 1 below. Every unresolvable condition
     — no remote, offline, force-pushed baseline — lands here: the check never
     blocks an implement order.
   - `verdict: "candidates"` → apply the force classes. Nothing that must force
     → continue with step 1, mentioning the drift in the final report. Something
     must force → checkpoint `reality-check-forced`, then append ONE
     reality-check round instead of implementing (Step 5c) and stop. Do NOT post
     `phase: "implemented"` — no code was written.
1. **Summarize** what was selected/rejected/commented. **Mappings:** the
   assignment IS the spec — generate the component / view / data projection
   per target with exactly the assigned items in `order`, never quietly
   defaulting what the user left open. An `unassigned` item is a decision the
   user made in the mapping (it goes nowhere) — build without it and say so in
   the Zusammenfassung; it enters the report's open points only when it passes
   the § Open points admission gate as `deferred` (the user parked it — name
   the mapping and round). A `violation` (an empty required slot, an
   over-full one) that keeps a target from being built is a **shortfall**
   reported with its reason, never re-labelled as a follow-up.
2. **Execute** the decisions as real changes — **through the `auto-agents`
   skill, the single execution path of every implementing skill.** An
   implement order is the one place in a concept session where code gets
   written, it is usually multi-domain, and the main session has a second job
   while it runs (heartbeat, `/status` POSTs, checkpoints). So invoke the
   Skill `auto-agents` with `--from=auto-concept --mode=background` and the
   brief: the concept file path, the submitted round, and the decisions the
   work must honour — not a paraphrase. `auto-agents` applies the delegation
   tiers, shows its agent cards, splits the approved work by domain
   (`devops:core`, `devops:frontend`, `devops:designer`, `devops:ai`),
   runs independent parts in parallel and lets
   `devops:qa` verify; `{PLUGIN_ROOT}/deep-knowledge/agent-orchestration.md`
   stays the authority on who owns what. The implement click is the yes its
   parallel tier needs — it does not ask again. Its result comes back here:
   `done` feeds the final report, `open` shortfalls go into the
   *Zusammenfassung* per the rule below, and a `needs-decision` becomes the
   next round (Step 5c) instead of the final report. Its `ship` field is
   ignored — shipping from a concept is the close-out sheet's part C.

   **The approved scope is built in full.** Everything the submitted round
   carried as accepted — every Miteinbeziehen finding, every approved plan
   step, every feedback item on a design round — is part of this order.
   Nothing accepted may be deferred into the final report's open points
   (§ Open points admission gate): a part that could not be built is a
   shortfall, reported in the *Zusammenfassung* / *Tests* with its reason
   ("nicht umgesetzt, weil …"), never re-labelled as a follow-up for the
   user to sign off.

   Doing it inline is the exception and needs a reason: a change small enough
   that one dispatch costs more than it saves (a one-line fix, a copy change)
   — `auto-agents`' Inline tier, which a caller may apply without loading the
   skill. Take that exception when it applies, and name it in the final report.

   What the decisions mean per template — this is the brief you hand the
   agents, not a second implementation path:
   - For plans: implement the approved steps
   - For concepts: develop the chosen variant, archive alternatives
   - For comparisons: proceed with the implicitly-selected winner (all
     others marked Verwerfen)
   - For free-template findings: apply the Miteinbeziehen findings as fixes
   - For design iterations: build the designed UI/flow with the feedback applied
3. **Signal completion to the panel.** Right after the implementation work
   is done — and BEFORE the final-report append + `/reload` in Step 5c — POST
   the implemented phase so the submit panel's third progress step lights
   up while the user is still looking at it. Pass the `_version` noted in
   Step 5a so a stale worker cannot pin "implemented" onto a newer
   submission:
   ```bash
   curl -s -X POST -H "Content-Type: application/json" \
        -d "{\"phase\":\"implemented\",\"version\":$NOTED_VERSION}" \
        http://localhost:$PORT/status
   ```
   The server responds 409 if a newer `POST /decisions` has landed since
   Step 5a — in that case the user re-submitted and our implement work is
   superseded, so skip the rest of Step 5b (no /reload, no /reset) and
   loop back to Step 5a to fetch the new payload.

   The browser polls `/decisions` every 5 s and reads `_phase` from the
   response — so the ✓ next to "Implementierung abgeschlossen" appears
   within ~5 s. The subsequent `/reload` (Step 5c) replaces the panel
   with the final report shortly after.
4. After the implementation is done, append a **Final Report**
   (`Abschlussbericht`) section instead of a regular iteration. This is the
   closing artefact of the concept session — see Step 5c §
   "Final-report append (implement only)" for the structure.

## 5b · finalize payload and zero-prompt invariant

The final-report panel is a **single close-out sheet**, not a wall of buttons
and not a step chain, so one submission carries every close-out decision the
user made:

```json
{ "action": "finalize",
  "issues":    { "create": true, "items": [ … ] },
  "implement": { "run": true,    "items": [ … ] },
  "ship":      { "run": true },
  "disposition": { "mode": "discard", "moveTo": null } }
```

`issues.items` and `implement.items` are **disjoint** and carry the same item
shape: the sheet gives every open point one of three routes — file it, build
it now, drop it — so a point is never in both buckets and a dropped one is in
neither.

**Zero-prompt invariant.** The user committed against the sheet's live plan,
which listed every consequence by name, in execution order, before they
clicked. Asking a follow-up question — for issue body, labels, milestone,
ship confirmation, anything — is
a UX regression equivalent to the old "paste the JSON from the console"
anti-pattern. Every field needed is in the payload OR derivable from the
concept HTML in `docs/concepts/{date}-{slug}.html`. If a field is genuinely
missing AND the project requires it, fall back to a sane default (silent) —
never an `AskUserQuestion`. The only justified interruptions are a hard `gh`
failure or a ship-pipeline gate failure that need the user's eyes.
