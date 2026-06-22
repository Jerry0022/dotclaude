import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Characterization test for the PER-PLUGIN MCP completeness check in
 * ss.plugin.update.js's missingMcpFiles().
 *
 * The bug: MCP_CRITICAL_FILES is a devops-shaped list (mcp-server/ship/index.js,
 * mcp-server/issues/index.js, mcp-server/lib/heartbeat.js, ...) but the old
 * missingMcpFiles(targetRoot, expectMcp) asserted that WHOLE list against every
 * plugin that merely ships an .mcp.json. The local-llm plugin ships an .mcp.json
 * but its mcp-server/ has only index.js — so the check reported 3 files
 * permanently missing, forcing a cacheStale rebuild every session that could
 * never satisfy the check (the files don't exist upstream) → registry SHA never
 * advanced → churn. Observed: "local-llm … ⚠ mcp-server files: …heartbeat.js,
 * …ship\index.js, …issues\index.js".
 *
 * The fix: assert only the candidate files the SOURCE plugin actually ships.
 * The #190 guarantee is preserved — a file present upstream but dropped from the
 * cache is still flagged, and the gate is the SOURCE's .mcp.json (not the
 * target's) so a target whose .mcp.json was dropped is not masked.
 *
 * missingMcpFiles() is a non-exported internal of a SessionStart hook whose
 * module body self-executes on import (see the #190 copydir and #219 inplace
 * tests for the same constraint). So this mirrors the EXACT post-fix function
 * against temp source/target trees.
 */

// Mirror of MCP_CRITICAL_FILES and missingMcpFiles() after the fix.
const MCP_CRITICAL_FILES = [
  ".mcp.json",
  path.join("mcp-server", "index.js"),
  path.join("mcp-server", "lib", "heartbeat.js"),
  path.join("mcp-server", "ship", "index.js"),
  path.join("mcp-server", "issues", "index.js"),
];

function hasMcpServer(root) {
  return fs.existsSync(path.join(root, ".mcp.json"));
}

function missingMcpFiles(targetRoot, sourceRoot) {
  if (!hasMcpServer(sourceRoot)) return [];
  return MCP_CRITICAL_FILES.filter(
    (rel) => fs.existsSync(path.join(sourceRoot, rel)) && !fs.existsSync(path.join(targetRoot, rel)),
  );
}

let tmpRoot;
let src;
let dst;

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A faithful cache mirror: copy exactly the files the source has.
function mirror(srcRoot, dstRoot, rels) {
  for (const rel of rels) write(dstRoot, rel, fs.readFileSync(path.join(srcRoot, rel), "utf8"));
}

const DEVOPS_FILES = [...MCP_CRITICAL_FILES]; // ships the full set
const LOCAL_LLM_FILES = [".mcp.json", path.join("mcp-server", "index.js")]; // minimal layout

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-completeness-"));
  src = path.join(tmpRoot, "src");
  dst = path.join(tmpRoot, "dst");
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("ss.plugin.update missingMcpFiles — per-plugin completeness", () => {
  test("local-llm-shaped source (only mcp-server/index.js), cache mirrors it → NOT flagged", () => {
    // The regression: previously this reported ship/issues/heartbeat as missing.
    LOCAL_LLM_FILES.forEach((rel) => write(src, rel, `// ${rel}`));
    mirror(src, dst, LOCAL_LLM_FILES);
    expect(missingMcpFiles(dst, src)).toEqual([]);
  });

  test("devops-shaped source (full set), cache mirrors all 5 → NOT flagged", () => {
    DEVOPS_FILES.forEach((rel) => write(src, rel, `// ${rel}`));
    mirror(src, dst, DEVOPS_FILES);
    expect(missingMcpFiles(dst, src)).toEqual([]);
  });

  test("devops-shaped source, cache dropped mcp-server/ship/index.js → flagged (#190 preserved)", () => {
    DEVOPS_FILES.forEach((rel) => write(src, rel, `// ${rel}`));
    const dropped = path.join("mcp-server", "ship", "index.js");
    mirror(src, dst, DEVOPS_FILES.filter((rel) => rel !== dropped));
    expect(missingMcpFiles(dst, src)).toEqual([dropped]);
  });

  test("local-llm-shaped source, cache dropped its index.js → still flagged (real drop)", () => {
    LOCAL_LLM_FILES.forEach((rel) => write(src, rel, `// ${rel}`));
    mirror(src, dst, [".mcp.json"]); // index.js missing from cache
    expect(missingMcpFiles(dst, src)).toEqual([path.join("mcp-server", "index.js")]);
  });

  test("source without an .mcp.json (not an MCP plugin) → asserts nothing", () => {
    // No .mcp.json in source → hasMcpServer(source) is false → empty, even with an empty target.
    write(src, "skills/x/SKILL.md", "# x");
    expect(missingMcpFiles(dst, src)).toEqual([]);
  });

  test("target dropped its .mcp.json while source has it → flagged (gate is the source)", () => {
    DEVOPS_FILES.forEach((rel) => write(src, rel, `// ${rel}`));
    mirror(src, dst, DEVOPS_FILES.filter((rel) => rel !== ".mcp.json"));
    expect(missingMcpFiles(dst, src)).toEqual([".mcp.json"]);
  });
});
