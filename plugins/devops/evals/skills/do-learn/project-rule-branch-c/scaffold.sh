#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
printf '{"name":"shop","private":true}
' > package.json
printf '# shop
' > README.md
mkdir -p db/migrations
printf 'create table orders (id int);
' > db/migrations/001_orders.sql
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
