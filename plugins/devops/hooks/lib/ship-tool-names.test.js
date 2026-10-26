import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const T = require("./ship-tool-names");

const P = "mcp__plugin_devops_dotclaude__";
const L = "mcp__plugin_devops_dotclaude-ship__";
const env = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });

describe("ship-tool-names", () => {
  test("shipToolName / isShipTool read both prefixes", () => {
    expect(T.shipToolName(`${P}ship_run`)).toBe("ship_run");
    expect(T.shipToolName(`${L}ship_release`)).toBe("ship_release");
    expect(T.shipToolName(`${P}ship_version_bump`)).toBeNull();
    expect(T.shipToolName("mcp__other__ship_run")).toBeNull();
    expect(T.shipToolName(undefined)).toBeNull();
    for (const k of ["preflight", "build", "cleanup", "hygiene"]) expect(T.isShipTool(`${P}ship_${k}`, k)).toBe(true);
    expect(T.isShipTool(`${P}ship_run`, "preflight")).toBe(false);
  });

  test("the release kind covers ship_release and ship_run only", () => {
    expect(T.isReleaseTool(`${P}ship_release`)).toBe(true);
    expect(T.isReleaseTool(`${P}ship_run`)).toBe(true);
    expect(T.isReleaseTool(`${L}ship_run`)).toBe(true);
    expect(T.isReleaseTool(`${P}ship_build`)).toBe(false);
    expect(T.isShipTool(`${P}ship_run`, "run")).toBe(true);
    expect(T.isShipTool(`${P}ship_release`, "run")).toBe(false);
  });

  test("a merged ship_run result is a release that landed", () => {
    expect(T.releaseResultOf(`${P}ship_run`, env({ ok: true, merged: "main", pr: 5 }))).toEqual({ ok: true, merged: true, decision: null });
  });

  test("a ship_run decision point is no release and carries its needs", () => {
    const r = T.releaseResultOf(`${P}ship_run`, env({ ok: false, stage: "build", needs: "build-red", partial: { merged: "main" } }));
    expect(r).toEqual({ ok: false, merged: false, decision: "build-red" });
  });

  test("a final ship_run without a merge (file-only) is ok but not merged", () => {
    expect(T.releaseResultOf(`${P}ship_run`, env({ ok: true, merged: null }))).toMatchObject({ ok: true, merged: false });
  });

  test("ship_release keeps its success/merged shape; unreadable is null", () => {
    expect(T.releaseResultOf(`${P}ship_release`, env({ success: true, merged: "main" }))).toMatchObject({ ok: true, merged: true });
    expect(T.releaseResultOf(`${P}ship_release`, env({ success: true, merged: false }))).toMatchObject({ ok: true, merged: false });
    expect(T.releaseResultOf(`${P}ship_run`, { content: [{ type: "text", text: "boom" }] })).toBeNull();
  });

  test("partialOf returns the sub-results or {}", () => {
    expect(T.partialOf(env({ ok: false, partial: { preflight: { ready: true } } }))).toEqual({ preflight: { ready: true } });
    expect(T.partialOf(env({ ok: true }))).toEqual({});
    expect(T.partialOf("nope")).toEqual({});
  });

  test("cliShipTool reads the tool of an offline ship CLI call, not a mention", () => {
    expect(T.cliShipTool("node C:/p/mcp-server/ship/cli.js ship_run p.json", 'node "C:/p/mcp-server/ship/cli.js" ship_run p.json')).toBe("ship_run");
    expect(T.cliShipTool("node ship/cli.js ship_release -", "node ship/cli.js ship_release -")).toBe("ship_release");
    expect(T.cliShipTool("node other.js ship_run", "node other.js ship_run")).toBeNull();
    expect(T.cliShipTool("echo cli.js", "echo cli.js")).toBeNull();
  });
});
