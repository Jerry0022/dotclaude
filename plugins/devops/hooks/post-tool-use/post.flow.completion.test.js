import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(__dirname, "post.flow.completion.js");

// Build a temp project whose settings enable the plugin, so plugin-guard does
// not short-circuit the hook before it emits the card instruction.
function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "completion-flow-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } })
  );
  return dir;
}

function runHook(dir, sid, toolName = "Read") {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    input: JSON.stringify({
      tool_name: toolName,
      tool_input: { file_path: path.join(dir, "a.js") },
      session_id: sid,
      cwd: dir,
    }),
    encoding: "utf8",
  });
  return res.stdout || "";
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// The delivery track (PR → Ship → Promote) and the released variant shipped in
// #266/#267, but renderDelivery only fires when the optional `delivery` input is
// passed. That input was instructed ONLY inside skills/ship and skills/promote,
// so every card outside those two pipelines silently dropped the track — the
// feature was built, merged, installed, and never seen. These tests pin the
// instruction that closes that gap.
describe("post.flow.completion — completion-card instruction completeness", () => {
  test("names the `delivery` field, so the pipeline track survives outside /ship", () => {
    const dir = project();
    // The session id must not itself contain "delivery" — it is echoed into the
    // instruction and would make this assertion pass for the wrong reason.
    const out = runHook(dir, "s-track");
    expect(out).toContain("COMPLETION CARD");
    expect(out).toContain("delivery");
    cleanup(dir);
  });

  test("scopes `delivery` to turns that reached a pipeline stage, not every card", () => {
    const dir = project();
    const out = runHook(dir, "s-track-scope");
    // An unconditional instruction would render three empty ⚪ nodes on routine
    // cards. The instruction must key off an actual PR / ship / promote.
    const deliveryLine = out.split("\n").find(l => l.includes("delivery"));
    expect(deliveryLine).toBeTruthy();
    expect(deliveryLine.toLowerCase()).toMatch(/\bpr\b/);
    cleanup(dir);
  });
});
