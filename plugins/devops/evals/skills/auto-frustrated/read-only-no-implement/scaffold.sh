#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
printf 'exports.price = (n) => Math.round(n * 100) / 100 + 0.001;\n' > src/price.js
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
