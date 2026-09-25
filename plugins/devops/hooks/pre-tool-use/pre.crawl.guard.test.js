import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.crawl.guard.js");
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..").replace(/\\/g, "/");

/** Temp project with devops enabled — otherwise plugin-guard exits 0 and every test passes vacuously. */
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crawlguard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

function run(dir, command, toolName = "Bash", extra = {}, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.CLAUDE_PLUGIN_ROOT;
  delete childEnv.DEVOPS_ALLOW_ROOT_CRAWL;
  Object.assign(childEnv, env);
  const payload = JSON.stringify({ cwd: dir, tool_name: toolName, tool_input: { command }, session_id: "s1", ...extra });
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = spawnSync(process.execPath, [HOOK], { cwd: dir, input: payload, encoding: "utf8", env: childEnv });
    if (res.status !== null) break;
  }
  return { code: res.status, stderr: res.stderr || "" };
}

describe("pre.crawl.guard — blocks", () => {
  test.each([
    'find / -maxdepth 6 -iname "ui-defaults.md" 2>/dev/null; find / -maxdepth 8 -iname "pre-mortem.md" 2>/dev/null',
    'find / -iname "materials" -type d 2>/dev/null | grep -v node_modules | head -20',
    'find "C:\\Users\\Jerem" -maxdepth 8 -iname "pre-mortem.md" 2>/dev/null',
    "find /c -name x",
    "find C:/ -name x",
    "find /cygdrive/c -name x",
    "ls -R /",
    'grep -rn "x" /',
    "du -sh /",
  ])("Bash: %s", (cmd) => {
    const r = run(project(), cmd);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("[pre.crawl.guard] BLOCKED");
  });

  test.each([
    "Get-ChildItem C:\\ -Recurse -Filter ui-defaults.md",
    "gci / -r",
    '& "C:\\Program Files\\Git\\usr\\bin\\find.exe" / -maxdepth 6 -iname ui-defaults.md',
  ])("PowerShell: %s", (cmd) => {
    const r = run(project(), cmd, "PowerShell");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("BLOCKED");
  });

  test("a retry of the same command stays blocked (hard deny, no retry release)", () => {
    const dir = project();
    expect(run(dir, "find / -name x").code).toBe(2);
    expect(run(dir, "find / -name x").code).toBe(2);
  });

  test("deny text resolves {PLUGIN_ROOT} to the literal plugin path", () => {
    const r = run(project(), "find / -maxdepth 6 -iname ui-defaults.md");
    expect(r.stderr).toContain(`{PLUGIN_ROOT} = ${PLUGIN_ROOT}`);
    expect(r.stderr).toContain(`${PLUGIN_ROOT}/deep-knowledge/`);
    expect(r.stderr).toContain("Glob/Grep");
    expect(r.stderr).not.toContain("You are a subagent");
  });

  test("CLAUDE_PLUGIN_ROOT from the hook env wins over the file location", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "crawlguard-root-"));
    const r = run(project(), "find / -name x", "Bash", {}, { CLAUDE_PLUGIN_ROOT: fake });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`{PLUGIN_ROOT} = ${fake.replace(/\\/g, "/")}`);
  });

  test("subagent payload (agent_id) gets the subagent hint", () => {
    const r = run(project(), "find / -iname materials -type d", "Bash", { agent_id: "a4b0e72ccbc3d23e7" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("You are a subagent");
    expect(r.stderr).toContain(`{PLUGIN_ROOT} = ${PLUGIN_ROOT}`);
  });

  test("home crawl names the home directory", () => {
    const r = run(project(), "find ~ -name pre-mortem.md");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("whole home directory");
  });
});

describe("pre.crawl.guard — review regressions", () => {
  test.each([
    ["tree /f", "PowerShell"],
    ["tree /F /A", "PowerShell"],
    ["tree /f plugins\\devops", "PowerShell"],
    ['cmd /c "tree /f"', "PowerShell"],
    ['cmd //c "tree /f"', "Bash"],
  ])("Windows tree.com switch is not a drive root: %s (%s) → exit 0", (cmd, tool) => {
    const r = run(project(), cmd, tool);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test.each([
    "grep -rn --include='*.js' \"C:\" plugins",
    "grep -rn --include=\"*.sh\" '$HOME' .",
    'grep -rln --include="*.js" "/" src',
    "grep -rn --exclude='*.min.js' \"~\" plugins",
    "rg --glob='*.md' '$HOME' .",
    'grep -rn --include "*.js" "C:" plugins',
  ])("quoted option value keeps the pattern a pattern: %s → exit 0", (cmd) => {
    expect(run(project(), cmd).code).toBe(0);
  });

  test.each([
    ["cd ~ && find . -maxdepth 8 -iname pre-mortem.md 2>/dev/null", "Bash"],
    ["cd / && find . -name ui-defaults.md", "Bash"],
    ["cd /c && find . -iname pre-mortem.md", "Bash"],
    ["cd $HOME; grep -rl ui-defaults .", "Bash"],
    ["pushd / >/dev/null && find . -name x", "Bash"],
    ["Set-Location C:\\; Get-ChildItem -Recurse -Filter x", "PowerShell"],
    ["cd ~; Get-ChildItem -Recurse -Filter pre-mortem.md", "PowerShell"],
    ["Push-Location C:\\; gci -r -fi x", "PowerShell"],
  ])("cd into a root/home, then `.`: %s (%s) → exit 2", (cmd, tool) => {
    const r = run(project(), cmd, tool, { cwd: "C:/x" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("from the working directory");
  });

  test("a home working directory makes `find .` and `rg --files` crawls", () => {
    const home = os.homedir();
    for (const cmd of ["find . -maxdepth 8 -iname pre-mortem.md", "rg --files | grep ui-defaults"]) {
      const r = run(project(), cmd, "Bash", { cwd: home });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("whole home directory");
      // The cwd itself is no scope to recommend.
      expect(r.stderr).toContain("scoped to the project directory");
    }
    expect(run(project(), "find . -name x", "Bash", { cwd: "C:\\" }).code).toBe(2);
    expect(run(project(), "Set-Location C:\\; Get-ChildItem -Recurse -Filter x", "PowerShell", { cwd: home }).code).toBe(2);
  });

  test("a project working directory stays allowed", () => {
    const dir = project();
    expect(run(dir, "find . -name x").code).toBe(0);
    expect(run(dir, "rg --files | grep ui-defaults").code).toBe(0);
  });

  test.each([
    "Get-ChildItem C:\\ -s -Filter ui-defaults.md -ErrorAction SilentlyContinue",
    "dir C:\\ -s -Filter ui-defaults.md",
    "gci $env:USERPROFILE -s -Filter pre-mortem.md",
  ])("Get-ChildItem -s (alias of -Recurse): %s → exit 2", (cmd) => {
    expect(run(project(), cmd, "PowerShell").code).toBe(2);
  });

  test.each([
    ['find "$(cygpath -u "$USERPROFILE")" -name pre-mortem.md', "Bash"],
    ['find "$(cygpath "$HOME")" -maxdepth 8 -name pre-mortem.md', "Bash"],
    ["for d in /c /h; do find $d -name x; done", "Bash"],
    ["Get-PSDrive -PSProvider FileSystem | ForEach-Object { Get-ChildItem $_.Root -Recurse -Filter ui-defaults.md }", "PowerShell"],
    ["[System.IO.Directory]::EnumerateFiles('C:\\', 'ui-defaults.md', 'AllDirectories')", "PowerShell"],
    ["[IO.Directory]::GetFiles('C:\\', '*.md', [IO.SearchOption]::AllDirectories)", "PowerShell"],
    ["robocopy C:\\ NUL ui-defaults.md /S /L /NJH /NJS", "PowerShell"],
  ])("whole-machine idiom: %s (%s) → exit 2", (cmd, tool) => {
    expect(run(project(), cmd, tool).code).toBe(2);
  });

  test.each([
    'find "$CLAUDE_PLUGIN_ROOT/" -iname ui-defaults.md',
    "find $CLAUDE_PLUGIN_ROOT/ -iname ui-defaults.md",
    'grep -rl ui-defaults "$CLAUDE_PLUGIN_ROOT/"',
  ])("unset $CLAUDE_PLUGIN_ROOT + / is the root: %s → exit 2", (cmd) => {
    const r = run(project(), cmd);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("$CLAUDE_PLUGIN_ROOT is empty");
  });

  test("PowerShell assignment does not hide the walker", () => {
    const cmd = "$f = Get-ChildItem -Path C:\\ -Recurse -Filter ui-defaults.md -ErrorAction SilentlyContinue | Select-Object -First 1";
    expect(run(project(), cmd, "PowerShell").code).toBe(2);
    expect(run(project(), "foreach ($f in Get-ChildItem C:\\ -Recurse) { $f }", "PowerShell").code).toBe(2);
  });

  test("a heredoc fed to bash is executed", () => {
    expect(run(project(), "bash <<'EOF'\nfind / -iname ui-defaults.md\nEOF").code).toBe(2);
  });
});

describe("pre.crawl.guard — allows", () => {
  test.each([
    "find . -name x",
    "find ./src -name x",
    "find /tmp/x -name y",
    "find /c/Users/Jerem/IdeaProjects/x -name y",
    "find ~ -maxdepth 3 -name x",
    'git commit -m "fix: stop find / crawls"',
    "cat <<'EOF' > notes.md\nfind / -name x\nEOF",
    "ls -la /",
  ])("Bash: %s", (cmd) => {
    const r = run(project(), cmd);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test.each([
    "Get-ChildItem C:\\",
    "Get-ChildItem . -Recurse -Filter *.md",
    "$msg = @'\nGet-ChildItem C:\\ -Recurse\n'@",
  ])("PowerShell: %s", (cmd) => {
    expect(run(project(), cmd, "PowerShell").code).toBe(0);
  });

  test("other tools are ignored", () => {
    const r = run(project(), "find / -name x", "Read");
    expect(r.code).toBe(0);
  });

  test("inline DEVOPS_ALLOW_ROOT_CRAWL=1 bypasses", () => {
    expect(run(project(), "DEVOPS_ALLOW_ROOT_CRAWL=1 find / -name x").code).toBe(0);
    expect(run(project(), "$env:DEVOPS_ALLOW_ROOT_CRAWL=1; gci C:\\ -r", "PowerShell").code).toBe(0);
  });

  test("DEVOPS_ALLOW_ROOT_CRAWL=1 in the hook env bypasses", () => {
    expect(run(project(), "find / -name x", "Bash", {}, { DEVOPS_ALLOW_ROOT_CRAWL: "1" }).code).toBe(0);
  });

  test("malformed stdin → exit 0", () => {
    const dir = project();
    const res = spawnSync(process.execPath, [HOOK], { cwd: dir, input: "not json", encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
