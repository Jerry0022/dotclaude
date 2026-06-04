import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  expectedServers,
  serverEntryExists,
  isServerAlive,
  pidFileFor,
  resolveVars,
} from "./mcp-status.js";

const tmpDirs = [];
const tmpFiles = [];

function mkTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-status-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) { try { fs.unlinkSync(f); } catch {} }
  for (const d of tmpDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});

// ---------------------------------------------------------------------------
// expectedServers / serverEntryExists
// ---------------------------------------------------------------------------

describe("expectedServers", () => {
  test("parses .mcp.json and resolves ${CLAUDE_PLUGIN_ROOT}", () => {
    const root = mkTmpDir();
    fs.writeFileSync(path.join(root, ".mcp.json"), JSON.stringify({
      mcpServers: {
        "dotclaude-ship": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/mcp-server/ship/index.js"] },
        "dotclaude-completion": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"] },
      },
    }));
    const servers = expectedServers(root);
    expect(servers).toHaveLength(2);
    const ship = servers.find((s) => s.name === "dotclaude-ship");
    expect(ship.entry.startsWith(root)).toBe(true);
    expect(ship.entry.endsWith("ship/index.js")).toBe(true);
  });

  test("missing .mcp.json → empty list", () => {
    expect(expectedServers(mkTmpDir())).toEqual([]);
  });
});

describe("serverEntryExists", () => {
  test("true for an existing file, false for missing / null", () => {
    const root = mkTmpDir();
    const entry = path.join(root, "index.js");
    fs.writeFileSync(entry, "// stub");
    expect(serverEntryExists(entry)).toBe(true);
    expect(serverEntryExists(path.join(root, "nope.js"))).toBe(false);
    expect(serverEntryExists(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isServerAlive — heartbeat PID liveness
// ---------------------------------------------------------------------------

describe("isServerAlive", () => {
  const NAME = "vitest-fake-server-" + process.pid;

  test("alive when PID file points at this process", () => {
    const pidFile = pidFileFor(NAME);
    tmpFiles.push(pidFile);
    fs.writeFileSync(pidFile, String(process.pid));
    expect(isServerAlive(NAME)).toBe(true);
  });

  test("dead when PID file points at a non-existent process", () => {
    const pidFile = pidFileFor(NAME);
    tmpFiles.push(pidFile);
    fs.writeFileSync(pidFile, "999999999");
    expect(isServerAlive(NAME)).toBe(false);
  });

  test("false when no PID file exists", () => {
    expect(isServerAlive("vitest-no-such-server-" + Date.now())).toBe(false);
  });
});

describe("resolveVars", () => {
  test("substitutes plugin root and leaves unset env vars intact", () => {
    expect(resolveVars("${CLAUDE_PLUGIN_ROOT}/x.js", "/root")).toBe("/root/x.js");
    expect(resolveVars("${DEFINITELY_UNSET_VAR_XYZ}", "/root")).toBe("${DEFINITELY_UNSET_VAR_XYZ}");
  });
});
