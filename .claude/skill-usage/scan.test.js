import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
const {
  scan,
  formatReport,
  listSessionFiles,
  scanSession,
  extractCommandName,
  stripPrefix,
  BUG_LIKE_RE,
} = require("./scan.js");

function writeSession(dir, name, entries) {
  fs.writeFileSync(path.join(dir, name), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function userEntry(text, { origin = { kind: "human" }, isSidechain = false, isMeta } = {}) {
  return { type: "user", isSidechain, isMeta, origin, message: { content: text } };
}

function assistantSkillEntry(skillId, { isSidechain = false } = {}) {
  return {
    type: "assistant",
    isSidechain,
    message: { content: [{ type: "tool_use", name: "Skill", input: { skill: skillId } }] },
  };
}

describe("stripPrefix / extractCommandName", () => {
  it("strips a plugin prefix", () => {
    expect(stripPrefix("devops:ship")).toBe("ship");
    expect(stripPrefix("ship")).toBe("ship");
  });

  it("reads the slash-command name out of the wrapper tag, prefix stripped", () => {
    expect(extractCommandName("<command-message>devops:ship</command-message>\n<command-name>devops:ship</command-name>")).toBe(
      "ship"
    );
    expect(extractCommandName("plain text, no command")).toBeNull();
  });
});

describe("BUG_LIKE_RE", () => {
  it("matches the real bug reports from the skill-restructure spec", () => {
    expect(BUG_LIKE_RE.test("schau mal, irgendwas ist da mächtig kaputt")).toBe(true);
    expect(BUG_LIKE_RE.test("Also wenn ich auf Ship klicke passiert gar nix")).toBe(true);
    expect(BUG_LIKE_RE.test("das sieht gut aus, aber vercel scheint einen fehler aufzuzeigen")).toBe(true);
  });

  it("does not match an ordinary feature request", () => {
    expect(BUG_LIKE_RE.test("kannst du mir dazu ein concept machen")).toBe(false);
  });
});

describe("scanSession", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-usage-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("attributes a Skill call to the same turn's slash command", () => {
    const file = path.join(dir, "s1.jsonl");
    writeSession(dir, "s1.jsonl", [
      userEntry("<command-message>devops:ship</command-message>\n<command-name>devops:ship</command-name>"),
      assistantSkillEntry("devops:ship"),
    ]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["ship", "fix"], stats, fixGaps);
    expect(stats.skills.get("ship")).toEqual({ total: 1, slash: 1, model: 0 });
  });

  it("attributes a Skill call with no matching slash command to the model", () => {
    const file = path.join(dir, "s2.jsonl");
    writeSession(dir, "s2.jsonl", [
      userEntry("kannst du mir dazu ein concept machen?"),
      assistantSkillEntry("devops:concept"),
    ]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["concept"], stats, fixGaps);
    expect(stats.skills.get("concept")).toEqual({ total: 1, slash: 0, model: 1 });
  });

  it("counts a bug-like prompt not followed by fix as a gap", () => {
    const file = path.join(dir, "s3.jsonl");
    writeSession(dir, "s3.jsonl", [userEntry("Also wenn ich auf Ship klicke passiert gar nix")]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["fix"], stats, fixGaps);
    expect(stats.bugLikePrompts).toBe(1);
    expect(fixGaps).toHaveLength(1);
  });

  it("does not count a bug-like prompt followed by a fix invocation as a gap", () => {
    const file = path.join(dir, "s4.jsonl");
    writeSession(dir, "s4.jsonl", [
      userEntry("es ist alles kaputt, fix das bitte"),
      assistantSkillEntry("devops:fix"),
    ]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["fix"], stats, fixGaps);
    expect(stats.bugLikePrompts).toBe(1);
    expect(fixGaps).toHaveLength(0);
  });

  it("skips subagent sidechain entries entirely", () => {
    const file = path.join(dir, "s5.jsonl");
    writeSession(dir, "s5.jsonl", [
      userEntry("normal prompt", { isSidechain: true }),
      assistantSkillEntry("devops:ship", { isSidechain: true }),
    ]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["ship"], stats, fixGaps);
    expect(stats.skills.size).toBe(0);
    expect(stats.bugLikePrompts).toBe(0);
  });

  it("ignores non-human origins (scheduled tasks, task notifications) for bug-like counting", () => {
    const file = path.join(dir, "s6.jsonl");
    writeSession(dir, "s6.jsonl", [
      userEntry("something crashed and threw an error", { origin: { kind: "task-notification" } }),
      userEntry("<scheduled-task name=\"nightly\">this crashed with an error</scheduled-task>", { origin: undefined }),
    ]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["fix"], stats, fixGaps);
    expect(stats.bugLikePrompts).toBe(0);
  });

  it("ignores a skill name that is not a known devops skill", () => {
    const file = path.join(dir, "s7.jsonl");
    writeSession(dir, "s7.jsonl", [assistantSkillEntry("some-other-plugin:unrelated")]);
    const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: 1 };
    const fixGaps = [];
    scanSession(file, ["ship", "fix"], stats, fixGaps);
    expect(stats.skills.size).toBe(0);
  });
});

describe("listSessionFiles", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-usage-projects-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("only picks up top-level *.jsonl session files, not nested subagent files", () => {
    const project = path.join(dir, "proj-a");
    fs.mkdirSync(path.join(project, "session-uuid", "subagents"), { recursive: true });
    fs.writeFileSync(path.join(project, "session-uuid.jsonl"), "");
    fs.writeFileSync(path.join(project, "session-uuid", "subagents", "agent-x.jsonl"), "");
    const files = listSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe(path.join(project, "session-uuid.jsonl"));
  });
});

describe("scan + formatReport", () => {
  it("produces a readable report with no sessions on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-usage-empty-"));
    const result = scan({ sessionCount: 10, projectsDir: dir });
    expect(result.stats.sessionsScanned).toBe(0);
    expect(formatReport(result)).toContain("Sessions scanned: 0");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
