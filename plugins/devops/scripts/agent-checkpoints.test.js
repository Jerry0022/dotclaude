/**
 * Checkpoint commits for every code-writing agent — not only in a burn.
 *
 * An agent cut off mid-task (usage limit, crash, closed session) never reaches
 * a "commit before returning"; whatever it did not commit lives only in its
 * worktree and its context. The rule therefore sits where every run reads it:
 * the commit conventions, the orchestration prompt template, the recovery
 * procedure and each implementing agent's own definition.
 */
import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const plugin = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(plugin, ...p), "utf8").replace(/\r\n/g, "\n");

const IMPLEMENTERS = ["core", "frontend", "ai", "windows", "designer", "feature"];
const ANALYSTS = ["po", "research", "redteam", "qa", "gamer", "rethinker"];

describe("the rule itself", () => {
  const conv = read("deep-knowledge", "commit-conventions.md");

  test("commit-conventions defines checkpoint commits for the implementing agents", () => {
    expect(conv).toMatch(/## Checkpoint commits \(agents\)/);
    for (const a of IMPLEMENTERS) expect(conv).toContain(`\`${a}\``);
    expect(conv).toMatch(/after every green\s+sub-step/);
    expect(conv).toMatch(/every ~10 tool calls/);
    expect(conv).toMatch(/squash-merges by default/);
    expect(conv).toMatch(/never `--no-verify`/);
  });

  test("never above the session's branch — the three cases: no repo, feature branch, session on main", () => {
    const section = conv.slice(conv.indexOf("## Checkpoint commits"), conv.indexOf("## Rules"));
    expect(section).toMatch(/\*\*Where — never above the session's branch:\*\*/);
    expect(section).toMatch(/\*\*No git repo\*\*[\s\S]{0,80}no branches, no\s+commits/);
    expect(section).toMatch(/\*\*never on `main`, `master` or the remote's\s+default branch, local or remote\.\*\*/);
    expect(section).toMatch(/reached only\s+through `\/do-ship`/);
    expect(section).toMatch(/\*\*The session itself works on `main`\*\*[\s\S]*`main` is the session's branch, so\s+checkpoints and merges land\s+there/);
  });

  test("analysis-only agents are explicitly out", () => {
    const section = conv.slice(conv.indexOf("## Checkpoint commits"), conv.indexOf("## Rules"));
    for (const a of ANALYSTS) expect(section).toContain(`\`${a}\``);
    expect(section).toMatch(/change no files and do not commit/);
  });

  test("the salvage exception to 'never git add -A' names its secret excludes", () => {
    expect(conv).toMatch(/The one exception is the salvage of a cut-off agent's worktree/);
    const plan = read("scripts", "burn-plan.js");
    for (const p of [".env", "*.pem", "*.key", "id_rsa*"]) expect(plan).toContain(`'${p}'`);
  });
});

describe("every run carries it", () => {
  const orch = read("deep-knowledge", "agent-orchestration.md");

  test("the agent prompt template passes the checkpoint rule verbatim", () => {
    const item4 = orch.slice(orch.indexOf("4. **Commit instruction**"), orch.indexOf("5. **Interaction directive**"));
    expect(item4).toMatch(/Commit `wip\(<scope>\): <what>` on your branch after every green sub-step/);
    expect(item4).toMatch(/never above it: while the session is on a\s+feature branch, never on main, master or the default branch\. No git repo:\s+no commits/);
  });

  test("a cut-off agent is secured, continued and never pruned blindly", () => {
    const rec = orch.slice(orch.indexOf("### Recovering a cut-off agent"));
    expect(rec).toMatch(/\*\*Secure the rest\*\*/);
    expect(rec).toMatch(/\*\*Continue, don't restart\*\*/);
    expect(rec).toMatch(/SendMessage/);
    expect(rec).toMatch(/burn-plan\.js" prune-check/);
  });

  test.each(IMPLEMENTERS)("agents/%s.md tells the agent to checkpoint", (a) => {
    const body = read("agents", `${a}.md`);
    expect(body).toMatch(/wip\(<scope>\): <what>/);
    expect(body).toMatch(/every green sub-step/);
    expect(body).toContain("commit-conventions.md` § Checkpoint commits");
    expect(body).toMatch(/never above the session's branch: while the session works on a feature branch, never on main, master or the default branch/);
  });

  test("the conveyor and backlog never merge into main — the script refuses it", () => {
    expect(read("skills", "auto-agents", "SKILL.md")).toMatch(/The integration branch is never `main`, `master` or\s+the default branch while the session works on a feature branch/);
    const backlog = read("skills", "do-run", "modes", "backlog.md");
    expect(backlog).toMatch(/--integration-branch=<this issue's branch>/);
    expect(backlog).toMatch(/state integration --branch=<its branch>/);
    expect(backlog).not.toMatch(/--integration-branch=<base branch>/);
    const plan = read("scripts", "burn-plan.js");
    expect(plan).toMatch(/reason: 'integration-branch-protected'/);
    expect(plan).toMatch(/function mayWrite\(sessionDir, branch\)/);
  });

  test.each(ANALYSTS)("agents/%s.md stays free of commit duties", (a) => {
    expect(read("agents", `${a}.md`)).not.toMatch(/wip\(<scope>\)/);
  });

  test("the burn conveyor reuses the general rule instead of its own copy", () => {
    expect(read("skills", "auto-agents", "SKILL.md")).toMatch(/the checkpoint rule every implementing agent gets/);
    expect(read("skills", "do-run", "modes", "burn", "deep-knowledge", "burn-scheduler.md")).toMatch(/commit-conventions\.md` § Checkpoint\s+commits/);
  });
});
