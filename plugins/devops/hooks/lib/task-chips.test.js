import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const chips = require("./task-chips.js");
const { mentionsChip, namesChip, dropChipOpenItems, recordSpawn, recordDismiss, readChips, chipReminder } = chips;

// The ten open points of 2026-08-20..09-25 that restated a task chip — every
// one of them said so in its own words. Each carried a "Nachbessern" reply
// that made the user fix the chip's topic in the shipping session.
const CHIP_POINTS = [
  "Budget report's agent remedy sends Claude to {PLUGIN_ROOT}/deep-knowledge — now live, wrong for consumer agents; follow-up chip queued",
  "Task-Chip: prompt.knowledge.dispatch-Tests hängen am AUTONOMOUS-LOCKOUT.flag im cwd (2 rote Tests in jedem AFK-Run)",
  "Ship-Ext-Finalizer musste in diesem Multi-Ship-Lauf manuell aufgeschoben werden — Task-Chip „Defer ship-ext plugin self-sync“ angelegt",
  "Commands moved to the background after a timeout are still invisible to the stop guard (follow-up chip ready)",
  "Reload während Claude arbeitet zeigt wieder den Bereit-Zustand (Doppel-Submit möglich) — als Folge-Task angelegt",
  "post.flow.completion reminders never reached the model — follow-up task queued",
  "post.claude.budget und post.design.remind schreiben noch Plain-stdout — ihre Hinweise erreichen Claude nie (Chip liegt bereit)",
  "Item-Spawn auf belegter Kachel → als Task-Chip angelegt (Fix item spawn landing on an occupied tile)",
  "Same blueprint rows: min-quality badge treats CIG's 0–1000 scale as 0–1, role badge leaks raw keys. Task chip created.",
  "Found on the way: blueprint→blueprint navigation keeps the old page (reads only the route snapshot) — task chip ready",
];

// Decisions about the work itself — some share words with chips or UI chips.
const KEPT_POINTS = [
  "Die alte Config-Datei wird nicht mehr gelesen — löschen oder behalten?",
  "The fix sits on its own branch (claude/fix-subagent-stop-gates), independent of the run-contract branch — ship it separately?",
  "Die volle Suite meldet 4 unhandled errors aus den Concept-Engine-Tests; separat anschauen?",
  "Erster Pan nach Kaltstart: 6 Long-Tasks (bis 172 ms) — Idle-Preload der Nachbar-Views als Folge-Issue?",
  "Concept-Disposition „verwerfen“: im Repo belassen oder per Follow-up-PR entfernen?",
  "Die Filter-Chips sind bereit — Farben noch anpassen?",
  "Neuer Chip bereit — Farbe ok?",
  "Status-Chip bereit, Kontrast prüfen?",
  "Soll ich einen Task-Chip für das Flaky-Test-Thema anlegen?",
  "Folge-Aufgabe: die Seite ist bereit für QA — testen?",
  "Die Migration ist bereit — Folge-Task: Deploy?",
];

describe("mentionsChip — the point says a chip already exists", () => {
  test.each(CHIP_POINTS)("drops: %s", (text) => {
    expect(mentionsChip(text)).toBe(true);
  });

  test.each(KEPT_POINTS)("keeps: %s", (text) => {
    expect(mentionsChip(text)).toBe(false);
  });

  test("the prepared reply counts too", () => {
    const { open, dropped } = dropChipOpenItems([
      { text: "Stale docs in the README", reply: "Ja — der Task-Chip ist angelegt, bitte starten." },
    ]);
    expect(dropped).toBe(1);
    expect(open).toEqual([]);
  });
});

describe("namesChip — the point names a live chip of the session", () => {
  const live = [{ id: "task_1", title: "Fix item spawn landing on an occupied tile" }];

  test("the whole title inside the point", () => {
    expect(namesChip("Kachel-Problem (Fix item spawn landing on an occupied tile)", live)).toBe(true);
  });

  test("a quoted part of the title", () => {
    expect(namesChip("Siehe „Fix item spawn landing“ — noch offen", live)).toBe(true);
  });

  test("shared words alone never match", () => {
    expect(namesChip("Item spawn on an occupied tile looks fine now — ship?", live)).toBe(false);
  });

  test("short titles are too generic to match", () => {
    expect(namesChip("Fix tests before the next ship?", [{ title: "Fix tests" }])).toBe(false);
  });
});

describe("dropChipOpenItems", () => {
  test("drops chip points, keeps decisions, in order", () => {
    const open = [KEPT_POINTS[0], CHIP_POINTS[3], { text: KEPT_POINTS[1] }, { text: CHIP_POINTS[6] }];
    const r = dropChipOpenItems(open, []);
    expect(r.dropped).toBe(2);
    expect(r.open).toEqual([KEPT_POINTS[0], { text: KEPT_POINTS[1] }]);
  });

  test("nothing to drop returns the same array", () => {
    const open = [KEPT_POINTS[0]];
    expect(dropChipOpenItems(open, [])).toEqual({ open, dropped: 0 });
    expect(dropChipOpenItems(undefined, [])).toEqual({ open: undefined, dropped: 0 });
  });
});

describe("chip state — recorded by the hook, read by the card server", () => {
  let tmp;
  let prev;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "task-chips-"));
    prev = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    process.env.TMPDIR = process.env.TEMP = process.env.TMP = tmp;
  });
  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const spawn = (sid, cwd, title, id) => ({
    session_id: sid,
    cwd,
    tool_name: "mcp__ccd_session__spawn_task",
    tool_input: { title, tldr: "Found while shipping.", prompt: "…" },
    tool_response: [{ type: "text", text: `Noted (position 1, task_id: ${id}). A chip is showing for the user — they can start it. Currently pending: ${id} "${title}". Continue your current work.` }],
  });

  test("a spawned chip is read back under the harness id", () => {
    expect(recordSpawn(spawn("sid-a", "C:/repo/wt", "Fix stale blueprint page on nav", "task_aa11"))).toEqual({ id: "task_aa11", title: "Fix stale blueprint page on nav" });
    const got = readChips("sid-a", "C:/repo/wt");
    expect(got.map((c) => c.id)).toEqual(["task_aa11"]);
  });

  test("an id the card cannot match falls back to the chip file of the same cwd", () => {
    recordSpawn(spawn("sid-b", "C:\\repo\\wt-b", "Keep the submitted panel across a tab reload", "task_bb22"));
    expect(readChips("self", "c:/repo/wt-b").map((c) => c.title)).toEqual(["Keep the submitted panel across a tab reload"]);
    expect(readChips("self", "C:/repo/other")).toEqual([]);
  });

  test("a withdrawn chip is no offer any more; one the user started still is", () => {
    recordSpawn(spawn("sid-c", "C:/repo/c", "Route two PostToolUse hooks through additionalContext", "task_cc33"));
    recordSpawn(spawn("sid-c", "C:/repo/c", "Fix flaky mtime test in graph-nudge", "task_cc44"));
    recordDismiss({ session_id: "sid-c", tool_input: { task_id: "task_cc44" }, tool_response: [{ type: "text", text: "Task task_cc44 was already started by the user — it's no longer pending and can't be withdrawn." }] });
    recordDismiss({ session_id: "sid-c", tool_input: { task_id: "task_cc33" }, tool_response: [{ type: "text", text: "Task task_cc33 withdrawn — the chip is no longer shown to the user." }] });
    expect(readChips("sid-c", "C:/repo/c").map((c) => c.id)).toEqual(["task_cc44"]);
  });

  test("a spawn without a title records nothing; unreadable state reads as no chips", () => {
    expect(recordSpawn({ session_id: "sid-d", tool_input: {} })).toBeNull();
    fs.writeFileSync(path.join(tmp, `${chips.STATE_PREFIX}-sid-e`), "{ not json");
    expect(readChips("sid-e", "C:/repo/e")).toEqual([]);
  });

  test("the reminder names the chip and says it is the offer", () => {
    const text = chipReminder("Fix the flaky test").join("\n");
    expect(text).toContain('"Fix the flaky test"');
    expect(text).toMatch(/chip IS the offer/);
    expect(text).toMatch(/Nachbessern/);
  });
});
