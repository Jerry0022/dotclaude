import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("./run-contract-calls.js");

describe("commandFacts", () => {
  test.each([
    ["git commit -m x", { commit: true }],
    ['git add -A && git commit -q -m "a && b; c"', { commit: true }],
    ["git -c core.x=y commit -m x", { commit: true }],
    ["FOO=1 git commit -m x", { commit: true }],
    ["git commit --dry-run", { commit: false }],
    ['echo "git commit -m x"', { commit: false }],
    ["git commit-tree x", { commit: false }],
  ])("%s", (cmd, want) => {
    expect(C.commandFacts(cmd)).toMatchObject(want);
  });

  test.each([
    ["git checkout -b fix/1", "fix/1"],
    ["git fetch -q origin && git checkout -q -b fix/473 origin/main", "fix/473"],
    ["git checkout -B x", "x"],
    ["git switch -c feat/y", "feat/y"],
    ["git switch -q -C feat/z", "feat/z"],
    ["git worktree add ../wt -b feat/w main", "feat/w"],
    ["git worktree add ../wt2", "wt2"],
  ])("branch: %s", (cmd, name) => {
    expect(C.commandFacts(cmd)).toMatchObject({ branch: true, branchName: name });
  });

  test.each([["git checkout main"], ["git switch main"], ["git worktree list"], ['echo "git checkout -b x"']])("no branch: %s", (cmd) => {
    expect(C.commandFacts(cmd).branch).toBe(false);
  });

  test("render-card path, quoted and bare", () => {
    expect(C.commandFacts('node "C:/p/mcp-server/index.js" --render-card "C:/t/card one.json"').renderCard).toBe("C:/t/card one.json");
    expect(C.commandFacts("node index.js --render-card /tmp/c.json").renderCard).toBe("/tmp/c.json");
    expect(C.commandFacts("node other.js --render-card x").renderCard).toBeNull();
  });

  test("AUD-008: --render-card inside a quoted string (unrelated command) is never mistaken for the renderer", () => {
    expect(C.commandFacts('grep "index.js --render-card x" file.txt').renderCard).toBeNull();
    expect(C.commandFacts('echo "run node index.js --render-card /tmp/c.json manually"').renderCard).toBeNull();
  });

  test("AUD-008: a quoted renderer path (Windows path with spaces) is still found", () => {
    expect(C.commandFacts('node "C:/p/mcp server/index.js" --render-card "C:/t/card one.json"').renderCard).toBe("C:/t/card one.json");
  });

  test("RT2-R1: a `;` inside an earlier quoted string still finds the renderer call", () => {
    expect(C.commandFacts('echo "a;b"; node "C:/p/mcp-server/index.js" --render-card c.json').renderCard).toBe("c.json");
  });

  test("RT2-R1: a `|` inside an earlier quoted string still finds the renderer call", () => {
    expect(C.commandFacts('echo "a|b" | node "C:/p/index.js" --render-card "C:/t/c.json"').renderCard).toBe("C:/t/c.json");
  });

  test("RT2-R1: the already-working single-segment case is unaffected", () => {
    expect(C.commandFacts('node "C:/p/mcp-server/index.js" --render-card c.json').renderCard).toBe("c.json");
  });
});

describe("H-X4: the executable at command position", () => {
  const enc = (s) => Buffer.from(s, "utf16le").toString("base64");
  test.each([
    ['& "C:\\Program Files\\Git\\cmd\\git.exe" commit -m x'],
    ["& 'C:\\Program Files\\Git\\cmd\\git.exe' commit"],
    ['"/c/Program Files/Git/bin/git" commit -m x'],
    ["/usr/bin/git commit -m x"],
    ["git.exe commit -m x"],
    ["sudo git commit -m x"],
    ["sudo -u bob git commit -m x"],
    ["env git commit -m x"],
    ["env A=1 git commit -m x"],
    ["env -i A=1 B=2 git commit"],
    ["command git commit -m x"],
    ["exec git commit -m x"],
    ["time git commit -m x"],
    ["nice -n 10 git commit -m x"],
    ["nohup git commit -m x"],
    ["timeout 30 git commit -m x"],
    ['sh -c "git commit -m x"'],
    ["bash -c 'git add -A && git commit -m x'"],
    ['bash -lc "git commit -m x"'],
    ['cmd /c "git commit -m x"'],
    ["cmd.exe /C git commit -m x"],
    ['pwsh -Command "git commit -m x"'],
    ['powershell -NoProfile -ExecutionPolicy Bypass -Command "git commit -m x"'],
    ["powershell.exe -c 'git commit'"],
    ['eval "git commit -m x"'],
    ['echo "a;b" & git commit -m x'],
    ['bash -c "sudo \\"/c/Program Files/Git/bin/git\\" commit"'],
    ["x=1; (git commit -m x)"],
  ])("H-X4: commit found: %s", (cmd) => {
    expect(C.commandFacts(cmd).commit).toBe(true);
  });

  test.each([
    ["(cd sub && git commit)"],
    ["{ git add -A; git commit;}"],
    ["git ls-files -m | xargs git commit -m x"],
    ["find . -name '*.js' | xargs -0 -n 1 git commit -m x"],
    ["echo $(git commit -m x)"],
    ['msg="$(git commit -m x)"'],
    ["out=`git commit -m x`"],
    ['env -S "git commit -m x"'],
    ["env --split-string='git commit -m x'"],
    ["Start-Process git -ArgumentList 'commit -m x' -Wait -NoNewWindow"],
    ["Start-Process -FilePath git -ArgumentList 'commit','-m','x'"],
    ['Start-Process "C:\\Program Files\\Git\\cmd\\git.exe" \'commit -m x\''],
    ["saps git -Args 'commit -m x'"],
  ])("H-X4b: commit found: %s", (cmd) => {
    expect(C.commandFacts(cmd).commit).toBe(true);
  });

  test.each([
    ["(cd sub && git status)"],
    ["git ls-files | xargs echo git commit"],
    ["echo '$(git commit -m x)'"],
    ['echo "\\$(git commit -m x)"'],
    ["echo '`git commit`'"],
    ["env git commit-tree -S x"],
    ["Start-Process notepad -ArgumentList 'git commit'"],
    ["Start-Process git -ArgumentList 'status'"],
    ['Write-Host "HEAD: $(git rev-parse HEAD)"'],
  ])("H-X4b: no commit: %s", (cmd) => {
    expect(C.commandFacts(cmd).commit).toBe(false);
  });

  test("H-X4b: a heredoc message body is text — its lines are never branch creations", () => {
    const cmd = "git commit -m \"$(cat <<'EOF'\nfeat: x\n\ngit checkout -b feat/y\nEOF\n)\"";
    expect(C.commandFacts(cmd)).toMatchObject({ commit: true, branch: false });
    const pr = "gh pr create --body \"$(cat <<'EOF'\ngit switch -c z\nEOF\n)\"";
    expect(C.commandFacts(pr)).toMatchObject({ commit: false, branch: false });
  });

  test("H-X4b: env -S before the command only — `git commit -S` (sign) still is a commit", () => {
    expect(C.commandFacts("env git commit -S -m x").commit).toBe(true);
    expect(C.commandFacts("(git checkout -b feat/q)")).toMatchObject({ branch: true, branchName: "feat/q" });
  });

  test("H-X4: pwsh -EncodedCommand payload is decoded", () => {
    expect(C.commandFacts(`pwsh -EncodedCommand ${enc("git commit -m x")}`).commit).toBe(true);
  });

  test.each([
    ['echo "git commit"'],
    ['git log --grep "commit"'],
    ["git log --grep commit"],
    ['grep -r "gh pr merge" .'],
    ["echo sudo git commit"],
    ["command -v git"],
    ['bash script.sh "git commit"'],
    ['printf "%s" "bash -c \'git commit\'"'],
    ["git commit --dry-run"],
    ["git 2>&1 status"],
    ["cmd /c echo git"],
  ])("H-X4: no commit: %s", (cmd) => {
    expect(C.commandFacts(cmd).commit).toBe(false);
  });

  test.each([
    ['& "C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 12 --squash'],
    ['"C:/tools/gh.exe" pr merge 1'],
    ["sudo gh pr merge 1"],
    ['bash -c "gh pr merge 1"'],
  ])("H-X4: release found: %s", (cmd) => {
    expect(C.commandFacts(cmd).release).toBe(true);
  });

  test.each([['grep -r "gh pr merge" .'], ['echo "gh pr merge 1"'], ["gh pr view 1"]])("H-X4: no release: %s", (cmd) => {
    expect(C.commandFacts(cmd).release).toBe(false);
  });

  test.each([
    ["git checkout --orphan x", "x"],
    ["git switch --create=x", "x"],
    ["git switch --create x", "x"],
    ["git switch --force-create x", "x"],
    ["git switch -C x", "x"],
    ['& "C:\\Program Files\\Git\\cmd\\git.exe" checkout -b feat/q', "feat/q"],
    ["sudo git switch -c feat/s", "feat/s"],
    ['bash -c "git checkout -b feat/b"', "feat/b"],
    ['git -C "C:/my repo" checkout -b feat/c', "feat/c"],
  ])("H-X4: branch: %s", (cmd, name) => {
    expect(C.commandFacts(cmd)).toMatchObject({ branch: true, branchName: name });
  });

  // Spec: branch creation is `git checkout -b` / `git switch -c` (an item
  // boundary means you start working on the branch). `git branch <name>`
  // creates without switching and stays out; `git worktree add -b` is
  // covered as a (non-item) worktree branch.
  test.each([["git branch feat/x"], ['echo "git switch -c x"']])("H-X4: no branch: %s", (cmd) => {
    expect(C.commandFacts(cmd).branch).toBe(false);
  });

  test("H-B16: a quoted delimiter earlier in the command keeps the raw branch name", () => {
    expect(C.commandFacts('git commit -m "a; b" && git checkout -b "feat-1-sub"')).toMatchObject({ commit: true, branch: true, branchName: "feat-1-sub" });
    expect(C.commandFacts("git commit -m 'x | y' ; git switch -c feat/2").branchName).toBe("feat/2");
  });

  test("H-X4: an unmatched quote is a literal character, never hides a later commit", () => {
    expect(C.commandFacts("echo it's; git commit -m x").commit).toBe(true);
  });
});

describe("H-B1: contractRoots", () => {
  const pr = (p) => `ROOT(${p})`;
  test("H-B1: MCP tools add tool_input.cwd's root second", () => {
    expect(C.contractRoots({ cwd: "a", tool_name: C.RENDER_CARD, tool_input: { cwd: "b" } }, pr))
      .toEqual({ root: "ROOT(a)", inputRoot: "ROOT(b)", roots: ["ROOT(a)", "ROOT(b)"] });
  });
  test("H-B1: non-MCP tools and the same root use the session root only", () => {
    expect(C.contractRoots({ cwd: "a", tool_name: "Bash", tool_input: { cwd: "b" } }, pr).roots).toEqual(["ROOT(a)"]);
    expect(C.contractRoots({ cwd: "a", tool_name: C.SHIP_RELEASE, tool_input: { cwd: "a" } }, pr).roots).toEqual(["ROOT(a)"]);
  });
});

describe("isGatedPath", () => {
  const root = path.join(os.tmpdir(), "rc-root");
  test.each([
    ["src/a.js", true], [".claude/x", false], [".git/HEAD", false], ["docs/concepts/a.html", false],
    ["docs/x.md", true], ["BACKLOG-1.md", false], ["sub/AUTONOMOUS-x.md", false], ["BURN-a.md", false],
    [path.join(os.tmpdir(), "elsewhere.md"), false], ["", false],
  ])("%s → %s", (p, want) => {
    expect(C.isGatedPath(root, root, p)).toBe(want);
  });
});

test("closesOf", () => {
  expect(C.closesOf("Closes #473\nCloses #474\nfixes #5, Resolves: #6, see #7")).toEqual(["473", "474", "5", "6"]);
  expect(C.closesOf(undefined)).toEqual([]);
});

test("cardFacts", () => {
  expect(C.cardFacts({ variant: "ready" })).toEqual({ variant: "ready", final: true });
  expect(C.cardFacts({ variant: "ready", pending: [] }).final).toBe(true);
  expect(C.cardFacts({ variant: "ready", pending: [""] }).final).toBe(true);
  expect(C.cardFacts({ variant: "ready", pending: "x" }).final).toBe(false);
  expect(C.cardFacts({ variant: "ready", concept: { url: "u" } }).final).toBe(false);
  expect(C.cardFacts({ variant: "ship-blocked" }).final).toBe(false);
});

test("releaseResult", () => {
  expect(C.releaseResult([{ type: "text", text: '{"success":true,"merged":true}' }])).toEqual({ ok: true, merged: true });
  expect(C.releaseResult({ content: [{ type: "text", text: 'Result: {"success":false}' }] })).toEqual({ ok: false, merged: false });
  expect(C.releaseResult({ success: true })).toEqual({ ok: true, merged: false });
  expect(C.releaseResult("nope")).toBeNull();
});

// ── RT3: red-team pass 3 + QA corpus ──────────────────────────────────────
const RC_LIB = require("./run-contract.js");
const bash = (cmd) => C.commandFacts(cmd, { tool: "Bash" });
const pwsh = (cmd) => C.commandFacts(cmd, { tool: "PowerShell" });

describe("RT3-R3: assignments, keywords, blocks, iex and continuations at command position", () => {
  test.each([
    ["PowerShell", "$r = git commit -m x 2>&1"],
    ["PowerShell", "$out += git commit -m x"],
    ["PowerShell", "$r=git commit -m x"],
    ["Bash", "if true; then git commit -m x; fi"],
    ["Bash", "if test -f a; then echo a; else git commit -m x; fi"],
    ["Bash", "if false; then :; elif true; then git commit -m x; fi"],
    ["Bash", "for f in a b; do git commit -m $f; done"],
    ["Bash", "while true; do git commit -m x; break; done"],
    ["Bash", "until false; do git commit -m x; done"],
    ["Bash", "if git commit -m x; then echo ok; fi"],
    ["PowerShell", "if ($x) { git commit -m x }"],
    ["PowerShell", "if ($x) { echo a } else { git commit -m x }"],
    ["PowerShell", "try { git commit -m x } catch { Write-Host $_ }"],
    ["PowerShell", "foreach ($f in $l) { git add $f; git commit -m $f }"],
    ["PowerShell", "$l | ForEach-Object { git commit -m $_ }"],
    ["PowerShell", 'iex "git commit -m x"'],
    ["PowerShell", "Invoke-Expression -Command 'git commit -m x'"],
    ["Bash", "git \\\n  commit -m x"],
    ["PowerShell", "git `\n  commit -m x"],
  ])("RT3-R3: %s `%s` is a commit", (tool, cmd) => {
    expect(C.commandFacts(cmd, { tool }).commit).toBe(true);
  });

  test.each([
    ["PowerShell", "$null = git push origin main"],
    ["PowerShell", "try { git push origin main } catch {}"],
    ["Bash", "git push \\\n  origin main"],
    ["PowerShell", "git push `\r\n  origin main"],
  ])("RT3-R3: %s `%s` is a release", (tool, cmd) => {
    expect(C.commandFacts(cmd, { tool }).release).toBe(true);
  });

  test.each([
    ["PowerShell", "$msg = 'git commit -m x'"],
    ["PowerShell", "if ($x -eq 'git commit') { echo ok }"],
    ["Bash", "if grep -q 'git commit' f; then echo found; fi"],
    ["Bash", "for f in commit push; do echo $f; done"],
    ["PowerShell", "$r = git status"],
    ["PowerShell", "Write-Host \"iex 'git commit -m x'\""],
    ["Bash", "echo git \\\n commit"],
    ["Bash", "done"],
  ])("RT3-R3: %s `%s` is no commit and no release", (tool, cmd) => {
    const f = C.commandFacts(cmd, { tool });
    expect(f.commit).toBe(false);
    expect(f.release).toBe(false);
  });

  test("RT3-R3: a bash `if ( … )` subshell still runs its command", () => {
    expect(bash("if (git commit -m x); then echo ok; fi").commit).toBe(true);
  });
});

describe("RT3-R4: releases under ship: auto", () => {
  test.each([
    ["gh api -X PUT repos/o/r/pulls/12/merge"],
    ["gh api --method PUT /repos/o/r/pulls/12/merge -f merge_method=squash"],
    ["gh api --method=PUT repos/o/r/pulls/12/merge"],
    ['gh api "repos/o/r/pulls/12/merge" -XPUT'],
    ["gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'"],
    ["git push origin +main"],
    ["git push origin +HEAD:main"],
    ["git push -f origin +master"],
    ["(git push origin main)"],
  ])("RT3-R4: `%s` is a release", (cmd) => {
    expect(bash(cmd).release).toBe(true);
  });

  test.each([
    ["gh api repos/o/r/pulls/12/merge"],
    ["gh api -X GET repos/o/r/pulls/12"],
    ["gh api -X PUT repos/o/r/pulls/12/requested_reviewers"],
    ["git push origin +feat/main-x"],
    ["git push origin +mainline"],
  ])("RT3-R4: `%s` is no release", (cmd) => {
    expect(bash(cmd).release).toBe(false);
  });

  test.each([
    ["git push", true], ["git push origin HEAD", true], ["git push -u origin HEAD", true], ["git push origin", true],
    ["git push -u origin feat/x", false], ["git push origin main", false], ["git push --dry-run", false],
    ["git status", false], ["echo git push", false],
  ])("RT3-R4: `%s` → pushHead %s", (cmd, want) => {
    expect(bash(cmd).pushHead).toBe(want);
  });

  test("RT3-R4: shellCallFacts carries pushHead", () => {
    const hook = { tool_name: "Bash", tool_input: { command: "git push -u origin HEAD" } };
    expect(C.shellCallFacts(hook, os.tmpdir(), os.tmpdir()).pushHead).toBe(true);
  });
});

describe("RT3-R5 + QA: heredocs, here-strings and PowerShell backticks", () => {
  const QA_BODY = [
    "cat > f.js <<'EOF'",
    "// Docs: run `gh pr merge` only via do-ship.",
    "// Never `git push` onto main by hand; don't `git commit` here.",
    "const x = 1; // it's (unbalanced",
    "EOF",
    "node f.js",
  ].join("\n");

  test("RT3-QA: the corpus false positive — a quoted heredoc with Markdown code spans is no release, no commit", () => {
    const f = bash(QA_BODY);
    expect(f.release).toBe(false);
    expect(f.commit).toBe(false);
    expect(C.commandFacts(QA_BODY).release).toBe(false);
  });

  test("RT3-R5: a quoted heredoc line starting with `git checkout -b x` is no branch", () => {
    expect(bash("cat > notes.md <<'EOF'\ngit checkout -b x\ngit commit -m y\nEOF").branch).toBe(false);
    expect(bash("cat > notes.md <<'EOF'\ngit checkout -b x\nEOF").commit).toBe(false);
  });

  test("RT3-R5: an unquoted heredoc body is data, only its substitutions run", () => {
    expect(bash("cat > n.md <<EOF\ngit commit -m x\nEOF").commit).toBe(false);
    expect(bash("cat > n.md <<EOF\nsha: $(git commit -m x)\nEOF").commit).toBe(true);
    expect(bash("cat > n.md <<EOF\nsha: `git commit -m x`\nEOF").commit).toBe(true);
    expect(bash("cat <<-EOF\n\tgit push origin main\n\tEOF\ngit status").release).toBe(false);
    expect(bash("cat <<-EOF\n\thi\n\tEOF\ngit push origin main").release).toBe(true);
  });

  test("RT3-R5: a command after the heredoc still counts", () => {
    expect(bash("cat > f <<'EOF'\nhello\nEOF\ngit commit -m x").commit).toBe(true);
    expect(bash("cat > f <<'EOF'\r\nhello\r\nEOF\r\ngit commit -m x").commit).toBe(true);
  });

  test("RT3-R5: a heredoc fed to a shell is a script", () => {
    expect(bash("bash <<'EOF'\ngit commit -m x\nEOF").commit).toBe(true);
    expect(bash("sh -s <<EOF\ngit push origin main\nEOF").release).toBe(true);
    expect(bash("pwsh -NoProfile -Command - <<'EOF'\n$r = git commit -m x\nEOF").commit).toBe(true);
    expect(bash("python - <<'EOF'\ngit commit -m x\nEOF").commit).toBe(false);
  });

  test("RT3-R5: bash `echo \"$(git commit -m x)\"` is a commit", () => {
    expect(bash('echo "$(git commit -m x)"').commit).toBe(true);
    expect(bash("echo \"`git commit -m x`\"").commit).toBe(true);
  });

  test("RT3-R5: a PR body heredoc with `1)` and a code span is no release", () => {
    const cmd = [
      "gh pr create --title t --body \"$(cat <<'EOF'",
      "## Steps",
      "1) step one",
      "2) then `git push origin main` — not here",
      "EOF",
      ")\"",
    ].join("\n");
    expect(bash(cmd).release).toBe(false);
    expect(C.commandFacts(cmd).release).toBe(false);
  });

  test("RT3-R5: a commit whose message comes from a heredoc is still a commit", () => {
    expect(bash("git commit -m \"$(cat <<'EOF'\nfix: x (see `git push`)\nEOF\n)\"").commit).toBe(true);
    expect(bash("git commit -F - <<'EOF'\nmsg\nEOF").commit).toBe(true);
  });

  test("RT3-R5: PowerShell backticks are escapes, `$(…)` stays code", () => {
    expect(pwsh('gh issue comment 12 --body "merged via `gh pr merge 480`"').release).toBe(false);
    expect(pwsh('Write-Host "use `"git commit`" later"').commit).toBe(false);
    expect(pwsh('Write-Host "sha $(git commit -m x)"').commit).toBe(true);
    // Bash keeps backtick substitution.
    expect(bash('echo "merged via `gh pr merge 480`"').release).toBe(true);
  });

  test("RT3-R5: PowerShell here-strings", () => {
    expect(pwsh("$b = @'\ngit commit -m x\n`gh pr merge 1`\n'@\ngh issue comment 1 --body $b").commit).toBe(false);
    expect(pwsh("$b = @\"\ngit push origin main\n\"@\necho $b").release).toBe(false);
    expect(pwsh("$b = @\"\nsha $(git commit -m x)\n\"@").commit).toBe(true);
    expect(pwsh("$b = @'\nx\n'@\ngit commit -m x").commit).toBe(true);
  });

  test("RT3-R5: the `$(` paren count is quote-aware", () => {
    expect(bash('echo "$(echo \')\' ; git commit -m x)"').commit).toBe(true);
    expect(bash('echo "$(printf \'%s)\' a) `git status`"').commit).toBe(false);
  });

  test("RT3-R5: a heredoc without a terminator line is not stripped", () => {
    expect(bash("cat <<EOF\ngit commit -m x").commit).toBe(true);
  });
});

describe("RT3-R9: linear parsing of hostile or long input", () => {
  const time = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

  test("RT3-R9: a 1 MB command (heredoc plus text) parses in < 250 ms", () => {
    const body = "line with `git push` and 'quotes\" (\n".repeat(28_000);
    const cmd = `cat > big.md <<'EOF'\n${body}EOF\n${"echo a && ".repeat(2_000)}git commit -m x`;
    expect(cmd.length).toBeGreaterThan(1_000_000);
    let f;
    expect(time(() => { f = bash(cmd); })).toBeLessThan(250);
    expect(f.commit).toBe(true);
    expect(f.release).toBe(false);
  });

  test("RT3-R9: 10,000 lone `&` parse in < 250 ms", () => {
    const cmd = "sleep 1 & ".repeat(10_000);
    expect(time(() => bash(cmd))).toBeLessThan(250);
    expect(C.splitSegments(cmd)).toHaveLength(10_001);
    expect(C.splitSegments("a 2>&1 & b")).toEqual(["a 2>&1 ", " b"]);
  });

  test("RT3-R9: one unmatched `\"` followed by many `\\\"` stays linear", () => {
    const cmd = `echo "${'\\" '.repeat(100_000)}`;
    expect(time(() => bash(cmd))).toBeLessThan(250);
    expect(time(() => C.splitSegments(cmd))).toBeLessThan(250);
  });

  test("RT3-R9: text past the 256 KB cap is not parsed", () => {
    expect(C.MAX_PARSE).toBe(256 * 1024);
    const pad = `echo ${"x".repeat(C.MAX_PARSE)}`;
    expect(bash(`${pad}\ngit commit -m x`).commit).toBe(false);
    expect(bash(`git commit -m x\n${pad}`).commit).toBe(true);
  });
});

describe("RT3-R10: branch creation across commands of one line", () => {
  test.each([
    ["git branch feat/x && git switch feat/x", "feat/x"],
    ["git branch -f feat/y main; git checkout feat/y", "feat/y"],
    ["git branch fix/1 origin/main\ngit checkout -q fix/1", "fix/1"],
    ["gh issue develop 12 -c --name fix/12", "fix/12"],
    ["gh issue develop 12 --checkout", null],
  ])("RT3-R10: `%s` creates %s", (cmd, name) => {
    expect(bash(cmd)).toMatchObject({ branch: true, branchName: name });
  });

  test.each([
    ["git switch existing"], ["git checkout existing"], ["git branch other && git switch existing"],
    ["git branch -d old && git checkout old"], ["git branch --list x && git switch x"],
    ["gh issue develop 12 --name fix/12"], ["git switch x && git branch x"],
  ])("RT3-R10: `%s` creates no branch", (cmd) => {
    expect(bash(cmd).branch).toBe(false);
  });
});

describe("QA-T1: routerFromTranscript reads back past the 2 MB tail", () => {
  const Q = [
    { header: "Ablauf?", question: "Bist du dabei, und wer shippt am Ende?", options: [{ label: "Dabei · Ship manuell" }, { label: "Weg · Ship automatisch" }] },
    { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [{ label: "Nur das" }] },
    { header: "Durchgänge?", question: "Welche Durchgänge kommen dazu?", multiSelect: true, options: [{ label: "Harden danach (Recommended)" }] },
  ];
  const A = { "Bist du dabei, und wer shippt am Ende?": "Weg · Ship automatisch", "Wie weit darf die Änderung greifen?": "Nur das", "Welche Durchgänge kommen dazu?": ["Harden danach (Recommended)"] };
  const lineAt = (ms, questions, answers) => JSON.stringify({ type: "user", timestamp: new Date(ms).toISOString(), toolUseResult: { questions, answers } });

  test("RT3-QA-T1: a router line 5 MB before the end is found", () => {
    const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rc-t1-")), "t.jsonl");
    const now = Date.now();
    const big = JSON.stringify({ type: "user", timestamp: new Date(now - 500).toISOString(), toolUseResult: { stdout: "é".repeat(700_000) } });
    fs.writeFileSync(t, `${lineAt(now - 1000, Q, A)}\n${Array(4).fill(big).join("\n")}\n`);
    expect(fs.statSync(t).size).toBeGreaterThan(5 * 1024 * 1024);
    const found = C.routerFromTranscript(t, new Date(now - 10_000).toISOString(), RC_LIB);
    expect(found).not.toBeNull();
    expect(found.answers["Bist du dabei, und wer shippt am Ende?"]).toBe("Weg · Ship automatisch");
    expect(C.routerFromTranscript(t, new Date(now + 60_000).toISOString(), RC_LIB)).toBeNull();
  });

  test("RT3-QA-T1: linesBackward keeps lines whole across chunk boundaries and stops at the cap", () => {
    const t = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rc-t1-")), "l.txt");
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}-${"ü".repeat(i)}`);
    fs.writeFileSync(t, `${lines.join("\n")}\n`);
    expect([...C.linesBackward(t, { chunk: 7 })].filter(Boolean)).toEqual([...lines].reverse());
    const capped = [...C.linesBackward(t, { chunk: 7, max: 400 })].filter(Boolean);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.every(l => lines.includes(l))).toBe(true);
    expect([...C.linesBackward(path.join(t, "missing"))]).toEqual([]);
  });
});
