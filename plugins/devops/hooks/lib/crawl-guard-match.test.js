import { describe, test, expect } from "vitest";
import os from "node:os";
import { findRootCrawls, hasBypass, classifyPath } from "./crawl-guard-match.js";

const bash = (cmd) => findRootCrawls(cmd, { shell: "bash" });
const ps = (cmd) => findRootCrawls(cmd, { shell: "powershell" });
const kinds = (list) => list.map((c) => c.kind);

// ---------------------------------------------------------------------------
// The incident commands, verbatim
// ---------------------------------------------------------------------------

describe("incident commands (2026-09-24)", () => {
  test("find / -maxdepth 6|8 for plugin docs → both caught", () => {
    const r = bash(
      'find / -maxdepth 6 -iname "ui-defaults.md" 2>/dev/null; find / -maxdepth 8 -iname "pre-mortem.md" 2>/dev/null'
    );
    expect(r).toHaveLength(2);
    expect(r.every((c) => c.head === "find" && c.path === "/" && c.kind === "root")).toBe(true);
  });

  test("find / -iname materials -type d piped into grep/head", () => {
    expect(kinds(bash('find / -iname "materials" -type d 2>/dev/null | grep -v node_modules | head -20'))).toEqual(["root"]);
  });

  test("find over the home directory at -maxdepth 8", () => {
    expect(kinds(bash('find "C:\\Users\\Jerem" -maxdepth 8 -iname "pre-mortem.md" 2>/dev/null'))).toEqual(["home"]);
  });

  test("the full Git find.exe path through the PowerShell call operator", () => {
    expect(kinds(ps('& "C:\\Program Files\\Git\\usr\\bin\\find.exe" / -maxdepth 6 -iname ui-defaults.md'))).toEqual(["root"]);
  });

  test("earlier cases: -ipath and a devops-commit* search from /", () => {
    expect(kinds(bash('find / -ipath "*deep-knowledge/commit-conventions.md" 2>/dev/null | head -3'))).toEqual(["root"]);
    expect(kinds(bash('find / -iname "devops-commit*" 2>/dev/null | grep -v node_modules | head -20'))).toEqual(["root"]);
  });
});

// ---------------------------------------------------------------------------
// Root forms
// ---------------------------------------------------------------------------

describe("root start paths → caught", () => {
  test.each([
    "find / -name x",
    "find // -name x",
    "find /c -name x",
    "find /d/ -name x",
    "find /c/* -name x",
    "find /mnt -name x",
    "find /mnt/c -name x",
    "find /cygdrive/c -name x",
    "find C:/ -name x",
    "find C:\\\\ -name x",
    "find 'C:\\' -name x",
    'find "/" -name x',
    "find /c/Users -name x",
    "find /home -name x",
    "find -L / -name x",
    "find . / -name x",
  ])("%s", (cmd) => {
    expect(kinds(bash(cmd))).toContain("root");
  });

  test("find / with a depth > 1 is still a crawl", () => {
    expect(bash("find / -maxdepth 2 -name x")).toHaveLength(1);
    expect(bash("find / -maxdepth 6 -name x")).toHaveLength(1);
  });

  test("ls -R, grep -r, du, tree, rg, fd, where /r at a root", () => {
    expect(bash("ls -R /")).toHaveLength(1);
    expect(bash("ls -laR /c")).toHaveLength(1);
    expect(bash('grep -rn "foo" /')).toHaveLength(1);
    expect(bash('grep -R -l foo /c/')).toHaveLength(1);
    expect(bash("grep --recursive foo /")).toHaveLength(1);
    expect(bash("du -sh /")).toHaveLength(1);
    expect(bash("du -d 1 /c")).toHaveLength(1);
    expect(bash("tree /")).toHaveLength(1);
    expect(bash("rg ui-defaults /")).toHaveLength(1);
    expect(bash("rg --files / -g '*.md'")).toHaveLength(1);
    expect(bash("fd pre-mortem /")).toHaveLength(1);
    expect(bash("where //r C:\\\\ ui-defaults.md")).toHaveLength(1);
  });

  test("wrappers, env prefixes and nested shells do not hide the walker", () => {
    expect(bash("timeout 30 find / -name x")).toHaveLength(1);
    expect(bash("LC_ALL=C nice -n 10 find / -name x")).toHaveLength(1);
    expect(bash("sudo find / -name x")).toHaveLength(1);
    expect(bash('bash -c "find / -name x"')).toHaveLength(1);
    expect(bash("sh -lc 'find /c -name x'")).toHaveLength(1);
    expect(bash("echo $(find / -name x)")).toHaveLength(1);
    expect(bash('X="$(find / -name x)"')).toHaveLength(1);
    expect(bash("echo `find / -name x`")).toHaveLength(1);
    expect(bash("cd /tmp && find / -name x")).toHaveLength(1);
    expect(bash("/usr/bin/find / -name x")).toHaveLength(1);
    expect(bash("find \\\n  / -name x")).toHaveLength(1);
  });
});

describe("PowerShell forms → caught", () => {
  test.each([
    "Get-ChildItem C:\\ -Recurse",
    "Get-ChildItem -Path C:\\ -Recurse -Filter ui-defaults.md",
    "Get-ChildItem -Path:C:\\ -Recurse",
    "Get-ChildItem -LiteralPath 'D:\\' -Recurse",
    "Get-ChildItem C:\\ -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1",
    "Get-ChildItem C:\\*.md -Recurse",
    "gci / -r",
    "gci \\ -rec",
    "ls C:\\ -Recurse",
    "dir C:\\ -Recurse",
    "Get-ChildItem C:\\ -Depth 5",
    "Get-ChildItem $env:SystemDrive\\ -Recurse",
    "Get-ChildItem \\\\server\\share -Recurse",
    "cmd /c dir /s C:\\",
    "cmd /c dir /s /b C:\\ui-defaults.md",
    "pwsh -Command \"Get-ChildItem C:\\ -Recurse\"",
    "where.exe /r C:\\ ui-defaults.md",
  ])("%s", (cmd) => {
    expect(ps(cmd)).not.toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------

describe("home directory", () => {
  test.each([
    "find ~ -name x",
    "find ~/ -name x",
    "find $HOME -name x",
    'find "$HOME" -name x',
    "find ${HOME} -maxdepth 4 -name x",
    "find /c/Users/someone -name x",
    "find /home/someone -name x",
    "grep -r foo ~",
    "du -sh ~",
    "ls -R ~",
  ])("%s → caught as home", (cmd) => {
    expect(kinds(bash(cmd))).toEqual(["home"]);
  });

  test("PowerShell home forms", () => {
    expect(kinds(ps("Get-ChildItem $env:USERPROFILE -Recurse -Filter x"))).toEqual(["home"]);
    expect(kinds(ps("Get-ChildItem -Path $HOME -Recurse"))).toEqual(["home"]);
    expect(kinds(ps("gci ~ -r"))).toEqual(["home"]);
  });

  test("the literal os.homedir() counts as home", () => {
    const home = os.homedir().replace(/\\/g, "/");
    expect(classifyPath(home)).toBe("home");
  });

  test("home at depth ≤ 3 is allowed (bounded listing)", () => {
    expect(bash("find ~ -maxdepth 3 -name x")).toEqual([]);
    expect(bash("find $HOME -maxdepth 1 -type d")).toEqual([]);
    expect(ps("Get-ChildItem $HOME -Depth 2")).toEqual([]);
  });

  test("du and grep -r at home are never allowed (no traversal limit)", () => {
    expect(bash("du -d 1 ~")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// False positives that must stay allowed
// ---------------------------------------------------------------------------

describe("allowed", () => {
  test.each([
    "find . -name x",
    "find -name x",
    "find ./src -name '*.js'",
    "find src tests -name x",
    "find /tmp/x -name y",
    "find /c/Users/Jerem/IdeaProjects/x -name y",
    'find "C:\\Users\\Jerem\\.claude" -maxdepth 6 -iname "pre-mortem.md"',
    "find ~/.claude/plugins/cache/dotclaude -name ui-defaults.md",
    "find $HOME/.claude -name x",
    "find /usr/share -name x",
    "find / -maxdepth 1",
    "find / -maxdepth 0 -name x",
    "find . -path '/c/*' -name x",
    "ls /",
    "ls -la /c",
    "du -sh .",
    "du -sh node_modules",
    "tree -L 1 /",
    "tree src",
    'grep -r "find /" .',
    "grep -rn foo src/",
    "grep foo /etc/hosts",
    "rg foo",
    "rg foo src",
    "fd x",
    'echo "find / -name x"',
    "echo 'find / -maxdepth 6 -iname ui-defaults.md'",
    'git commit -m "fix: stop find / crawls"',
    'git commit -m "gci C:\\ -Recurse is bad"',
    "cat <<'EOF' > notes.md\nfind / -name x\ngrep -r foo /\nEOF",
    "git commit -m \"$(cat <<'EOF'\nfix: find / -name x\nEOF\n)\"",
    "find $(pwd) -name x",
    "ls -R",
    "# find / -name x",
  ])("%s", (cmd) => {
    expect(bash(cmd)).toEqual([]);
  });

  test.each([
    "Get-ChildItem C:\\",
    "Get-ChildItem C:\\ -Depth 0",
    "Get-ChildItem -Recurse",
    "Get-ChildItem . -Recurse -Filter *.md",
    "Get-ChildItem C:\\Users\\Jerem\\IdeaProjects\\x -Recurse",
    "gci src -r",
    "find /i \"text\" file.txt",
    "Write-Host 'find / -name x'",
    "$msg = @'\nGet-ChildItem C:\\ -Recurse\n'@",
    "cmd /c dir C:\\",
    "cmd /c dir /s src",
    "git commit -m \"find / crawl fix\"",
  ])("PowerShell: %s", (cmd) => {
    expect(ps(cmd)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review findings (regressions)
// ---------------------------------------------------------------------------

describe("Windows tree.com: /f /a are switches, not the MSYS drive root F:", () => {
  test.each(["tree /f", "tree /F /A", "tree . /f", "tree /f plugins\\devops", 'cmd /c "tree /f"'])(
    "PowerShell: %s → allowed",
    (cmd) => {
      expect(ps(cmd)).toEqual([]);
    }
  );

  test('Bash: cmd //c "tree /f" and tree.com /f → allowed', () => {
    expect(bash('cmd //c "tree /f"')).toEqual([]);
    expect(bash("tree.com /f")).toEqual([]);
  });

  test("tree.com at a real root is still a crawl", () => {
    expect(kinds(ps("tree C:\\ /f"))).toEqual(["root"]);
    expect(kinds(bash('cmd //c "tree C:\\\\ /f"'))).toEqual(["root"]);
  });
});

describe("quoted option values do not steal the pattern slot", () => {
  test.each([
    "grep -rn --include='*.js' \"C:\" plugins",
    "grep -rn --include=\"*.sh\" '$HOME' .",
    'grep -rln --include="*.js" "/" src',
    "grep -rn --include=\"*.js\" '\\\\' src",
    "grep -rn --exclude='*.min.js' \"~\" plugins",
    "rg --glob='*.md' '$HOME' .",
    'grep -rn --include "*.js" "C:" plugins',
    'grep -rn --exclude-dir "node_modules" "/" src',
    'X="1" grep -rn "C:" plugins',
  ])("%s → allowed", (cmd) => {
    expect(bash(cmd)).toEqual([]);
  });

  test("the real start path after a quoted option still counts", () => {
    expect(kinds(bash("grep -rn --include='*.md' ui-defaults /"))).toEqual(["root"]);
    expect(kinds(bash('X="1" find / -name x'))).toEqual(["root"]);
  });
});

describe("cd / pushd / Set-Location into a root or home, then a relative walk", () => {
  test.each([
    "cd / && find . -iname ui-defaults.md",
    "cd ~ && find . -iname pre-mortem.md 2>/dev/null",
    "cd ~ && find . -maxdepth 8 -iname pre-mortem.md 2>/dev/null",
    "cd /c && find . -iname pre-mortem.md",
    "cd $HOME; grep -rl ui-defaults .",
    "pushd / >/dev/null && find . -name x",
    "cd && find . -name x",
    "cd /c/Users/Jerem/IdeaProjects/x && cd ../../.. && find . -name x",
    "cd / && find * -name x",
    'bash -c "cd / && find . -name x"',
  ])("Bash: %s → caught", (cmd) => {
    expect(bash(cmd)).not.toHaveLength(0);
  });

  test.each([
    "Set-Location C:\\; Get-ChildItem -Recurse -Filter ui-defaults.md",
    "cd ~; Get-ChildItem -Recurse -Filter pre-mortem.md",
    "Push-Location C:\\; gci -r -fi x",
    "Set-Location -Path C:\\; gci -r",
    "cd C:\\; Get-ChildItem *.md -Recurse",
  ])("PowerShell: %s → caught", (cmd) => {
    expect(ps(cmd)).not.toHaveLength(0);
  });

  test("the resolved start path is reported", () => {
    const [c] = bash("cd / && find . -name x");
    expect(c.path).toBe(".");
    expect(c.resolved).toBe("/");
  });

  test.each([
    "cd /tmp/x && find . -name y",
    "cd ~/.claude && find . -name x",
    "cd ~/IdeaProjects/x && grep -rn foo .",
    "cd / && ls",
    "cd ~ && find . -maxdepth 2 -name x",
    "pushd / && popd && find . -name x",
    "cd / && find src -name x",
  ])("Bash: %s → allowed", (cmd) => {
    expect(bash(cmd)).toEqual([]);
  });
});

describe("the hook's working directory resolves relative start paths", () => {
  const at = (cwd, cmd, shell = "bash") => findRootCrawls(cmd, { shell, cwd });

  test("a home or root cwd makes `.` and no-path walks crawls", () => {
    expect(kinds(at("C:\\Users\\Jerem", "find . -maxdepth 8 -iname pre-mortem.md"))).toEqual(["home"]);
    expect(kinds(at("C:\\Users\\Jerem", "rg --files | grep ui-defaults"))).toEqual(["home"]);
    expect(kinds(at("C:\\", "find . -name x"))).toEqual(["root"]);
    expect(kinds(at("/", "grep -r foo"))).toEqual(["root"]);
    expect(kinds(at("C:\\", "Get-ChildItem -Recurse -Filter x", "powershell"))).toEqual(["root"]);
    expect(kinds(at("C:\\Users\\Jerem\\IdeaProjects", "find .. -name x"))).toEqual(["home"]);
  });

  test("a project cwd stays allowed", () => {
    const proj = "C:\\Users\\Jerem\\IdeaProjects\\dotclaude";
    expect(at(proj, "find . -name x")).toEqual([]);
    expect(at(proj, "rg foo")).toEqual([]);
    expect(at(proj, "grep -rn foo src")).toEqual([]);
    expect(at(proj, "Get-ChildItem -Recurse -Filter *.md", "powershell")).toEqual([]);
    expect(at("C:\\Users\\Jerem\\foo.bar", "cmd /c dir /s", "powershell")).toEqual([]);
    expect(at("C:\\Users\\Jerem", "find . -maxdepth 3 -name x")).toEqual([]);
    expect(at("C:\\Users\\Jerem", "find IdeaProjects/x -name y")).toEqual([]);
  });

  test("cmd dir /s <name> in a root cwd searches the whole drive", () => {
    expect(kinds(at("C:\\", "cmd /c dir /s /b ui-defaults.md", "powershell"))).toContain("root");
  });
});

describe("Get-ChildItem -s is -Recurse", () => {
  test.each([
    "Get-ChildItem C:\\ -s -Filter ui-defaults.md -ErrorAction SilentlyContinue",
    "dir C:\\ -s -Filter ui-defaults.md",
    "gci $env:USERPROFILE -s -Filter pre-mortem.md",
  ])("PowerShell: %s → caught", (cmd) => {
    expect(ps(cmd)).not.toHaveLength(0);
  });

  test('Bash: powershell -Command "Get-ChildItem C:\\ -s …" → caught', () => {
    expect(bash('powershell -Command "Get-ChildItem C:\\\\ -s -Filter ui-defaults.md"')).not.toHaveLength(0);
  });

  test("-s on a project subdirectory stays allowed", () => {
    expect(ps("Get-ChildItem src -s -Filter *.md")).toEqual([]);
  });
});

describe("whole-machine idioms: cygpath, loop variables, PSDrive roots, .NET, robocopy", () => {
  test.each([
    'find "$(cygpath -u "$USERPROFILE")" -name pre-mortem.md',
    'find "$(cygpath "$HOME")" -maxdepth 8 -name pre-mortem.md',
    "find `cygpath -u \"$USERPROFILE\"` -name x",
    "for d in /c /h; do find $d -name x; done",
    "D=/c; find $D -name x",
    'robocopy C:\\\\ NUL ui-defaults.md //S //L',
  ])("Bash: %s → caught", (cmd) => {
    expect(bash(cmd)).not.toHaveLength(0);
  });

  test("for-loop over two drives reports both", () => {
    expect(bash("for d in /c /h; do find $d -name x; done").map((c) => c.path)).toEqual(["$d", "$d"]);
  });

  test.each([
    "Get-PSDrive -PSProvider FileSystem | ForEach-Object { Get-ChildItem $_.Root -Recurse -Filter ui-defaults.md }",
    "[System.IO.Directory]::EnumerateFiles('C:\\', 'ui-defaults.md', 'AllDirectories')",
    "[IO.Directory]::GetFiles('C:\\', '*.md', [IO.SearchOption]::AllDirectories)",
    "[IO.Directory]::GetFiles($env:USERPROFILE, '*.md', 'AllDirectories')",
    "robocopy C:\\ NUL ui-defaults.md /S /L /NJH /NJS",
    "$d = 'C:\\'; Get-ChildItem $d -Recurse",
    "foreach ($d in 'C:\\', 'H:\\') { Get-ChildItem $d -Recurse -Filter x }",
  ])("PowerShell: %s → caught", (cmd) => {
    expect(ps(cmd)).not.toHaveLength(0);
  });

  test.each([
    'find "$(cygpath -u "$USERPROFILE")/.claude" -name x',
    "for d in src tests; do find $d -name x; done",
    "[IO.Directory]::GetFiles('C:\\', '*.md')",
    "[IO.Directory]::GetFiles('.\\src', '*.md', 'AllDirectories')",
    "robocopy C:\\ D:\\backup file.txt",
    "robocopy src dst /E",
  ])("allowed: %s", (cmd) => {
    const shell = /^(find|for) /.test(cmd) ? bash : ps;
    expect(shell(cmd)).toEqual([]);
  });
});

describe("unset $CLAUDE_PLUGIN_ROOT (empty in the Bash tool) before / is the root", () => {
  test.each([
    'find "$CLAUDE_PLUGIN_ROOT/" -iname ui-defaults.md',
    "find $CLAUDE_PLUGIN_ROOT/ -iname ui-defaults.md",
    "find ${CLAUDE_PLUGIN_ROOT}/ -iname ui-defaults.md",
    'grep -rl ui-defaults "$CLAUDE_PLUGIN_ROOT/"',
    "find $SYSTEMDRIVE/ -name x",
  ])("Bash: %s → caught", (cmd) => {
    expect(kinds(bash(cmd))).toEqual(["root"]);
  });

  test("PowerShell $env:CLAUDE_PLUGIN_ROOT\\ → caught", () => {
    expect(kinds(ps("Get-ChildItem \"$env:CLAUDE_PLUGIN_ROOT\\\" -Recurse"))).toEqual(["root"]);
  });

  test("$CLAUDE_PLUGIN_ROOT/deep-knowledge is a subdirectory → allowed", () => {
    expect(bash('find "$CLAUDE_PLUGIN_ROOT/deep-knowledge" -name x')).toEqual([]);
  });
});

describe("PowerShell assignments and foreach headers do not hide the walker", () => {
  test.each([
    "$f = Get-ChildItem -Path C:\\ -Recurse -Filter ui-defaults.md -ErrorAction SilentlyContinue | Select-Object -First 1",
    "$r = Get-ChildItem C:\\ -Recurse",
    "$r=Get-ChildItem C:\\ -Recurse",
    "[string[]]$r = Get-ChildItem C:\\ -Recurse",
    "$r += Get-ChildItem C:\\ -Recurse",
    "foreach ($f in Get-ChildItem C:\\ -Recurse) { $f }",
  ])("%s → caught", (cmd) => {
    expect(kinds(ps(cmd))).toEqual(["root"]);
  });

  test("an assignment of a narrow walk stays allowed", () => {
    expect(ps("$f = Get-ChildItem src -Recurse -Filter *.md")).toEqual([]);
  });
});

describe("heredoc fed to a shell is executed, not data", () => {
  test.each([
    "bash <<'EOF'\nfind / -iname ui-defaults.md\nEOF",
    "sh -s <<EOF\ncd /\nfind . -name x\nEOF",
    "cat <<'EOF' | bash\nfind / -name x\nEOF",
    "sudo bash <<EOF\ngrep -r foo /\nEOF",
  ])("%j → caught", (cmd) => {
    expect(bash(cmd)).not.toHaveLength(0);
  });

  test("pwsh reading a heredoc is analysed as PowerShell", () => {
    expect(bash("pwsh -Command - <<'EOF'\nGet-ChildItem C:\\ -Recurse\nEOF")).not.toHaveLength(0);
  });

  test("a data heredoc stays data", () => {
    expect(bash("cat <<'EOF' > run.sh\nfind / -name x\nEOF")).toEqual([]);
    expect(bash("git commit -F - <<'EOF'\nfix: find / crawl\nEOF")).toEqual([]);
  });
});

describe("hasBypass", () => {
  test("inline env prefix (bash) and $env: assignment (PowerShell)", () => {
    expect(hasBypass("DEVOPS_ALLOW_ROOT_CRAWL=1 find / -name x")).toBe(true);
    expect(hasBypass("$env:DEVOPS_ALLOW_ROOT_CRAWL=1; gci C:\\ -r")).toBe(true);
    expect(hasBypass("$env:DEVOPS_ALLOW_ROOT_CRAWL = '1'; gci C:\\ -r")).toBe(true);
  });

  test("absent or 0 → no bypass", () => {
    expect(hasBypass("find / -name x")).toBe(false);
    expect(hasBypass("DEVOPS_ALLOW_ROOT_CRAWL=0 find / -name x")).toBe(false);
    expect(hasBypass("MY_DEVOPS_ALLOW_ROOT_CRAWL=1 find / -name x")).toBe(false);
  });
});
