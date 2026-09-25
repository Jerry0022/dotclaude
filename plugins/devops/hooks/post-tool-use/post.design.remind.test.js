import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.design.remind.js");

const projects = [];
afterAll(() => {
  for (const dir of projects) fs.rmSync(dir, { recursive: true, force: true });
});

// Builds a temp project whose settings enable the plugin (plugin-guard) and
// carries its own private tmpdir, so the once-per-context marker file this
// hook writes to os.tmpdir() cannot collide with any other parallel test.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-remind-"));
  projects.push(dir);
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  fs.mkdirSync(path.join(dir, ".tmp"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".home"), { recursive: true });
  return dir;
}

let sidCounter = 0;
function nextSid() {
  sidCounter += 1;
  return `s-design-remind-${process.pid}-${sidCounter}`;
}

function hookInput(dir, { toolName = "Write", filePath, sessionId, agentId }) {
  return JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath },
    session_id: sessionId,
    ...(agentId ? { agent_id: agentId } : {}),
    cwd: dir,
  });
}

function hookEnv(dir) {
  const tmp = path.join(dir, ".tmp");
  const home = path.join(dir, ".home");
  return { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, HOME: home, USERPROFILE: home };
}

function runHookRaw(dir, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = spawnSync(process.execPath, [HOOK], {
      cwd: dir,
      input: hookInput(dir, opts),
      encoding: "utf8",
      env: hookEnv(dir),
    });
    if (res.status !== null || attempt >= 3) {
      if (res.status === null) {
        throw new Error(`hook never started after ${attempt + 1} attempts: ${res.error}`);
      }
      // Never blocks: silent or not, every path exits 0.
      expect(res.status).toBe(0);
      return res.stdout || "";
    }
  }
}

/** stdout must be exactly one PostToolUse envelope — no plain text beside it. */
function envelope(stdout) {
  const out = JSON.parse(stdout);
  expect(Object.keys(out)).toEqual(["hookSpecificOutput"]);
  expect(out.hookSpecificOutput).toEqual({ hookEventName: "PostToolUse", additionalContext: expect.any(String) });
  return out.hookSpecificOutput.additionalContext;
}

/** What the model reads from one run; '' when the hook sent nothing. */
function runHook(dir, opts) {
  const stdout = runHookRaw(dir, opts);
  return stdout ? envelope(stdout) : "";
}

/** One run without waiting for it, so several can race for the marker. */
function runHookAsync(dir, opts, attempt = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const child = spawn(process.execPath, [HOOK], { cwd: dir, env: hookEnv(dir) });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => { stdout += d; });
    // A child that never started never touched the marker: retrying is safe.
    child.on("error", (err) => settle(
      attempt < 3 ? resolve : reject,
      attempt < 3 ? runHookAsync(dir, opts, attempt + 1) : err,
    ));
    child.on("close", (code) => {
      if (code === 0) settle(resolve, stdout);
      else if (code !== null) settle(reject, new Error(`hook exited ${code}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(hookInput(dir, opts));
  });
}

function writeOverride(dir, body, skillDir = "auto-polish") {
  const refDir = path.join(dir, ".claude", "skills", skillDir);
  fs.mkdirSync(refDir, { recursive: true });
  fs.writeFileSync(path.join(refDir, "reference.md"), `## UI rules\n${body}\n`);
}

describe("post.design.remind (hook)", () => {
  test("non-UI file produces no reminder", () => {
    const dir = project();
    expect(runHookRaw(dir, {
      filePath: path.join(dir, "src", "service.ts"),
      sessionId: nextSid(),
    })).toBe("");
  });

  test("UI file produces the reminder with R0..R6", () => {
    const dir = project();
    const context = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(context).toContain("[ui-defaults]");
    for (const id of ["R0", "R1", "R2a", "R2b", "R3", "R4", "R5", "R6"]) {
      expect(context).toContain(`${id} `);
    }
    expect(context).toContain("part of every rule");
    expect(context).toContain("never a native title");
    expect(context).toContain("Info 1500 ms (default), Label 500 ms");
    expect(context).toContain("R5 scrollbars");
    expect(context).toContain("R6 platform matrix");
  });

  test("the reminder names ui-defaults.md by its absolute plugin path, never a bare relative one", () => {
    // A bare `deep-knowledge/ui-defaults.md` does not exist in a consumer
    // project; the model then searched the filesystem root for it (2026-09-24).
    const dir = project();
    const context = runHook(dir, { filePath: path.join(dir, "src", "App.tsx"), sessionId: nextSid() });
    const root = (process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, "..", "..")).replace(/\\/g, "/");
    expect(context).toContain(`Read ${root}/deep-knowledge/ui-defaults.md for the full rules`);
    expect(context).not.toMatch(/[\s(]deep-knowledge\/ui-defaults\.md/);
  });

  test("tooltip.delay override changes the R1 tiers; project beats user-global", () => {
    const dir = project();
    writeOverride(dir, "- tooltip.delay: info 1200, label 400   # ms");
    const userRef = path.join(dir, ".home", ".claude", "skills", "auto-polish");
    fs.mkdirSync(userRef, { recursive: true });
    fs.writeFileSync(
      path.join(userRef, "reference.md"),
      "## UI rules\n- tooltip.delay: info 2000, label 300\n"
    );

    const context = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(context).toContain("Info 1200 ms (default), Label 400 ms");
    expect(context).not.toContain("tooltip.delay");
  });

  test("a user-global tooltip.delay applies when the project sets none", () => {
    const dir = project();
    const userRef = path.join(dir, ".home", ".claude", "skills", "auto-polish");
    fs.mkdirSync(userRef, { recursive: true });
    fs.writeFileSync(path.join(userRef, "reference.md"), "## UI rules\n- tooltip.delay: label 400\n");

    const context = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(context).toContain("Info 1500 ms (default), Label 400 ms");
  });

  test("fires once per session, and again in a different session", () => {
    const dir = project();
    const sid = nextSid();
    const first = runHook(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: sid });
    expect(first).toContain("[ui-defaults]");

    const second = runHookRaw(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: sid });
    expect(second).toBe("");

    const otherSid = nextSid();
    const third = runHook(dir, { filePath: path.join(dir, "src", "Second.jsx"), sessionId: otherSid });
    expect(third).toContain("[ui-defaults]");
  });

  test("project override disables rules, keeps a free-form bullet, and widens detection via files:", () => {
    const dir = project();
    writeOverride(
      dir,
      "- disable: R2b, R4\n" +
      "- files: .ts\n" +
      "- Icon-only buttons in the title bar are exempt from R1 (platform chrome)."
    );

    const context = runHook(dir, {
      filePath: path.join(dir, "src", "thing.ts"),
      sessionId: nextSid(),
    });
    expect(context).toContain("[ui-defaults]");
    expect(context).toContain("R1 ");
    expect(context).toContain("R2a ");
    expect(context).not.toMatch(/\bR2b\b .*/);
    expect(context).not.toContain("R2b uniform");
    expect(context).not.toContain("R4 every");
    expect(context).toContain("disabled by project override: R2b, R4");
    expect(context).toContain("Icon-only buttons in the title bar are exempt from R1 (platform chrome).");
  });

  test("falls back to the pre-PR-2 tune-polish extension dir", () => {
    const dir = project();
    writeOverride(dir, "- disable: R4", "tune-polish");
    const context = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(context).toContain("disabled by project override: R4");
  });

  test("the new auto-polish dir wins over the old tune-polish dir", () => {
    const dir = project();
    writeOverride(dir, "- disable: R4", "auto-polish");
    writeOverride(dir, "- disable: R1", "tune-polish");
    const context = runHook(dir, {
      filePath: path.join(dir, "src", "App.tsx"),
      sessionId: nextSid(),
    });
    expect(context).toContain("disabled by project override: R4");
    expect(context).not.toContain("disabled by project override: R1");
  });

  test("concept pages get the reminder — the rules apply there too", () => {
    const dir = project();
    const context = runHook(dir, {
      filePath: path.join(dir, "docs", "concepts", "x.html"),
      sessionId: nextSid(),
    });
    expect(context).toContain("[ui-defaults]");
  });

  test("plugin source stays excluded by default, a files: glob opts it in", () => {
    const dir = project();
    const templates = path.join(dir, "plugins", "devops", "skills", "auto-concept", "deep-knowledge", "templates.md");
    expect(runHookRaw(dir, { filePath: templates, sessionId: nextSid() })).toBe("");
    expect(runHookRaw(dir, {
      filePath: path.join(dir, "plugins", "devops", "skills", "foo", "SKILL.md"),
      sessionId: nextSid(),
    })).toBe("");

    writeOverride(dir, "- files: plugins/devops/skills/auto-concept/deep-knowledge/templates.md");
    expect(runHook(dir, { filePath: templates, sessionId: nextSid() })).toContain("[ui-defaults]");
  });

  test("node_modules stays excluded even when a files: glob matches", () => {
    const dir = project();
    writeOverride(dir, "- files: .html");
    expect(runHookRaw(dir, {
      filePath: path.join(dir, "node_modules", "pkg", "index.html"),
      sessionId: nextSid(),
    })).toBe("");
  });

  test("Bash tool produces no reminder", () => {
    const dir = project();
    expect(runHookRaw(dir, { toolName: "Bash", filePath: undefined, sessionId: nextSid() })).toBe("");
  });
});

// A PostToolUse hook reaches the model only through
// hookSpecificOutput.additionalContext — its plain stdout lands in the
// transcript as `hook_success` and nowhere else (CONVENTIONS.md, verified live
// 2026-09-25). Delivered, the reminder stays in the context for the rest of
// the session, so every context gets it exactly once.
describe("post.design.remind — reaches the model, once per context", () => {
  test("stdout is exactly one additionalContext envelope, never plain text", () => {
    const dir = project();
    const stdout = runHookRaw(dir, { filePath: path.join(dir, "src", "App.tsx"), sessionId: nextSid() });
    expect(stdout.startsWith('{"hookSpecificOutput":')).toBe(true);
    expect(envelope(stdout)).toMatch(/^\[ui-defaults\] UI file touched[\s\S]*for the full rules and the detection allowlist\.$/);
  });

  // A subagent's reminder lands in the subagent's context and ends with it —
  // sharing one marker let whichever wrote a UI file first silence the other.
  test("a subagent is its own context: its reminder never spends the main thread's", () => {
    const dir = project();
    const sid = nextSid();
    const file = path.join(dir, "src", "App.tsx");
    expect(runHook(dir, { filePath: file, sessionId: sid, agentId: "a1" })).toContain("[ui-defaults]");
    expect(runHookRaw(dir, { filePath: file, sessionId: sid, agentId: "a1" })).toBe("");
    expect(runHook(dir, { filePath: file, sessionId: sid })).toContain("[ui-defaults]");
    expect(runHookRaw(dir, { filePath: file, sessionId: sid })).toBe("");
    expect(runHook(dir, { filePath: file, sessionId: sid, agentId: "a2" })).toContain("[ui-defaults]");
  });

  // Parallel Edit/Write calls in one message run this hook side by side; the
  // exclusive create of the marker lets exactly one of them send the reminder.
  test("parallel UI edits in one context deliver it once", async () => {
    const dir = project();
    const sid = nextSid();
    const names = ["App.tsx", "App.css", "Nav.vue", "Card.svelte", "index.html", "theme.scss"];
    const outs = await Promise.all(
      names.map((name) => runHookAsync(dir, { filePath: path.join(dir, "src", name), sessionId: sid }))
    );
    const sent = outs.filter(Boolean);
    expect(sent).toHaveLength(1);
    expect(envelope(sent[0])).toContain("[ui-defaults]");
  });
});
