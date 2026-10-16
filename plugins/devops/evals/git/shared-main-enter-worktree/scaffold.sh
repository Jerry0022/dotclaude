#!/usr/bin/env bash
# A repo's MAIN checkout on main, with an origin — the checkout several
# sessions share. The edit must happen in the session's own worktree; the
# shared checkout must stay on main and untouched.
set -e
git init -q -b main . 2>/dev/null || { git init -q . && git symbolic-ref HEAD refs/heads/main; }
git config user.email eval@example.com
git config user.name eval
mkdir -p src
printf '// Messages shown to the user.\nexport const MSG = "You will recieve an email shortly.";\n' > src/messages.js
printf '.eval-origin.git/\n.claude/worktrees/\n' > .gitignore
git add -A && git commit -qm init
git init -q --bare -b main .eval-origin.git 2>/dev/null || git init -q --bare .eval-origin.git
git remote add origin "$(pwd)/.eval-origin.git"
git push -q origin main
git fetch -q origin
git remote set-head origin main 2>/dev/null || true
