import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { blockVerdict } from "./block-prompt.js";

const LIB = fileURLToPath(new URL("./block-prompt.js", import.meta.url));

describe("block-prompt (#958)", () => {
  test("the verdict is one JSON line: block, reason, original prompt suppressed", () => {
    const line = blockVerdict("✓ done");
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      decision: "block",
      reason: "✓ done",
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", suppressOriginalPrompt: true },
    });
  });

  test("blockPrompt writes the verdict to stdout and exits 0 with an empty stderr", () => {
    const r = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(LIB)}).blockPrompt("✓ done")`], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout).reason).toBe("✓ done");
  });
});
