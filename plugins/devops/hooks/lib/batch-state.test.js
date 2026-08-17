import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activate, deactivate, isModeActive, expiryReason, readMode,
  appendNote, readNotes, countNotes, clearNotes, archiveNotes,
  touchActivity, readActivity,
  isMachinePrompt, isExpandedCommand, hasAttachment,
  startsWithMarker, stripMarker, looksLikeQuestion, validateMarker,
  classify, willBeCollected, notesPath, modePath,
  loadConfig, saveConfig, configPath, effectiveMarker,
  DEFAULTS, HARNESS_RESERVED_PREFIXES,
} from "./batch-state.js";

let cwd;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "batch-state-test-"));
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("machine prompts are never collected", () => {
  // Regression guard: collecting these kills the concept bridge (1 poll/min)
  // and stops git-sync for the whole collection window.
  test.each([
    ["git-sync cron", 'Silently run via Bash: node "C:/.../git-sync.js". If output contains ⚠…'],
    ["concept bridge (service form)", "Silently service the concept bridge on port 8742."],
    ["concept bridge (colon form)", "Silent: POST http://localhost:8883/heartbeat"],
    ["run silently", "Run silently: curl -s -X POST http://localhost:8734/heartbeat"],
    ["autonomous loop sentinel", "<<autonomous-loop>>"],
    ["autonomous loop dynamic", "<<autonomous-loop-dynamic>>"],
  ])("%s", (_label, prompt) => {
    expect(isMachinePrompt(prompt)).toBe(true);
  });

  // These do NOT match prompt.flow.silent-turn.js — an allowlist reusing only
  // that module would swallow them and the AFK run would never start.
  test.each([
    ["run-autonomous autostart", "AUTONOMOUS_AUTOSTART: resume Step 5 with task=…"],
    ["worktree resume nudge", "AUTONOMOUS_RESUME: weiter"],
    ["run-backlog autostart", "RUN_BACKLOG_AUTOSTART: presence timeout. phase=presence, queue=1,2,3"],
  ])("%s (silent-turn gap)", (_label, prompt) => {
    expect(isMachinePrompt(prompt)).toBe(true);
  });

  test("ordinary prose is not a machine prompt", () => {
    expect(isMachinePrompt("Silently explain what this hook does")).toBe(false);
    expect(isMachinePrompt("Der Button im Header ist verrutscht")).toBe(false);
    expect(isMachinePrompt("")).toBe(false);
    expect(isMachinePrompt(null)).toBe(false);
  });
});

describe("escape hatch survives slash-command expansion", () => {
  // A real slash command arrives pre-expanded with a <command-name> tag — the
  // raw text is not literally "/claude-batch off". A naive text comparison
  // would miss exactly the escape it protects, locking the user out.
  test("expanded command is detected and passed through", () => {
    const expanded = "<command-message>claude-batch</command-message>\n<command-name>/claude-batch</command-name>\n<command-args>off</command-args>";
    expect(isExpandedCommand(expanded)).toBe(true);
    expect(classify({ text: expanded, marker: ">>", modeActive: true })).toBe("passthrough");
  });

  test("plain text mentioning a slash command is still collected", () => {
    expect(isExpandedCommand("wir sollten /ship mal aufräumen")).toBe(false);
    expect(classify({ text: "wir sollten /ship mal aufräumen", marker: ">>", modeActive: true }))
      .toBe("collect");
  });
});

describe("attachments pass through", () => {
  // A blocked prompt is erased from the UI — a collected screenshot is gone.
  test("image marker", () => {
    expect(hasAttachment("mach das so wie hier [Image #1]")).toBe(true);
  });

  test("@file mention", () => {
    expect(hasAttachment("schau dir @src/components/Header.tsx an")).toBe(true);
  });

  test("hook input carrying attachments", () => {
    expect(hasAttachment("kurzer text", { attachments: [{ name: "a.png" }] })).toBe(true);
    expect(hasAttachment("kurzer text", { images: ["…"] })).toBe(true);
  });

  test("plain prose has no attachment", () => {
    expect(hasAttachment("Der Button ist verrutscht")).toBe(false);
    expect(hasAttachment("mail an foo@bar", {})).toBe(false);
  });

  test("classify routes attachments to passthrough even in collect mode", () => {
    expect(classify({ text: "so wie hier [Image #2]", marker: ">>", modeActive: true }))
      .toBe("passthrough");
  });
});

describe("marker handling", () => {
  test("marker at line start fires execute", () => {
    expect(startsWithMarker(">> leg los", ">>")).toBe(true);
    expect(classify({ text: ">> leg los", marker: ">>", modeActive: true })).toBe("execute");
  });

  test("leading whitespace does not defeat the marker", () => {
    expect(startsWithMarker("   >> leg los", ">>")).toBe(true);
  });

  test("marker elsewhere in the text does not fire", () => {
    expect(startsWithMarker("das ist wichtig >> jetzt", ">>")).toBe(false);
    expect(classify({ text: "das ist wichtig >> jetzt", marker: ">>", modeActive: true }))
      .toBe("collect");
  });

  test("stripMarker removes the marker and surrounding space", () => {
    expect(stripMarker(">>  leg los mit allem", ">>")).toBe("leg los mit allem");
    expect(stripMarker("kein marker", ">>")).toBe("kein marker");
  });

  test("multi-character phrase works as a marker", () => {
    expect(startsWithMarker("los: bau das", "los:")).toBe(true);
    expect(stripMarker("los: bau das", "los:")).toBe("bau das");
  });
});

describe("custom markers typed via the 'Sonstiges' option", () => {
  // The user answered the marker question with their own phrase. Anything that
  // silently fails to match here collects a prompt the user meant to execute.
  test("a free-text phrase is a valid marker", () => {
    const v = validateMarker("Let's go");
    expect(v.ok).toBe(true);
    expect(v.marker).toBe("Let's go");
    expect(startsWithMarker("Let's go bau das um", "Let's go")).toBe(true);
    expect(stripMarker("Let's go bau das um", "Let's go")).toBe("bau das um");
    expect(classify({ text: "Let's go bau das um", marker: "Let's go", modeActive: true }))
      .toBe("execute");
  });

  test("a retyped phrase matches regardless of case and inner spacing", () => {
    expect(startsWithMarker("let's go weiter", "Let's go")).toBe(true);
    expect(startsWithMarker("LET'S GO weiter", "Let's go")).toBe(true);
    expect(startsWithMarker("Let's   go weiter", "Let's go")).toBe(true);
    expect(stripMarker("let's go weiter", "Let's go")).toBe("weiter");
  });

  test("a word marker needs a word boundary", () => {
    expect(startsWithMarker("google das mal", "go")).toBe(false);
    expect(startsWithMarker("go bau das", "go")).toBe(true);
    expect(classify({ text: "google das mal", marker: "go", modeActive: true }))
      .toBe("collect");
  });

  test("regex metacharacters in a phrase are literal", () => {
    expect(startsWithMarker("mach.es jetzt", "mach.es")).toBe(true);
    expect(startsWithMarker("machxes jetzt", "mach.es")).toBe(false);
  });

  test("normalisation trims and collapses whitespace", () => {
    expect(validateMarker("  jetzt   los  ")).toMatchObject({ ok: true, marker: "jetzt los" });
  });

  test("only genuinely unusable input is rejected", () => {
    expect(validateMarker("   ")).toMatchObject({ ok: false, reason: "empty" });
    expect(validateMarker(undefined)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateMarker("x".repeat(33))).toMatchObject({ ok: false, reason: "too-long" });
  });

  test("a letters-only marker is accepted but flagged as collision-prone", () => {
    expect(validateMarker("Let's go").warning).toBe(null);
    expect(validateMarker("jetzt").warning).toBe("wordy");
    expect(validateMarker(">>").warning).toBe(null);
  });
});

describe("harness-reserved prefixes cannot be markers", () => {
  // `!` opens bash mode, `/` expands a slash command, `#` writes to CLAUDE.md,
  // `@` expands a file mention. None of them reach UserPromptSubmit as a prompt,
  // so such a marker can never fire the merge while collection keeps blocking
  // every other prompt — a silent, total lock-out.
  test.each(HARNESS_RESERVED_PREFIXES)("%s is rejected as the first character", (ch) => {
    expect(validateMarker(ch)).toMatchObject({ ok: false, reason: "harness-reserved" });
    expect(validateMarker(`${ch}go`)).toMatchObject({ ok: false, reason: "harness-reserved" });
  });

  test("the same characters are fine anywhere but the start", () => {
    expect(validateMarker("los!")).toMatchObject({ ok: true, marker: "los!" });
    expect(validateMarker(">>!")).toMatchObject({ ok: true, marker: ">>!" });
  });

  test("the shipped default is not reserved", () => {
    expect(validateMarker(DEFAULTS.marker).ok).toBe(true);
    expect(HARNESS_RESERVED_PREFIXES).not.toContain(DEFAULTS.marker[0]);
  });

  test("saveConfig refuses one", () => {
    expect(() => saveConfig({ marker: "!" })).toThrow(/harness-reserved/);
  });

  test("a reserved marker never matches, so it cannot masquerade as working", () => {
    expect(startsWithMarker("! leg los", "!")).toBe(false);
    expect(classify({ text: "! leg los", marker: "!", modeActive: true })).toBe("collect");
  });
});

describe("stored config with an unusable marker falls back instead of trapping", () => {
  // Configs written before the reserved-prefix rule carry `!`. Honouring one
  // would leave collect mode running with no way to fire the merge.
  let home, prevHome, prevProfile;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "batch-home-"));
    prevHome = process.env.HOME;
    prevProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function writeConfig(obj) {
    fs.writeFileSync(configPath(), JSON.stringify(obj), "utf8");
  }

  test("the temp home is actually in use", () => {
    expect(configPath().startsWith(home)).toBe(true);
  });

  test("a legacy `!` config yields the default marker plus a fallback report", () => {
    writeConfig({ marker: "!" });
    const cfg = loadConfig();
    expect(cfg.marker).toBe(DEFAULTS.marker);
    expect(cfg.markerFallback).toEqual({ was: "!", reason: "harness-reserved" });
  });

  test("a usable stored marker is honoured with no fallback", () => {
    writeConfig({ marker: "los:" });
    const cfg = loadConfig();
    expect(cfg.marker).toBe("los:");
    expect(cfg.markerFallback).toBeUndefined();
  });

  test("the fallback flag is never persisted back into the config file", () => {
    writeConfig({ marker: "!" });
    saveConfig({ inactivityMinutes: 5 });
    expect(JSON.parse(fs.readFileSync(configPath(), "utf8")).markerFallback).toBeUndefined();
  });

  test("a mode file pinned to `!` still fires on the fallback marker", () => {
    writeConfig({ marker: "los:" });
    activate(cwd);
    // Simulate a mode file written before the rule existed.
    const mode = { ...readMode(cwd), marker: "!" };
    fs.writeFileSync(modePath(cwd), JSON.stringify(mode), "utf8");
    expect(effectiveMarker(cwd)).toBe("los:");
    expect(willBeCollected({ cwd, prompt: "los: leg los" })).toBe(false);
  });

  test("effectiveMarker prefers the pinned mode marker while it is usable", () => {
    writeConfig({ marker: "los:" });
    activate(cwd, { marker: ">>" });
    expect(effectiveMarker(cwd)).toBe(">>");
  });
});

describe("classification is inert when the mode is off", () => {
  test("everything passes through", () => {
    expect(classify({ text: "irgendwas", marker: ">>", modeActive: false })).toBe("passthrough");
    expect(classify({ text: ">> irgendwas", marker: ">>", modeActive: false })).toBe("passthrough");
  });
});

describe("mode lifecycle and failsafe", () => {
  test("activate then deactivate", () => {
    activate(cwd);
    expect(isModeActive(cwd)).toBe(true);
    deactivate(cwd);
    expect(isModeActive(cwd)).toBe(false);
    expect(readMode(cwd)).toBeNull();
  });

  test("expiry deactivates without any user action", () => {
    const start = Date.UTC(2026, 7, 16, 10, 0, 0);
    activate(cwd, { startedAt: start, expiryHours: 2 });
    expect(isModeActive(cwd, start + 60 * 60_000)).toBe(true);
    expect(isModeActive(cwd, start + 3 * 60 * 60_000)).toBe(false);
    expect(expiryReason(cwd, start + 3 * 60 * 60_000)).toBe("expired");
  });

  test("note cap deactivates without any user action", () => {
    activate(cwd, { maxNotes: 2 });
    appendNote(cwd, "eins");
    expect(isModeActive(cwd)).toBe(true);
    appendNote(cwd, "zwei");
    expect(isModeActive(cwd)).toBe(false);
    expect(expiryReason(cwd)).toBe("full");
  });

  test("no mode file means inactive — a fresh project is never in collect mode", () => {
    expect(isModeActive(cwd)).toBe(false);
    expect(expiryReason(cwd)).toBeNull();
  });
});

describe("mode does not leak between projects or windows", () => {
  // The session-id glob fallback can hand back another window's file. Scoping
  // to the project directory removes that failure mode entirely.
  test("activating in A leaves B untouched", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "batch-state-other-"));
    try {
      activate(cwd);
      expect(isModeActive(cwd)).toBe(true);
      expect(isModeActive(other)).toBe(false);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("state lives in the project, not the temp dir", () => {
    activate(cwd);
    appendNote(cwd, "notiz");
    expect(fs.existsSync(path.join(cwd, ".claude", "batch-mode.json"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".claude", "batch.md"))).toBe(true);
    expect(modePath(cwd).startsWith(cwd)).toBe(true);
    expect(notesPath(cwd).startsWith(cwd)).toBe(true);
  });
});

describe("notes I/O", () => {
  test("appends preserve order and content", () => {
    appendNote(cwd, "Button im Header verrutscht");
    appendNote(cwd, "Fehlertext bei Login ist falsch");
    const notes = readNotes(cwd);
    expect(notes.map(n => n.text)).toEqual([
      "Button im Header verrutscht",
      "Fehlertext bei Login ist falsch",
    ]);
    expect(countNotes(cwd)).toBe(2);
  });

  test("multi-line notes survive round-trip", () => {
    appendNote(cwd, "Zeile eins\nZeile zwei\n\nZeile drei");
    expect(readNotes(cwd)[0].text).toBe("Zeile eins\nZeile zwei\n\nZeile drei");
  });

  test("a note containing an HTML comment does not split the entry", () => {
    appendNote(cwd, "siehe <!-- inline --> hier");
    const notes = readNotes(cwd);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("siehe <!-- inline --> hier");
  });

  test("interleaved appends never lose an entry", () => {
    for (let i = 0; i < 25; i++) appendNote(cwd, `notiz ${i}`);
    expect(countNotes(cwd)).toBe(25);
    expect(readNotes(cwd)[24].text).toBe("notiz 24");
  });

  test("no notes file yields an empty list, not a throw", () => {
    expect(readNotes(cwd)).toEqual([]);
    expect(countNotes(cwd)).toBe(0);
  });

  test("archiveNotes keeps the original recoverable after a merge", () => {
    appendNote(cwd, "wichtige notiz");
    const dest = archiveNotes(cwd, Date.UTC(2026, 7, 16, 12, 0, 0));
    expect(dest).toBeTruthy();
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toContain("wichtige notiz");
    expect(fs.existsSync(notesPath(cwd))).toBe(false);
    expect(countNotes(cwd)).toBe(0);
  });

  test("archiveNotes on an empty project is a no-op", () => {
    expect(archiveNotes(cwd)).toBeNull();
  });

  test("clearNotes is idempotent", () => {
    appendNote(cwd, "x");
    clearNotes(cwd);
    clearNotes(cwd);
    expect(countNotes(cwd)).toBe(0);
  });
});

describe("activity clock", () => {
  // The clock must be its own file. Hanging it off general session activity
  // means the 1-min concept cron resets it forever and the threshold is
  // never reached.
  test("round-trips an explicit timestamp", () => {
    const t = Date.UTC(2026, 7, 16, 9, 30, 0);
    touchActivity(cwd, t);
    expect(readActivity(cwd)).toBe(t);
  });

  test("absent clock reads as null", () => {
    expect(readActivity(cwd)).toBeNull();
  });

  test("clock file is separate from the notes file", () => {
    const t = Date.UTC(2026, 7, 16, 9, 30, 0);
    touchActivity(cwd, t);
    appendNote(cwd, "spätere notiz");
    expect(readActivity(cwd)).toBe(t);
  });
});

describe("willBeCollected — the guard sibling hooks use", () => {
  // Hooks in one event group run in parallel and are NOT short-circuited by a
  // sibling's block. Without this guard they burn one-shot state on a prompt
  // that was erased and never produced a turn.
  test("true for a prompt that will be collected", () => {
    activate(cwd);
    expect(willBeCollected({ cwd, prompt: "Button verrutscht" })).toBe(true);
  });

  test("false when the mode is off", () => {
    expect(willBeCollected({ cwd, prompt: "Button verrutscht" })).toBe(false);
  });

  test("false for machine prompts, marker prompts and attachments", () => {
    // Marker pinned: activate() would otherwise inherit the developer's own
    // ~/.claude/claude-batch.json and the marker assertion below would depend
    // on it.
    activate(cwd, { marker: ">>" });
    expect(willBeCollected({ cwd, prompt: "Silently run via Bash: node x.js" })).toBe(false);
    expect(willBeCollected({ cwd, prompt: "AUTONOMOUS_RESUME: weiter" })).toBe(false);
    expect(willBeCollected({ cwd, prompt: ">> leg los" })).toBe(false);
    expect(willBeCollected({ cwd, prompt: "so wie hier [Image #1]" })).toBe(false);
  });

  test("reads whichever prompt field the hook type delivers", () => {
    activate(cwd);
    expect(willBeCollected({ cwd, user_message: "über user_message" })).toBe(true);
    expect(willBeCollected({ cwd, message: "über message" })).toBe(true);
  });

  test("fails open on garbage input — never suppresses a hook by accident", () => {
    expect(willBeCollected(null)).toBe(false);
    expect(willBeCollected(undefined)).toBe(false);
    expect(willBeCollected("not an object")).toBe(false);
    expect(willBeCollected({})).toBe(false);
  });
});

describe("question hint is advisory only", () => {
  test("detects a trailing question mark", () => {
    expect(looksLikeQuestion("gibt es das schon?")).toBe(true);
    expect(looksLikeQuestion("gibt es das schon?  ")).toBe(true);
    expect(looksLikeQuestion("bau das um")).toBe(false);
  });

  test("a question is still collected — the hook never classifies it away", () => {
    expect(classify({ text: "gibt es das schon?", marker: ">>", modeActive: true }))
      .toBe("collect");
  });
});
