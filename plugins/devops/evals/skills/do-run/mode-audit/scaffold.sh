#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
printf '# notes-cli\n\nA tiny CLI that stores notes in notes.json. Promise: `add` never loses an existing note.\n' > README.md
mkdir -p src
printf 'const fs = require("fs");\nexports.add = (t) => { fs.writeFileSync("notes.json", JSON.stringify([t])); };\n' > src/notes.js
printf 'const { add } = require("./notes");\nadd(process.argv[2]);\n' > src/cli.js
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
