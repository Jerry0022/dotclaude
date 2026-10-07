#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > src/total.js <<'JS'
function total(items) {
  let sum = 0;
  for (let i = 1; i < items.length; i++) sum += items[i].price;
  return sum;
}
module.exports = { total };
JS
printf '2026-10-08T10:00:00Z ERROR checkout: cart total mismatch, expected 60, got 50 (item prices 10,20,30)
' > app.log
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
