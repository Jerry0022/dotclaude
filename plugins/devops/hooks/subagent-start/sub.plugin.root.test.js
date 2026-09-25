import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "sub.plugin.root.js");
const PLUGIN_ROOT = path.resolve(__dirname, "..", "..").replace(/\\/g, "/");

/** Temp project with devops enabled — otherwise plugin-guard exits 0 and every test passes vacuously. */
function project(enabled = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subroot-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: enabled ? { "devops@dotclaude": true } : {} })
  );
  return dir;
}

function run(dir, input, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv.CLAUDE_PLUGIN_ROOT;
  Object.assign(childEnv, env);
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = spawnSync(process.execPath, [HOOK], { cwd: dir, input, encoding: "utf8", env: childEnv });
    if (res.status !== null) break;
  }
  return res;
}

const payload = (dir) => JSON.stringify({
  hook_event_name: "SubagentStart",
  session_id: "s1",
  cwd: dir,
  agent_id: "af25c54147bc6c9b1",
  agent_type: "devops:frontend",
});

describe("sub.plugin.root", () => {
  test("injects the literal plugin root as SubagentStart additionalContext", () => {
    const dir = project();
    const res = run(dir, payload(dir));
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    const ctx = out.hookSpecificOutput.additionalContext;
    expect(ctx).toContain(`{PLUGIN_ROOT} = ${PLUGIN_ROOT} `);
    expect(ctx).toContain(`${PLUGIN_ROOT}/deep-knowledge/pre-mortem.md`);
    expect(ctx).toContain("Never search the filesystem");
    expect(ctx).not.toContain("\\");
  });

  test("CLAUDE_PLUGIN_ROOT from the hook env wins", () => {
    const dir = project();
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "subroot-root-"));
    const res = run(dir, payload(dir), { CLAUDE_PLUGIN_ROOT: fake });
    const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain(`{PLUGIN_ROOT} = ${fake.replace(/\\/g, "/")} `);
  });

  test("malformed stdin → exit 0, no output", () => {
    const res = run(project(), "not json");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });
});

describe("plugin prose never tells the model to expand $CLAUDE_PLUGIN_ROOT", () => {
  // $CLAUDE_PLUGIN_ROOT is empty in the Bash and PowerShell tools, so
  // `node "$CLAUDE_PLUGIN_ROOT/scripts/x.js"` runs `/scripts/x.js`, fails, and
  // sends the model searching the disk for the plugin (the find / incident).
  // Skills, agents and docs name plugin files as {PLUGIN_ROOT}/…, which the
  // injected root line resolves. The one exception expands the variable only
  // when it is set (`${CLAUDE_PLUGIN_ROOT:+…}`) and falls back to the cache.
  function mdFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...mdFiles(p));
      else if (e.name.endsWith(".md")) out.push(p);
    }
    return out;
  }

  test("no $CLAUDE_PLUGIN_ROOT/ path in skills, agents or deep-knowledge", () => {
    const offenders = [];
    for (const sub of ["skills", "agents", "deep-knowledge"]) {
      for (const file of mdFiles(path.join(PLUGIN_ROOT, sub))) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          const stripped = line.replace(/\$\{CLAUDE_PLUGIN_ROOT:\+[^}]*\}/g, "");
          if (/\$\{CLAUDE_PLUGIN_ROOT\}\/|\$CLAUDE_PLUGIN_ROOT\/|\$env:CLAUDE_PLUGIN_ROOT\//.test(stripped)) {
            offenders.push(`${path.relative(PLUGIN_ROOT, file)}:${i + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
