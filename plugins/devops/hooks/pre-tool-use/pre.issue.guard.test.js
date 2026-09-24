import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 30_000 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "pre.issue.guard.js");

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issueguard-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

function run(dir, toolInput, toolName = "Bash", extra = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: dir, tool_name: toolName, tool_input: toolInput, ...extra }),
    cwd: dir,
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr || "" };
}

const jl = (e) => JSON.stringify(e);
const userLine = (text) => jl({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const skillLine = (skill) =>
  jl({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "s", name: "Skill", input: { skill } }] } });
function transcript(dir, lines) {
  const file = path.join(dir, "t.jsonl");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("pre.issue.guard", () => {
  test("raw gh issue create → blocked", () => {
    const dir = project();
    const r = run(dir, { command: 'gh issue create --title "[BUG] x" --body "y"' });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("BLOCKED");
    expect(r.stderr).toContain("setup-issue");
  });

  test("raw gh issue edit → blocked", () => {
    const dir = project();
    const r = run(dir, { command: "gh issue edit 42 --add-label bug" });
    expect(r.code).toBe(2);
  });

  test("marked write while setup-issue runs this turn → allowed", () => {
    const dir = project();
    const t = transcript(dir, [userLine("file it"), skillLine("devops:setup-issue")]);
    const r = run(dir, { command: 'gh issue create --title "[BUG] x" --body "y" # via setup-issue' }, "Bash", { transcript_path: t });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("gh issue list (read-only) → allowed", () => {
    const dir = project();
    const r = run(dir, { command: "gh issue list --state open" });
    expect(r.code).toBe(0);
  });

  test("non-Bash tool → allowed", () => {
    const dir = project();
    const r = run(dir, { file_path: "x.js" }, "Edit");
    expect(r.code).toBe(0);
  });

  test("gh issue create mentioned only in quoted text → allowed", () => {
    const dir = project();
    const r = run(dir, { command: 'grep -r "gh issue create" .' });
    expect(r.code).toBe(0);
  });
});

function runRaw(dir, stdin) {
  const res = spawnSync(process.execPath, [HOOK], { input: stdin, cwd: dir, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

describe("pre.issue.guard — R7/R8 shapes", () => {
  test("PowerShell tool is guarded too", () => {
    const dir = project();
    const r = run(dir, { command: "gh issue create --title x" }, "PowerShell");
    expect(r.code).toBe(2);
  });

  test("gh -R owner/repo issue create → blocked", () => {
    const dir = project();
    expect(run(dir, { command: "gh -R a/b issue create --title x" }).code).toBe(2);
  });

  test("env-prefixed call → blocked", () => {
    const dir = project();
    expect(run(dir, { command: "GH_REPO=a/b gh issue edit 3 --title y" }).code).toBe(2);
  });

  test("marker on a different command segment does not exempt the write", () => {
    const dir = project();
    expect(run(dir, { command: "gh issue create --title x; echo ok # via setup-issue" }).code).toBe(2);
  });

  test("deny text tells a subagent to hand the issue back instead of dead-ending", () => {
    const dir = project();
    const r = run(dir, { command: "gh issue create --title x" });
    expect(r.stderr).toContain("subagent");
    expect(r.stderr).toContain("orchestrator");
  });

  test.each([
    ["empty", ""],
    ["null", "null"],
    ["number", "42"],
    ["array", "[]"],
    ["invalid JSON", "{nope"],
    ["BOM + real write", "\uFEFF" + JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh issue list" } })],
    ["tool_input not an object", JSON.stringify({ tool_name: "Bash", tool_input: "gh issue create" })],
  ])("odd stdin (%s) → exit 0 silently", (_name, stdin) => {
    const dir = project();
    const r = runRaw(dir, stdin);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("BOM-prefixed payload with a real write is still guarded", () => {
    const dir = project();
    const r = runRaw(dir, "\uFEFF" + JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh issue create --title x" } }));
    expect(r.code).toBe(2);
  });
});

describe("pre.issue.guard — marker needs setup-issue in the turn (R3)", () => {
  const marked = 'gh issue create --title "[BUG] x" --body "y"  # via setup-issue';

  test("raw write + self-appended marker without setup-issue in the turn → blocked", () => {
    const dir = project();
    const t = transcript(dir, [userLine("open an issue for this")]);
    expect(run(dir, { command: marked }, "Bash", { transcript_path: t }).code).toBe(2);
  });

  test("no transcript at all → a marked write is blocked", () => {
    expect(run(project(), { command: marked }).code).toBe(2);
  });

  test("setup-issue invoked in an EARLIER turn does not count", () => {
    const dir = project();
    const t = transcript(dir, [userLine("a"), skillLine("setup-issue"), userLine("now something else")]);
    expect(run(dir, { command: marked }, "Bash", { transcript_path: t }).code).toBe(2);
  });

  test("auto-issue (PR-2 name) counts", () => {
    const dir = project();
    const t = transcript(dir, [userLine("x"), skillLine("devops:auto-issue")]);
    expect(run(dir, { command: marked }, "Bash", { transcript_path: t }).code).toBe(0);
  });

  test("a slash-started /devops:setup-issue turn counts", () => {
    const dir = project();
    const t = transcript(dir, [userLine("<command-message>setup-issue</command-message>\n<command-name>/devops:setup-issue</command-name>")]);
    expect(run(dir, { command: marked }, "Bash", { transcript_path: t }).code).toBe(0);
  });

  test("setup-issue in the turn does not rescue an UNMARKED write", () => {
    const dir = project();
    const t = transcript(dir, [userLine("x"), skillLine("setup-issue")]);
    expect(run(dir, { command: "gh issue create --title x" }, "Bash", { transcript_path: t }).code).toBe(2);
  });

  test("the deny text never reveals the marker", () => {
    const r = run(project(), { command: "gh issue create --title x" });
    expect(r.code).toBe(2);
    expect(r.stderr).not.toMatch(/via\s+setup-issue/i);
    expect(r.stderr).not.toContain("marker");
  });

  test("multi-line continuation write from setup-issue passes (R4)", () => {
    const dir = project();
    const t = transcript(dir, [userLine("x"), skillLine("setup-issue")]);
    const cmd = 'gh issue create --repo "a/b" \\\n  --title "[BUG] x" \\\n  --body "y"  # via setup-issue';
    expect(run(dir, { command: cmd }, "Bash", { transcript_path: t }).code).toBe(0);
  });
});

describe("pre.issue.guard — subagent calls read the subagent transcript", () => {
  const marked = 'gh issue create --title "[BUG] x" --body "y"  # via setup-issue';
  const SID = "11111111-2222-3333-4444-555555555555";
  const AID = "a0eca0d0715ce1509";

  /** Real layout: <dir>/<sid>.jsonl + <dir>/<sid>/subagents/agent-<aid>.jsonl */
  function sessionFiles(dir, mainLines, subLines) {
    const main = path.join(dir, `${SID}.jsonl`);
    fs.writeFileSync(main, mainLines.join("\n") + "\n");
    const subDir = path.join(dir, SID, "subagents");
    fs.mkdirSync(subDir, { recursive: true });
    const sub = path.join(subDir, `agent-${AID}.jsonl`);
    if (subLines) fs.writeFileSync(sub, subLines.join("\n") + "\n");
    return { main, sub };
  }

  test("Skill(setup-issue) only in the subagent transcript → passes", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("delegate")], [userLine("brief"), skillLine("devops:setup-issue")]);
    const r = run(dir, { command: marked }, "Bash", { transcript_path: main, session_id: SID, agent_id: AID });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("session id derived from transcript_path when session_id is missing", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("delegate")], [userLine("brief"), skillLine("setup-issue")]);
    expect(run(dir, { command: marked }, "Bash", { transcript_path: main, agent_id: AID }).code).toBe(0);
  });

  test("payload agent_transcript_path is preferred when present", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("delegate")], [userLine("brief")]);
    const other = transcript(dir, [userLine("brief"), skillLine("setup-issue")]);
    const r = run(dir, { command: marked }, "Bash", { transcript_path: main, session_id: SID, agent_id: AID, agent_transcript_path: other });
    expect(r.code).toBe(0);
  });

  test("subagent without setup-issue → blocked with the subagent text", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("x"), skillLine("setup-issue")], [userLine("brief")]);
    const r = run(dir, { command: marked }, "Bash", { transcript_path: main, session_id: SID, agent_id: AID });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "you are a subagent: return the proposed issue (title, type, body with User value line) to the orchestrator instead of writing it"
    );
    expect(r.stderr).not.toMatch(/via\s+setup-issue/i);
  });

  test("subagent transcript missing → blocked with the subagent text (no fallback to the main transcript)", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("x"), skillLine("setup-issue")], null);
    const r = run(dir, { command: marked }, "Bash", { transcript_path: main, session_id: SID, agent_id: AID });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("you are a subagent");
  });

  test("subagent MCP issue write reads the subagent transcript too", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("x")], [userLine("brief"), skillLine("setup-issue")]);
    const extra = { transcript_path: main, session_id: SID, agent_id: AID };
    expect(run(dir, { method: "create" }, "mcp__plugin_github_github__issue_write", extra).code).toBe(0);
  });

  test("path-traversal agent_id is rejected", () => {
    const dir = project();
    const { main } = sessionFiles(dir, [userLine("x"), skillLine("setup-issue")], null);
    const r = run(dir, { command: marked }, "Bash", { transcript_path: main, session_id: SID, agent_id: "../../x" });
    expect(r.code).toBe(2);
  });

  test("main-agent deny text stays unchanged (no subagent variant without agent_id)", () => {
    const r = run(project(), { command: "gh issue create --title x" });
    expect(r.stderr).not.toContain("you are a subagent: return");
  });
});

describe("pre.issue.guard — other write routes (R10)", () => {
  test("GitHub MCP issue_write without setup-issue in the turn → blocked", () => {
    const dir = project();
    const t = transcript(dir, [userLine("x")]);
    const r = run(dir, { method: "create", owner: "a", repo: "b", title: "x" }, "mcp__plugin_github_github__issue_write", { transcript_path: t });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("setup-issue");
  });

  test("GitHub MCP issue_write inside a setup-issue turn → allowed", () => {
    const dir = project();
    const t = transcript(dir, [userLine("x"), skillLine("setup-issue")]);
    expect(run(dir, { method: "update", issue_number: 3 }, "mcp__plugin_github_github__issue_write", { transcript_path: t }).code).toBe(0);
  });

  test("GitHub MCP read tool → allowed", () => {
    expect(run(project(), { issue_number: 3 }, "mcp__plugin_github_github__issue_read").code).toBe(0);
  });

  test("gh api issue write → blocked; gh api read → allowed", () => {
    const dir = project();
    expect(run(dir, { command: "gh api -X PATCH repos/a/b/issues/3 -f title=x" }).code).toBe(2);
    expect(run(dir, { command: "gh api repos/a/b/issues/3" }).code).toBe(0);
  });
});
