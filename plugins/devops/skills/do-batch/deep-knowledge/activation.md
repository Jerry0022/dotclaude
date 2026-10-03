# do-batch Activation — marker, title, exclude, card, attachments

Execution detail for Step 2 of `SKILL.md`. The **decisions** stay in the skill
body — when to ask the marker question, what the prefix is, that the activating
prompt is filed and never executed; this file only answers "I am in that step,
now what exactly?". Step numbers refer to `SKILL.md`.

## Activation guard (Step 1)

`prompt.batch.collect.js` injects the same three rules as a guard when it sees an
activating prompt carrying content (`detectActivation` in `batch-state.js`). Its
absence is not permission to act — the detection is best-effort. For the content
fallback (`/do-batch <Gedanke>`) the hook's `detectActivation()` (`viaCommand`)
injects the same guard.

## Marker validation (Step 2.1)

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

## Session title prefix (Step 2.2b)

1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
2. If `title` already starts with `📥 Batch – `: done.
3. Strip any leading devops prefix (`⏳ `, `📦 Ready – `, `🧪 Test – `,
   `🧭 Concept – `, … — the `SESSION_PREFIX` and `LEGACY_PREFIXES` values in
   `mcp-server/lib/mode-state.js`) left by the first-prompt hourglass or an
   earlier card — never stack them (`📥 Batch – 🔧 Foo` is the bug).
4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
   `title: "📥 Batch – {stripped title}"`.

Removing it again (4.8, Step 5, expiry): `deep-knowledge/merge.md` § Retire.

## Git exclude (Step 2.3)

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

## Activation card (Step 2.5)

The card carries the whole confirmation: the heading
`📥 Batch sammelt — {n} Einträge`, a context line
(`{n} Notizen · nächster Prompt wird Notiz #{n+1} · "{marker}" löst aus`) and
three points — how collecting works (the red panel is normal), how to fire
(`<marker> <text>` or `/do-batch go`), how to only stop (`/do-batch off`) plus
the auto-end bounds.

## Filing an attachment (Step 2.6)

1. **Do not act on it.** No planning, no research, no reading code for it. The
   whole point of the mode is that this happens later, once.
2. Note text = the prompt **verbatim**.
3. Add a line `[Anhang] <sachliche Beschreibung>`. You see the attachment in this
   turn; at merge time it is gone from the context. The description has to make
   the note usable without it — what is visible, and what is wrong with it. "Bild
   angehängt" is not a description.
4. Add `[Anhang-Datei] <pfad>` for every path you know (`@file` targets, saved
   screenshots). The guard lists the ones the hook could extract. No path
   known → no placeholder line: the merge rescues the image from the session
   transcript by the verbatim note text (step 2).
5. Store it as ONE note via `appendNote`, then answer with a single line naming
   the note number.

Without this, the note reaches the merge as "mach das so wie hier" with no
"hier" — the linkage the user actually cared about is the first thing lost.

## Desktop-app images (Step 2.6)

The Desktop app sends a pasted image as its own content block: the prompt
carries no `[Image #N]` and no attachment key, so it IS collected (the user
sees the red collect panel, as for any note). The harness has already saved
the image to `<tmp>/claude/<project-slug>/<session_id>/images/`; the hook
copies every image whose mtime matches the prompt (up to 10 s before the
hook ran, 3 s after) to
`.claude/batch-assets/<note-timestamp>-<n>.<ext>` and appends
`[Anhang-Datei] <copy>` to the note. The panel says "📎 Das Bild ist mit der
Notiz gespeichert". The same holds for `/do-batch <text>` while collecting;
an image with a bare `/do-batch` still becomes a note of its own. Nothing for you to do; the copies are never moved, so
archived notes keep valid paths.
