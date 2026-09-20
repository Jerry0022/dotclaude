---
name: claude-batch
version: 0.5.0
description: >-
  Collect mode — a UserPromptSubmit hook parks each prompt in
  `.claude/batch.md` instead of executing it (no model turn), until an
  execute marker merges the whole set into ONE feasibility-checked plan.
  Triggers on "/claude-batch", "sammelmodus", "collect mode", "batch mode",
  "erstmal sammeln", "nicht sofort umsetzen". Do NOT trigger for normal work,
  for backlog execution (/run-backlog), or for issue creation (/setup-issue).
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__*, mcp__ccd_session_mgmt__get_session, mcp__ccd_session_mgmt__set_session_title
---

# claude-batch — Collect Prompts, Merge Once

Spec: `docs/superpowers/specs/2026-08-16-claude-batch-design.md`

## Step 0 — Load Extensions

Silently check (do not surface "not found"):
1. `~/.claude/skills/claude-batch/SKILL.md` + `reference.md`
2. `{project}/.claude/skills/claude-batch/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

## Step 1 — Route the invocation

`$ARGUMENTS` decides the branch. No argument → **activate** when the mode is
off, **status** when it is already on.

| Argument | Branch |
|---|---|
| none | Mode off → Step 2 (activate). Mode on → Step 3 (report). The bare invocation IS the request to collect — nobody types `/claude-batch` to be told the mode is off |
| `on`, `an`, `start` | Step 2 (activate) |
| `off`, `aus`, `stop` | Step 5 (deactivate) |
| `go`, `los`, `merge` | Step 4 (fire) |
| `marker` | Step 2.1 (ask again, overwrite the stored marker) |
| `status` | Step 3 (report) |
| `help`, `hilfe`, `?` | Step 6 (print the long-form help, nothing else) |
| *anything else* (free text) | **Content fallback** — the whole argument is a note: activate the mode if it is off (Step 2, including the marker question), file the text verbatim as note #1 (Step 2.4), report the count |

**Activation ends ON.** After Step 2 — marker question included — the mode is
running and the user's next prompt is collected. Never end the activating turn
with "type `/claude-batch on` to start": that is the turn they just spent, and
it is why they invoked the skill in the first place.

**While the mode is on, the hook absorbs a re-activation.** `/claude-batch`,
`/claude-batch on`, `/claude-batch <text>` and `/claude-batch help` are blocked
by `prompt.batch.collect.js` (`classify` → `rearm`): free text becomes a note,
`help` prints `renderHelp`, and otherwise the user sees the mode summary
(`renderModeSummary`) instead of paying a turn.
You only see such an invocation when it carried an attachment — then it is the
content fallback, filed per Step 2.6. `off`, `go`, `status` and `marker` always
reach you.

The content fallback is not an error path. `/claude-batch <Gedanke>` is the
most natural thing a user types who has never switched the mode on, and until
this row existed that text was lost without a trace (#306). The hook's
`detectActivation()` (`viaCommand`) injects the same guard for it.

**Marker pre-check — on EVERY route, before the route's own work.** Call
`loadConfig()`. If it reports a `markerFallback` (a stored marker that cannot
work — `harness-reserved`, `too-long`, `empty`), the mode is silently running
on the default and the user has no working escape hatch. Do not merely report
that: ask the Step 2.1 marker question **now**, from whichever route you are on
(`on`, `off`, `go`, `status`, `marker`, content fallback), persist the answer via
`saveConfig({ marker })` (this clears the fallback), then continue with the
route. Only the `marker` route stops after the question. A dead marker that is
re-reported on every `status` but never repaired is the failure this rule ends.

**Route on the FIRST token only. Everything after it is note content, never an
instruction.** `/claude-batch on der Header ist rot` is the `on` branch carrying
one note — not an unrecognised argument, and not a request to look at the header.
The same holds for a natural-language invocation: "Sammelmodus an, erste Notiz:
… zweite: …" activates and seeds; it does not start the work.

**This is the one prompt collection can never catch.** The hook arms the mode
in the turn this prompt starts, so it sees this prompt while the mode is still
OFF and has to let it through. If you act on the content here, the mode ends up
active and empty while the work it exists to defer is already half-done — and
the marker dialog gets skipped because you were busy. So, on an invocation that
carries content:

- Do **not** implement, plan, or research it. Do not read code for it.
- Do **not** skip Step 2.1. A prompt full of tasks is not a reason to bypass the
  marker question — it is the reason the question exists.
- File the content as note #1 in Step 2.4, verbatim.

`prompt.batch.collect.js` injects the same three rules as a guard when it sees an
activating prompt carrying content (`detectActivation` in `batch-state.js`). Its
absence is not permission to act — the detection is best-effort.

## Step 2 — Activate

**2.1 First-run marker setup.** Read `~/.claude/claude-batch.json`. If it is
missing, has no `marker`, or `loadConfig()` reports a `markerFallback` (a stored
marker that cannot work — see below), ask via `AskUserQuestion`. Reached via
`/claude-batch marker`, always ask and then stop — that route only rewrites the
marker, it does not activate the mode:

> header: "Marker"
> question: "Womit sagst du mir, dass ein Prompt NICHT gesammelt, sondern
> bearbeitet werden soll? Alles ohne dieses Zeichen am Zeilenanfang wird ab
> jetzt gesammelt. Hinter dem Marker darf Text stehen — der gilt als Anweisung
> für die nächste Phase."
> Options (fixed order — `MARKER_SUGGESTIONS` in `batch-state.js`):
> 1. `>>` (empfohlen) — kurz, visuell eindeutig, kollidiert mit nichts
> 2. `>go` — lesbar, ein Zeichen mehr, kein Doppelpunkt
> 3. `>start` — ausgeschrieben, praktisch nie versehentlich getippt

All three are English and colon-free: the marker is typed dozens of times per
session, and a colon reads as a label rather than a switch. The user's own
answer via "Sonstiges" may be anything `validateMarker` accepts.

**`!`, `/`, `#` and `@` cannot be the first character of a marker.** The harness
claims those before a prompt exists — `!` opens bash mode and runs the line as a
shell command, `/` expands a slash command, `#` writes to CLAUDE.md, `@` expands
a file mention. Such a prompt never reaches the collect hook, so the marker would
be dead: collection keeps swallowing everything and the advertised escape does
nothing. `validateMarker` rejects them with `reason: 'harness-reserved'`; never
suggest one, and never write one into the config by hand.

**Otherwise the three options are suggestions, not a closed set.** A free-text
answer via "Sonstiges" IS the answer — it is what the user wants their marker to
be, and it outranks every offered option. Never read it as "the question wasn't
answered" and never fall back to the recommendation instead. `validateMarker(raw)`
from `batch-state.js` normalises it; only `ok: false` goes back to the user,
quoting the reason (`empty`, `too-long` = over 32 characters,
`harness-reserved` = starts with `!`, `/`, `#` or `@` — name the mechanism in one
clause and ask for a different one). A `warning: 'wordy'` marker (letters only,
e.g. `Let's go`) is **accepted** — say once, in a single clause, that a collected
prompt starting with those words would fire the merge, then move on. Matching is
case-insensitive and requires a word boundary, so retyping it in lower case still
works.

Persist the choice via `saveConfig({ marker })` from `hooks/lib/batch-state.js`.
Never ask again unless the stored marker is unusable — a later change is
`/claude-batch marker`, or a manual edit of that file.

**2.2 Activate and start the watchdog:**

```bash
node -e "require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').activate(process.cwd())"
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" start .
```

**2.2b Mark the session in the sidebar.** While collecting, the session looks
idle from outside — the user comes back, sees the green dot, and types the next
task straight into a mode that swallows it. Prefix the title so the sidebar
says what is going on:

1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
2. If `title` already starts with `📥 Batch – `: done.
3. Strip any leading devops prefix (`🔧 `, `📦 Ready – `, `🧪 Test – `,
   `⏳ Working – `, … — the `SESSION_PREFIX` values in
   `mcp-server/lib/mode-state.js`) left by the first-prompt wrench or an
   earlier card — never stack them (`📥 Batch – 🔧 Foo` is the bug).
4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
   `title: "📥 Batch – {stripped title}"`.

The prefix is exactly `📥 Batch – ` (inbox tray, space, word, space, en dash,
space) — the same emoji the completion card carries in its `📥 BATCH sammelt`
CTA while the mode is armed. Both tools exist only in the Desktop app: in a
terminal session, an unattended run, or on any failure, skip silently — no
retry, no note, no fallback. The rename is a courtesy, never a gate.

**Re-arming keeps the queue.** `activate` only writes the mode file;
`.claude/batch.md` is untouched. So `/claude-batch on` after an auto-end
(expiry, note cap) or after `off` continues the same collection — say the
existing note count in the confirmation instead of pretending it starts empty.
The notes end only with the merge (Step 4.7, archived).

**2.3 Register the notes file in the git exclude** (machine state, not a project
decision — never `.gitignore`):

```bash
# The guard is mandatory: outside a git repo the command substitution is
# EMPTY, so `x` becomes "/info/exclude" and `mkdir -p "${x%/*}"` creates
# /info at the FILESYSTEM ROOT and appends there — outside the project.
gcd="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -n "$gcd" ]; then
  x="$gcd/info/exclude"
  mkdir -p "${x%/*}"
  grep -qxF '/.claude/batch*' "$x" 2>/dev/null || echo '/.claude/batch*' >> "$x"
fi
```

**2.4 Seed the invocation's own content.** If the activating prompt carried
anything beyond the route word (Step 1), file it now — after `activate`, before
the confirmation:

```bash
node -e "require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').appendNote(process.cwd(), process.argv[1])" "<text>"
```

**Verbatim, and as ONE note.** Do not summarise, re-order, or split it into what
you think the separate items are — a note is the user's own words, and the merge
in Step 4 reads content, not note boundaries. Guessing boundaries only risks
losing a requirement. Skip this step silently when the invocation was bare.

If the activating prompt carried an attachment, follow Step 2.6 for it in the
same note.

**2.5 Confirm with the mode summary — verbatim, nothing else.** Print it and
relay the output unchanged as the whole confirmation:

```bash
node -e "console.log(require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').describeMode(process.cwd()))"
```

It is the same block the hook shows on every collected prompt and on an
absorbed re-activation, so the user learns one text: what happens to a prompt
now, how to fire (`<marker> <text>` or `/claude-batch go` — main is merged in
first), how to only stop (`/claude-batch off`), and the auto-end bounds. When
2.4 ran, the note count in its first line already says the first note is
stored. Do not paraphrase it, do not add a second explanation, and do not tell
the user to switch the mode on — it is on. Then render an `analysis` completion
card **with `cwd` set to the project root**: the card reads
`.claude/batch-mode.json` itself and swaps its CTA for `📥 BATCH sammelt. {n}
Notizen · nächster Prompt wird Notiz #{n+1} · "{marker}" löst aus — ich WARTE`.
Nothing else to pass; without `cwd` the card cannot see the mode and ends on a
CTA that invites the next prompt as if it would be worked on.

**2.6 Attachments are filed by you, because only you can see them.** This is a
standing rule for the whole collection window, not a one-off part of activation:
it applies every time such a prompt arrives while the mode is on.

A prompt carrying an image, pasted text, or an `@file` mention is never collected
by the hook — blocking it would erase the prompt, and an erased screenshot is
unrecoverable. So it passes through to you, and `prompt.batch.collect.js` injects
a guard telling you to file it. Do that, and nothing else:

1. **Do not act on it.** No planning, no research, no reading code for it. The
   whole point of the mode is that this happens later, once.
2. Note text = the prompt **verbatim**.
3. Add a line `[Anhang] <sachliche Beschreibung>`. You see the attachment in this
   turn; at merge time it is gone from the context. The description has to make
   the note usable without it — what is visible, and what is wrong with it. "Bild
   angehängt" is not a description.
4. Add `[Anhang-Datei] <pfad>` for every path you know (`@file` targets, saved
   screenshots). The guard lists the ones the hook could extract.
5. Store it as ONE note via `appendNote`, then answer with a single line naming
   the note number.

Without this, the note reaches the merge as "mach das so wie hier" with no
"hier" — the linkage the user actually cared about is the first thing lost.

## Step 3 — Status

Read the mode and notes via `batch-state.js`, plus
`node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" status .`

Report: active or not, note count, time since the last note, the marker actually
in force (`effectiveMarker(cwd)`), and — when `expiryReason()` is non-null — that
collection stopped on its own (`expired` / `full`) and why. Do NOT dump every
note unless asked; name the count and the first few.

Every card rendered while the mode is armed passes `cwd` (see 2.5). When the
mode turned out to be `expired` / `full`, the collection is over: strip the
session-title prefix as in Step 5 in the same turn, so the sidebar stops
promising a collection that no longer happens.

When `loadConfig()` returns a `markerFallback`, the Step 1 marker pre-check has
already asked the marker question and saved the answer before you get here —
report the marker that is now in force. If the user declined to pick one, say
that the stored marker is unusable, the default is in force instead, and that
`/claude-batch marker` fixes it permanently. Never report the config value as
if it were live.

## Step 4 — Fire the merge

Reached either by `/claude-batch go` or automatically: the collect hook injects
the full note set into the turn when the user sends a marker-prefixed prompt.
In both cases the procedure is identical. On the `go` route the Step 1 marker
pre-check runs first — a `markerFallback` is repaired before the merge, so the
next collection window starts with a marker that actually fires.

**Firing ends collection.** The hook deactivates the mode in the same run that
injects the notes, because everything after it — plan approval, answers to your
questions, course corrections — is the conversation *about* the implementation.
Collecting those would block and erase exactly the prompts the work depends on.
Treat the mode as OFF for the rest of this turn and all following ones.

**4.0 Bring main into the branch BEFORE reading a single note.** The notes were
written against the state the branch had when collection started — often hours
ago, while main moved on. Checking feasibility against that base is how a merged
plan rebuilds what main already has or collides with it at ship time.

- Marker path: the hook already ran `scripts/git-sync.js` synchronously and
  injected the result as "SCHRITT 0". Read it first. A `⚠` / `✗` line is a
  conflict or failure — resolve it (merge-safety.md: never `--ours`/`--theirs`)
  before Step 4.1. "Der Sync konnte im Hook nicht laufen" means: run it yourself
  now.
- `/claude-batch go` path: run it yourself, synchronously, and report the line:

  ```bash
  node "{PLUGIN_ROOT}/scripts/git-sync.js"
  ```

  Silent output = nothing to merge (or on main / no remote). Say so in one
  clause. It merges the parent chain (`origin/main` → … → this branch); it
  never rebases and never touches main itself.

**4.1 Read every note.** `.claude/batch.md`, verbatim. Notes are the user's own
words — never paraphrase them away before analysing. When the injected context
says the notes were too large to inline, read the file **completely** first; the
index it carries is a checksum, not a substitute.

**A note's `[Anhang]` / `[Anhang-Datei]` lines belong to that note and to no
other.** Where an `[Anhang-Datei]` path still exists, open it before judging the
note. Where only the `[Anhang]` description survives, that description IS the
evidence — do not silently drop the note for lacking the image.

**4.2 Write the coverage list before planning.** Exactly one line per note,
`#1` … `#N`, each with a disposition:

| Disposition | Meaning |
|---|---|
| übernommen | goes into the plan as written |
| zusammengeführt mit #x | same surface as another note |
| Konflikt mit #x | contradicts another note — Step 4.4 |
| nicht machbar (Grund) | fails the feasibility check — named, not skipped |
| Frage | answered first, then merged |

Count the lines against the note count in the injected context before you go on.
A note without a line is the defect this whole mode exists to prevent: it is not
a shorter plan, it is a lost requirement. If the user enriched the execute prompt
with extra text, it becomes `#N+1` and gets its own line — and if it was a
question, answer it before the plan.

**4.3 Feasibility-check against the real code BEFORE planning.** This is the
step that pays for the whole mode: the notes were written blind, without Claude
looking at anything. Some of them will be impossible, and later notes may depend
on those. Check the substantive ones against the codebase.

**4.4 Merge into ONE plan.** Not a list of n tasks executed in sequence — one
coherent piece of work. Where notes describe the same surface, they merge.

**4.5 Surface conflicts individually — never resolve them silently.**

> "#2 wollte den Header rot, #6 blau — ich nehme blau (später), sag Bescheid falls nicht."
> "#3 setzt eine Filter-API voraus, die es nicht gibt. #5 und #9 hängen daran und fallen mit."

Silent "later wins" resolution is the failure mode this step exists to prevent.
An impossible item is **named**, never quietly routed around.

**4.6 Present the plan and get approval.** After the OK:
- conflicts substantial enough to deserve clickable decisions → invoke `/concept`
- otherwise → straight into implementation

"Implementation" is deliberately broad: code, concepting, UI concepting, or only
a first step of what the notes ask for.

**4.7 Archive, do not delete.** After the plan is approved, call
`archiveNotes(cwd)` — it renames `batch.md` to `batch-<timestamp>.md`. The
originals stay recoverable; a merge must never be the only record of what the
user actually wrote.

**4.8 Retire the mode — never ask whether to stay in it.** Collection is already
off (the hook deactivated it when the merge fired; on the `/claude-batch go` path
do it yourself — `deactivate(cwd)` is idempotent). Stop the watchdog so it does
not linger for its next poll:

```bash
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" stop .
```

Then restore the session title: `mcp__ccd_session_mgmt__get_session` `self`;
if the `title` starts with `📥 Batch – `, call
`mcp__ccd_session_mgmt__set_session_title` `self` with that prefix removed. A
title without the prefix is left alone — the user renamed it meanwhile, and
that name wins. Desktop app only; skip silently elsewhere. The injected merge
context repeats this instruction because the hook path never loads this skill.

Say in one clause that follow-up prompts run normally again and `/claude-batch on`
re-arms collection. A question here would be asking whether to keep blocking the
answers to your own questions.

## Step 5 — Deactivate

The Step 1 marker pre-check applies here too: a `markerFallback` is repaired
before the mode goes off, so the next `on` starts with a working marker.

```bash
node "{PLUGIN_ROOT}/scripts/batch-watchdog.js" stop .
node -e "require('{PLUGIN_ROOT}/hooks/lib/batch-state.js').deactivate(process.cwd())"
```

Restore the session title the same way as in Step 4.8: strip a leading
`📥 Batch – ` via `set_session_title` `self`, leave any other title untouched,
skip silently outside the Desktop app.

If notes remain, say how many and that they survive in `.claude/batch.md` for a
later `/claude-batch go`. Never discard them on deactivation.

## Step 6 — Help

The long form of the mode summary: A) what the user does, step by step, and
B) what Claude does at each of those steps. Print it and relay it verbatim —
no additions, no activation, no status:

```bash
node -e "const B=require('{PLUGIN_ROOT}/hooks/lib/batch-state.js');console.log(B.renderHelp({marker:B.effectiveMarker(process.cwd())}))"
```

While the mode is on, the hook prints the same text itself and you never see
the invocation.

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
  attachments. The hook enforces this; do not add exceptions in the skill. An
  attachment prompt is not collected *automatically*, but it is still filed —
  by you, per Step 2.6. Passing it through untouched loses it entirely.
- **The execute marker outranks everything except machine prompts and slash
  commands.** `>> so wie hier [Image #1]` fires the merge; the attachment rule
  does not apply, because an execute prompt is never blocked. And the marker
  reaches the notes even when the mode already expired or hit its cap — the
  notes outlive the mode.
- **Never report an empty queue without looking.** If the marker fired and the
  hook says nothing could be parsed, read `.claude/batch.md` raw before saying
  there were no notes. A hand-edited file, a destroyed separator, or an editor
  rewriting the file are all cases where content exists and the parse fails —
  and "there are no notes" is then simply false.
- **The red "Ein Hook hat deine Eingabe blockiert" panel is the normal collect
  path, not a failure.** Blocking the prompt is how the mode saves the turn; the
  harness has no quieter rendering for it. If the user reports it as an error,
  confirm the note actually landed (Step 3) and explain the mechanism — do not
  start debugging the hook.
- **The activating prompt is never executed.** Whatever it carries beyond the
  route word becomes note #1 (Step 2.4). Acting on it defeats the mode in the
  very turn that starts it, and it is how the marker dialog gets skipped.
- **Never resolve a contradiction silently.** Name it, then decide.
- **Never delete notes.** Archive them.
- **Activation ends with the mode ON.** The invocation is the request; never
  ask the user to send `/claude-batch on` afterwards. A re-activation while
  collecting is absorbed by the hook (`rearm`), never a turn.
- **Firing starts with main.** Step 4.0 runs before any note is judged — on the
  marker path the hook did it, on the `go` path you do. A plan built on a stale
  branch is not a plan.
- **A question in the queue is a defect, not content.** If a note is clearly a
  question the user expected an answer to, answer it first, then continue with
  the merge.
- **The mode expires on its own** (time and note cap). If collection stopped
  mid-session, say so — do not let the user believe prompts are still landing
  in the queue — and strip the `📥 Batch – ` title prefix in that turn.
- **The title prefix is state, not decoration.** `📥 Batch – ` goes on when the
  mode arms (2.2b) and comes off when it ends (4.8, 5, expiry) — never by
  re-typing a remembered title, only by stripping exactly that prefix. Missing
  session tools (terminal, unattended) mean skip, not fail.
