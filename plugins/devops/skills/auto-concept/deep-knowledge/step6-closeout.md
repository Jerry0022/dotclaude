# Concept step 6 — disposition, cleanup procedure, completion card

Disposition, the cleanup procedure, durable-store disposal, safety rules and the completion card fields — execution detail of `SKILL.md` Step 6a and 6b, moved here verbatim. Each `##` section below is named by exactly one mandatory pointer in `SKILL.md`, at the place the text used to stand; read it completely before executing that step — it is as binding as the step itself.

## Disposition, cleanup procedure and disposition tables

**Determine the disposition** in this order of preference:

1. The `finalize` payload's `disposition` field → use it directly.
2. Otherwise, the last legacy payload (`dispose-concept`, then
   `create-issues`, then `ship`) that carried a `disposition` field.
3. Otherwise (no payload carried a disposition — old session, user
   aborted, page closed before finishing the close-out): default to
   `{ mode: "discard", moveTo: null }`.

The default = `discard` is deliberate. Most concept sessions are one-shot
refinements whose outcome already landed in commits / GitHub issues /
the implement step. Persisting the HTML in git by default accumulates
silt in `docs/concepts/`. Power users opt in to `keep` or `gitignore`
in the sheet's files block.

**Cleanup procedure (always):**

```bash
curl -s -X POST http://localhost:$PORT/shutdown > /dev/null 2>&1 || true
# Only YOUR state file (#417): a sibling session may have written its own
# since — compare the owner token before deleting.
node -e "const f='.claude/concept-active.json',fs=require('fs');try{const s=JSON.parse(fs.readFileSync(f,'utf8'));if(!s.owner||s.owner===process.argv[1])fs.unlinkSync(f)}catch{}" "$OWNER"
```

**Then stop the watchers — before any card.** `TaskStop` the pulser, the
waker and the bridge-server background tasks by the task IDs their launches
returned. When an ID is unknown (a resumed session that re-armed them
elsewhere), wait for that task's exit notification instead
(`*_EXIT reason=STATE_GONE`, the bridge's own exit after `/shutdown`) — the
watchers see the state file gone within ~1 min. Every exit lands inside this
turn, before the card. One that still arrives after the card (a stray
duplicate watcher) is a silent turn: no text, no title change.

**Restore the session title** (Desktop app only — skip silently elsewhere; deferred is not unavailable — load both tools via `ToolSearch` first, `{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`):
`mcp__ccd_session_mgmt__get_session` `self`; strip every leading devops
prefix (`🧭 Concept – `, `⏳ `, `🚀 Shipping – `, … — the `SESSION_PREFIX`
and `LEGACY_PREFIXES` values). If part C shipped successfully, its ship card
is the closing artefact and no Step 6b card follows — set
`"🚀 Shipped – " + {stripped title}`. Otherwise set the stripped title; the
final card (Step 6b) then sets the outcome prefix (`📦 Ready – `, …). A
title without any prefix is left untouched — the user renamed it meanwhile,
and that name wins.

Then `CronDelete <cron_id>`. `/shutdown` replaces the older `kill $SERVER_PID`:
on Windows the PID could already be reused by an unrelated process, and
swallowing `kill` errors hid that case. The HTTP endpoint targets the live
server by port and is a no-op when the server is already dead. Removing
`concept-active.json` is mandatory — if the file lingers, the next
SessionStart's `ss.concept.resume` hook will surface a phantom resume hint
pointing at a server that no longer exists. Even if `/shutdown` fails (server
already gone, port unbound), the watchdog terminates any surviving instance
once the heartbeats stop — but that is the safety net for a crashed session,
not the close-out path: the close-out stops every task itself, above, and
renders the card only after all of them are gone.

**Apply disposition on the concept files.** Files are named
`docs/concepts/{date}-{slug}.html` and `docs/concepts/{date}-{slug}-decisions.json`
— always include the `{date}-` prefix in patterns; bare `{slug}` does
NOT match. After a ship (part C step 0 already staged and committed the git
half), only the on-disk moves and deletes below remain.

| `mode` | `moveTo` | Action |
|---|---|---|
| `discard` | (any) | `rm -f -- "<html>" "<decisions.json>"` — `moveTo` is ignored. |
| `keep` | null | No file change. Files remain at their original git-tracked path. |
| `keep` | set | `mkdir -p -- "<moveTo>"` then `git mv -- "<html>" "<moveTo>/"` (if tracked, else `mv -- "<html>" "<moveTo>/"`); same for the decisions JSON. Files remain git-tracked at the new path. |
| `gitignore` | null | Files stay at original path. Append `docs/concepts/{date}-{slug}.*` to `.gitignore` if not already covered. Run `git rm --cached -- "<html>" "<decisions.json>"` to untrack them if they were already added. |
| `gitignore` | set | `mkdir -p -- "<moveTo>"` then `mv -- "<html>" "<moveTo>/"`; same for the decisions JSON. Append `<moveTo>/{date}-{slug}.*` to `.gitignore` if not already covered. Run `git rm --cached -- "<original-html>" "<original-decisions.json>"` on the original tracked entries. |

**Also dispose of the durable store.** The bridge keeps every submission,
progress checkpoint and pasted image under
`.claude/concepts/{date}-{slug}/` (§ Durable store in `concept-server.py`).
It is deliberately gitignored and invisible, which is exactly why it needs an
explicit disposition step — otherwise pasted screenshots silt up forever in a
directory nobody looks at.

| `mode` | Store action |
|---|---|
| `discard` | `rm -rf -- ".claude/concepts/{date}-{slug}"` — journal and attachments go with the concept. Subject to the UNPROCESSED guard below. |
| `keep` | Keep the store. If it holds attachments, copy them to `docs/concepts/{date}-{slug}-attachments/` and `git add` them, so the kept record is self-contained instead of pointing into an ignored directory. Skip when there are none. |
| `gitignore` | Leave the store in place — it is already outside git. No extra `.gitignore` entry is needed beyond the blanket `.claude/concepts/` rule. |

## UNPROCESSED guard command, orphan sweep, safety rules, reporting

```bash
store=".claude/concepts/{date}-{slug}"
if [ -e "$store/UNPROCESSED" ]; then
  echo "UNPROCESSED submission in $store — not deleting"
else
  rm -rf -- "$store"
fi
```

When the guard trips: keep the store, and report it as a `⏸ Rückfrage`-style
line in the completion card naming the directory, so the user can decide.
Never resolve it by deleting.

**Orphan sweep.** A store whose concept HTML no longer exists — the file was
deleted manually, a worktree was wiped, an older session never ran cleanup —
is an orphan. So is a `port-<n>/` store: a bridge started without `--html`
(older test runs did this, #342) anchors its store under that name, and no
`docs/concepts/port-<n>.html` ever exists, so the same rule catches it. Sweep
those whose `state.json` is older than 7 days, applying the same UNPROCESSED
guard to each:

```bash
for d in .claude/concepts/*/; do
  slug="$(basename "$d")"
  [ -e "docs/concepts/$slug.html" ] && continue          # live concept
  [ -e "$d/UNPROCESSED" ] && continue                    # unseen work — keep
  [ -n "$(find "$d/state.json" -mtime +7 2>/dev/null)" ] && rm -rf -- "$d"
done
```

**Safety rules:**

- `moveTo` is treated as a project-relative path. Resolve it relative to
  the project root (NOT the worktree root if you happen to be in one).
  Reject any path that resolves outside the project root, contains
  `..`, or is absolute — fall back to the non-`moveTo` branch and
  surface a warning to the user.
- All path-bearing shell commands (`rm`, `mv`, `git mv`, `git rm`,
  `mkdir`) MUST use the `--` argument terminator AND double-quote
  every path interpolation, so `moveTo` values containing spaces or
  shell metacharacters land as a single literal argument. Never
  inline a raw `{path}` substitution.
- `.gitignore` patterns use the FULL filename including the date
  prefix (`docs/concepts/{date}-{slug}.*`), NOT bare `{slug}.*` — the
  shorter pattern silently fails to match the timestamp-prefixed
  files this skill produces.
- Never delete a file that does NOT match the
  `docs/concepts/{date}-{slug}.*` pattern for THIS session's slug.
  Other concept HTML files in `docs/concepts/` belong to other
  sessions and MUST be preserved.
- The same applies to the store: `rm -rf` exactly
  `.claude/concepts/{date}-{slug}` and nothing else. A parallel concept
  session in another worktree has its own directory next to it, and a
  glob that catches it destroys a live bridge's state. Never
  `rm -rf .claude/concepts/*` outside the guarded orphan sweep above.
- `.gitignore` edits are append-only. Before appending, grep for an
  existing exact match (the full `docs/concepts/{date}-{slug}.*` line)
  — if it already exists, skip the append. Never rewrite or reorder
  the file.
- If `git rm --cached` errors because the file was never tracked,
  swallow the error and continue — the file is already in the right
  state for `.gitignore`.

**Reporting:** the completion card's `changes` array should include one
short line describing the disposition action that was applied (e.g.
"Concept-Files verworfen", "Concept-Files behalten unter docs/architecture/",
"Concept-Files in .gitignore aufgenommen"). Skip this line for the
default `discard` path when the user explicitly aborted the session
without ever opening the final-report panel.

## 6b · Variant and card fields

| Situation | Variant |
|-----------|---------|
| Concept was the primary task (read-only result) | `analysis` |
| Concept submitted decisions → Claude executed code changes in Step 5b | `ready` (code edits happened) |
| Concept discarded / user aborted | `aborted` |

Pass: `variant`, `summary` (e.g. "Concept auth-middleware-redesign finalized"),
`lang`, `session_id`, `changes` (what the concept covered and which decisions
were acted on), and `state` when files changed. Do **not** pass `concept` here —
the concept is closed; that field belongs to the mid-concept cards only (Step 3
§ Completion cards while the concept is open).
