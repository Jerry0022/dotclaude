import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildContext, ALWAYS_ON, MAX_ALWAYS_ON_BYTES } = require("./ss.knowledge.index.js");

/**
 * The bug this pins: `agent-proactivity.md` said "orchestrate by default", but
 * it only ever reached context when the prompt matched /proactiv/ in the
 * dispatch hook — so the rule was dead and the user had to ask for agents
 * every time. The delegation policy is now an ALWAYS_ON doc, injected in full
 * next to the index at every session start (startup/clear/compact).
 */

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

function tmpPlugin(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dk-index-"));
  fs.mkdirSync(path.join(root, "deep-knowledge"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, "deep-knowledge", name), body);
  }
  return root;
}

describe("ss.knowledge.index — always-on policy injection", () => {
  test("real plugin: the delegation policy is injected in full after the index", () => {
    const ctx = buildContext(PLUGIN_ROOT);
    expect(ctx).not.toBeNull();
    expect(ALWAYS_ON).toContain("agent-proactivity.md");

    const policy = fs
      .readFileSync(path.join(PLUGIN_ROOT, "deep-knowledge", "agent-proactivity.md"), "utf8")
      .trim();
    expect(ctx).toContain("[deep-knowledge always-on] deep-knowledge/agent-proactivity.md");
    expect(ctx).toContain(policy);
    // Index first, policy after, then the budget line — the last thing Claude reads.
    expect(ctx.indexOf("| File | Topic |")).toBeLessThan(ctx.indexOf("always-on"));
    const last = ctx.trimEnd().split("\n").pop();
    expect(last).toMatch(/^\[budget\] .* → (comfortable|tight|critical)/);
    expect(ctx.indexOf("always-on")).toBeLessThan(ctx.indexOf("[budget]"));
  });

  test("the policy stays under the preload cap", () => {
    for (const file of ALWAYS_ON) {
      const bytes = Buffer.byteLength(
        fs.readFileSync(path.join(PLUGIN_ROOT, "deep-knowledge", file), "utf8"),
        "utf8",
      );
      expect(bytes).toBeLessThanOrEqual(MAX_ALWAYS_ON_BYTES);
    }
  });

  test("a missing always-on file is skipped, index still goes", () => {
    const root = tmpPlugin({ "INDEX.md": "# Index\n\n| File | Topic |" });
    const ctx = buildContext(root);
    expect(ctx).toContain("| File | Topic |");
    expect(ctx).not.toContain("always-on");
  });

  test("an oversized always-on file is skipped, not truncated", () => {
    const root = tmpPlugin({
      "INDEX.md": "# Index",
      "agent-proactivity.md": "x".repeat(MAX_ALWAYS_ON_BYTES + 1),
    });
    const ctx = buildContext(root);
    expect(ctx).toContain("# Index");
    expect(ctx).not.toContain("always-on");
  });

  test("no INDEX.md → nothing to inject", () => {
    const root = tmpPlugin({ "agent-proactivity.md": "policy" });
    expect(buildContext(root)).toBeNull();
  });
});
