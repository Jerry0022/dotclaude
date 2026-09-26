/**
 * AUD-016: run-contract.js was split into run-contract-store.js /
 * run-contract-answers.js / run-contract-obligations.js / run-contract-cli.js.
 * This asserts the facade's export surface never drifts from its snapshot,
 * and that every export actually resolves through one of the sibling modules
 * (no dangling re-export). The facade is public API: a key leaves it only by
 * an explicit decision (2026-09-26: the seven no production caller used).
 */
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const RC = require("./run-contract.js");
const store = require("./run-contract-store.js");
const answers = require("./run-contract-answers.js");
const obligations = require("./run-contract-obligations.js");
const cli = require("./run-contract-cli.js");

// Snapshot of the pre-split run-contract.js `module.exports` (AUD-016), minus
// the seven entries dropped on 2026-09-26 — see DROPPED below.
const EXPECTED_KEYS = [
  "OTHER_PLACEHOLDERS", "LIB_PATH", "rearmHint",
  "disabled",
  "claim", "applyFollowUp", "answeredFields", "isPartialRouterCall", "mergeRouterAnswers",
  "hasHeader", "machinePatch",
  "readContract", "readContractForCard", "expiryNotice", "arm", "update",
  "record", "close", "events",
  "markPendingArm", "pendingArm", "clearPendingArm", "markBatchHandoff", "batchHandoffPending", "clearBatchHandoff",
  "extractAnswers", "isRouterCall", "parseRouterAnswers", "parseFollowUp", "parseMachinePrompt",
  "skillName", "segments", "currentSegment", "segmentHasWork", "openObligations",
  "formatBlock", "chosenLine", "summaryForCard", "cli",
].sort();

// No production caller used these through the facade; they stay exported by
// their owning module (tests require it directly).
const DROPPED = {
  store: ["contractPath", "eventsPath", "prevPath", "pendingPath", "batchHandoffPath", "readRawContract"],
  answers: ["followUpModeHint"],
};

describe("run-contract.js facade (AUD-016)", () => {
  test("exports exactly the snapshot key set", () => {
    expect(Object.keys(RC).sort()).toEqual(EXPECTED_KEYS);
  });

  test("the dropped entries are gone from the facade but still live in their owning module", () => {
    const modules = { store, answers };
    for (const [modName, keys] of Object.entries(DROPPED)) {
      for (const key of keys) {
        expect(RC[key], key).toBeUndefined();
        expect(typeof modules[modName][key], key).toBe("function");
      }
    }
  });

  test("every export is defined and LIB_PATH / OTHER_PLACEHOLDERS keep their shape", () => {
    for (const key of EXPECTED_KEYS) {
      expect(RC[key]).toBeDefined();
    }
    expect(typeof RC.LIB_PATH).toBe("string");
    expect(RC.LIB_PATH.endsWith("run-contract.js")).toBe(true);
    expect(Array.isArray(RC.OTHER_PLACEHOLDERS)).toBe(true);
  });

  test("each export is reachable through its owning sibling module", () => {
    const owners = {
      store: ["disabled",
        "claim", "readContract", "readContractForCard", "expiryNotice", "arm", "update",
        "record", "close", "events", "markPendingArm", "pendingArm", "clearPendingArm",
        "markBatchHandoff", "batchHandoffPending", "clearBatchHandoff", "LIB_PATH", "rearmHint"],
      answers: ["OTHER_PLACEHOLDERS", "applyFollowUp", "answeredFields", "isPartialRouterCall", "mergeRouterAnswers",
        "hasHeader", "machinePatch", "extractAnswers", "isRouterCall", "parseRouterAnswers",
        "parseFollowUp", "parseMachinePrompt"],
      obligations: ["skillName", "segments", "currentSegment", "segmentHasWork", "openObligations",
        "formatBlock", "chosenLine", "summaryForCard"],
      cli: ["cli"],
    };
    const modules = { store, answers, obligations, cli };
    for (const [modName, keys] of Object.entries(owners)) {
      for (const key of keys) {
        expect(modules[modName][key]).toBe(RC[key]);
      }
    }
    // sanity: every expected key is covered by exactly one owner list above
    const covered = Object.values(owners).flat().sort();
    expect(covered).toEqual(EXPECTED_KEYS);
  });

  test("is still the CLI entry point (require.main guard calls run-contract-cli.cli)", () => {
    const facadePath = fileURLToPath(new URL("./run-contract.js", import.meta.url));
    const src = fs.readFileSync(facadePath, "utf8");
    expect(src).toMatch(/require\.main === module/);
    expect(src).toMatch(/cliModule\.cli\(process\.argv\.slice\(2\)\)/);
  });
});
