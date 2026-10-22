import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const gate = require("./cleanup-gate.js");
const { gitFor } = require("../pre-tool-use/pre.cleanup.gate.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.join(__dirname, "..", "pre-tool-use", "pre.cleanup.gate.js");
const POST = path.join(__dirname, "..", "post-tool-use", "post.cleanup.gate.js");

const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** main + origin; feat/merged (merge), feat/squash (squash-merged), feat/unmerged (one unshipped commit). */
function scaffold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-gate-"));
  const bare = path.join(dir, "origin.git");
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  git(dir, "init", "-q", "--bare", bare);
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "checkout", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "init");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "checkout", "-q", "-b", "feat/merged");
  fs.writeFileSync(path.join(repo, "merged.txt"), "m\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "merged");
  git(repo, "checkout", "-q", "main"); git(repo, "merge", "-q", "--no-ff", "feat/merged", "-m", "merge");
  git(repo, "checkout", "-q", "-b", "feat/squash");
  fs.writeFileSync(path.join(repo, "squash.txt"), "s\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "squash 1");
  fs.appendFileSync(path.join(repo, "squash.txt"), "s2\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "squash 2");
  git(repo, "checkout", "-q", "main"); git(repo, "merge", "-q", "--squash", "feat/squash"); git(repo, "commit", "-qm", "squashed");
  git(repo, "checkout", "-q", "-b", "feat/unmerged");
  fs.writeFileSync(path.join(repo, "wip.txt"), "w\n");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "wip");
  git(repo, "checkout", "-q", "main");
  git(repo, "push", "-q", "origin", "main", "feat/merged", "feat/squash", "feat/unmerged");
  fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  return { dir, repo };
}

const dryRun = (scopeLines, answer = "Ja, ausführen") => ({
  questions: [{
    header: "Dry-Run",
    question: `Folgende Aktionen werden ausgeführt:\n${scopeLines.join("\n")}\nFortfahren?`,
    options: [{ label: "Ja, ausführen" }, { label: "Abbrechen" }],
    multiSelect: false,
  }],
  answer,
});

function armed(...confirms) {
  const state = { armedAt: Date.now(), dryRun: [], unmerged: [] };
  for (const c of confirms) gate.recordAnswers(state, c.questions, { [c.questions[0].question]: c.answer });
  return state;
}

const unmergedYes = (branch, answer = "Ja, löschen") => ({
  questions: [{
    header: "Unmerged",
    question: `${branch} hat Commits, die nicht in main sind. Trotzdem löschen?`,
    options: [{ label: "Ja, löschen" }, { label: "Behalten" }],
  }],
  answer,
});

describe("parseDeletes — every delete form, with the directory git runs in", () => {
  const cwd = path.resolve("/work/repo");
  const one = (cmd) => gate.parseDeletes(cmd, cwd);

  test.each([
    ["git branch -d feat/merged", "branch", ["feat/merged"]],
    ["git branch -D feat/a feat/b", "branch", ["feat/a", "feat/b"]],
    ["git branch --delete --force refs/heads/feat/a", "branch", ["feat/a"]],
    ["git branch -df feat/a", "branch", ["feat/a"]],
    ["git push origin --delete feat/merged 2>&1", "remote", ["feat/merged"]],
    ["git branch -d feat/a 2>/dev/null > out.txt", "branch", ["feat/a"]],
    ["git branch -d feat/a 2>&1 | head -5", "branch", ["feat/a"]],
    ["git push --delete origin feat/a feat/b", "remote", ["feat/a", "feat/b"]],
    ["git push origin :feat/a", "remote", ["feat/a"]],
    ["git update-ref -d refs/heads/feat/a", "branch", ["feat/a"]],
    ["git worktree remove --force .claude/worktrees/x", "worktree", [".claude/worktrees/x"]],
  ])("%s", (cmd, kind, targets) => {
    const { deletes, unresolved } = one(cmd);
    expect(unresolved).toEqual([]);
    expect(deletes.map((d) => d.kind)).toEqual(targets.map(() => kind));
    expect(deletes.map((d) => d.target)).toEqual(targets);
  });

  test("the eval's forms: -C <path>, cd <path> && …, chained commands", () => {
    const a = one('git -C "C:/Temp/ab-case" branch -D feat/merged');
    expect(a.deletes[0]).toMatchObject({ kind: "branch", target: "feat/merged", dir: path.resolve(cwd, "C:/Temp/ab-case") });
    const b = one('cd "/x/repo" && git branch -d feat/merged; echo ---; git push origin --delete feat/merged');
    expect(b.deletes.map((d) => [d.kind, d.dir])).toEqual([["branch", path.resolve("/x/repo")], ["remote", path.resolve("/x/repo")]]);
  });

  test.each([
    ["git status && git branch -vv"],
    ["git branch feat/new"],
    ["git branch -dr origin/feat/a"],
    ["git push -u origin feat/a"],
    ["git worktree list --porcelain"],
    ["git worktree prune"],
    ['echo "git branch -D feat/a"'],
    ["git update-ref -d refs/tags/v1"],
  ])("no delete: %s", (cmd) => {
    expect(one(cmd)).toEqual({ deletes: [], unresolved: [] });
  });

  test.each([
    ['git -C "$w" status --porcelain'],
    ['git -C ".claude/worktrees/$w" log --oneline'],
    ['git -C "$w" diff'],
    ['git -C "$w" show HEAD'],
    ['git -C "$w" ls-remote origin'],
    ['git -C "$w" for-each-ref refs/heads'],
    ['git -C "$w" worktree list'],
  ])("read-only with a non-literal -C dir passes (#827): %s", (cmd) => {
    expect(one(cmd)).toEqual({ deletes: [], unresolved: [] });
  });

  test.each([
    ['git -C $x branch -D foo'],
    ['git -C "$x" push origin --delete foo'],
    ['git -C "$x" push --prune origin'],
    ['git -C "$x" update-ref -d refs/heads/foo'],
    ['git -C "$x" worktree remove foo'],
  ])("delete with a non-literal -C dir is still refused (#827): %s", (cmd) => {
    expect(one(cmd).unresolved.length).toBeGreaterThan(0);
  });

  test.each([
    ['for b in feat/a feat/b; do git branch -D "$b"; done'],
    ['R="/x"; git -C "$R" branch -d feat/a'],
    ["git for-each-ref --format='%(refname:short)' refs/heads | xargs git branch -D"],
    ["git branch -D feat/*"],
    ["git push --prune origin"],
    ["foreach ($b in $list) { git branch -D $b }"],
  ])("unresolvable → reported, never silently skipped: %s", (cmd) => {
    expect(one(cmd).unresolved.length).toBeGreaterThan(0);
  });
});

describe("recordAnswers — only an answered yes counts", () => {
  test("a Ja option on the Dry-Run question is recorded with its scope", () => {
    const s = armed(dryRun(["- feat/merged"]));
    expect(s.dryRun).toHaveLength(1);
    expect(s.dryRun[0].scope).toContain("feat/merged");
  });

  test.each([["Abbrechen"], ["ja bitte"], ["Other"], [""], [null], [["Ja, ausführen", "Abbrechen"]]])(
    "answer %j is no", (answer) => {
      expect(armed(dryRun(["- feat/merged"], answer)).dryRun).toEqual([]);
    });

  test("a later non-yes Dry-Run answer revokes the earlier approval", () => {
    const s = armed(dryRun(["- feat/merged"]), dryRun(["- feat/merged"], "Abbrechen"));
    expect(s.dryRun).toEqual([]);
  });

  test("questions without a gate header are ignored", () => {
    const s = { armedAt: Date.now(), dryRun: [], unmerged: [] };
    gate.recordAnswers(s, [{ header: "Cleanup", question: "feat/merged löschen?", options: [{ label: "Ja" }] }], { "feat/merged löschen?": "Ja" });
    expect(s).toMatchObject({ dryRun: [], unmerged: [] });
  });

  test("Unmerged yes adds the branch scope; Behalten adds nothing", () => {
    expect(armed(unmergedYes("feat/unmerged")).unmerged).toHaveLength(1);
    expect(armed(unmergedYes("feat/unmerged", "Behalten")).unmerged).toEqual([]);
  });
});

describe("namesBranch / namesWorktree — exact names only", () => {
  test("a branch never matches inside a longer name", () => {
    expect(gate.namesBranch("- feat/x-abc (lokal)", "feat/x")).toBe(false);
    expect(gate.namesBranch("- origin/feat/x", "feat/x")).toBe(false);
    expect(gate.namesBranch("- feat/x (lokal+remote)", "feat/x")).toBe(true);
    expect(gate.namesBranch("1. #412 fix  (claude/ship-probe → main)", "claude/ship-probe")).toBe(true);
    expect(gate.namesBranch("`feat/x`.", "feat/x")).toBe(true);
  });

  test("worktree paths match across slash style and case; cleanup-pr-<n> needs #<n>", () => {
    expect(gate.namesWorktree("- claude/old (C:\\Repo\\.claude\\worktrees\\old)", "C:/repo/.claude/worktrees/old", "C:/repo")).toBe(true);
    expect(gate.namesWorktree("Shippen: 1. #412 fix …", ".claude/worktrees/cleanup-pr-412", "/r")).toBe(true);
    expect(gate.namesWorktree("Shippen: 1. #4120 fix …", ".claude/worktrees/cleanup-pr-412", "/r")).toBe(false);
    expect(gate.namesWorktree("- something else", ".claude/worktrees/other", "/r")).toBe(false);
  });
});

describe("hasLanded / decide against a real repo", () => {
  let w;
  beforeAll(() => { w = scaffold(); });
  afterAll(() => { try { fs.rmSync(w.dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  test("merged and squash-merged branches have landed; unmerged and missing ones have not", () => {
    const g = gitFor(w.repo);
    expect(gate.defaultBase(g)).toBe("refs/remotes/origin/main");
    expect(gate.hasLanded(g, { kind: "branch", target: "feat/merged" })).toBe(true);
    expect(gate.hasLanded(g, { kind: "branch", target: "feat/squash" })).toBe(true);
    expect(gate.hasLanded(g, { kind: "remote", remote: "origin", target: "feat/squash" })).toBe(true);
    expect(gate.hasLanded(g, { kind: "branch", target: "feat/unmerged" })).toBe(false);
    expect(gate.hasLanded(g, { kind: "remote", remote: "origin", target: "feat/unmerged" })).toBe(false);
    expect(gate.hasLanded(g, { kind: "branch", target: "feat/nope" })).toBe(false);
  });

  const decide = (command, state) => gate.decide({ command, cwd: w.repo, state, gitFor });

  test("not armed → the gate is a no-op", () => {
    expect(decide("git branch -D feat/unmerged", null)).toBeNull();
  });

  test("armed without any answer (the -p run: AskUserQuestion errored) → every delete refused", () => {
    const r = decide("git branch -d feat/merged", armed());
    expect(r.block).toMatch(/no Dry-Run-Confirm was answered "Ja" for feat\/merged/);
    expect(r.block).toMatch(/NO deletion/);
    expect(decide(`git -C "${w.repo}" push origin --delete feat/merged`, armed()).block).toBeTruthy();
    expect(decide("git worktree remove .claude/worktrees/x", armed()).block).toBeTruthy();
  });

  test("Abbrechen → refused", () => {
    expect(decide("git branch -d feat/merged", armed(dryRun(["- feat/merged"], "Abbrechen"))).block).toBeTruthy();
  });

  test("confirmed Dry-Run naming a landed branch → allowed, local and remote", () => {
    const s = armed(dryRun(["Lokal löschen (2):", "  - feat/merged", "  - feat/squash", "Remote löschen (1):", "  - feat/squash (origin)"]));
    expect(decide("git branch -D feat/merged feat/squash", s)).toBeNull();
    expect(decide("git push origin --delete feat/squash", s)).toBeNull();
  });

  test("a confirmed Dry-Run does not cover a branch it does not name", () => {
    const r = decide("git branch -d feat/merged feat/squash", armed(dryRun(["- feat/merged"])));
    expect(r.block).toMatch(/does not name feat\/squash/);
  });

  test("unmerged branch: the Dry-Run yes alone is not enough", () => {
    const r = decide("git branch -D feat/unmerged", armed(dryRun(["- feat/unmerged"])));
    expect(r.block).toMatch(/feat\/unmerged has content that is not in the default branch/);
    expect(r.block).toMatch(/header "Unmerged"/);
  });

  test("unmerged branch: Dry-Run yes + its own Unmerged yes → allowed; Behalten → refused", () => {
    expect(decide("git branch -D feat/unmerged", armed(dryRun(["- feat/unmerged"]), unmergedYes("feat/unmerged")))).toBeNull();
    expect(decide("git branch -D feat/unmerged", armed(dryRun(["- feat/unmerged"]), unmergedYes("feat/unmerged", "Behalten"))).block).toBeTruthy();
  });

  test("an Unmerged yes without the Dry-Run yes is still refused", () => {
    expect(decide("git branch -D feat/unmerged", armed(unmergedYes("feat/unmerged"))).block).toMatch(/no Dry-Run-Confirm/);
  });

  test("an unresolvable delete is refused even after a yes", () => {
    const r = decide('for b in feat/merged; do git branch -d "$b"; done', armed(dryRun(["- feat/merged"])));
    expect(r.block).toMatch(/cannot verify what this deletes/);
  });

  test("non-delete commands pass untouched while armed", () => {
    expect(decide("git status && git branch -vv && git log --oneline origin/main..feat/unmerged", armed())).toBeNull();
  });

  describe("Unmerged batch multiSelect", () => {
    const batch = (answer) => ({
      questions: [{
        header: "Unmerged", question: "Welche unmerged Branches löschen?", multiSelect: true,
        options: [{ label: "feat/a" }, { label: "feat/b" }, { label: "feat/c" }],
      }],
      answer,
    });
    const run = (answer) => armed(dryRun(["- feat/a", "- feat/b", "- feat/c"]), batch(answer));
    test.each([["array", ["feat/a", "feat/b"]], ["comma string", "feat/a, feat/b"]])("ticked names pass, unticked refused (%s)", (_n, ans) => {
      const st = run(ans);
      expect(decide("git branch -D feat/a feat/b", st)).toBeNull();
      expect(decide("git branch -D feat/c", st).block).toMatch(/not in the default branch/);
    });
    test.each([[[]], [""], ["my own text"], [["feat/zzz"]]])("empty, Other or unknown records nothing (%j)", (ans) => {
      expect(run(ans).unmerged).toEqual([]);
    });
    test("a ticked name approves exactly that branch, not one it is part of", () => {
      const st = armed(dryRun(["- feat", "- feat-x"]), {
        questions: [{ header: "Unmerged", question: "q", multiSelect: true, options: [{ label: "feat" }, { label: "other" }] }],
        answer: ["feat"],
      });
      expect(st.unmerged).toEqual([expect.objectContaining({ scope: "feat", exact: true })]);
      expect(decide("git branch -D feat-x", st).block).toMatch(/not in the default branch/);
    });
    test.each([
      [[{ label: "feat/a, feat/c" }, { label: "feat/b" }], ["feat/a, feat/c"]],
      [[{ label: "feat/a und feat/c" }, { label: "feat/b" }], ["feat/a und feat/c"]],
      [[{ label: "Ja, alle löschen" }, { label: "feat/b" }], ["Ja, alle löschen"]],
    ])("an option that is not a bare branch name voids the question (%j)", (options, ans) => {
      const st = armed(dryRun(["- feat/a", "- feat/b", "- feat/c"]), {
        questions: [{ header: "Unmerged", question: "q", multiSelect: true, options }], answer: ans,
      });
      expect(st.unmerged).toEqual([]);
    });
    test("single-select still works and refusal points to the batch form", () => {
      expect(decide("git branch -D feat/u", armed(dryRun(["- feat/u"]), unmergedYes("feat/u")))).toBeNull();
      expect(decide("git branch -D feat/u", armed(dryRun(["- feat/u"]))).block).toMatch(/multiSelect/);
    });
  });

  describe("native recursive delete of a worktree (#829)", () => {
    let wt, dirty, orphan, other;
    beforeAll(() => {
      wt = path.join(w.repo, ".claude", "worktrees", "done");
      dirty = path.join(w.repo, ".claude", "worktrees", "dirty");
      git(w.repo, "worktree", "add", "-q", wt, "feat/merged");
      git(w.repo, "worktree", "add", "-q", dirty, "feat/squash");
      fs.writeFileSync(path.join(dirty, "local-note.txt"), "keep me\n");
      orphan = path.join(w.repo, ".claude", "worktrees", "orphan");
      fs.mkdirSync(path.join(orphan, "node_modules"), { recursive: true });
      other = path.join(w.dir, "scratch");
      fs.mkdirSync(other);
    });
    const named = () => armed(dryRun([`- feat/merged (${wt})`, `- feat/squash (${dirty})`, `- orphan (${orphan})`]));

    test.each([
      ["cmd /c rmdir /s /q", (p) => `cmd /c rmdir /s /q "${p}"`],
      ["rm -rf", (p) => `rm -rf "${p}"`],
      ["Remove-Item -Recurse -Force", (p) => `Remove-Item -Recurse -Force -LiteralPath '${p}'`],
      ["rd /S /Q", (p) => `rd /S /Q "${p}"`],
    ])("%s of a clean, confirmed worktree → allowed; unconfirmed → refused", (_n, cmd) => {
      expect(decide(cmd(wt), named())).toBeNull();
      expect(decide(cmd(wt), armed(dryRun(["- feat/squash"]))).block).toMatch(/does not name/);
      expect(decide(cmd(wt), armed()).block).toMatch(/no Dry-Run-Confirm/);
    });

    test.each([
      ["combined cmd switches", (p) => `cmd.exe /C rd /s/q "${p}"`],
      ["quoted inner command", (p) => `cmd /c "rmdir /s /q ${p.replace(/\\/g, "/")}"`],
      ["PowerShell -Path:value", (p) => `Remove-Item -Path:'${p}' -Recurse -Force`],
      ["PowerShell short flags", (p) => `rm -r -fo '${p}'`],
      ["no recursive switch at all", (p) => `rmdir "${p}"`],
      ["trailing slash, other case", (p) => `rm -rf "${p.toUpperCase()}/"`],
      ["relative path", (p) => `rm -rf "${path.relative(w.repo, p)}"`],
      ["after a single &", (p) => `echo hi & rm -rf "${p}"`],
      ["second command inside cmd /c", (p) => `cmd /c "cd C:/ && rmdir /s /q ${p.replace(/\\/g, "/")}"`],
      ["bash -c", (p) => `bash -c "rm -rf '${p}'"`],
      ["powershell -Command", (p) => `powershell -NoProfile -Command "Remove-Item -Recurse -Force '${p}'"`],
      ["env / sudo / nohup prefix", (p) => `env A=1 nohup rm -rf "${p}"`],
      ["subshell", (p) => `( rm -rf "${p}" )`],
      ["comma list", (p) => `Remove-Item -Path "${other}","${p}" -Recurse`],
    ])("unconfirmed worktree delete is refused: %s", (_n, cmd) => {
      expect(decide(cmd(wt), armed(dryRun(["- feat/squash"]))).block).toMatch(/does not name/);
    });

    test("a parent folder of worktrees is refused even when the Dry-Run names it", () => {
      const parent = path.join(w.repo, ".claude", "worktrees");
      expect(decide(`rm -rf "${parent}"`, armed(dryRun([`- ${parent}`]))).block).toMatch(/holds worktrees/);
    });

    test("dirty worktree → refused even when confirmed", () => {
      expect(decide(`cmd /c rmdir /s /q "${dirty}"`, named()).block).toMatch(/uncommitted or untracked changes/);
    });

    test("the main checkout and the session's own directory are refused", () => {
      const s = armed(dryRun([`- main (${w.repo})`]));
      expect(decide(`rm -rf "${w.repo}"`, s).block).toMatch(/main checkout/);
      expect(gate.decide({ command: `rm -rf "${wt}"`, cwd: path.join(wt, "sub"), state: named(), gitFor }).block)
        .toMatch(/session's own directory/);
    });

    test("an orphan under .claude/worktrees/ needs the Dry-Run too; then one prune follows", () => {
      expect(decide(`cmd /c rmdir /s /q "${orphan}"`, armed(dryRun(["- feat/merged"]))).block).toMatch(/does not name/);
      expect(decide(`cmd /c rmdir /s /q "${orphan}" && git worktree prune`, named())).toBeNull();
    });

    test("a delete that is not a worktree is none of the gate's business; a non-literal one is refused", () => {
      expect(decide(`rm -rf "${other}"`, armed())).toBeNull();
      expect(decide(`rm -f "${path.join(wt, "x.txt")}"`, armed())).toBeNull();
      expect(decide(`rm -rf "${path.join(wt, "node_modules")}"`, armed())).toBeNull();
      expect(decide('rm -rf "$WT"', named()).block).toMatch(/not a literal path/);
      expect(decide('rd /s /q "%WT%"', named()).block).toMatch(/not a literal path/);
      expect(decide("rm -rf ~/repo/.claude/worktrees/done", named()).block).toMatch(/not a literal path/);
      expect(decide(`Get-Item "${wt}" | Remove-Item -Recurse`, named()).block).toMatch(/from a pipe/);
      expect(decide("powershell -EncodedCommand AAAA", armed()).block).toMatch(/encoded command/);
    });
  });
});

describe("hooks end to end — post arms and records, pre refuses", () => {
  let w;
  let tmp;
  beforeAll(() => {
    w = scaffold();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-gate-state-"));
  });
  afterAll(() => {
    for (const d of [w.dir, tmp]) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  const run = (hook, payload) => {
    const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
    delete env.CLAUDE_PLUGIN_ROOT;
    return spawnSync(process.execPath, [hook], {
      cwd: w.repo, input: JSON.stringify({ cwd: w.repo, ...payload }), encoding: "utf8", env,
    });
  };
  const bash = (session, command) => run(PRE, { session_id: session, tool_name: "Bash", tool_input: { command } });
  const ask = (session, c) => run(POST, {
    session_id: session, tool_name: "AskUserQuestion",
    tool_input: { questions: c.questions },
    tool_response: { questions: c.questions, answers: { [c.questions[0].question]: c.answer } },
  });

  test("full flow: skill loads → delete refused → Dry-Run yes → landed delete allowed, unmerged still refused", () => {
    expect(bash("S1", "git branch -d feat/merged").status).toBe(0); // not armed yet
    expect(run(POST, { session_id: "S1", tool_name: "Skill", tool_input: { skill: "devops:auto-cleanup" } }).status).toBe(0);

    const refused = bash("S1", "git branch -d feat/merged");
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/\[cleanup-gate\] BLOCKED/);

    expect(ask("S1", dryRun(["- feat/merged", "- feat/unmerged"])).status).toBe(0);
    expect(bash("S1", "git branch -d feat/merged").status).toBe(0);
    const unm = bash("S1", "git branch -D feat/unmerged");
    expect(unm.status).toBe(2);
    expect(unm.stderr).toMatch(/unmerged work/);

    expect(ask("S1", unmergedYes("feat/unmerged")).status).toBe(0);
    expect(bash("S1", "git branch -D feat/unmerged").status).toBe(0);
  });

  test("another session is not gated; a re-armed skill drops earlier yeses", () => {
    expect(bash("S2", "git branch -D feat/unmerged").status).toBe(0);
    run(POST, { session_id: "S3", tool_name: "Skill", tool_input: { skill: "auto-cleanup" } });
    ask("S3", dryRun(["- feat/merged"]));
    expect(bash("S3", "git branch -d feat/merged").status).toBe(0);
    run(POST, { session_id: "S3", tool_name: "Skill", tool_input: { skill: "devops:auto-cleanup" } });
    expect(bash("S3", "git branch -d feat/merged").status).toBe(2);
  });

  test("an unrelated skill does not arm; garbage stdin exits 0", () => {
    run(POST, { session_id: "S4", tool_name: "Skill", tool_input: { skill: "devops:do-ship" } });
    expect(bash("S4", "git branch -D feat/unmerged").status).toBe(0);
    for (const hook of [PRE, POST]) {
      const r = spawnSync(process.execPath, [hook], { cwd: w.repo, input: "not json", encoding: "utf8" });
      expect(r.status).toBe(0);
    }
  });

  test("state expires after the TTL", () => {
    const file = gate.statePath("S5", tmp);
    fs.writeFileSync(file, JSON.stringify({ armedAt: Date.now() - gate.ARM_TTL_MS - 1000, dryRun: [], unmerged: [] }));
    expect(bash("S5", "git branch -D feat/unmerged").status).toBe(0);
  });
});
