import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "gen-readme-sections.js");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("gen-readme-sections", () => {
  it("keeps README.md + architecture.html auto-markers in sync with the roster", () => {
    // --check exits non-zero (throws) when any marker is stale. Committed docs
    // must always be in sync — this is the regression guard the generator exists for.
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--check", REPO_ROOT], { stdio: "pipe" }),
    ).not.toThrow();
  });
});
