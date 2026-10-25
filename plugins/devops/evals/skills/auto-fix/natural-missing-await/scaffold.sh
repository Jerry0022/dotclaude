#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
cat > src/config.js <<'JS'
async function loadConfig() {
  return { port: 8080 };
}
module.exports = { loadConfig };
JS
cat > src/server.js <<'JS'
const { loadConfig } = require('./config');
async function start() {
  const cfg = loadConfig();
  return cfg.port;
}
module.exports = { start };
JS
git add -A && git commit -qm init 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
