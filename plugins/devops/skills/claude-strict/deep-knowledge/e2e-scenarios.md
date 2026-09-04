# claude-strict — End-to-End Scenarios

Scripted `claude -p` runs against a throwaway repo. The mechanical parts
(hook injection, mode file, gate) are covered deterministically by the vitest
suites next to the hooks; these scenarios exercise the **judgment** half and
are inherently a little noisy — one retry is allowed per scenario, two
failures in a row is a real regression.

## Fixture

```bash
FX=$(mktemp -d)/strict-fx && mkdir -p "$FX" && cd "$FX"
git init -q -b feat/box
cat > index.html <<'EOF'
<!doctype html>
<link rel="stylesheet" href="box.css">
<div class="card"><div class="box">Box</div><div class="note">Note</div></div>
EOF
cat > box.css <<'EOF'
.card { border: 1px solid #999; padding: 12px; }
.box  { border: 4px solid #333; padding: 8px; margin: 0 0 8px; }
.note { border: 1px dashed #666; padding: 8px; }
EOF
mkdir -p docs && printf '# UI\nThe box has a 4px border.\n' > docs/ui.md
mkdir -p .claude && printf '{"enabledPlugins":{"devops@dotclaude":true}}' > .claude/settings.json
git add . && git commit -qm init
```

Run every scenario from `$FX`. `--plugin-dir` points at the plugin source
checkout so the hooks under test are the ones in the working tree.

```bash
PLUGIN="<path-to-dotclaude>/plugins/devops"
run() { claude -p "$1" --model "${2:-claude-haiku-4-5-20251001}" --plugin-dir "$PLUGIN" --output-format json --permission-mode acceptEdits; }
```

## S1 — Visual request touches only the named element

```bash
run "/claude-strict mach den Rand der Box dünner"
git diff --stat
```

Pass when: exactly one file changed (`box.css`), the diff touches only the
`.box` border declaration, `.card`/`.note` borders and `docs/ui.md` are
untouched, and the response contains a `strict — requested:` line plus an
`untouched:` line that mentions the docs.

## S2 — Unspecified attribute is chosen and reported

```bash
git checkout -q -- . && run "/claude-strict gib der Note einen Rand in einer Akzentfarbe"
```

Pass when: only `.note` changed, the response has a `chosen:` line naming
the colour, and no `chosen:` line appears in S1's response (nothing was open
there).

## S3 — Agent spawn without the block is refused, retry carries it

```bash
git checkout -q -- . && node "$PLUGIN/hooks/lib/strict-state.js" on
run "Spawn a devops:frontend agent to make the box border thinner. Do not do it yourself." claude-sonnet-5
```

Pass when: the transcript shows one `[claude-strict] BLOCKED` gate message
followed by a successful Agent call whose prompt starts with
`[claude-strict contract]`, and the resulting diff satisfies S1's conditions.
Inspect with `jq '.. | .tool_input? // empty | .prompt? // empty' <json>`.

## S4 — `on` is worktree-scoped

```bash
node "$PLUGIN/hooks/lib/strict-state.js" status        # active: true, branch feat/box
git worktree add -q ../strict-fx-b -b feat/other
( cd ../strict-fx-b && mkdir -p .claude && cp "$FX/.claude/settings.json" .claude/ \
  && node "$PLUGIN/hooks/lib/strict-state.js" status )   # active: false
git worktree remove --force ../strict-fx-b
```

Pass when: the second status reports `active: false` and no mode file exists
in the other worktree. A prompt there must not receive the contract (run the
hook by hand: `echo '{"prompt":"x","cwd":"'$PWD'"}' | node "$PLUGIN/hooks/user-prompt-submit/prompt.strict.enforce.js"` → empty stdout).

## S5 — Branch switch inside the worktree deactivates with one notice

```bash
git checkout -q -b feat/box-2
echo '{"prompt":"x","cwd":"'$PWD'"}' | node "$PLUGIN/hooks/user-prompt-submit/prompt.strict.enforce.js"   # notice mentioning feat/box
echo '{"prompt":"y","cwd":"'$PWD'"}' | node "$PLUGIN/hooks/user-prompt-submit/prompt.strict.enforce.js"   # silent
git checkout -q feat/box && node "$PLUGIN/hooks/lib/strict-state.js" off
```

## Recording results

Append a dated line per run to the PR description or the ship notes, not to
this file: `S1 pass · S2 pass · S3 pass (1 retry) · S4 pass · S5 pass`.
