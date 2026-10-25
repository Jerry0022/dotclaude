import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { GATED_FEATURES, isFeatureEnabled, isSkillEnabled, filterSkills } = require("./channel-gate.js");
const { readChannelPin } = require("./channels.js");
const { routeMessage } = require("./skill-trigger-router.js");

const FEATURES = { "fake-feature": ["alpha"] };
const GATED = { "auto-fake": "fake-feature" };
const withPin = (pin) => ({ features: FEATURES, gatedSkills: GATED, pinReader: () => pin });

describe("isFeatureEnabled (fail-closed)", () => {
  test("alpha enabled", () => expect(isFeatureEnabled("fake-feature", withPin("alpha"))).toBe(true));
  test.each(["beta", "stable", "gamma", "", undefined, null, 42])("pin %s disabled", (pin) => {
    expect(isFeatureEnabled("fake-feature", withPin(pin))).toBe(false);
  });
  test("reader throws -> disabled", () => {
    expect(isFeatureEnabled("fake-feature", { features: FEATURES, pinReader: () => { throw new Error("boom"); } })).toBe(false);
  });
  test("unknown / malformed feature id -> disabled, even on alpha", () => {
    expect(isFeatureEnabled("nope", withPin("alpha"))).toBe(false);
    expect(isFeatureEnabled(undefined, withPin("alpha"))).toBe(false);
    expect(isFeatureEnabled("__proto__", withPin("alpha"))).toBe(false);
    expect(isFeatureEnabled("fake-feature", { features: { "fake-feature": "alpha" }, pinReader: () => "alpha" })).toBe(false);
  });
  test("registry: frustrated-mode is alpha-only", () => {
    expect(GATED_FEATURES["frustrated-mode"]).toEqual(["alpha"]);
  });
});

describe("pin sidecar integration (missing / corrupt / unknown)", () => {
  function reader(contents) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
    if (contents !== undefined) fs.writeFileSync(path.join(dir, ".channels.json"), contents);
    return () => readChannelPin(dir, "dotclaude");
  }
  const enabled = (r) => isFeatureEnabled("fake-feature", { features: FEATURES, pinReader: r });
  test("alpha pin on disk enables", () => expect(enabled(reader('{"dotclaude":"alpha"}'))).toBe(true));
  test("beta / stable disable", () => {
    expect(enabled(reader('{"dotclaude":"beta"}'))).toBe(false);
    expect(enabled(reader('{"dotclaude":"stable"}'))).toBe(false);
  });
  test("missing file, corrupt JSON, unknown value, other marketplace disable", () => {
    expect(enabled(reader(undefined))).toBe(false);
    expect(enabled(reader("{not json"))).toBe(false);
    expect(enabled(reader('{"dotclaude":"omega"}'))).toBe(false);
    expect(enabled(reader('{"other":"alpha"}'))).toBe(false);
  });
  test("pin is read at call time (same commit promoted alpha -> beta)", () => {
    let pin = "alpha";
    const opts = { features: FEATURES, pinReader: () => pin };
    expect(isFeatureEnabled("fake-feature", opts)).toBe(true);
    pin = "beta";
    expect(isFeatureEnabled("fake-feature", opts)).toBe(false);
  });
});

describe("skill invocation / visibility / suggestion via the router", () => {
  const skills = {
    "auto-fake": { name: "auto-fake", triggers: { en: ["frustration check"] } },
    "auto-fix": { name: "auto-fix", triggers: { en: ["this is broken"] } },
  };

  test("isSkillEnabled: ungated always true, gated follows the pin", () => {
    expect(isSkillEnabled("auto-fix", withPin("stable"))).toBe(true);
    expect(isSkillEnabled("auto-fake", withPin("alpha"))).toBe(true);
    expect(isSkillEnabled("auto-fake", withPin("beta"))).toBe(false);
    expect(isSkillEnabled("auto-fake", withPin(undefined))).toBe(false);
  });

  test("visibility: filterSkills drops a disabled gated skill, keeps the rest", () => {
    expect(Object.keys(filterSkills(skills, withPin("alpha")))).toEqual(["auto-fake", "auto-fix"]);
    expect(Object.keys(filterSkills(skills, withPin("beta")))).toEqual(["auto-fix"]);
  });

  test("suggestion: trigger phrase routes on alpha only", () => {
    const hit = (pin) => routeMessage("I have a frustration check to run", skills, { gate: withPin(pin) }).map(r => r.skill);
    expect(hit("alpha")).toEqual(["auto-fake"]);
    expect(hit("beta")).toEqual([]);
    expect(hit("stable")).toEqual([]);
    expect(hit("corrupt")).toEqual([]);
  });

  test("ungated routing is unaffected on every channel", () => {
    expect(routeMessage("this is broken", skills, { gate: withPin("stable") }).map(r => r.skill)).toEqual(["auto-fix"]);
  });
});
