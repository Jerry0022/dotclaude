#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
mkdir -p data
echo '{"theme":"dark"}' > data/settings.json
cat > src/settings.js <<'JS'
const fs = require('fs');
const path = require('path');
function load() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'setting.json'), 'utf8'));
}
module.exports = { load };
JS
printf "2026-10-08T10:00:00Z ERROR startup: ENOENT: no such file or directory, open '/app/data/setting.json'\n" > app.log
git add -A && git commit -qm init 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
