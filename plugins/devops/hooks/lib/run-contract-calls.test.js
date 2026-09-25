import { describe, test, expect } from "vitest";
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
