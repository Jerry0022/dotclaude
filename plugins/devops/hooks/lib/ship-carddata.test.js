import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import lib from "./ship-carddata.js";
import { buildCardDataInstruction } from "../session-start/ss.ship.resume.js";
import { allEntries } from "./runtime-ignores.js";

// #712 R6: a delegated --card-data ship returned its card input only in the
// chat reply. A compaction in the parent dropped it, the mandatory-card Stop
// gate then forced a card without ship state, and it downgraded to `ready`.
const SID = "parent-session-1";
const payload = {
  cardData: { variant: "ship-successful", summary: "Shipped", session_id: SID },
  afterRender: ["node sync.js"],
  exitWorktree: true,
};

describe("ship-carddata", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "carddata-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("write → read round-trips, keyed by the parent session", () => {
    expect(lib.writeCardData(dir, SID, payload)).toBe(true);
    const got = lib.readCardData(dir, SID);
    expect(got.cardData).toEqual(payload.cardData);
    expect(got.afterRender).toEqual(["node sync.js"]);
    expect(got.exitWorktree).toBe(true);
    expect(lib.readCardData(dir, "other-session")).toBeNull();
  });

  test("unsafe session ids and payloads without cardData are refused", () => {
    expect(lib.writeCardData(dir, "../x", payload)).toBe(false);
    expect(lib.writeCardData(dir, SID, { afterRender: [] })).toBe(false);
    expect(lib.cardDataPath(dir, "")).toBe("");
  });

  test("an abandoned payload (older than MAX_AGE_MS) reads as none", () => {
    lib.writeCardData(dir, SID, payload);
    expect(lib.readCardData(dir, SID, { now: Date.now() + lib.MAX_AGE_MS + 1000 })).toBeNull();
  });

  test("a hand-written file without writtenAt or afterRender: abandoned, never a throw", () => {
    const p = lib.cardDataPath(dir, SID);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ cardData: { variant: "ship-successful" } }));
    expect(lib.readCardData(dir, SID)).toBeNull();
    fs.writeFileSync(p, JSON.stringify({ cardData: { variant: "ship-successful" }, writtenAt: Date.now(), afterRender: "x" }));
    const got = lib.readCardData(dir, SID);
    expect(got.afterRender).toEqual([]);
    expect(() => lib.renderFromFileInstruction(got, { pluginRoot: "/p", cwd: dir, sessionId: SID })).not.toThrow();
  });

  test("the render consumes it only for the stored variant", () => {
    lib.writeCardData(dir, SID, payload);
    expect(lib.consumeOnRender(dir, SID, "analysis")).toBe(false);
    expect(lib.readCardData(dir, SID)).not.toBeNull();
    expect(lib.consumeOnRender(dir, SID, "ship-successful")).toBe(true);
    expect(lib.readCardData(dir, SID)).toBeNull();
  });

  test("the instruction names the file, the close-out, the clear and ExitWorktree", () => {
    lib.writeCardData(dir, SID, payload);
    const out = lib.renderFromFileInstruction(lib.readCardData(dir, SID), { pluginRoot: "/p", cwd: dir, sessionId: SID });
    expect(out).toContain("[ship-carddata]");
    expect(out).toContain(".ship-carddata-parent-session-1.json");
    expect(out).toContain("close-out");
    expect(out).toContain("ship-carddata.js\" clear");
    expect(out).toContain("ExitWorktree");
    const blocked = lib.renderFromFileInstruction({ ...lib.readCardData(dir, SID), cardData: { variant: "ship-blocked" }, exitWorktree: false }, { pluginRoot: "/p", cwd: dir, sessionId: SID });
    expect(blocked).toContain("no close-out");
    expect(blocked).not.toContain("ExitWorktree");
  });

  test("ss.ship.resume points the parent to the file after a compaction", () => {
    expect(buildCardDataInstruction({ cwd: dir, sessionId: SID })).toBeNull();
    lib.writeCardData(dir, SID, payload);
    expect(buildCardDataInstruction({ cwd: dir, sessionId: SID })).toContain("[ship-carddata]");
    expect(buildCardDataInstruction({ cwd: dir, sessionId: "someone-else" })).toBeNull();
  });

  test("the file is git-excluded runtime state", () => {
    expect(allEntries()).toContain(".claude/.ship-carddata-*.json");
  });
});

describe("stop.flow.guard — a forced card points to the stored card data (#712 R6)", () => {
  const STOP_HOOK = path.join(__dirname, "..", "stop", "stop.flow.guard.js");
  test("block reason opens with the render-from-file instruction", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carddata-guard-"));
    const tmp = dir + "-tmp";
    fs.mkdirSync(tmp);
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    fs.writeFileSync(path.join(tmp, `dotclaude-devops-work-happened-${SID}`), "x");
    lib.writeCardData(dir, SID, payload);
    const t = path.join(dir, "t.jsonl");
    fs.writeFileSync(t, JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "weiter" }] } }) + "\n");
    try {
      const out = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [STOP_HOOK], { cwd: dir, env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp } });
        let s = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d) => { s += d; });
        child.on("error", reject);
        child.on("close", () => resolve(s));
        child.stdin.end(JSON.stringify({ session_id: SID, cwd: dir, stop_hook_active: false, transcript_path: t }));
      });
      const res = JSON.parse(out);
      expect(res.decision).toBe("block");
      expect(res.reason.startsWith("[ship-carddata]")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
