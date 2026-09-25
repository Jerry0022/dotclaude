/**
 * AUD-016: run-contract.js was split into run-contract-store.js /
 * run-contract-answers.js / run-contract-obligations.js / run-contract-cli.js.
 * This asserts the facade's export surface never drifts from the snapshot
 * taken before the split, and that every export actually resolves through
 * one of the sibling modules (no dangling re-export).
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

// Snapshot taken from the pre-split run-contract.js `module.exports` (AUD-016).
const EXPECTED_KEYS = [
  "OTHER_PLACEHOLDERS", "LIB_PATH", "rearmHint",
  "disabled", "contractPath", "eventsPath", "prevPath", "pendingPath", "batchHandoffPath",
  "claim", "applyFollowUp", "answeredFields", "isPartialRouterCall", "mergeRouterAnswers",
  "hasHeader", "followUpModeHint", "machinePatch",
  "readContract", "readContractForCard", "readRawContract", "expiryNotice", "arm", "update",
  "record", "close", "events",
  "markPendingArm", "pendingArm", "clearPendingArm", "markBatchHandoff", "batchHandoffPending", "clearBatchHandoff",
  "extractAnswers", "isRouterCall", "parseRouterAnswers", "parseFollowUp", "parseMachinePrompt",
  "skillName", "segments", "currentSegment", "segmentHasWork", "openObligations",
  "formatBlock", "chosenLine", "summaryForCard", "cli",
].sort();

describe("run-contract.js facade (AUD-016)", () => {
  test("exports exactly the pre-split key set", () => {
    expect(Object.keys(RC).sort()).toEqual(EXPECTED_KEYS);
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
      store: ["disabled", "contractPath", "eventsPath", "prevPath", "pendingPath", "batchHandoffPath",
        "claim", "readContract", "readContractForCard", "readRawContract", "expiryNotice", "arm", "update",
        "record", "close", "events", "markPendingArm", "pendingArm", "clearPendingArm",
        "markBatchHandoff", "batchHandoffPending", "clearBatchHandoff", "LIB_PATH", "rearmHint"],
      answers: ["OTHER_PLACEHOLDERS", "applyFollowUp", "answeredFields", "isPartialRouterCall", "mergeRouterAnswers",
        "hasHeader", "followUpModeHint", "machinePatch", "extractAnswers", "isRouterCall", "parseRouterAnswers",
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
