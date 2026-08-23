import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAck, buildMergeContext, buildActivationGuard, buildAttachmentGuard,
  buildEmptyQueueNotice, INLINE_LIMIT,
} from "./prompt.batch.collect.js";
import { activate, appendNote, readNotes, isModeActive } from "../lib/batch-state.js";

const HOOK = fileURLToPath(new URL("./prompt.batch.collect.js", import.meta.url));

let cwd;

/**
 * Run the hook exactly as the harness does: JSON on stdin, project as cwd.
 * The temp project carries its own settings.json so plugin-guard passes
 * regardless of the machine's global plugin state.
 */
function runHook(payload, env) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, ...payload }),
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** A throwaway home dir holding a known claude-batch.json, so a test never
 *  depends on the developer's own global marker config. */
function fakeHome(config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "batch-hook-home-"));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "claude-batch.json"), JSON.stringify(config), "utf8");
  return { HOME: home, USERPROFILE: home };
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "batch-hook-test-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }),
    "utf8",
  );
});

afterEach(() => {
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("mode off — the hook is inert", () => {
  test("prompt passes through and nothing is stored", () => {
    const r = runHook({ prompt: "Der Button ist verrutscht" });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });
});

describe("mode on — collecting", () => {
  beforeEach(() => activate(cwd));

  test("an ordinary prompt is blocked and stored", () => {
    const r = runHook({ prompt: "Der Button im Header ist verrutscht" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Notiz #1 gespeichert");
    expect(readNotes(cwd).map(n => n.text)).toEqual(["Der Button im Header ist verrutscht"]);
  });

  test("the counter advances across prompts", () => {
    runHook({ prompt: "erste" });
    const r = runHook({ prompt: "zweite" });
    expect(r.stderr).toContain("Notiz #2 gespeichert");
    expect(readNotes(cwd)).toHaveLength(2);
  });

  test("a question is collected but flagged in the acknowledgement", () => {
    const r = runHook({ prompt: "gibt es das schon?" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Frage");
    expect(readNotes(cwd)).toHaveLength(1);
  });

  test("the prompt field name does not matter", () => {
    // Half the hooks in this repo read `prompt`, the other half
    // `user_message || message`. Reading only one yields '' and would block
    // every prompt while storing nothing.
    expect(runHook({ user_message: "über user_message" }).code).toBe(2);
    expect(runHook({ message: "über message" }).code).toBe(2);
    expect(readNotes(cwd).map(n => n.text)).toEqual(["über user_message", "über message"]);
  });
});

describe("mode on — what is never collected", () => {
  beforeEach(() => activate(cwd));

  test.each([
    ["git-sync cron", 'Silently run via Bash: node "git-sync.js"'],
    ["concept bridge", "Silently service the concept bridge on port 8742."],
    ["autonomous autostart", "AUTONOMOUS_AUTOSTART: resume Step 5"],
    ["autonomous resume", "AUTONOMOUS_RESUME: weiter"],
    ["backlog autostart", "RUN_BACKLOG_AUTOSTART: presence timeout. phase=gate"],
    ["loop sentinel", "<<autonomous-loop>>"],
  ])("%s passes through unstored", (_label, prompt) => {
    const r = runHook({ prompt });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });

  test("an expanded slash command passes through — the escape hatch holds", () => {
    const r = runHook({
      prompt: "<command-name>/claude-batch</command-name>\n<command-args>off</command-args>",
    });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });

  test("a prompt with an image passes through — blocking would erase it", () => {
    const r = runHook({ prompt: "mach das so wie hier [Image #1]" });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });

  test("a prompt with an @file mention passes through", () => {
    const r = runHook({ prompt: "schau in @src/app/Header.tsx" });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });
});

describe("mode on — firing the merge", () => {
  // Marker pinned into the mode file: without it these tests would inherit the
  // developer's own ~/.claude/claude-batch.json.
  beforeEach(() => activate(cwd, { marker: ">>" }));

  test("the marker injects every note as context and does not block", () => {
    appendNote(cwd, "Button verrutscht");
    appendNote(cwd, "Fehlertext falsch");
    const r = runHook({ prompt: ">> leg los" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Button verrutscht");
    expect(r.stdout).toContain("Fehlertext falsch");
    expect(r.stdout).toContain("leg los");
    expect(r.stdout).toContain("Widersprüche");
  });

  test("the marked prompt itself is not stored as a note", () => {
    appendNote(cwd, "eine notiz");
    runHook({ prompt: ">> jetzt umsetzen" });
    expect(readNotes(cwd).map(n => n.text)).toEqual(["eine notiz"]);
  });

  test("the marker with an empty queue reports the empty queue by path", () => {
    // Exiting silently here was data loss disguised as a normal turn: the model
    // saw a bare `>> leg los` and truthfully said it had no notes — which is
    // indistinguishable from ten notes the parser failed to read.
    const r = runHook({ prompt: ">> leg los" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("KEINE Notiz lesen");
    expect(r.stdout).toContain(path.join(cwd, ".claude", "batch.md"));
    expect(r.stdout).toContain("Datei vorhanden: nein");
  });

  test("a queue the parser cannot read is reported, never denied", () => {
    // The classic cause: the user edits batch.md and the editor rewrites it, or
    // a separator is destroyed. The file has content; the parse yields nothing.
    appendNote(cwd, "eine notiz");
    const file = path.join(cwd, ".claude", "batch.md");
    fs.writeFileSync(file, "hier stehen zehn Beobachtungen, aber ohne Trenner\n", "utf8");
    const r = runHook({ prompt: ">> leg los" });
    expect(r.stdout).toContain("Sag dem Nutzer NICHT, es gebe keine Notizen");
    expect(r.stdout).toContain("Lies die Datei roh");
    expect(isModeActive(cwd)).toBe(true);
  });

  test("a marker prompt carrying an image still fires the merge", () => {
    // The reported bug: the attachment rule was checked BEFORE the marker, so
    // enriching the execute prompt with a screenshot downgraded it to a plain
    // turn — no notes injected, and Claude reporting an empty batch while ten
    // notes sat in the file.
    appendNote(cwd, "Button verrutscht");
    const r = runHook({ prompt: ">> so wie auf dem Screenshot [Image #1]" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Button verrutscht");
    expect(r.stdout).toContain("so wie auf dem Screenshot");
  });

  test("a marker prompt carrying an @file mention still fires the merge", () => {
    appendNote(cwd, "Fehlertext falsch");
    const r = runHook({ prompt: ">> und @src/app/Header.tsx dabei beachten" });
    expect(r.stdout).toContain("Fehlertext falsch");
    expect(r.stdout).toContain("Header.tsx");
  });

  test("the enriched execute prompt is carried as part of the job", () => {
    appendNote(cwd, "eine notiz");
    const r = runHook({ prompt: ">> und warum ist das eigentlich so langsam?" });
    expect(r.stdout).toContain("warum ist das eigentlich so langsam?");
    expect(r.stdout).toContain("Ist es eine Frage, beantworte sie");
  });

  test("an expired mode still lets the marker reach its notes", () => {
    // Expiry and the note cap end collection on their own. If the marker died
    // with the mode, the queue would be unreachable by the one gesture the user
    // was taught, and the merge would read as "there are no notes".
    appendNote(cwd, "Button verrutscht");
    activate(cwd, { marker: ">>", startedAt: Date.now() - 9 * 3600_000, expiryHours: 8 });
    expect(isModeActive(cwd)).toBe(false);
    const r = runHook({ prompt: ">> leg los" });
    expect(r.stdout).toContain("Button verrutscht");
    expect(r.stdout).toContain("bereits beendet");
  });

  test("the merge context demands a per-note disposition", () => {
    appendNote(cwd, "eins");
    appendNote(cwd, "zwei");
    const r = runHook({ prompt: ">> leg los" });
    expect(r.stdout).toContain("GENAU 2 Zeilen");
    expect(r.stdout).toContain("Abdeckungsliste");
  });
});

describe("mode on — an attachment prompt is filed, not executed", () => {
  beforeEach(() => activate(cwd, { marker: ">>" }));

  test("a prompt with an image gets the note-it-down guard", () => {
    // It cannot be blocked (a blocked prompt is erased and the screenshot with
    // it), so it passes through — but silently passing it through meant the
    // model acted on it immediately AND the merge never learned it existed.
    const r = runHook({ prompt: "so soll es aussehen [Image #1]" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Setze NICHTS davon um");
    expect(r.stdout).toContain("[Anhang]");
    expect(r.stdout).toContain("appendNote");
  });

  test("known attachment paths are named so the note can point at them", () => {
    const r = runHook({ prompt: "vergleich mit @docs/spec.md", files: ["/tmp/shot.png"] });
    expect(r.stdout).toContain("/tmp/shot.png");
    expect(r.stdout).toContain("docs/spec.md");
  });

  test("an attachment-free collected prompt gets no guard", () => {
    const r = runHook({ prompt: "ganz normale beobachtung" });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
  });

  test("firing the merge ends collection — follow-up prompts run normally", () => {
    // Everything after the fired prompt is the conversation ABOUT the work:
    // plan approval, answers to Claude's questions. Collecting those blocks and
    // erases exactly the prompts the implementation depends on.
    appendNote(cwd, "Button verrutscht");
    expect(runHook({ prompt: ">> leg los" }).code).toBe(0);
    expect(isModeActive(cwd)).toBe(false);

    const followUp = runHook({ prompt: "ja, so umsetzen" });
    expect(followUp.code).toBe(0);
    expect(followUp.stderr).not.toContain("gespeichert");
  });

  test("a marker prompt on an empty queue leaves the mode armed", () => {
    // Nothing fired, so nothing ended — the user just typed the marker early.
    expect(runHook({ prompt: ">> leg los" }).code).toBe(0);
    expect(isModeActive(cwd)).toBe(true);
    expect(runHook({ prompt: "noch eine beobachtung" }).code).toBe(2);
  });

  test("a mode file pinned to the old `!` marker still has a working escape", () => {
    // `!` never reaches this hook — the harness runs the line as a shell command.
    // A mode file written before that rule must not be honoured, or the merge
    // could never be fired again.
    const mode = JSON.parse(fs.readFileSync(path.join(cwd, ".claude", "batch-mode.json"), "utf8"));
    fs.writeFileSync(
      path.join(cwd, ".claude", "batch-mode.json"),
      JSON.stringify({ ...mode, marker: "!" }),
      "utf8",
    );
    appendNote(cwd, "eine notiz");
    const r = runHook({ prompt: "los: leg los" }, fakeHome({ marker: "los:" }));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("eine notiz");
  });
});

describe("failsafe — collection cannot trap the user", () => {
  test("an expired mode stops collecting on its own", () => {
    activate(cwd, { startedAt: Date.now() - 9 * 3600_000, expiryHours: 8 });
    const r = runHook({ prompt: "sollte durchlaufen" });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toEqual([]);
  });

  test("the note cap stops collecting on its own", () => {
    activate(cwd, { maxNotes: 2 });
    expect(runHook({ prompt: "eins" }).code).toBe(2);
    expect(runHook({ prompt: "zwei" }).code).toBe(2);
    const r = runHook({ prompt: "drei" });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toHaveLength(2);
  });

  test("an unwritable notes path lets the prompt through instead of erasing it", () => {
    activate(cwd);
    // Make .claude/batch.md a directory so appendFileSync fails.
    fs.mkdirSync(path.join(cwd, ".claude", "batch.md"), { recursive: true });
    const r = runHook({ prompt: "darf nicht verloren gehen" });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("normal weiter");
  });

  test("malformed stdin never blocks a prompt", () => {
    activate(cwd);
    const res = spawnSync(process.execPath, [HOOK], { input: "not json", cwd, encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});

describe("message builders", () => {
  test("the acknowledgement names the count and both exits", () => {
    const ack = buildAck(3, ">>", false);
    expect(ack).toContain("Notiz #3 gespeichert");
    expect(ack).toContain('">> <text>"');
    expect(ack).toContain("/claude-batch off");
    expect(ack).not.toContain("Frage");
  });

  test("the acknowledgement defuses the harness's red block panel", () => {
    // The user reads a red "a hook blocked your input" box. The first line has
    // to say the note landed, or a correct collection reads as a failure.
    expect(buildAck(3, ">>", false).split("\n")[0]).toContain("kein Fehler");
  });

  test("the question hint appears only for question-shaped notes", () => {
    expect(buildAck(1, ">>", true)).toContain("Frage");
  });

  test("oversized note sets keep an index, never a bare file pointer", () => {
    // A pointer alone is how a long queue lost items: the turn was told to read
    // a file, read part of it, and nothing said what was missing.
    const notes = Array.from({ length: 400 }, (_, i) => ({
      at: "2026-08-16T10:00:00.000Z",
      text: `Notiz ${i} mit reichlich Text, damit die Grenze sicher überschritten wird.`,
    }));
    const ctx = buildMergeContext(notes, "los", "/tmp/p/.claude/batch.md");
    expect(ctx.length).toBeLessThan(INLINE_LIMIT);
    expect(ctx).toContain("/tmp/p/.claude/batch.md");
    expect(ctx).toContain("los");
    expect(ctx).toContain("Index aller 400 Notizen");
    expect(ctx).toContain("#1 (2026-08-16T10:00:00.000Z) Notiz 0");
  });

  test("a truncated index says so instead of looking complete", () => {
    const notes = Array.from({ length: 400 }, (_, i) => ({
      at: "2026-08-16T10:00:00.000Z",
      text: `Notiz ${i} `.repeat(20),
    }));
    const ctx = buildMergeContext(notes, "", "/tmp/p/.claude/batch.md");
    expect(ctx).toMatch(/bis #400 sind hier NICHT gelistet/);
  });

  test("the empty-queue notice separates 'no file' from 'unreadable file'", () => {
    expect(buildEmptyQueueNotice("/p/.claude/batch.md", false, 0, ">>"))
      .toContain("tatsächlich leer");
    expect(buildEmptyQueueNotice("/p/.claude/batch.md", true, 4096, ">>"))
      .toContain("Sag dem Nutzer NICHT");
  });

  test("the attachment guard tells the turn to describe what only it can see", () => {
    const g = buildAttachmentGuard(">>", ["/tmp/shot.png"]);
    expect(g).toContain("beim Merge ist er nicht mehr im Kontext");
    expect(g).toContain("/tmp/shot.png");
    expect(g).toContain("WÖRTLICH");
  });
});

describe("mode off — the activating prompt gets a guard, not a turn of work", () => {
  test("an activation carrying notes injects the guard", () => {
    const r = runHook({
      prompt:
        "<command-name>/claude-batch</command-name>" +
        "<command-args>on der Header ist rot und die Filter-API fehlt</command-args>",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[claude-batch]");
    expect(r.stdout).toContain("NOTIZ, nicht Auftrag");
    // Nothing is stored: the mode is not on yet, and a note written here for a
    // prompt that turns out to be a question would be corruption.
    expect(readNotes(cwd)).toEqual([]);
  });

  test("a bare activation stays silent", () => {
    const r = runHook({
      prompt: "<command-name>/claude-batch</command-name><command-args>on</command-args>",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("an ordinary prompt stays silent", () => {
    const r = runHook({ prompt: "Der Button ist verrutscht" });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("the guard names the marker dialog it exists to protect", () => {
    const g = buildActivationGuard();
    expect(g).toContain("AskUserQuestion");
    expect(g).toContain("Step 2.4");
    expect(g).toContain("ignoriere diesen Hinweis");
  });
});
