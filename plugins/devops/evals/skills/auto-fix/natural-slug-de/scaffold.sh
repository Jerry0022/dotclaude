#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > src/slug.js <<'JS'
function slug(text) {
  return text.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
}
module.exports = { slug };
JS
git add -A && git commit -qm init 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
