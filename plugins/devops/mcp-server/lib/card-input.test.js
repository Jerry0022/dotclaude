import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  coerceChange, coerceTest, coerceValidation, coerceCardInput,
  validateCardInput, formatIssues, CARD_FIELD_REFERENCE,
  CARD_VARIANTS, CARD_VARIANT_REFERENCE, unknownCardKeys,
} from "./card-input.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("coercion — a string where the schema wants an object (#396)", () => {
  test("splits 'area → description' on the arrow", () => {
    expect(coerceChange("Completion card → shows the text")).toEqual({ area: "Completion card", description: "shows the text" });
  });

  test("accepts the em-dash, ASCII arrow and colon separators — first occurrence wins", () => {
    expect(coerceChange("Ship — merged")).toEqual({ area: "Ship", description: "merged" });
    expect(coerceChange("Ship -> merged")).toEqual({ area: "Ship", description: "merged" });
    expect(coerceChange("Ship: merged → ok")).toEqual({ area: "Ship", description: "merged → ok" });
  });

  test("no separator → the whole text becomes the description so it still shows", () => {
    expect(coerceChange("just a line of text")).toEqual({ area: "", description: "just a line of text" });
  });

  test("a leading separator is not a split (nothing before it)", () => {
    expect(coerceChange("→ text")).toEqual({ area: "", description: "→ text" });
  });

  test("objects and non-strings pass through untouched", () => {
    const obj = { area: "A", description: "B" };
    expect(coerceChange(obj)).toBe(obj);
    expect(coerceChange(42)).toBe(42);
    expect(coerceChange(null)).toBeNull();
  });

  test("tests and validation strings get their own shapes", () => {
    expect(coerceTest("npm test → 1460 grün")).toEqual({ method: "npm test", result: "1460 grün" });
    expect(coerceTest("eslint")).toEqual({ method: "eslint", result: "" });
    expect(coerceValidation("req — evidence")).toEqual({ requirement: "req", evidence: "evidence" });
    expect(coerceValidation("req only")).toEqual({ requirement: "req only" });
  });

  test("coerceCardInput maps every array field and leaves non-arrays for validation", () => {
    const p = coerceCardInput({ changes: ["A → b"], tests: ["t → r"], validation: ["v"], open: "not an array" });
    expect(p.changes).toEqual([{ area: "A", description: "b" }]);
    expect(p.tests).toEqual([{ method: "t", result: "r" }]);
    expect(p.validation).toEqual([{ requirement: "v" }]);
    expect(p.open).toBe("not an array");
    expect(coerceCardInput(null)).toBeNull();
  });
});

describe("validation — mirrors the tool's zod shapes without zod", () => {
  const base = { variant: "analysis", summary: "s" };

  test("a well-formed payload is ok", () => {
    const r = validateCardInput({
      ...base, lang: "de",
      changes: [{ area: "A", description: "b" }],
      tests: [{ method: "m", result: "r" }],
      validation: [{ requirement: "q", status: "met", evidence: "e" }],
      userFinalTest: ["x", { action: "y", afterDeployment: true }],
      open: ["o"], pending: ["p", { name: "devops:qa", kind: "agent", doing: "d" }],
      deployGate: ["g", { artifact: "a.sql", kind: "migration" }],
      state: { branch: "main", pr: { number: 1, title: "t" } }, cta: {}, delivery: {}, concept: "waiting",
    });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  test("REGRESSION: a non-coercible changes entry is an error with a path, not an empty bullet", () => {
    const r = validateCardInput({ ...base, changes: [42] });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ path: "changes[0]", message: expect.stringMatching(/area, description/) }]);
    expect(formatIssues(r.issues)).toBe("  - changes[0]: must be { area, description } (or a string 'area → description')");
  });

  test("missing area / description inside an object are named", () => {
    const r = validateCardInput({ ...base, changes: [{ description: "only" }, { area: "only" }] });
    expect(r.issues.map(i => i.path + ": " + i.message)).toEqual([
      "changes[0]: area must be a string",
      "changes[1]: description must be a string",
    ]);
  });

  test("every array field rejects a non-array; objects reject scalars; enums are checked", () => {
    const r = validateCardInput({
      ...base, changes: "x", tests: {}, validation: [{ requirement: "q", status: "done" }],
      pending: [{ name: "n", kind: "cron" }], state: "s", concept: "sleeping", lang: "fr",
    });
    const paths = r.issues.map(i => i.path);
    expect(paths).toEqual(expect.arrayContaining(["changes", "tests", "validation[0]", "pending[0]", "state", "concept", "lang"]));
  });

  test("optional fields absent or null are fine; a non-object payload is one issue", () => {
    expect(validateCardInput({ ...base, changes: null, state: null }).ok).toBe(true);
    expect(validateCardInput("nope").issues).toEqual([{ path: "", message: "payload must be a JSON object" }]);
  });
});

describe("the hook's offline field reference cannot drift from the validator", () => {
  test("card-guard.js exports the identical CARD_FIELD_REFERENCE", () => {
    const require = createRequire(import.meta.url);
    const guard = require(join(here, "..", "..", "hooks", "lib", "card-guard.js"));
    expect(guard.CARD_FIELD_REFERENCE).toBe(CARD_FIELD_REFERENCE);
  });

  test("the reference names every object-shaped field the validator checks", () => {
    for (const field of ["changes", "tests", "validation", "userFinalTest", "open", "pending"]) {
      expect(CARD_FIELD_REFERENCE).toContain(field + ":");
    }
    expect(CARD_FIELD_REFERENCE).toContain("{ area, description }");
  });

  test("the offline ladder printed by the hook carries the reference", () => {
    const src = readFileSync(join(here, "..", "..", "hooks", "lib", "card-guard.js"), "utf8");
    expect(src).toMatch(/CARD_FIELD_REFERENCE,\n\s+CARD_VARIANT_REFERENCE,\n\s+'A payload off these shapes/);
  });
});

// #406 — the CLI accepted `variant: "ship"` plus unknown keys and rendered a
// generic card with exit 0. The variant enum and the ship-successful merge
// proof are now validated where the shapes are, and the hook's offline text
// names both so an agent without the tool schema does not have to guess.
describe("variant contract (#406)", () => {
  const BASE = { variant: "ready", summary: "x" };

  test("CARD_VARIANTS is the enum the MCP schema and the CLI share", () => {
    expect(CARD_VARIANTS).toEqual([
      "ship-successful", "ready", "released", "ship-blocked", "test",
      "test-minimal", "analysis", "aborted", "fallback", "ready-files", "paused",
    ]);
    for (const v of CARD_VARIANTS) expect(validateCardInput({ ...BASE, variant: v, state: { pushed: true, merged: "main" } }).ok).toBe(true);
  });

  test("an unknown variant is an issue that lists the valid ones", () => {
    const r = validateCardInput({ ...BASE, variant: "ship" });
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([{ path: "variant", message: expect.stringMatching(/"ship" is not a card variant — must be one of ship-successful\|ready\|/) }]);
    expect(validateCardInput({ ...BASE, variant: 7 }).issues[0].message).toMatch(/must be one of ship-successful\|/);
  });

  test("ship-successful requires state.pushed === true and a truthy state.merged", () => {
    const need = (state) => validateCardInput({ ...BASE, variant: "ship-successful", state }).issues.map((i) => i.path);
    expect(need(undefined)).toEqual(["state"]);
    expect(need({})).toEqual(["state"]);
    expect(need({ pushed: true })).toEqual(["state"]);
    expect(need({ merged: "main" })).toEqual(["state"]);
    expect(need({ pushed: "yes", merged: "main" })).toEqual(["state"]);
    expect(need({ pushed: true, merged: "main" })).toEqual([]);
    expect(validateCardInput({ ...BASE, variant: "ship-successful", state: {} }).issues[0].message).toMatch(/state\.pushed: true and state\.merged/);
  });

  test("a file-only ship-successful is routed to ready-files, not asked for a merge proof it cannot give", () => {
    const r = validateCardInput({ ...BASE, variant: "ship-successful", state: { mode: "file-only" } });
    expect(r.issues).toEqual([{ path: "variant", message: expect.stringContaining('use "ready-files"') }]);
  });

  test("unknownCardKeys names top-level keys the schema does not know, in payload order", () => {
    expect(unknownCardKeys({ ...BASE, links: "x", cwd: ".", validationNotes: 1 })).toEqual(["links", "validationNotes"]);
    expect(unknownCardKeys({ ...BASE, promotion: {}, session_id: "s" })).toEqual([]);
    expect(unknownCardKeys(null)).toEqual([]);
    expect(unknownCardKeys([1])).toEqual([]);
  });

  test("card-guard.js exports the identical CARD_VARIANT_REFERENCE, and it names every variant", () => {
    const require = createRequire(import.meta.url);
    const guard = require(join(here, "..", "..", "hooks", "lib", "card-guard.js"));
    expect(guard.CARD_VARIANT_REFERENCE).toBe(CARD_VARIANT_REFERENCE);
    for (const v of CARD_VARIANTS) expect(CARD_VARIANT_REFERENCE).toContain(v);
    expect(CARD_VARIANT_REFERENCE).toMatch(/pushed: true, merged: "main"/);
  });
});
