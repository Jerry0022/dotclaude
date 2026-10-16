#!/usr/bin/env bash
# A small Node project with one open storage decision. The bridge, the
# browser, crons and process kills are denied in prompt.md, so the run can
# build the page but never serve or open it.
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
git checkout -q -b main 2>/dev/null || git switch -q -c main
cat > README.md <<'MD'
# notes-cli

A small CLI that stores personal notes. Notes are currently kept in memory
and lost on exit; persistence is the next step.
MD
cat > package.json <<'JSON'
{ "name": "notes-cli", "version": "0.1.0", "private": true, "main": "index.js" }
JSON
cat > index.js <<'JS'
const notes = [];
function add(text) { notes.push({ id: notes.length + 1, text, at: Date.now() }); }
function list() { return notes.slice(); }
module.exports = { add, list };
JS
git add -A && git commit -qm "chore: init"
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
