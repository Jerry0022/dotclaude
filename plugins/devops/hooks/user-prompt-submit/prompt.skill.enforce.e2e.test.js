import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 30_000 });

const HOOK = fileURLToPath(new URL("./prompt.skill.enforce.js", import.meta.url));
const SESSION = "skill-enforce-e2e";

let cwd;
let tmp;

/** Run the hook as the harness does: JSON on stdin, a git project as cwd so
 *  plugin-guard's "outside the installed cache" tell lets it run. Session
 *  files go to a private temp dir. */
function runRaw(stdin) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    cwd,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

function runHook(payload) {
  return runRaw(JSON.stringify({ cwd, session_id: SESSION, ...payload }));
}

function writeClaude(name, data) {
  fs.writeFileSync(path.join(cwd, ".claude", name), JSON.stringify(data));
}

function transcriptWithSkill(skill) {
  const file = path.join(cwd, "t.jsonl");
  fs.writeFileSync(file, [
    { type: "user", message: { role: "user", content: [{ type: "text", text: "earlier" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Skill", input: { skill } }] } },
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

const FUTURE = () => new Date(Date.now() + 3600_000).toISOString();

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "skill-enforce-e2e-"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-enforce-tmp-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
  );
  execFileSync("git", ["init", "-q"], { cwd });
});

afterEach(() => {
  for (const d of [cwd, tmp]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

describe("prompt.skill.enforce — e2e process (mentions + router)", () => {
  test("inline /name mention still forces a mandatory Skill load (pre-existing behaviour)", () => {
    const r = runHook({ prompt: "/auto-concept lass uns das machen und dann direkt umsetzen" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Skill("auto-concept")');
    expect(r.stdout).toContain("MANDATORY");
  });

  test("an already-expanded slash command is skipped entirely", () => {
    const r = runHook({ prompt: "<command-name>concept</command-name> args… error TypeError: x" });
    expect(r.stdout).toBe("");
    expect(r.code).toBe(0);
  });

  test.each([
    ["task notification", "[SYSTEM NOTIFICATION] continuing after TypeError: x\n  at f (a.js:1:2)"],
    ["autonomous loop", "/loop <<autonomous-loop>> ich bin festgefahren, /auto-concept"],
    ["silent cron", "Silently run the concept bridge poll — mach ein concept"],
    ["AFK autostart", "AUTONOMOUS_AUTOSTART: /auto-concept festgefahren"],
    ["AFK resume", "AUTONOMOUS_RESUME: continue, TypeError: x\n  at f (a.js:1:2)"],
    ["backlog autostart", "RUN_BACKLOG_AUTOSTART: arbeite den backlog ab"],
    ["scheduled task", '<scheduled-task name="nightly" file="x">mach ein concept</scheduled-task>'],
    ["task-notification tag", "<task-notification>ich bin festgefahren</task-notification>"],
  ])("machine prompt (%s) → silent", (_name, prompt) => {
    expect(runHook({ prompt }).stdout).toBe("");
  });

  test("pre-PR-2 alias mention (/fix) maps to the new skill (auto-fix)", () => {
    expect(runHook({ prompt: "kannst du /fix laufen lassen" }).stdout).toContain('Skill("auto-fix")');
  });

  test("a new name is a real skill → inline mention (/auto-fix, /do-learn)", () => {
    expect(runHook({ prompt: "kannst du /auto-fix laufen lassen" }).stdout).toContain('Skill("auto-fix")');
    expect(runHook({ prompt: "/do-learn der Port ist 3000" }).stdout).toContain('Skill("do-learn")');
  });

  test("/claude-learn alias → do-learn", () => {
    expect(runHook({ prompt: "bitte /claude-learn der Port ist 3000" }).stdout).toContain('Skill("do-learn")');
  });

  test("a folded alias carries its mode as the skill args", () => {
    expect(runHook({ prompt: "und dann /run-backlog" }).stdout).toContain('Skill("do-run") with args "backlog"');
  });

  test("the old /ship alias emits nothing (prompt.ship.detect owns ship)", () => {
    expect(runHook({ prompt: "/ship bitte" }).stdout).toBe("");
  });

  // promote is do-ship's target channel since the skill restructure PR 2 —
  // prompt.ship.detect parses it and passes the channel as the skill args.
  test("the old /promote alias emits nothing either (prompt.ship.detect owns it)", () => {
    expect(runHook({ prompt: "jetzt /promote bitte" }).stdout).not.toContain('Skill("do-ship")');
  });

  test("a mention inside backticks or quotes is not an invocation", () => {
    expect(runHook({ prompt: "the doc still says `/auto-concept` there" }).stdout).toBe("");
    expect(runHook({ prompt: 'die Hook-Meldung „/concept first“ ist veraltet' }).stdout).toBe("");
  });

  test("a real bug report (stack trace + 'geht nicht') routes to fix", () => {
    const r = runHook({
      prompt: "geht nicht:\nTypeError: Cannot read properties of undefined (reading 'map')\n  at Foo (bar.js:12:5)",
    });
    expect(r.stdout).toContain('Skill("auto-fix")');
  });

  test("Traceback + crash routes to fix", () => {
    const r = runHook({ prompt: 'crash beim Start\nTraceback (most recent call last):\n  File "app.py", line 3' });
    expect(r.stdout).toContain('Skill("auto-fix")');
  });

  test.each([
    "ship", "weiter", "fix auch X und dann ship", "merge main hierrein", "und dann ship!",
    "prüf alles nochmal", "check ob es fehler gibt, fix diese", "can we do a polish pass on the settings page",
    "the spinner is stuck", "PR #471 failed CI",
  ])("user style %s → silent", (prompt) => {
    expect(runHook({ prompt }).stdout).toBe("");
  });

  test.each([
    ["mach mir dazu ein concept", "auto-concept"],
    ["ich bin festgefahren", "do-run"],
  ])("%s → %s", (prompt, skill) => {
    expect(runHook({ prompt }).stdout).toContain(`Skill("${skill}")`);
  });

  test("ship / batch wording is left to the dedicated hooks", () => {
    expect(runHook({ prompt: "ship it" }).stdout).not.toContain('Skill("do-ship")');
    expect(runHook({ prompt: "lass uns erstmal sammelmodus nutzen" }).stdout).not.toContain('Skill("do-batch")');
  });

  test("burn mode (explicit-only) never fires from wording", () => {
    expect(runHook({ prompt: "let's burn the whole budget today" }).stdout).toBe("");
  });
});

describe("prompt.skill.enforce — context filters (R3, R10)", () => {
  test("a skill already invoked this session is not re-mandated by the router", () => {
    const t = transcriptWithSkill("devops:do-run");
    expect(runHook({ prompt: "ich bin festgefahren", transcript_path: t }).stdout).toBe("");
  });

  test("a skill invoked under its pre-PR-2 name counts as already running", () => {
    const t = transcriptWithSkill("devops:tune-rethink");
    expect(runHook({ prompt: "ich bin festgefahren", transcript_path: t }).stdout).toBe("");
  });

  test("…but an explicit /name mention still is", () => {
    const t = transcriptWithSkill("devops:auto-concept");
    expect(runHook({ prompt: "/auto-concept nochmal neu", transcript_path: t }).stdout).toContain('Skill("auto-concept")');
  });

  const conceptState = (overrides = {}) => ({
    port: 1234, html_path: "docs/concepts/x.html", started_at: new Date().toISOString(), ...overrides,
  });

  test("a valid, fresh concept-active.json mutes concept routing", () => {
    writeClaude("concept-active.json", conceptState());
    expect(runHook({ prompt: "mach mir dazu ein concept" }).stdout).toBe("");
  });

  test.each([
    ["stale (>24 h)", conceptState({ started_at: new Date(Date.now() - 48 * 3600_000).toISOString() })],
    ["no html_path", { port: 1234 }],
    ["absolute html_path", conceptState({ html_path: "C:/x/docs/concepts/x.html" })],
    ["bad port", conceptState({ port: "abc" })],
  ])("a %s leftover concept-active.json does NOT mute concept routing (R9)", (_name, state) => {
    writeClaude("concept-active.json", state);
    expect(runHook({ prompt: "mach mir dazu ein concept" }).stdout).toContain('Skill("auto-concept")');
  });

  test("unparseable concept-active.json does not mute either (R9)", () => {
    fs.writeFileSync(path.join(cwd, ".claude", "concept-active.json"), "{nope");
    expect(runHook({ prompt: "mach mir dazu ein concept" }).stdout).toContain('Skill("auto-concept")');
  });

  test("a skill started as a slash command earlier this session is not re-mandated (R5)", () => {
    for (const name of ["/devops:do-run", "/do-run", "/devops:tune-rethink", "tune-rethink"]) {
      const file = path.join(cwd, "t.jsonl");
      fs.writeFileSync(file, [
        { type: "user", message: { role: "user", content: `<command-message>tune-rethink</command-message>\n<command-name>${name}</command-name>` } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
      ].map((l) => JSON.stringify(l)).join("\n") + "\n");
      expect(runHook({ prompt: "ich bin festgefahren", transcript_path: file }).stdout).toBe("");
    }
  });

  test("batch mode active → router silent", () => {
    writeClaude("batch-mode.json", { active: true, expiresAt: FUTURE() });
    expect(runHook({ prompt: "ich bin festgefahren" }).stdout).toBe("");
  });

  test("batch mode being activated in this prompt → router silent", () => {
    expect(runHook({ prompt: "Sammelmodus an — und ich bin festgefahren" }).stdout).toBe("");
  });

  test("AFK lockout armed → router silent", () => {
    fs.writeFileSync(path.join(cwd, "AUTONOMOUS-LOCKOUT.flag"), JSON.stringify({ owner: "autonomous" }));
    expect(runHook({ prompt: "ich bin festgefahren" }).stdout).toBe("");
  });

  test("strict mode active → auto-harden / auto-polish are suppressed", () => {
    writeClaude("strict-mode.json", { active: true, expiresAt: FUTURE() });
    expect(runHook({ prompt: "kannst du das härten" }).stdout).toBe("");
    expect(runHook({ prompt: "Zeit für Feinschliff" }).stdout).toBe("");
  });

  test("consumer project talking about the devops plugin → no fix mandate", () => {
    const r = runHook({ prompt: "the devops plugin hook breaks:\nTypeError: x is undefined\n  at f (a.js:1:2)\ngeht nicht" });
    expect(r.stdout).not.toContain('Skill("auto-fix")');
  });
});

describe("prompt.skill.enforce — concept phrases and soft hints (R1, R2)", () => {
  test.each([
    "concept A passt",
    "der concept skill schreibt den port zu spät",
    "im concept fehlt X",
    "das ist ein neues Issue nach dem Merge",
    "lint und fix, dann ship",
  ])("%s → silent", (prompt) => {
    expect(runHook({ prompt }).stdout).toBe("");
  });

  test("a meta word next to the phrase → non-mandatory hint, not a mandate", () => {
    const r = runHook({ prompt: "der web guide hint nervt" });
    expect(r.stdout).toContain("auto-guide");
    expect(r.stdout).toContain("NOT mandatory");
    expect(r.stdout).not.toContain("MANDATORY");
    expect(r.stdout).not.toContain('Skill("auto-guide")');
  });

  describe("in the plugin source repo", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(cwd, "plugins", "devops", ".claude-plugin"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "plugins", "devops", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "devops" }));
    });

    test.each([
      ["der backlog runner parkt zu früh", "do-run"],
      ["devops update hängt beim cache", "auto-update"],
      ["die skill extension lädt nicht", "auto-extend"],
      ["devops learn hat falsch geroutet", "do-learn"],
      ["ich bin festgefahren", "do-run"],
    ])("%s → soft hint for %s", (prompt, skill) => {
      const r = runHook({ prompt });
      expect(r.stdout).toContain(skill);
      expect(r.stdout).toContain("NOT mandatory");
      expect(r.stdout).not.toContain(`Skill("${skill}")`);
    });

    test("an explicit /name mention stays mandatory", () => {
      expect(runHook({ prompt: "/auto-concept bitte" }).stdout).toContain('Skill("auto-concept")');
    });

    test("an error pattern stays mandatory", () => {
      const r = runHook({ prompt: "geht nicht:\nTypeError: x\n  at f (a.js:1:2)" });
      expect(r.stdout).toContain('Skill("auto-fix")');
    });
  });
});

describe("prompt.skill.enforce — pending guide hint (R4)", () => {
  const pendingFile = () => path.join(tmp, `dotclaude-devops-guide-handoff-pending-${SESSION}`);

  test("next real prompt gets ONE non-mandatory hint, then it is cleared", () => {
    fs.writeFileSync(pendingFile(), JSON.stringify({ service: "Upstash", at: Date.now() }));
    const r = runHook({ prompt: "ok, bin jetzt auf der Seite" });
    expect(r.stdout).toContain("Upstash");
    expect(r.stdout).toContain("auto-guide");
    expect(r.stdout).not.toContain("MANDATORY");
    expect(fs.existsSync(pendingFile())).toBe(false);
    expect(runHook({ prompt: "und jetzt?" }).stdout).toBe("");
  });

  test("a machine prompt does not consume the hint", () => {
    fs.writeFileSync(pendingFile(), JSON.stringify({ service: "Upstash", at: Date.now() }));
    expect(runHook({ prompt: "<task-notification>done</task-notification>" }).stdout).toBe("");
    expect(fs.existsSync(pendingFile())).toBe(true);
  });
});

describe("prompt.skill.enforce — odd stdin", () => {
  test.each([
    ["empty", ""],
    ["null", "null"],
    ["number", "42"],
    ["string", '"ich bin festgefahren"'],
    ["array", '["x"]'],
    ["invalid JSON", "{nope"],
    ["prompt not a string", JSON.stringify({ prompt: { text: "x" } })],
  ])("%s → exit 0, silent", (_name, stdin) => {
    const r = runRaw(stdin);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  test("BOM + CRLF payload still works", () => {
    const r = runRaw("\uFEFF{\r\n\"prompt\": \"ich bin festgefahren\",\r\n\"session_id\": \"x\"\r\n}");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Skill("do-run")');
  });

  test("missing transcript file does not break the already-invoked check", () => {
    const r = runHook({ prompt: "ich bin festgefahren", transcript_path: path.join(cwd, "nope.jsonl") });
    expect(r.stdout).toContain('Skill("do-run")');
  });
});
