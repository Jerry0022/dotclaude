import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// User-facing wording rules for the locale table (templates-common.md):
//   de: "Notiz" never "Kommentar"/"Anmerkung"; "Runde" never "Iteration";
//       the page never names the assistant ("Claude").
//   en: no "Claude" / "AI" as a word — the page is neutral about who answers.
// Code identifiers, data attributes and payload fields keep "iteration".
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "deep-knowledge");
const md = fs.readFileSync(path.join(dir, "templates-common.md"), "utf8");

const rows = [];
for (const m of md.matchAll(/^\| `([a-z_.0-9]+)`\s*\|(.+)\|$/gm)) {
  const cells = m[2].split("|").map((s) => s.trim());
  if (cells.length >= 2) rows.push({ key: m[1], en: cells[0], de: cells[1] });
}

// Keys allowed to keep a flagged word. Empty on purpose: add a key here only
// with a comment saying why the word must stay.
const ALLOW = new Set([
  // "🤖 Claude macht beim Klick" — the close-out sheet's 🤖 group names who
  // runs the plan on the click; the user approved exactly this label in the
  // close-out concept (round 3, 2026-10-25).
  "final.group_claude",
]);

describe("locale table wording", () => {
  test("table is parsed", () => expect(rows.length).toBeGreaterThan(200));
  test("de values avoid Kommentar/Anmerkung/Iteration/Claude", () => {
    const bad = rows.filter((r) => !ALLOW.has(r.key) && /Kommentar|Anmerkung|kommentier|Iteration|Claude/i.test(r.de));
    expect(bad.map((r) => r.key)).toEqual([]);
  });
  test("en values avoid Claude / AI as a word", () => {
    const bad = rows.filter((r) => !ALLOW.has(r.key) && /\b(Claude|AI)\b/.test(r.en));
    expect(bad.map((r) => r.key)).toEqual([]);
  });
  test("notes wording and removed keys", () => {
    const get = (k) => rows.find((r) => r.key === k);
    expect(get("proto.feedback_title")).toMatchObject({ en: "Notes", de: "Notizen" });
    expect(get("design.feedback_in")).toBeUndefined();
    expect(get("iteration.tab")).toMatchObject({ en: "Round", de: "Runde" });
  });
});
