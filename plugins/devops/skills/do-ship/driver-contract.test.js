import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The ship_run driver (M7). SKILL.md is short now; the step-by-step pipeline
// lives in deep-knowledge/manual-pipeline.md (gate-contract.test.js pins it).
// These pins make sure no hard rule got lost in the move.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL = fs.readFileSync(path.join(__dirname, "SKILL.md"), "utf8");
const flat = (s) => s.replace(/\n>[ \t]?/g, "\n").replace(/\s+/g, " ");
const F = flat(SKILL);

describe("do-ship driver — ship_run", () => {
  test("well under half of the old 486 lines", () => {
    expect(SKILL.split("\n").length).toBeLessThan(243);
  });

  test("one ship_run call with cwd; the fallback is behind DEVOPS_SHIP_RUN=0", () => {
    expect(F).toMatch(/Every `ship_\*` tool call MUST include `cwd`/);
    expect(F).toMatch(/ship_run\(\{ cwd: "<cwd>"/);
    expect(F).toContain("DEVOPS_SHIP_RUN=0");
    expect(F).toContain("deep-knowledge/manual-pipeline.md");
    expect(F).toContain("select:mcp__plugin_devops_dotclaude__ship_run");
  });

  test("every needs value of ship_run has a row", async () => {
    const { NEEDS } = await import("../../mcp-server/ship/tools/run.js").catch(() => ({ NEEDS: null }));
    const needs = NEEDS || ["preflight-failed", "conflict", "rebase-required", "validation-gaps", "build-red", "codex-judgment",
      "bump-required", "major-bump", "bump-mismatch", "full-suite-required", "checks-failed", "release-failed", "tool-error"];
    for (const n of needs) expect(F, n).toContain("`" + n + "`");
  });

  test("lockout: never ask, BLOCK / RECORD & CONTINUE, marker re-derived", () => {
    expect(F).toContain('node "{PLUGIN_ROOT}/scripts/autonomous-lockout.js" check --ship');
    expect(F).toMatch(/never call `AskUserQuestion`/);
    expect(F).toMatch(/\*\*BLOCKs\*\*/);
    expect(F).toMatch(/\*\*RECORDs & CONTINUEs\*\*/);
    expect(F).toMatch(/re-derive it from that marker at every gate/);
    expect(F).toMatch(/major.*lockout: BLOCK/);
  });

  test("never retry a merged release; sentinel hygiene on blocked exits", () => {
    expect(F).toMatch(/\*\*Never retry a merged release\.\*\*/);
    expect(F).toMatch(/before rendering ANY `ship-blocked` card, first call `ship_cleanup\(\{ branch, cwd, keep: true \}\)`/);
  });

  test("keep-mode for harness worktrees, composed flags, promotion only from the user", () => {
    expect(F).toMatch(/harness-created worktree → keep, always \(#442\)/);
    expect(F).toMatch(/Never print git commands for the user to run after a ship/);
    for (const flag of ["--cwd", "--keep", "--queued", "--delegated", "--resume", "--card-data", "--inline"]) expect(F, flag).toContain(flag);
    expect(F).toMatch(/`--cwd` implies `--keep`/);
    expect(F).toMatch(/Never promote on a channel that did not come from the user/);
  });

  test("card is last; release fields replace own git calls", () => {
    expect(F).toMatch(/\*\*The card is the last output\*\*/);
    expect(F).toMatch(/`merged` ⇒ `ship-successful`/);
    expect(F).toMatch(/promotion-gap nudge from `channels` \/ `betaLag` \/ `stableLag`/);
    expect(F).toMatch(/`porcelain` must be empty before the card/);
  });

  test("Codex gate stays mandatory and model-side", () => {
    expect(F).toContain('bash "{PLUGIN_ROOT}/scripts/codex-safe.sh"');
    expect(F).toMatch(/never `\/codex:rescue`/);
    expect(F).toMatch(/never retry/);
  });
});
