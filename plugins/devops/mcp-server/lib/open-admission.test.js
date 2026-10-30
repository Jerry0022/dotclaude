import { describe, test, expect } from "vitest";
import { dropNextStepOpenItems, isNextStep, refuseInScopeFindings } from "./open-admission.js";

describe("refuseInScopeFindings (#920)", () => {
  test("refuses an in-scope finding, keeps out-of-scope, untagged and strings", () => {
    const r = refuseInScopeFindings([
      { text: "Voiced line names the wrong picture - angleichen?", finding: "in-scope" },
      { text: "Unrelated legacy route type error", finding: "out-of-scope" },
      { text: "Untagged decision" },
      "plain string",
    ]);
    expect(r.refused).toBe(1);
    expect(r.open).toHaveLength(3);
  });

  test("empty and absent input pass through", () => {
    expect(refuseInScopeFindings(undefined)).toEqual({ open: undefined, refused: 0 });
    expect(refuseInScopeFindings([])).toEqual({ open: [], refused: 0 });
  });
});

describe("dropNextStepOpenItems", () => {
  test("drops an item whose reply is a promote command: the Promote buttons own it", () => {
    const r = dropNextStepOpenItems([
      { text: "Promotion nach beta (alpha 0.335.5, beta 0.335.0) — vom Run bewusst nicht gemacht", reply: "promote beta 0.335.5" },
      { text: "Nach beta heben?", reply: "promote beta 0.335.5" },
      { text: "Legacy-Route entfernen?", reply: "Ja, entfernen." },
    ]);
    expect(r.dropped).toBe(2);
    expect(r.open).toEqual([{ text: "Legacy-Route entfernen?", reply: "Ja, entfernen." }]);
  });

  test("a promotion notice without a command reply stays (guard error, skipped soak)", () => {
    expect(isNextStep("Beta übersprungen — v1.2.3 ging direkt alpha→stable, ohne Beta-Phase")).toBe(false);
    expect(isNextStep("Promotion auf beta ausgesetzt — unbeaufsichtigter Lauf")).toBe(false);
  });

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

  test("ship review: past tense, compounds, bare ausgeben/posten and hinted questions stay", () => {
    for (const s of [
      "Bereits gepushte Commits enthalten den API-Key — rotieren",
      "Already pushed commits contain a secret — rotate the key",
      "The shipped config still points at the old DB — remove",
      "Released v0.170 has the bug too — hotfix stable",
      "Push-Benachrichtigungen sind seit dem Update aus — wieder aktivieren",
      "Shipping-Adresse wird im Checkout nicht validiert",
      "Bei leerer Config eine Warnung ausgeben",
      "Der Posten Versandkosten fehlt in der Rechnung",
      "Löschen oder behalten? (empfohlen: löschen)",
      "Soll ich nach main pushen? → ja",
    ]) expect(isNextStep(s)).toBe(false);
    for (const s of ["v1.2.3 ausgeben", "Im Discord posten", "Release ausgeben"]) {
      expect(isNextStep(s)).toBe(true);
    }
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
