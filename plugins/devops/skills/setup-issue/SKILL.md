---
name: setup-issue
version: 0.3.0
description: >-
  Create GitHub issues — or refine / update existing ones — with enforced title
  format, labels, and optional milestone and project board integration. Also
  handles milestone creation and naming. The single owner of every issue write
  in this plugin: skills, agents and hooks that need an issue created or edited
  delegate here instead of calling `gh issue create` / `gh issue edit`. Use
  when the user wants to create a GitHub issue, refine or change an existing
  one, plan a milestone, or manage issue lifecycle. Triggers on: "neues Issue",
  "create issue", "Issue erstellen", "mach ein Issue", "new issue", "refine
  issue", "Issue refinen", "Issue ergänzen", "Issue anpassen", "update issue",
  "milestone planen", "plan a milestone".
  Do NOT trigger for: PR creation (use /ship), plain commits,
  or code implementation.
layer: 2
invokes: []
triggers:
  en: ["create issue", "new issue", "refine issue", "update issue", "plan a milestone"]
  de: ["neues Issue", "Issue erstellen", "mach ein Issue", "Issue refinen", "Issue ergänzen", "Issue anpassen", "milestone planen"]
allowed-tools: Bash(gh *), AskUserQuestion, Read, Grep, mcp__plugin_devops_dotclaude-issues__*, mcp__plugin_devops_dotclaude-completion__render_completion_card
---

# Setup Issue — GitHub Issue & Milestone Management

Create issues and milestones with enforced formatting and optional board
integration, and refine existing issues in place. Every GitHub issue write in
the plugin goes through this skill (`{PLUGIN_ROOT}/deep-knowledge/plugin-behavior.md` →
"Issue Creation & Editing — Always Delegate").

## Invocation modes

| Mode | When | Steps |
|---|---|---|
| **create** (default) | no existing issue is named | Step 1 → 1a → 2 → 3 → 4 → 5 |
| **refine** | an existing issue number / URL is named, or a caller hands over `{issue}` | Step 1 → 1a → R1 → R2 → R3 → 5 |

### Caller hand-over (non-interactive)

Other skills and agents (`/run-backlog` Step 2, `/concept` `create-issues`,
`/claude-learn`, `/claude-batch`, the `po` agent) invoke this skill through the
**Skill** tool with a self-contained prompt. When the hand-over carries every
required field, **no `AskUserQuestion` fires** — the caller already made the
decisions (or runs under a zero-prompt invariant) and a question here is a UX
regression. Ask only when a required field is missing **and** the user is
present; otherwise apply the documented default silently and report the
omission in the card.

Hand-over fields — create: `title`, `type`, `body` (with the
`**User value:**` line), optional `target_repo`, `labels`, `milestone`.
Refine: `issue` (number or URL), `refinement` (the section content, see R2),
optional `title`, `type`, `labels`, `milestone`, `target_repo`. The caller
supplies content; this skill supplies format, gate, labels, board, verify and
the card.

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/setup-issue/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/setup-issue/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

**Project extensions define:**
- GitHub owner and project board ID
- Additional required labels (e.g., `role:*`, `module:*`)
- GraphQL field IDs for board status/custom fields
- Milestone naming preferences

## Step 1 — Gather details

Determine from user input or the caller hand-over; ask via AskUserQuestion
only for what is still missing (see "Caller hand-over" above):
- **Mode**: `refine` when an issue number / URL / `{issue}` is given, else `create`
- **Title**: Must follow `[TYPE] Short imperative description` format
- **Type**: bug, feature, refactor, chore, design, docs
- **Description**: Imperative mood, sentence case, no trailing period
- **Target repo** (`{target_repo}`): an `owner/name` slug when the issue belongs
  to a **different** repository than the session's. Absent → the current repo.

If project extension defines additional required fields (roles, modules), ask for those too.

In `refine` mode, title / type / description come from the existing issue
(`gh issue view {issue} --json number,title,body,labels,milestone,state,url`
— with `--repo "{target_repo}"` when set) and are only *checked*, not asked:
a title that violates the format (or uses `[FIX]`) is corrected in R3, never
questioned. A closed issue is refined only when the caller says so
explicitly; otherwise stop and report it.

### Target repo — when a caller hands one over

Callers route issues to other repositories: `/claude-learn` files a plugin
defect against the plugin source repo from inside a consumer project, and files
a cross-project learning against that project. **An issue silently created in
the wrong repo is worse than none** — it looks successful, returns a valid URL,
and leaves the real repo untouched.

- Carry `{target_repo}` through to Step 2 as `--repo`, to Step 3's skip
  condition, and to Step 4's check.
- Labels, milestones, and board fields configured for the *current* project do
  not necessarily exist in `{target_repo}`. Verify with
  `gh label list --repo {target_repo}` before sending any label — **including
  `type:*`**: `gh issue create` hard-fails on an unknown label, and a target
  repo that never adopted the `type:` scheme would reject every issue. Missing
  there → create the issue without it and say so, rather than losing the issue.
  Drop milestone/board steps unless the target is configured for them.

## Step 1a — User-value gate (mandatory)

Apply the gate from deep-knowledge/issue-rules.md to EVERY issue before
creating or refining it: implementing this one issue alone must already
produce a positive user effect — direct (feature, visual, bug fixed, fewer
crashes) or indirect (performance, stability, security). In `refine` mode an
existing body without the `**User value:**` line gets one written in R2 —
an issue that cannot honestly carry that line is reported as failing the
gate, not silently refined.

- Fails the gate ("only valuable together with other issues") → do NOT
  create it. Bundle the technical sub-tasks into ONE issue scoped by the
  user value they jointly deliver, sub-tasks as a checklist in the body.
- Multiple issues in one request: gate each one in isolation. If several
  only pass together, propose the merged issue(s) to the user instead of
  creating the originals.
- Milestones may aggregate issues into a larger goal, but never use a
  milestone to justify member issues that fail the gate individually.

## Step 2 — Create the issue

```bash
gh issue create --title "[TYPE] Title" --body "Description" --label "type:X"  # via setup-issue
```

**With a `{target_repo}` from Step 1, `--repo` is mandatory** — without it `gh`
creates the issue in whatever repo the CWD happens to be:

```bash
gh issue create --repo "{target_repo}" --title "[TYPE] Title" --body "Description" --label "type:X"  # via setup-issue
```

Every `gh issue create` / `gh issue edit` this skill runs carries the trailing
`# via setup-issue` marker comment shown above — `pre.issue.guard` lets a
marked write through only while this skill runs in the current turn
(everyone else's raw `gh issue` call is blocked). Never drop the marker when
composing the command (a multi-line `\` / PowerShell-backtick continuation is
fine), and never add it to a command this skill itself did not construct.

**Never pass the body on stdin via a heredoc** (`--body-file - <<'EOF'`): the
body lines follow the opener on new lines, so the marker no longer sits on the
`gh` command's own segment and the guard blocks the write. For a multi-line
body use a command substitution or a temp file instead:

```bash
gh issue create --title "[TYPE] Title" --body "$(cat <<'EOF'
Description

**User value:** <direct or indirect effect>
EOF
)" --label "type:X"  # via setup-issue
```

or write the body to a temp file and pass `--body-file "{tmp}/body.md"`.

The body MUST include the user-value line (see deep-knowledge/issue-rules.md):
`**User value:** <direct or indirect effect>`

Add optional flags based on project extension:
- `--label "role:Y,module:Z"` — if project defines these label categories
- `--milestone "Name"` — if milestones are configured

## Step 3 — Add to project board (if configured)

Only if the project extension provides owner + project ID — **and the issue
landed in this session's own repository**. Compare `{target_repo}` against the
current repo case-insensitively (same comparison as Step 4.5); equal, or unset,
means the board applies. The board configured here belongs to the current
project, and GitHub happily accepts cross-repo project items, so without this
guard an issue filed into someone else's repository shows up on this project's
board. A `{target_repo}` that merely names the current repo — callers pass the
slug through rather than checking — must not lose its board item.

Add the issue to the project board via the GitHub API.

Set custom fields (e.g., "Agent Role") via GraphQL if field IDs are provided in project extension.

## Step 4 — Verify

Confirm all required parameters are set:
1. User-value gate passed and body contains the `**User value:**` line
2. Labels: at least `type:*` (plus any project-specific requirements) — unless
   Step 1 dropped a label the target repo does not have, which is a reported
   omission, not a failure
3. Milestone: if configured
4. Project board item: if configured **and** Step 3 did not skip it for a
   cross-repo issue

Verify what Steps 1–3 were actually told to produce. A requirement that those
steps deliberately skipped is met, not missing — reporting a successfully
created issue as a hard failure is its own defect.
5. **Landing repo** — when Step 1 set `{target_repo}`, the `owner/name` in the
   returned issue URL MUST match it, **compared case-insensitively** (GitHub
   slugs are case-insensitive, and callers pass through whatever casing their
   metadata carries — a case-sensitive check would fail a correctly filed
   issue). A real mismatch means the issue was created in the wrong repository:
   say so plainly, give the wrong URL, and do not report success. Close the
   misfiled issue only if the user asks.

Missing required items = hard error. Fix before reporting success.

## Refine mode — update an existing issue

The write-back path for every skill that enriches an issue after analysis
(`/run-backlog` Step 2 "Refine → issue", `/concept` follow-ups, a user asking
to "refine #NNN"). The original body is **never rewritten** — the refinement
is one managed section the skill owns and can replace on the next run.

### R1 — Fetch and diff

`gh issue view` from Step 1 gives the current title, body, labels and
milestone. Compare against the hand-over: what is new (refinement section),
what is a correction (title format, missing `type:*`, missing milestone) and
what is already in place (no-op — never rewrite unchanged fields, every edit
is a notification to watchers).

### R2 — Managed refinement section

Compose the section from the hand-over `refinement` (or, on direct user
invocation, from the conversation) between two HTML markers, so a second
refinement replaces the first instead of stacking:

```markdown
<!-- refinement:start -->
## Refinement

**User value:** <one line — only when the original body has none>

### Acceptance criteria
- [ ] <observable, testable outcome>
- [ ] …

### Implementation plan
1. <file / area → change>
2. …

### Decisions
- <question → resolution, with the reason>

_Refined <YYYY-MM-DD> by <skill or "session">; size <S|M|L>._
<!-- refinement:end -->
```

Rules for the section:
- Acceptance criteria are outcomes, not tasks — the tester must be able to
  tick each one without reading the code.
- `Decisions` lists every open question the analysis resolved, so a later
  autonomous run never re-asks it.
- A `**User value:**` line already present in the original body stays there;
  the section does not add a second one.
- Project extensions may add sections (`## Test plan`, rollout notes …) —
  they go inside the markers as well.

Write it back with the body from R1: replace the text between existing
markers, else append the section after the original body (one blank line in
between):

```bash
gh issue edit {issue} --body-file "{tmp}/body.md"  # via setup-issue — add --repo "{target_repo}" when set
```

Build `body.md` from the fetched body — never from memory of what the issue
"probably" says — and never touch the text above the markers.

### R3 — Metadata corrections

Apply only what R1 flagged:
- Title not in `[TYPE] …` form, or `[FIX]` → `gh issue edit {issue} --title "[TYPE] …"  # via setup-issue`
- No `type:*` label → `--add-label "type:<type>"` (verify the label exists in
  `{target_repo}` first, as in Step 1) — same `gh issue edit … # via setup-issue` form
- Hand-over names a milestone that is not set → `--milestone "<name>"` — same
  `gh issue edit … # via setup-issue` form
- Extension labels (`role:*`, `module:*`) resolved the same way as in Step 2

Every metadata correction is its own `gh issue edit {issue} <flags>  # via
setup-issue` call (or flags combined into one call) — never omit the marker,
R3's edits are exactly the raw commands `pre.issue.guard` would otherwise block.

Then verify like Step 4: re-run `gh issue view`, check exactly one
`<!-- refinement:start -->` … `<!-- refinement:end -->` pair, exactly one
`**User value:**` line, a conforming title, a `type:*` label. Anything missing
= hard error, fix before the card.

## Milestone Creation

See deep-knowledge/milestone-rules.md for naming conventions and level prefixes.

## Step 5 — Completion Card

After the issue/milestone is created or refined and verified, call
`mcp__plugin_devops_dotclaude-completion__render_completion_card` with variant
`fallback` (no code change, no ship — just a GitHub artifact created or
updated).

Pass: `variant: "fallback"`, `summary` (e.g. "Issue #123 created" /
"Issue #123 refined"), `lang`, `session_id`, and `changes` (issue number →
title, labels, milestone; in refine mode also what R3 corrected).
Output the markdown VERBATIM as the LAST thing in the response.

**Invoked from another skill mid-flow** (hand-over): return control to the
caller **without** rendering a card — the caller's own card reports the
issues created / refined. Only a direct user invocation ends with the card.

## Rules

- Every issue passes the user-value gate on its own (deep-knowledge/issue-rules.md) —
  never create file-level/layer-level tasks that only deliver value in combination
- This skill owns every issue write: other skills, agents and hooks delegate
  here via the Skill tool and never run `gh issue create` / `gh issue edit`
  themselves
- Refine mode edits only its own managed section and flagged metadata — the
  author's original text is never rewritten or reordered
- Never use `[FIX]` — bugs are always `[BUG]`
- Always link PRs to issues via `Closes #NNN` in PR body
- Re-evaluate milestone level prefix when issues are added/removed
- Issue status tracking (In Progress / Done) is handled by hooks, not this skill
