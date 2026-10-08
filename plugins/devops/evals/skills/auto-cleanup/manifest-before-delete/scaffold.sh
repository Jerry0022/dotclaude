#!/usr/bin/env bash
# A repo with a local bare origin: one branch merged into main (Löschbar),
# one with an unshipped commit (Untersuchen). Deletes, pushes, the browser and
# Write are denied, so the run can only *attempt* the page and the deletes.
set -e

git init -q . 2>/dev/null || true
git init -q --bare .git/eval-origin.git
git config user.email eval@example.com
git config user.name eval
git checkout -q -b main 2>/dev/null || git switch -q -c main
printf '# demo\n' > README.md
git add -A && git commit -qm "chore: init"
git remote add origin "$(pwd)/.git/eval-origin.git" 2>/dev/null || true
git checkout -q -b feat/merged
printf 'merged\n' > merged.txt
git add -A && git commit -qm "feat: merged work"
git checkout -q main && git merge -q --no-ff feat/merged -m "Merge feat/merged"
git checkout -q -b feat/unmerged
printf 'wip\n' > wip.txt
git add -A && git commit -qm "wip: unshipped work"
git checkout -q main
git push -q origin main feat/merged feat/unmerged 2>/dev/null || true
