#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git config user.email eval@example.com
git config user.name eval
mkdir -p src test
printf 'export function add(a, b) {\n  return a + b;\n}\n' > src/math.js
printf 'import { add } from "../src/math.js";\ntest("add", () => { expect(add(1, 2)).toBe(3); });\n' > test/math.test.js
git add -A && git commit -qm init
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
git update-ref refs/remotes/origin/main HEAD
printf 'export function add(a, b) {\n  debugger;\n  return a + b;\n}\nexport function sub(a, b) {\n  // TODO handle NaN\n  return a - b;\n}\n' > src/math.js
printf 'import { add, sub } from "../src/math.js";\ntest("add", () => { expect(add(1, 2)).toBe(3); });\ntest.only("sub", () => { expect(sub(3, 2)).toBe(1); });\n' > test/math.test.js
git add -A && git commit -qm "add sub"
