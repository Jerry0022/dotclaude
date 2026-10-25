import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { replay } = require("./frustration-replay.js");

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "frustration-replay.js");
const u = (t) => JSON.stringify({ type: "user", message: { content: t } });
const a = (t) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: t }] } });

describe("frustration-replay", () => {
  test("replays a looping transcript to a flag and skips tool results", () => {
    const jsonl = [
      u("fix app.js"), a("Fixed, should work now."),
      u("that's still wrong in app.js"), a("Done, fixed."),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "still wrong" }] } }),
      u("still wrong, app.js again not working"), a("Fixed."),
      u("I already said it is wrong, immer noch app.js"),
    ].join("\n");
    const r = replay(jsonl);
    expect(r.prompts).toBe(4);
    expect(r.flaggedAt.length).toBeGreaterThan(0);
  });

  test("a calm transcript never flags", () => {
    expect(replay([u("add a button"), a("done"), u("thanks, perfekt")].join("\n")).flaggedAt).toEqual([]);
  });

  test("CLI exits 126 off alpha (no pin = stable) and prints no prompt text", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "frus-rep-"));
    try {
      const r = spawnSync(process.execPath, [SCRIPT, home], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });
      expect(r.status).toBe(126);
      expect(r.stdout).toBe("");
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
