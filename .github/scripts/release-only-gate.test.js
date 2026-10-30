import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { decide, isReleaseFile } = require("./release-only-gate.js");

const RELEASE = [".claude-plugin/marketplace.json", "CHANGELOG.md", "README.md", "plugins/devops/.claude-plugin/plugin.json", "plugins/local-llm/.claude-plugin/plugin.json"];

describe("release-only gate", () => {
  test("a release-only push on a green head skips the shards", () => {
    expect(decide({ action: "synchronize", compareStatus: "ahead", files: RELEASE, suiteGreen: true }).skip).toBe(true);
  });

  test("a code file in the push runs the suite", () => {
    const v = decide({ action: "synchronize", compareStatus: "ahead", files: [...RELEASE, "plugins/devops/mcp-server/index.js"], suiteGreen: true });
    expect(v.skip).toBe(false);
    expect(v.reason).toMatch(/index\.js/);
  });

  test("no green suite on the previous head runs the suite", () => {
    expect(decide({ action: "synchronize", compareStatus: "ahead", files: RELEASE, suiteGreen: false }).skip).toBe(false);
  });

  test("a force-push (diverged), a PR open or an empty diff runs the suite", () => {
    expect(decide({ action: "synchronize", compareStatus: "diverged", files: RELEASE, suiteGreen: true }).skip).toBe(false);
    expect(decide({ action: "opened", compareStatus: "ahead", files: RELEASE, suiteGreen: true }).skip).toBe(false);
    expect(decide({ action: "synchronize", compareStatus: "ahead", files: [], suiteGreen: true }).skip).toBe(false);
  });

  test("only release files count, a nested plugin.json elsewhere does not", () => {
    for (const f of RELEASE) expect(isReleaseFile(f)).toBe(true);
    expect(isReleaseFile("plugins/devops/mcp-server/plugin.json")).toBe(false);
    expect(isReleaseFile("docs/CHANGELOG.md")).toBe(false);
    expect(isReleaseFile("package.json")).toBe(false);
  });
});
