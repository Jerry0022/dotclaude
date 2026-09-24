import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAck, buildRearmAck, buildMergeContext, renderSyncLines, buildActivationGuard,
  buildAttachmentGuard, buildEmptyQueueNotice, syncMain, INLINE_LIMIT, GIT_SYNC_SCRIPT,
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
      prompt: "<command-name>/do-batch</command-name>\n<command-args>off</command-args>",
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
    expect(ack).toContain("/do-batch off");
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

  test("the merge context tells the turn to strip the 📥 Batch title prefix", () => {
    // The marker path never loads the skill, so the restore instruction has to
    // ride along with the notes — otherwise the sidebar keeps saying "Batch".
    const ctx = buildMergeContext([{ at: "2026-08-16T10:00:00.000Z", text: "x" }], "", "/tmp/p/.claude/batch.md");
    expect(ctx).toContain('"📥 Batch – "');
    expect(ctx).toContain("mcp__ccd_session_mgmt__set_session_title");
    expect(ctx).toMatch(/still überspringen/);
  });

  test("the merge context hands the plan to auto-concept or do-run, never implements", () => {
    // The marker path never loads the skill, so the Step 4.6 hand-off rule has
    // to ride along: do-batch plans, the receiving skill runs.
    const ctx = buildMergeContext([{ at: "2026-08-16T10:00:00.000Z", text: "x" }], "", "/tmp/p/.claude/batch.md");
    expect(ctx).toContain("Skill devops:auto-concept mit --from=do-batch");
    expect(ctx).toContain("Skill devops:do-run mit --from=do-batch");
    expect(ctx).toContain("GENAU EINEN Skill");
    expect(ctx).toContain("OHNE eigene Freigabefrage");
    expect(ctx).toContain("du setzt selbst nichts um");
    expect(ctx).toContain("Im Zweifel auto-concept");
    expect(ctx).toContain("archiveNotes(cwd)");
    // The old inline path ("direkt in die Umsetzung") is gone.
    expect(ctx).not.toMatch(/direkt in die Umsetzung/);
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
        "<command-name>/do-batch</command-name>" +
        "<command-args>on der Header ist rot und die Filter-API fehlt</command-args>",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[do-batch]");
    expect(r.stdout).toContain("NOTIZ, nicht Auftrag");
    // Nothing is stored: the mode is not on yet, and a note written here for a
    // prompt that turns out to be a question would be corruption.
    expect(readNotes(cwd)).toEqual([]);
  });

  test("a bare activation stays silent", () => {
    const r = runHook({
      prompt: "<command-name>/do-batch</command-name><command-args>on</command-args>",
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

describe("mode on — a re-activation is absorbed, never a turn", () => {
  const expanded = (args) =>
    `<command-name>/do-batch</command-name><command-args>${args}</command-args>`;

  beforeEach(() => activate(cwd, { marker: ">>" }));

  test.each(["", "on", "an", "start"])("`/do-batch %s` is blocked with the mode summary", (args) => {
    // The user forgot the mode is on. The answer they need is the summary —
    // paying a turn for "already active" is the cost the mode exists to avoid.
    const r = runHook({ prompt: expanded(args) });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("läuft bereits");
    expect(r.stderr).toContain("kein Fehler");
    expect(r.stderr).toContain("Sammelmodus AKTIV");
    expect(r.stderr).toContain("/do-batch off");
    expect(r.stderr).toContain("/do-batch go");
    expect(readNotes(cwd)).toEqual([]);
    expect(isModeActive(cwd)).toBe(true);
  });

  test("free text through the command becomes a note", () => {
    const r = runHook({ prompt: expanded("der Header ist rot") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Notiz #1 gespeichert");
    expect(readNotes(cwd).map(n => n.text)).toEqual(["der Header ist rot"]);
  });

  test("text after `on` is the note, `on` itself is not", () => {
    runHook({ prompt: expanded("on die Filter-API fehlt") });
    expect(readNotes(cwd).map(n => n.text)).toEqual(["die Filter-API fehlt"]);
  });

  test.each(["off", "go", "status", "marker"])("the exit `%s` still reaches the skill", (args) => {
    const r = runHook({ prompt: expanded(args) });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("läuft bereits");
    expect(readNotes(cwd)).toEqual([]);
  });

  test("an invocation with an attachment passes through with the file-it guard", () => {
    const r = runHook({ prompt: expanded("so wie hier [Image #1]") });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Setze NICHTS davon um");
    expect(readNotes(cwd)).toEqual([]);
  });

  test("mode off — the same invocation is not absorbed", () => {
    activate(cwd, { marker: ">>", startedAt: Date.now() - 9 * 3600_000, expiryHours: 8 });
    const r = runHook({ prompt: expanded("on") });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });
});

describe("the collected-prompt panel carries the mode summary", () => {
  beforeEach(() => activate(cwd, { marker: ">go", expiryHours: 3, maxNotes: 50 }));

  test("every blocked prompt explains the mode with the pinned bounds", () => {
    const r = runHook({ prompt: "der Button ist verrutscht" });
    expect(r.stderr).toContain("Notiz #1 gespeichert");
    expect(r.stderr).toContain("Sammelmodus AKTIV · 1 Notiz(en) · Marker \">go\"");
    expect(r.stderr).toContain("\">go <text>\"");
    expect(r.stderr).toContain("/do-batch off");
    expect(r.stderr).toContain("3 Stunden oder 50 Notizen");
  });
});

describe("firing the merge brings main in first", () => {
  beforeEach(() => activate(cwd, { marker: ">>" }));

  test("the merge context opens with the sync result (temp dir: nothing to merge)", () => {
    appendNote(cwd, "Button verrutscht");
    const r = runHook({ prompt: ">> leg los" });
    expect(r.code).toBe(0);
    const ctx = r.stdout;
    expect(ctx).toContain("SCHRITT 0 — Stand von main");
    expect(ctx).toContain("nichts zu mergen");
    // Step 0 precedes the notes.
    expect(ctx.indexOf("SCHRITT 0")).toBeLessThan(ctx.indexOf("--- Notiz #1"));
    expect(isModeActive(cwd)).toBe(false);
  });

  test("a sync that could not run hands the command to the turn", () => {
    appendNote(cwd, "Button verrutscht");
    const r = runHook({ prompt: ">> leg los" }, { DEVOPS_BATCH_NO_SYNC: "1" });
    expect(r.stdout).toContain("konnte im Hook nicht laufen");
    expect(r.stdout).toContain("git-sync.js");
    expect(r.stdout).toContain("Button verrutscht");
  });

  test("an empty queue does not trigger a sync", () => {
    const r = runHook({ prompt: ">> leg los" });
    expect(r.stdout).not.toContain("SCHRITT 0");
    expect(r.stdout).toContain("KEINE Notiz lesen");
  });
});

describe("message builders — 0.4.0", () => {
  test("the rearm ack names the stored note only when there was one", () => {
    expect(buildRearmAck(3, ">>", true)).toContain("Notiz #3 gespeichert");
    expect(buildRearmAck(3, ">>", false)).toContain("Aufruf ignoriert");
    expect(buildRearmAck(3, ">>", false)).toContain("Sammelmodus AKTIV · 3 Notiz(en)");
  });

  test("the ack still opens with the all-clear and names both exits", () => {
    const ack = buildAck(2, ">start", false, { expiryHours: 8, maxNotes: 100 });
    expect(ack.split("\n")[0]).toContain("kein Fehler");
    expect(ack).toContain("\">start <text>\"");
    expect(ack).toContain("/do-batch off");
    expect(ack).toContain("8 Stunden oder 100 Notizen");
  });

  test("a conflicting sync is flagged as resolve-first", () => {
    const lines = renderSyncLines({ ran: true, output: "[git-sync] ⚠ origin/main → feat: 2 file(s) with ambiguous conflicts" }).join("\n");
    expect(lines).toContain("Löse ihn ZUERST");
    expect(lines).toContain("merge-safety.md");
  });

  test("a clean merge is reported verbatim", () => {
    const lines = renderSyncLines({ ran: true, output: "[git-sync] ✓ origin/main → feat: 3 commit(s)" }).join("\n");
    expect(lines).toContain("3 commit(s)");
    expect(lines).not.toContain("Löse ihn ZUERST");
  });

  test("a skipped sync is never reported as 'already contained'", () => {
    const lines = renderSyncLines({
      ran: true,
      output: "[git-sync] – origin/main → feat: skipped: uncommitted changes overlap the incoming merge: a.js",
    }).join("\n");
    expect(lines).toContain("NICHT vollständig gemerged");
    expect(lines).toContain("--explain");
    expect(lines).not.toContain("bereits enthalten");
  });

  test("an '=' line reads as nothing to merge", () => {
    const lines = renderSyncLines({ ran: true, output: "[git-sync] = origin/main already in feat" }).join("\n");
    expect(lines).toContain("nichts zu mergen");
    expect(lines).not.toContain("gerade gemerged");
  });

  test("no sync record at all still demands the run", () => {
    expect(renderSyncLines(undefined).join("\n")).toContain("Kein Sync gelaufen");
  });

  test("syncMain respects the opt-out and points at the real script", () => {
    const r = syncMain(cwd);
    expect(r.script).toBe(GIT_SYNC_SCRIPT);
    expect(fs.existsSync(GIT_SYNC_SCRIPT)).toBe(true);
    process.env.DEVOPS_BATCH_NO_SYNC = "1";
    try {
      expect(syncMain(cwd)).toMatchObject({ ran: false });
    } finally {
      delete process.env.DEVOPS_BATCH_NO_SYNC;
    }
  });
});

describe("help — the long form, free of charge while collecting", () => {
  const expanded = (args) =>
    `<command-name>/do-batch</command-name><command-args>${args}</command-args>`;

  test("`/do-batch help` while active prints both step lists and stores nothing", () => {
    activate(cwd, { marker: ">start" });
    const r = runHook({ prompt: expanded("help") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("A) Was DU machst");
    expect(r.stderr).toContain("B) Was CLAUDE macht");
    expect(r.stderr).toContain("\">start <text>\"");
    expect(r.stderr).not.toContain("läuft bereits");
    expect(readNotes(cwd)).toEqual([]);
    expect(isModeActive(cwd)).toBe(true);
  });

  test("`/do-batch help` while off reaches the skill", () => {
    const r = runHook({ prompt: expanded("help") });
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });

  test("the collected-prompt panel names status, marker and help", () => {
    activate(cwd, { marker: ">>" });
    const r = runHook({ prompt: "der Rand ist zu dick" });
    expect(r.stderr).toContain("marker (Marker ändern)");
    expect(r.stderr).toContain("help");
    expect(r.stderr).toContain("auch nach dem Auto-Ende");
  });
});
