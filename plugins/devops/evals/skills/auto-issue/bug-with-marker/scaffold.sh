#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
printf 'export function loadSettings(path) {\n  return JSON.parse(require("fs").readFileSync(path, "utf8"));\n}\n' > src/settings.js
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
git remote add origin https://github.com/example-org/settings-demo.git
