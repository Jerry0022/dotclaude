import { describe, test, expect } from "vitest";
import { dropNextStepOpenItems, isNextStep } from "./open-admission.js";

describe("dropNextStepOpenItems", () => {
  test("drops the routine next step (German)", () => {
    const r = dropNextStepOpenItems(["Version ausgeben, nach main pushen und Discord-Post senden"]);
    expect(r).toEqual({ open: [], dropped: 1 });
  });

  test.each([
    "Anschließend shippen.",
    "Branch nach main mergen",
    "Release v1.2.3 vorbereiten",
    "Version bump auf 0.5.0",
    "Discord-Post senden",
    "Changelog veröffentlichen",
  ])("drops German phrasing: %s", text => {
    expect(isNextStep(text)).toBe(true);
  });

  test.each([
    "Push the branch to origin",
    "Ship it",
    "Merge into main",
    "Bump the version and release",
    "Post to Discord",
  ])("drops English phrasing: %s", text => {
    expect(isNextStep(text)).toBe(true);
  });

  test("keeps a genuine decision and any question", () => {
    const open = [
      "Alte Config löschen oder behalten?",
      "Soll ich nach main pushen?",
      { text: "Release jetzt oder erst nach dem Test?", reply: "Erst testen." },
      "Should we ship this today?",
    ];
    expect(dropNextStepOpenItems(open)).toEqual({ open, dropped: 0 });
  });

  test("question mark inside markup still counts as a question", () => {
    expect(isNextStep("Soll `main` gemergt werden?)")).toBe(false);
  });

  test("false-positive guards: substrings and unrelated words stay", () => {
    for (const text of [
      "Postgres-Migration prüfen",
      "Relationship der Tabellen unklar",
      "Der Bishop-Algorithmus ist langsam",
      "Pushback vom Reviewer zu Namensgebung offen",
      "Lint-Regel für Imports fehlt",
    ]) expect(isNextStep(text)).toBe(false);
  });

  test("#759: a side session's unshipped work with a reply stays (QA defect)", () => {
    for (const it of [
      { text: "Build-ID-Fix liegt ungeshippt im Side-Branch, bitte shippen", reply: "Ship it in the side session." },
      { text: "Finished work in linked session not merged to main", reply: "ship" },
    ]) expect(isNextStep(it)).toBe(false);
    // Without a reply it is still the routine step.
    expect(isNextStep("Build-ID-Fix im Side-Branch shippen")).toBe(true);
  });

  test("bare merge / discord / Release-compound name decisions, not the step", () => {
    for (const s of [
      "Remove the legacy discord webhook config",
      "Das Release-Skript prüft die Version nicht",
      "Merge-Strategie für die Config-Dateien festlegen",
    ]) expect(isNextStep(s)).toBe(false);
  });

  test("object items are matched on text, not on reply", () => {
    const keep = { text: "Migration noch nicht getestet", reply: "Ja, dann shippen." };
    expect(isNextStep(keep)).toBe(false);
    expect(isNextStep({ text: "Nach main pushen", reply: "Ja." })).toBe(true);
  });

  test("mixed list keeps order and counts the drops", () => {
    const r = dropNextStepOpenItems(["A bleibt offen", "nach main pushen", { text: "Release senden" }, "B bleibt"]);
    expect(r.open).toEqual(["A bleibt offen", "B bleibt"]);
    expect(r.dropped).toBe(2);
  });

  test("empty and absent input pass through", () => {
    expect(dropNextStepOpenItems(undefined)).toEqual({ open: undefined, dropped: 0 });
    expect(dropNextStepOpenItems([])).toEqual({ open: [], dropped: 0 });
  });
});
