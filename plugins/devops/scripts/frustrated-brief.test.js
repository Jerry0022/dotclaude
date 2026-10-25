import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildBrief, collapse, codeFree, main } = require("./frustrated-brief.js");
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "frustrated-brief.js");

const line = (o) => JSON.stringify(o);
const user = (text, ts, extra = {}) => line({ type: "user", timestamp: ts, message: { content: text }, ...extra });
const transcript = [
  user("Der Login-Button in src/ui/Login.tsx reagiert nicht", "2026-10-25T10:00:00Z"),
  line({ type: "assistant", timestamp: "2026-10-25T10:01:00Z", message: { content: [
    { type: "text", text: "I think it is the handler." },
    { type: "tool_use", name: "Edit", input: { file_path: "C:\\app\\src\\ui\\Login.tsx" } },
    { type: "tool_use", name: "Skill", input: { skill: "devops:auto-fix" } },
    { type: "tool_use", name: "Agent", input: { subagent_type: "devops:core" } },
  ] } }),
  line({ type: "user", timestamp: "2026-10-25T10:02:00Z", message: { content: [{ type: "tool_result", is_error: true, content: "npm ERR! code 1\nTypeError: x is not a function\n    at foo (a.js:1)" }] } }),
  user("immer noch nicht, schon wieder kaputt:\n```\nTypeError: x\n  at y\n```", "2026-10-25T10:03:00Z"),
  user("meta", "2026-10-25T10:04:00Z", { isMeta: true }),
  user("<command-name>/devops:do-run</command-name>", "2026-10-25T10:05:00Z"),
].join("\n");

describe("buildBrief", () => {
  const b = buildBrief(transcript, { transcript: "t.jsonl" });

  test("keeps only the user's own prompts, numbered, logs collapsed", () => {
    expect(b.prompts.map((p) => p.n)).toEqual([1, 2]);
    expect(b.prompts[0].text).toContain("Login-Button");
    expect(b.prompts[1].text).toContain("[log: 2 lines]");
    expect(b.prompts[1].text).not.toContain("at y");
    expect(JSON.stringify(b.prompts)).not.toContain("I think it is the handler");
  });

  test("files, skills, agents, deduplicated error signatures, window", () => {
    expect(b.filesEdited).toEqual(["C:/app/src/ui/Login.tsx"]);
    expect(b.skills).toEqual(["devops:auto-fix"]);
    expect(b.agents).toEqual(["devops:core"]);
    expect(b.errors[0].sig).toMatch(/npm ERR!|TypeError/);
    expect(b.window).toEqual({ first: "2026-10-25T10:00:00Z", last: "2026-10-25T10:05:00Z" });
  });

  test("code-free cut drops paths, files and code", () => {
    const t = b.codeFree.prompts[0].text;
    expect(t).not.toMatch(/src\/ui|Login\.tsx/);
    expect(t).toContain("[path]");
  });

  test("maxPrompts keeps the newest and reports the dropped count", () => {
    const many = Array.from({ length: 5 }, (_, i) => user(`prompt ${i + 1}`, `t${i}`)).join("\n");
    const r = buildBrief(many, { maxPrompts: 2 });
    expect(r.prompts.map((p) => p.n)).toEqual([4, 5]);
    expect(r.promptsDropped).toBe(3);
  });

  test("helpers", () => {
    expect(collapse("a\n```\nx\ny\n```\nb")).toBe("a\n[log: 2 lines]\nb");
    expect(codeFree("see `foo()` at https://x.y/z and lib/a.js")).toBe("see [code] at [url] and [path]");
  });
});

describe("main", () => {
  const alpha = (dir) => {
    fs.writeFileSync(path.join(dir, "features.json"), JSON.stringify({ features: { "frustrated-mode": { minChannel: "alpha", summary: "x", docs: [], scripts: [] } } }));
    return { features: { pluginRoot: dir, channel: "alpha", home: dir } };
  };

  test("writes the brief only into the temp dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fbrief-"));
    const t = path.join(dir, "t.jsonl");
    fs.writeFileSync(t, transcript);
    const o = alpha(dir);
    const out = path.join(dir, "brief.json");
    const r = main(["--transcript", t, "--out", out], o);
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, "utf8")).prompts).toHaveLength(2);
    expect(main(["--transcript", t, "--out", path.resolve("brief.json")], o).code).toBe(2);
    expect(main([], o).code).toBe(2);
    expect(main(["--transcript", path.join(dir, "missing.jsonl")], o).code).toBe(1);
  });

  test("feature off → 126", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fbrief-"));
    expect(main(["--transcript", "x"], { features: { pluginRoot: dir, channel: "alpha", home: dir } }).code).toBe(126);
    const home = path.join(dir, "home");
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "plugins", ".channels.json"), JSON.stringify({ dotclaude: "stable" }));
    const r = spawnSync(process.execPath, [SCRIPT, "--transcript", "x"], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
    expect(r.status).toBe(126);
  });
});
