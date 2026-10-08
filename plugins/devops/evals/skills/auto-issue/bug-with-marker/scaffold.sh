#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
printf 'export function loadSettings(path) {\n  return JSON.parse(require("fs").readFileSync(path, "utf8"));\n}\n' > src/settings.js
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
git remote add origin https://github.com/example-org/settings-demo.git
# Stub gh, first on PATH via prompt.md `path_prepend: [bin]`: logs every
# call to gh-calls.log, answers `gh issue create` (global flags like -R
# allowed before it) with a fixed issue URL and fails everything else, so
# the write succeeds without reaching GitHub. Excluded from git status.
mkdir -p bin
cat > bin/gh <<'STUB'
#!/usr/bin/env bash
root="$(cd "$(dirname "$0")/.." && pwd)"
printf '%s\n' "$*" >> "$root/gh-calls.log"
prev=""
for a in "$@"; do
  if [ "$prev" = issue ] && [ "$a" = create ]; then
    echo "https://github.com/example-org/settings-demo/issues/4242"
    exit 0
  fi
  prev="$a"
done
echo "gh (eval sandbox): only 'gh issue create' is available here" >&2
exit 1
STUB
chmod +x bin/gh
echo bin/ >> .git/info/exclude
echo gh-calls.log >> .git/info/exclude
