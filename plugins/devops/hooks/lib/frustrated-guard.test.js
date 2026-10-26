import { describe, test, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const g = require("./frustrated-guard.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(PLUGIN_ROOT, "hooks", "pre-tool-use", "pre.frustrated.readonly.js");
const CLI = path.join(PLUGIN_ROOT, "scripts", "frustrated-guard.js");

let tmp;
let opts;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fguard-"));
  opts = { featureOn: true, tmpDir: tmp, cwd: path.join(tmp, "proj"), pluginRoot: PLUGIN_ROOT, home: path.join(tmp, "home") };
});

const hook = (tool_name, tool_input, extra = {}) => ({ session_id: "s1", cwd: opts.cwd, tool_name, tool_input, ...extra });

describe("marker", () => {
  test("arm / isArmed / disarm, session-keyed", () => {
    expect(g.isArmed("s1", opts)).toBe(false);
    expect(g.arm("s1", { cwd: "x", target: "t" }, opts)).toBeTruthy();
    expect(g.isArmed("s1", opts)).toBe(true);
    expect(g.isArmed("s2", opts)).toBe(false);
    expect(g.disarm("s1", opts)).toBe(true);
    expect(g.isArmed("s1", opts)).toBe(false);
  });

  test("expires after 2 h and removes itself", () => {
    const nowMs = 1_000_000;
    g.arm("s1", {}, { ...opts, nowMs });
    expect(g.isArmed("s1", { ...opts, nowMs: nowMs + g.EXPIRY_MS - 1 })).toBe(true);
    expect(g.isArmed("s1", { ...opts, nowMs: nowMs + g.EXPIRY_MS })).toBe(false);
    expect(fs.existsSync(g.markerPath("s1", opts))).toBe(false);
  });

  test("feature off: no arm, no read, no deny", () => {
    g.arm("s1", {}, opts);
    const off = { ...opts, featureOn: false };
    expect(g.arm("s9", {}, off)).toBeNull();
    expect(g.isArmed("s1", off)).toBe(false);
    expect(g.decide(hook("Edit", { file_path: "src/a.js" }), off).block).toBe(false);
  });

  test("no session id: never armed", () => {
    expect(g.arm("", {}, opts)).toBeNull();
    expect(g.isArmed("", opts)).toBe(false);
  });
});

describe("decide while armed", () => {
  beforeEach(() => { g.arm("s1", {}, opts); });

  test("unarmed session is never blocked", () => {
    expect(g.decide(hook("Edit", { file_path: "src/a.js" }, { session_id: "other" }), opts).block).toBe(false);
  });

  test.each([
    ["src/a.js", true],
    ["package.json", true],
    ["CLAUDE.md", true],
    [".claude/settings.json", true],
    [".claude/skills/x/SKILL.md", true],
    [".claude/worktrees/w/src/a.js", true],
    [".claude/run-contract.plan.json", false],
    ["src/__snapshots__/a.test.js.snap", false],
    ["coverage/lcov.info", false],
    ["node_modules/.cache/x", false],
    ["docs/concepts/20261025-x/rounds/01.html", false],
  ])("Edit %s → block %s", (p, block) => {
    expect(g.decide(hook("Edit", { file_path: p }), opts).block).toBe(block);
  });

  test("Write into the temp dir / scratchpad is allowed, NotebookEdit on source is not", () => {
    expect(g.decide(hook("Write", { file_path: path.join(tmp, "scratch", "n.md") }), opts).block).toBe(false);
    expect(g.decide(hook("NotebookEdit", { notebook_path: "nb.ipynb" }), opts).block).toBe(true);
  });

  test("subagent calls (agent_id) are covered by the parent's session marker", () => {
    expect(g.decide(hook("Write", { file_path: "src/a.js" }, { agent_id: "a1" }), opts).block).toBe(true);
  });

  test.each([
    "npm test", "npm run test:unit", "npx vitest run a.test.ts", "pytest -q", "python -m pytest", "go test ./...",
    "cargo test", "git log --oneline -5 | head", "git diff --stat", "git status", "git -C sub show HEAD",
    "cat a.txt | grep x", "ls -la 2>/dev/null", "sed -n 1,5p f", "find . -name x", "FOO=1 npm test",
    "npm test > $TEMP/out.txt 2>&1", "mkdir -p $TMP/x", "cp src/a.js $TEMP/a.js", "cat a | tee .claude/notes.json",
    "npm test -- -u", "rg -n 'a > b' src", "echo done",
  ])("Bash allowed: %s", (cmd) => {
    expect(g.decide(hook("Bash", { command: cmd }), opts)).toEqual({ block: false, armed: true });
  });

  test.each([
    "git commit -m x", "git checkout main", "git branch -D x", "git push", "git reset --hard", "git stash",
    "rm -rf src", "mv a b", "echo x > src/a.js", "sed -i s/a/b/ f.js", "find . -delete", "npm install",
    "npm run lint:fix", "eslint --fix .", "node -e \"1\"", "node other.js", "echo $(rm -rf src)",
    "cat <<EOF > src/x.js\nhi\nEOF", "npm test && git commit -am x", "xargs rm", "touch src/new.js",
    "git diff --output=patch.txt", "awk '{print > \"f\"}' a",
  ])("Bash denied: %s", (cmd) => {
    const r = g.decide(hook("Bash", { command: cmd }), opts);
    expect(r.block).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  test("plugin state scripts of the own plugin root are allowed", () => {
    for (const s of ["scripts/feature-flag.js\" check frustrated-mode", "hooks/lib/run-contract.js\" plan status", "scripts/frustrated-brief.js\" --transcript t"]) {
      expect(g.decide(hook("Bash", { command: `node "${PLUGIN_ROOT}/${s}` }), opts).block).toBe(false);
    }
    expect(g.decide(hook("Bash", { command: `node "${PLUGIN_ROOT}/scripts/gen-readme-sections.mjs"` }), opts).block).toBe(true);
    expect(g.decide(hook("Bash", { command: `node "${PLUGIN_ROOT}/mcp-server/index.js" --render-card /tmp/p.json` }), opts).block).toBe(false);
  });

  test("PowerShell: read cmdlets pass, Set-Content is denied", () => {
    expect(g.decide(hook("PowerShell", { command: "Get-ChildItem src | Select-Object -First 3" }), opts).block).toBe(false);
    expect(g.decide(hook("PowerShell", { command: "Set-Content src/a.js 'x'" }), opts).block).toBe(true);
  });

  test("Workflow is always denied; mutating ship/GitHub MCP tools are denied; reads and other tools pass", () => {
    expect(g.decide(hook("Workflow", { script: "x" }), opts).block).toBe(true);
    expect(g.decide(hook("mcp__plugin_devops_dotclaude__ship_release", {}), opts).block).toBe(true);
    expect(g.decide(hook("mcp__github__create_pull_request", {}), opts).block).toBe(true);
    expect(g.decide(hook("mcp__github__get_issue", {}), opts).block).toBe(false);
    expect(g.decide(hook("Read", { file_path: "src/a.js" }), opts).block).toBe(false);
    expect(g.decide(hook("Agent", { subagent_type: "devops:po" }), opts).block).toBe(false);
  });
});

describe("isAllowedWritePath — drive-relative temp roots", () => {
  // REGRESSION (CI): on a runner the process sat on D: while the repo resolved
  // on C:; "/tmp" became D:/tmp and "/tmp/x.log" C:/tmp/x.log — a false alarm.
  test("/tmp is allowed whatever drive the repo is on", () => {
    const other = process.platform === "win32"
      ? `${process.cwd()[0].toUpperCase() === "Q" ? "R" : "Q"}:/repo`
      : "/srv/repo";
    expect(g.isAllowedWritePath("/tmp/x.log", { cwd: other })).toBe(true);
    expect(g.isAllowedWritePath("/tmp/../x.log", { cwd: other })).toBe(false);
  });
});

describe("hookDecision: arm / disarm through the payload", () => {
  const nodeCmd = (sub) => `node "${PLUGIN_ROOT}/scripts/frustrated-guard.js" ${sub}`;

  test("main thread arms and disarms with the payload's session id", () => {
    expect(g.hookDecision(hook("Bash", { command: nodeCmd("arm --target x") }), opts)).toMatchObject({ block: false, applied: "arm" });
    expect(g.isArmed("s1", opts)).toBe(true);
    expect(g.hookDecision(hook("Bash", { command: nodeCmd("disarm") }), opts)).toMatchObject({ block: false, applied: "disarm" });
    expect(g.isArmed("s1", opts)).toBe(false);
  });

  test("a subagent cannot disarm", () => {
    g.arm("s1", {}, opts);
    expect(g.hookDecision(hook("Bash", { command: nodeCmd("disarm") }, { agent_id: "a1" }), opts).block).toBe(true);
    expect(g.isArmed("s1", opts)).toBe(true);
  });

  test("deny text names the reason, what is allowed and how the guard ends", () => {
    const t = g.denyText("Edit of src/a.js changes the app's source or config");
    expect(t).toContain("[pre.frustrated.readonly] BLOCKED");
    expect(t).toMatch(/tests/);
    expect(t).toMatch(/plan approve/);
    expect(t).toMatch(/2 h/);
  });
});

/** Spawned hook / CLI under a temp HOME (alpha or stable pin) and a temp TMP dir. */
function env(channel) {
  const home = path.join(tmp, `home-${channel}`);
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "plugins", ".channels.json"), JSON.stringify({ dotclaude: channel }));
  const e = { ...process.env, HOME: home, USERPROFILE: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  // a source-dir root is an ad-hoc load: plugin-guard lets the hook run
  e.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  delete e.CLAUDE_CODE_SESSION_ID;
  delete e.CLAUDE_SESSION_ID;
  return e;
}

function runHook(payload, channel) {
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8", env: env(channel) });
}

describe("pre.frustrated.readonly (spawned)", () => {
  test("alpha: arm via the CLI command, then a source edit is denied with exit 2", () => {
    const cwd = path.join(tmp, "proj");
    const a = runHook({ session_id: "e2e", cwd, tool_name: "Bash", tool_input: { command: `node "${CLI}" arm` } }, "alpha");
    expect(a.status).toBe(0);
    const r = runHook({ session_id: "e2e", cwd, tool_name: "Edit", tool_input: { file_path: "src/a.js" } }, "alpha");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("[pre.frustrated.readonly] BLOCKED");
    const t = runHook({ session_id: "e2e", cwd, tool_name: "Bash", tool_input: { command: "npm test" } }, "alpha");
    expect(t.status).toBe(0);
  });

  test("stable: silent no-op even with a marker on disk", () => {
    g.arm("e2e-s", {}, opts);
    const r = runHook({ session_id: "e2e-s", cwd: tmp, tool_name: "Edit", tool_input: { file_path: "src/a.js" } }, "stable");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("garbage input never blocks", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8", env: env("alpha") });
    expect(r.status).toBe(0);
  });
});

describe("scripts/frustrated-guard.js", () => {
  const { main } = require("../../scripts/frustrated-guard.js");

  test("arm / status / disarm with --session", () => {
    expect(main(["arm", "--session", "c1", "--target", "login"], {}, opts)).toMatchObject({ code: 0, out: { armed: true } });
    expect(main(["status", "--session", "c1"], {}, opts).out).toMatchObject({ armed: true, target: "login" });
    expect(main(["disarm", "--session", "c1"], {}, opts).out).toMatchObject({ disarmed: true });
    expect(main(["status", "--session", "c1"], {}, opts).out.armed).toBe(false);
  });

  test("session id from the environment; none → exit 1; bad usage → exit 2", () => {
    expect(main(["arm"], { CLAUDE_CODE_SESSION_ID: "c2" }, opts).code).toBe(0);
    expect(g.isArmed("c2", opts)).toBe(true);
    expect(main(["arm"], {}, opts).code).toBe(1);
    expect(main(["nope"], {}, opts).code).toBe(2);
  });

  test("feature off → 126 (in-process and spawned on stable)", () => {
    expect(main(["arm", "--session", "c3"], {}, { ...opts, featureOn: false }).code).toBe(126);
    const r = spawnSync(process.execPath, [CLI, "status", "--session", "x"], { encoding: "utf8", env: env("stable") });
    expect(r.status).toBe(126);
  });
});
