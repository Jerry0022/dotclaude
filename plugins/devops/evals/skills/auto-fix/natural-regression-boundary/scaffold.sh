#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > src/discount.js <<'JS'
function price(total) {
  if (total >= 100) return total * 0.9;
  return total;
}
module.exports = { price };
JS
git add -A && git commit -qm "feat: discount from 100 EUR"
sed -i 's/total >= 100/total > 100/' src/discount.js
git commit -qam "refactor: tidy discount check"
git add -A && git commit -qm init 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
