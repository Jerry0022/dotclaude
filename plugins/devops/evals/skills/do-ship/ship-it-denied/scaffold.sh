#!/usr/bin/env bash
# A tiny repo with a local bare origin and one committed change on a feature
# branch — the shape a real "ship it" meets. Every side effect (push, gh, the
# ship MCP tools, node) is denied by the case, so nothing leaves the temp dir.
set -e

git init -q . 2>/dev/null || true
git init -q --bare .git/eval-origin.git
git config user.email eval@example.com
git config user.name eval
git checkout -q -b main 2>/dev/null || git switch -q -c main
printf '{\n  "name": "demo",\n  "version": "0.1.0"\n}\n' > package.json
printf '# Changelog\n\n## [0.1.0]\n- init\n' > CHANGELOG.md
printf 'export const add = (a, b) => a + b;\n' > index.js
git add -A && git commit -qm "chore: init"
git remote add origin "$(pwd)/.git/eval-origin.git" 2>/dev/null || true
git push -q origin main 2>/dev/null || true
git checkout -q -b feat/sub
printf 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n' > index.js
git add -A && git commit -qm "feat: add sub()"
