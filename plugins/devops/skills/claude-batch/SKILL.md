---
name: claude-batch
version: 0.1.0
description: >-
  Collect mode — batch prompts into one master plan instead of executing them one by one. While active, a UserPromptSubmit hook blocks each prompt (it never reaches the model, costing nothing) and appends it to `.claude/batch.md`; a configurable execute marker fires the merge, where the whole note set becomes ONE feasibility-checked plan. Purpose: avoid the rework of building for prompt 1 what prompt 5 supersedes, and avoid paying a full turn per observation. Triggers on "/claude-batch", "sammelmodus", "collect mode", "batch mode", "erstmal sammeln", "nicht sofort umsetzen". Do NOT trigger for normal work, for backlog execution (/run-backlog), or for issue creation (/setup-issue).
---

# claude-batch — Collect Prompts, Merge Once

Spec: `docs/superpowers/specs/2026-08-16-claude-batch-design.md`

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/claude-batch/SKILL.md` + `reference.md`
2. `{project}/.claude/skills/claude-batch/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Route the invocation

`$ARGUMENTS` decides the branch. No argument → **status**.

| Argument | Branch |
|---|---|
| `on`, `an`, `start` | Step 2 (activate) |
| `off`, `aus`, `stop` | Step 5 (deactivate) |
| `go`, `los`, `merge` | Step 4 (fire) |
| `status`, none | Step 3 (report) |

## Step 2 — Activate

**2.1 First-run marker setup.** Read `~/.claude/claude-batch.json`. If it is
missing or has no `marker`, ask ONCE via `AskUserQuestion`:

> header: "Marker"
> question: "Womit sagst du mir, dass ein Prompt NICHT gesammelt, sondern
> bearbeitet werden soll? Alles ohne dieses Zeichen wird ab jetzt gesammelt."
> Options (fixed order):
> 1. `!` am Zeilenanfang (empfohlen) — ein Zeichen, kein Shift, kollidiert mit nichts
> 2. `los:` am Zeilenanfang — ausgeschrieben, praktisch nie versehentlich getippt
> 3. `>>` am Zeilenanfang — kurz und visuell eindeutig

Persist the choice via `saveConfig({ marker })` from `hooks/lib/batch-state.js`.
Never ask again — a later change is a manual edit of that file, or
`/claude-batch marker`.

**2.2 Activate and start the watchdog:**

```bash
node -e "require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').activate(process.cwd())"
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" start .
```

**2.3 Register the notes file in the git exclude** (machine state, not a project
decision — never `.gitignore`):

```bash
x="$(git rev-parse --path-format=absolute --git-common-dir)/info/exclude"
mkdir -p "${x%/*}"
grep -qxF '/.claude/batch*' "$x" 2>/dev/null || echo '/.claude/batch*' >> "$x"
```

**2.4 Confirm in one short block** — the marker, where notes land, and both
exits. Then render an `analysis` completion card.

## Step 3 — Status

Read the mode and notes via `batch-state.js`, plus
`node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" status .`

Report: active or not, note count, time since the last note, whether the
watchdog runs, and — when `expiryReason()` is non-null — that collection stopped
on its own (`expired` / `full`) and why. Do NOT dump every note unless asked;
name the count and the first few.

## Step 4 — Fire the merge

Reached either by `/claude-batch go` or automatically: the collect hook injects
the full note set into the turn when the user sends a marker-prefixed prompt.
In both cases the procedure is identical.

**4.1 Read every note.** `.claude/batch.md`, verbatim. Notes are the user's own
words — never paraphrase them away before analysing.

**4.2 Feasibility-check against the real code BEFORE planning.** This is the
step that pays for the whole mode: the notes were written blind, without Claude
looking at anything. Some of them will be impossible, and later notes may depend
on those. Check the substantive ones against the codebase.

**4.3 Merge into ONE plan.** Not a list of n tasks executed in sequence — one
coherent piece of work. Where notes describe the same surface, they merge.

**4.4 Surface conflicts individually — never resolve them silently.**

> "#2 wollte den Header rot, #6 blau — ich nehme blau (später), sag Bescheid falls nicht."
> "#3 setzt eine Filter-API voraus, die es nicht gibt. #5 und #9 hängen daran und fallen mit."

Silent "later wins" resolution is the failure mode this step exists to prevent.
An impossible item is **named**, never quietly routed around.

**4.5 Present the plan and get approval.** After the OK:
- conflicts substantial enough to deserve clickable decisions → invoke `/concept`
- otherwise → straight into implementation

"Implementation" is deliberately broad: code, concepting, UI concepting, or only
a first step of what the notes ask for.

**4.6 Archive, do not delete.** After the plan is approved, call
`archiveNotes(cwd)` — it renames `batch.md` to `batch-<timestamp>.md`. The
originals stay recoverable; a merge must never be the only record of what the
user actually wrote.

**4.7 Ask whether to stay in collect mode.** After a fired merge the mode is
usually no longer wanted. Ask once, default off.

## Step 5 — Deactivate

```bash
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" stop .
node -e "require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').deactivate(process.cwd())"
```

If notes remain, say how many and that they survive in `.claude/batch.md` for a
later `/claude-batch go`. Never discard them on deactivation.

## Optional — local compaction

When the `local-llm` plugin is installed AND AnythingLLM answers, the notes may
be de-duplicated and reformatted locally at zero API cost.

**Strictly formatting only.** No interpretation, no contradiction detection, no
summarising of intent — `plugins/local-llm/deep-knowledge/delegation-rules.md`
classifies ambiguous user requests as RED (never delegate) and caps practical
context at ~8K tokens. A wrong compaction is worse than none: the plan silently
loses a requirement and the original is no longer in the UI to check against.

The dependency is soft. Resolve the plugin path and skip silently if absent —
`devops` and `local-llm` are independently installable and must stay that way.

## Rules

- **Never collect** machine prompts, expanded slash commands, or prompts with
  attachments. The hook enforces this; do not add exceptions in the skill.
- **Never resolve a contradiction silently.** Name it, then decide.
- **Never delete notes.** Archive them.
- **A question in the queue is a defect, not content.** If a note is clearly a
  question the user expected an answer to, answer it first, then continue with
  the merge.
- **The mode expires on its own** (time and note cap). If collection stopped
  mid-session, say so — do not let the user believe prompts are still landing
  in the queue.
