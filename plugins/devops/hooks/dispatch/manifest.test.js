import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const build = require("./build-hooks-json.js");
const { eventModules } = require("./dispatch.js");
const { matches } = require("./matcher.js");

const PLUGIN_ROOT = path.resolve(path.dirname(build.MANIFEST), "..", "..");
const manifest = JSON.parse(fs.readFileSync(build.MANIFEST, "utf8"));
const hooksJson = JSON.parse(fs.readFileSync(build.HOOKS_JSON, "utf8"));
const lf = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");

describe("hooks.json is generated from the dispatcher manifest", () => {
  test("hooks.json and lanes.json are current (else: node plugins/devops/hooks/dispatch/build-hooks-json.js)", () => {
    expect(lf(build.HOOKS_JSON)).toBe(build.expectedText());
    expect(lf(build.LANES_JSON)).toBe(build.expectedLanesText());
  });

  test("every manifest command points at an existing hook file", () => {
    for (const event of Object.keys(manifest.hooks)) {
      const mods = eventModules(manifest, event, PLUGIN_ROOT);
      const count = manifest.hooks[event].reduce((n, g) => n + g.hooks.length, 0);
      expect(mods.length, event).toBe(count);
      for (const m of mods) expect(fs.existsSync(m.file), m.file).toBe(true);
    }
  });

  test("one dispatcher entry per event, its timeout above every module budget", () => {
    for (const event of Object.keys(manifest.hooks)) {
      const entries = hooksJson.hooks[event];
      const disp = entries.filter((g) => g.hooks.some((h) => h.command.includes("hooks/dispatch/dispatch.js")));
      expect(disp.length, event).toBe(1);
      const t = disp[0].hooks[0].timeout;
      for (const m of eventModules(manifest, event, PLUGIN_ROOT)) expect(t, `${event}/${m.name}`).toBeGreaterThanOrEqual(m.timeoutS + build.HEADROOM_S);
      expect(disp[0].hooks[0].command).toBe(build.dispatcherCommand(event));
    }
  });

  test("the dispatcher matcher is a superset of every module matcher", () => {
    const names = new Set(["Bash", "PowerShell", "Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Agent", "Task", "Skill",
      "AskUserQuestion", "ExitPlanMode", "EnterWorktree", "BashOutput", "WebFetch", "mcp__github__issue_write", "mcp__x__merge_pull_request",
      "mcp__plugin_devops_dotclaude__ship_release", "mcp__ccd_session_mgmt__archive_session", "mcp__ccd_session__start_session",
      "startup", "resume", "clear", "compact"]);
    for (const groups of Object.values(manifest.hooks)) for (const g of groups) for (const n of String(g.matcher || "").split("|")) if (/^\w+$/.test(n)) names.add(n);
    for (const event of Object.keys(manifest.hooks)) {
      const disp = hooksJson.hooks[event].find((g) => g.hooks.some((h) => h.command.includes("hooks/dispatch/dispatch.js")));
      for (const name of names) {
        const anyModule = eventModules(manifest, event, PLUGIN_ROOT).some((m) => matches(name, m.matcher));
        if (anyModule) expect(matches(name, disp.matcher), `${event} ${name}`).toBe(true);
      }
    }
  });
});
