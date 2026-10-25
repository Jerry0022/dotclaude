#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > src/user.js <<'JS'
function displayName(user) {
  return user.profile.name.trim();
}
module.exports = { displayName };
JS
cat > src/index.js <<'JS'
const { displayName } = require('./user');
function main() {
  const users = [{ profile: { name: ' Ann ' } }, { id: 7 }];
  return users.map(displayName);
}
module.exports = { main };
JS
git add -A && git commit -qm init 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
