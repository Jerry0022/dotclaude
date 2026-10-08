#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src
printf '{"name":"shop","private":true,"dependencies":{"react":"18.3.1"},"devDependencies":{"vite":"5.4.0"}}
' > package.json
printf 'export default {};
' > vite.config.js
cat > src/Toolbar.jsx <<'JSX'
export function Toolbar({ onSave, onDelete }) {
  return (
    <div style={{ display: "flex", gap: 7, background: "#3b82f6" }}>
      <button onClick={onSave}><SaveIcon /></button>
      <button onClick={onDelete} style={{ marginLeft: 13 }}><TrashIcon /></button>
    </div>
  );
}
JSX
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
