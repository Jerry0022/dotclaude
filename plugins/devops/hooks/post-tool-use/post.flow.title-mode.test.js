import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { SESSION_PREFIX } from "../../mcp-server/lib/mode-state.js";

vi.setConfig({ testTimeout: 30_000 });

const require = createRequire(import.meta.url);
const { main, modeOf } = require("./post.flow.title-mode.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.flow.title-mode.js");

// The skills' mode steps used to run get_session → strip → set: three API
// calls that each re-read the whole context. This hook hands over the exact
// title so the set call rides along with the next tool call.
const ACTIVATE = `node -e "require('/p/hooks/lib/batch-state.js').activate(process.cwd())"`;
const DEACTIVATE = `node -e "require('/p/hooks/lib/batch-state.js').deactivate(process.cwd())"`;
const skill = (name) => ({ tool_name: "Skill", tool_input: { skill: name } });
const bash = (command, tool_name = "Bash") => ({ tool_name, tool_input: { command } });
const run = (hook, title) => main(hook, { readTitle: () => title });

describe("modeOf", () => {
  test("do-ship skill loads, plugin-qualified or not", () => {
    expect(modeOf(skill("devops:do-ship"))).toBe("ship");
    expect(modeOf(skill("do-ship"))).toBe("ship");
    expect(modeOf(skill("devops:do-batch"))).toBeNull();
  });

  test("the do-batch activate / deactivate commands, Bash or PowerShell", () => {
    expect(modeOf(bash(ACTIVATE))).toBe("batch-on");
    expect(modeOf(bash(DEACTIVATE))).toBe("batch-off");
    expect(modeOf(bash(ACTIVATE, "PowerShell"))).toBe("batch-on");
    expect(modeOf(bash(`node -e "require('../lib/batch-state').activate(cwd)"`))).toBe("batch-on");
    // the last call in a chained command decides
    expect(modeOf(bash(`${ACTIVATE} && ${DEACTIVATE}`))).toBe("batch-off");
  });

  test("anything else is no mode", () => {
    expect(modeOf(bash("node scripts/batch-watchdog.js stop ."))).toBeNull();
    expect(modeOf(bash("git status"))).toBeNull();
    expect(modeOf(bash(`node -e "require('/p/batch-state.js').isModeActive(cwd)"`))).toBeNull();
    expect(modeOf({ tool_name: "Edit", tool_input: { command: ACTIVATE } })).toBeNull();
    expect(modeOf({ tool_name: "Bash" })).toBeNull();
  });
});

describe("main", () => {
  test("do-ship: exact Shipping title, set in parallel, no get_session", () => {
    const out = run(skill("devops:do-ship"), "📦 Ready – Fix login");
    expect(out.context).toContain(`title:${JSON.stringify(SESSION_PREFIX.shipping + "Fix login")}`);
    expect(out.context).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(out.context).toMatch(/SAME message as your next tool call/);
    expect(out.context).toMatch(/no get_session/);
    expect(out.context).toContain("do-ship Pre-Step C");
  });

  test("do-ship: an already shipping or batch-owned title needs nothing", () => {
    expect(run(skill("do-ship"), SESSION_PREFIX.shipping + "Fix login")).toBeNull();
    expect(run(skill("do-ship"), SESSION_PREFIX.batch + "Fix login")).toBeNull();
  });

  test("batch on: Batch prefix, others stripped; already armed → silent", () => {
    const out = run(bash(ACTIVATE), "⏳ Fix login");
    expect(out.context).toContain(JSON.stringify(SESSION_PREFIX.batch + "Fix login"));
    expect(out.context).toContain("activation.md");
    expect(run(bash(ACTIVATE), SESSION_PREFIX.batch + "Fix login")).toBeNull();
  });

  test("batch off: strips exactly the Batch prefix; a renamed title stays", () => {
    const out = run(bash(DEACTIVATE), SESSION_PREFIX.batch + "Fix login");
    expect(out.context).toContain('title:"Fix login"');
    expect(out.context).toContain("merge.md § Retire");
    expect(run(bash(DEACTIVATE), "Renamed")).toBeNull();
  });

  test("unknown title → pointer to the skill's get_session fallback", () => {
    const out = run(skill("do-ship"), null);
    expect(out.context).toMatch(/Title unknown/);
    expect(out.context).toContain("get_session fallback of do-ship Pre-Step C");
    expect(run(bash(DEACTIVATE), null).context).toContain("merge.md § Retire");
  });

  test("an unrelated tool call is silent and never reads the transcript", () => {
    const readTitle = vi.fn(() => "x");
    expect(main(bash("ls"), { readTitle })).toBeNull();
    expect(readTitle).not.toHaveBeenCalled();
  });
});

describe("hook process", () => {
  test("reads the title off the transcript tail and emits additionalContext", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "title-mode-"));
    try {
      const transcript = path.join(dir, "s.jsonl");
      fs.writeFileSync(transcript, JSON.stringify({ type: "custom-title", customTitle: "🧪 Test – Fix login" }) + "\n");
      const r = spawnSync(process.execPath, [HOOK], {
        input: JSON.stringify({ ...skill("devops:do-ship"), transcript_path: transcript, session_id: "s" }),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
      expect(out.hookSpecificOutput.additionalContext).toContain(JSON.stringify(SESSION_PREFIX.shipping + "Fix login"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("garbage stdin exits 0 silently", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "nope", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
