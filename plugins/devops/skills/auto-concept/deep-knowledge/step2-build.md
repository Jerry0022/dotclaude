# Concept step 2 — the build: source folder, round fragments, bake, round author

How a concept page comes into being: the source folder, the build script, what
Claude writes and reads, the freeze via `bake`, legacy pages, close-out and the
round author. This is the execution detail of `SKILL.md` Step 2, Step 5c and
Step 6a. Each `##` section below is named by exactly one mandatory pointer in
`SKILL.md`. Read it completely before executing that step. It is as binding as
the step itself, and it is authoritative for **where content is written and
how the page is produced**. Every other auto-concept document still describes
the page the user sees, and its markup contract, engine behaviour and gate
entries stay valid word for word. Wherever one of them says "append a section
to the HTML file", "rewrite the HTML" or "read the file back", it means the
round fragment and a build, as described here.

## Layout

A concept page carries about 600 KB of engine (Kompass panel, dock,
persistence, mapping engine). If Claude copied that engine, read the whole
page back each round and checked it by grepping, a concept of 8+ rounds paid
the engine many times over and compacted long before the user was done. The
engine therefore comes from a script, and Claude touches only the round it
writes.

```
docs/concepts/
  {ts}-{slug}.html            ← the BUILT page. Bridge, watchers, hooks, close-out and
                                the user's browser address it exactly as before.
                                Never written, read in full or edited by hand.
  {ts}-{slug}/                ← the SOURCE folder
    page.json                 { title, subtitle, locale, mode, pageVersion, lastBuild }
    head.html                 optional: this concept's tokens / content CSS / CSP meta / fonts
    rounds/01.html            <section data-iteration="1" data-iteration-template="…"> … </section>
    rounds/02.html            one file per round, NN = the round number
    briefs/02.md              round briefs for the round author (§ Round author)
  {ts}-{slug}-decisions.json  ← unchanged (Step 5e)
```

`{ts}-{slug}` follows `step2-feedback.md` § File naming. The folder and the page
share that name. `{PLUGIN_ROOT}` below is the installed plugin root that
SessionStart names. If a mid-session plugin update removed that directory, use
the newest `~/.claude/plugins/cache/dotclaude/devops/<version>/`.

## The build — `scripts/concept-build.js`

| Command | When |
|---|---|
| `node "{PLUGIN_ROOT}/scripts/concept-build.js" init "docs/concepts/{ts}-{slug}" --title "…" [--subtitle "…"] --locale {ui-locale} --mode decision\|design\|mixed\|free` | Step 2, once per concept (mode = the Step 0.5 answer) |
| `node "{PLUGIN_ROOT}/scripts/concept-build.js" build "docs/concepts/{ts}-{slug}"` | after every fragment change, in place of "write the HTML file" |
| `node "{PLUGIN_ROOT}/scripts/concept-build.js" bake "docs/concepts/{ts}-{slug}" --round N --payload <file>` | Step 5c, the round the user just submitted (§ Freezing the submitted round) |
| `node "{PLUGIN_ROOT}/scripts/concept-build.js" import "docs/concepts/{ts}-{slug}.html"` | a page from before the split, before its next round (§ Legacy pages) |
| `node "{PLUGIN_ROOT}/scripts/concept-build.js" check "docs/concepts/{ts}-{slug}"` | the gate as a dry run, nothing written |

What `build` does, every time:

1. **Engine.** It copies every `html` skeleton, `css` and `js` block of the
   template parts of the plugin that runs it, verbatim and in `templates.md`
   reading order. The skeleton is the design one when any round is `design`
   (or the mode is design / mixed), else the common one. **Engine drift cannot
   happen**: every round rebuilds from the current reference, which retires
   the manual re-sync of `validation-gate.md` § Engine drift on iteration
   append.
2. **Locale.** Every KNOWN `{{key}}` of the UI Locale table
   (`page.json.locale`) is substituted in engine and fragments, and `{{slug}}`
   becomes the page name. An unknown `{{…}}` stays as written. Nothing inside
   `pre` / `code` / `textarea` bodies or JSON script blocks is touched, so
   user content keeps its braces.
3. **Head.** `head.html` from the source folder. Without one, the build uses
   the project default `.claude/skills/auto-concept/head.html`, then the global
   `~/.claude/skills/auto-concept/head.html`, then a built-in neutral set
   (tokens plus the content base the engine does not style, such as
   `.concept-content` and `.variant-card`). The per-project look lives there,
   so a consumer customises it once per project without touching the engine.
4. **Rounds.** The fragments go in numeric order. The highest is the live
   round (`data-active`, no `hidden`). Every other round is **frozen
   mechanically**:
   - `hidden` is added and `data-active` removed. No other attribute is
     removed, so `data-reality-check`, `data-reality-head` and
     `data-final-report` survive.
   - Controls are `disabled`, and text fields and textareas are also
     `readonly`.
   - A `design` round keeps its navigation exemptions
     (`iteration-rules.md` § Freezing Design Iterations), and its textareas
     stay readonly, not disabled.
5. **Tabs.** One chip per round, generated: `{{iteration.tab}} N`,
   `{{iteration.reality_tab}}` with `data-reality-check`, or
   `{{iteration.final_tab}}` with `data-final-report`. `data-tab-label` on the
   section overrides the label. `<html data-template>` becomes the live
   round's template.
6. **Gate.** Each fragment must hold exactly one closed root section and
   nothing outside it. Its `data-iteration` must match the file number and it
   needs a valid `data-iteration-template`. Every frozen round must carry
   `data-baked` (§ Freezing the submitted round). A final report may appear
   only once, and only as the last round. Then the deterministic gate of
   `hooks/lib/concept-gate.js` runs over the assembled page. The build also
   refuses when the page on disk differs from its last build, which means
   someone edited it by hand. Move that content into the fragments, then pass
   `--force`. **On any failure nothing is written**, and the last good page
   stays live. The output names every problem: fix the fragment and build
   again. The page is written atomically (temp file + rename).

`pageVersion` is set once and never changes, because reload detection and the
draft store depend on it.

## What Claude writes

Only content:

- **`rounds/NN.html`** holds exactly one root
  `<section data-iteration="N" data-iteration-template="…">`, plus the
  optional `data-viewports` / `data-orientations`, `data-reality-check` +
  `data-reality-head`, or `data-final-report`. Inside goes the content the
  template documents describe: intro, variant cards with bi-state evaluation,
  designs/screens/views, mapping specs, the final-report structure, the
  round's own namespaced mock `<style>`. Nothing goes outside the section.
  Leave out `data-active`, `hidden` and `data-baked`, because the build and
  `bake` set them. Locale tokens `{{…}}` may be used.
- **`head.html`** only when this concept needs a look different from the
  project default. To give every concept of a project the project's own
  tokens, write `.claude/skills/auto-concept/head.html` once instead. A head
  replaces the built-in set completely, so keep the content base rules
  (`concept-build.js` `DEFAULT_HEAD`).

Never write, read in full or `Edit` the built `{ts}-{slug}.html`.
`post.concept.gate` blocks a hand edit of a built page, and the next build
would refuse over it.

## Reading — only what the round needs

- **The page:** never in full. The build output line tells whether it is
  good. Seeing it is the browser's job. To verify an attribute (the
  reality-check markers, a frozen value), read the fragment, not the page.
- **Previous rounds:** read `rounds/{N-1}.html` when the new round builds on
  it (a refined variant set, the same designs revised). Read an older round
  only when the feedback names it. The user's answers come from the payload,
  not from the HTML.
- **Engine reference (`templates-*.md`):** only the markup sections this round
  authors, e.g. `templates-decision.md` for variant cards,
  `templates-design.md` § Rules / Annotation Layer and `templates-design-views.md` § Views for a design round,
  `templates-mapping.md` § Information Mapping for a spec,
  `templates-rounds.md` § Final-report section HTML for the report. Find the
  heading with Grep and read that range (`offset` / `limit`), never a whole
  part. The CSS/JS engine sections belong to the build.
- **`validation-gate.md`:** before the build, check the round against Phase 0
  (forbidden), the Phase 2 block of its own template, § Frozen/Active
  Mismatch and § Mappings. Phase 1 (engine patterns) holds by construction.
  Read further only for an entry the build output names.

## Freezing the submitted round — `bake`

Step 5c's freeze has two halves:

1. **Values → fragment (`bake`).** Write the `/decisions` payload to a temp
   file (the scratchpad, never the repo) and run
   `bake --round N --payload <file>`. It refuses a payload whose `iteration`
   is another round. It writes into `rounds/NN.html`:
   - every `allFields` value: radios `checked`, checkboxes `checked`, textarea
     text, input `value`, select `selected` (by `value`, or the option text
     when it has none). Keys are resolved exactly like
     `collectAllFormFields()`.
   - every `mappings[]` entry as the spec's `submitted`
     (`{cells, order, adhoc, slotNotes}`), which satisfies M9, wherever the
     spec sits inside its mapping section.
   - the dock notes as `<script type="application/json" data-frozen-feedback>`:
     `comments.general` plus `comments.designs` / `screens` / `views`, and —
     for a round with the variant overview — `favorite` and `userPins`, so the
     frozen tab shows the favourite and the user's pins read-only.
   - `data-baked` on the section, which the build requires on every frozen
     round.

   Bake is idempotent. Read its `!` lines. They name what it could not place:
   a checkbox group sharing one key, a mapping without a section or spec, a
   field shape it does not know (a custom widget). Fix each one with a small
   `Edit` of that fragment, which is small and not the page. A note that the
   payload carries no `allFields` means you fed it the wrong file: a stored
   `-decisions.json` summary is not the `/decisions` payload. Never bake from
   a guessed payload. A round the user never submitted (steered from chat,
   superseded by your own correction) is frozen as authored with
   `bake --round N --unanswered`, which marks it `data-unanswered`.
2. **Attributes (`build`).** `hidden`, `disabled` and `readonly`, as in § The
   build.

## Legacy pages

A concept page from before this pipeline has no source folder. Run `import`
once, before its next round. It does the following:

- splits every top-level `section[data-iteration]` of `<main>` into
  `rounds/NN.html`, taking the template from `<html data-template>` where an
  old section declared none;
- marks every round but the last as baked, because its values are already in
  the markup;
- takes title (from `<title>`), subtitle, locale and `data-page-version` from
  the page;
- writes the page's own CSS ahead of the engine (tokens, content base) plus
  its CSP meta into `head.html`.

It refuses a page that already has a source folder or was built by the script.
From then on the page is built like any other, and the first build also brings
its engine up to date.

A built page can also move ahead outside the build, for example when a session
on an older plugin appended rounds straight into it. The build then refuses
("changed since the last build"). If the page holds the newer truth, run
`import --force`: its rounds replace the folder's. If the folder holds it, run
`build --force`. Never take `--force` without checking which side holds the
user's latest answers.

## Close-out

The source folder belongs to the concept exactly like its page. Every
disposition in `step6-closeout.md`, and the git staging of finalize part C,
applies to `{ts}-{slug}.html`, `{ts}-{slug}-decisions.json` **and** the
`{ts}-{slug}/` folder:

- `discard` removes the folder.
- `gitignore` ignores it.
- `keep` keeps it and stages it.
- `moveTo` moves it next to the page.

## Round author (Step 5c, rounds 2+)

With `concept.roundAgent` on (the default, `{PLUGIN_ROOT}/deep-knowledge/devops-config.md`
in the plugin root) and the delegation switch not `off` (`[delegation]` line),
the session hands the authoring of round N+1 to the `concept-author` agent once
Step 5a/5b are done:

1. **Brief.** The session writes `docs/concepts/{ts}-{slug}/briefs/NN.md`. The
   brief is the agent's only view of the conversation, so a nuance missing
   here is missing on the page. It covers:
   - the template, what this round must ask or show, and why;
   - the user's feedback in their own words: comments verbatim, decisions as a
     list;
   - attachment paths (screenshots: the agent opens them);
   - what to carry over from the previous round;
   - open points;
   - the constraints and project or code facts from the conversation that the
     files do not show.
2. **Spawn.** The session spawns `concept-author` with the Agent tool, `model`
   set to the session's family. The prompt names the source folder, the round
   number, the brief path, the locale and `{PLUGIN_ROOT}`. The agent:
   - reads what § Reading allows;
   - writes `rounds/NN.html`;
   - runs `build`, at most three times;
   - returns a short report: build line, sections, brief point → section,
     assumptions. A build that still fails returns `BLOCKED` with the
     problems. It never deletes content to get past the gate.
3. **Check, then continue.** The session reads the report, not the fragment,
   and holds it against the brief. Before going on it greps the fragment for
   the brief's must-haves (each named section id or label). A `BLOCKED` report
   or a missing point means the session fixes the fragment itself. Then it
   continues with the protocol: `/reload`, `/reset`, waker. The bridge
   protocol, the decisions file and every word to the user stay with the
   session.

The session writes these rounds itself:

- round 1 (the conversation is in its context);
- the final report (the implementation is);
- a reality-check round (Step 5b decides its content);
- every round when the agent is unavailable or the setting is off.
